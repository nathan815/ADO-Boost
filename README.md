# AzureDevOps++

AzureDevOps++ is an Edge-first Manifest V3 extension that adds reliable pull request size statistics directly to the native Azure DevOps pull request UI, enhances the existing changed-file tree, keeps discussions available in a focused side panel, and provides richer diffs, private feedback drafts, and a previewed Submit Review workflow.

The extension uses the signed-in Azure DevOps browser session. It does not require a PAT, extract credentials, send analytics, or store PR source content in browser sync storage.

## Current status

Milestones 1 and 2 are implemented and covered by automated tests and an offline synthetic fixture. Milestone 3 includes a built Windows native-messaging companion using the published stable `@github/copilot-sdk` `0.2.2` API and the installed GitHub Copilot CLI. Semantic grouping and bounded PR questions are default-off features. The companion package, framing, launcher, setup tooling, and read-only authenticated SDK health handshake are tested locally without installing the extension or writing the registry. Actual Edge loading, HKCU native-host registration, browser-launched native messaging, and billable Copilot inference remain intentionally unperformed because those actions require separate explicit approval.

Live read-only Azure DevOps page testing has been performed with a user-loaded unpacked build. No automated extension installation, native-host registry changes, billable Copilot inference, npm publication, browser-store publication, or unapproved live Azure DevOps writes were performed during development.

## Features

### Reliable review statistics

- Overall and per-file added/removed line counts computed from the PR iteration source commit and common commit.
- Overall totals appear beside the native PR actions, and per-file totals appear inline in the native Azure DevOps changed-file tree.
- Explicit exact, partial, binary, unavailable, and error states. Missing data is never displayed as exact zero.
- CRLF normalization and terminal-newline-only change handling documented and tested against a normalized Git oracle.
- Bounded 2 MiB file analysis, bounded fetch concurrency, paginated change retrieval, and stale-result cancellation.
- Compact PR-list badges for visible rows.

### Native Azure DevOps review workspace

- Full-path search, change and extension filters, reviewed-file filtering, and opt-in generated/lockfile hiding are inserted above Azure DevOps' native file tree.
- Hiding noise never changes the reported overall totals.
- With no extension filters active, every native tree row stays visible, including collapsed folders and files the extension cannot identify. Tree counters cover recognized rendered files, not necessarily every file in the selected comparison.
- Previous, next, next-unreviewed, and keyboard navigation reuse Azure DevOps' SPA file links without forcing a full page reload.
- Azure DevOps' existing server-backed reviewed checkboxes remain authoritative. AzureDevOps++ does not render or synchronize a second reviewed-state system.
- A native-looking `ADO++` button beside the PR action buttons opens the discussions and review-tools side panel.

### Review coordination

- Start Reviewing preview and confirmation using the authenticated reviewer's display name.
- Start Reviewing is integrated beside Azure DevOps' native Approve action with an AzureDevOps++ action menu.
- The announcement is a normal Azure DevOps comment and does not change vote/status or guarantee notification delivery.
- Background-serialized writes prevent duplicate multi-tab announcements and submissions.
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
npm install
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

## Settings and feature flags

Open the extension's options page from the browser toolbar action, the gear button in the discussion rail, or the AzureDevOps++ action menu beside Approve. Settings are centralized in a typed registry with stable IDs, dependency explanations, a master disable switch, searchable groups, and theme selection.

Core review features are enabled by default. Generated-file hiding, lockfile hiding, and all future AI capabilities are opt-in. Disabling a feature removes its controls and blocks its write entry points without deleting saved progress or drafts.

## Permissions and privacy

- `storage`: stores settings, content-aware review progress, private drafts, announcement receipts, and submission receipts in extension-local storage.
- Azure DevOps host access: reads PR metadata, iterations, changes, file content, threads, identity, and current vote through documented same-origin Azure DevOps REST APIs using the existing browser session.
- No telemetry, analytics, remote feature flags, third-party developer service, PAT collection, or browser sync storage for PR content.
- Real writes always require an explicit user action and preview. AzureDevOps++ never automatically comments, votes, resolves threads, merges, or runs PR code.

## Comparison semantics and limits

Overall statistics compare the latest PR iteration against its common commit using Azure DevOps iteration changes with `$compareTo=0`. Text is normalized from CRLF or CR to LF, and a terminal-newline-only difference is ignored. This is intentionally a normalized text review count rather than a byte-exact raw Git `numstat`.

Files over 2 MiB, binaries, missing versions, and fetch failures are reported as incomplete states. The extension diff preview renders at most 5,000 rows and initially previews the first 500 rows for large files. Use Azure DevOps' native file view for content beyond those limits.

Azure DevOps review submission is not atomic. Comments may become visible individually before the final vote request. AzureDevOps++ stops after the first failed feedback write, never blindly replays an ambiguous batch, and offers a decision-only retry only after all selected feedback is known to have posted.

## Competition and differentiation

[ADO Lens](https://chromewebstore.google.com/detail/ado-lens/moimdjadpadmicmgnnhfnhbbhlcmgpoc) provides a useful statistics tab with line counts, files, commits, approvals, comments, work items, age, and file-type charts. AzureDevOps++ focuses on an integrated review path: trustworthy incomplete states, per-group navigation, content-aware progress, private drafts, richer diffs, and guarded review submission.

[Better ADO](https://github.com/KhanhhNe/better-ado) demonstrates demand for syntax-highlighted and reconstructed Azure DevOps diffs, horizontal tree scrolling, feature flags, and synchronized settings. AzureDevOps++ uses an original implementation and emphasizes bounded processing, typed capability controls, review state, and non-atomic write safety.

The existing Azure DevOps PR feedback extractor exports review threads to Markdown. AzureDevOps++ adds a private pre-submission queue, editable inline anchors, discussion navigation, partial-delivery receipts, and previewed decision handling.

Microsoft's native [Copilot code review for Azure DevOps](https://learn.microsoft.com/en-us/azure/devops/repos/git/copilot-code-reviews?view=azure-devops) is a limited-preview, administrator-gated, separately billed automated review service. AzureDevOps++ does not impersonate that service. Planned Copilot functionality is optional, local, explicit, and limited to validated semantic grouping, PR questions, and feedback drafts.

## Optional Copilot companion

The Windows companion uses Edge native messaging, a real executable launcher, bounded length-prefixed JSON over stdio, an exact extension-origin allowlist, request IDs, cancellation, multiple-tab isolation, and owned child-process cleanup. It does not use a localhost listener, CORS, pairing tokens, an embedded daemon download, arbitrary shell commands, unrestricted agent tools, or automatic PR code execution.

Build and package the companion with:

```powershell
npm --prefix companion install
npm --prefix companion run typecheck
npm --prefix companion test
npm run build
npm --prefix companion run build
npm --prefix companion run pack:local
```

After installing the resulting npm package, these commands are available:

```powershell
adoplusplus doctor
adoplusplus setup
adoplusplus login
adoplusplus uninstall-host
```

`setup` validates the deterministic extension ID, previews the stable extension folder, host folder, Copilot CLI path, and Edge registry key, then requires confirmation before copying files or changing the per-user registry. It refuses unowned installation folders or a native-host registry name that points to another manifest. Updates are staged and validated before the current owned folders move, and folder rollback occurs if replacement or registration fails. The user manually loads the stable unpacked extension folder in Edge. Edge starts the native host only when a default-off Copilot feature is explicitly used.

The host uses the SDK's documented `cliPath` integration with the installed Copilot CLI, the logged-in user authentication state, an isolated empty working directory, no custom or built-in tools, a deny-all permission handler, no configuration discovery, and a replacement system instruction that treats all PR content as untrusted data. Environment tokens, npm authentication, and proxy variables are stripped before the SDK-owned CLI child starts. Core extension features remain fully functional when the host is absent, not registered, unauthenticated, blocked by policy, or incompatible.

Before semantic grouping or chat, AzureDevOps++ previews exactly which files will contribute bounded changed-line excerpts. The reviewer explicitly selects files. The payload includes all changed-file paths and counts plus at most 20 selected excerpts, 200 changed lines and 32 KB per file, and 128 KB total. Each changed line carries a `path`, line number, and left/original or right/new side; unavailable and truncated content is marked omitted. The host cannot read arbitrary repository files.

Semantic-group responses reject unknown and duplicate paths, keep omitted files visible in an **Unassigned changes** group, and cache only by the immutable PR comparison identity. Explicit regeneration bypasses that cache. Chat answers are displayed as suggestions and can only be copied into the private feedback queue; they never post automatically. Disabling the master switch or both Copilot capabilities disconnects the native port, rejects pending requests, closes browser stdio, and triggers owned SDK child cleanup in the native host.

## Development safety

The repository intentionally contains no ICO files. No commits are created by the build scripts. No script installs the extension, writes the Windows registry, posts to a real PR, publishes npm packages, or submits to a browser store.

## Integration guidance and UI resources

See [SPA integration and Azure DevOps UI resources](docs/spa-integration-and-ui-resources.md) for content-script lifecycle guidance, native UI ownership boundaries, and public Bolt UI resources.
