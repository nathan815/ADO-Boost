ADO Boost for Windows

Requirements:
- Windows 10 or newer
- Node.js 20.19 or newer, or Node.js 22.12 or newer
- GitHub Copilot CLI installed and signed in
- Microsoft Edge

Run setup.cmd to install the bundled extension into your local application data folder and register the native messaging host. Setup previews the paths and asks for confirmation.

After setup completes, open edge://extensions, enable Developer mode, select Load unpacked, and choose:

%LOCALAPPDATA%\ADO Boost\extension

Other commands:

ado-boost.cmd doctor
ado-boost.cmd login
ado-boost.cmd uninstall-host
