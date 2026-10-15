import { NativeTreeAdapter } from "./adapter";
import { discoverHost, getHostReact } from "./host";
import type { NativeHost } from "./host";
import { CHANNEL, commandSchema, hasFilters } from "./protocol";
import type { TreeConfiguration, TreeStatus } from "./protocol";

let config: TreeConfiguration | null = null;
let adapter: NativeTreeAdapter | null = null;
let mounted: NativeHost | null = null;
let timer = 0;
let failed = false;
let lastStatus = "";
let waitingSince = 0;

function report(state: TreeStatus["state"], detail: string, fileCount: number | null): void {
  if (!config) return;
  const status: TreeStatus = {
    channel: CHANNEL, kind: "status", session: config.session, state, detail, fileCount,
    filtersActive: hasFilters(config.filters) || Boolean(mounted?.view.getFilesFilter().hasChangesToReset())
  };
  const serialized = JSON.stringify(status);
  if (serialized === lastStatus) return;
  lastStatus = serialized;
  if (state === "unavailable") {
    failed = true;
    console.warn("ADO Boost native tree integration unavailable:", detail);
  }
  if (state === "counts-unavailable") console.warn("ADO Boost native tree counts unavailable:", detail);
  window.postMessage(status, location.origin);
}

function unmount(): void {
  const previous = adapter;
  adapter = null;
  mounted = null;
  previous?.dispose();
}

function reconcile(): void {
  if (!config) return;
  if (config.page !== location.origin + location.pathname) {
    unmount();
    return;
  }
  if (failed) return;
  try {
    const react = getHostReact(window);
    const element = document.querySelector(".repos-file-explorer-tree");
    const host = react && element ? discoverHost(element, react) : null;
    if (!host) {
      if (mounted && !mounted.element.isConnected) {
        unmount();
        waitingSince = Date.now();
      }
      const filesView = new URL(location.href).searchParams.get("_a")?.toLowerCase() === "files";
      if (!filesView) waitingSince = Date.now();
      const timedOut = Date.now() - waitingSince > 15000;
      if (timedOut) unmount();
      report(timedOut ? "unavailable" : "waiting",
        filesView ? "Waiting for a compatible native file tree. No DOM row-hiding fallback will be used."
          : "Open ADO's Files view to use native tree enhancements.", null);
      return;
    }
    waitingSince = Date.now();
    if (mounted?.view === host.view && adapter) {
      if (mounted.tree !== host.tree || mounted.element !== host.element) adapter.rebind(host);
      mounted = host;
      return;
    }
    unmount();
    mounted = host;
    adapter = new NativeTreeAdapter(host, config, report);
    adapter.start();
  } catch (error) {
    try { unmount(); } catch (cleanupError) { console.error("ADO Boost native tree cleanup failed", cleanupError); }
    report("unavailable", error instanceof Error ? error.message : "Native tree attachment failed", null);
  }
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const parsed = commandSchema.safeParse(event.data);
  if (!parsed.success) return;
  const command = parsed.data;
  if (command.kind === "dispose") {
    if (config?.session !== command.session) return;
    window.clearInterval(timer);
    timer = 0;
    try { unmount(); } catch (error) { console.error("ADO Boost native tree cleanup failed", error); }
    config = null;
    return;
  }
  if (command.page !== location.origin + location.pathname || !/\/pullrequest\/\d+$/i.test(location.pathname)) return;
  if (!config || command.session !== config.session) {
    try { unmount(); } catch (error) { console.error("ADO Boost native tree cleanup failed", error); }
    failed = false;
    lastStatus = "";
    waitingSince = Date.now();
  }
  config = command;
  try {
    adapter?.update(command);
    reconcile();
  } catch (error) {
    try { unmount(); } catch (cleanupError) { console.error("ADO Boost native tree cleanup failed", cleanupError); }
    report("unavailable", error instanceof Error ? error.message : "Native tree configuration failed", null);
  }
  if (!timer) timer = window.setInterval(reconcile, 1000);
});
