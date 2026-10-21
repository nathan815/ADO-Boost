import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AdoApi } from "../src/adapters/ado-api";
import { NativeCopilotClient } from "../src/background/native-copilot";
import { defaultSettings } from "../src/features/registry";
import { SETTINGS_KEY } from "../src/features/settings-service";
import type { PullRequestContext } from "../src/core/types";
import { parseCopilotGroupResult } from "../src/core/copilot-gateway";

describe("background Copilot grouping results", () => {
  const context: PullRequestContext = {
    origin: "https://dev.azure.com", organization: "org", project: "project", repository: "repo",
    pullRequestId: 7, repositoryId: "repo-id", title: "PR", reviewer: { id: "me", displayName: "Me" },
    identity: "comparison", sourceCommit: "source", targetCommit: "target", mergeBaseCommit: "base", iterationId: 1
  };
  const cacheKey = `copilot-groups:${context.identity}`;
  const values = new Map<string, unknown>();
  const groups = [{ title: "Code", rationale: "Related changes", paths: ["/file.ts"] }];
  const session = { sessionId: "session-1", models: ["reported-model"], inputTokens: 100, outputTokens: 20, cacheReadTokens: null, cacheWriteTokens: 0 };
  let listener!: (message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => unknown;
  const native = vi.spyOn(NativeCopilotClient.prototype, "request");
  const getContext = vi.spyOn(AdoApi.prototype, "getContext");

  beforeAll(async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        id: "test-extension", getURL: (path: string) => `chrome-extension://test-extension/${path}`,
        onMessage: { addListener: (handler: typeof listener) => { listener = handler; } }
      },
      storage: {
        local: {
          get: async (key: string) => values.has(key) ? { [key]: values.get(key) } : {},
          set: async (entries: Record<string, unknown>) => { for (const [key, value] of Object.entries(entries)) values.set(key, value); }
        },
        onChanged: { addListener: vi.fn() }
      }
    });
    await import("../src/background/index");
  });
  beforeEach(() => {
    values.clear();
    const settings = defaultSettings();
    settings.features.copilotSemanticGroups = true;
    values.set(SETTINGS_KEY, settings);
    native.mockReset();
    getContext.mockResolvedValue(context);
  });
  afterAll(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function request({ regenerate = false, cacheOnly = false } = {}): Promise<unknown> {
    return send(cacheOnly ? "cached-semantic-groups" : "semantic-groups", {
      context, files: [{ path: "/file.ts" }], ...(!cacheOnly ? { excerpts: [], regenerate } : {})
    });
  }

  function send(kind: string, payload: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve) => listener(
      { channel: "adopp-copilot", kind, payload },
      {
        id: "test-extension",
        tab: {
          url: "https://dev.azure.com/org/project/_git/repo/pullrequest/7",
          index: 0, windowId: 1, groupId: -1, pinned: false, highlighted: false, active: true,
          frozen: false, incognito: false, selected: true, discarded: false, autoDiscardable: true
        }
      },
      resolve
    ));
  }

  it("preserves native session details in storage and distinguishes a cache hit from inference", async () => {
    native.mockResolvedValue({ groups, session, omittedPaths: [] });
    await expect(request()).resolves.toEqual({ ok: true, data: { groups, session, cached: false, generation: { iterationId: 1, generatedAt: expect.any(String) } } });
    const written = parseCopilotGroupResult(values.get(cacheKey));
    expect(Number.isFinite(Date.parse(written.generation!.generatedAt))).toBe(true);
    await expect(request()).resolves.toEqual({ ok: true, data: { ...written, cached: true } });
    expect(native).toHaveBeenCalledOnce();
    native.mockResolvedValue({ groups, session: { ...session, sessionId: "session-2", inputTokens: 25 } });
    await expect(request({ regenerate: true })).resolves.toMatchObject({ ok: true, data: { cached: false, session: { sessionId: "session-2", inputTokens: 25 } } });
    expect(native).toHaveBeenCalledTimes(2);
  });

  it("reads legacy cached arrays without inventing a model or spending tokens", async () => {
    values.set(cacheKey, groups);
    await expect(request()).resolves.toEqual({ ok: true, data: { groups, session: null, generation: null, cached: true } });
    expect(native).not.toHaveBeenCalled();
  });

  it("accepts older companions that do not report session usage", async () => {
    native.mockResolvedValue({ groups });
    await expect(request()).resolves.toMatchObject({ ok: true, data: { groups, session: null, cached: false, generation: { iterationId: 1, generatedAt: expect.any(String) } } });
  });

  it("rejects invalid usage rather than caching it as a successful generation", async () => {
    native.mockResolvedValue({ groups, session: { ...session, inputTokens: -1 } });
    await expect(request()).resolves.toMatchObject({ ok: false, error: expect.any(String) });
    expect(values.has(cacheKey)).toBe(false);
  });

  it("continues to validate cached paths against the active comparison", async () => {
    values.set(cacheKey, [{ ...groups[0], paths: ["/unknown.ts"] }]);
    await expect(request()).resolves.toMatchObject({ ok: false, error: "Copilot returned unknown path /unknown.ts" });
    expect(native).not.toHaveBeenCalled();
  });

  it("returns a cache miss without inference or excerpts even when automatic generation is enabled", async () => {
    const settings = defaultSettings();
    settings.features.copilotSemanticGroups = true;
    settings.features.autoGenerateCopilotGroups = true;
    values.set(SETTINGS_KEY, settings);
    await expect(request({ cacheOnly: true })).resolves.toEqual({ ok: true, data: null });
    expect(native).not.toHaveBeenCalled();
  });

  it("retrieves cached groups without confirmation or automatic-generation permission", async () => {
    values.set(cacheKey, { groups, session });
    await expect(request({ cacheOnly: true })).resolves.toEqual({ ok: true, data: { groups, session, generation: null, cached: true } });
    expect(native).not.toHaveBeenCalled();
  });

  it("does not reuse cached groups from an outdated comparison", async () => {
    values.set(cacheKey, { groups, session });
    getContext.mockResolvedValue({ ...context, identity: "new-comparison" });
    await expect(request({ cacheOnly: true })).resolves.toMatchObject({ ok: false, error: expect.stringContaining("pull request changed") });
    expect(native).not.toHaveBeenCalled();
  });

  it("keeps sidebar diagnostics disabled when the required Copilot feature is disabled", async () => {
    const settings = defaultSettings();
    settings.features.copilotChat = true;
    values.set(SETTINGS_KEY, settings);
    native.mockResolvedValue({ auth: { isAuthenticated: true } });
    await expect(send("health", { context })).resolves.toMatchObject({ ok: false, error: expect.any(String) });
    expect(native).not.toHaveBeenCalled();
  });
});
