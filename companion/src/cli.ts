import { access, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { assertOwnedMarker, assertOwnedRegistry, createMarker, extensionIdFromManifestKey } from "./ownership.js";
import { withStagingDirectory } from "./staging.js";

const exec = promisify(execFile);
const EXTENSION_ID = "oldakfajnbllipnfdaghapeiofnciopo";
const HOST_NAME = "com.adoboost.copilot";
const root = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(root);
const localAppData = process.env.LOCALAPPDATA;
if (!localAppData) throw new Error("LOCALAPPDATA is not available");
const installRoot = join(localAppData, "ADO Boost");
const extensionDir = join(installRoot, "extension");
const hostDir = join(installRoot, "host");
const manifestPath = join(hostDir, `${HOST_NAME}.json`);
const registryKey = `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`;
const markerName = ".ado-boost-owner.json";
const args = process.argv.slice(2);

switch (args[0]) {
  case "setup":
    await setup(args.includes("--yes"));
    break;
  case "doctor":
    await doctor();
    break;
  case "login":
    await runCopilot(["login"]);
    break;
  case "uninstall-host":
    await uninstall(args.includes("--yes"));
    break;
  default:
    console.log("Usage: ado-boost <setup|doctor|login|uninstall-host> [--yes]");
}

async function setup(confirmed: boolean): Promise<void> {
  const nodePath = process.execPath;
  const copilotPath = await findCopilot();
  await validatePackagedExtension();
  await assertOwnedDirectory(extensionDir);
  await assertOwnedDirectory(hostDir);
  const existingRegistry = await queryRegistryDefault(true);
  assertOwnedRegistry(existingRegistry, manifestPath);
  console.log(`Extension ID: ${EXTENSION_ID}`);
  console.log(`Extension folder: ${extensionDir}`);
  console.log(`Native host folder: ${hostDir}`);
  console.log(`Edge registry key: ${registryKey}`);
  console.log(`Node runtime: ${nodePath}`);
  console.log(`Copilot CLI: ${copilotPath}`);
  if (!confirmed && !await confirm("Install these per-user files and register the Edge native host?")) return;
  await mkdir(installRoot, { recursive: true });
  const transaction = randomUUID();
  const stageRoot = join(installRoot, `.staging-${transaction}`);
  const stageExtension = join(stageRoot, "extension");
  const stageHost = join(stageRoot, "host");
  const backupExtension = join(installRoot, `.extension-backup-${transaction}`);
  const backupHost = join(installRoot, `.host-backup-${transaction}`);
  let movedExtension = false;
  let movedHost = false;
  await withStagingDirectory(stageRoot, async () => {
    await cp(join(packageRoot, "prebuilt-extension"), stageExtension, { recursive: true });
    await mkdir(stageHost, { recursive: true });
    await cp(join(root, "ado-boost-native-host.exe"), join(stageHost, "ado-boost-native-host.exe"));
    const stageConfigPath = join(stageHost, "host-config.json");
    await writeFile(join(stageHost, "launcher.json"), JSON.stringify({ nodePath, hostPath: join(root, "host.js"), configPath: join(hostDir, "host-config.json") }, null, 2));
    await writeFile(stageConfigPath, JSON.stringify({ allowedOrigins: [`chrome-extension://${EXTENSION_ID}/`], cliPath: copilotPath }, null, 2));
    await writeFile(join(stageHost, `${HOST_NAME}.json`), JSON.stringify({
      name: HOST_NAME,
      description: "ADO Boost local Copilot native host",
      path: join(hostDir, "ado-boost-native-host.exe"),
      type: "stdio",
      allowed_origins: [`chrome-extension://${EXTENSION_ID}/`]
    }, null, 2));
    const marker = JSON.stringify(createMarker(EXTENSION_ID, HOST_NAME), null, 2);
    await writeFile(join(stageExtension, markerName), marker);
    await writeFile(join(stageHost, markerName), marker);
    try {
      if (await exists(extensionDir)) await rename(extensionDir, backupExtension);
      if (await exists(hostDir)) await rename(hostDir, backupHost);
      await rename(stageExtension, extensionDir);
      movedExtension = true;
      await rename(stageHost, hostDir);
      movedHost = true;
      await exec("reg.exe", ["add", registryKey, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"]);
    } catch (error) {
      if (movedExtension) await rm(extensionDir, { recursive: true, force: true });
      if (movedHost) await rm(hostDir, { recursive: true, force: true });
      if (await exists(backupExtension)) await rename(backupExtension, extensionDir);
      if (await exists(backupHost)) await rename(backupHost, hostDir);
      throw error;
    }
  });
  await rm(backupExtension, { recursive: true, force: true });
  await rm(backupHost, { recursive: true, force: true });
  console.log("Setup complete. Load the unpacked extension folder shown above in Edge.");
}

async function doctor(): Promise<void> {
  const checks: Array<[string, () => Promise<unknown>]> = [
    ["Node runtime", () => access(process.execPath, constants.X_OK)],
    ["Copilot CLI", async () => exec(await findCopilot(), ["--version"])],
    ["Prebuilt extension", () => validateExtensionDirectory(join(packageRoot, "prebuilt-extension"))],
    ["Installed extension", () => validateExtensionDirectory(extensionDir)],
    ["Native host manifest", async () => JSON.parse(await readFile(manifestPath, "utf8"))],
    ["Edge registry", () => exec("reg.exe", ["query", registryKey, "/ve"])]
  ];
  for (const [name, check] of checks) {
    try {
      const result = await check();
      const output = result && typeof result === "object" && "stdout" in result ? String((result as { stdout: string }).stdout).trim() : "";
      console.log(`OK   ${name}${output ? `: ${output.split(/\r?\n/)[0]}` : ""}`);
    } catch {
      console.log(`MISS ${name}`);
    }
  }
  console.log("Environment tokens, npm authentication, and proxy credentials are never copied into host configuration.");
}

async function uninstall(confirmed: boolean): Promise<void> {
  await assertOwnedDirectory(hostDir, false);
  const currentRegistry = await queryRegistryDefault(false);
  assertOwnedRegistry(currentRegistry, manifestPath);
  console.log(`Remove registry key: ${registryKey}`);
  console.log(`Remove host folder: ${hostDir}`);
  if (!confirmed && !await confirm("Unregister and remove the ADO Boost native host?")) return;
  await exec("reg.exe", ["delete", registryKey, "/f"]);
  await rm(hostDir, { recursive: true, force: true });
  console.log("Native host removed. The unpacked extension folder was preserved.");
}

async function validatePackagedExtension(): Promise<void> {
  await validateExtensionDirectory(join(packageRoot, "prebuilt-extension"));
}

async function validateExtensionDirectory(directory: string): Promise<void> {
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as { key?: unknown };
  if (typeof manifest.key !== "string") throw new Error("Prebuilt extension manifest has no deterministic public key");
  const actual = extensionIdFromManifestKey(manifest.key);
  if (actual !== EXTENSION_ID) throw new Error(`Prebuilt extension ID ${actual} does not match expected ID ${EXTENSION_ID}`);
}

async function assertOwnedDirectory(path: string, allowMissing = true): Promise<void> {
  if (!await exists(path)) {
    if (allowMissing) return;
    throw new Error(`Owned installation folder is missing: ${path}`);
  }
  const marker = JSON.parse(await readFile(join(path, markerName), "utf8"));
  assertOwnedMarker(marker, EXTENSION_ID, HOST_NAME);
}

async function queryRegistryDefault(allowMissing: boolean): Promise<string | null> {
  try {
    const result = await exec("reg.exe", ["query", registryKey, "/ve"]);
    const match = result.stdout.match(/REG_SZ\s+(.+)\s*$/m);
    if (!match?.[1]) throw new Error("Native host registry value has an unexpected format");
    return match[1].trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (allowMissing && /unable to find|not found|cannot find/i.test(detail)) return null;
    throw new Error(`Cannot read native host registry ownership: ${detail}`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function findCopilot(): Promise<string> {
  if (process.env.COPILOT_CLI_PATH) {
    await access(process.env.COPILOT_CLI_PATH, constants.X_OK);
    return process.env.COPILOT_CLI_PATH;
  }
  const result = await exec("where.exe", ["copilot.exe"]);
  const path = result.stdout.split(/\r?\n/).find(Boolean);
  if (!path) throw new Error("Copilot CLI was not found. Install and sign in to GitHub Copilot CLI first.");
  return path.trim();
}

async function runCopilot(command: string[]): Promise<void> {
  const child = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const process = child.spawn(findCopilotSync(), command, { stdio: "inherit", shell: false });
    process.once("error", reject);
    process.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Copilot CLI exited with code ${code}`)));
  });
}

function findCopilotSync(): string {
  return process.env.COPILOT_CLI_PATH ?? "copilot.exe";
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(`${question} [y/N] `);
  prompt.close();
  return answer.trim().toLowerCase() === "y";
}
