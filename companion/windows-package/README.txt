ADO Boost for Windows

Requirements:
- Windows 10 or newer
- Node.js 20.19 or newer, or Node.js 22.12 or newer
- GitHub Copilot CLI installed
- Microsoft Edge

Run setup.cmd to install the bundled extension into your local application data folder and register the native messaging host. Setup previews the paths and asks for confirmation.
Setup checks the selected account and offers Copilot sign-in when needed, then continues with installation. No separate login command is required. On first setup, choose the signed-in GitHub Copilot account to pin. To select it explicitly, run ado-boost.cmd setup --account <github-username>. Upgrades preserve the saved pin.
You can also change it under Settings > Copilot > Copilot account. The list comes from the companion. Selection saves the config and switches the live account without changing other CLI sessions.

After setup completes, open edge://extensions, enable Developer mode, select Load unpacked, and choose:

%LOCALAPPDATA%\ADO Boost\extension

Other commands:

ado-boost.cmd doctor
ado-boost.cmd login
ado-boost.cmd uninstall-host
