import { describe, expect, it } from "vitest";
import { reconcileReviewRecords } from "../src/core/review-state";

describe("reconcileReviewRecords", () => {
  it("retains review state when an iteration changes but file content does not", () => {
    const result = reconcileReviewRecords(
      [{ trackingId: 1, path: "/a.ts", changeType: "edit", objectId: "same" }],
      [{ trackingId: 1, objectId: "same", reviewedAt: "2026-01-01" }]
    );
    expect(result.retained).toHaveLength(1);
    expect(result.invalidated).toEqual([]);
  });

  it("invalidates review state when the tracked blob changes", () => {
    const result = reconcileReviewRecords(
      [{ trackingId: 1, path: "/a.ts", changeType: "edit", objectId: "new" }],
      [{ trackingId: 1, objectId: "old", reviewedAt: "2026-01-01" }]
    );
    expect(result.retained).toEqual([]);
    expect(result.invalidated).toEqual([1]);
  });
});
