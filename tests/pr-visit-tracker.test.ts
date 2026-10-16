import { describe, expect, it, vi } from "vitest";
import { PrVisitTracker } from "../src/content/pr-visit-tracker";

const pr = "https://dev.azure.com/org/project/_git/repo/pullrequest/42";
const list = "https://dev.azure.com/org/project/_git/repo/pullrequests";

describe("PR visit navigation", () => {
  it("records the initial page independently of review analysis", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    await new PrVisitTracker(record).update(new URL(pr), true);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ organization: "org", pullRequestId: 42 }));
  });

  it("ignores file/tab/query/hash changes and settings rerenders", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const tracker = new PrVisitTracker(record);
    for (const suffix of ["", "?_a=files", "?_a=files&path=%2Ffile.ts", "#discussion", "/overview", ""]) {
      await tracker.update(new URL(pr + suffix), true);
    }
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("records returns from another PR or a non-PR route", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const tracker = new PrVisitTracker(record);
    for (const url of [pr, pr.replace("42", "43"), pr, list, pr]) await tracker.update(new URL(url), true);
    expect(record).toHaveBeenCalledTimes(4);
  });

  it("does not record while disabled, but records the current PR after enabling", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const tracker = new PrVisitTracker(record);
    await tracker.update(new URL(pr), false);
    expect(record).not.toHaveBeenCalled();
    await tracker.update(new URL(pr), true);
    await tracker.update(new URL(pr), false);
    await tracker.update(new URL(pr), true);
    expect(record).toHaveBeenCalledTimes(2);
  });

  it("propagates recording errors without retrying on every mutation", async () => {
    const record = vi.fn().mockRejectedValue(new Error("Storage unavailable"));
    const tracker = new PrVisitTracker(record);
    await expect(tracker.update(new URL(pr), true)).rejects.toThrow("Storage unavailable");
    await tracker.update(new URL(pr), true);
    expect(record).toHaveBeenCalledTimes(1);
  });
});
