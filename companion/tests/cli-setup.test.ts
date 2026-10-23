import { afterEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline/promises";
import { resolveSetupAccount } from "../src/setup-account.js";

vi.mock("node:readline/promises", () => ({ createInterface: vi.fn() }));

vi.mock("node:fs/promises", () => ({
  access: vi.fn().mockRejectedValue(new Error("not found")),
  cp: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn().mockResolvedValue(JSON.stringify({ key: "fixture" })),
  rename: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn()
}));
vi.mock("node:child_process", () => ({
  execFile: vi.fn((file, args, callback) => {
    if (file === "reg.exe" && args[0] === "query") callback(new Error("not found"));
    else callback(null, { stdout: "C:\\tools\\copilot.exe" });
  })
}));
vi.mock("../src/ownership.js", () => ({
  assertOwnedMarker: vi.fn(),
  assertOwnedRegistry: vi.fn(),
  createMarker: vi.fn().mockReturnValue({}),
  extensionIdFromManifestKey: vi.fn().mockReturnValue("oldakfajnbllipnfdaghapeiofnciopo")
}));
vi.mock("../src/accounts.js", () => ({
  readJsonIfPresent: vi.fn().mockResolvedValue(null)
}));
vi.mock("../src/setup-account.js", () => ({
  resolveSetupAccount: vi.fn().mockResolvedValue({ login: "reviewer", host: "https://github.com" })
}));

const originalArgv = process.argv;
const originalExitCode = process.exitCode;
const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  if (originalIsTTY) Object.defineProperty(process.stdin, "isTTY", originalIsTTY);
  else Reflect.deleteProperty(process.stdin, "isTTY");
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.resetModules();
});

describe("setup completion instructions", () => {
  it("registers the requested extension in both allowlists and preserves IDs on repair", async () => {
    vi.stubEnv("LOCALAPPDATA", "C:\\ado-boost-test");
    vi.stubEnv("NO_COLOR", "1");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { writeFile } = await import("node:fs/promises");
    const { readJsonIfPresent } = await import("../src/accounts.js");
    const requestedId = "bfafgbohohbfioebcmbcehlnpcmakkbn";
    const savedOrigin = `chrome-extension://${"a".repeat(32)}/`;
    const defaultOrigin = "chrome-extension://oldakfajnbllipnfdaghapeiofnciopo/";
    vi.mocked(readJsonIfPresent).mockResolvedValueOnce({ allowedOrigins: [defaultOrigin, savedOrigin, defaultOrigin] });
    process.argv = ["node", "cli.js", "setup", "--yes", "--extension-id", requestedId];
    await import("../src/cli.js");
    function writtenJson(name: string) {
      const call = vi.mocked(writeFile).mock.calls.find(([path]) => String(path).endsWith(name));
      expect(call).toBeDefined();
      return JSON.parse(String(call![1]));
    }
    const expected = [defaultOrigin, savedOrigin, `chrome-extension://${requestedId}/`];
    expect(writtenJson("host-config.json").allowedOrigins).toEqual(expected);
    expect(writtenJson("com.adoboost.copilot.json").allowed_origins).toEqual(expected);
    expect(log.mock.calls.flat().join("\n")).toContain(requestedId);
    expect(log.mock.calls.flat().join("\n")).not.toContain("Load unpacked");
    vi.resetModules();
    vi.mocked(writeFile).mockClear();
    vi.mocked(readJsonIfPresent).mockResolvedValueOnce({ allowedOrigins: expected });
    process.argv = ["node", "cli.js", "setup", "--yes"];
    await import("../src/cli.js");
    expect(writtenJson("host-config.json").allowedOrigins).toEqual(expected);
    expect(writtenJson("com.adoboost.copilot.json").allowed_origins).toEqual(expected);
  });

  it.each(["", "short", "A".repeat(32), "q".repeat(32), "a".repeat(32) + "\n", "a".repeat(32) + ";whoami", "--yes"])("rejects invalid extension IDs before setup changes: %s", async (id) => {
    vi.stubEnv("LOCALAPPDATA", "C:\\ado-boost-test");
    process.argv = ["node", "cli.js", "setup", "--extension-id", id];
    await expect(import("../src/cli.js")).rejects.toThrow("--extension-id");
    const { cp, mkdir, writeFile } = await import("node:fs/promises");
    expect(cp).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("rejects saved wildcard origins rather than carrying them into registration", async () => {
    vi.stubEnv("LOCALAPPDATA", "C:\\ado-boost-test");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { readJsonIfPresent } = await import("../src/accounts.js");
    vi.mocked(readJsonIfPresent).mockResolvedValueOnce({ allowedOrigins: ["chrome-extension://*/"] });
    process.argv = ["node", "cli.js", "setup", "--yes"];
    await expect(import("../src/cli.js")).rejects.toThrow();
    const { writeFile } = await import("node:fs/promises");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it.each([undefined, "bfafgbohohbfioebcmbcehlnpcmakkbn"])("uses the extension ID to determine browser installation guidance: %s", async (extensionId) => {
    vi.stubEnv("LOCALAPPDATA", "C:\\ado-boost-test");
    vi.stubEnv("NO_COLOR", "1");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    process.argv = ["node", "cli.js", "setup", "--yes", ...(extensionId ? ["--extension-id", extensionId] : [])];
    await import("../src/cli.js");
    const lines = log.mock.calls.map(([line]) => line);
    expect(lines).toContain("Setup complete.");
    expect(lines).toContain("Copilot setup");
    expect(lines).toContain("  Checks sign-in, pins your Copilot account, and registers the local host.");
    expect(lines).toContain("  Checking local installation...");
    expect(lines).toContain("    Edge registry key:");
    expect(lines).toContain("  Files and registration");
    expect(lines).toContain("  Runtime");
    expect(lines).toContain("  Copilot account");
    expect(lines).toContain("    Pinned account:      reviewer (https://github.com)");
    expect(lines.indexOf("Next steps")).toBeGreaterThan(lines.indexOf("Setup complete."));
    expect(lines.join("\n").includes("edge://extensions")).toBe(!extensionId);
    expect(lines.join("\n").includes("Load unpacked")).toBe(!extensionId);
    expect(lines).toContain(`${extensionId ? "  " : "  3. "}Go back to your browser and enable the desired Copilot features in ADO Boost settings.`);
    expect(lines.join("\n")).not.toContain("\u001b[");
  });

  it("does not show success or next steps when installation fails", async () => {
    vi.stubEnv("LOCALAPPDATA", "C:\\ado-boost-test");
    vi.stubEnv("NO_COLOR", "1");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { cp } = await import("node:fs/promises");
    vi.mocked(cp).mockRejectedValueOnce(new Error("Copy failed"));
    process.argv = ["node", "cli.js", "setup", "--yes"];
    await expect(import("../src/cli.js")).rejects.toThrow("Copy failed");
    const lines = log.mock.calls.map(([line]) => line);
    expect(lines).not.toContain("Setup complete.");
    expect(lines).not.toContain("Next steps");
  });

  it.each(["account selection", "confirmation"])("cancels cleanly on Ctrl+C during %s", async (stage) => {
    vi.stubEnv("LOCALAPPDATA", "C:\\ado-boost-test");
    vi.stubEnv("NO_COLOR", "1");
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const readline = await vi.importActual<typeof import("node:readline/promises")>("node:readline/promises");
    const input = new PassThrough();
    const output = new PassThrough();
    const prompt = readline.createInterface({ input, output });
    const close = vi.spyOn(prompt, "close");
    vi.mocked(createInterface).mockImplementationOnce(() => {
      queueMicrotask(() => prompt.emit("SIGINT"));
      return prompt;
    });
    if (stage === "account selection") {
      vi.mocked(resolveSetupAccount).mockImplementationOnce((_preferred, dependencies) =>
        dependencies.choose([{ login: "reviewer", host: "https://github.com" }]));
    }
    process.argv = ["node", "cli.js", "setup"];
    try {
      await expect(import("../src/cli.js")).resolves.toBeDefined();
      expect(process.exitCode).toBe(130);
      expect(log).toHaveBeenLastCalledWith("\nCancelled.");
      expect(close).toHaveBeenCalled();
      const { cp, mkdir } = await import("node:fs/promises");
      expect(cp).not.toHaveBeenCalled();
      expect(mkdir).not.toHaveBeenCalled();
      expect(log.mock.calls.flat().join("\n")).not.toMatch(/Setup complete|Next steps|AbortError/);
    } finally {
      prompt.close();
      input.destroy();
      output.destroy();
    }
  });

  it("does not treat unrelated abort errors as user cancellation", async () => {
    vi.stubEnv("LOCALAPPDATA", "C:\\ado-boost-test");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = new DOMException("Account check aborted", "AbortError");
    vi.mocked(resolveSetupAccount).mockRejectedValueOnce(error);
    process.argv = ["node", "cli.js", "setup", "--yes"];
    await expect(import("../src/cli.js")).rejects.toBe(error);
    expect(process.exitCode).toBe(originalExitCode);
  });
});
