# ADO Boost

ADO Boost is an Edge-first browser extension that makes Azure DevOps pull request reviews easier to navigate, discuss, and submit.

> ADO Boost is pre-release software. Build it from source and load it as an unpacked extension.

## What it adds

- Overall PR and per-file added/removed line diff counts.
- Enhanced file filtering - file types, change types, and options to hide generated files and lockfiles
- A docked discussion panel with thread filters, replies, and links back to native comments.
- Browser-local drafts for general comments, replies, and inline feedback.
- A previewed **Submit Review** flow for publishing selected feedback and optionally applying a vote.
- Announce you begin reviewing a PR with an auto-generated comment so author is aware (optional).

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
- Select **Assistant** to open discussions, draft feedback, announce the start of a review, or submit a review.
- Open settings from the browser toolbar action, the discussion panel's gear button, or the ADO Boost action menu beside the native review actions.

Core review features are enabled by default. Generated-file hiding, lockfile hiding, review-start announcements, and Copilot features can be configured in settings.

ADO Boost previews user-visible writes before posting them. It does not automatically comment, vote, resolve threads, merge pull requests, or run pull request code.

## Privacy and limits

- ADO Boost uses the signed-in Azure DevOps browser session and same-origin Azure DevOps APIs. It does not require or collect a personal access token.
- Settings, review progress, private drafts, and submission receipts are stored in extension-local browser storage. ADO Boost does not send analytics or store pull request content in browser sync storage.
- Optional Copilot features send only the pull request context shown in their preview through GitHub Copilot. Use them only when allowed by your organization's policies.
- Files larger than 2 MiB, binary files, unavailable versions, and fetch failures are shown as incomplete rather than exact.
- Azure DevOps review submission is not atomic. Comments may appear before the final vote, and ADO Boost preserves failed or uncertain drafts for review instead of blindly reposting them.

## Optional Copilot companion

The Windows-only companion enables the default-off Copilot features through an installed GitHub Copilot CLI. Core extension features work without it.

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
