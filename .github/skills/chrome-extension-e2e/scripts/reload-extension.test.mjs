import assert from "node:assert/strict";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { cdpRequest, reloadExtension } from "./reload-extension.mjs";

function fakeSocket(respond) {
  const instances = [];
  class FakeWebSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.closed = false;
      instances.push(this);
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }
    send(data) {
      this.request = JSON.parse(data);
      respond(this);
    }
    message(value) {
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) }));
    }
    close() {
      this.closed = true;
    }
  }
  return { WebSocketImpl: FakeWebSocket, instances, timeoutMs: 1000 };
}

async function extensionFixture(context) {
  const directory = await mkdtemp(join(tmpdir(), "ado-boost-extension-e2e-"));
  const manifest = join(directory, "manifest.json");
  await writeFile(manifest, JSON.stringify({ manifest_version: 3, name: "Test", version: "1.0" }));
  context.after(async () => {
    await unlink(manifest);
    await rmdir(directory);
  });
  return directory;
}

test("sends the load command, ignores unrelated messages, and closes the socket", async () => {
  const options = fakeSocket((socket) => {
    socket.message({ method: "Target.targetCreated" });
    socket.message({ id: 2, result: {} });
    socket.message({ id: 1, result: { id: "test-extension" } });
  });
  const params = { path: "C:\\local\\dist" };
  const result = await cdpRequest("ws://127.0.0.1:9223/devtools/browser/test", "Extensions.loadUnpacked", params, options);
  assert.equal(result.id, "test-extension");
  assert.deepEqual(options.instances[0].request, { id: 1, method: "Extensions.loadUnpacked", params });
  assert.equal(options.instances[0].closed, true);
});

test("surfaces CDP errors rather than claiming the extension loaded", async () => {
  const options = fakeSocket((socket) => socket.message({ id: 1, error: { code: -32601, message: "Method not found" } }));
  await assert.rejects(cdpRequest("ws://localhost/test", "Extensions.loadUnpacked", {}, options), /Method not found/);
  assert.equal(options.instances[0].closed, true);
});

test("rejects missing extension IDs", async () => {
  const options = fakeSocket((socket) => socket.message({ id: 1, result: {} }));
  await assert.rejects(cdpRequest("ws://localhost/test", "Extensions.loadUnpacked", {}, options), /extension ID/);
});

test("rejects an early disconnect", async () => {
  const options = fakeSocket((socket) => socket.dispatchEvent(new Event("close")));
  await assert.rejects(cdpRequest("ws://localhost/test", "Extensions.loadUnpacked", {}, options), /before responding/);
});

test("bounds the wait and closes the socket on timeout", async () => {
  const options = { ...fakeSocket(() => {}), timeoutMs: 10 };
  await assert.rejects(cdpRequest("ws://localhost/test", "Extensions.loadUnpacked", {}, options), /timed out/);
  assert.equal(options.instances[0].closed, true);
});

test("rejects malformed CDP messages", async () => {
  const options = fakeSocket((socket) => socket.dispatchEvent(new MessageEvent("message", { data: "not JSON" })));
  await assert.rejects(cdpRequest("ws://localhost/test", "Extensions.loadUnpacked", {}, options), /invalid CDP/);
});

test("rejects a null CDP response without leaking the connection", async () => {
  const options = fakeSocket((socket) => socket.message(null));
  await assert.rejects(cdpRequest("ws://localhost/test", "Extensions.loadUnpacked", {}, options), /invalid CDP/);
  assert.equal(options.instances[0].closed, true);
});

test("rejects invalid ports before connecting", async () => {
  await assert.rejects(reloadExtension(".", { port: 0 }), /CDP port/);
});

test("discovers the browser endpoint and loads an absolute extension directory", async (context) => {
  const directory = await extensionFixture(context);
  const options = fakeSocket((socket) => socket.message({ id: 1, result: { id: "loaded-extension" } }));
  const result = await reloadExtension(directory, {
    ...options,
    fetchImpl: async (url) => {
      assert.equal(url, "http://127.0.0.1:9223/json/version");
      return { ok: true, json: async () => ({ Browser: "Chrome/140.0", webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/browser/test" }) };
    }
  });
  assert.deepEqual(result, { extensionId: "loaded-extension", extensionPath: resolve(directory), port: 9223 });
  assert.equal(options.instances[0].request.params.path, resolve(directory));
});

for (const [name, version, expected] of [
  ["non-Chrome browser", { Browser: "Edg/140.0", webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/browser/test" }, /not Google Chrome/],
  ["network WebSocket", { Browser: "Chrome/140.0", webSocketDebuggerUrl: "ws://example.com:9223/devtools/browser/test" }, /loopback browser-level/],
  ["wrong port", { Browser: "Chrome/140.0", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/test" }, /loopback browser-level/],
  ["page endpoint", { Browser: "Chrome/140.0", webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/test" }, /loopback browser-level/]
]) {
  test(`rejects ${name} before opening a socket`, async (context) => {
    const directory = await extensionFixture(context);
    const options = fakeSocket(() => {});
    await assert.rejects(reloadExtension(directory, {
      ...options, fetchImpl: async () => ({ ok: true, json: async () => version })
    }), expected);
    assert.equal(options.instances.length, 0);
  });
}
