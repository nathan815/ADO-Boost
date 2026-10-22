# ADO Boost companion

This Windows-only npm companion installs the prebuilt ADO Boost Edge extension into a stable per-user folder and registers a bounded native-messaging host for optional local GitHub Copilot features.

It requires Node.js 20.19 or newer, or Node.js 22.12 or newer, and an installed GitHub Copilot CLI. The host uses `@github/copilot-sdk` 0.2.2 with the installed CLI path, logged-in user authentication, stdio transport, an isolated empty working directory, no available tools, deny-all permission handling, and configuration discovery disabled.

## Commands

```powershell
ado-boost doctor
ado-boost setup
ado-boost setup --account <github-username>
ado-boost login
ado-boost uninstall-host
```

`doctor` is read-only and reports whether Node, Copilot CLI, package files, installed files, the native manifest, the pinned Copilot account, and the Edge registry entry are available.

`setup` derives and validates the deterministic extension ID from the packaged manifest public key, previews all paths and the per-user registry key, and requires confirmation unless `--yes` is supplied. It rejects unowned existing folders and a registry name that points to another manifest. It stages the complete replacement first, preserves the last owned installation until the staged files are ready, rolls folders back if replacement or registration fails, writes the exact native allowlist, and registers `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.adoboost.copilot`.

On first setup, choose an existing signed-in GitHub Copilot account from the numbered list, or specify `--account <github-username>`. Noninteractive setup requires an explicit account unless a previous pin exists. Use `--host <tenant.ghe.com>` with `--account` for GitHub Enterprise Cloud with data residency. Setup upgrades preserve the existing pin unless `--account` explicitly replaces it.

`login` delegates to the installed `copilot login` command in the current console. Pass `--host https://tenant.ghe.com` for a data-residency host. ADO Boost does not collect or copy credentials.

## Account selection

The selected account is stored as an `account` object containing `login` and `host` in `%LOCALAPPDATA%\ADO Boost\host\host-config.json`. There is no built-in username. The host URL is `https://github.com` or the selected GitHub Enterprise Cloud origin. Azure DevOps browser identity and GitHub Copilot identity are independent.

The **Copilot account** selector appears at the top of extension settings, above the feature settings, with a reminder that Copilot usage is billed to the selected account. The companion loads account metadata from the Copilot CLI's `config.json` under `COPILOT_HOME`, or `%USERPROFILE%\.copilot` by default. Setup records that directory as `copilotHome` in the host config so the browser uses the same source even when its environment differs from your terminal. **Refresh accounts** discovers newly signed-in accounts. This list does not contain credentials and may include expired sign-ins; selection verifies the account before saving it. Account controls remain available when optional AI features or the extension master switch are off. The toolbar popup shows the signed-in username beside the connection checkmark, with **Local Copilot** in the tooltip and connection details.

Click the popup's account or connection status to see the companion version, process ID, process uptime, Copilot CLI version, GitHub host, and native host protocol version when available. The companion version is bundled from its package manifest at build time and identifies the running host, independently of the Copilot CLI version. **Refresh** checks connection health without running inference or sending PR content. Diagnostics reflect that check, not a continuously monitored process: the companion disconnects after two idle minutes and may have a different PID on the next connection. Pending requests prevent idle shutdown. Older companion installations omit process details until upgraded.

The companion uses an account-specific profile under `%LOCALAPPDATA%\ADO Boost\copilot-profiles` and reuses the selected account's existing Windows credential-store login, without changing the globally active Copilot CLI account or your other sessions. Inherited token and custom-provider overrides are excluded. Before any PR context is sent, the host verifies both the GitHub username and host. Missing pins, expired sign-ins, and account mismatches block AI requests rather than falling back to another account. Older installations without a pin must select one in settings or rerun setup.

Account selection does not read the CLI's `settings.json` or copy a configured model preference. The CLI determines the model normally, including any inherited `COPILOT_MODEL` environment variable. The companion reports the model from SDK session events, preferring actual usage events. Generated-group results cache this model information in extension-local browser storage for the session card; cached model names are not used to choose a model for future requests.

Selecting an account in settings cancels in-flight old-account requests, verifies the new identity, updates `host-config.json` atomically, and switches the live SDK client without requiring a browser restart. Failed selection leaves the saved pin unchanged. If Copilot was configured to store tokens only in plaintext instead of the Windows credential store, the companion does not copy those tokens into its isolated profile; sign in using a working Windows credential store before selecting the account.

For a read-only native-host check after building, run `node companion\tests\host-smoke.mjs <github-username> [https://tenant.ghe.com]` from the repository root. This checks the actual selected identity without sending PR context or running inference.

## Removal

`uninstall-host` verifies both the ownership marker and exact registry manifest path, previews and confirms removal, surfaces registry failures, and removes only the owned host folder. It preserves the unpacked extension folder and browser-stored review data.

The browser extension must still be loaded manually from `%LOCALAPPDATA%\ADO Boost\extension` in `edge://extensions`. No command starts a persistent daemon.
