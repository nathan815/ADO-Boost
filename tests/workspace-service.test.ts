import { describe, expect, it, vi } from "vitest";
import { WorkspaceQueries, type WorkspaceTransport } from "../src/workspace/client";
import { boundedMap, WorkspaceService } from "../src/workspace/service";
import { prSchema, type Page, type WorkspacePr } from "../src/workspace/protocol";

const pr = (id: number, project = "p") => prSchema.parse({
  pullRequestId: id, title: `PR ${id}`, status: "active", creationDate: "2026-01-01T00:00:00Z",
  repository: { id: "r", name: "Repo", project: { id: project, name: project } },
  createdBy: { id: "author", displayName: "Author" }, reviewers: []
});

describe("workspace aggregation", () => {
  it("bounds concurrency and stops scheduling after cancellation", async () => {
    let running = 0;
    let maximum = 0;
    const controller = new AbortController();
    const result = await boundedMap([1, 2, 3, 4, 5], async (value) => {
      running++; maximum = Math.max(maximum, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running--; return value * 2;
    }, controller.signal, 2);
    expect(maximum).toBe(2);
    expect(result).toEqual([2, 4, 6, 8, 10]);
    controller.abort();
    await expect(boundedMap([1], async (value) => value, controller.signal)).rejects.toThrow();
  });

  it("coalesces identical reads and propagates cache write failures", async () => {
    const request = vi.fn().mockImplementation(async (value) => value.type === "read" ? { items: [], more: false } : null);
    const transport = { request } as WorkspaceTransport;
    const queries = new WorkspaceQueries(transport);
    await Promise.all([queries.read({ kind: "projects" }), queries.read({ kind: "projects" })]);
    expect(request.mock.calls.filter(([value]) => value.type === "read")).toHaveLength(1);
    request.mockImplementation(async (value) => {
      if (value.type === "cache" && value.value !== undefined) throw new Error("Quota exceeded");
      return value.type === "read" ? { items: [], more: false } : null;
    });

    await expect(queries.read({ kind: "projects" }, true)).rejects.toThrow("Quota exceeded");
  });

  it("loads large repository catalogs on demand without trying to persist a giant cache entry", async () => {
    const request = vi.fn().mockResolvedValue([]);
    await new WorkspaceQueries({ request }).read({ kind: "repositories", project: "Project" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ type: "read", query: { kind: "repositories", project: "Project" } });
  });

  it("preserves project failures and distinct PR identities without treating failures as zero", async () => {
    const queries = new WorkspaceQueries({
      request: vi.fn().mockImplementation(async (request) => {
        if (request.type === "cache") return null;
        if (request.query.project === "denied") throw new Error("Access denied");
        return { items: [pr(1, request.query.project)], more: false } satisfies Page<WorkspacePr>;
      })
    });
    const result = await new WorkspaceService(queries).prs({ id: "me", displayName: "Me" },
      [{ id: "a", name: "a" }, { id: "b", name: "b" }, { id: "denied", name: "denied" }],
      "2025-01-01T00:00:00Z", 0, "all", new AbortController().signal);
    expect(result.created).toHaveLength(2);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain("Access denied");
  });

  it("queries closure time for older PR completions and rebuilds mutable feed events", async () => {
    let completed = true;
    const requests: string[] = [];
    const queries = new WorkspaceQueries({
      request: vi.fn().mockImplementation(async (request) => {
        if (request.type === "cache") return null;
        requests.push(request.query.range);
        const item = pr(1);
        item.creationDate = "2025-01-01T00:00:00Z";
        if (completed) { item.status = "completed"; item.closedDate = "2026-02-01T00:00:00Z"; }
        return { items: request.query.range === "closed" && completed ? [item] : [], more: false };
      })
    });
    const service = new WorkspaceService(queries);
    const args = [[{ id: "author", displayName: "Author" }], [{ id: "p", name: "p" }], "2026-01-01T00:00:00Z", 0, new AbortController().signal, true] as const;
    const first = await service.feed(...args);
    expect(requests).toContain("closed");
    expect(first.events.map((event) => event.kind)).toEqual(["completed"]);
    completed = false;
    expect((await service.feed(...args)).events).toEqual([]);
  });
});
