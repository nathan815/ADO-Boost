import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@github/copilot-sdk";
import { SessionUsage } from "../src/session-usage.js";

function usage(id: string, data: Extract<SessionEvent, { type: "assistant.usage" }>["data"]): SessionEvent {
  return { id, timestamp: "2026-10-21T20:00:00Z", parentId: null, ephemeral: true, type: "assistant.usage", data };
}

describe("Copilot session usage", () => {
  it("aggregates per-call tokens and actual models without counting repeated events twice", () => {
    const tracker = new SessionUsage();
    const first = usage("one", { model: "model-a", inputTokens: 100, outputTokens: 20, cacheReadTokens: 10, cacheWriteTokens: 5 });
    tracker.record(first);
    tracker.record(first);
    tracker.record(usage("two", { model: "model-b", inputTokens: 200, outputTokens: 40, cacheReadTokens: 30, cacheWriteTokens: 0 }));
    expect(tracker.summary("session-1")).toEqual({
      sessionId: "session-1", models: ["model-a", "model-b"], inputTokens: 300, outputTokens: 60,
      cacheReadTokens: 40, cacheWriteTokens: 5, totalNanoAiu: null
    });
  });

  it("aggregates reported AI credit costs once per call without using premium request multipliers", () => {
    const tracker = new SessionUsage();
    const first = usage("one", { model: "model-a", cost: 99, copilotUsage: { totalNanoAiu: 1_250_000_001, tokenDetails: [] } });
    tracker.record(first);
    tracker.record(first);
    tracker.record(usage("two", { model: "model-b", copilotUsage: { totalNanoAiu: 250_000_000, tokenDetails: [] } }));
    expect(tracker.summary("session-1").totalNanoAiu).toBe(1_500_000_001);
    expect(new SessionUsage().summary("new-session").totalNanoAiu).toBeNull();
  });

  it("distinguishes explicitly reported zero credit usage from absent billing telemetry", () => {
    const tracker = new SessionUsage();
    expect(tracker.summary("session-1").totalNanoAiu).toBeNull();
    tracker.record(usage("one", { model: "model-a", copilotUsage: { totalNanoAiu: 0, tokenDetails: [] } }));
    expect(tracker.summary("session-1").totalNanoAiu).toBe(0);
    tracker.record(usage("two", { model: "model-a", cost: 1 }));
    tracker.record(usage("three", { model: "model-a", copilotUsage: { totalNanoAiu: 100, tokenDetails: [] } }));
    expect(tracker.summary("session-1").totalNanoAiu).toBeNull();
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("reports invalid credit usage as unknown: %s", (totalNanoAiu) => {
    const tracker = new SessionUsage();
    tracker.record(usage("one", { model: "model-a", copilotUsage: { totalNanoAiu, tokenDetails: [] } }));
    tracker.record(usage("two", { model: "model-a", copilotUsage: { totalNanoAiu: 100, tokenDetails: [] } }));
    expect(tracker.summary("session-1").totalNanoAiu).toBeNull();
  });

  it("does not return an unsafe accumulated billing total", () => {
    const tracker = new SessionUsage();
    tracker.record(usage("one", { model: "model-a", copilotUsage: { totalNanoAiu: Number.MAX_SAFE_INTEGER, tokenDetails: [] } }));
    tracker.record(usage("two", { model: "model-a", copilotUsage: { totalNanoAiu: 1, tokenDetails: [] } }));
    expect(tracker.summary("session-1").totalNanoAiu).toBeNull();
  });

  it("reports missing or partially reported metrics as unknown, not zero", () => {
    const tracker = new SessionUsage();
    expect(tracker.summary("session-1")).toMatchObject({ models: [], inputTokens: null, outputTokens: null });
    tracker.record(usage("one", { model: "model-a", inputTokens: 100 }));
    tracker.record(usage("two", { model: "model-a", inputTokens: 20, outputTokens: 10 }));
    expect(tracker.summary("session-1")).toMatchObject({
      models: ["model-a"], inputTokens: 120, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null
    });
  });

  it("uses the selected model before usage is available and prefers the model that actually ran", () => {
    const tracker = new SessionUsage();
    tracker.record({
      id: "start", timestamp: "", parentId: null, type: "session.start",
      data: { sessionId: "session-1", version: 1, producer: "copilot", copilotVersion: "test", startTime: "", selectedModel: "default-model" }
    });
    expect(tracker.summary("session-1")).toMatchObject({ models: ["default-model"], inputTokens: null });
    tracker.record({ id: "change", timestamp: "", parentId: null, type: "session.model_change", data: { newModel: "another-model" } });
    expect(tracker.summary("session-1")).toMatchObject({ models: ["another-model"] });
    tracker.record(usage("call", { model: "actual-model", inputTokens: 0, outputTokens: 0 }));
    expect(tracker.summary("session-1")).toMatchObject({ models: ["actual-model"], inputTokens: 0, outputTokens: 0 });
  });
});
