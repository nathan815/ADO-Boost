# Publishing to Microsoft Edge Add-ons

The CI workflow runs the extension and companion checks on pushes and pull requests. Each successful run uploads an `ado-boost-<version>` artifact containing a store-ready ZIP with `manifest.json` at the archive root. Both CI and tagged release extension ZIPs omit the manifest's `key` field, which Edge Store rejects. The source manifest, unpacked `dist` build, and extension bundled with the Windows companion retain the key for their stable unpacked extension ID.

## Create a local package

Build, prepare a separate store copy, and ZIP its contents rather than its directory. The staging directory must not already exist; use a fresh destination for another package:

```powershell
npm ci
npm run typecheck
npm test
npm run build
node scripts/prepare-store-extension.mjs dist release/edge-store
$version = (Get-Content .\manifest.json | ConvertFrom-Json).version
Compress-Archive -Path .\release\edge-store\* -DestinationPath ".\release\ado-boost-$version.zip" -Force
```

## Submit the extension

1. Register for the free [Microsoft Edge program in Partner Center](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account) with a personal Microsoft account. Individual publisher profiles require a contact address that is shown to customers.
2. In the Partner Center **Edge** workspace, create a new extension and upload the CI artifact ZIP.
3. Choose public or hidden availability and the markets where the extension should be offered.
4. Complete the properties and privacy declarations. Explain the `storage`, `nativeMessaging`, and Azure DevOps host permissions, declare that this Manifest V3 extension does not execute remote code, and keep the data-use answers consistent with the repository's privacy documentation.
5. Add the required store description and square logo. Microsoft currently requires a description of 250-10,000 characters and recommends a 300 x 300 logo with a minimum size of 128 x 128. Screenshots are optional but recommended.
6. Add certification notes explaining how reviewers can test the extension on an Azure DevOps pull request, then submit it for certification. Copy the reusable [certification notes](edge-certification-notes.txt), review them against the submitted version, and keep the text under 2,000 characters.

See Microsoft's [Edge extension publishing guide](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension) for the current Partner Center fields and asset requirements.

### Privacy policy

Use the project's [privacy policy](../PRIVACY.md) for the Partner Center privacy-policy field. After the file is published on `main`, its public URL is `https://github.com/nathan815/ADO-Boost/blob/main/PRIVACY.md`. Verify that the URL is accessible without signing in before submitting.

Keep the store's data-use declarations consistent with the policy and the submitted version. Distinguish information accessed or stored locally from information received by the publisher, and disclose optional transmission to GitHub Copilot. Do not describe Copilot processing as exclusively local.

Review Microsoft's [personal information requirements](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies#15-personal-information), including the third-party sharing and non-user information provisions in sections 1.5.3 and 1.5.4. A privacy policy documents behavior; it does not by itself establish that every feature satisfies these requirements.

The optional companion is not included in the Edge Store package. Before distributing it for store users, install the store build and check its actual extension ID. Do not assume it matches the unpacked build's key-derived ID; the native-messaging host allowlist must include the installed store ID.

Tagged project releases also publish a standalone extension ZIP and a self-contained Windows companion ZIP. See [Releasing ADO Boost](releasing.md) for versioning and release instructions.

## Automate updates

The initial extension submission and listing metadata must be managed in Partner Center. After the extension exists, enable the Publish API in Partner Center and use the [Edge Add-ons Update REST API](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api) to upload, validate, and publish package updates from CI.
