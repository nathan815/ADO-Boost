# ADO Boost companion

This Windows-only npm companion installs the prebuilt ADO Boost Edge extension into a stable per-user folder and registers a bounded native-messaging host for optional local GitHub Copilot features.

It requires Node.js 20.19 or newer, or Node.js 22.12 or newer, and an installed GitHub Copilot CLI. The host uses `@github/copilot-sdk` 0.2.2 with the installed CLI path, logged-in user authentication, stdio transport, an isolated empty working directory, no available tools, deny-all permission handling, and configuration discovery disabled.

Grouping session telemetry includes AI credit usage from `assistant.usage.copilotUsage.totalNanoAiu`, summed once per event across model calls. The extension converts nano-AI units to credits by dividing by 1,000,000,000. This is separate from the premium-request multiplier in `assistant.usage.cost`. Missing, incomplete, or invalid billing totals are reported as unavailable rather than estimated from tokens.

## Commands

For a guided installation, select **Install or repair** beside the Copilot account selector in extension settings, or **Install or troubleshoot companion** from connection errors. The page checks the current connection and provides a PowerShell command that downloads the latest published Windows package, verifies SHA-256, offers missing prerequisites through WinGet with confirmation, and installs the `ado-boost` command on your user PATH. See the repository [installation instructions](../README.md#install-the-latest-windows-release).

```powershell
ado-boost doctor
ado-boost setup
ado-boost setup --account <github-username>
ado-boost login
ado-boost uninstall-host
```

`doctor` is read-only and reports whether Node, Copilot CLI, package files, installed files, the native manifest, the pinned Copilot account, and the Edge registry entry are available.

`setup` derives and validates the deterministic extension ID from the packaged manifest public key, previews all paths and the per-user registry key, and requires confirmation unless `--yes` is supplied. It rejects unowned existing folders and a registry name that points to another manifest. It stages the complete replacement first, preserves the last owned installation until the staged files are ready, rolls folders back if replacement or registration fails, writes the exact native allowlist, and registers `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.adoboost.copilot`.

Commands copied from the extension pass its runtime ID through PowerShell's `-ExtensionId <id>` to `setup --extension-id <id>`. This registers store and keyless unpacked installations without hardcoding their IDs into the companion. The ID must be exactly 32 lowercase letters from `a` to `p`; setup previews it before confirmation and adds its exact origin to both the native manifest and host configuration. The stable bundled-extension ID and previously registered IDs remain allowlisted on repair. Ownership markers still identify the original ADO Boost package, not the caller's ID. Only supply IDs belonging to trusted ADO Boost installations: an allowlisted extension can invoke the companion. Supplying an ID also suppresses the Load unpacked instructions. The bootstrapper rejects packages without the `extension-id` setup capability instead of allowing an old CLI to silently ignore the option.

Installation output separates file locations, runtime details, and the pinned account into spaced subsections indented beneath **Copilot setup**, with values indented one level further. A spinner indicates installation checks, account discovery, and sign-in verification, and stops before interactive prompts. Headings use cyan and successful steps use green in interactive terminals; redirected output stays plain with a single status line per check instead of animation. Set `NO_COLOR=1` to disable color. Browser installation and feature-enablement instructions appear after setup succeeds.

Pressing Ctrl+C at an account-selection or confirmation prompt cancels with a short message and exit code 130, without an abort stack trace.

`setup` handles sign-in as well as installation; a separate `login` command is not required. When there are no signed-in accounts, the requested account is missing, or the selected account has an expired sign-in, interactive setup asks before running Copilot sign-in, then continues in the same invocation. It checks the selected identity through an isolated account profile without creating an AI session or sending PR content. Declining, a failed sign-in, or an identity mismatch stops native-host setup rather than choosing another account.

On first setup, choose a signed-in GitHub Copilot account from the numbered list, or specify `--account <github-username>`. Noninteractive setup requires an explicit account unless a previous pin exists, and fails with instructions to rerun interactive setup if sign-in is needed. `--yes` never authorizes an interactive login. Use `--host <tenant.ghe.com>` with `--account` for GitHub Enterprise Cloud with data residency. Setup upgrades preserve the existing pin unless `--account` explicitly replaces it. An explicitly approved sign-in uses the selected Copilot home and Copilot CLI's normal login behavior; reusing or selecting an already authenticated account does not change the globally active CLI account.

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
