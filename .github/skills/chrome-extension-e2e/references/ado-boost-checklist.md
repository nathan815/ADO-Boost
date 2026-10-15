# ADO Boost installed-extension acceptance checks

Use a user-provided, accessible PR in the dedicated debug profile. Do not bake internal PR URLs, customer data, account names, credentials, or machine-specific repository paths into the skill. The examples below assume 12 total files and 3 TypeScript files; derive real expectations from the chosen PR.

## Baseline and colors

1. Select the intended Files tab and compatible latest-iteration merge-base comparison.
2. Wait for `[data-adopp-react-stat]` and enabled `.adopp-native-dropdown-trigger` controls.
3. Confirm **Change type**, **File type**, and **Options** are regular ADO-styled buttons next to `.repos-compare-filter`.
4. Confirm `[data-adopp-total-file-count]` shows `12 changed files` without filters. Normal status is quiet, with no lower summary or duplicate search/reviewed controls.
5. Inspect actual computed colors on `.adopp-native-stat-plus` and `.adopp-native-stat-minus`; additions and deletions should use distinct theme-aware colors, not just carry CSS classes.
6. Confirm there are no `[data-adopp-inline-stat]` or `.adopp-native-hidden` nodes. Counts should come from React, not post-render DOM insertion.

Example small diagnostic:

```javascript
(() => {
  const badge = document.querySelector("[data-adopp-react-stat]");
  if (!badge) throw new Error("No native React count rendered");
  const plus = badge.querySelector(".adopp-native-stat-plus");
  const minus = badge.querySelector(".adopp-native-stat-minus");
  return {
    count: document.querySelector("[data-adopp-total-file-count]")?.textContent,
    text: badge.textContent,
    additionsColor: plus ? getComputedStyle(plus).color : null,
    deletionsColor: minus ? getComputedStyle(minus).color : null,
    legacyNodes: document.querySelectorAll("[data-adopp-inline-stat],.adopp-native-hidden").length
  };
})()
```

Binary/unavailable counts are labels, not fabricated `+0 -0` values. Partial numeric counts retain their incompleteness marker.

## Model filters and count formatting

1. Select a known file type using the actual dropdown. For the example PR, `.ts` should produce `3/12 changed files`.
2. Verify the native tree and diff/navigation model contain the expected files, not merely hidden rendered rows.
3. Compose a custom filter with ADO's keyword filter, then clear them independently. Use the native Filter UI rather than changing persistent reviewed checkboxes.
4. An active filter that matches every file still shows `12/12 changed files`. Clearing every filter restores `12 changed files`.
5. Test a zero-result combination: expect `0/12 changed files` and controls that remain mounted and usable to clear the filters.
6. Check change-type and generated/lockfile options against known PR metadata. Unmapped native entries should remain visible.
7. Verify the unfiltered cache and PR-wide analysis totals remain intact across filtering and clearing.

Native model/cache inspection is a read-only diagnostic, not the first interaction method. Discover the current host by runtime shape as documented in `docs\spa-integration-and-ui-resources.md`; do not hardcode minified names, Fiber depths, or attachment suffixes. Remove any temporary globals afterward.

## Virtualization and native behavior

Use a larger PR with a known file outside the initially rendered viewport. Filter to that file and confirm it appears, then clear the filter and confirm the full count returns. Check deleted files whose native `item.path` is null and identity comes from `originalPath`.

Exercise native ArrowDown/End/Home and folder expansion/collapse when relevant. Verify file selection still updates the SPA and next-unreviewed navigation still reads current native checkbox state without writing it.

Do not infer virtualized scrolling or pointer coverage from the number of badges currently in the DOM. A large PR can have hundreds of native model entries but only a few dozen materialized rows. Background-hidden Chrome tabs have sometimes ignored synthesized pointer actions; report that limitation rather than claiming a physical scrolling pass.

## Comparison and SPA lifecycle

- Switch to an iteration comparison: stale merge-base badges and extra predicates must not be applied. Native keyword/reviewed filters remain usable; the limitation is explicit.
- Return to the supported comparison and verify counts/filters recover.
- Visit Overview, wait long enough to exceed the former compatibility timeout, then return to Files. The integration should reattach, not remain permanently unavailable.
- Check header/tree remounts, including an empty result set. Expect one owned toolbar and one count label, not duplicates.

## Settings and restoration

Use an owned temporary extension-options tab and record original values before changing them. In the same profile, feature settings are shared by every open ADO tab; prefer a profile used only for the current test.

1. While an extra filter is active, disable **Native file filters**. Expect the full native model to return, custom controls to disappear, and React counts to remain.
2. Re-enable filters and verify the current filter behavior is coherent; clear it before finishing.
3. Disable **Native file-tree enhancements**. Expect native methods, the original file-count label, and unfiltered behavior to be restored; extension counts/toolbar disappear while the overall PR summary remains.
4. Re-enable enhancements. Expect a clean native reattachment, no duplicated badges, and no DOM fallback.
5. If relevant to the change, disable/re-enable the master switch. Re-enabling must create fresh content surfaces rather than update a disposed bridge.
6. Confirm settings no longer expose the retired experimental integration or extension-owned search toggles.

Restore every setting to its original value. Do not use **Restore defaults**, which would overwrite unrelated user preferences.

## Failure checks and cleanup

Incompatible host contracts must show a concise unavailable state and restore owned hooks. Count-rendering failure can disable counts independently of working model filters. Do not simulate host failure by corrupting a live authenticated page when a unit test covers the contract.

At the end, restore the original filters/comparison/selection and local settings, close only owned temporary tabs, and leave the dedicated profile intact. Keep scratch screenshots and logs outside the repository and avoid capturing unrelated tabs or full private diffs.
