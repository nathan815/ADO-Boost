import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function cdpRequest(url, method, params, { WebSocketImpl = WebSocket, timeoutMs = 20000 } = {}) {
  return new Promise((resolveRequest, reject) => {
    const socket = new WebSocketImpl(url);
    const finish = (error, result) => {
      clearTimeout(timeout);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
      socket.close();
      if (error) reject(error);
      else resolveRequest(result);
    };
    const onOpen = () => {
      try {
        socket.send(JSON.stringify({ id: 1, method, params }));
      } catch (error) {
        finish(error);
      }
    };
    const onMessage = (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch (error) {
        finish(new Error("Chrome returned an invalid CDP message.", { cause: error }));
        return;
      }
      if (!message || typeof message !== "object" || Array.isArray(message)) {
        finish(new Error("Chrome returned an invalid CDP message."));
        return;
      }
      if (message.id !== 1) return;
      if (message.error) {
        finish(new Error(`${method} failed (${message.error.code}): ${message.error.message}. Check Chrome's extension-debugging flag and local policies.`));
      } else if (!message.result?.id || typeof message.result.id !== "string") {
        finish(new Error(`${method} did not return an extension ID.`));
      } else {
        finish(null, message.result);
      }
    };
    const onError = () => finish(new Error("Chrome browser WebSocket connection failed."));
    const onClose = () => finish(new Error("Chrome closed the CDP connection before responding."));
    const timeout = setTimeout(() => finish(new Error(`${method} timed out after ${timeoutMs}ms.`)), timeoutMs);
    socket.addEventListener("open", onOpen);
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

export async function reloadExtension(extensionPath, { port = 9223, fetchImpl = fetch, ...socketOptions } = {}) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("CDP port must be an integer from 1024 through 65535.");
  const path = resolve(extensionPath);
  if (!(await stat(resolve(path, "manifest.json"))).isFile()) throw new Error("The extension directory must contain manifest.json. Build the extension first.");
  const response = await fetchImpl(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Chrome CDP discovery failed: HTTP ${response.status}.`);
  const version = await response.json();
  if (!/^(Chrome|Chromium)\//.test(version.Browser ?? "")) throw new Error("The debug endpoint is not Google Chrome/Chromium. Check the dedicated profile and port.");
  const browserSocket = new URL(version.webSocketDebuggerUrl);
  if (browserSocket.protocol !== "ws:" || !["127.0.0.1", "localhost", "[::1]"].includes(browserSocket.hostname)
    || Number(browserSocket.port) !== port || !browserSocket.pathname.startsWith("/devtools/browser/")) {
    throw new Error("Expected a loopback browser-level CDP WebSocket on the selected port.");
  }
  const result = await cdpRequest(browserSocket.href, "Extensions.loadUnpacked", { path }, socketOptions);
  return { extensionId: result.id, extensionPath: path, port };
}

async function main(args) {
  if (args.includes("--help")) {
    console.log("node reload-extension.mjs --extension <built extension directory> [--port 9223]");
    return;
  }
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    if (!["--extension", "--port"].includes(args[index]) || !args[index + 1] || options.has(args[index])) {
      throw new Error("Use --extension <directory> [--port <port>] with no duplicate or unknown arguments.");
    }
    options.set(args[index], args[index + 1]);
  }
  if (!options.has("--extension")) throw new Error("Pass --extension pointing to the locally built unpacked extension directory.");
  const result = await reloadExtension(options.get("--extension"), { port: Number(options.get("--port") ?? 9223) });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
