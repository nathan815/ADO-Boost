import type { FileStat, PullRequestContext, SemanticGroupProposal } from "./types";

export interface CopilotHealth {
  connected: boolean;
  authenticated: boolean;
  login?: string;
  detail?: string;
}

export interface CopilotGateway {
  health(context: PullRequestContext): Promise<CopilotHealth>;
  semanticGroups(context: PullRequestContext, files: FileStat[], excerpts: CopilotExcerpt[], regenerate?: boolean): Promise<SemanticGroupProposal[]>;
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

  semanticGroups(context: PullRequestContext, files: FileStat[], excerpts: CopilotExcerpt[], regenerate = false): Promise<SemanticGroupProposal[]> {
    return this.send("semantic-groups", { context, files: summarize(files), excerpts, regenerate });
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
