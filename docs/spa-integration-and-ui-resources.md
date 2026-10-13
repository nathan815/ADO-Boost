# SPA integration and Azure DevOps UI resources

This page records architectural guidance for ADO Boost and public resource links. It is not a claim that the current implementation satisfies every recommendation.

## Browser extension and SPA boundaries

Chrome extension content scripts run in an isolated JavaScript world while sharing the page DOM. DOM access does not make the host application's JavaScript objects or internal functions a supported extension API. Treat DOM integration as a compatibility boundary that may change when Azure DevOps updates.

Single-page applications introduce several lifecycle hazards: UI can arrive asynchronously or be replaced, routes can change without a document reload, frameworks own and reconcile markup, generated classes can change, and virtualized lists can reuse the same element for different files. A successful initial injection is therefore not enough.

Prefer small, extension-owned additions next to native controls rather than rewriting framework-controlled markup. Use stable attributes, accessible labels, and narrow selectors where available; avoid relying solely on generated classes or broad text matches. Keep selector assumptions explicit and handle missing targets without disrupting native behavior.

### Lifecycle and reconciliation checklist

1. Determine the active PR and view identity before mounting. Handle route changes with route-aware mount and unmount behavior, including navigation that does not reload the document.
2. Observe the smallest useful DOM subtree with targeted `MutationObserver` instances. Rediscover that subtree when the host replaces it rather than assuming the original container remains attached.
3. Batch observer work and reconcile idempotently: repeated runs should update existing additions, not duplicate controls or listeners.
4. Avoid mutation loops caused by extension changes. Mark extension-owned elements, ignore irrelevant mutations, and only write attributes or markup when their values need to change.
5. Refresh enhancements by file identity, not just element identity. When virtualization recycles a row, remove stale counts or filtering state and bind the additions to the file now represented by that row.
6. On view changes, remove owned components and clean up listeners and observers. Cancel or ignore stale asynchronous results so data from a previous PR or file cannot decorate the new view.

These are design and review criteria, not guarantees about all existing code paths.

## ADO Boost native UI ownership

Retain Azure DevOps' native file selection, reviewed checkboxes and server persistence, and navigation. Augment the native changed-file tree with diff counts, filtering, and search controls, and place appropriate actions alongside the native toolbar. Keep the comments panel extension-owned rather than taking ownership of host discussion markup.

Native review state should remain authoritative; adding a second reviewed-checkbox or persistence system risks divergence from Azure DevOps. Similarly, enhancements should preserve native file links and controls instead of replacing the tree with a separate navigation model.

Prefer native app navigation controls when selecting files or moving through a review. `history.pushState` plus a synthetic `popstate` event is not a universal router API: applications may depend on their own routing state, event handling, or navigation mechanisms. Neither DOM hooks nor discovered internal functions should be described as supported browser-extension APIs.

## Public Bolt UI and Azure DevOps resources

| Resource | What it provides and how to use it |
| --- | --- |
| [Official Azure DevOps UI documentation and component explorer](https://developer.microsoft.com/azure-devops) | Public UI documentation and component exploration; the rendered title was **Formula Design System**. Use it to understand native control patterns and styling rather than assuming every Bolt-related resource uses the same name. |
| [`azure-devops-ui` on npm](https://www.npmjs.com/package/azure-devops-ui) | The published React UI library. Consult the package and official documentation when evaluating components and styles. |
| [Official Azure DevOps extension sample](https://github.com/microsoft/azure-devops-extension-sample) | A sample for the supported Azure DevOps extension SDK and contribution model. That model is distinct from ADO Boost's browser-extension approach of augmenting the host DOM; the sample does not make host DOM hooks supported APIs. |
| [`azure-devops-ui-public`](https://github.com/microsoft/azure-devops-ui-public) | The fetched README points to the official documentation and an issue-reporting portal. It was not established as a full component-source repository; do not use that description. |

## Practical investigation sequence

Start with the public component explorer and published library to understand the intended native controls and visual patterns. Use public extension documentation to identify supported integration points, and distinguish observed browser behavior from documented API contracts. These resource links alone are not evidence of how a particular host implementation behaves.

For browser-extension changes, review the lifecycle checklist and native ownership boundaries before altering selectors or navigation behavior. Verify repeated reconciliation, route changes, replaced containers, and recycled file rows without replacing native selection or reviewed-state behavior.
