<p align="center">
  <img src="public/icons/ado-boost.svg" alt="ADO Boost logo" width="144">
</p>

# ADO Boost

ADO Boost is an Edge-first browser extension that makes Azure DevOps pull request reviews easier to navigate, discuss, and submit, with Copilot-generated semantic file groups to help make sense of large PRs. The standalone extension works in Edge or Chrome on Windows, macOS, and Linux. Copilot features require the Windows + Edge companion.

## Features

- **Copilot-generated semantic file groups** organize related changes by purpose, making large PRs easier to review.
- A cross-repository PR dashboard, contribution profiles, people search, and activity feed.
- Added/removed line counts for the overall PR, each file, and each PR in native PR lists.
- File filtering by type and change, with options to hide generated files and lockfiles.
- A docked discussion panel, private comment drafts, and previewed review submission.
- Local review progress and recently viewed PRs in the toolbar popup.
- Ask Copilot questions about the PR and turn answers into private feedback drafts.

## Install the extension

ADO Boost is not yet available on the Edge Add-Ons Store or Chrome Web Store.

### Install the latest Windows release

**Recommended for Windows + Edge:** run the installer to download the latest release, including the extension and Copilot companion. Download and review the script, then run it from an interactive PowerShell terminal:

```powershell
Invoke-WebRequest https://raw.githubusercontent.com/nathan815/ADO-Boost/main/scripts/install.ps1 -OutFile .\install-ado-boost.ps1
Get-Content .\install-ado-boost.ps1
.\install-ado-boost.ps1
```

The installer verifies the release's SHA-256 digest, offers to install missing Node.js and Copilot CLI prerequisites with confirmation, and guides you through sign-in, account selection, and companion setup.

When prompted, open `edge://extensions`, enable **Developer mode**, select **Load unpacked**, and choose `%LOCALAPPDATA%\ADO Boost\extension`. No separate extension download is needed. Rerun the installer to upgrade, then reload the extension if needed.

Follow your organization's script-running policy. See the [user guide](docs/user-guide.md#copilot-setup) for repair and troubleshooting, or the [companion documentation](companion/README.md) for CLI commands and removal.

### Other browsers or extension only

For Chrome, macOS, Linux, or an installation without the Copilot companion:

1. Download `ado-boost-extension-<version>.zip` from the [latest release](https://github.com/nathan815/ADO-Boost/releases/latest).
2. Extract it to a permanent folder.
3. Open `edge://extensions` or `chrome://extensions` and enable **Developer mode**.
4. Select **Load unpacked** and choose the extracted folder.
5. Open an Azure DevOps pull request.

The standalone extension needs no Node.js or Copilot CLI. To build it yourself, see [development](docs/development.md).

## Privacy and limits

ADO Boost uses your signed-in Azure DevOps browser session. Drafts, settings, review progress, and cached data stay in this browser profile without browser sync or publisher analytics. Optional Copilot requests send PR context to GitHub Copilot; automatic grouping is opt-in. Only use these features where your organization's policies permit them.

See the [privacy policy](PRIVACY.md) for data handling and controls.

## Documentation

- [User guide](docs/user-guide.md): workspace, reviews, local history, and Copilot.
- [Companion](companion/README.md): Windows setup, accounts, diagnostics, and removal.
- [Releasing](docs/releasing.md) and [Edge publishing](docs/publishing-to-edge.md).

## Development

See the [development guide](docs/development.md) for building from source, running checks, and using the offline demo.

## License

[MIT](LICENSE).
