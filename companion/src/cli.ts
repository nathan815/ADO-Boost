import { access, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { CopilotClient } from "@github/copilot-sdk";
import { assertOwnedMarker, assertOwnedRegistry, createMarker, extensionIdFromManifestKey } from "./ownership.js";
import { withStagingDirectory } from "./staging.js";
import { accountEnvironment, accountSchema, availableAccounts, companionEnvironment, readJsonIfPresent, type CopilotAccount } from "./accounts.js";
import { resolveSetupAccount } from "./setup-account.js";
import { createSetupOutput } from "./setup-output.js";

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
const setupOutput = createSetupOutput();

class PromptCancelledError extends Error {}

try {
  switch (args[0]) {
    case "setup":
      await setup(args.includes("--yes"), args.includes("--from-extension"));
      break;
    case "doctor":
      await doctor();
      break;
    case "login": {
      const host = option("--host");
      await runCopilot(["login", ...(host ? ["--host", host] : [])]);
      break;
    }
    case "uninstall-host":
      await uninstall(args.includes("--yes"));
      break;
    default:
      console.log("Usage: ado-boost <setup|doctor|login|uninstall-host> [--yes] [--account <username>] [--host <github.com|enterprise.ghe.com>] [--from-extension]");
  }
} catch (error) {
  if (!(error instanceof PromptCancelledError)) throw error;
  setupOutput.line("\nCancelled.");
  process.exitCode = 130;
}

async function setup(confirmed: boolean, fromExtension: boolean): Promise<void> {
  setupOutput.section("Copilot setup");
  setupOutput.line("  Checks sign-in, pins your Copilot account, and registers the local host.");
  setupOutput.line("  Review the per-user file locations and account below before installation.");
  setupOutput.line();
  const nodePath = process.execPath;
  const { copilotPath, previous, copilotHome } = await setupOutput.progress("Checking local installation", async () => {
    const copilotPath = await findCopilot();
    await validatePackagedExtension();
    await assertOwnedDirectory(extensionDir);
    await assertOwnedDirectory(hostDir);
    const existingRegistry = await queryRegistryDefault(true);
    assertOwnedRegistry(existingRegistry, manifestPath);
    const previous = await readJsonIfPresent(join(hostDir, "host-config.json"));
    const previousHome = previous && typeof previous === "object" && "copilotHome" in previous && typeof previous.copilotHome === "string" ? previous.copilotHome : undefined;
    const copilotHome = resolve(process.env.COPILOT_HOME ?? previousHome ?? join(homedir(), ".copilot"));
    return { copilotPath, previous, copilotHome };
  });
  const account = await chooseAccount(previous, copilotHome);
  setupOutput.section("Files and registration", 2);
  setupOutput.detail("Extension folder", extensionDir);
  setupOutput.detail("Native host folder", hostDir);
  setupOutput.detail("Extension ID", EXTENSION_ID);
  setupOutput.line("    Edge registry key:");
  setupOutput.line(`      ${registryKey}`);
  setupOutput.section("Runtime", 2);
  setupOutput.detail("Node runtime", nodePath);
  setupOutput.detail("Copilot CLI", copilotPath);
  setupOutput.section("Copilot account", 2);
  setupOutput.detail("Pinned account", `${account.login} (${account.host})`);
  setupOutput.line();
  if (!confirmed && !await confirm("  Install these per-user files and register the Edge native host?")) return;
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
    await cp(join(root, "host.js"), join(stageHost, "host.js"));
    const stageConfigPath = join(stageHost, "host-config.json");
    await writeFile(join(stageHost, "launcher.json"), JSON.stringify({ nodePath, hostPath: join(hostDir, "host.js"), configPath: join(hostDir, "host-config.json") }, null, 2));
    await writeFile(stageConfigPath, JSON.stringify({
      allowedOrigins: [`chrome-extension://${EXTENSION_ID}/`],
      cliPath: copilotPath,
      copilotHome,
      account
    }, null, 2));
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
  setupOutput.success("Setup complete.");
  setupOutput.section("Next steps");
  if (!fromExtension) {
    setupOutput.line("  1. Open edge://extensions and enable Developer mode.");
    setupOutput.line("  2. Select Load unpacked and choose:");
    setupOutput.line(`     ${extensionDir}`);
    setupOutput.line("  3. Go back to your browser and enable the desired Copilot features in ADO Boost settings.");
  } else {
    setupOutput.line("  Go back to your browser and enable the desired Copilot features in ADO Boost settings.");
  }
}

async function doctor(): Promise<void> {
  const checks: Array<[string, () => Promise<unknown>]> = [
    ["Node runtime", () => access(process.execPath, constants.X_OK)],
    ["Copilot CLI", async () => exec(await findCopilot(), ["--version"])],
    ["Prebuilt extension", () => validateExtensionDirectory(join(packageRoot, "prebuilt-extension"))],
    ["Installed extension", () => validateExtensionDirectory(extensionDir)],
    ["Native host runtime", () => access(join(hostDir, "host.js"), constants.R_OK)],
    ["Native host manifest", async () => JSON.parse(await readFile(manifestPath, "utf8"))],
    ["Pinned Copilot account", async () => {
      const config = await readJsonIfPresent(join(hostDir, "host-config.json"));
      const account = accountSchema.parse(config && typeof config === "object" && "account" in config ? config.account : undefined);
      return { stdout: `${account.login} (${account.host})` };
    }],
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

async function runCopilot(command: string[], copilotHome?: string): Promise<void> {
  const child = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const process = child.spawn(findCopilotSync(), command, { stdio: "inherit", shell: false, env: { ...companionEnvironment(globalThis.process.env), ...(copilotHome ? { COPILOT_HOME: copilotHome } : {}) } });
    process.once("error", reject);
    process.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Copilot CLI exited with code ${code}`)));
  });
}

function findCopilotSync(): string {
  return process.env.COPILOT_CLI_PATH ?? "copilot.exe";
}

async function chooseAccount(previous: unknown, copilotHome: string): Promise<CopilotAccount> {
  const login = option("--account");
  const host = option("--host") ?? "github.com";
  if (!login && option("--host")) throw new Error("--host requires --account");
  const preferred = login ? accountSchema.parse({ login, host })
    : previous && typeof previous === "object" && "account" in previous && previous.account !== undefined ? accountSchema.parse(previous.account) : undefined;
  return resolveSetupAccount(preferred, {
    accounts: () => setupOutput.progress("Finding Copilot accounts", () => availableAccounts(copilotHome)),
    interactive: Boolean(process.stdin.isTTY) && !args.includes("--yes"),
    confirm,
    choose: promptAccount,
    login: (host) => runCopilot(["login", ...(host !== "https://github.com" ? ["--host", host] : [])], copilotHome),
    verify: (account) => setupOutput.progress(`Checking Copilot sign-in for ${account.login}`, async () => {
      const client = new CopilotClient({
        cliPath: await findCopilot(), useStdio: true, useLoggedInUser: true, logLevel: "error",
        env: await accountEnvironment(join(installRoot, "copilot-profiles"), account, { ...process.env, COPILOT_HOME: copilotHome })
      });
      try {
        await client.start();
        return await client.getAuthStatus();
      } finally {
        await client.forceStop();
      }
    })
  });
}

async function promptAccount(accounts: CopilotAccount[]): Promise<CopilotAccount> {
  setupOutput.section("Choose a Copilot account", 2);
  accounts.forEach((account, index) => setupOutput.line(`    ${index + 1}. ${account.login} (${account.host})`));
  setupOutput.line();
  const answer = await askQuestion("  Choose the Copilot account number to pin: ");
  const index = Number(answer.trim()) - 1;
  const account = Number.isInteger(index) ? accounts[index] : undefined;
  if (!account) throw new Error("Invalid account selection. Setup was not changed.");
  return account;
}

function option(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const answer = await askQuestion(`${question} [y/N] `);
  return answer.trim().toLowerCase() === "y";
}

async function askQuestion(question: string): Promise<string> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const cancellation = new AbortController();
  prompt.once("SIGINT", () => cancellation.abort());
  try {
    return await prompt.question(question, { signal: cancellation.signal });
  } catch (error) {
    if (cancellation.signal.aborted && error instanceof Error && error.name === "AbortError") {
      throw new PromptCancelledError();
    }
    throw error;
  } finally {
    prompt.close();
  }
}
