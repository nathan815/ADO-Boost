# Publishing to Microsoft Edge Add-ons

The CI workflow runs the extension and companion checks on pushes and pull requests. Each successful run uploads an `ado-boost-<version>` artifact containing a store-ready ZIP with `manifest.json` at the archive root.

## Create a local package

Build and ZIP the contents of `dist` rather than the `dist` directory itself:

```powershell
npm ci
npm run typecheck
npm test
npm run build
New-Item -ItemType Directory -Force release | Out-Null
$version = (Get-Content .\manifest.json | ConvertFrom-Json).version
Compress-Archive -Path .\dist\* -DestinationPath ".\release\ado-boost-$version.zip" -Force
```

## Submit the extension

1. Register for the free [Microsoft Edge program in Partner Center](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account) with a personal Microsoft account. Individual publisher profiles require a contact address that is shown to customers.
2. In the Partner Center **Edge** workspace, create a new extension and upload the CI artifact ZIP.
3. Choose public or hidden availability and the markets where the extension should be offered.
4. Complete the properties and privacy declarations. Explain the `storage`, `nativeMessaging`, and Azure DevOps host permissions, declare that this Manifest V3 extension does not execute remote code, and keep the data-use answers consistent with the repository's privacy documentation.
5. Add the required store description and square logo. Microsoft currently requires a description of 250-10,000 characters and recommends a 300 x 300 logo with a minimum size of 128 x 128. Screenshots are optional but recommended.
6. Add certification notes explaining how reviewers can test the extension on an Azure DevOps pull request, then submit it for certification.

See Microsoft's [Edge extension publishing guide](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension) for the current Partner Center fields and asset requirements.

The optional companion is not included in the Edge Store package. Before distributing it, install the store build once and verify that its extension ID matches the deterministic ID derived from the `key` in `manifest.json`; the native-messaging host allowlist must use the installed store ID.

Tagged project releases also publish a standalone extension ZIP and a self-contained Windows companion ZIP. See [Releasing ADO Boost](releasing.md) for versioning and release instructions.

## Automate updates

The initial extension submission and listing metadata must be managed in Partner Center. After the extension exists, enable the Publish API in Partner Center and use the [Edge Add-ons Update REST API](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api) to upload, validate, and publish package updates from CI.
