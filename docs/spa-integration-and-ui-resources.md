# SPA integration and Azure DevOps UI resources

This page records architectural guidance for ADO Boost and public resource links. It is not a claim that the current implementation satisfies every recommendation.

## Browser extension and SPA boundaries

Chrome extension content scripts run in an isolated JavaScript world while sharing the page DOM. DOM access does not make the host application's JavaScript objects or internal functions a supported extension API. Treat DOM integration as a compatibility boundary that may change when Azure DevOps updates.

Single-page applications introduce several lifecycle hazards: UI can arrive asynchronously or be replaced, routes can change without a document reload, frameworks own and reconcile markup, generated classes can change, and virtualized lists can reuse the same element for different files. A successful initial injection is therefore not enough.

Prefer small, extension-owned additions next to native controls rather than rewriting framework-controlled markup. Use stable attributes, accessible labels, and narrow selectors where available; avoid relying solely on generated classes or broad text matches. Keep selector assumptions explicit and handle missing targets without disrupting native behavior.

### Lifecycle and reconciliation checklist

1. Determine the active PR and view identity before mounting. Handle route changes with route-aware mount and unmount behavior, including navigation that does not reload the document.
2. Observe the smallest useful DOM subtree with targeted `MutationObserver` instances. Rediscover that subtree when the host replaces it rather than assuming the original container remains attached.
3. Batch observer work and reconcile idempotently: repeated runs should update existing additions, not duplicate controls or listeners.
4. Avoid mutation loops caused by extension changes. Mark extension-owned elements, ignore irrelevant mutations, and only write attributes or markup when their values need to change.
5. Refresh enhancements by file identity, not just element identity. When virtualization recycles a row, remove stale counts or filtering state and bind the additions to the file now represented by that row.
6. On view changes, remove owned components and clean up listeners and observers. Cancel or ignore stale asynchronous results so data from a previous PR or file cannot decorate the new view.

These are design and review criteria, not guarantees about all existing code paths.

## Native file-tree adapter

The native file-tree adapter is the only implementation for per-file counts and extra file filters, enabled by default through `groupedNavigation`. It uses instance-scoped integration into the observed native filtering and rendering pipeline without replacing the file tree. The former `nativeTreeIntegration` and extension-owned `fileSearch` settings are retired; settings migration ignores those saved keys while preserving navigation, filter, and noise-hiding preferences. Search and reviewed-state filtering use ADO's existing Filter control. There is no DOM badge insertion or CSS row-hiding implementation.

The bundled `native-tree.js` entry runs in the page's MAIN world. The existing isolated content script sends only bounded comparison/file metadata and extra filter choices through a strictly validated message protocol. The page bridge cannot access extension storage, native messaging, or review write gateways. Messages are page-visible, not a trusted authorization channel. The bundled validator uses Zod's `jitless` mode because the host CSP disallows dynamic code generation.

Runtime discovery follows React ownership metadata by shape, not minified component names, fixed Fiber depths, or generated attachment suffixes. The adapter does not mutate Fiber, replace a global React function, or patch the module loader. It uses the already-loaded AMD React module for element creation and cloning.

The observed native view service provides `getFilesFilter()`, `updateChanges`, and `processChanges`. Keyword filtering happens before collection construction; native reviewed/comment filters are applied in collection processing. Extra change-kind, extension, generated-file, and lockfile predicates filter a copied entry array before the original processor runs. Deleted native entries can have a null `item.path`; their `originalPath` supplies the identity. The iteration cache, pagination metadata, native checkbox state, and native selection/navigation processing remain owned by ADO. Unknown metadata is retained rather than guessed or silently hidden. Extra-filter updates invalidate the native cache key even when two result sets have equal sizes.

The native Tree uses its own column callback objects when rendering rows, so merely replacing the Table's `columns` prop is insufficient. The adapter wraps the mounted Table's render method and its instance-scoped name-column callback, returning native React elements with an added count. It clones the virtualized List element with a `getRowKey` function that remains stable across ordinary renders and refreshes when the native collection changes or the renderer reattaches. The observed List uses that prop to invalidate its cached row observers; native filter changes can otherwise populate those observers before decoration runs. This avoids remounting the entire List, mutating List state, or inserting count spans after React has rendered. Native file labels, expanders, reviewed checkboxes, menus, and selection handlers remain in the original renderer.

Model changes can replace the mounted Table. A bounded discovery interval reattaches the renderer without rebuilding or clearing the active filtered model. Leaving Files view restores the native model and waits without expiring the compatibility deadline, so returning after a long tab change can attach again. Disable/unmount restores only methods and callbacks still owned by the adapter and rebuilds from the native iteration cache. Re-enabling the extension recreates its disposed content surfaces and bridge subscription. A missing filtering contract stops the integration with an explicit status and no automatic CSS fallback. A missing count-rendering contract can disable counts independently.

Counts are displayed only when native iteration, source commit, and base commit match the analyzed merge-base comparison. Native keyword and reviewed-state filters remain available for other comparisons; extension counts and extra predicates must not present stale comparison data. Installed-extension Chrome checks covered 12-file and 198-file PRs, offscreen-file filtering, native filter resets, comparison switching, keyboard-driven virtualized navigation and folder collapse/expansion, tab remounts, and master disable/re-enable. Sustained pointer scrolling, cross-page pagination, and broader host compatibility are not release-certified; a write-disabled harness alone is not a substitute for extension installation testing. Disabling navigation restores the native methods and count label; disabling extra filters clears the adapter's predicates while retaining React-rendered counts.

## Native discussion drafts

Private review drafts remain authoritative in extension storage and are isolated by pull request, reviewer, and comparison identity. The isolated content script sends a bounded, validated projection to a separate MAIN-world discussion bridge. The page bridge cannot access extension storage or the review write gateway; it can request only local add, update, and remove mutations, which the isolated client validates before using the background-coordinated draft queue.

The bridge augments Azure DevOps' Overview, Files, and reply composer surfaces without intercepting publication. ADO's original primary action is relabeled **Post** but retains its original callback. The added **Add to review** action reads the active native editor and saves a local draft. The editor is cleared only after the authoritative draft projection returns, so a storage failure does not discard typed text.

Inline location discovery starts at the composer textarea's React ownership chain because ADO mounts the outer discussion host in a separate React root. The observed thread may be a plain thread or a model wrapping it in `props.thread`; both supply the file path and left/right line context. If that context is unavailable, **Add to review** displays an error and preserves the typed comment rather than silently doing nothing.

Composer actions read the visible Bolt textarea rather than its hidden sizing mirror, and cloned buttons do not retain the native primary button's ID. After an inline save closes the temporary native thread, local drafts render in Monaco view zones anchored after their exact source line in the original or modified editor. A ResizeObserver sizes each zone to its content, including local edits; offscreen zero measurements are ignored. Drafts at the same line and side are grouped newest-first. File changes, editor remounts, draft removal, and disable/disposal release the owned zones. Drafts are never inserted as flex-growing children above the diff. If the native editor is unavailable, drafts remain in the sidebar and the bridge reports the unavailable inline surface.

Inline drafts use ADO's native inline discussion container rather than the Overview feed's elevated card. Native thread backgrounds, width, border, padding, avatar/header alignment, and icon button styling are retained without a draft-specific tint. Edit and remove icons remain visible without hovering so draft actions stay discoverable. The timestamp and Draft badge identify local content; file path and direction remain stored but are not repeated in the inline header.

The owned view-zone node sits above Monaco's code-line layer so pointer events reach draft controls instead of the transparent code surface covering the zone. Draft content explicitly enables text selection to override Monaco's inherited `user-select: none`. Browser checks must exercise actual pointer interactions, not only DOM-triggered handlers, for inline editing, removal, and drag-to-select text.

Inline drafts also enter the Overview's native activity item provider as extension-owned rows. The activity owner's `renderItem` hook handles only those exact item objects and delegates every server activity unchanged; hooking the owner, rather than a transient list `renderRow` prop, preserves the integration across native parent rerenders. Native list virtualization and row keys remain in control. Reconciliation retains unchanged item/card identities and removes only owned entries on navigation, removal, disable, or disposal.

When a native file-comment activity is mounted, its guarded React component supplies the file header and the read-only, expandable code excerpt for the draft's original/modified line context. The projection replaces its discussion subtree, including deferred observer renders, before server-backed discussion controls can mount. Draft edit/remove actions still route only to the local queue. Native visibility handling and loading UI remain in control of the code preview. File links use the draft's file/line URL, never a synthetic server discussion ID. If no compatible native file activity is mounted, the draft still appears with its file link and an explicit code-preview limitation.

Projected drafts use native card and button styling, include an explicit **Draft** marker and private-state explanation, and are reconciled after SPA remounts. General drafts appear in the Overview activity feed, reply drafts appear in their server thread, and inline drafts appear both in Overview and in the selected file's line-anchored discussion surface. Projection entries are extension-owned and are never inserted into ADO's server thread collections or caches. When a compatible surface is unavailable, the existing review sidebar remains the fallback and the local draft is preserved.

Drafts include provenance metadata that currently distinguishes manual and Copilot-created suggestions. This phase does not add Copilot accept/reject controls; the shared projection leaves room for those actions without changing stored draft identity.

## ADO Boost native UI ownership

Retain Azure DevOps' native file selection, reviewed checkboxes and server persistence, and navigation. Augment the native changed-file tree with diff counts, filtering, and search controls, and place appropriate actions alongside the native toolbar. Keep the comments panel extension-owned as the complete fallback and queue-management surface. Native discussion augmentation is limited to extension-owned draft cards and composer actions; published comments, thread status, native rendering, and server persistence remain owned by Azure DevOps.

Native review state should remain authoritative; adding a second reviewed-checkbox or persistence system risks divergence from Azure DevOps. Similarly, enhancements should preserve native file links and controls instead of replacing the tree with a separate navigation model.

The discussion panel mounts as a sibling of `.repos-pr-details-page` in the native flex content region. It reserves its own width only while open and docked, stacks below the PR on narrow screens, and offers an explicit overlay toggle. A layout observer remounts it when ADO replaces that region; disposal removes owned layout attributes, styles, and listeners. A missing mount is logged explicitly and waits for native content rather than silently covering the page. The shell does not reparent or replace React-owned PR content.

The header renders published `azure-devops-ui` Button components with matching bundled core/button styles inside the panel's shadow root. Native click listeners bridge React 16's document-level event delegation across the shadow boundary. Other review controls remain extension-owned, using the same ADO theme tokens, spacing, typography, and button treatment. System theme follows ADO's inherited CSS variables rather than the operating system's color preference.

Sidebar header icons and its logo live in `src/ui/icons` as standalone SVG files. Vite's built-in `?raw` imports bundle their markup into JavaScript without additional plugins or runtime asset requests. The header renders only these trusted, bundled assets as inline SVG, preserving `currentColor` inheritance and shadow-root styling; do not pass user or server content to the raw-markup helper.

The shared Vite configuration suppresses the library's bare CSS side-effect imports in every build, while preserving explicit `?inline` imports for the shadow root. Allowing the component library to inject global CSS overrides the host's own Bolt controls, including split-button arrow widths. Component styles must never be appended to the page head.

The shadow root stops bubbling `keydown`, `keypress`, and `keyup` events before they reach ADO's document-level shortcut handlers. Otherwise shadow-DOM event retargeting makes an editor look like an ordinary div to ADO, and letters such as `e` trigger page navigation. This boundary does not prevent default input, clipboard, or focus behavior. ADO Boost's own capture-phase shortcuts use the composed event path to recognize input, select, textarea, and contenteditable targets.

Prefer native app navigation controls when selecting files or moving through a review. `history.pushState` plus a synthetic `popstate` event is not a universal router API: applications may depend on their own routing state, event handling, or navigation mechanisms. Neither DOM hooks nor discovered internal functions should be described as supported browser-extension APIs.

## Public Bolt UI and Azure DevOps resources

| Resource | What it provides and how to use it |
| --- | --- |
| [Official Azure DevOps UI documentation and component explorer](https://developer.microsoft.com/azure-devops) | Public UI documentation and component exploration; the rendered title was **Formula Design System**. Use it to understand native control patterns and styling rather than assuming every Bolt-related resource uses the same name. |
| [`azure-devops-ui` on npm](https://www.npmjs.com/package/azure-devops-ui) | The published React UI library. Consult the package and official documentation when evaluating components and styles. |
| [Official Azure DevOps extension sample](https://github.com/microsoft/azure-devops-extension-sample) | A sample for the supported Azure DevOps extension SDK and contribution model. That model is distinct from ADO Boost's browser-extension approach of augmenting the host DOM; the sample does not make host DOM hooks supported APIs. |
| [`azure-devops-ui-public`](https://github.com/microsoft/azure-devops-ui-public) | The fetched README points to the official documentation and an issue-reporting portal. It was not established as a full component-source repository; do not use that description. |

## Practical investigation sequence

Start with the public component explorer and published library to understand the intended native controls and visual patterns. Use public extension documentation to identify supported integration points, and distinguish observed browser behavior from documented API contracts. These resource links alone are not evidence of how a particular host implementation behaves.

For browser-extension changes, review the lifecycle checklist and native ownership boundaries before altering selectors or navigation behavior. Verify repeated reconciliation, route changes, replaced containers, and recycled file rows without replacing native selection or reviewed-state behavior.
