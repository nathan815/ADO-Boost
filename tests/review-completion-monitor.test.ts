// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewCompletionMonitor } from "../src/ui/review-completion-monitor";

let monitor: ReviewCompletionMonitor | undefined;

afterEach(() => {
  monitor?.stop();
  monitor = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function fixture(check = vi.fn().mockResolvedValue(false)) {
  vi.useFakeTimers();
  const onError = vi.fn();
  monitor = new ReviewCompletionMonitor(check, onError);
  monitor.start();
  return { check, onError, monitor };
}

describe("Review completion monitoring", () => {
  it("checks on load without scheduling any recurring checks", async () => {
    const { check, monitor } = fixture();
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledOnce();
    monitor.start();
    await vi.advanceTimersByTimeAsync(60000);
    expect(check).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("checks when focus returns or the document becomes visible", async () => {
    const { check } = fixture();
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(check).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it("does not overlap slow checks", async () => {
    let release!: (finished: boolean) => void;
    const check = vi.fn(() => new Promise<boolean>((resolve) => { release = resolve; }));
    const { monitor } = fixture(check);
    monitor.refresh();
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(45000);
    expect(check).toHaveBeenCalledOnce();
    release(false);
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event("focus"));
    expect(check).toHaveBeenCalledTimes(2);
    release(false);
  });

  it("checks when explicitly refreshed after a review submission", async () => {
    const { check, monitor } = fixture();
    await vi.advanceTimersByTimeAsync(0);
    monitor.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops checks when there is no announcement or the owner disposes the monitor", async () => {
    const { check, monitor } = fixture(vi.fn().mockResolvedValue(true));
    await vi.advanceTimersByTimeAsync(30000);
    window.dispatchEvent(new Event("focus"));
    expect(check).toHaveBeenCalledOnce();
    check.mockResolvedValue(false);
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    monitor.stop();
    await vi.advanceTimersByTimeAsync(30000);
    window.dispatchEvent(new Event("focus"));
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("reports repeated failures once and retries on focus rather than on a timer", async () => {
    const { check, onError, monitor } = fixture(vi.fn().mockRejectedValue(new Error("Vote lookup failed")));
    await vi.advanceTimersByTimeAsync(0);
    for (let index = 0; index < 3; index++) {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(check).toHaveBeenCalledTimes(4);
    expect(onError).toHaveBeenCalledExactlyOnceWith("Vote lookup failed", expect.objectContaining({ message: "Vote lookup failed" }));
    await vi.advanceTimersByTimeAsync(60000);
    expect(check).toHaveBeenCalledTimes(4);
    monitor.stop();
    window.dispatchEvent(new Event("focus"));
    expect(check).toHaveBeenCalledTimes(4);
  });

  it("ignores a stale completion after the monitor is stopped and restarted", async () => {
    let release!: (finished: boolean) => void;
    const check = vi.fn<() => Promise<boolean>>()
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
      .mockResolvedValue(false);
    const { monitor } = fixture(check);
    monitor.stop();
    monitor.start();
    release(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it("does not show a late failure after disposal", async () => {
    let reject!: (error: Error) => void;
    const { onError, monitor } = fixture(vi.fn(() => new Promise<boolean>((_resolve, fail) => { reject = fail; })));
    monitor.stop();
    reject(new Error("Late failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).not.toHaveBeenCalled();
  });
});
