import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeFrame, FrameDecoder } from "../src/protocol.js";
import packageInfo from "../package.json" with { type: "json" };

const origin = "chrome-extension://oldakfajnbllipnfdaghapeiofnciopo/";
const personal = { host: "https://github.com", login: "personal" };
const work = { host: "https://github.com", login: "work_account" };
let temporary: string;
let bundle: string;

const mockSdk = `
import { readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
export class CopilotClient {
  constructor(options) { this.options = options; this.state = "disconnected"; this.sessions = []; }
  log(event) { appendFileSync(this.options.env.ADO_TEST_EVENTS, JSON.stringify({ ...event, login: this.account?.login }) + "\\n"); }
  async start() {
    this.account = JSON.parse(readFileSync(join(this.options.env.COPILOT_HOME, "config.json"), "utf8")).last_logged_in_user;
    this.log({ type: "start" }); this.state = "connected";
  }
  getState() { return this.state; }
  async getAuthStatus() {
    const overrides = JSON.parse(readFileSync(this.options.env.ADO_TEST_IDENTITIES, "utf8"));
    return overrides[this.account.login] ?? { isAuthenticated: true, ...this.account };
  }
  async getStatus() { return { version: "test" }; }
  async createSession() {
    this.log({ type: "session" });
    let rejectPending;
    const session = {
      sessionId: "test-session",
      sendAndWait: async ({ prompt }) => {
        this.log({ type: "prompt" });
        if (prompt.includes("pending-question")) return new Promise((_, reject) => { rejectPending = reject; });
        return { data: { content: '{"groups":[{"title":"Code","rationale":"Related","paths":["/file.ts"]}]}' } };
      },
      abort: async () => { this.log({ type: "abort" }); rejectPending?.(new Error("Account request aborted")); },
      disconnect: async () => { this.log({ type: "disconnect" }); }
    };
    this.sessions.push(session);
    return session;
  }
  async forceStop() { this.state = "disconnected"; for (const session of this.sessions) await session.abort(); }
  async stop() { await this.forceStop(); }
}`;

beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), "ado-boost-host-accounts-"));
  bundle = join(temporary, "host.mjs");
  await build({
    entryPoints: [resolve("src", "host.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm",
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
    plugins: [{
      name: "test-copilot-client",
      setup(builder) {
        builder.onResolve({ filter: /^@github\/copilot-sdk$/ }, () => ({ path: "sdk", namespace: "test" }));
        builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: mockSdk, loader: "js" }));
      }
    }]
  });
});
afterAll(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });

interface Response {
  ok: boolean;
  data?: { auth?: { isAuthenticated: boolean }; selected?: typeof work };
  error?: { code: string; message: string };
}

async function fixture(account?: typeof work) {
  const directory = await mkdtemp(join(temporary, "case-"));
  const sourceHome = join(directory, "global");
  const host = join(directory, "host");
  await mkdir(sourceHome);
  await mkdir(host);
  const sourceConfig = JSON.stringify({ logged_in_users: [personal, work], last_logged_in_user: personal });
  await writeFile(join(sourceHome, "config.json"), sourceConfig);
  const configPath = join(host, "host-config.json");
  await writeFile(configPath, JSON.stringify({ allowedOrigins: [origin], ...(account ? { account } : {}) }));
  const events = join(directory, "events.jsonl");
  const auth = join(directory, "auth.json");
  await writeFile(events, "");
  await writeFile(auth, "{}");
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [bundle, "--config", configPath, origin], {
    env: { ...process.env, COPILOT_HOME: sourceHome, ADO_TEST_EVENTS: events, ADO_TEST_IDENTITIES: auth },
    stdio: ["pipe", "pipe", "pipe"]
  });
  const pending = new Map<string, { resolve: (value: Response) => void; reject: (error: Error) => void }>();
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const decoder = new FrameDecoder();
  child.stdout.on("data", (chunk: Buffer) => {
    for (const value of decoder.push(chunk)) {
      const response = value as Response & { id: string };
      pending.get(response.id)?.resolve(response);
      pending.delete(response.id);
    }
  });
  child.once("exit", () => {
    for (const request of pending.values()) request.reject(new Error(`Host exited: ${stderr}`));
    pending.clear();
  });
  let nextId = 0;
  const request = (type: string, payload = {}): Promise<Response> => new Promise((resolveResponse, reject) => {
    const id = String(nextId++);
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${type}; ${stderr}`)); }, 5_000);
    pending.set(id, {
      resolve: (response) => { clearTimeout(timeout); resolveResponse(response); },
      reject: (error) => { clearTimeout(timeout); reject(error); }
    });
    child.stdin.write(encodeFrame({ id, type, ...payload }));
  });
  expect((await request("hello", { origin, version: 1 })).ok).toBe(true);
  return {
    pid: child.pid,
    request,
    auth: async (overrides: unknown) => writeFile(auth, JSON.stringify(overrides)),
    events: async () => (await readFile(events, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { type: string; login: string }),
    config: async () => JSON.parse(await readFile(configPath, "utf8")),
    pin: async (account: typeof work) => {
      const config = JSON.parse(await readFile(configPath, "utf8"));
      await writeFile(configPath, JSON.stringify({ ...config, account }));
    },
    globalUnchanged: async () => (await readFile(join(sourceHome, "config.json"), "utf8")) === sourceConfig,
    close: async () => {
      if (child.exitCode !== null) return;
      const exited = new Promise<void>((done) => child.once("exit", () => done()));
      child.stdin.end();
      await exited;
    }
  };
}

const inference = { title: "PR", comparisonIdentity: "comparison", files: [{ path: "/file.ts", changeType: "edit", additions: 1, deletions: 0 }], excerpts: [] };

describe("native account routing", () => {
  it("detects a first setup pin on diagnostic polling without restarting the unconfigured host", async () => {
    const host = await fixture();
    try {
      expect(await host.request("health")).toMatchObject({ ok: true, data: { auth: { isAuthenticated: false } } });
      await host.pin(work);
      expect(await host.request("accounts")).toMatchObject({ ok: true, data: { selected: work } });
      expect(await host.request("health")).toMatchObject({ ok: true, data: { auth: { isAuthenticated: true, login: work.login } } });
      expect((await host.events()).filter((event) => event.type === "session")).toEqual([]);
    } finally {
      await host.close();
    }
  });
  it("lists accounts without inference, requires a pin, switches live and persists without changing the global CLI account", async () => {
    const host = await fixture();
    try {
      expect(await host.request("accounts")).toMatchObject({ ok: true, data: { accounts: [personal, work], selected: null } });
      expect(await host.events()).toEqual([]);
      expect(await host.request("health")).toMatchObject({
        ok: true, data: { auth: { isAuthenticated: false }, protocolVersion: 1, companion: { version: packageInfo.version, pid: host.pid, uptimeSeconds: expect.any(Number) } }
      });
      expect(await host.request("semantic-groups", inference)).toMatchObject({ ok: false, error: { code: "account-required" } });
      expect(await host.request("select-account", { account: work })).toMatchObject({ ok: true, data: { selected: work } });
      expect((await host.config()).account).toEqual(work);
      expect(await host.request("health")).toMatchObject({
        ok: true, data: { auth: { isAuthenticated: true, ...work }, sdk: { version: "test" }, companion: { pid: host.pid, uptimeSeconds: expect.any(Number) } }
      });
      expect((await host.events()).some((event) => event.type === "session")).toBe(false);
      expect((await host.request("semantic-groups", inference)).ok).toBe(true);
      expect(await host.events()).toContainEqual({ type: "prompt", login: work.login });
      expect(await host.request("select-account", { account: personal })).toMatchObject({ ok: true, data: { selected: personal } });
      expect((await host.request("semantic-groups", inference)).ok).toBe(true);
      expect((await host.events()).filter((event) => event.type === "prompt").map((event) => event.login)).toEqual([work.login, personal.login]);
      expect(await host.globalUnchanged()).toBe(true);
    } finally { await host.close(); }
  });

  it("never sends context for mismatched or signed-out accounts and retains the old pin on failure", async () => {
    const host = await fixture(work);
    try {
      await host.auth({ [work.login]: { isAuthenticated: true, ...personal } });
      expect(await host.request("semantic-groups", inference)).toMatchObject({ ok: false, error: { code: "account-mismatch" } });
      expect((await host.events()).filter((event) => event.type === "session")).toEqual([]);
      await host.auth({ [personal.login]: { isAuthenticated: false } });
      expect(await host.request("select-account", { account: personal })).toMatchObject({ ok: false, error: { code: "login-required" } });
      expect((await host.config()).account).toEqual(work);
      expect(await host.request("select-account", { account: { ...work, login: "not-signed-in" } })).toMatchObject({ ok: false, error: { code: "account-unavailable" } });
      expect((await host.request("semantic-groups", inference)).ok).toBe(true);
    } finally { await host.close(); }
  });

  it("cancels in-flight old-account requests before returning a successful live switch", async () => {
    const host = await fixture(work);
    try {
      const pending = host.request("chat", { ...inference, question: "pending-question" });
      await expect.poll(async () => (await host.events()).some((event) => event.type === "prompt")).toBe(true);
      expect(await host.request("select-account", { account: personal })).toMatchObject({ ok: true, data: { selected: personal } });
      expect(await pending).toMatchObject({ ok: false });
      expect((await host.request("semantic-groups", inference)).ok).toBe(true);
      expect((await host.events()).filter((event) => event.type === "prompt").map((event) => event.login)).toEqual([work.login, personal.login]);
    } finally { await host.close(); }
  });

  it("serializes concurrent account switches", async () => {
    const host = await fixture(work);
    try {
      const [first, second] = await Promise.all([
        host.request("select-account", { account: personal }),
        host.request("select-account", { account: work })
      ]);
      expect(first).toMatchObject({ ok: true, data: { selected: personal } });
      expect(second).toMatchObject({ ok: false, error: { code: "account-switching" } });
      expect((await host.config()).account).toEqual(personal);
    } finally { await host.close(); }
  });

  it("blocks a stale live client when the persisted pin was changed externally", async () => {
    const host = await fixture(work);
    try {
      expect((await host.request("health")).ok).toBe(true);
      await host.pin(personal);
      expect(await host.request("semantic-groups", inference)).toMatchObject({ ok: false, error: { code: "account-mismatch" } });
      expect((await host.events()).filter((event) => event.type === "prompt")).toEqual([]);
    } finally { await host.close(); }
  });
});
