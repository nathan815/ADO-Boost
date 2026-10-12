# AzureDevOps++ companion

This Windows-only npm companion installs the prebuilt AzureDevOps++ Edge extension into a stable per-user folder and registers a bounded native-messaging host for optional local GitHub Copilot features.

It requires Node.js 20.19 or newer, or Node.js 22.12 or newer, and an installed GitHub Copilot CLI. The host uses `@github/copilot-sdk` 0.2.2 with the installed CLI path, logged-in user authentication, stdio transport, an isolated empty working directory, no available tools, deny-all permission handling, and configuration discovery disabled.

## Commands

```powershell
adoplusplus doctor
adoplusplus setup
adoplusplus login
adoplusplus uninstall-host
```

`doctor` is read-only and reports whether Node, Copilot CLI, package files, installed files, the native manifest, and the Edge registry entry are available.

`setup` derives and validates the deterministic extension ID from the packaged manifest public key, previews all paths and the per-user registry key, and requires confirmation unless `--yes` is supplied. It rejects unowned existing folders and a registry name that points to another manifest. It stages the complete replacement first, preserves the last owned installation until the staged files are ready, rolls folders back if replacement or registration fails, writes the exact native allowlist, and registers `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.azuredevopsplusplus.copilot`.

`login` delegates to the installed `copilot login` command in the current console. AzureDevOps++ does not collect or copy credentials.

`uninstall-host` verifies both the ownership marker and exact registry manifest path, previews and confirms removal, surfaces registry failures, and removes only the owned host folder. It preserves the unpacked extension folder and browser-stored review data.

The browser extension must still be loaded manually from `%LOCALAPPDATA%\AzureDevOps++\extension` in `edge://extensions`. No command starts a persistent daemon.
