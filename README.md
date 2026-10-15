# ADO Boost

ADO Boost is an Edge-first Manifest V3 extension that adds reliable pull request size statistics directly to the native Azure DevOps pull request UI, enhances the existing changed-file tree, keeps discussions available in a focused side panel, and provides richer diffs, private feedback drafts, and a previewed Submit Review workflow.

The extension uses the signed-in Azure DevOps browser session. It does not require a PAT, extract credentials, send analytics, or store PR source content in browser sync storage.

## Current status

ADO Boost is a pre-release browser extension with automated tests and a synthetic offline fixture. The optional Windows native-messaging companion uses `@github/copilot-sdk` `0.2.2` and an installed GitHub Copilot CLI. Semantic grouping and bounded PR questions are disabled by default.

Browser loading, native-host registration, and live Copilot inference require separate manual integration testing before a production release.

## Features

### Reliable review statistics

- Overall and per-file added/removed line counts computed from the PR iteration source commit and common commit.
- Overall totals appear beside the native PR actions, and per-file totals appear inline in the native Azure DevOps changed-file tree.
- Explicit exact, partial, binary, unavailable, and error states. Missing data is never displayed as exact zero.
- CRLF normalization and terminal-newline-only change handling documented and tested against a normalized Git oracle.
- Bounded 2 MiB file analysis, bounded fetch concurrency, paginated change retrieval, and stale-result cancellation.
- Nullable API fields are accepted, numeric-string change tracking IDs are normalized, and change-entry schema mismatches are advisory warnings, never a reason to discard a record. Deleted-file paths are recovered from `originalPath` when available. Entries still lacking information needed for a diff are retained with their original JSON, listed as unresolved in the review panel, and logged to the console; overall totals remain visibly partial, and saved review progress is preserved. Essential repository, identity, commit, pagination, and write-confirmation data still requires validation.
- File-content fetch failures log console warnings with the file path, commit, base/source side, repository and PR IDs, and original error. Expected navigation cancellations do not produce warnings.
- Compact PR-list badges for visible rows.

### Native Azure DevOps review workspace

- Azure DevOps' **Filter** control handles search and reviewed-file filtering. ADO Boost's change-type, file-type, and **Options** buttons sit beside it and filter the native file model; additions and deletions are rendered in the tree by ADO's React instance.
- Hiding noise never changes the reported overall totals.
- All files returned by the paginated PR changes API are analyzed independently of scrolling or collapsed folders. The header shows the total PR file count without filters and matching/total counts with filters. Unresolved records and incomplete counts remain explicit.
- Filters run before ADO constructs its tree and diff/navigation model, including offscreen files. Unmapped native entries are retained rather than guessed or silently hidden. Azure DevOps retains ownership of folders, reviewed checkboxes, selection, and virtualization.
- Previous, next, next-unreviewed, and keyboard navigation reuse Azure DevOps' SPA file links without forcing a full page reload.
- Azure DevOps' existing server-backed reviewed checkboxes remain authoritative. ADO Boost does not render or synchronize a second reviewed-state system.
- The elevated `Review Assistant` button opens the discussions and review-tools side panel on completed PRs and after a review has started.

### Review coordination

- Start Reviewing renders a formatted Markdown announcement with the authenticated reviewer's name, the starting iteration, and attribution linking to the [ADO Boost](https://github.com/nathan815/ADO-Boost) browser extension, with a matching preview before confirmation.
- `Start Review` is integrated beside Azure DevOps' native Approve action with an ADO Boost action menu. After the review-start announcement succeeds, it becomes `Review Assistant` and retains its elevated styling.
- The review-start confirmation uses Azure DevOps' native Bolt dialog and button classes in the page DOM, inheriting the site's theme with keyboard focus containment, Escape dismissal, and focus restoration.
- The announcement is a normal Azure DevOps comment and does not change vote/status or guarantee notification delivery.
- Background-serialized writes prevent duplicate multi-tab announcements and submissions.
- Announcements include versioned JSON in a hidden HTML comment recording the reviewer ID, repository/PR IDs, start timestamp, and original iteration/source/target/merge-base commits. ADO Boost restores review-start status from the authenticated reviewer's matching PR comment when local state is missing, including in another browser. Older plain-text announcements are still recognized.
- Hidden metadata is not private or encrypted: anyone with PR access can read the comment source. Private drafts, settings, and submission receipts remain browser-local. The marker supports future schema versions; this version does not synchronize additional review state or update the comment automatically.
- Ambiguous network outcomes remain ambiguous unless exact operation evidence is found.

### Diffs and discussions

- Extension-owned unified and side-by-side diff layouts.
- Basic syntax highlighting, paired word emphasis, whitespace visualization, line numbers, inline-draft anchors, unchanged-context collapsing, and explicit large-diff preview limits.
- Merge-base and previous-iteration comparisons where a previous iteration exists.
- Active and resolved thread navigation with status and author filters, native file links, reply drafts, and explicitly confirmed resolve/reopen actions.
- Thread loading failures show an error and retry action instead of an empty-success state.

### Private review queue and Submit Review

- General, inline, and reply drafts stored locally and isolated by origin, repository, PR, and reviewer.
- Editable line and side anchors, draft editing, Markdown preview, Markdown copy export, and visible save/export errors.
- Previewed submission with optional overall summary and current vote display.
- Decisions: Comment only, Approve, Approve with suggestions, Wait for author, and Reject.
- Feedback is posted before a decision. A decision is applied only after every selected feedback item succeeds.
- Partial-delivery receipts preserve failed drafts and successful server IDs. Vote-only retry never replays feedback and requires a second confirmation.
- Fresh PR context, iteration identity, current file locations, feature settings, and draft presence are checked before writes.

## Build and test

Requirements:

- Node.js 20.19 or newer, or Node.js 22.12 or newer.
- npm.

Commands:

```powershell
npm ci --registry=https://registry.npmjs.org
npm run typecheck
npm test
npm run build
```

The unpacked extension is written to `.\dist`.

## Load the unpacked extension in Edge

Building the project does not install the extension.

1. Open `edge://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select `.\dist`.
5. Open an Azure DevOps pull request under `https://dev.azure.com/` or a legacy `https://<org>.visualstudio.com/` URL.

The project has not automatically loaded or installed the extension in any browser.

## Offline fixture

Run:

```powershell
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173/demo.html`. The page is visibly labeled **Synthetic offline fixture** and does not perform Azure DevOps writes.

## Isolated Chrome extension testing

Use the [Chrome extension E2E skill](.github/skills/chrome-extension-e2e/SKILL.md) to test the actual unpacked extension in a persistent, dedicated Chrome profile without touching your regular browser. It includes launch and CDP load/reload helpers plus the native-tree acceptance checklist, so routine updates do not require manually reloading the extension through `chrome://extensions`.

## Settings and feature flags

Open the extension's options page from the browser toolbar action, the gear button in the discussion rail, or the ADO Boost action menu beside Approve. Settings are centralized in a typed registry with stable IDs, dependency explanations, a master disable switch, searchable groups, and theme selection.

Core review features are enabled by default. Generated-file hiding, lockfile hiding, and all future AI capabilities are opt-in. Disabling a feature removes its controls and blocks its write entry points without deleting saved progress or drafts.

### Native tree integration

Native model filtering and React-rendered per-file counts are the only file-tree integration, enabled by default through **Native file-tree enhancements**. Use Azure DevOps' existing **Filter** control for keyword and reviewed/unreviewed filtering. ADO Boost's change-kind, extension, and noise filters sit beside that control, compose with native filters before tree construction, and affect the diff/navigation view too. The header shows `12 changed files` without filters and matching/total counts such as `5/12 changed files` when a filter is active, without a separate status summary above the tree. The old experimental toggle and extension-owned search/reviewed controls have been removed; saved experimental preferences no longer select a different implementation.

This integration uses guarded private Azure DevOps runtime interfaces, not supported extension APIs. Counts and extra filters require the analyzed latest-iteration merge-base comparison; another native comparison leaves native filters available and reports the limitation. Incompatible runtime interfaces show an explicit unavailable state and restore native behavior. There is no DOM badge or row-hiding implementation or fallback. Count-rendering failures can disable counts independently of working model filters. Disabling **Native file-tree enhancements** restores the original native behavior without affecting the PR summary; disabling **Native file filters** clears only ADO Boost's extra predicates.

Installed-extension Chrome checks exercised 12-file and 198-file native models, offscreen-file filtering, native/custom filter composition, comparison switching, keyboard navigation, tab remounting, and disable/re-enable. Broader host compatibility, sustained pointer scrolling, and cross-page pagination still need additional release coverage.

## Permissions and privacy

- `storage`: stores settings, content-aware review progress, private drafts, announcement receipts, and submission receipts in extension-local storage.
- Azure DevOps host access: reads PR metadata, iterations, changes, file content, threads, identity, and current vote through documented same-origin Azure DevOps REST APIs using the existing browser session.
- `nativeMessaging`: connects to the optional Windows companion when a Copilot feature is explicitly used.
- No extension telemetry, analytics, remote feature flags, PAT collection, or browser sync storage for PR content.
- Optional Copilot features send the explicitly previewed PR context through GitHub Copilot. They are not offline inference. Use them only when your organization's policies allow sending that content to Copilot.
- Real writes always require an explicit user action and preview. ADO Boost never automatically comments, votes, resolves threads, merges, or runs PR code.

## Comparison semantics and limits

Overall statistics compare the latest PR iteration against its common commit using Azure DevOps iteration changes with `$compareTo=0`. Text is normalized from CRLF or CR to LF, and a terminal-newline-only difference is ignored. This is intentionally a normalized text review count rather than a byte-exact raw Git `numstat`.

Files over 2 MiB, binaries, missing versions, and fetch failures are reported as incomplete states. The extension diff preview renders at most 5,000 rows and initially previews the first 500 rows for large files. Use Azure DevOps' native file view for content beyond those limits.

Azure DevOps review submission is not atomic. Comments may become visible individually before the final vote request. ADO Boost stops after the first failed feedback write, never blindly replays an ambiguous batch, and offers a decision-only retry only after all selected feedback is known to have posted.

## Optional Copilot companion

The Windows companion uses Edge native messaging, a real executable launcher, bounded length-prefixed JSON over stdio, an exact extension-origin allowlist, request IDs, cancellation, multiple-tab isolation, and owned child-process cleanup. It does not use a localhost listener, CORS, pairing tokens, an embedded daemon download, arbitrary shell commands, unrestricted agent tools, or automatic PR code execution.

Building the companion additionally requires Go. The npm package is Windows-only.

Build and package the companion with:

```powershell
npm --prefix companion ci --registry=https://registry.npmjs.org
npm --prefix companion run typecheck
npm --prefix companion test
npm run build
npm --prefix companion run build
npm --prefix companion run pack:local
```

After installing the resulting npm package, these commands are available:

```powershell
ado-boost doctor
ado-boost setup
ado-boost login
ado-boost uninstall-host
```

`setup` validates the deterministic extension ID, previews the stable extension folder, host folder, Copilot CLI path, and Edge registry key, then requires confirmation before copying files or changing the per-user registry. It refuses unowned installation folders or a native-host registry name that points to another manifest. Updates are staged and validated before the current owned folders move, and folder rollback occurs if replacement or registration fails. The user manually loads the stable unpacked extension folder in Edge. Edge starts the native host only when a default-off Copilot feature is explicitly used.

The host uses the SDK's documented `cliPath` integration with the installed Copilot CLI, the logged-in user authentication state, an isolated empty working directory, no custom or built-in tools, a deny-all permission handler, no configuration discovery, and a replacement system instruction that treats all PR content as untrusted data. Environment tokens, npm authentication, and proxy variables are stripped before the SDK-owned CLI child starts. Core extension features remain fully functional when the host is absent, not registered, unauthenticated, blocked by policy, or incompatible.

Before semantic grouping or chat, ADO Boost previews exactly which files will contribute bounded changed-line excerpts. The reviewer explicitly selects files. The payload includes all changed-file paths and counts plus at most 20 selected excerpts, 200 changed lines and 32 KB per file, and 128 KB total. Each changed line carries a `path`, line number, and left/original or right/new side; unavailable and truncated content is marked omitted. The host cannot read arbitrary repository files.

Semantic-group responses reject unknown and duplicate paths, keep omitted files visible in an **Unassigned changes** group, and cache only by the immutable PR comparison identity. Explicit regeneration bypasses that cache. Chat answers are displayed as suggestions and can only be copied into the private feedback queue; they never post automatically. Disabling the master switch or both Copilot capabilities disconnects the native port, rejects pending requests, closes browser stdio, and triggers owned SDK child cleanup in the native host.

## Public release preparation

```powershell
npm run typecheck
npm test
npm --prefix companion run typecheck
npm --prefix companion test
npm run pack:companion
npm run release:check
```

`release:check` scans source, all reachable Git history, and built extension and companion files for known internal references and credential patterns. It also checks package contents. It is a release guard, not a guarantee that arbitrary confidential information can be recognized automatically. Manually review changes before publishing.

Build outputs, archives, source maps, local configuration, and development metadata are excluded from source control. Release builds omit source maps and include license notices. Share the source repository or the generated `companion\ado-boost-companion-0.1.0.tgz`, not a ZIP of the entire working folder containing `.git` or `node_modules`.

The public history retains the development commit sequence with internal identities, session metadata, private package-feed references, developer-specific fixture data, and old generated archives removed. Historical commit IDs therefore differ from the original private repository.

Build and packaging commands do not install the extension, change the registry, post to a PR, or publish anything. Companion `setup`, `login`, and `uninstall-host` are explicit user-invoked installation and authentication commands.

## License

MIT; see [LICENSE](LICENSE). Bundled third-party notices are included in the built extension's `licenses` folder and companion package.

## Integration guidance and UI resources

See [SPA integration and Azure DevOps UI resources](docs/spa-integration-and-ui-resources.md) for content-script lifecycle guidance, native UI ownership boundaries, and public Bolt UI resources.
