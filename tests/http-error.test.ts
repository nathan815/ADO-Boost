import { describe, expect, it, vi } from "vitest";
import { HttpResponseError } from "../src/core/http-error";

const request = {
  url: "https://dev.azure.com/org/project/_apis/git/repositories/repo/pullRequests/7/reviewers/me?api-version=7.1",
  method: "GET",
  headers: { Accept: "application/json" },
  credentials: "include" as const,
  body: null
};

describe("HTTP failure diagnostics", () => {
  it("captures the full response text and redacts sensitive request and response headers", async () => {
    const text = JSON.stringify({ message: "Reviewer ID is invalid", detail: "x".repeat(10000) });
    const response = new Response(text, {
      status: 400, statusText: "Bad Request",
      headers: { "content-type": "application/json", "x-vss-e2eid": "correlation-id", "set-cookie": "session=private", "x-auth-token": "private" }
    });
    const error = await HttpResponseError.fromResponse("Reviewer lookup failed (400)", {
      ...request, headers: { ...request.headers, Authorization: "Bearer private", Cookie: "session=private" }
    }, response);
    expect(error.message).toBe("Reviewer lookup failed (400)");
    expect(error.details.request).toEqual({
      ...request, headers: { accept: "application/json", authorization: "[redacted]", cookie: "[redacted]" }
    });
    expect(error.details.response).toEqual({
      url: "", status: 400, statusText: "Bad Request", redirected: false, text,
      headers: { "content-type": "application/json", "x-vss-e2eid": "correlation-id", "set-cookie": "[redacted]", "x-auth-token": "[redacted]" }
    });
    expect(error.cause).toBe(error.details);
    expect(JSON.stringify(error.details)).not.toContain("private");
  });

  it("preserves the HTTP failure and reports why response text could not be read", async () => {
    const response = new Response("unreadable", { status: 400 });
    vi.spyOn(response, "text").mockRejectedValue(new Error("Connection interrupted"));
    const error = await HttpResponseError.fromResponse("Reviewer lookup failed (400)", request, response);
    expect(error.details.response).toMatchObject({ status: 400, text: null, textReadError: "Connection interrupted" });
    expect(error.message).toBe("Reviewer lookup failed (400)");
  });
});
