import { afterEach, describe, expect, it, vi } from "vitest";

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
afterEach(() => {
  process.argv = originalArgv;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("setup completion instructions", () => {
  it.each([false, true])("only skips browser installation guidance when fromExtension=%s", async (fromExtension) => {
    vi.stubEnv("LOCALAPPDATA", "C:\\ado-boost-test");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    process.argv = ["node", "cli.js", "setup", "--yes", ...(fromExtension ? ["--from-extension"] : [])];
    await import("../src/cli.js");
    expect(log).toHaveBeenLastCalledWith(fromExtension ? "Setup complete." : "Setup complete. Load the unpacked extension folder shown above in Edge.");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Edge registry key:"));
  });
});
