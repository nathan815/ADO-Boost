import type { SessionEvent } from "@github/copilot-sdk";

const tokenFields = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"] as const;
type TokenField = typeof tokenFields[number];

export class SessionUsage {
  private selectedModel: string | null = null;
  private readonly models = new Set<string>();
  private readonly seen = new Set<string>();
  private readonly tokens: Record<TokenField, number | null> = {
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0
  };

  readonly record = (event: SessionEvent): void => {
    if (event.type === "session.start") this.selectedModel = event.data.selectedModel ?? null;
    if (event.type === "session.model_change") this.selectedModel = event.data.newModel;
    if (event.type !== "assistant.usage" || this.seen.has(event.id)) return;
    this.seen.add(event.id);
    this.models.add(event.data.model);
    for (const field of tokenFields) {
      const value = event.data[field];
      const previous = this.tokens[field];
      this.tokens[field] = previous !== null && value !== undefined && Number.isSafeInteger(value) && value >= 0
        ? previous + value : null;
    }
  };

  summary(sessionId: string) {
    return {
      sessionId,
      models: this.models.size ? [...this.models] : this.selectedModel ? [this.selectedModel] : [],
      ...(this.seen.size ? this.tokens : { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null })
    };
  }
}
