import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeCopilotClient } from "../src/background/native-copilot";
import { parseCopilotGroupResult, parseCopilotHealth } from "../src/core/copilot-gateway";

type Request = { id: string; type: string };

function setup() {
  const messages: Request[] = [];
  let receive!: (value: unknown) => void;
  let disconnected!: () => void;
  const disconnect = vi.fn();
  const port = {
    postMessage: vi.fn((value: Request) => { messages.push(value); }),
    disconnect,
    onMessage: { addListener: (listener: typeof receive) => { receive = listener; } },
    onDisconnect: { addListener: (listener: typeof disconnected) => { disconnected = listener; } }
  };
  const runtime = {
    connectNative: vi.fn(() => port as unknown as chrome.runtime.Port),
    getURL: () => "chrome-extension://test-id/",
    lastError: undefined as chrome.runtime.LastError | undefined
  };
  const client = new NativeCopilotClient(runtime, 1000);
  const respond = (type: string, data: unknown, ok = true) => {
    const request = [...messages].reverse().find((message) => message.type === type)!;
    receive({ id: request.id, ok, data, error: { message: "Host failed" } });
  };
  return { client, runtime, port, messages, respond, receive: (value: unknown) => receive(value), disconnected: () => disconnected() };
}

afterEach(() => vi.useRealTimers());

describe("native companion client", () => {
  it("treats account discovery and selection as bounded settings requests, not inference", async () => {
    const { client, messages, respond } = setup();
    const accounts = client.request("accounts");
    expect(client.hasActiveInference).toBe(false);
    respond("hello", { version: 1 });
    await vi.waitFor(() => expect(messages).toHaveLength(2));
    respond("accounts", { accounts: [], selected: null });
    await expect(accounts).resolves.toEqual({ accounts: [], selected: null });
    const select = client.request("select-account", { account: { host: "https://github.com", login: "reviewer" } });
    expect(client.hasActiveInference).toBe(false);
    await vi.waitFor(() => expect(messages).toHaveLength(3));
    respond("select-account", { accounts: [], selected: null });
    await select;
    client.disconnect();
  });

  it("handshakes once and maps authenticated/unauthenticated health without inference", async () => {
    const { client, runtime, messages, respond } = setup();
    const health = client.request("health");
    expect(messages).toMatchObject([{ type: "hello", version: 1 }]);
    respond("hello", { version: 1 });
    await vi.waitFor(() => expect(messages).toHaveLength(2));
    respond("health", { auth: { isAuthenticated: true, login: "reviewer" } });
    expect(parseCopilotHealth(await health)).toEqual({ connected: true, authenticated: true, login: "reviewer" });
    const again = client.request("health");
    await vi.waitFor(() => expect(messages).toHaveLength(3));
    respond("health", { auth: { isAuthenticated: false, statusMessage: "Sign in" } });
    expect(parseCopilotHealth(await again)).toEqual({ connected: true, authenticated: false, detail: "Sign in" });
    expect(runtime.connectNative).toHaveBeenCalledOnce();
    expect(messages.map((message) => message.type)).toEqual(["hello", "health", "health"]);
    client.disconnect();
  });

  it("rejects incompatible handshakes and resets the connection", async () => {
    const { client, respond, port } = setup();
    const request = client.request("health");
    const failure = expect(request).rejects.toThrow("incompatible");
    respond("hello", { version: 99 });
    await failure;
    expect(port.disconnect).toHaveBeenCalledOnce();
  });

  it("shares a concurrent handshake and rejects synchronous send failures", async () => {
    const { client, messages, respond, port, runtime } = setup();
    const first = client.request("health");
    const second = client.request("health");
    expect(runtime.connectNative).toHaveBeenCalledOnce();
    expect(messages).toHaveLength(1);
    port.postMessage.mockImplementationOnce(() => { throw new Error("Port is closed"); });
    const failure = expect(first).rejects.toMatchObject({
      message: "Can't connect to the ADO Boost companion. Run ado-boost doctor to check the installation, then try again.",
      cause: new Error("Port is closed")
    });
    respond("hello", { version: 1 });
    await failure;
    await vi.waitFor(() => expect(messages).toHaveLength(2));
    respond("health", { auth: { isAuthenticated: true } });
    await expect(second).resolves.toMatchObject({ auth: { isAuthenticated: true } });
    client.disconnect();
  });

  it.each(["Specified native messaging host not found.", "Native host not found", "Native application not found"])("explains how to install or register a missing companion for %s", async (message) => {
    vi.useFakeTimers();
    const { client, runtime, disconnected } = setup();
    const request = client.request("health");
    const failure = expect(request).rejects.toMatchObject({
      message: "ADO Boost companion not found. Install the companion or run ado-boost setup to register it with your browser, then refresh this page.",
      cause: message
    });
    runtime.lastError = { message };
    disconnected();
    await failure;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["Native host has exited.", "Access to the specified native messaging host is forbidden.", undefined])("gives troubleshooting guidance when the companion disconnects: %s", async (message) => {
    vi.useFakeTimers();
    const { client, runtime, disconnected } = setup();
    const request = client.request("health");
    const failure = expect(request).rejects.toMatchObject({
      message: "Can't connect to the ADO Boost companion. Run ado-boost doctor to check the installation, then try again.",
      cause: message
    });
    runtime.lastError = message ? { message } : undefined;
    disconnected();
    await failure;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("explains synchronous connection failures and allows retrying", async () => {
    const { client, runtime, messages, respond } = setup();
    runtime.connectNative.mockImplementationOnce(() => { throw new Error("Specified native messaging host not found."); });
    await expect(client.request("health")).rejects.toThrow("Install the companion or run ado-boost setup");
    const retry = client.request("health");
    respond("hello", { version: 1 });
    await vi.waitFor(() => expect(messages).toHaveLength(2));
    respond("health", { auth: { isAuthenticated: true } });
    await expect(retry).resolves.toMatchObject({ auth: { isAuthenticated: true } });
    client.disconnect();
  });

  it("times out a stalled handshake and allows a later reconnect", async () => {
    vi.useFakeTimers();
    const { client, runtime, port } = setup();
    const request = client.request("health");
    const failure = expect(request).rejects.toThrow("hello request timed out");
    await vi.advanceTimersByTimeAsync(1000);
    await failure;
    expect(port.disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    const retry = client.request("health");
    const rejected = expect(retry).rejects.toThrow("disabled or disconnected");
    expect(runtime.connectNative).toHaveBeenCalledTimes(2);
    client.disconnect();
    await rejected;
  });

  it("times out health without cancelling an active chat and disconnects after the chat becomes idle", async () => {
    vi.useFakeTimers();
    const { client, messages, respond, port } = setup();
    const health = client.request("health");
    const failure = expect(health).rejects.toThrow("health request timed out");
    respond("hello", { version: 1 });
    await vi.advanceTimersByTimeAsync(0);
    const chat = client.request("chat", { question: "Why?" });
    await vi.advanceTimersByTimeAsync(0);
    expect(messages.map((message) => message.type)).toEqual(["hello", "health", "chat"]);
    await vi.advanceTimersByTimeAsync(121_000);
    await failure;
    expect(port.disconnect).not.toHaveBeenCalled();
    respond("chat", { answer: "Because." });
    await expect(chat).resolves.toEqual({ answer: "Because." });
    await vi.advanceTimersByTimeAsync(119_999);
    expect(port.disconnect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(port.disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resets the two-minute idle timeout after a new request", async () => {
    vi.useFakeTimers();
    const { client, respond, port } = setup();
    const first = client.request("health");
    respond("hello", { version: 1 });
    await vi.advanceTimersByTimeAsync(0);
    respond("health", { auth: { isAuthenticated: true } });
    await first;
    await vi.advanceTimersByTimeAsync(60_000);
    const second = client.request("health");
    await vi.advanceTimersByTimeAsync(0);
    respond("health", { auth: { isAuthenticated: true } });
    await second;
    await vi.advanceTimersByTimeAsync(119_999);
    expect(port.disconnect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(port.disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects host failures, ignores unknown responses, and cancels pending work on disconnect", async () => {
    const { client, respond, receive, messages } = setup();
    const health = client.request("health");
    respond("hello", { version: 1 });
    await vi.waitFor(() => expect(messages).toHaveLength(2));
    receive({ id: "unknown", ok: true });
    const failure = expect(health).rejects.toThrow("Host failed");
    respond("health", null, false);
    await failure;
    const chat = client.request("chat");
    const cancelled = expect(chat).rejects.toThrow("disconnected");
    await vi.waitFor(() => expect(messages).toHaveLength(3));
    client.disconnect();
    await cancelled;
  });

  it("rejects malformed health responses rather than treating them as signed out", () => {
    expect(() => parseCopilotHealth({})).toThrow();
    expect(() => parseCopilotHealth({ auth: { isAuthenticated: "yes" } })).toThrow();
  });

  it("retains validated companion diagnostics from health without requiring newer hosts", () => {
    expect(parseCopilotHealth({
      protocolVersion: 1, companion: { version: "2.3.4", pid: 1234, uptimeSeconds: 0 }, sdk: { version: "1.2.3" },
      auth: { isAuthenticated: true, login: "reviewer", host: "https://github.com" }
    })).toEqual({
      connected: true, authenticated: true, login: "reviewer", host: "https://github.com",
      protocolVersion: 1, companion: { version: "2.3.4", pid: 1234, uptimeSeconds: 0 }, cliVersion: "1.2.3"
    });
    expect(parseCopilotHealth({ auth: { isAuthenticated: false }, companion: { pid: 1234, uptimeSeconds: 10 } }))
      .toEqual({ connected: true, authenticated: false, companion: { pid: 1234, uptimeSeconds: 10 } });
    for (const companion of [{ pid: -1, uptimeSeconds: 0 }, { pid: "1234", uptimeSeconds: 0 }, { pid: 1234, uptimeSeconds: -1 }, { pid: 1234, uptimeSeconds: 0.5 }]) {
      expect(() => parseCopilotHealth({ auth: { isAuthenticated: true }, companion })).toThrow();
    }
  });

  it("validates grouping session usage while preserving zero and unknown counters", () => {
    const session = { sessionId: "session-1", models: ["actual-model"], inputTokens: 0, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: 0 };
    expect(parseCopilotGroupResult({ groups: [], session, cached: true })).toEqual({ groups: [], session, generation: null, cached: true });
    expect(parseCopilotGroupResult({ groups: [] })).toEqual({ groups: [], session: null, generation: null, cached: false });
    for (const inputTokens of [-1, 0.5, NaN, Infinity, "100"]) {
      expect(() => parseCopilotGroupResult({ groups: [], session: { ...session, inputTokens } })).toThrow();
    }
    const generation = { iterationId: 3, generatedAt: "2026-10-21T20:00:00.000Z" };
    expect(parseCopilotGroupResult({ groups: [], generation }).generation).toEqual(generation);
    expect(() => parseCopilotGroupResult({ groups: [], generation: { ...generation, generatedAt: "yesterday" } })).toThrow();
    expect(() => parseCopilotGroupResult({ groups: [], generation: { ...generation, iterationId: 0 } })).toThrow();
  });

  it("preserves optional AI credit telemetry and rejects invalid billing totals", () => {
    const session = { sessionId: "session-1", models: ["model"], inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null };
    for (const totalNanoAiu of [0, 1, 1_250_000_000, null]) {
      expect(parseCopilotGroupResult({ groups: [], session: { ...session, totalNanoAiu } }).session?.totalNanoAiu).toBe(totalNanoAiu);
    }
    expect(parseCopilotGroupResult({ groups: [], session }).session?.totalNanoAiu).toBeUndefined();
    for (const totalNanoAiu of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "100"]) {
      expect(() => parseCopilotGroupResult({ groups: [], session: { ...session, totalNanoAiu } })).toThrow();
    }
  });

  it("tracks inference waiting for the handshake so disabling features can cancel it", async () => {
    const { client } = setup();
    const chat = client.request("chat");
    const cancelled = expect(chat).rejects.toThrow("disabled or disconnected");
    expect(client.hasActiveInference).toBe(true);
    client.disconnect();
    await cancelled;
    expect(client.hasActiveInference).toBe(false);
  });
});
