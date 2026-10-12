import { describe, expect, it } from "vitest";
import { SerialExecutor } from "../src/core/serial-executor";

describe("SerialExecutor", () => {
  it("serializes operations for the same pull request", async () => {
    const executor = new SerialExecutor();
    const events: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const first = executor.run("pr", async () => {
      events.push("first-start");
      await blocked;
      events.push("first-end");
    });
    const second = executor.run("pr", async () => {
      events.push("second-start");
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["first-start"]);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("allows independent pull requests to proceed concurrently", async () => {
    const executor = new SerialExecutor();
    const events: string[] = [];
    await Promise.all([
      executor.run("one", async () => { events.push("one"); }),
      executor.run("two", async () => { events.push("two"); })
    ]);
    expect(events.sort()).toEqual(["one", "two"]);
  });
});
