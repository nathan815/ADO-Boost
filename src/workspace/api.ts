import { z } from "zod";
import type { HttpClient } from "../adapters/ado-api";
import { personSchema, prSchema, projectSchema, repositorySchema, threadSchema, type ReadRequest, type WorkspaceContext } from "./protocol";

export class WorkspaceApi {
  constructor(private readonly http: HttpClient, readonly context: WorkspaceContext) {}

  async read(query: ReadRequest, signal: AbortSignal): Promise<unknown> {
    try { return await this.readValidated(query, AbortSignal.any([signal, AbortSignal.timeout(30_000)])); }
    catch (error) {
      if (error instanceof z.ZodError) {
        console.warn("ADO Boost workspace response validation failed", error.issues.slice(0, 3));
        throw new Error("Azure DevOps returned an unsupported response shape. Refresh to retry.");
      }
      throw error;
    }
  }

  private async readValidated(query: ReadRequest, signal: AbortSignal): Promise<unknown> {
    const base = this.context.base;
    if (query.kind === "identity") {
      const data = await this.json(`${base}/_apis/connectionData?connectOptions=1`, signal);
      const identity = z.object({ authenticatedUser: personSchema.extend({
        displayName: z.string().optional(), providerDisplayName: z.string().optional()
      }) }).parse(data.body).authenticatedUser;
      return { id: identity.id, displayName: identity.displayName ?? identity.providerDisplayName ?? "Signed-in user" };
    }
    if (query.kind === "projects") {
      const params = new URLSearchParams({ "api-version": "7.1", "$top": "100" });
      if (query.continuation) params.set("continuationToken", query.continuation);
      const data = await this.json(`${base}/_apis/projects?${params}`, signal);
      const items = z.object({ value: z.array(projectSchema) }).parse(data.body).value;
      return { items, more: Boolean(data.continuation), ...(data.continuation ? { continuation: data.continuation } : {}) };
    }
    if (query.kind === "project") {
      const data = await this.json(`${base}/_apis/projects/${encodeURIComponent(query.project)}?api-version=7.1`, signal);
      return projectSchema.parse(data.body);
    }
    if (query.kind === "repositories") {
      const data = await this.json(`${base}/${encodeURIComponent(query.project)}/_apis/git/repositories?api-version=7.1`, signal);
      return z.object({ value: z.array(repositorySchema) }).parse(data.body).value;
    }
    if (query.kind === "prs") {
      const top = query.top ?? 50;
      const params = new URLSearchParams({
        "api-version": "7.1", "searchCriteria.status": query.status,
        "searchCriteria.minTime": query.since, "searchCriteria.queryTimeRangeType": query.range,
        "$skip": String(query.skip), "$top": String(top)
      });
      if (query.until) params.set("searchCriteria.maxTime", query.until);
      if (query.creator) params.set("searchCriteria.creatorId", query.creator);
      if (query.reviewer) params.set("searchCriteria.reviewerId", query.reviewer);
      const data = await this.json(`${base}/${encodeURIComponent(query.project)}/_apis/git/pullrequests?${params}`, signal);
      const items = z.object({ value: z.array(prSchema) }).parse(data.body).value;
      return { items, more: items.length === top };
    }
    if (query.kind === "threads") {
      const data = await this.json(`${base}/${encodeURIComponent(query.project)}/_apis/git/repositories/${encodeURIComponent(query.repository)}/pullrequests/${query.pr}/threads?api-version=7.1`, signal);
      return z.object({ value: z.array(threadSchema) }).parse(data.body).value;
    }
    const data = await this.json(`${base}/_apis/IdentityPicker/Identities?api-version=7.1-preview.1`, signal, {
      method: "POST", body: JSON.stringify({
        query: query.query, identityTypes: ["user"], operationScopes: ["ims", "source"],
        properties: ["DisplayName"], options: { MinResults: 5, MaxResults: 20 }
      })
    });
    const results = z.object({ results: z.array(z.object({
      identities: z.array(z.object({ localId: z.string().nullish(), originId: z.string(), displayName: z.string().nullish() }))
    })) }).parse(data.body);
    return results.results.flatMap((result) => result.identities).filter((person) => person.displayName)
      .map((person) => ({ id: person.localId ?? person.originId, displayName: person.displayName! }));
  }

  private async json(url: string, signal: AbortSignal, init: RequestInit = {}): Promise<{ body: unknown; continuation: string | null }> {
    for (let attempt = 0; ; attempt++) {
      const response = await this.http.fetch(url, {
        ...init, signal, headers: { Accept: "application/json", "Content-Type": "application/json" }
      });
      if ((response.status === 429 || response.status === 503) && attempt < 2) {
        const header = response.headers.get("Retry-After");
        const seconds = header ? Number(header) : NaN;
        const delay = Number.isFinite(seconds) ? seconds * 1000 : header ? Date.parse(header) - Date.now() : 1000;
        if (delay > 30_000) throw new Error("Azure DevOps is throttling requests. Try refreshing later.");
        await new Promise<void>((resolve, reject) => {
          const abort = () => { clearTimeout(timer); reject(signal.reason); };
          const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, Math.max(1000, delay || 1000));
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        });
        continue;
      }
      if (response.status === 401 || response.redirected || !response.headers.get("content-type")?.includes("json")) {
        throw new Error("Sign in to this Azure DevOps organization, then reopen ADO Boost.");
      }
      if (response.status === 403) throw new Error("Access denied for this Azure DevOps resource.");
      if (!response.ok) throw new Error(`Azure DevOps request failed (${response.status}). Refresh to retry.`);
      return { body: await response.json(), continuation: response.headers.get("x-ms-continuationtoken") };
    }
  }
}
