import { describe, expect, it } from "vitest";
import { parsePrRoute } from "../src/core/route";

describe("parsePrRoute", () => {
  it("parses encoded dev.azure.com PR routes", () => {
    expect(parsePrRoute(new URL("https://dev.azure.com/my-org/Project%20One/_git/Repo%20One/pullrequest/42?_a=files"))).toEqual({
      origin: "https://dev.azure.com",
      organization: "my-org",
      project: "Project One",
      repository: "Repo One",
      pullRequestId: 42
    });
  });

  it("parses legacy visualstudio.com routes", () => {
    expect(parsePrRoute(new URL("https://contoso.visualstudio.com/Project/_git/Repo/pullrequest/9"))).toEqual({
      origin: "https://contoso.visualstudio.com",
      organization: "contoso",
      project: "Project",
      repository: "Repo",
      pullRequestId: 9
    });
  });

  it("rejects non-PR routes", () => {
    expect(parsePrRoute(new URL("https://dev.azure.com/org/project/_git/repo/commits"))).toBeNull();
  });
});
