import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { startWorkspaceService, workspaceSender } from "../src/workspace/background";
import { HOST_PORT, UI_PORT } from "../src/workspace/protocol";

describe("workspace sender boundary", () => {
  const host: chrome.runtime.MessageSender = {
    id: "extension", frameId: 0, url: "https://dev.azure.com/org/Project",
    tab: { id: 7, url: "https://dev.azure.com/org/Project" } as chrome.tabs.Tab
  };
  const ui: chrome.runtime.MessageSender = { ...host, frameId: 4, url: "chrome-extension://extension/workspace.html" };
  it("accepts only a top-frame ADO host and embedded owned extension UI in that tab", () => {
    expect(workspaceSender(host, HOST_PORT, "extension")?.tab).toBe(7);
    expect(workspaceSender(ui, UI_PORT, "extension")?.tab).toBe(7);
    expect(workspaceSender({ ...host, frameId: 4 }, HOST_PORT, "extension")).toBeNull();
    expect(workspaceSender({ ...ui, frameId: 0 }, UI_PORT, "extension")).toBeNull();
  });

  class PortEvent<T> {
    private readonly listeners = new Set<(value: T) => void>();
    addListener = (listener: (value: T) => void) => { this.listeners.add(listener); };
    removeListener = (listener: (value: T) => void) => { this.listeners.delete(listener); };
    emit = (value: T) => { for (const listener of this.listeners) listener(value); };
  }

  class TestPort {
    onMessage = new PortEvent<unknown>();
    onDisconnect = new PortEvent<unknown>();
    postMessage = vi.fn<(message: unknown) => void>();
    disconnect = vi.fn(() => this.onDisconnect.emit(undefined));
    constructor(readonly name: string, readonly sender: chrome.runtime.MessageSender) {}
  }

  afterEach(() => vi.unstubAllGlobals());

  it.each([0, 1, 10])("adds the current project once on open with %s saved projects, preserving selections and the cap", async (count) => {
    const connection = new PortEvent<TestPort>();
    const factory = new IDBFactory();
    vi.stubGlobal("chrome", { runtime: { id: "extension", onConnect: connection } });
    vi.stubGlobal("indexedDB", factory);
    const { WorkspaceStorage } = await import("../src/workspace/storage");
    const storage = new WorkspaceStorage(factory);
    const partition = WorkspaceStorage.partition("org", "me");
    const preferences = { projects: Array.from({ length: count }, (_, id) => ({ id: String(id), name: `Project ${id}` })), follows: [], favorites: [] };
    await storage.preferences(partition, preferences);
    startWorkspaceService();
    const hostPort = new TestPort(HOST_PORT, host);
    const uiPort = new TestPort(UI_PORT, ui);
    hostPort.postMessage.mockImplementation((value) => {
      const message = value as { id: string };
      hostPort.onMessage.emit({ id: message.id, ok: true, data: {
        context: { origin: "https://dev.azure.com", organization: "org", base: "https://dev.azure.com/org" },
        currentProject: { id: "one", name: "One" }, viewer: { id: "me", displayName: "Me" },
        theme: {}, view: "dashboard", subject: null
      } });
    });
    connection.emit(hostPort); connection.emit(uiPort);
    uiPort.onMessage.emit({ id: "open", request: { type: "preferences" } });
    const projects = count === 10 ? preferences.projects : [...preferences.projects, { id: "one", name: "One" }];
    await vi.waitFor(() => expect(uiPort.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: "open", ok: true, data: expect.objectContaining({ preferences: { ...preferences, projects } })
    })));
    expect((await storage.preferences(partition)).projects).toEqual(projects);
    uiPort.onMessage.emit({ id: "recheck", request: { type: "preferences" } });
    await vi.waitFor(() => expect(uiPort.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: "recheck", ok: true, data: expect.objectContaining({ preferences: { ...preferences, projects } })
    })));
    uiPort.onMessage.emit({ id: "deselect", request: { type: "preferences", value: preferences } });
    await vi.waitFor(() => expect(uiPort.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: "deselect", ok: true })));
    uiPort.onMessage.emit({ id: "resume", request: { type: "preferences" } });
    await vi.waitFor(() => expect(uiPort.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: "resume", ok: true, data: expect.objectContaining({ preferences })
    })));
    uiPort.onMessage.emit({ id: "suggestions", request: { type: "workspace-suggestions" } });
    await vi.waitFor(() => expect(uiPort.postMessage).toHaveBeenCalledWith({
      id: "suggestions", ok: true, data: { projects: [], repositories: [] }
    }));
    uiPort.disconnect(); hostPort.disconnect();
  });

  it("forwards frame readiness to its paired host without reading account data or storage", async () => {
    const connection = new PortEvent<TestPort>();
    vi.stubGlobal("chrome", { runtime: { id: "extension", onConnect: connection } });
    startWorkspaceService();
    const hostPort = new TestPort(HOST_PORT, host);
    const uiPort = new TestPort(UI_PORT, ui);
    hostPort.postMessage.mockImplementation((value) => {
      const message = value as { id: string };
      hostPort.onMessage.emit({ id: message.id, ok: true, data: null });
    });
    connection.emit(hostPort); connection.emit(uiPort);
    uiPort.onMessage.emit({ id: "ready", request: { type: "ready" } });
    await vi.waitFor(() => expect(uiPort.postMessage).toHaveBeenCalledWith({ id: "ready", ok: true, data: null }));
    expect(hostPort.postMessage).toHaveBeenCalledExactlyOnceWith({ kind: "ready", id: expect.any(String) });
    uiPort.disconnect(); hostPort.disconnect();
  });

  it("forwards validated route changes only to the workspace paired with that host", () => {
    const connection = new PortEvent<TestPort>();
    vi.stubGlobal("chrome", { runtime: { id: "extension", onConnect: connection } });
    startWorkspaceService();
    const hostPort = new TestPort(HOST_PORT, host);
    const uiPort = new TestPort(UI_PORT, ui);
    connection.emit(hostPort); connection.emit(uiPort);
    const otherSender = { ...host, tab: { id: 8, url: host.url } as chrome.tabs.Tab };
    const otherHost = new TestPort(HOST_PORT, otherSender);
    const otherUi = new TestPort(UI_PORT, { ...ui, tab: otherSender.tab });
    connection.emit(otherHost); connection.emit(otherUi);
    hostPort.onMessage.emit({ kind: "route", view: "people", subject: null });
    expect(uiPort.postMessage).toHaveBeenCalledExactlyOnceWith({ kind: "route", view: "people", subject: null });
    expect(otherUi.postMessage).not.toHaveBeenCalled();
    hostPort.onMessage.emit({ kind: "route", view: "unknown", subject: null });
    hostPort.onMessage.emit({ kind: "route", view: "profile", subject: { displayName: "Invalid" } });
    expect(uiPort.postMessage).toHaveBeenCalledTimes(1);
    uiPort.disconnect(); otherUi.disconnect(); hostPort.disconnect(); otherHost.disconnect();
  });

  it("shares one session check across cache bursts and rechecks lazily after expiry or when resumed", async () => {
    let now = 1;
    const connection = new PortEvent<TestPort>();
    vi.stubGlobal("chrome", { runtime: { id: "extension", onConnect: connection } });
    vi.stubGlobal("indexedDB", new IDBFactory());
    startWorkspaceService(() => now);
    const hostPort = new TestPort(HOST_PORT, host);
    const uiPort = new TestPort(UI_PORT, ui);
    const responses = new PortEvent<unknown>();
    uiPort.postMessage.mockImplementation(responses.emit);
    hostPort.postMessage.mockImplementation((value) => {
      const message = value as { id: string; kind: string };
      hostPort.onMessage.emit({ id: message.id, ok: true, data: message.kind === "session" ? {
        context: { origin: "https://dev.azure.com", organization: "org", base: "https://dev.azure.com/org" },
        viewer: { id: "me", displayName: "Me" }, theme: {}, view: "profile", subject: null
      } : null });
    });
    connection.emit(hostPort); connection.emit(uiPort);
    await Promise.all(Array.from({ length: 120 }, async (_, index) => {
      const id = `cache-${index}`;
      const response = new Promise<void>((resolve) => {
        const listener = (message: unknown) => {
          if (message && typeof message === "object" && "id" in message && message.id === id) {
            expect(message).toMatchObject({ ok: true });
            responses.removeListener(listener);
            resolve();
          }
        };
        responses.addListener(listener);
      });
      uiPort.onMessage.emit({ id, request: { type: "cache", key: String(index), value: index } });
      return response;
    }));
    expect(hostPort.postMessage.mock.calls.filter(([message]) => (message as { kind: string }).kind === "session")).toHaveLength(1);
    now += 60_000;
    expect(hostPort.postMessage).toHaveBeenCalledTimes(1);
    uiPort.onMessage.emit({ id: "expired", request: { type: "cache", key: "0" } });
    await vi.waitFor(() => expect(uiPort.postMessage).toHaveBeenCalledWith({ id: "expired", ok: true, data: 0 }));
    expect(hostPort.postMessage).toHaveBeenCalledTimes(2);
    hostPort.onMessage.emit({ kind: "verify-session" });
    await vi.waitFor(() => expect(hostPort.postMessage).toHaveBeenCalledTimes(3));
    uiPort.disconnect(); hostPort.disconnect();
  });

  it("revalidates the account before serving storage and rejects account changes on an existing connection", async () => {
    const connection = new PortEvent<TestPort>();
    vi.stubGlobal("chrome", { runtime: { id: "extension", onConnect: connection } });
    vi.stubGlobal("indexedDB", new IDBFactory());
    startWorkspaceService();
    const sender: chrome.runtime.MessageSender = {
      id: "extension", url: "https://dev.azure.com/org/Project", frameId: 0,
      tab: { id: 1, url: "https://dev.azure.com/org/Project" } as chrome.tabs.Tab
    };
    const host = new TestPort(HOST_PORT, sender);
    let viewer = "first";
    host.postMessage.mockImplementation((value) => {
      const message = value as { id: string; kind: string };
      host.onMessage.emit({ id: message.id, ok: true, data: {
        context: { origin: "https://dev.azure.com", organization: "org", base: "https://dev.azure.com/org" },
        viewer: { id: viewer, displayName: viewer }, theme: {}, view: "dashboard", subject: null
      } });
    });
    connection.emit(host);
    const ui = new TestPort(UI_PORT, { ...sender, frameId: 2, url: "chrome-extension://extension/workspace.html" });
    connection.emit(ui);
    ui.onMessage.emit({ id: "save", request: { type: "preferences", value: {
      projects: [{ id: "p", name: "Private project" }], follows: [], favorites: []
    } } });
    await vi.waitFor(() => expect(ui.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: "save", ok: true })));
    viewer = "second";
    ui.onMessage.emit({ id: "changed", request: { type: "preferences" } });
    await vi.waitFor(() => expect(ui.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: "changed", ok: false, error: expect.stringContaining("account changed") })));
    ui.onMessage.emit({ id: "blocked-cache", request: { type: "cache", key: "private-data" } });
    await vi.waitFor(() => expect(ui.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: "blocked-cache", ok: false, error: expect.stringContaining("account changed") })));
    expect(host.postMessage).toHaveBeenCalledTimes(2);
    ui.disconnect();
    const reopened = new TestPort(UI_PORT, { ...sender, frameId: 3, url: "chrome-extension://extension/workspace.html" });
    connection.emit(reopened);
    reopened.onMessage.emit({ id: "new-account", request: { type: "preferences" } });
    await vi.waitFor(() => expect(reopened.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: "new-account", ok: true, data: expect.objectContaining({ preferences: { projects: [], follows: [], favorites: [] } })
    })));
    reopened.disconnect();
    host.disconnect();
  });
  it("rejects external senders, arbitrary frames, mismatched organizations, and standalone pages", () => {
    expect(workspaceSender({ ...host, id: "other" }, HOST_PORT, "extension")).toBeNull();
    expect(workspaceSender({ ...ui, url: "https://dev.azure.com/org" }, UI_PORT, "extension")).toBeNull();
    expect(workspaceSender({ ...host, url: "https://dev.azure.com/other" }, HOST_PORT, "extension")).toBeNull();
    expect(workspaceSender({ id: "extension", url: "chrome-extension://extension/workspace.html" }, UI_PORT, "extension")).toBeNull();
    expect(workspaceSender({ ...ui, url: "not a url" }, UI_PORT, "extension")).toBeNull();
  });
});
