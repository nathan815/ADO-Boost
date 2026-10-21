import type { FileStat, PullRequestContext, SemanticGroupProposal } from "./types";
import { z } from "zod";

export interface CopilotHealth {
  connected: boolean;
  authenticated: boolean;
  login?: string;
  detail?: string;
}

const tokenCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const sessionSchema = z.object({
  sessionId: z.string().min(1).max(200),
  models: z.array(z.string().min(1).max(200)).max(100),
  inputTokens: tokenCountSchema,
  outputTokens: tokenCountSchema,
  cacheReadTokens: tokenCountSchema,
  cacheWriteTokens: tokenCountSchema
});
const groupResultSchema = z.object({
  groups: z.array(z.object({ title: z.string(), rationale: z.string(), paths: z.array(z.string()) })),
  session: sessionSchema.nullish(),
  generation: z.object({ iterationId: z.number().int().positive(), generatedAt: z.iso.datetime({ offset: true }) }).nullish(),
  cached: z.boolean().optional()
});

export interface CopilotGroupResult {
  groups: SemanticGroupProposal[];
  session: z.infer<typeof sessionSchema> | null;
  generation?: { iterationId: number; generatedAt: string } | null;
  cached: boolean;
}

export function parseCopilotGroupResult(value: unknown): CopilotGroupResult {
  const data = groupResultSchema.parse(value);
  return { groups: data.groups, session: data.session ?? null, generation: data.generation ?? null, cached: data.cached ?? false };
}

export function parseCopilotHealth(value: unknown): CopilotHealth {
  const data = z.object({
    auth: z.object({
      isAuthenticated: z.boolean(),
      login: z.string().optional(),
      statusMessage: z.string().optional()
    })
  }).parse(value);
  return {
    connected: true,
    authenticated: data.auth.isAuthenticated,
    ...(data.auth.login ? { login: data.auth.login } : {}),
    ...(data.auth.statusMessage ? { detail: data.auth.statusMessage } : {})
  };
}
export interface CopilotGateway {
  health(context: PullRequestContext): Promise<CopilotHealth>;
  cachedSemanticGroups(context: PullRequestContext, files: FileStat[]): Promise<CopilotGroupResult | null>;
  semanticGroups(context: PullRequestContext, files: FileStat[], excerpts: CopilotExcerpt[], regenerate?: boolean): Promise<CopilotGroupResult>;
  chat(context: PullRequestContext, files: FileStat[], excerpts: CopilotExcerpt[], question: string): Promise<string>;
}

export interface CopilotExcerpt {
  path: string;
  comparison: string;
  omitted: boolean;
  text: string;
}

export class RuntimeCopilotGateway implements CopilotGateway {
  health(context: PullRequestContext): Promise<CopilotHealth> {
    return this.send("health", { context });
  }

  async cachedSemanticGroups(context: PullRequestContext, files: FileStat[]): Promise<CopilotGroupResult | null> {
    const data: unknown = await this.send("cached-semantic-groups", { context, files: summarize(files) });
    return data === null ? null : parseCopilotGroupResult(data);
  }

  async semanticGroups(context: PullRequestContext, files: FileStat[], excerpts: CopilotExcerpt[], regenerate = false): Promise<CopilotGroupResult> {
    return parseCopilotGroupResult(await this.send("semantic-groups", { context, files: summarize(files), excerpts, regenerate }));
  }

  chat(context: PullRequestContext, files: FileStat[], excerpts: CopilotExcerpt[], question: string): Promise<string> {
    return this.send("chat", { context, files: summarize(files), excerpts, question });
  }

  private async send<T>(kind: string, payload: unknown): Promise<T> {
    const response = await chrome.runtime.sendMessage({ channel: "adopp-copilot", kind, payload }) as { ok: true; data: T } | { ok: false; error: string };
    if (!response.ok) throw new Error(response.error);
    return response.data;
  }
}

function summarize(files: FileStat[]): Array<{ path: string; changeType: string; additions: number | null; deletions: number | null }> {
  return files.map(({ path, changeType, additions, deletions }) => ({ path, changeType, additions, deletions }));
}
