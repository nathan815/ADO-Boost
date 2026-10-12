import type { PrRoute } from "./types";

const PR_SEGMENT = /^pullrequest$/i;

export function parsePrRoute(input: URL): PrRoute | null {
  const host = input.hostname.toLowerCase();
  const parts = input.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const gitIndex = parts.findIndex((part) => part.toLowerCase() === "_git");
  if (gitIndex < 0 || !parts[gitIndex + 1]) return null;

  const prIndex = parts.findIndex((part, index) => index > gitIndex && PR_SEGMENT.test(part));
  const pullRequestId = Number(parts[prIndex + 1]);
  if (prIndex < 0 || !Number.isSafeInteger(pullRequestId) || pullRequestId <= 0) return null;

  if (host === "dev.azure.com") {
    if (!parts[0] || !parts[1]) return null;
    return {
      origin: input.origin,
      organization: parts[0],
      project: parts[1],
      repository: parts[gitIndex + 1]!,
      pullRequestId
    };
  }

  if (host.endsWith(".visualstudio.com")) {
    const organization = host.slice(0, -".visualstudio.com".length);
    if (!organization || !parts[0]) return null;
    return {
      origin: input.origin,
      organization,
      project: parts[0],
      repository: parts[gitIndex + 1]!,
      pullRequestId
    };
  }

  return null;
}
