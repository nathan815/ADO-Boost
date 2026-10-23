# ADO Boost privacy policy

Last updated: October 23, 2026

This policy describes how ADO Boost, published by MadeByN8, handles information in Microsoft Edge and through its optional Windows companion. ADO Boost is an independent project, not an official Microsoft or GitHub product.

## What the publisher receives

ADO Boost does not send your Azure DevOps content, browsing activity, or account information to MadeByN8. It has no publisher-operated data collection backend and does not send analytics or advertising telemetry. MadeByN8 does not sell, rent, or broker your information.

Local processing still involves accessing information. The sections below explain what the extension accesses, what stays on your device, and when information is sent to Azure DevOps or GitHub Copilot.

## Azure DevOps access

ADO Boost works on `dev.azure.com` and organization sites under `visualstudio.com`. It uses your existing signed-in Azure DevOps browser session to access information you are authorized to view, including organization, project, and repository details; pull request titles, URLs, files, source code, and changes; discussions; user names and identities; reviewer votes; and review activity.

This information supports pull request navigation, change counts, discussions, review drafts, progress tracking, and the dashboard, profiles, and activity feed. The extension can display information about authors, reviewers, and other participants who do not use ADO Boost.

Comments, replies, review announcements, and votes are sent to Azure DevOps when you use the corresponding posting or review features. Private drafts remain local until submitted. Posted information is subject to your organization's Azure DevOps permissions, retention rules, and policies.

ADO Boost does not ask for or collect Azure DevOps passwords or personal access tokens.

## Information stored on your device

ADO Boost uses extension-local browser storage and IndexedDB for settings, project selections, repository favorites, followed people, review progress, private comment drafts, submission receipts, recently viewed pull requests, cached Azure DevOps responses, and generated Copilot results and session metadata.

Recent pull request history includes titles, author display names, organization/project/repository information, identities, URLs, and visit times. It retains the latest 100 unique pull requests and is shared across Azure DevOps accounts using the same browser profile. It does not import your general browser history.

Workspace preferences and caches are separated by organization and signed-in Azure DevOps user. Recent workspace responses have a five-minute reuse window and a limit of 200 recent queries per partition. Settled historical profile and review-thread snapshots may remain without an automatic expiry until cleared.

The extension does not sync this content through browser sync storage. Local data may remain until removed using the available controls, cleared by Microsoft Edge, or removed with the extension.

## Optional GitHub Copilot features

Copilot features are disabled by default and require a separately installed Windows companion and GitHub Copilot CLI. Core review features work without them.

When you enable and use a Copilot feature, relevant pull request context passes through the local companion to GitHub Copilot for processing. Depending on the feature, this can include your question, file paths, change counts, source-code or diff excerpts, and associated pull request context. Context can contain confidential information or information about other people.

The companion runs locally, but Copilot processing is not exclusively local. GitHub Copilot and its configured service providers process requests under the terms, privacy policies, and account or organization settings applicable to your use of Copilot. See the [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement) and [GitHub Copilot documentation](https://docs.github.com/en/copilot).

Manual requests use a context confirmation that is enabled by default and can be disabled in settings. Automatic grouping on pull request page load is separately opt-in; when enabled, it can send context without a per-request confirmation. Restoring previously cached results does not send a new Copilot request.

The companion stores the selected GitHub account identifier, host, and configuration locally and reuses the Copilot CLI's existing authentication. Credentials are not sent to MadeByN8. The CLI and its services may maintain their own local records and service-side records under their applicable settings and policies.

Only enable Copilot features for information you are authorized to share and where your organization's policies permit it.

## Your controls

You can inspect settings and stored review information through the extension's settings, toolbar popup, discussion panel, and workspace.

- Use **Clear history** to remove recently viewed pull request history. This does not delete drafts or review progress.
- Use **Clear workspace cache** to remove the current account and organization's workspace cache. This does not delete project selections, favorites, follows, drafts, review progress, or submission receipts.
- Manage private drafts through the review interface. Deleting a local draft does not delete a comment already posted to Azure DevOps.
- Disable automatic Copilot grouping to stop future automatic generation, or disable both Copilot features to stop future AI requests. Disabling a feature does not recall information already transmitted or necessarily cancel an in-flight request.
- Disable the extension to stop future extension activity. Remove it through Microsoft Edge to remove its extension-local browser data. The separately installed companion and Copilot CLI have their own configuration and removal procedures.

Removing local data does not remove information held by Azure DevOps or GitHub Copilot. Use those services' controls and your organization's processes for service-side access, retention, or deletion requests.

## Support and policy changes

For questions about this policy, use the [ADO Boost issue tracker](https://github.com/nathan815/ADO-Boost/issues). Issues are public: do not include credentials, private source code, or personal information. Information you choose to post there is handled by GitHub under its privacy policy and is visible to the project's maintainers and other readers.

This policy will be updated when data-handling practices change. The current policy and its revision history are available in this repository.
