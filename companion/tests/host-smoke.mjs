import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const origin = "chrome-extension://oldakfajnbllipnfdaghapeiofnciopo/";
const dist = join(import.meta.dirname, "..", "dist");
const login = process.argv[2];
if (!login) throw new Error("Usage: node tests/host-smoke.mjs <pinned-github-username> [github-host]");
const temporary = await mkdtemp(join(tmpdir(), "ado-boost-smoke-"));
const hostDirectory = join(temporary, "host");
await mkdir(hostDirectory);
const configPath = join(hostDirectory, "host-config.json");
const account = { login, host: process.argv[3] ?? "https://github.com" };
const { stdout } = await promisify(execFile)("where.exe", ["copilot.exe"]);
const cliPath = stdout.split(/\r?\n/).find(Boolean)?.trim();
if (!cliPath) throw new Error("copilot.exe not found");
await writeFile(configPath, JSON.stringify({ allowedOrigins: [origin], cliPath, account }));

const child = spawn(process.execPath, [join(dist, "host.js"), "--config", configPath, origin], { stdio: ["pipe", "pipe", "pipe"] });
let buffer = Buffer.alloc(0);
const pending = new Map();
child.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (buffer.length < length + 4) return;
    const message = JSON.parse(buffer.subarray(4, length + 4).toString("utf8"));
    buffer = buffer.subarray(length + 4);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  }
});

function request(message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${message.type}`)), 45_000);
    pending.set(message.id, (response) => {
      clearTimeout(timeout);
      resolve(response);
    });
    const body = Buffer.from(JSON.stringify(message));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    child.stdin.write(Buffer.concat([header, body]));
  });
}

try {
  const hello = await request({ id: "hello", type: "hello", version: 1, origin });
  if (!hello.ok) throw new Error(JSON.stringify(hello));
  const health = await request({ id: "health", type: "health" });
  if (!health.ok) throw new Error(JSON.stringify(health));
  if (!health.data.auth.isAuthenticated || health.data.auth.login?.toLowerCase() !== login.toLowerCase()) throw new Error(JSON.stringify(health.data));
  console.log(JSON.stringify(health.data));
} finally {
  child.stdin.end();
  await new Promise((resolve) => child.once("exit", resolve));
  await rm(temporary, { recursive: true, force: true });
}
