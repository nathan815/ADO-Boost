import { describe, expect, it, vi } from "vitest";
import { EdgePublisher } from "../scripts/publish-edge.mjs";

const productId = "a4577b0c-dc7e-4818-8369-45afb5a7696c";
const operationId = "11111111-2222-3333-4444-555555555555";
const submissionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const base = `https://api.addons.microsoftedge.microsoft.com/v1/products/${productId}/submissions`;
const credentials = { productId, clientId: "test-client", apiKey: "test-key" };
const zip = Buffer.from("test ZIP");
const notes = "Test in a reviewer-controlled Azure DevOps project.";
const accepted = (location = operationId) => new Response(null, { status: 202, headers: { Location: location } });
const status = (value, extra = {}) => Response.json({ status: value, ...extra });

function fixture(responses, options = {}) {
  const fetch = vi.fn();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  const sleep = vi.fn().mockResolvedValue(undefined);
  const log = vi.fn();
  const publisher = new EdgePublisher(credentials, { fetch, sleep, log, ...options });
  return { publisher, fetch, sleep, log };
}

describe("Edge release promotion", () => {
  it("previews the same requests as live mode with no API calls or polling", async () => {
    const dry = fixture([], { dryRun: true });
    await expect(dry.publisher.publish(zip, notes)).resolves.toEqual({ dryRun: true });
    expect(dry.fetch).not.toHaveBeenCalled();
    expect(dry.sleep).not.toHaveBeenCalled();
    const requests = dry.log.mock.calls.map(([message]) => message).filter((message) => message.startsWith("{")).map((message) => JSON.parse(message));

    const live = fixture([accepted(), status("Succeeded"), accepted(submissionId), status("Succeeded")]);
    await live.publisher.publish(zip, notes);
    expect(requests).toHaveLength(live.fetch.mock.calls.length);
    for (const [index, [url, init]] of live.fetch.mock.calls.entries()) {
      const preview = requests[index];
      expect(preview.url.replace("{uploadOperationId}", operationId).replace("{submissionOperationId}", submissionId)).toBe(url);
      expect(preview.method).toBe(init.method);
      expect(preview.headers).toEqual({ ...init.headers, Authorization: "ApiKey [redacted]", "X-ClientID": "[redacted]" });
      expect(preview.redirect).toBe(init.redirect);
      expect(preview.timeoutMs).toBe(60_000);
      if (typeof init.body === "string") expect(preview.body).toBe(init.body);
      else if (!init.body) expect(preview).not.toHaveProperty("body");
    }
    expect(requests[0].body).toEqual({
      type: "ZIP binary (not printed)",
      bytes: zip.byteLength,
      sha256: createHash("sha256").update(zip).digest("hex")
    });
    expect(JSON.parse(requests[2].body)).toEqual({ notes });
    const output = dry.log.mock.calls.map(([message]) => message).join("\n");
    expect(output).not.toContain(credentials.apiKey);
    expect(output).not.toContain(credentials.clientId);
    expect(output).toContain("GET polls up to 60 times");
    expect(output).toContain("Credentials");
    expect(output).not.toContain("Submitted for Edge certification.");
  });

  it("allows a dry run without publishing credentials", async () => {
    const fetch = vi.fn();
    const log = vi.fn();
    const publisher = new EdgePublisher({ productId }, { dryRun: true, fetch, log });
    await expect(publisher.publish(zip, notes)).resolves.toEqual({ dryRun: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(log.mock.calls.map(([message]) => message).join("\n")).not.toContain("undefined");
  });

  it("still validates notes and package data before previewing", async () => {
    const { publisher, fetch, log } = fixture([], { dryRun: true });
    await expect(publisher.publish(zip, " ")).rejects.toThrow("Certification notes");
    await expect(publisher.publish(Buffer.alloc(0), notes)).rejects.toThrow("must not be empty");
    expect(fetch).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("redacts credentials even if they occur in the certification body", async () => {
    const { publisher, log } = fixture([], { dryRun: true });
    await publisher.publish(zip, `${notes} ${credentials.apiKey} ${credentials.clientId}`);
    const output = log.mock.calls.map(([message]) => message).join("\n");
    expect(output).not.toContain(credentials.apiKey);
    expect(output).not.toContain(credentials.clientId);
  });

  it("requires an explicit boolean dry-run option", () => {
    expect(() => new EdgePublisher(credentials, { dryRun: "true" })).toThrow("boolean");
    expect(() => new EdgePublisher({ productId: "invalid" }, { dryRun: true })).toThrow("EDGE_PRODUCT_ID");
  });

  it("supports CLI dry runs without credentials and writes a preview rather than a submission summary", async () => {
    const root = await mkdtemp(join(tmpdir(), "ado-boost-edge-preview-"));
    try {
      const packagePath = join(root, "extension.zip");
      const notesPath = join(root, "notes.txt");
      const summaryPath = join(root, "summary.md");
      await writeFile(packagePath, zip);
      await writeFile(notesPath, notes);
      const env = {
        ...process.env,
        EDGE_PRODUCT_ID: productId,
        EDGE_PACKAGE_PATH: packagePath,
        EDGE_NOTES_PATH: notesPath,
        EDGE_DRY_RUN: "true",
        EDGE_CLIENT_ID: "",
        EDGE_API_KEY: "",
        GITHUB_STEP_SUMMARY: summaryPath
      };
      const script = fileURLToPath(new URL("../scripts/publish-edge.mjs", import.meta.url));
      const output = execFileSync(process.execPath, [script], { env, encoding: "utf8" });
      expect(output).toContain("no Edge API requests");
      const summary = await readFile(summaryPath, "utf8");
      expect(summary).toContain("Edge dry run: nothing submitted");
      expect(summary).toContain(`${base}/draft/package`);
      expect(summary).toContain(notes);
      expect(summary).not.toContain("## Submitted for certification");

      const invalid = spawnSync(process.execPath, [script], { env: { ...env, EDGE_DRY_RUN: "tru" }, encoding: "utf8" });
      expect(invalid.status).not.toBe(0);
      expect(invalid.stderr).toContain("EDGE_DRY_RUN must be true or false");
      const live = spawnSync(process.execPath, [script], { env: { ...env, EDGE_DRY_RUN: "false" }, encoding: "utf8" });
      expect(live.status).not.toBe(0);
      expect(live.stderr).toContain("EDGE_CLIENT_ID and EDGE_API_KEY are required");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("validates upload before submitting notes, using API-key authentication", async () => {
    const { publisher, fetch, sleep, log } = fixture([
      accepted(),
      status("InProgress"),
      status("Succeeded"),
      accepted(`${base}/operations/${submissionId}`),
      status("Succeeded")
    ]);
    await expect(publisher.publish(zip, notes)).resolves.toEqual({ upload: operationId, submission: submissionId });
    expect(fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      [`${base}/draft/package`, "POST"],
      [`${base}/draft/package/operations/${operationId}`, "GET"],
      [`${base}/draft/package/operations/${operationId}`, "GET"],
      [base, "POST"],
      [`${base}/operations/${submissionId}`, "GET"]
    ]);
    for (const [, init] of fetch.mock.calls) {
      expect(init.headers).toMatchObject({ Authorization: "ApiKey test-key", "X-ClientID": "test-client" });
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(fetch.mock.calls[0][1]).toMatchObject({ body: zip, headers: { "Content-Type": "application/zip" } });
    expect(fetch.mock.calls[3][1]).toMatchObject({
      body: JSON.stringify({ notes }),
      headers: { "Content-Type": "application/json" }
    });
    expect(sleep).toHaveBeenCalledExactlyOnceWith(10_000);
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining("not store approval"));
  });

  it("accepts relative operation locations", async () => {
    const { publisher } = fixture([
      accepted(`/v1/products/${productId}/submissions/draft/package/operations/${operationId}`),
      status("Succeeded"),
      accepted(submissionId),
      status("Succeeded")
    ]);
    await expect(publisher.publish(zip, notes)).resolves.toEqual({ upload: operationId, submission: submissionId });
  });

  it("never submits after package validation fails and surfaces the reason", async () => {
    const { publisher, fetch } = fixture([accepted(), status("Failed", { errors: ["Invalid manifest"] })]);
    await expect(publisher.publish(zip, notes)).rejects.toThrow("Invalid manifest");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reports an existing in-review submission without cancelling or retrying it", async () => {
    const { publisher, fetch } = fixture([
      accepted(), status("Succeeded"), accepted(submissionId),
      status("Failed", { errorCode: "InProgressSubmission", message: "Submission is in progress" })
    ]);
    await expect(publisher.publish(zip, notes)).rejects.toThrow("InProgressSubmission");
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it.each([401, 429, 500])("fails HTTP %s without retrying mutations or printing credentials", async (code) => {
    const { publisher, fetch } = fixture([new Response("test-key test-client", { status: code })]);
    const failure = publisher.publish(zip, notes);
    await expect(failure).rejects.toThrow(`HTTP ${code}`);
    await expect(failure).rejects.not.toThrow("test-key");
    await expect(failure).rejects.not.toThrow("test-client");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry an upload with an uncertain network outcome", async () => {
    const { publisher, fetch } = fixture([]);
    fetch.mockRejectedValueOnce(new Error("Connection lost"));
    await expect(publisher.publish(zip, notes)).rejects.toThrow("Connection lost");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    "not-an-operation",
    `https://example.com/v1/products/${productId}/submissions/draft/package/operations/${operationId}`,
    `${base}/operations/${operationId}`,
    `${base}/draft/package/operations/${operationId}?extra=true`
  ])("rejects invalid upload operation location %s", async (location) => {
    const response = location === null ? new Response(null, { status: 202 }) : accepted(location);
    const { publisher, fetch } = fixture([response]);
    await expect(publisher.publish(zip, notes)).rejects.toThrow(/operation/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["Unknown", undefined])("does not treat malformed operation status %s as success", async (value) => {
    const { publisher, fetch } = fixture([accepted(), status(value, { message: "Unexpected response" })]);
    await expect(publisher.publish(zip, notes)).rejects.toThrow("Unexpected response");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("bounds polling and warns against blind resubmission", async () => {
    const { publisher, fetch, sleep } = fixture([accepted(), status("InProgress"), status("InProgress")], { maxPolls: 2 });
    await expect(publisher.publish(zip, notes)).rejects.toThrow("It may still complete");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it.each(["", " ", "x".repeat(2000)])("rejects invalid certification notes before upload", async (value) => {
    const { publisher, fetch } = fixture([]);
    await expect(publisher.publish(zip, value)).rejects.toThrow("Certification notes");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an empty package before upload", async () => {
    const { publisher, fetch } = fixture([]);
    await expect(publisher.publish(Buffer.alloc(0), notes)).rejects.toThrow("must not be empty");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { ...credentials, productId: "store-id-instead-of-product-guid" },
    { ...credentials, clientId: "" },
    { ...credentials, apiKey: "" }
  ])("requires valid product identity and configured credentials", (config) => {
    expect(() => new EdgePublisher(config)).toThrow(/EDGE_/);
  });
});
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
