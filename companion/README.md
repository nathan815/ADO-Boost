# ADO Boost companion

This Windows-only npm companion installs the prebuilt ADO Boost Edge extension into a stable per-user folder and registers a bounded native-messaging host for optional local GitHub Copilot features.

It requires Node.js 20.19 or newer, or Node.js 22.12 or newer, and an installed GitHub Copilot CLI. The host uses `@github/copilot-sdk` 0.2.2 with the installed CLI path, logged-in user authentication, stdio transport, an isolated empty working directory, no available tools, deny-all permission handling, and configuration discovery disabled.

Grouping session telemetry includes AI credit usage from `assistant.usage.copilotUsage.totalNanoAiu`, summed once per event across model calls. The extension converts nano-AI units to credits by dividing by 1,000,000,000. This is separate from the premium-request multiplier in `assistant.usage.cost`. Missing, incomplete, or invalid billing totals are reported as unavailable rather than estimated from tokens.

## Commands

```powershell
ado-boost doctor
ado-boost setup
ado-boost login
ado-boost uninstall-host
```

`doctor` is read-only and reports whether Node, Copilot CLI, package files, installed files, the native manifest, and the Edge registry entry are available.

`setup` derives and validates the deterministic extension ID from the packaged manifest public key, previews all paths and the per-user registry key, and requires confirmation unless `--yes` is supplied. It rejects unowned existing folders and a registry name that points to another manifest. It stages the complete replacement first, preserves the last owned installation until the staged files are ready, rolls folders back if replacement or registration fails, writes the exact native allowlist, and registers `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.adoboost.copilot`.

`login` delegates to the installed `copilot login` command in the current console. ADO Boost does not collect or copy credentials.

`uninstall-host` verifies both the ownership marker and exact registry manifest path, previews and confirms removal, surfaces registry failures, and removes only the owned host folder. It preserves the unpacked extension folder and browser-stored review data.

The browser extension must still be loaded manually from `%LOCALAPPDATA%\ADO Boost\extension` in `edge://extensions`. No command starts a persistent daemon.
