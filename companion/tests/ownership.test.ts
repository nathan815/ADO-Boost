import { describe, expect, it } from "vitest";
import { assertOwnedMarker, assertOwnedRegistry, createMarker, extensionIdFromManifestKey } from "../src/ownership.js";

const id = "oldakfajnbllipnfdaghapeiofnciopo";
const host = "com.adoboost.copilot";

describe("companion installation ownership", () => {
  it("accepts only matching ownership markers", () => {
    expect(() => assertOwnedMarker(createMarker(id, host), id, host)).not.toThrow();
    expect(() => assertOwnedMarker({ product: "Other", extensionId: id, hostName: host, version: 1 }, id, host)).toThrow("not owned");
  });

  it("rejects a registry name already pointing at another manifest", () => {
    expect(() => assertOwnedRegistry(null, "C:\\owned.json")).not.toThrow();
    expect(() => assertOwnedRegistry("C:\\owned.json", "c:/owned.json")).not.toThrow();
    expect(() => assertOwnedRegistry("C:\\other.json", "C:\\owned.json")).toThrow("another manifest");
  });

  it("derives the deterministic extension ID from the manifest public key", () => {
    const key = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmsHDcfzAXTO0nxF6ya0ocn+rF5LhIkld/q89k6jo7DBK7c9Pq0eNFlXMvDxIYiPotbmBek51cHVrUH2Rss3M3Rhb4nUsWUs2TGGI4hfWKAm3DJKzESwgtvOr7rLRyeMVu/kfVOU3lA/jf89PJ9GVeOa5bUraEMSQ8V9vC3Y09/A2C54gB95swN2CvJ9VFs83TIDESIiJRz5cEk9kS1RsdbwXpa8J37gktjvZ5PT2BpMsEykNSTvmnjxXNtVbshEEQ48GMZ097qMmIlPDWoIM5WM6nENVIANnRY/DJ3cVlmT+F7f2ajefuf6rx98dMlHvgC6QJP/Z5MSpui30/sx5nQIDAQAB";
    expect(extensionIdFromManifestKey(key)).toBe(id);
  });
});
