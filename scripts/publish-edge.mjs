import { appendFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const apiRoot = "https://api.addons.microsoftedge.microsoft.com";
const guidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export class EdgePublisher {
  constructor({ productId, clientId, apiKey }, { fetch: request = fetch, sleep = delay, log = console.log, maxPolls = 60, dryRun = false } = {}) {
    if (!guidPattern.test(productId ?? "")) throw new Error("EDGE_PRODUCT_ID must be the Partner Center product GUID");
    if (typeof dryRun !== "boolean") throw new Error("dryRun must be a boolean");
    if (!dryRun && (!clientId?.trim() || !apiKey?.trim())) throw new Error("EDGE_CLIENT_ID and EDGE_API_KEY are required");
    this.basePath = `/v1/products/${productId}/submissions`;
    this.headers = { Authorization: `ApiKey ${apiKey ?? "[redacted]"}`, "X-ClientID": clientId ?? "[redacted]" };
    this.secrets = [apiKey, clientId].filter((value) => typeof value === "string" && value.length > 0);
    this.fetch = request;
    this.sleep = sleep;
    this.log = log;
    this.maxPolls = maxPolls;
    this.dryRun = dryRun;
  }

  async publish(packageData, notes) {
    if (!packageData?.byteLength) throw new Error("Extension ZIP must not be empty");
    if (typeof notes !== "string" || !notes.trim() || notes.length >= 2000) {
      throw new Error("Certification notes must contain between 1 and 1999 characters");
    }
    const uploadPath = `${this.basePath}/draft/package`;
    const requests = [
      { method: "POST", path: uploadPath, headers: { "Content-Type": "application/zip" }, body: packageData },
      { method: "GET", path: `${uploadPath}/operations/{uploadOperationId}` },
      { method: "POST", path: this.basePath, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes }) },
      { method: "GET", path: `${this.basePath}/operations/{submissionOperationId}` }
    ];
    if (this.dryRun) {
      this.preview(requests);
      return { dryRun: true };
    }
    const upload = await this.start(requests[0]);
    this.log(`Package upload operation: ${upload}`);
    await this.waitForOperation(requests[1].path.replace("{uploadOperationId}", upload));

    const submission = await this.start(requests[2]);
    this.log(`Certification submission operation: ${submission}`);
    await this.waitForOperation(requests[3].path.replace("{submissionOperationId}", submission));
    this.log("Submitted for Edge certification. This is not store approval or confirmation that the version is live.");
    return { upload, submission };
  }

  preview(requests) {
    this.log("DRY RUN: no Edge API requests will be made. Credentials are redacted; operation IDs are placeholders returned only by real POST requests.");
    for (const { path, ...request } of requests) {
      const preview = {
        ...request,
        url: `${apiRoot}${path}`,
        headers: { ...this.headers, ...request.headers, Authorization: "ApiKey [redacted]", "X-ClientID": "[redacted]" },
        redirect: "error",
        timeoutMs: 60_000
      };
      if (request.body instanceof Uint8Array) {
        preview.body = {
          type: "ZIP binary (not printed)",
          bytes: request.body.byteLength,
          sha256: createHash("sha256").update(request.body).digest("hex")
        };
      }
      this.log(this.redact(JSON.stringify(preview, null, 2)));
    }
    this.log(`Each GET polls up to ${this.maxPolls} times, waiting 10 seconds between InProgress responses. Submission occurs only after upload validation succeeds. POSTs are never retried automatically.`);
    this.log("DRY RUN complete: nothing uploaded or submitted. API credentials, permissions, and current store state were not checked.");
  }

  async request(path, init, expectedStatus) {
    let response;
    try {
      response = await this.fetch(`${apiRoot}${path}`, {
        ...init,
        headers: { ...this.headers, ...init.headers },
        redirect: "error",
        signal: AbortSignal.timeout(60_000)
      });
    } catch (error) {
      throw new Error(this.redact(`Edge API ${init.method} request failed: ${error.message}. The outcome may be uncertain; check Partner Center before retrying.`));
    }
    if (response.status !== expectedStatus) {
      throw new Error(this.redact(`Edge API ${init.method} failed (HTTP ${response.status}): ${await response.text()}`));
    }
    return response;
  }

  async start({ path, ...request }) {
    // Never retry POSTs automatically: a lost response can still leave an accepted submission.
    const response = await this.request(path, request, 202);
    const location = response.headers.get("location");
    if (!location) throw new Error("Edge accepted the request but returned no operation ID. Check Partner Center before retrying.");
    if (guidPattern.test(location)) return location;
    const operationUrl = new URL(location, apiRoot);
    const prefix = `${path}/operations/`;
    const id = operationUrl.pathname.slice(prefix.length);
    if (operationUrl.origin !== apiRoot || !operationUrl.pathname.startsWith(prefix) || !guidPattern.test(id) || operationUrl.search || operationUrl.hash) {
      throw new Error("Edge returned an invalid operation location. Check Partner Center before retrying.");
    }
    return id;
  }

  async waitForOperation(path) {
    for (let poll = 0; poll < this.maxPolls; poll++) {
      const response = await this.request(path, { method: "GET" }, 200);
      const result = await response.json();
      if (result?.status === "Succeeded") return;
      if (result?.status !== "InProgress") {
        throw new Error(this.redact(`Edge operation failed: ${JSON.stringify(result)}. Check Partner Center before retrying.`));
      }
      if (poll + 1 < this.maxPolls) await this.sleep(10_000);
    }
    throw new Error("Timed out waiting for Edge operation. It may still complete; check Partner Center before retrying.");
  }

  redact(message) {
    for (const secret of this.secrets) message = message.replaceAll(secret, "[redacted]");
    return message;
  }
}

async function main() {
  const dryRunSetting = process.env.EDGE_DRY_RUN ?? "false";
  if (!["true", "false"].includes(dryRunSetting)) throw new Error("EDGE_DRY_RUN must be true or false");
  const dryRun = dryRunSetting === "true";
  const preview = [];
  const publisher = new EdgePublisher({
    productId: process.env.EDGE_PRODUCT_ID,
    clientId: process.env.EDGE_CLIENT_ID,
    apiKey: process.env.EDGE_API_KEY
  }, {
    dryRun,
    log: (message) => {
      console.log(message);
      if (dryRun) preview.push(message);
    }
  });
  if (!process.env.EDGE_PACKAGE_PATH || !process.env.EDGE_NOTES_PATH) {
    throw new Error("EDGE_PACKAGE_PATH and EDGE_NOTES_PATH are required");
  }
  const [packageData, notes] = await Promise.all([
    readFile(process.env.EDGE_PACKAGE_PATH),
    readFile(process.env.EDGE_NOTES_PATH, "utf8")
  ]);
  const result = await publisher.publish(packageData, notes);
  if (process.env.GITHUB_STEP_SUMMARY) {
    if (result.dryRun) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n## Edge dry run: nothing submitted\n\n\`\`\`text\n${preview.join("\n\n")}\n\`\`\`\n`);
    } else {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n## Submitted for certification\n\nUpload operation: ${result.upload}\n\nSubmission operation: ${result.submission}\n\nCertification is pending. Check Partner Center for approval and store availability; do not cancel an existing review to promote another release.\n`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
