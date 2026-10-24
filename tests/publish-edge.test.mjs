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
