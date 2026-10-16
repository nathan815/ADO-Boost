# Releasing ADO Boost

ADO Boost uses one [Semantic Versioning](https://semver.org/) version for the extension and Windows companion. The version is stored in `manifest.json`, both `package.json` files, and both lockfiles.

Use a patch release for backward-compatible fixes, a minor release for backward-compatible features, and a major release for intentionally incompatible behavior. Browser manifests require numeric versions, so prerelease labels such as `1.0.0-beta.1` are not used for published packages.

## Create a release

1. Start from a clean `main` branch with CI passing and pull the latest remote changes.
2. Set the version with `npm run release:version:set -- 0.2.0`.
3. Review the five changed version files.
4. Create the release commit and annotated tag with `npm run release:commit-tag -- 0.2.0`.
5. Push the commit and exact release tag with `npm run release:push -- 0.2.0`.

```powershell
npm run release:version:set -- 0.2.0
npm run release:commit-tag -- 0.2.0
npm run release:push -- 0.2.0
```

`release:version:set` accepts only a numeric `MAJOR.MINOR.PATCH` version and updates `manifest.json`, both `package.json` files, and both lockfiles.

`release:commit-tag` validates that all five files match the requested version, requires the `main` branch, refuses unrelated changes, stages only the version files, creates a `chore(release): v<version>` commit using the repository's normal Git hooks, and creates an annotated `v<version>` tag. It deliberately does not push.

`release:push` requires a clean `main` branch, revalidates the version, verifies that the requested annotated tag points to `HEAD`, and atomically pushes `main` and only that tag to `origin`. It does not use `--follow-tags`, which could push unrelated annotated tags.

Pushing the tag triggers the `Release` workflow. The workflow verifies that the tag points to `main` and matches every version file, reruns the extension and companion checks, builds both products, and creates a draft GitHub release with generated notes. Review and edit the draft in GitHub, add a short overview or upgrade warning when useful, and publish it when ready.

## Release-note categories

GitHub builds the generated notes from merged pull requests between the previous tag and the new tag. Apply one of these labels to each pull request before creating the release:

| Pull request label | Release-note section |
| --- | --- |
| `accessibility` | Accessibility |
| `enhancement` | Features |
| `bug` | Fixes |
| `documentation` | Documentation |
| Any other label or no label | Other Changes |

Pull requests labeled `duplicate`, `invalid`, `question`, or `wontfix` are excluded. Use concise, user-facing pull request titles because those titles become the categorized release-note entries.

The workflow also finds first-parent commits on `main` that are not associated with a pull request and appends them under **Direct Commit Changes**. These entries are categorized from the Conventional Commit prefix:

| Commit type | Release-note section |
| --- | --- |
| `feat` | Features |
| `fix` | Fixes |
| `docs` | Documentation |
| `perf` | Performance |
| `refactor` | Refactoring |
| `test` | Tests |
| `build`, `ci`, `style`, `chore` | Maintenance |
| `revert` | Reverts |
| A type followed by `!` | Breaking Changes |
| Unrecognized format | Other Changes |

Use the format `type(optional-scope): description`, such as `feat(review): add file-type filters`. Repository-wide commit guidance and examples are in [`.github/copilot-instructions.md`](../.github/copilot-instructions.md).

Each release contains:

- `ado-boost-extension-<version>.zip`, the store-ready extension with `manifest.json` at the archive root.
- `ado-boost-windows-<version>.zip`, a companion distribution with its JavaScript runtime dependencies and extension bundled. Extract it and run `setup.cmd`.

If a release build fails, fix the problem in a new commit, delete the failed tag locally and remotely, and recreate the same tag only if no GitHub release was published. If a release was already published or consumed, increment the patch version instead of moving its tag.
