import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSetupOutput } from "../src/setup-output.js";

const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

beforeEach(() => {
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  if (originalIsTTY) Object.defineProperty(process.stdout, "isTTY", originalIsTTY);
  else Reflect.deleteProperty(process.stdout, "isTTY");
});

describe("setup output", () => {
  it("spaces sections and aligns details without coloring ordinary text", () => {
    const lines: string[] = [];
    const output = createSetupOutput({ writeLine: (line) => lines.push(line), color: false });
    output.section("Runtime", 2);
    output.detail("Node runtime", "C:\\node.exe");
    output.detail("Copilot CLI", "C:\\copilot.exe");
    output.detail("Native host folder", "C:\\host");
    output.line();
    output.success("Setup complete.");
    expect(lines).toEqual([
      "", "  Runtime",
      "    Node runtime:        C:\\node.exe",
      "    Copilot CLI:         C:\\copilot.exe",
      "    Native host folder:  C:\\host",
      "", "", "Setup complete."
    ]);
  });

  it("limits color to cyan headings and green success messages", () => {
    const writeLine = vi.fn();
    const output = createSetupOutput({ writeLine, color: true });
    output.section("Runtime");
    output.detail("Node runtime", "C:\\node.exe");
    output.success("Setup complete.");
    expect(writeLine.mock.calls.map(([line]) => line)).toEqual([
      "", "\u001b[36mRuntime\u001b[0m",
      "    Node runtime:        C:\\node.exe",
      "", "\u001b[32mSetup complete.\u001b[0m"
    ]);
  });

  it.each(["NO_COLOR", "TERM"])("disables automatic color for %s", (variable) => {
    vi.stubEnv(variable, variable === "NO_COLOR" ? "1" : "dumb");
    const writeLine = vi.fn();
    const output = createSetupOutput({ writeLine });
    output.section("Runtime");
    output.success("Setup complete.");
    expect(writeLine.mock.calls.flat().join("\n")).not.toContain("\u001b[");
  });

  it("keeps redirected output plain", () => {
    const writeLine = vi.fn();
    vi.stubEnv("NO_COLOR", "");
    vi.stubEnv("TERM", "xterm");
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: false });
    const output = createSetupOutput({ writeLine });
    output.section("Runtime");
    expect(writeLine).toHaveBeenLastCalledWith("Runtime");
  });

  it("animates while work is pending and clears the indicator before returning", async () => {
    vi.useFakeTimers();
    const writeStatus = vi.fn();
    const writeLine = vi.fn();
    const output = createSetupOutput({ writeLine, writeStatus, interactive: true, color: false });
    const pending = output.progress("Checking local installation", async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return "ready";
    });
    expect(writeStatus).toHaveBeenLastCalledWith("\r  | Checking local installation...");
    await vi.advanceTimersByTimeAsync(100);
    expect(writeStatus).toHaveBeenLastCalledWith("\r  / Checking local installation...");
    await vi.advanceTimersByTimeAsync(150);
    await expect(pending).resolves.toBe("ready");
    expect(writeStatus).toHaveBeenLastCalledWith("\r\u001b[2K");
    expect(vi.getTimerCount()).toBe(0);
    expect(writeLine).not.toHaveBeenCalled();
  });

  it("clears the indicator and propagates failures", async () => {
    vi.useFakeTimers();
    const writeStatus = vi.fn();
    const output = createSetupOutput({ writeStatus, interactive: true, color: false });
    const error = new Error("Sign-in check failed");
    await expect(output.progress("Checking Copilot sign-in", async () => { throw error; })).rejects.toBe(error);
    expect(writeStatus).toHaveBeenLastCalledWith("\r\u001b[2K");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([true, false])("uses one plain status line without animation when work succeeds=%s", async (succeeds) => {
    vi.useFakeTimers();
    const writeLine = vi.fn();
    const writeStatus = vi.fn();
    const output = createSetupOutput({ writeLine, writeStatus, interactive: false });
    const error = new Error("Check failed");
    const pending = output.progress("Finding Copilot accounts", async () => {
      if (!succeeds) throw error;
      return "ready";
    });
    if (succeeds) await expect(pending).resolves.toBe("ready");
    else await expect(pending).rejects.toBe(error);
    expect(writeLine).toHaveBeenCalledExactlyOnceWith("  Finding Copilot accounts...");
    expect(writeStatus).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
