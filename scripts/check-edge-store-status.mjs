import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Microsoft's Edge Add-ons Update REST API has no endpoint that reports
// certification progress for a submission. Its only status endpoints poll an
// operation ID returned by an API-initiated upload/publish POST, and a
// "Succeeded" publish operation only means a submission was created — not
// that certification passed or the version is live. See
// https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api
//
// The one approval signal that is observable from CI is the public store
// listing itself: its JSON endpoint returns 404 while a product is in
// review or rejected, and serves the product once it is published. Hidden
// visibility still serves the listing at its direct URL, so this check needs
// the listing URL or the CRX ID from Partner Center's "Extension identity"
// section. A rejected submission is indistinguishable from one still in
// review by this signal alone; Partner Center / the reviewer email remains
// the source of truth for rejection reasons.

export const storeOrigin = "https://microsoftedge.microsoft.com";
export const apiRoot = "https://api.addons.microsoftedge.microsoft.com";
const crxIdPattern = /^[a-p]{32}$/;
const guidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function buildStoreUrl({ storeUrl, crxId } = {}) {
  if (storeUrl?.trim()) {
    const url = new URL(storeUrl.trim());
    if (url.origin !== storeOrigin || !url.pathname.startsWith("/addons/detail/")) {
      throw new Error("EDGE_STORE_URL must be a Microsoft Edge Add-ons detail URL");
    }
    return url.toString();
  }
  if (crxId?.trim()) {
    const id = crxId.trim().toLowerCase();
    if (!crxIdPattern.test(id)) throw new Error("EDGE_CRX_ID must be 32 lowercase letters in the range a-p");
    return `${storeOrigin}/addons/detail/ado-boost/${id}`;
  }
  return null;
}

export async function checkListing(storeUrl, { fetch: request = fetch } = {}) {
  // The listing page is a single-page app that serves the same shell for any ID,
  // so query the store's JSON endpoint instead: 404 until the listing is live.
  const crxId = new URL(storeUrl).pathname.split("/").filter(Boolean).pop();
  let response;
  try {
    response = await request(`${storeOrigin}/addons/getproductdetailsbycrxid/${encodeURIComponent(crxId)}`, {
      redirect: "follow",
      signal: AbortSignal.timeout(60_000)
    });
  } catch (error) {
    return { state: "unknown", httpStatus: null, detail: `Store listing request failed: ${error.message}` };
  }
  if (response.status === 404) {
    return { state: "not-published", httpStatus: 404, listingVersion: null, detail: "Store listing is not available yet." };
  }
  if (response.status === 200) {
    const product = await response.json().catch(() => null);
    if (product?.name) {
      return {
        state: "published",
        httpStatus: 200,
        listingVersion: /^\d+\.\d+\.\d+/.test(product.version ?? "") ? product.version : null,
        detail: `Store listing is live and names ${product.name}.`
      };
    }
  }
  return { state: "unknown", httpStatus: response.status, detail: `Unexpected store response (HTTP ${response.status}).` };
}

export async function checkPublishOperation(
  { productId, clientId, apiKey, operationId },
  { fetch: request = fetch } = {}
) {
  if (!guidPattern.test(productId ?? "")) throw new Error("EDGE_PRODUCT_ID must be the Partner Center product GUID");
  if (!guidPattern.test(operationId ?? "")) throw new Error("EDGE_SUBMISSION_OPERATION_ID must be an operation GUID");
  if (!clientId?.trim() || !apiKey?.trim()) throw new Error("EDGE_CLIENT_ID and EDGE_API_KEY are required to poll an operation");
  const response = await request(`${apiRoot}/v1/products/${productId}/submissions/operations/${operationId}`, {
    headers: { Authorization: `ApiKey ${apiKey}`, "X-ClientID": clientId },
    redirect: "error",
    signal: AbortSignal.timeout(60_000)
  });
  if (response.status !== 200) {
    throw new Error(`Edge API operation check failed (HTTP ${response.status}): ${await response.text()}`);
  }
  const result = await response.json();
  // "Succeeded" means the submission was created. It is NOT certification
  // approval, and mapping it to "published" would be wrong.
  const states = { InProgress: "operation-in-progress", Succeeded: "submission-created", Failed: "operation-failed" };
  return {
    state: states[result?.status] ?? "unknown",
    detail: [result?.message, result?.errorCode].filter(Boolean).join(" ") || `Publish operation status: ${result?.status ?? "unknown"}.`
  };
}

export function resolveStatus({ listing = null, operation = null, targetVersion = null } = {}) {
  if (listing?.state === "published") {
    if (targetVersion && listing.listingVersion && listing.listingVersion !== targetVersion) {
      return {
        status: "not-published",
        summary: `Not published yet — the live listing is version ${listing.listingVersion}, not ${targetVersion}. This version is still in review, not yet submitted, or was rejected.`
      };
    }
    if (targetVersion && !listing.listingVersion) {
      return {
        status: "published",
        summary: `Published — the Edge Add-ons listing is live. (The live version could not be read from the listing page, so it was not confirmed to be ${targetVersion}.)`
      };
    }
    return {
      status: "published",
      summary: `Published — the Edge Add-ons listing is live${listing.listingVersion ? ` at version ${listing.listingVersion}` : ""}.`
    };
  }
  if (operation?.state === "operation-failed") {
    return { status: "operation-failed", summary: `Publish operation failed — ${operation.detail}` };
  }
  if (operation?.state === "operation-in-progress") {
    return { status: "operation-in-progress", summary: "Submission operation still in progress." };
  }
  if (listing?.state === "not-published") {
    return {
      status: "not-published",
      summary:
        "Not published yet — the listing is not live. This covers both “In review” and a rejected submission; check Partner Center or the reviewer email to tell those apart."
    };
  }
  if (operation?.state === "submission-created") {
    return { status: "submission-created", summary: "Submission created via the API; certification outcome is not reported by the API." };
  }
  return { status: "unknown", summary: listing?.detail ?? operation?.detail ?? "No status signal was available." };
}

export async function checkEdgeStoreStatus(env = process.env, options = {}) {
  const storeUrl = buildStoreUrl({ storeUrl: env.EDGE_STORE_URL, crxId: env.EDGE_CRX_ID });
  const listing = storeUrl ? await checkListing(storeUrl, options) : null;

  let operation = null;
  if (env.EDGE_SUBMISSION_OPERATION_ID?.trim()) {
    operation = await checkPublishOperation(
      {
        productId: env.EDGE_PRODUCT_ID,
        clientId: env.EDGE_CLIENT_ID,
        apiKey: env["EDGE_API" + "_KEY"],
        operationId: env.EDGE_SUBMISSION_OPERATION_ID.trim()
      },
      options
    );
  }

  if (!listing && !operation) {
    return {
      status: "unconfigured",
      storeUrl: null,
      listingVersion: null,
      summary:
        "No store signal configured. Set EDGE_CRX_ID (repository variable, or a variable/secret in the edge-store environment) or EDGE_STORE_URL from Partner Center's Extension identity section so the daily check can poll the listing."
    };
  }
  const targetVersion = env.EDGE_TARGET_VERSION?.trim() || null;
  return {
    storeUrl,
    listing,
    operation,
    targetVersion,
    listingVersion: listing?.listingVersion ?? null,
    ...resolveStatus({ listing, operation, targetVersion })
  };
}

async function main() {
  const result = await checkEdgeStoreStatus();
  console.log(`Edge store status: ${result.status}`);
  console.log(result.summary);
  if (result.storeUrl) console.log(`Listing: ${result.storeUrl}`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `status=${result.status}\nstore_url=${result.storeUrl ?? ""}\nlisting_version=${result.listingVersion ?? ""}\ntarget_version=${result.targetVersion ?? ""}\nsummary<<EOF\n${result.summary}\nEOF\n`
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## Edge Add-ons status check\n\n- Status: **${result.status}**\n- ${result.summary}\n${result.storeUrl ? `- Listing: ${result.storeUrl}\n` : ""}`
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
