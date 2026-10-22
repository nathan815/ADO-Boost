// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceClient } from "../src/workspace/client";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("workspace client routes", () => {
  it("delivers validated route updates without reconnecting or fetching the session again", () => {
    let receive!: (message: unknown) => void;
    let disconnect!: () => void;
    const connect = vi.fn(() => ({
      onMessage: { addListener: (listener: typeof receive) => { receive = listener; } },
      onDisconnect: { addListener: (listener: typeof disconnect) => { disconnect = listener; } },
      postMessage: vi.fn()
    }));
    vi.stubGlobal("chrome", { runtime: { connect } });
    const routed = vi.fn();
    document.addEventListener("workspace-route", routed);
    new WorkspaceClient();
    try {
      receive({ kind: "route", view: "profile", subject: { id: "person", displayName: "Person" } });
      expect(routed).toHaveBeenCalledOnce();
      expect((routed.mock.calls[0]![0] as CustomEvent).detail).toEqual({ view: "profile", subject: { id: "person", displayName: "Person" } });
      receive({ kind: "route", view: "unknown", subject: null });
      receive({ kind: "route", view: "profile", subject: { displayName: "Invalid" } });
      expect(routed).toHaveBeenCalledOnce();
      expect(connect).toHaveBeenCalledOnce();
    } finally {
      disconnect();
      document.removeEventListener("workspace-route", routed);
    }
  });
});
