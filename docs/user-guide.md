# Using ADO Boost

For installation, see the [README](../README.md#install-the-extension). ADO Boost works on `dev.azure.com` and organization sites under `visualstudio.com`, using your existing Azure DevOps browser session.

## PR workspace

Select **PR Home** in Azure DevOps project navigation to open the workspace. Choose up to 10 projects in **Projects**, then select **Confirm selections**. Use **Edit projects** to change them later; at least one project must remain selected. Repository favorites are optional and do not limit PR queries to those repositories.

Use **My PRs** for authored and assigned PRs, **People** to find and locally follow teammates, **Profile** for contributions and review history, and **Activity feed** for followed people's activity. Use the load-more controls to expand dashboard and feed results. **Back to Azure DevOps** restores the native view.

Profiles default to **Past year** and load matching PRs across the selected projects. A reviewed PR means a non-self PR with a non-zero reviewer vote; comment-only participation without a current vote is not counted. Contribution days use the PR's creation date, not the date of the review. Profiles are not audit logs or measures of review quality.

Workspace selections, favorites, follows, and caches are local to the browser profile and separated by organization and signed-in user. Follows do not change Azure DevOps subscriptions. Use **Refresh history** to recheck historical snapshots, or **Clear workspace cache** to remove cached data without deleting selections, favorites, follows, drafts, receipts, or review progress.

## Files and discussions

Open a PR and use the controls beside Azure DevOps' native **Filter** to filter by file type or change type. Generated-file and lockfile hiding are configurable in settings.

Diff counts follow Azure DevOps' whitespace display setting. Unreadable settings, files larger than 2 MiB, binary files, unavailable versions, and fetch failures are shown as unavailable or incomplete rather than exact.

Select **Assistant** to open discussions, drafts, review announcements, and submission. The discussion panel lets you filter threads, reply, and jump to native comments. Comment creation and edit times show relative timestamps; hover for the exact local time, or disable **Comment creation and edit times** in settings.

## Draft and submit a review

Use **Post** in a native comment composer to publish immediately, or **Add to review** to keep feedback private. General comments, replies, and inline feedback drafts stay in this browser profile until submitted.

Use **Submit Review** to preview selected feedback and optionally apply a vote. Azure DevOps submission is not atomic: comments may post before the final vote. Failed or uncertain drafts are preserved for inspection rather than blindly reposted.

Review-start announcements are optional and previewed before posting. After an announcement, a recorded reviewer decision or explicit comment-only review submission can add a completion reply and close the announcement thread. Loading the PR alone does not complete the review, and failed completion checks leave the announcement unchanged. ADO Boost does not automatically vote, resolve unrelated threads, merge PRs, or execute PR code.

## History and settings

The toolbar popup has **Recently Viewed**, **Reviewing**, and **Reviewed** tabs. **Start Reviewing** tracks a PR; completion of an announced review moves it to **Reviewed**. Review status also appears in native PR lists.

Recent history retains the latest 100 unique PRs and is shared across Azure DevOps accounts in this browser profile. It is not synced across devices. **Clear history** removes recent visits after confirmation without deleting tracked reviews, drafts, or progress.

Open **Settings** from the toolbar popup, discussion panel gear, or ADO Boost action menu beside the native review actions. Core review features are enabled by default; generated-file hiding, lockfile hiding, announcements, and Copilot behavior are configurable.

## Copilot setup

Copilot features require Windows, Edge, the local companion, and GitHub Copilot CLI. Core extension features work without them.

For a first-time Windows + Edge installation, use the [Windows installer](../README.md#install-the-latest-windows-release) to get both the extension and companion. If the extension is already installed, install or repair its companion from settings:

1. Open extension settings and select **Copilot Connection**.
2. Select **Copy install command**, paste it into an interactive PowerShell terminal, and follow the prompts. The command includes your extension's runtime ID; only register trusted ADO Boost installations.
3. Approve any needed prerequisite installation and sign-in, then choose the GitHub account to use.
4. Return to settings to check the connection and enable the desired features.

The installer requires a published stable release. It installs the CLI under `%LOCALAPPDATA%\ADO Boost` and adds its command launcher to your user PATH with confirmation. Setup preserves the selected account on upgrades. If setup fails, the installed CLI remains available so you can rerun `ado-boost setup`. If WinGet is unavailable, install the prerequisite identified by the installer manually.

The Copilot account is independent of your Azure DevOps browser account. Choosing it in settings switches the companion without changing your globally active Copilot CLI account. Missing sign-in or identity mismatches block requests instead of falling back to another account.

See the [companion documentation](../companion/README.md) for account selection, command options, and removal.

## Copilot groups and questions

The semantic-groups setting is enabled by default, but requires a configured companion to generate results. Automatic generation and **Copilot PR questions** are opt-in.

Use **Generate** above the file tree or in the sidebar's **Copilot Groups** tab. Manual generation confirms context sharing by default; **Always show this confirmation dialog** controls future manual confirmations and can be restored in settings. Requests include all changed-file paths and counts, plus bounded excerpts: up to 20 files, 200 changed lines per file, 32 KB per file, and 128 KB total. The companion runs locally, but requests are processed by GitHub Copilot, not exclusively on your device.

Generated groups can be viewed inline in the native tree or selected individually. Native file filters still apply, and switching group views does not change reviewed state or send another request.

Cached groups load without sending a new Copilot request. A new PR iteration marks older groups as stale; use **Regenerate** to refresh them. Automatic generation on PR page load is off by default. Enabling it permits context sharing without a per-request confirmation when the page has no cached groups.

Enable **Copilot PR questions** to use the **Chat** tab. Questions use the context confirmation preference; an answer can be converted into a private feedback draft.

Only send PR context where your organization's policies permit it. See the [privacy policy](../PRIVACY.md) for data handling and controls.

## Troubleshooting

Select the connection indicator in settings, the popup, or the sidebar for companion status. **Refresh status** checks connection and sign-in without sending PR content or running inference. A check may start the companion and Copilot CLI; the host shuts down after two idle minutes, so the indicator is not a persistent process monitor.

Use **Install or repair** in **Copilot Connection** if the companion is missing or unregistered. Run `ado-boost doctor` for diagnostics, `ado-boost setup` to finish or repair setup, or `ado-boost login` when sign-in is needed. Copilot connection failures do not require disabling core review features.

Panel error notifications remain visible until dismissed. Inspect failed or uncertain review drafts before retrying a submission.
