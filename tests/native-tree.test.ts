// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NativeTreeAdapter } from "../src/native-tree/adapter";
import { NativeTreeClient } from "../src/native-tree/client";
import { discoverHost } from "../src/native-tree/host";
import type { HostReact, NativeChanges, NativeColumn, NativeElement, NativeHost } from "../src/native-tree/host";
import { CHANNEL, commandSchema, configurationSchema, matchesFilters, record } from "../src/native-tree/protocol";
import type { TreeConfiguration, TreeFile } from "../src/native-tree/protocol";

const react: HostReact = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  cloneElement: (element, props, ...children) => ({
    ...element, props: { ...element.props, ...props, ...(children.length ? { children } : {}) }
  }),
  isValidElement: (value: unknown): value is NativeElement => record(value) && "type" in value && record(value.props)
};

function file(path: string, overrides: Partial<TreeFile> = {}): TreeFile {
  return { path, trackingId: 1, changeType: "edit", additions: 3, deletions: 1, state: "exact", generated: false, lockfile: false, ...overrides };
}

function configuration(files = [file("/one/app.ts"), file("/two/app.js")]): TreeConfiguration {
  return {
    channel: CHANNEL, kind: "configure", session: "16748ae6-f0a9-4dad-ac76-88e2bafc32c1",
    page: "https://dev.azure.com/org/project/_git/repo/pullrequest/7",
    comparison: { iteration: 3, source: "source", base: "base" },
    files, countsEnabled: true,
    filters: { changeKind: "all", extension: "all", hideGenerated: false, hideLockfiles: false }
  };
}

function fixture(config = configuration()) {
  const entries: NativeChanges["changeEntries"] = config.files.map((f) => ({ item: { path: f.path } }));
  const raw = { changeEntries: entries, iterationId: 3, baseIterationId: 0, nextSkip: 42 };
  const listeners = new Set<() => void>();
  let processed: NativeChanges | undefined;
  let nativeKeyword = "";
  const observable = {
    value: { sourceVersion: { version: "source" }, targetVersion: { version: "base" }, totalChanges: entries.length },
    subscribe: (listener: () => void) => { listeners.add(listener); },
    unsubscribe: (listener: () => void) => { listeners.delete(listener); }
  };
  class View {
    getFilesFilter() { return { hasChangesToReset: () => Boolean(nativeKeyword) }; }
    changes = observable;
    selectedIterationId = { value: 3 };
    baseIterationId = { value: 0 };
    iterationChangesCache: Record<string, NativeChanges> = { "3-0": raw };
    changesCurrentKey = "";
    processChanges(changes: NativeChanges | undefined) {
      processed = changes;
      return { ...observable.value, totalChanges: changes?.changeEntries.length ?? 0 };
    }
    updateChanges(changes: NativeChanges | undefined) {
      const key = `native:${changes?.changeEntries.length}:${nativeKeyword}`;
      if (this.changesCurrentKey === key) return;
      const filtered = changes && { ...changes, changeEntries: changes.changeEntries.filter((e) => (e.item.path || e.originalPath || "").includes(nativeKeyword)) };
      observable.value = this.processChanges(filtered);
      this.changesCurrentKey = key;
      for (const listener of listeners) listener();
    }
  }
  const view = new View();
  const column: NativeColumn = {
    id: "name",
    renderCell: () => react.createElement("ExpandableTreeCell", {},
      react.createElement("div", {}, react.createElement("span", {}, "native file label")),
      react.createElement("button", {}, "native menu"))
  };
  const originalCell = column.renderCell;
  const tree = {
    props: { columns: [column] },
    list: {},
    forceUpdate: vi.fn(),
    render: () => react.createElement("div", {}, react.createElement("List", {
      itemProvider: {}, renderRow: vi.fn()
    }))
  };
  const element = document.createElement("table");
  document.body.append(element);
  const host: NativeHost = { element, tree, view, react };
  const report = vi.fn();
  const adapter = new NativeTreeAdapter(host, config, report);
  return { adapter, host, config, report, raw, column, originalCell, listeners,
    processed: () => processed,
    keyword: (value: string) => { nativeKeyword = value; view.changesCurrentKey = ""; view.updateChanges(raw); }
  };
}

describe("native tree adapter", () => {
  it("filters before native collection building without changing cache or pagination", () => {
    const f = fixture();
    f.config.filters.extension = "ts";
    f.adapter.start();
    expect(f.processed()?.changeEntries.map((e) => e.item.path)).toEqual(["/one/app.ts"]);
    expect(f.processed()).toHaveProperty("nextSkip", 42);
    expect(f.raw.changeEntries).toHaveLength(2);
    expect(f.host.view.changes.value.totalChanges).toBe(1);
    f.adapter.dispose();
    expect(f.host.view.changes.value.totalChanges).toBe(2);
    expect(f.listeners.size).toBe(0);
    expect(Object.hasOwn(f.host.view, "processChanges")).toBe(false);
  });

  it("refreshes equally-sized custom filter results and composes with native search", () => {
    const f = fixture();
    f.adapter.start();
    f.adapter.update({ ...f.config, filters: { ...f.config.filters, extension: "ts" } });
    expect(f.processed()?.changeEntries[0]?.item.path).toBe("/one/app.ts");
    f.adapter.update({ ...f.config, filters: { ...f.config.filters, extension: "js" } });
    expect(f.processed()?.changeEntries[0]?.item.path).toBe("/two/app.js");
    f.keyword("/one/");
    expect(f.host.view.changes.value.totalChanges).toBe(0);
    f.adapter.update(f.config);
    expect(f.processed()?.changeEntries.map((e) => e.item.path)).toEqual(["/one/app.ts"]);
    f.adapter.dispose();
    expect(f.host.view.changes.value.totalChanges).toBe(1);
  });

  it("retains unmapped native entries rather than guessing their metadata", () => {
    const f = fixture();
    f.config.filters.hideGenerated = true;
    f.raw.changeEntries.push({ item: { path: "/unresolved" } });
    f.adapter.start();
    expect(f.processed()?.changeEntries).toHaveLength(3);
    f.adapter.dispose();
  });

  it("accepts deleted native entries with a null path and filters by their original path", () => {
    const f = fixture();
    f.raw.changeEntries.splice(1, 1, { item: { path: null }, originalPath: "/two/app.js" });
    f.config.filters.extension = "ts";
    f.adapter.start();
    expect(f.host.view.changes.value.totalChanges).toBe(1);
    expect(f.raw.changeEntries[1]?.item.path).toBeNull();
    f.adapter.update({ ...f.config, filters: { ...f.config.filters, extension: "js" } });
    expect(f.processed()?.changeEntries).toEqual([{ item: { path: null }, originalPath: "/two/app.js" }]);
    f.adapter.dispose();
    expect(f.host.view.changes.value.totalChanges).toBe(2);
  });

  it("renders counts through the native React callback and restores it on teardown", () => {
    const f = fixture();
    f.adapter.start();
    f.host.tree.render();
    expect(f.column.renderCell).not.toBe(f.originalCell);
    const rendered = f.column.renderCell(0, 1, f.column, { underlyingItem: { data: { path: "/one/app.ts" } } });
    expect(JSON.stringify(rendered)).toContain("data-adopp-react-stat");
    expect(JSON.stringify(rendered)).toContain("+3");
    expect(JSON.stringify(rendered)).toContain('"className":"adopp-native-stat-plus"');
    expect(JSON.stringify(rendered)).toContain('"className":"adopp-native-stat-minus"');
    expect(JSON.stringify(rendered)).toContain("native menu");
    f.host.tree.render();
    expect(JSON.stringify(f.column.renderCell(0, 1, f.column, { underlyingItem: { data: { path: "/one/app.ts" } } })).match(/adopp-react-stat/g)).toHaveLength(1);
    f.adapter.dispose();
    expect(f.column.renderCell).toBe(f.originalCell);
  });

  it("colors partial counts while keeping unavailable binary counts nonnumeric", () => {
    const f = fixture(configuration([
      file("/binary.dat", { additions: null, deletions: null, state: "binary" }),
      file("/partial.ts", { state: "partial" })
    ]));
    f.adapter.start();
    f.host.tree.render();
    const render = (path: string) => JSON.stringify(f.column.renderCell(0, 1, f.column, { underlyingItem: { data: { path } } }));
    const binary = render("/binary.dat");
    expect(binary).toContain("binary");
    expect(binary).not.toContain("adopp-native-stat-plus");
    expect(binary).not.toContain("adopp-native-stat-minus");
    const partial = render("/partial.ts");
    expect(partial).toContain("adopp-native-stat-plus");
    expect(partial).toContain("adopp-native-stat-minus");
    expect(partial).toContain(" ~");
    f.adapter.dispose();
  });

  it("does not decorate folders or discussion rows", () => {
    const f = fixture();
    f.adapter.start();
    f.host.tree.render();
    for (const data of [{ path: "/one/app.ts", isFolder: true }, { path: "/one/app.ts", thread: {} }]) {
      expect(JSON.stringify(f.column.renderCell(0, 1, f.column, { underlyingItem: { data } }))).not.toContain("adopp-react-stat");
    }
    f.adapter.dispose();
  });

  it("rejects a mismatched comparison without presenting stale counts", () => {
    const f = fixture();
    f.host.view.changes.value.targetVersion.version = "different";
    f.adapter.start();
    f.host.tree.render();
    expect(f.column.renderCell).toBe(f.originalCell);
    expect(f.report).toHaveBeenLastCalledWith("comparison-mismatch", expect.any(String), null);
    f.adapter.dispose();
  });

  it("does not filter a different iteration or base comparison", () => {
    const f = fixture();
    f.config.filters.extension = "ts";
    f.adapter.start();
    f.host.view.processChanges({ ...f.raw, iterationId: 4 });
    expect(f.processed()?.changeEntries).toHaveLength(2);
    f.host.view.processChanges({ ...f.raw, baseIterationId: 2 });
    expect(f.processed()?.changeEntries).toHaveLength(2);
    f.adapter.dispose();
  });

  it("preserves methods replaced by another integration after attachment", () => {
    const f = fixture();
    f.adapter.start();
    const replacement = vi.fn();
    f.host.tree.render = replacement;
    f.adapter.dispose();
    expect(f.host.tree.render).toBe(replacement);
  });

  it("keeps native row-key identity stable across ordinary renders", () => {
    const f = fixture();
    f.adapter.start();
    const first = f.host.tree.render();
    const second = f.host.tree.render();
    if (!react.isValidElement(first) || !react.isValidElement(second)) throw new Error("Missing Table output");
    const firstList: unknown = first.props.children instanceof Array ? first.props.children[0] : null;
    const secondList: unknown = second.props.children instanceof Array ? second.props.children[0] : null;
    if (!react.isValidElement(firstList) || !react.isValidElement(secondList)) throw new Error("Missing List output");
    expect(typeof firstList.props.getRowKey).toBe("function");
    expect(firstList.props.getRowKey).toBe(secondList.props.getRowKey);
    f.adapter.dispose();
  });

  it("refreshes cached native rows after a native filter changes or clears the collection", () => {
    const f = fixture();
    const rowKey = () => {
      const table = f.host.tree.render();
      if (!react.isValidElement(table) || !Array.isArray(table.props.children)) throw new Error("Missing Table output");
      const list: unknown = table.props.children[0];
      if (!react.isValidElement(list)) throw new Error("Missing List output");
      return list.props.getRowKey;
    };
    f.adapter.start();
    const initial = rowKey();
    f.keyword("/one/");
    const filtered = rowKey();
    expect(filtered).not.toBe(initial);
    expect(rowKey()).toBe(filtered);
    f.keyword("");
    expect(rowKey()).not.toBe(filtered);
    expect(f.host.view.changes.value.totalChanges).toBe(2);
    f.adapter.dispose();
  });

  it("reattaches a replaced Table without reprocessing or discarding the active filtered model", () => {
    const f = fixture();
    f.config.filters.extension = "ts";
    f.adapter.start();
    const next = { ...f.host.tree, render: () => react.createElement("div", {}, react.createElement("List", { itemProvider: {}, renderRow: vi.fn() })) };
    f.adapter.rebind({ ...f.host, tree: next });
    expect(f.host.view.changes.value.totalChanges).toBe(1);
    expect(Object.hasOwn(next, "render")).toBe(true);
    f.adapter.dispose();
    expect(f.host.view.changes.value.totalChanges).toBe(2);
  });

  it("filters the complete 422-file input independently of rendered rows", () => {
    const files = Array.from({ length: 422 }, (_, index) => file(`/folder-${index}/same.${index % 2 ? "ts" : "js"}`, { trackingId: index + 1 }));
    const f = fixture(configuration(files));
    f.config.filters.extension = "ts";
    f.adapter.start();
    expect(f.host.view.changes.value.totalChanges).toBe(211);
    expect(f.raw.changeEntries).toHaveLength(422);
    f.adapter.dispose();
    expect(f.host.view.changes.value.totalChanges).toBe(422);
  });

  it("reports incompatible renderers without disabling working native filtering", async () => {
    const f = fixture();
    f.host.tree.render = () => ({ type: "ChangedTable", props: {} });
    const adapter = new NativeTreeAdapter(f.host, f.config, f.report);
    adapter.start();
    f.host.tree.render();
    await Promise.resolve();
    expect(f.report).toHaveBeenCalledWith("counts-unavailable", expect.stringContaining("contract changed"), 2);
    expect(f.listeners.size).toBe(1);
    adapter.update({ ...f.config, filters: { ...f.config.filters, extension: "ts" } });
    expect(f.host.view.changes.value.totalChanges).toBe(1);
    adapter.dispose();
  });
});

describe("native tree contracts", () => {
  it("matches by full path and applies metadata predicates", () => {
    const filters = { ...configuration().filters, extension: "ts", hideGenerated: true };
    expect(matchesFilters(file("/a/main.ts"), filters)).toBe(true);
    expect(matchesFilters(file("/b/main.js"), filters)).toBe(false);
    expect(matchesFilters(file("/a/main.ts", { generated: true }), filters)).toBe(false);
  });

  it("accepts only bounded metadata commands, never privileged operations", () => {
    expect(configurationSchema.safeParse(configuration()).success).toBe(true);
    expect(commandSchema.safeParse({ ...configuration(), kind: "submit-review" }).success).toBe(false);
    expect(configurationSchema.safeParse({ ...configuration(), token: "not-allowed" }).success).toBe(false);
    expect(configurationSchema.safeParse({ ...configuration(), files: [file("/x", { additions: -1 })] }).success).toBe(false);
  });

  it("validates under a CSP that prohibits dynamic Function construction", () => {
    const original = globalThis.Function;
    vi.stubGlobal("Function", () => { throw new Error("unsafe-eval prohibited"); });
    try {
      expect(configurationSchema.safeParse(configuration()).success).toBe(true);
    } finally {
      vi.stubGlobal("Function", original);
    }
  });

  it("discovers instances by contracts rather than names, depth, or React suffix", () => {
    const f = fixture();
    const element = document.createElement("table");
    const fiber = {
      memoizedProps: {},
      return: {
        stateNode: f.host.tree,
        memoizedProps: { columns: [f.column], renderRow: vi.fn() },
        return: { memoizedProps: { value: { viewService: f.host.view } } }
      }
    };
    Reflect.set(element, "__reactFiber$random", fiber);
    expect(discoverHost(element, react)?.view).toBe(f.host.view);
    f.host.element.remove();
  });
});

describe("native tree bridge client", () => {
  let client: NativeTreeClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window, "postMessage").mockImplementation(() => {});
    client = new NativeTreeClient({
      context: {
        origin: location.origin, organization: "org", project: "project", repository: "repo", repositoryId: "repo-id",
        pullRequestId: 7, title: "PR", sourceCommit: "source", targetCommit: "target", mergeBaseCommit: "base",
        iterationId: 3, identity: "comparison", reviewer: { id: "reviewer", displayName: "Reviewer" }
      },
      files: configuration().files, groups: [], completedTrackingIds: new Set(),
      threads: { state: "available", active: 0, resolved: 0, total: 0 }
    });
  });

  describe("native tree page bridge lifecycle", () => {
    it("waits outside Files view and reattaches after a long tab change without permanent failure", async () => {
      const f = fixture();
      const originalUrl = location.href;
      const requireDescriptor = Object.getOwnPropertyDescriptor(window, "require");
      const originalRender = f.host.tree.render;
      f.host.element.classList.add("repos-file-explorer-tree");
      Reflect.set(f.host.element, "__reactFiber$lifecycle", {
        memoizedProps: { columns: [f.column], renderRow: vi.fn() }, stateNode: f.host.tree,
        return: { memoizedProps: { value: { viewService: f.host.view } } }
      });
      Reflect.set(window, "require", Object.assign(() => react, { defined: () => true }));
      history.replaceState({}, "", "/org/project/_git/repo/pullrequest/7?_a=files");
      const config = { ...f.config, page: location.origin + location.pathname };
      const listenerSpy = vi.spyOn(window, "addEventListener");
      const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
      vi.useFakeTimers();
      const send = (data: unknown) => window.dispatchEvent(new MessageEvent("message", {
        data, source: window, origin: location.origin
      }));
      try {
        await import("../src/native-tree/main");
        send(config);
        expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ state: "active" }), location.origin);
        f.host.element.remove();
        history.replaceState({}, "", "/org/project/_git/repo/pullrequest/7?_a=overview");
        vi.advanceTimersByTime(20000);
        expect(f.host.tree.render).toBe(originalRender);
        expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ state: "unavailable" }), location.origin);
        document.body.append(f.host.element);
        history.replaceState({}, "", "/org/project/_git/repo/pullrequest/7?_a=files");
        vi.advanceTimersByTime(1000);
        expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ state: "active" }), location.origin);
        expect(f.host.tree.render).not.toBe(originalRender);
      } finally {
        send({ channel: CHANNEL, kind: "dispose", session: config.session });
        for (const [type, listener] of listenerSpy.mock.calls) {
          if (type === "message") window.removeEventListener(type, listener);
        }
        if (requireDescriptor) Object.defineProperty(window, "require", requireDescriptor);
        else Reflect.deleteProperty(window, "require");
        history.replaceState({}, "", originalUrl);
        f.host.element.remove();
        vi.useRealTimers();
        vi.restoreAllMocks();
      }
    });
  });

  afterEach(() => {
    client.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function configured() {
    client.configure(configuration().filters, true);
    return configurationSchema.parse(vi.mocked(window.postMessage).mock.calls[0]?.[0]);
  }

  function send(data: unknown, source: MessageEventSource | null = window, origin = location.origin): void {
    window.dispatchEvent(new MessageEvent("message", { data, source, origin }));
  }

  it("sends only comparison metadata and deduplicates unchanged configuration", () => {
    const command = configured();
    client.configure(configuration().filters, true);
    expect(window.postMessage).toHaveBeenCalledTimes(1);
    expect(window.postMessage).toHaveBeenCalledWith(command, location.origin);
    expect(command.comparison).toEqual({ iteration: 3, source: "source", base: "base" });
    expect(command).not.toHaveProperty("reviewer");
    expect(command).not.toHaveProperty("identity");
    client.configure({ ...configuration().filters, extension: "ts" }, true);
    expect(window.postMessage).toHaveBeenCalledTimes(2);
  });

  it("accepts only validated status from the same window, origin, and session", () => {
    const command = configured();
    const status = { channel: CHANNEL, kind: "status", session: command.session, state: "active", detail: "Ready", fileCount: 2 };
    const listener = vi.fn();
    client.subscribe(listener);
    send(status, null);
    send(status, window, "https://another.example");
    send({ ...status, session: configuration().session });
    send({ ...status, fileCount: -1 });
    send({ ...status, privileged: true });
    expect(client.status).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    send(status);
    expect(client.status).toEqual(status);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("reports a missing bridge explicitly without inventing a successful fallback", () => {
    configured();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.advanceTimersByTime(15000);
    expect(client.status?.state).toBe("unavailable");
    expect(client.status?.detail).toContain("No DOM row-hiding fallback");
    expect(warning).toHaveBeenCalledOnce();
  });

  it("disposes its session, removes listeners and timers, and can restart", () => {
    const command = configured();
    const listener = vi.fn();
    const unsubscribe = client.subscribe(listener);
    client.stop();
    expect(window.postMessage).toHaveBeenLastCalledWith({ channel: CHANNEL, kind: "dispose", session: command.session }, location.origin);
    send({ channel: CHANNEL, kind: "status", session: command.session, state: "active", detail: "Late", fileCount: 2 });
    vi.advanceTimersByTime(15000);
    expect(client.status).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
    client.configure(configuration().filters, true);
    expect(window.postMessage).toHaveBeenCalledTimes(3);
  });
});
