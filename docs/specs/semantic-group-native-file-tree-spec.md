# Semantic groups in the native PR file tree

**Status:** Locked design, implemented behind the default-off Copilot semantic groups setting. Native integration uses guarded, reversible compatibility adapters.

**Date:** October 21, 2026.

**Tracking:** [Issue #5: Integrate semantic groups into the native PR file tree](https://github.com/nathan815/ADO-Boost/issues/5).

## Summary

Make semantic groups a first-class organization mode for Azure DevOps' existing changed-file tree. Each group is an expandable root containing a filtered projection of the PR's existing folder hierarchy. Files remain native ADO files, with their original paths, reviewed state, diff navigation, and line-count decorations.

Group headers use a distinct grouping icon rather than a folder icon. A native Bolt tooltip presents the group title, a longer explanation, and its file count. Group roots and their descendants sit one native indentation step farther left than the initial prototype, while retaining normal relative indentation within each group.

Live spikes established the native rendering contracts. The implementation adds comparison-scoped shared state, explicit generation confirmation, independent tree and summary projections, native discussion-wrapper lookup coordination, and reversible ownership. Undocumented ADO host contracts remain a compatibility boundary, not a supported extension API.

## Current implementation

The panel and native tree share one `SemanticGroupState` per analyzed PR comparison. Generating or regenerating groups requires an explicit action and context confirmation. Successful generation activates All files (N) with groups inline. The panel retains safe group explanations and real-file links as a fallback if native integration becomes unavailable.

Relevant implementation surfaces:

| Surface | Responsibility |
| --- | --- |
| `src/ui/review-panel.ts` | Context confirmation, bounded generation requests, explanations, and native file links. |
| `src/core/types.ts` | `SemanticGroupProposal`, `ReviewGroup`, `FileStat`, and comparison identity. |
| `src/core/semantic-groups.ts` | Shared comparison-scoped state and request epochs; validates bounded results, rejects unknown or duplicate paths, and retains omitted files. |
| `src/core/copilot-gateway.ts` | Companion requests for semantic grouping. |
| `src/features/registry.ts` | Default-off `copilotSemanticGroups` feature and its dependency on native tree enhancements. |
| `src/content/native-pr-enhancer.ts` | Content-side coordination of native tree enhancements and existing navigation controls. |
| `src/native-tree/client.ts` and `src/native-tree/protocol.ts` | Validated isolated-world to MAIN-world tree configuration. |
| `src/native-tree/host.ts` and `src/native-tree/adapter.ts` | Guarded host discovery, native filtering, count rendering, and reversible adapter ownership. |
| `src/native-tree/semantic-host.ts` | Shape-checked explorer, splitter, navigation, and already-loaded Bolt component discovery. |
| `src/native-tree/semantic-projection.ts` | Bounded, nonmutating hierarchy projection and independent summary collections. |
| `src/native-tree/semantic-adapter.ts` | Group roots, folder scope, selection, discussion lookup, navigation, and cleanup. |
| `src/native-tree/semantic-toolbar.ts` | The locked native Dropdown, explanations, generation action, and scoped styling. |
| `src/native-tree/navigation.ts` | Selection of real native changed-file items. |

The [SPA integration guidance](../spa-integration-and-ui-resources.md) remains applicable. Observed React, Bolt, provider, and navigation contracts are not supported browser-extension APIs.

## Agreed UX direction

The following direction was accepted during the live design exploration:

1. Semantic groups should appear as expandable roots in the actual native file tree, not only as a separate list.
2. Each group should preserve the existing folder structure beneath it. A folder can appear in several groups, but an individual changed file belongs to only one group.
3. Group explanations are valuable and must remain available. A short title alone, as in a filter-only design, is insufficient.
4. Group roots should have a grouping-specific icon and a rich tooltip, preferably ADO's native Bolt tooltip.
5. Synthetic group identifiers must not appear as fake file paths in tooltips.
6. Remove one visual indentation step from the grouped presentation. Group roots should start closer to the left edge, with ordinary folder and file indentation beneath them.

Use a single native Bolt Dropdown above the tree, with a small styled **Copilot Groups** label above it on the left and a **Regenerate** action right-aligned on the same line, replacing the earlier ADO Boost attribution. No dot separator is needed. Remove the separate Standard / Semantic Groups toggle. Keep this sticky area compact: no repeated Files heading or changed-file total, normal status/help text, prototype footer, Restore link, preceding Group label, or sparkle.

Use ADO's primary text color for the Copilot Groups label so it reads as a heading rather than a link and adapts to the host theme. Keep Regenerate in the host action color.

Regenerate is a deliberate generation action, separate from selecting a presentation or group. It opens the existing panel confirmation flow. It does not send metadata or excerpts until confirmation. During generation the action is disabled and shows Grouping...; a failure is visible without discarding the previous result.

The dropdown contains **All files (N)** first, **All files (N) with groups inline** second, then the individual semantic groups. Both all-files options use the current native file count for N. All files uses the ordinary native folder hierarchy; the inline option displays all semantic groups as expandable roots; selecting an individual group filters the ordinary folder hierarchy by membership. Keep the dropdown visible in every presentation so it is always possible to leave the inline view.

Keep all options in one uninterrupted list. A native divider and a small Groups header were explored, including a compact styling pass, but were removed from the selected design.

The selector box's theme-aware background extends across the native scrollbar gutter. A matching background strip on the scroll container follows the selector's actual position and height, including wrapped group explanations, without widening the controls or changing the native scrollbar. Remove the strip and its observers when the toolbar is disposed.

Its closed state shows the selected title and any applicable count. All files has no description in the menu and uses a normal single-line row without extra description padding. All files (N) with groups inline uses the menu description “Show Copilot groups within the file tree”. Individual group options retain their wrapping explanations beneath their titles/counts. Below the closed selector, show a description only when an individual group is selected, never for either all-files option.

Use Bolt's native menu-cell padding for every option, without additional vertical padding around the custom title/description content. Descriptions may wrap naturally, but should not introduce a second layer of row padding.

Before the first result, the selector shows All files and Regenerate remains available. All files (N) with groups inline and group choices appear after generation. All files remains available without a companion connection. Results and view/expansion state are session-local, not persisted across page reloads.

## Selected experience

### Organization modes

Both the presentation choice and the active group filter live in the branded native dropdown described above. The ordinary folder tree must remain available, including when the companion is unavailable or native grouping contracts become incompatible. Changing the selected option changes presentation or review scope, not the underlying analyzed membership model.

Earlier spikes explored custom segmented buttons and a published Bolt ButtonGroup with actual host Button components. Bolt ButtonGroup only supplies layout; the spike managed pressed state and native primary styling itself. That alternative produced two 32px buttons with the native 8px gap. The unified dropdown supersedes both toggle variants.

Choosing All files clears group membership filtering and folder scope. Choosing an individual group restores the native folder presentation with that group's membership filter. Choosing All files (N) with groups inline shows all group roots, not just the previously selected group's files. Both presentations ship together and consume the same validated membership and explanation model.

Switching presentation must not send PR context to a model, regenerate results, alter native reviewed state, or reload the page.

### Tree shape

For each group, retain only the branches containing that group's changed files. Preserve native folder names and already-compacted folder chains instead of flattening paths or inventing a new directory layout.

Illustrative example, not content from the investigated PR:

```text
Session refresh (3)
  src/auth
    session-manager.ts
    token-store.ts
  tests/auth
    session-manager.test.ts

Request retry handling (3)
  src/http
    retry-policy.ts
    api-client.ts
  tests/http
    retry-policy.test.ts
```

Folders are presentation nodes and may be repeated under different groups. Files are not duplicated across groups. Preserve file identity, full path, change kind, diff counts, reviewed observables, and any applicable discussion context.

Do not add another repository-root row merely to wrap the semantic groups. Preserve any meaningful root or compacted path already present in ADO's tree. Empty projected branches are removed.

### Group header and explanation

A group header contains an expansion control, a grouping icon, a concise title, and a file count. Use the same semantic icon for all groups in the initial version; generated content does not select icons or provide executable rendering instructions.

Hovering or keyboard-focusing the group label exposes a tooltip with:

| Element | Content |
| --- | --- |
| Heading | Group title, emphasized. |
| Subtext | The full group rationale, wrapping across lines. |
| Supporting line | Changed-file count and an indication that this is a semantic group. |

Use ADO's existing Bolt Tooltip component and its `renderContent` callback where the guarded native contract is available. Keep `text` meaningful as an accessible/plain-text alternative. The live component also exposed `showOnFocus`, `addAriaDescribedBy`, and `delayMs`.

Use native tooltip positioning, dismissal, portal, and theme behavior. The implementation uses a 300px maximum content width and normal wrapping, with 13px semibold title, 12px explanation, and 11px supporting text. The title has 6px of lower spacing and the supporting line has 8px of upper spacing. All text inherits the tooltip's own foreground, with relative opacity for secondary content; page-level `secondary-text` classes can select an incompatible foreground on the tooltip's contrasting background. Descriptions must not depend on a native browser `title` attribute, which does not support styled subtext.

The tooltip is descriptive, not an interactive menu. Escape must dismiss it. Full touch, viewport, theme, and assistive-technology coverage remains host-dependent. An individual selected group's explanation is also shown beneath the selector; neither all-files option shows a description there.

### Group icon

The spike successfully rendered a small layers SVG through the native Icon component's `render` callback. The SVG inherited `currentColor` and occupied the normal icon slot. This avoids making semantic groups look like actual repository folders.

An attempted named `GroupedList` icon produced a class without a visible glyph in the investigated host. Do not assume an arbitrary icon name is registered merely because the Icon component accepts it. Use a verified native icon or a trusted extension-owned SVG through the observed rendering hook.

Ordinary folders and files retain their existing native icons.

### Indentation

The native indentation increment observed in the live tree was 16px. The accepted adjustment shifts the grouped presentation, including its roots and all descendants, 16px left relative to the initial grouped spike. Consecutive ancestor levels still differ by the normal native indentation increment.

This is a visual adjustment only. Do not decrement provider depths, change parent relationships, or produce an invalid root `aria-level` to accomplish it.

The spike used an owned attribute and narrowly scoped CSS:

```css
.repos-file-explorer-tree[data-adopp-compact-groups] .bolt-tree-cell {
  overflow: visible;
}

.repos-file-explorer-tree[data-adopp-compact-groups] .bolt-tree-cell > .bolt-table-cell-content {
  margin-inline-start: -16px;
}
```

This records the tested mechanism, not a requirement to copy it unchanged into production. The initial negative margin alone clipped the root expansion control behind the preceding cell. Allowing overflow on the scoped name cell restored its visibility and hit testing.

Production styling must verify that the shifted contents do not overlap native reviewed checkboxes, menus, focus rings, horizontal scrolling, or neighboring cells. Never apply these rules globally to ADO tables, and remove them when grouped mode is disabled or disposed.

### Native behavior and synthetic roots

Leaf activation uses ADO's existing handler with the real native change object. Group activation expands or collapses the presentation node; it must not navigate to a synthetic repository path.

Synthetic roots must not inherit native file/folder reviewed checkboxes or server-backed context menus just because the prototype borrowed a folder-shaped data object. The tooltip spike removed those controls from semantic roots while preserving native controls on real items.

An explicit group-wide review action, if ever added, is separate scope. Rendering a synthetic root is not permission to mark its descendants reviewed.

## Live investigation findings

The investigation used an authenticated PR in the dedicated extension-testing Chrome profile. The installed extension was already present. Temporary MAIN-world scripts exercised native host objects; these scripts were compatibility spikes, not a built or shipped implementation of semantic grouping.

The following table records historical spikes, not the final implementation status. The test membership separated implementation files from test files to make the projection easy to inspect. It was not generated by Copilot and did not evaluate grouping quality. Private PR identifiers, source paths, screenshots, and source contents are deliberately excluded from this repository document.

| Investigation | Observed result | Limitation |
| --- | --- | --- |
| Flat semantic roots | Two roots held all 11 files, split 6 and 5. Existing file-count decorations remained, and native activation opened a file. | The first flat spike lost selection highlighting. |
| Native membership filtering | Passing a five-file subset through the original native processor produced a five-file collection and corresponding native tree leaves. | This was a detached builder check, not a complete live group-filter UI. |
| Standard-view group filter | The live toolbar selected all 11 files, 6 implementation files, or 5 coverage files with the original folder hierarchy, and remembered the selected group across mode switches. | This UI spike projects provider roots only; it does not integrate the production native comparison/filter pipeline. |
| Native Dropdown | Reused already-loaded host Bolt Dropdown, selection, expandable button, table cell, and Portal components. Menu options displayed wrapping explanations beneath title/count; the closed button stayed 24px tall. Pointer opening and option selection worked. | Host component discovery and mounting are diagnostic, not a production integration contract. Inline portals need explicit pointer events because the native portal container defaults to pointer-events none. Full keyboard, accessibility, theme, and viewport coverage remains outstanding. |
| Native ButtonGroup | Published Bolt ButtonGroup with host Button components displayed native spacing and primary styling. Pointer switching updated pressed state, showed two semantic roots, hid the Standard filter, and restored that filter on return. | Group selection is spike-owned behavior. Preserve existing fragment children when adding a portal; nesting a replacement fragment can remount the host tree and detach manually inserted UI. |
| Unified branded selector | Removed the toggle, added the Copilot Groups · ADO Boost label, and placed Inline groups second in the native dropdown. Native DOM handlers selected the 5-file coverage filter, all 11 files, and both inline group roots; the selector stayed visible throughout. | This remains a provider-presentation spike. Folder summary diffs still use the authoritative unfiltered comparison; that consistency issue must be solved for individual group filters as well as group-scoped inline folders. |
| Provider behavior | A detached instance of ADO's actual `TreeItemProvider` flattened, collapsed, and expanded synthetic roots. | Detached success does not establish live selection or lifecycle correctness. |
| Nested semantic roots | Two roots contained 6 implementation files across 7 existing folder nodes and 5 test files across 6 folder nodes. | Validated one host and one comparison. |
| Exact ancestry | All 11 projected files retained their original ancestor path sequence below the new semantic root. | No additional path-compaction algorithm was evaluated. |
| Native identities | Projected leaves retained the native change-data object used by `changesByPath`; the live comparison collection remained unchanged. | Native tree wrappers were cloned. Shared data identity alone does not guarantee discussion integration correctness. |
| Nested expansion | Fully expanded projection contained 26 rows; collapsing one tested folder reduced it to 24, and collapsing the implementation group reduced it to 13. Re-expansion restored 26 rows. | Full keyboard, scrolling, and virtualization coverage remains outstanding. |
| Nested file selection | Clicking a native file row opened its diff and showed the expected native selection range. | Does not prove selection restoration across every collapse, filter, remount, or regeneration. |
| Rich explanation | The existing Bolt Tooltip rendered a heading, wrapping rationale, and file-count subtext. Hover and keyboard-focus invocation were exercised. | Full accessibility, theme, touch, long-content, and placement coverage remains outstanding. |
| Tooltip identity | The visible tooltip no longer exposed the synthetic group path. | Other possible identity leaks still require negative tests. |
| Semantic icon | Native `Icon.render` displayed a trusted layers SVG. | Named-icon availability varies by host. |
| Compact indentation | Root and descendant labels shifted left by 16px while native depths and root ARIA level remained unchanged. Expansion-control visibility and normal 16px relative spacing were checked. | Broader overlap and layout coverage remains outstanding. |
| In-place reparenting follow-up | A naive follow-up probe stalled and required reloading the tab. | Root cause was not established. Do not treat the prototype as a safe reparenting recipe. |

Earlier spikes were restored and the native tree was checked for its original 22 provider nodes and 11 files. Later visual iterations removed the visible Restore control as part of the locked design. Temporary spike hooks and styles are page-local and are cleared by a reload. No native reviewed checkbox, comment publication, vote, or other server-write action was exercised.

## Native contracts and implementation implications

### Provider and wrapper ownership

The observed native explorer constructs a `TreeItemProvider` from the current collection's `rootTreeItem.childItems`. Its flattened rows carry `depth`, `parentItem`, and `underlyingItem`; underlying nodes carry `data`, optional `childItems`, and expansion state.

The explorer, the tree, and discussion integration can share the provider object. The provider is more than an array of visible rows: it also maintains root items, an item-to-row map, and observable table items.

Build projections off to the side and validate them before attachment. Clone presentation wrappers rather than mutating or reparenting the original hierarchy. Reuse native change-data objects for file leaves, but explicitly handle mutable descendants and discussion rows. Do not overwrite native iteration caches or the comparison's root hierarchy merely to change tree presentation.

The inspected provider's batch splice implementation inserted additions before removing old nodes. Reusing the same wrapper objects across old and new hierarchies can therefore corrupt its item map during a seemingly simple replacement. Both shared-node replacement and intermediate empty-state updates need deliberate lifecycle handling; the follow-up spike did not settle that design.

The native discussion widget caches file wrappers separately from its provider reference. The adapter reversibly resolves `findFileItem` against the active projected files while semantic presentation is active. Native thread changes are carried back to the source file wrappers before switching or disposal. This preserves native discussion state without sharing mutable projected wrappers or introducing another discussion store. An incompatible discussion lookup disables semantic integration instead of attaching a partially functional tree.

### Selection and navigation

Native activation unwraps the row's underlying data and passes it to the native navigation service. Selection highlighting is index-based and can require reconciliation after projection changes.

The navigation service's observed next/previous traversal reads the comparison collection's original root hierarchy, not merely the provider's displayed order. A visual regrouping therefore does not automatically produce semantic next/previous order.

Keep these behaviors distinct:

| Behavior | Required invariant |
| --- | --- |
| File click | Opens the real file and native diff context. |
| Selection highlight | Identifies the selected real file in the currently displayed projection. |
| Expansion for selection | Reveals the projected ancestor chain without applying stale native row indices. |
| Next/previous navigation | Uses a deliberately chosen, consistent ordering rather than accidentally mixing native and semantic orders. |
| Discussion deep link | Resolves the real file/thread and exposes its projected ancestors when possible. |

Next/previous retains native repository order. In an individual group it traverses only that group's currently visible files; the inline view can move between groups in native order. A file selected through another native surface outside an individual group returns the selector to All files rather than leaving an invisible selection. Synthetic roots only expand/collapse. Folder selection uses group context to distinguish repeated paths under different roots.

### React rendering and virtualized rows

Use the already-loaded host React module for element creation and cloning. Native cell renderers already compose Icon, Tooltip, expansion controls, checkboxes, and file menus. Customize only semantic-root cells and leave native file rendering delegated to the original callbacks.

The spike wrapped the explorer's deferred render callbacks to reach the Tree's column definitions. Simply changing column callbacks or forcing the explorer to update did not refresh already-cached virtualized row observers. A guarded wrapper around the mounted Table render refreshed List row keys so the custom group renderers mounted.

This matches the existing count adapter's finding that the Tree uses its own columns and the List caches row observers. Production integration should coordinate through the existing adapter instead of layering independent render wrappers with competing ownership. Keep row-key functions stable during ordinary renders and invalidate them only when the relevant projection or rendering revision changes.

No production implementation should patch a global React function, module loader, or Fiber state. Shape-based discovery is an observation mechanism, not permission to mutate framework internals.

### Rich tooltip and icon rendering

The native group-label renderer created a Tooltip whose plain `text` was the folder's `path`. Borrowing a folder-shaped object for a synthetic root therefore exposed the synthetic path on hover.

Replace the group tooltip's presentation props, not the file's real path or the group identity. The observed native Tooltip supports `renderContent()`, so the extension can supply safe React text elements for title, explanation, and count while leaving Bolt's positioning and lifecycle intact. Keep a meaningful plain-text value for non-rich use.

The native Icon supports a `render(className)` callback. A trusted inline SVG can use the normal icon slot and inherited color without depending on an unregistered icon name.

Group titles and rationales are untrusted model output. Render them as text, never raw HTML. Only extension-owned code supplies React callbacks, SVG markup, event handlers, and styles.

### Membership and folder-summary filtering

Changing only provider roots does not filter ADO's folder summary. Native folder activation identifies a repository path, not a semantic root, and the summary normally resolves that path against every change in the comparison. A folder repeated under two groups therefore showed both groups' files in the original spike.

The implementation keeps three separate responsibilities:

| Surface | Collection or scope |
| --- | --- |
| Authoritative native comparison | ADO's complete currently filtered collection, including its normal keyword, reviewed, discussion, and extension metadata predicates. Raw iteration caches are untouched. |
| File-tree provider | Original roots for All files, a pruned hierarchy for an individual group, or independent cloned hierarchies beneath all inline semantic roots. |
| Native summary viewer | An independent pruned collection with matching `rootTreeItem`, `treeItemsByPath`, `changesByPath`, count, and key. Only the native splitter's flexible/summary pane receives it. |

In an individual group, both tree and summary always use that group's membership. In the inline view, activating a folder records the owning group and supplies the summary with that group's collection. ADO then applies the real folder path within that subset. Selecting the same path under the other group changes scope even though the folder's native data identity is shared. Other inline roots remain present and navigable.

Activating the native repository summary clears inline folder scope. File activation preserves native file data and infers its owning group. Native collection rebuilds discard scoped collection caches; late or mismatched comparisons never receive old groups. An empty intersection is an explicitly empty group, not an unfiltered fallback.

Do not pass a reduced raw response into `updateChanges`: that method stores the response in the iteration cache and updates all-changed-path state. Existing metadata filtering still copies `changeEntries` before processing; semantic filtering does not overwrite the cache or rewrite the authoritative root hierarchy.

Membership/result revisions invalidate projected rows and summary collections even for equal-size groups. Unknown or partially loaded native changes are not silently removed: semantic presentation becomes unavailable with an explicit explanation, ordinary native browsing stays intact, and panel results remain accessible.

## Implementation design

### Shared state and boundaries

Move the generated-group result needed by the native tree out of panel-only state into a small comparison-scoped state owner accessible to the relevant controllers. Reuse existing types, validation, dependency injection, and lifecycle patterns rather than introducing a new framework or a second review-state store.

Separate the responsibilities enough to test them independently:

| Responsibility | Expected behavior |
| --- | --- |
| Semantic-group state | Holds validated membership, explanations, comparison identity, generation status, and result revision. |
| Projection builder | Builds pruned wrapper hierarchies from native roots and group membership without mutating inputs. |
| Native adapter | Attaches the projection, customizes root rendering, coordinates row invalidation, and restores owned hooks. |
| Native navigation coordination | Resolves selected files and threads into visible projected ancestry. |
| Toolbar/panel UI | Presents mode and generation controls, privacy confirmation, status, and errors. |

These are responsibilities, not a mandate for one class or file per row.

The MAIN-world bridge receives only bounded declarative data: comparison identity, presentation mode, group IDs, titles, rationales, membership paths, and a result revision. Validate message structure and membership before applying a projection. Never send executable render functions, arbitrary SVG/HTML, secrets, or storage access through the page-visible channel. Keep model requests and extension storage outside the MAIN-world adapter.

### Group identity and comparison scope

Validated group IDs incorporate proposal position and title and are scoped to a result revision. Every successful generation increments the revision, selects All files (N) with groups inline, and resets projected expansion matching. Ordinary view switches retain group/path expansion state; All files retains its native hierarchy's expansion.

Key active results to the full PR and analyzed comparison, including source/base identity, not only the PR number or selected iteration label. Do not attach old groups to a newly loaded comparison. Cancel or ignore late generation results whose comparison is no longer active.

Switching presentation preserves a visible selected real file and reveals its ancestors. Selecting a group that excludes the current file opens that group's repository summary. Compatible native collection rebuilds restore a selected file by path only when it is still visible. Results and expansion state are not persisted across reloads. Regeneration never changes native reviewed state.

### Filtering and counts

Validate coverage against the complete analyzed changed-file set, then intersect membership with the native currently visible collection. This preserves native keyword, reviewed, and discussion filters alongside ADO Boost predicates.

Empty inline roots and empty branches are omitted while filters are active. Menu choices remain available, including groups with no matching files. Reduced counts use `2 of 6` rather than implying that the original group contains only two files. An individual zero-result group shows an explicit no-matches message and remains possible to clear.

Derive reviewed progress, if included, from native state rather than a separate semantic-group persistence system. Progress badges were discussed but are not required by the accepted header design.

Keep omitted files visible under the validator's unassigned group. Incompatible native items, unknown metadata, partial loading, or unresolved changes must not disappear silently. Establish explicit coverage and pagination behavior before enabling grouping on a partially loaded comparison.

### Lifecycle and fallback

Mount and reconcile only against the active PR, compatible Files view, matching comparison, and validated result revision. Guard discovery by object shape, bound traversal, and use native host modules only when already available.

On a compatible native collection rebuild, rebuild the projection from the fresh native hierarchy rather than carrying old leaf objects into the new collection. Preserve selection by real identity and restore visible ancestors after attachment.

Dispose projection subscriptions, callbacks, tooltip instances, owned styles/attributes, and UI controls on route changes, disablement, comparison changes, and host replacement. Restore a patched property only if the adapter still owns its current value; never overwrite a newer host or adapter callback.

If grouping contracts fail, report the limitation explicitly and restore ordinary folder browsing. Keep companion results and explanations accessible through an appropriate existing fallback surface. A failure to render a tooltip or custom icon should not make real files inaccessible. Never fall back to reparenting React-owned DOM rows or CSS-hiding unmatched native rows.

Generation and regeneration remain explicit, privacy-confirmed actions. Missing or stale results, companion failures, and native compatibility failures must have distinct visible states rather than success-shaped empty trees.

## Out of scope for the initial integration

- A replacement extension-owned file tree.
- A second reviewed-state or discussion-persistence system.
- Automatic generation when a PR opens, filters change, or views switch.
- Manual group membership editing, renaming, drag/reorder, or multi-group file duplication.
- Model-supplied icons, HTML, or executable presentation code.
- Group-wide server review actions.
- Treating the live spike scripts as a production implementation.

## Acceptance and validation

The feature is not complete when group rows merely appear. Validate the following through focused unit/component coverage and the actual installed extension in the dedicated Chrome profile.

| Area | Acceptance criteria |
| --- | --- |
| Coverage | Every analyzed changed file appears once before filtering; omitted paths remain visible in the unassigned group; invalid and duplicate proposals are rejected. |
| Projection | Original input wrappers are not mutated; each retained file preserves native data identity and exact ancestor sequence; repeated folder branches are independent presentation wrappers. |
| Controls | Native folders, files, checkboxes, menus, diff counts, and file activation remain functional. Synthetic roots expose only appropriate local controls. |
| Icons | Group icons are visibly rendered, distinct from folders, inherit native colors, and do not depend on an unverified named glyph. |
| Tooltips | Native rich tooltip shows the title, complete wrapping explanation, and count; fake paths are absent; hover, focus, Escape, long text, themes, and viewport edges behave correctly. |
| Indentation | Grouped view is shifted left one native step; relative nesting, valid ARIA levels, expand-control hit testing, checkbox separation, focus rings, and horizontal scrolling remain intact. |
| Selection | File selection survives presentation changes and compatible rebuilds; collapse/reopen, filtering, deep links, and regeneration do not leave stale highlights or row indices. |
| Navigation | Next/previous ordering follows the chosen policy consistently; no synthetic group identifier is sent to native file navigation or a server operation. |
| Native filters | Keyword, reviewed, and discussion filters compose with extension predicates and membership; equal-size membership changes refresh the result. |
| Discussions | Existing and newly loaded discussion rows, thread filtering, selected-thread links, and native integration subscriptions remain correct. No comments are posted as part of testing. |
| Comparisons | Source/base changes and late generation responses cannot reuse stale memberships, wrappers, counts, or expansion mappings. |
| Lifecycle | Files/Overview transitions, host remounts, repeated enable/disable, master disablement, generation failure, and compatibility failure leave native browsing usable and remove owned hooks. |
| Scale | Large and deeply nested trees, offscreen rows, repeated scrolling, and partial/paginated changes do not lose files, corrupt maps, or continually recreate row observers. |
| Privacy | Generation uses existing explicit confirmation; grouping presentation makes no model request and introduces no server writes. |

The prototype's successful nested selection does not waive the earlier selection failure or the stalled reparenting probe. Include regression cases for both. Unit tests alone are insufficient for the undocumented host contracts; injected scripts alone are insufficient for installed-extension validation.

## Compatibility and limits

The bridge accepts at most 20,000 analyzed files and 200 groups, including unassigned changes. Generation accepts at most 199 proposed groups so there is room for the unassigned fallback. Group titles are limited to 300 characters, rationales to 8,000, IDs to 1,024, paths to 8,192, and visible error messages to 1,000. Membership must uniquely cover every analyzed path, and the selected group must exist. Hierarchy traversal is cycle-checked and limited to 100 levels and 100,000 native nodes, including discussion descendants.

Already-loaded host Dropdown, ExpandableButton, selection, and cell components provide the selector. The extension's public ReactDOM portal factory creates only a portal descriptor; ADO's renderer owns the host elements. No second React root, global React patch, module-loader patch, or Fiber mutation is used.

Host discovery and deferred render contracts can change with ADO deployments. Semantic integration fails open independently of metadata filters and diff counts, with an unavailable explanation and the sidebar fallback. Comparison mismatch clears shared results and invalidates pending generation; returning to All Changes permits a fresh explicit generation rather than reviving stale groups.

Automated coverage includes native folder scoping, exact group membership, equal-size switches, hierarchy identity, bounded/cyclic input, native discussion lookup, empty groups, selection, raw-cache preservation, strict bridge validation, request staleness, and privacy-gated action routing. Full touch/assistive-technology coverage, every ADO deployment, and large paginated real PRs are not claimed.

## Installed-extension validation

The source-backed extension was built and reloaded through browser-level CDP in the dedicated authenticated Chrome profile. The final checks used a clearly labeled local declarative membership fixture against the installed MAIN-world adapter, not injected replacement renderers and not model-generated results. The real content-side Regenerate action separately opened the existing context-confirmation dialog; it was cancelled without sending PR content.

The same native folder path selected under the two inline roots produced exactly the corresponding six-file and five-file summary memberships. Both semantic roots stayed visible, selection identified the correct root, and the authoritative comparison and raw iteration cache retained all eleven changes. Individual-group selection produced the matching pruned hierarchy, count, summary, and below-selector explanation.

A local metadata-filter fixture forced a native collection rebuild and an empty selected-group intersection. The selector remained mounted, showed `0 of 6` and the no-matches explanation, and supplied a genuinely empty summary while the native filtered comparison retained five files and its raw cache retained eleven. Clearing the predicate recovered All files and the complete eleven-file summary. This check caught and resolved a remount race: restoring an old explorer can synchronously commit its replacement, so attachment waits for the current connected native tree and reconciliation retries after commit.

The final rich tooltip's computed sizes were 13px, 12px, and 11px, with the documented 6px/8px spacing and one inherited foreground color rather than a conflicting page-level secondary color. Native icons and rich-tooltip labels rendered for both roots. A Files-to-Overview transition longer than the compatibility timeout removed owned tree controls; returning to Files restored one selector with active status.

Background physical-pointer delivery was inconsistent in this profile. Inspected native DOM handlers were used for reliable option and hover checks; these results do not claim complete physical-pointer or scrolling coverage. A native keyword-input attempt did not update ADO's filter state through background automation, so keyword composition is covered by existing native-adapter tests rather than claimed as a successful browser interaction. No reviewed-state writes, comments, votes, or other service writes were used.

## Investigation artifacts

The local session contains the standalone mockup, flat/nested live captures, and the `nested-tree-spike.js`, `nested-tree-tooltip-spike.js`, and `nested-tree-indent-spike.js` diagnostic scripts. They document exploratory mechanics and are not extension entry points, release artifacts, or portable tests.

Do not copy authenticated PR captures or private source paths into this repository or the public issue. Recreate examples using synthetic data for future committed fixtures. Temporary prototype hooks should be removed with their owned restore control or by reloading the inspected page when interactive exploration ends.
