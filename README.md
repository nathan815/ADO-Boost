<p align="center">
  <img src="public/icons/ado-boost.svg" alt="ADO Boost logo" width="144">
</p>

# ADO Boost

ADO Boost is an Edge-first browser extension that makes Azure DevOps pull request reviews easier to navigate, discuss, and submit.

> [!NOTE] 
> ADO Boost is not yet available on the Edge Add-Ons Store or Chrome Web Store. See below on how to install it as an unpacked extension.

## What it adds

- Overall PR and per-file added/removed line diff counts follow the user's whitespace setting supplied by ADO on PR and PR-list pages. Counts show deletions before additions, matching ADO's native header, and omit zero values. With whitespace display off, leading/trailing whitespace-only edits are ignored; enabling it includes those edits. Counts refresh when the setting changes, and tooltips say "whitespace ignored" or "whitespace included". If ADO's setting cannot be read, counts are marked unavailable rather than guessed. PR-list totals are cached separately for each policy.
- Enhanced file filtering - file types, change types, and options to hide generated files and lockfiles
- A compact native Bolt total-file-count badge beside the PR **Files** tab, visible across PR tabs and unaffected by file filters.
- A docked discussion panel with thread filters, replies, and links back to native comments.
- Relative creation and content-edit times on posted PR comments, inline comments, and replies, both in Azure DevOps and the discussion panel. Hover either time for the exact local date and timezone. Disable **Comment creation and edit times** in settings to restore the original display.
- Browser-local drafts for general comments, replies, and inline feedback, rendered in the matching native Azure DevOps discussion surface with a clear draft marker.
- A previewed **Submit Review** flow for publishing selected feedback and optionally applying a vote.
- Announce you begin reviewing a PR with an auto-generated comment so author is aware (optional).
- A toolbar popup with local Copilot companion status and **Recently Viewed**, **Reviewing**, and **Reviewed** tabs. It remembers the last selected tab and highlights your review status in the popup and native PR lists.

## Install from source

Requirements:

- Node.js 20.19 or newer, or Node.js 22.12 or newer.
- npm.
- Microsoft Edge or Chrome

Build the extension:

```powershell
npm ci
npm run build
```

Load it in Edge:

1. Open `edge://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Select the repository's `dist` folder.
5. Open an Azure DevOps pull request.

Run `npm run build` again after changing the source, then reload the extension from `edge://extensions`.

## Use ADO Boost

- Open an Azure DevOps pull request under `https://dev.azure.com/` or `https://<org>.visualstudio.com/`.
- Use the controls beside Azure DevOps' native **Filter** control to filter by change type, file type, or optional noise rules.
- Use **Post** in a native Azure DevOps comment composer to publish immediately, or **Add to review** to keep the comment private for review submission. Select **Assistant** to manage discussions, drafts, review announcements, and submission.
- Open the browser toolbar popup to see recent pull requests or switch to **Reviewing** and **Reviewed**. **Start Reviewing** adds a PR to Reviewing; completion of that announced review moves it to Reviewed with a **Review complete** label. Status also appears on native PR lists, and the popup remembers your selected tab. Select the compact companion status indicator for connection/sign-in details and **Refresh**; click outside or press Escape to dismiss it. Use **Clear history** on Recently Viewed to remove recent visits after confirmation without removing tracked reviews, or **Settings** to configure the extension.
- Open settings directly from the discussion panel's gear button or the ADO Boost action menu beside the native review actions.

Core review features are enabled by default. Generated-file hiding, lockfile hiding, review-start announcements, and Copilot features can be configured in settings.

Panel error notifications are labeled **ADO Boost** and do not time out. Use the **X** button on the right to dismiss them.

To preview a notification without reproducing an error, open the ADO Boost dropdown beside the native review actions and select **Trigger Test Toast** under **Dev options**. This uses the real toast without opening the sidebar or making an Azure DevOps request.

Failed reviewer-vote lookups include request and response diagnostics in the PR page's developer console: the request URL, method, configured headers, credentials mode and body, plus the response URL, status, headers and full response text. Cookie and authorization-related header values are redacted; browser-managed cookie values are not collected. The toast keeps the short error message. Diagnostics are not saved to extension storage.

ADO Boost previews review announcements and submissions before posting them. After you announce a review, it checks for your recorded vote in the PR's reviewer list when the PR loads or the tab becomes active. If you are not listed as a reviewer, there is no recorded vote and the announcement stays open. A recorded review decision or an explicit comment-only review submission can add a completion reply and close the announcement thread; simply loading the PR or a failed vote lookup does not complete the review. Completion-check errors leave the announcement unchanged. ADO Boost does not automatically vote, resolve other discussion threads, merge pull requests, or run pull request code.

## Privacy and limits

- ADO Boost uses the signed-in Azure DevOps browser session and same-origin Azure DevOps APIs. It does not require or collect a personal access token.
- Settings, review progress, private drafts, and submission receipts are stored in extension-local browser storage. ADO Boost does not send analytics or store pull request content in browser sync storage.
- While ADO Boost is enabled, opening a PR records its title, author's display name, organization/project/repository, identity, URL, and visit time locally. The popup shows the author beneath each PR title; previously recorded entries gain author information when revisited. The latest 100 unique PRs are shared across ADO accounts in this browser profile, not synced across devices. Revisits move a PR to the top; file and tab changes within a PR do not. Announced reviews also retain local PR summary metadata with their review state, so they remain accessible outside the recent-history limit. Older saved announcements gain this metadata when revisited. Clearing history leaves drafts and review progress untouched. Older browser history is not imported.
- Optional Copilot features send only the pull request context shown in their preview through GitHub Copilot. Use them only when allowed by your organization's policies.
- Files larger than 2 MiB, binary files, unavailable versions, and fetch failures are shown as incomplete rather than exact.
- Azure DevOps review submission is not atomic. Comments may appear before the final vote, and ADO Boost preserves failed or uncertain drafts for review instead of blindly reposting them.

## Optional Copilot companion

The Windows-only companion enables the default-off Copilot features through an installed GitHub Copilot CLI. Core extension features work without it.

Enable **Copilot semantic groups** in settings, then select **Group changes with Copilot** in the Assistant panel and confirm the context to send. Results appear in the panel as expandable groups with explanations and links that select files in ADO's native Files view within the current PR tab, without reloading the page; they do not rearrange the native file tree. **Regenerate semantic groups** requests a fresh grouping after another context confirmation.

The toolbar popup checks the companion automatically, even when optional Copilot features are disabled or no PR is open. This may start the native host and Copilot CLI on demand; it checks connectivity and sign-in without sending PR content or running an AI request. The host disconnects after it becomes idle; the popup is not a persistent process monitor. A connected host can still require `ado-boost login`. If unavailable, run `ado-boost doctor` and refresh the connection check.

See [ADO Boost companion](companion/README.md) for requirements, setup, diagnostics, login, and removal commands.

## Contributing

Install dependencies, then run the project checks:

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

To run the synthetic offline fixture:

```powershell
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173/demo.html`. The fixture is clearly labeled and does not perform Azure DevOps writes.

For content-script lifecycle guidance and Azure DevOps UI integration details, see [SPA integration and Azure DevOps UI resources](docs/spa-integration-and-ui-resources.md).

## License

ADO Boost is licensed under the [MIT License](LICENSE).
