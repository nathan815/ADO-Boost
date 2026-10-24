import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const apiRoot = "https://api.addons.microsoftedge.microsoft.com";
const guidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export class EdgePublisher {
  constructor({ productId, clientId, apiKey }, { fetch: request = fetch, sleep = delay, log = console.log, maxPolls = 60 } = {}) {
    if (!guidPattern.test(productId ?? "")) throw new Error("EDGE_PRODUCT_ID must be the Partner Center product GUID");
    if (!clientId?.trim() || !apiKey?.trim()) throw new Error("EDGE_CLIENT_ID and EDGE_API_KEY are required");
    this.basePath = `/v1/products/${productId}/submissions`;
    this.headers = { Authorization: `ApiKey ${apiKey}`, "X-ClientID": clientId };
    this.secrets = [apiKey, clientId];
    this.fetch = request;
    this.sleep = sleep;
    this.log = log;
    this.maxPolls = maxPolls;
  }

  async publish(packageData, notes) {
    if (!packageData?.byteLength) throw new Error("Extension ZIP must not be empty");
    if (typeof notes !== "string" || !notes.trim() || notes.length >= 2000) {
      throw new Error("Certification notes must contain between 1 and 1999 characters");
    }
    const uploadPath = `${this.basePath}/draft/package`;
    const upload = await this.start(uploadPath, "application/zip", packageData);
    this.log(`Package upload operation: ${upload}`);
    await this.waitForOperation(`${uploadPath}/operations/${upload}`);

    const submission = await this.start(this.basePath, "application/json", JSON.stringify({ notes }));
    this.log(`Certification submission operation: ${submission}`);
    await this.waitForOperation(`${this.basePath}/operations/${submission}`);
    this.log("Submitted for Edge certification. This is not store approval or confirmation that the version is live.");
    return { upload, submission };
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

  async start(path, contentType, body) {
    // Never retry POSTs automatically: a lost response can still leave an accepted submission.
    const response = await this.request(path, { method: "POST", headers: { "Content-Type": contentType }, body }, 202);
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
  const publisher = new EdgePublisher({
    productId: process.env.EDGE_PRODUCT_ID,
    clientId: process.env.EDGE_CLIENT_ID,
    apiKey: process.env.EDGE_API_KEY
  });
  if (!process.env.EDGE_PACKAGE_PATH || !process.env.EDGE_NOTES_PATH) {
    throw new Error("EDGE_PACKAGE_PATH and EDGE_NOTES_PATH are required");
  }
  const [packageData, notes] = await Promise.all([
    readFile(process.env.EDGE_PACKAGE_PATH),
    readFile(process.env.EDGE_NOTES_PATH, "utf8")
  ]);
  const { upload, submission } = await publisher.publish(packageData, notes);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n## Submitted for certification\n\nUpload operation: ${upload}\n\nSubmission operation: ${submission}\n\nCertification is pending. Check Partner Center for approval and store availability; do not cancel an existing review to promote another release.\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
