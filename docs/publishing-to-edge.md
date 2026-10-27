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

The optional companion is not included in the Edge Store package. Commands copied from onboarding or Copilot Connection include the installed extension's runtime ID as `-ExtensionId`, so the first store installation does not depend on a hardcoded store ID. Setup previews that ID before confirmation and adds its exact `chrome-extension://<id>/` origin to both the native manifest and the companion configuration, alongside the stable unpacked ID. Repair preserves previously registered IDs. Only 32 lowercase letters from `a` to `p` are accepted; wildcard origins are never used. Only register IDs from trusted ADO Boost installations.

Publish a Windows companion release supporting extension ID registration before distributing the corresponding store extension. The installer checks the package's `adoBoost.setupCapabilities` for `extension-id` and stops before installing an older package that would ignore the argument. Store-ready ZIPs omit the manifest key, so their unpacked IDs can change when their installation directory changes; rerun the command from the new installation if needed.

Tagged project releases also publish a standalone extension ZIP and a self-contained Windows companion ZIP. See [Releasing ADO Boost](releasing.md) for versioning and release instructions.

## Automate updates

GitHub releases and Edge Store submissions are independent. Keep publishing GitHub releases for immediate download; use the separate **Publish to Edge** workflow to promote a selected published release when ready. There is no automatic store submission on a commit, tag, or GitHub release event, and no separate Edge version or branch is needed. You can skip intermediate GitHub versions when promoting to Edge.

The initial extension submission and listing metadata must be managed in Partner Center. Wait for initial publication before using the [Edge Add-ons Update REST API](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api). Store updates still go through Microsoft's certification process; API success means a submission was created, not that the version is approved or live.

### One-time configuration

1. In Partner Center's **Microsoft Edge > Publish API** page, enable the current API-key experience and create credentials. Record the Client ID, API key, and key expiry securely. Do not paste the API key into issues, source files, or workflow inputs.
2. In the GitHub repository's **Settings > Environments**, create an environment named `edge-store`. Restrict deployment branches to `main` and optionally require a reviewer before submission.
3. Add environment secrets `EDGE_CLIENT_ID` and `EDGE_API_KEY`.
4. Add environment variable `EDGE_PRODUCT_ID` with the Partner Center product GUID. For the initial ADO Boost listing, this is `a4577b0c-dc7e-4818-8369-45afb5a7696c`. Do not use the Store ID or CRX ID.

Rotate the API key before its Partner Center expiry. The workflow uses the current API-key headers (`Authorization: ApiKey ...` and `X-ClientID`), not the retired client-secret/token flow.

### Promote a release

1. Publish a normal GitHub release containing `ado-boost-extension-<version>.zip`. The selected version must be higher than the version already submitted to Edge. Check Partner Center first: do not start another promotion while certification is in progress.
2. Review `docs/edge-certification-notes.txt` in that release tag. The workflow submits those exact notes, not the latest notes from `main`. Keep notes current when cutting each release and below 2,000 characters.
3. Open **Actions > Publish to Edge > Run workflow**, use branch `main`, and enter the release tag, such as `v0.5.0`. Leave **dry_run** checked (the default) to preview first; uncheck it only when ready to submit.
4. Approve the `edge-store` deployment if environment approval is configured.
5. Check the Actions summary for the selected release, asset digest, and operation IDs. Follow certification and actual store availability in Partner Center.

The workflow downloads the existing published stable release asset without rebuilding it. It checks that the release tag is on `main`, verifies the asset's GitHub SHA-256 digest, and checks the ZIP's root manifest, version, and absence of `key`. Drafts, prereleases, missing notes, and older ZIPs that still contain `key` are rejected before contacting Edge.

### Dry run

With **dry_run** checked, release download and local validation still run, but no Edge API requests are sent. The workflow does not pass publishing credentials to the script. It still needs the `edge-store` environment's `EDGE_PRODUCT_ID` variable and follows any environment approval rules.

The logs and Actions summary show the planned HTTP methods, full Edge URLs, explicitly set headers with credentials redacted, and the actual certification JSON body. Instead of printing ZIP bytes, they show its byte count and SHA-256 hash. Upload and submission operation IDs are placeholders because only Edge can return those values; GET requests may repeat according to the displayed polling policy. The preview is generated from the same request definitions used by a live submission.

A dry run can safely preview a release while another version is in review. It does not validate API credentials, authorization, version eligibility, or the current state in Partner Center. It is not a simulated approval or submission.

For a local preview, set `EDGE_DRY_RUN=true`, `EDGE_PRODUCT_ID`, `EDGE_PACKAGE_PATH`, and `EDGE_NOTES_PATH` in the process environment, then run `node scripts/publish-edge.mjs`. The local script defaults to live mode when `EDGE_DRY_RUN` is unset and requires credentials in that mode. Local invocation does not perform the workflow's GitHub release/digest/manifest checks.

Workflow runs are serialized without cancelling an active run. This does not queue releases behind Microsoft's multi-day certification process. The API can reject a submission with `InProgressSubmission`; the workflow reports that failure rather than cancelling a review. It never automatically retries uploads or submission POSTs, because a lost response may still have been accepted. If an operation fails or times out, inspect Partner Center before rerunning; do not assume no state changed. GitHub releases remain available regardless of Edge review status.

### Daily store status check

Every published GitHub release gets its own tracking issue: the **Edge release tracking issue** workflow runs on `release: published`, creates a deduped issue titled "Track Edge Add-ons release vX.Y.Z" with the label `edge-release` and a hidden `edge-tracking-version:X.Y.Z` marker, and skips creation if one already exists. Issue #8 remains the tracking issue for the initial 0.4.1 submission.

The **Edge store status** workflow runs daily and checks every tracked release — issue #8 plus all open `edge-release` issues — updating each issue only when its observed status changes, so issues do not collect a comment every day. It reads the live version from the listing page, so a listing that is live at an older version still reports "not published" for a newer tracked version. Microsoft's Update REST API cannot report certification progress: its status endpoints only poll an operation ID returned by an API-initiated upload or publish, and a succeeded publish operation means a submission was created, not that certification passed. The workflow therefore watches the public listing, which is unavailable while a product is in review or rejected and goes live once it is published (hidden listings are served at their direct URL). A rejection looks the same as "still in review" by this signal; use Partner Center or the reviewer email for rejection reasons.

One-time setup: set `EDGE_CRX_ID` to the CRX ID from Partner Center's Extension identity section — either as a variable in the `edge-store` environment (alongside `EDGE_PRODUCT_ID`; the daily check job runs in that environment) or as a repository variable under Settings > Secrets and variables > Actions — or set `EDGE_STORE_URL` with the full listing URL. The CRX ID is assigned when the extension product is created in Partner Center, so it is available before approval — approval only makes the listing live. If the `edge-store` environment ever gains a required-reviewer rule, scheduled status runs will wait for that approval; in that case move `EDGE_CRX_ID` to a repository variable instead. Until one is set, the workflow posts a single `unconfigured` note to a tracked issue and then stays quiet on it. Optionally, set `EDGE_SUBMISSION_OPERATION_ID` plus repository secrets `EDGE_CLIENT_ID` / `EDGE_API_KEY` to also poll a publish operation created through the API.
