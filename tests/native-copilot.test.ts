import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeCopilotClient } from "../src/background/native-copilot";
import { parseCopilotHealth } from "../src/core/copilot-gateway";

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
    const failure = expect(first).rejects.toThrow("Port is closed");
    respond("hello", { version: 1 });
    await failure;
    await vi.waitFor(() => expect(messages).toHaveLength(2));
    respond("health", { auth: { isAuthenticated: true } });
    await expect(second).resolves.toMatchObject({ auth: { isAuthenticated: true } });
    client.disconnect();
  });

  it("surfaces missing native host errors and clears pending timers", async () => {
    vi.useFakeTimers();
    const { client, runtime, disconnected } = setup();
    const request = client.request("health");
    const failure = expect(request).rejects.toThrow("not found");
    runtime.lastError = { message: "Native host not found" };
    disconnected();
    await failure;
    expect(vi.getTimerCount()).toBe(0);
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
    await vi.advanceTimersByTimeAsync(31_000);
    await failure;
    expect(port.disconnect).not.toHaveBeenCalled();
    respond("chat", { answer: "Because." });
    await expect(chat).resolves.toEqual({ answer: "Because." });
    await vi.advanceTimersByTimeAsync(30_000);
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
