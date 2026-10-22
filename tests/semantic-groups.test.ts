import { describe, expect, it } from "vitest";
import { SemanticGroupState, validateSemanticGroups } from "../src/core/semantic-groups";
import type { FileStat } from "../src/core/types";

const files: FileStat[] = [
  { trackingId: 1, path: "/a.ts", changeType: "edit", objectId: "a", additions: 2, deletions: 1, state: "exact", generated: false, lockfile: false },
  { trackingId: 2, path: "/b.ts", changeType: "add", objectId: "b", additions: 3, deletions: 0, state: "exact", generated: false, lockfile: false }
];

describe("validateSemanticGroups", () => {
  it("preserves omitted files in a visible fallback group", () => {
    const groups = validateSemanticGroups(files, [{ title: "Core", rationale: "Main change", paths: ["/a.ts"] }]);
    expect(groups[0]?.source).toBe("copilot");
    expect(groups[1]).toMatchObject({ title: "Unassigned changes", source: "local" });
    expect(groups[1]?.files.map((file) => file.path)).toEqual(["/b.ts"]);
  });

  describe("comparison-scoped semantic state", () => {
    it("starts in All files, shares one result, and never generates on a view change", () => {
      const state = new SemanticGroupState();
      state.setEnabled(true);
      expect(state.view).toEqual({ mode: "all", groupId: null });
      const request = state.begin();
      state.complete(request, validateSemanticGroups(files, [{ title: "Core", rationale: "Related", paths: ["/a.ts"] }]));
      expect(state.view.mode).toBe("inline");
      state.select({ mode: "group", groupId: state.groups![0]!.id });
      expect(state.groups).toHaveLength(2);
      expect(state.busy).toBe(false);
      expect(state.revision).toBe(1);
      state.select({ mode: "group", groupId: "unknown" });
      expect(state.view.groupId).toBe(state.groups![0]!.id);
    });

    it("retains results on regeneration errors but rejects late results after a comparison change or disablement", () => {
      const state = new SemanticGroupState();
      state.setEnabled(true);
      const groups = validateSemanticGroups(files, []);
      state.complete(state.begin(), groups);
      const failed = state.begin();
      state.fail(failed, "Companion unavailable");
      expect(state.groups).toBe(groups);
      expect(state.error).toBe("Companion unavailable");
      const stale = state.begin();
      state.setAvailable(false);
      state.updateComparison(files);
      state.setAvailable(true);
      state.complete(stale, groups);
      expect(state.groups).toEqual(groups);
      expect(state.busy).toBe(false);
      const disabled = state.begin();
      state.setEnabled(false);
      state.setEnabled(true);
      state.complete(disabled, groups);
      expect(state.groups).toBeNull();
      expect(state.view.mode).toBe("all");
    });

    it("projects stale groups onto changed files without losing new paths or selected surviving groups", () => {
      const state = new SemanticGroupState();
      state.setEnabled(true);
      state.complete(state.begin(), validateSemanticGroups(files, [
        { title: "Core", rationale: "Original explanation", paths: ["/a.ts"] },
        { title: "Removed", rationale: "Removed", paths: ["/b.ts"] }
      ]));
      const id = state.groups![0]!.id;
      state.select({ mode: "group", groupId: id });
      const late = state.begin();
      const current = [{ ...files[0]!, additions: 20 }, { ...files[1]!, path: "/renamed.ts" }];
      state.updateComparison(current);
      expect(state.stale).toBe(true);
      expect(state.busy).toBe(false);
      expect(state.view).toEqual({ mode: "group", groupId: id });
      expect(state.groups?.map((group) => group.title)).toEqual(["Core", "Unassigned changes"]);
      expect(state.groups?.flatMap((group) => group.files)).toEqual(current);
      state.complete(late, validateSemanticGroups(files, []));
      expect(state.stale).toBe(true);
      state.fail(state.begin(), "Disconnected");
      expect(state.stale).toBe(true);
      state.complete(state.begin(), validateSemanticGroups(current, []));
      expect(state.stale).toBe(false);
    });

    it("retains visible groups when a newer iteration is detected without changing the native comparison", () => {
      const state = new SemanticGroupState();
      state.setEnabled(true);
      state.complete(state.begin(), validateSemanticGroups(files, []));
      const groups = state.groups;
      const request = state.begin();
      state.markStale();
      expect(state.groups).toBe(groups);
      expect(state.available).toBe(true);
      expect(state.stale).toBe(true);
      expect(state.isCurrent(request)).toBe(false);
      expect(state.busy).toBe(false);
      state.setEnabled(false);
      expect(state.stale).toBe(false);
    });

    it("resets a removed group selection and preserves a unique fallback across repeated iterations", () => {
      const state = new SemanticGroupState();
      state.setEnabled(true);
      state.complete(state.begin(), validateSemanticGroups(files, [{ title: "Core", rationale: "", paths: ["/a.ts"] }]));
      state.select({ mode: "group", groupId: state.groups![0]!.id });
      const next = [{ ...files[1]! }, { ...files[0]!, path: "/new.ts" }];
      state.updateComparison(next);
      state.updateComparison([...next, { ...files[0]!, path: "/another.ts" }]);
      expect(state.view).toEqual({ mode: "inline", groupId: null });
      expect(state.groups).toHaveLength(1);
      expect(state.groups?.[0]?.files.map((file) => file.path)).toEqual(["/b.ts", "/new.ts", "/another.ts"]);
    });

    it("bounds model text and group counts before sharing results with the native bridge", () => {
      expect(() => validateSemanticGroups(files, [{ title: "x".repeat(301), rationale: "", paths: ["/a.ts"] }])).toThrow("invalid title");
      expect(() => validateSemanticGroups(files, [{ title: "Core", rationale: "x".repeat(8001), paths: ["/a.ts"] }])).toThrow("explanation");
      expect(() => validateSemanticGroups(files, Array.from({ length: 200 }, () => ({ title: "Core", rationale: "", paths: [] })))).toThrow("too many");
    });
  });

  it("rejects unknown and duplicate paths", () => {
    expect(() => validateSemanticGroups(files, [{ title: "Bad", rationale: "Bad", paths: ["/missing.ts"] }])).toThrow("unknown");
    expect(() => validateSemanticGroups(files, [
      { title: "One", rationale: "One", paths: ["/a.ts"] },
      { title: "Two", rationale: "Two", paths: ["/a.ts"] }
    ])).toThrow("duplicate");
  });
});
