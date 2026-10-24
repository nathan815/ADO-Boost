# Development

## Build and load from source

Requirements: Node.js `^20.19.0` or `>=22.12.0`, npm, and Microsoft Edge or Chrome.

From the repository root:

```powershell
npm ci
npm run build
```

1. Open `edge://extensions` or `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose the repository's `dist` folder.
4. Open an Azure DevOps pull request.

After source changes, run `npm run build` again and reload the extension from the browser's extensions page.

## Checks

Run the extension checks from the repository root:

```powershell
npm run typecheck
npm test
npm run build
```

`npm test` scans only the root `tests` directory. The companion has separate dependencies and checks; run these on Windows:

```powershell
npm --prefix companion ci
npm --prefix companion run typecheck
npm --prefix companion test
```

CI runs both suites in separate Extension and Windows companion jobs. See the [companion documentation](../companion/README.md) for native-host diagnostics.

## Offline demo

```powershell
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173/demo.html`. The synthetic fixture is labeled and does not perform Azure DevOps writes.

## Technical references

- [SPA integration and Azure DevOps UI resources](spa-integration-and-ui-resources.md): content-script lifecycle and native UI integration.
- [Semantic group native file-tree specification](specs/semantic-group-native-file-tree-spec.md): grouping architecture and compatibility findings. For current generation and confirmation behavior, see the [user guide](user-guide.md#copilot-groups-and-questions).
- [Releasing](releasing.md): versioning, release scripts, and artifacts.
- [Edge publishing](publishing-to-edge.md): store submission.
