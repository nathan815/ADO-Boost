import { describe, expect, it, vi } from "vitest";
import {
  buildStoreUrl,
  checkEdgeStoreStatus,
  checkListing,
  checkPublishOperation,
  resolveStatus
} from "../scripts/check-edge-store-status.mjs";

const productId = "a4577b0c-dc7e-4818-8369-45afb5a7696c";
const operationId = "11111111-2222-3333-4444-555555555555";
const crxId = "abcdefghijklmnopabcdefghijklmnop";

describe("buildStoreUrl", () => {
  it("builds a detail URL from a CRX ID", () => {
    expect(buildStoreUrl({ crxId })).toBe(`https://microsoftedge.microsoft.com/addons/detail/ado-boost/${crxId}`);
  });

  it("accepts an explicit store URL and rejects other hosts", () => {
    const url = `https://microsoftedge.microsoft.com/addons/detail/ado-boost/${crxId}`;
    expect(buildStoreUrl({ storeUrl: url })).toBe(url);
    expect(() => buildStoreUrl({ storeUrl: "https://example.com/addons/detail/x" })).toThrow();
  });

  it("rejects a malformed CRX ID and returns null when unconfigured", () => {
    expect(() => buildStoreUrl({ crxId: "not-a-crx-id" })).toThrow();
    expect(buildStoreUrl({})).toBeNull();
  });
});

describe("checkListing", () => {
  const listingUrl = `https://microsoftedge.microsoft.com/addons/detail/ado-boost/${crxId}`;

  it("queries the JSON endpoint and reports published with the live version", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ name: "ADO Boost", crxId, version: "0.4.1" }));
    await expect(checkListing(listingUrl, { fetch })).resolves.toMatchObject({
      state: "published",
      httpStatus: 200,
      listingVersion: "0.4.1"
    });
    expect(fetch.mock.calls[0][0]).toBe(`https://microsoftedge.microsoft.com/addons/getproductdetailsbycrxid/${crxId}`);
  });

  it("reports not-published on a 404", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("Status Code: 404; Not Found", { status: 404 }));
    await expect(checkListing(listingUrl, { fetch })).resolves.toMatchObject({ state: "not-published" });
  });

  it("reports unknown for a 200 that is not a product", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("<html>shell</html>", { status: 200 }));
    await expect(checkListing(listingUrl, { fetch })).resolves.toMatchObject({ state: "unknown", httpStatus: 200 });
  });

  it("reports unknown when the request itself fails", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(checkListing("https://microsoftedge.microsoft.com/addons/detail/x", { fetch })).resolves.toMatchObject({
      state: "unknown"
    });
  });
});

describe("checkPublishOperation", () => {
  it("maps a succeeded publish operation to submission-created, never to approval", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ status: "Succeeded", message: `Successfully created submission with ID ${operationId}` }));
    const result = await checkPublishOperation(
      { productId, clientId: "test-client", apiKey: "test-key", operationId },
      { fetch }
    );
    expect(result.state).toBe("submission-created");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(
      `https://api.addons.microsoftedge.microsoft.com/v1/products/${productId}/submissions/operations/${operationId}`
    );
    expect(init.headers).toEqual({ Authorization: "ApiKey test-key", "X-ClientID": "test-client" });
  });
});

describe("per-version resolution", () => {
  it("treats a live listing at an older version as not-published for the target version", () => {
    expect(
      resolveStatus({ listing: { state: "published", listingVersion: "0.4.1" }, targetVersion: "0.5.0" }).status
    ).toBe("not-published");
    expect(
      resolveStatus({ listing: { state: "published", listingVersion: "0.5.0" }, targetVersion: "0.5.0" }).status
    ).toBe("published");
  });

  it("passes EDGE_TARGET_VERSION through the environment check", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ name: "ADO Boost", version: "0.4.1" }));
    await expect(
      checkEdgeStoreStatus({ EDGE_CRX_ID: crxId, EDGE_TARGET_VERSION: "0.5.0" }, { fetch })
    ).resolves.toMatchObject({ status: "not-published", listingVersion: "0.4.1", targetVersion: "0.5.0" });
  });
});

describe("resolveStatus / checkEdgeStoreStatus", () => {
  it("prefers a live listing over every other signal", () => {
    expect(
      resolveStatus({ listing: { state: "published" }, operation: { state: "operation-failed", detail: "boom" } }).status
    ).toBe("published");
  });

  it("reports unconfigured when neither a listing nor an operation is set", async () => {
    await expect(checkEdgeStoreStatus({})).resolves.toMatchObject({ status: "unconfigured", storeUrl: null });
  });

  it("reports not-published while the listing is unavailable", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("missing", { status: 404 }));
    await expect(checkEdgeStoreStatus({ EDGE_CRX_ID: crxId }, { fetch })).resolves.toMatchObject({
      status: "not-published"
    });
  });
});
