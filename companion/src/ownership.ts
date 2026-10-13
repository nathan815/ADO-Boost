import { createHash } from "node:crypto";

export const OWNER_PRODUCT = "ADO Boost";

export interface OwnershipMarker {
  product: typeof OWNER_PRODUCT;
  extensionId: string;
  hostName: string;
  version: number;
}

export function createMarker(extensionId: string, hostName: string): OwnershipMarker {
  return { product: OWNER_PRODUCT, extensionId, hostName, version: 1 };
}

export function assertOwnedMarker(value: unknown, extensionId: string, hostName: string): asserts value is OwnershipMarker {
  if (!value || typeof value !== "object") throw new Error("Existing installation has no valid ADO Boost ownership marker");
  const marker = value as Partial<OwnershipMarker>;
  if (marker.product !== OWNER_PRODUCT || marker.extensionId !== extensionId || marker.hostName !== hostName || marker.version !== 1) {
    throw new Error("Existing installation is not owned by this ADO Boost package");
  }
}

export function assertOwnedRegistry(currentPath: string | null, expectedPath: string): void {
  if (currentPath !== null && normalize(currentPath) !== normalize(expectedPath)) {
    throw new Error(`The native host registry name is already owned by another manifest: ${currentPath}`);
  }
}

export function extensionIdFromManifestKey(key: string): string {
  const digest = createHash("sha256").update(Buffer.from(key, "base64")).digest().subarray(0, 16);
  return [...digest].flatMap((byte) => [byte >> 4, byte & 15]).map((nibble) => String.fromCharCode(97 + nibble)).join("");
}

function normalize(value: string): string {
  return value.replace(/^"|"$/g, "").replace(/\//g, "\\").toLowerCase();
}
