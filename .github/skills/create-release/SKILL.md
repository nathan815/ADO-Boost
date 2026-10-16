---
name: create-release
description: Create, cut, or publish a new ADO Boost project release using the repository's version, commit, tag, push, GitHub Actions, and draft-release workflow. Use whenever the user asks to release ADO Boost, cut a version, create a release tag, publish release artifacts, or prepare a new extension/companion release. Follow the repository scripts instead of manually editing versions or constructing archives.
compatibility: Git, Node.js, npm, GitHub CLI authenticated for the repository, and a clean main branch.
---

# Create an ADO Boost release

Create releases through the repository's guarded npm commands. A successful run creates and pushes an annotated version tag, waits for the `Release` workflow, and leaves a draft GitHub release containing the extension and Windows companion ZIPs for human review.

## Safety boundaries

- Treat a request to create or cut a release as authorization to create the version commit, annotated tag, and push them through the documented release scripts.
- Do not publish the draft GitHub release unless the user separately and explicitly asks to make it public.
- Do not bypass Git hooks, force-push, move an existing tag, rewrite history, stash changes, discard changes, or delete a local or remote tag automatically.
- Do not release from a branch other than `main`.
- Stop when unrelated tracked or untracked changes are present. Identify them and let the user decide how they should be committed or handled.
- Never expose GitHub, Edge Store, or other credentials in output, files, commands, or release notes.

## 1. Read the release contract

Read `docs/releasing.md`, `package.json`, `.github/workflows/release.yml`, and `.github/release.yml`. Use the repository scripts and current documentation as the source of truth if they differ from examples in this skill.

Inspect the repository without changing it:

```powershell
git status --short
git branch --show-current
git fetch origin
git rev-list --left-right --count origin/main...main
git tag --sort=-version:refname
```

Require a clean `main` branch. If `main` is only behind `origin/main`, update it with `git pull --ff-only`. Stop on divergence or unrelated local changes.

## 2. Select the version

Use an explicitly requested numeric `MAJOR.MINOR.PATCH` version when provided. Otherwise read the current version and inspect user-visible changes since the latest release tag:

```powershell
node -p "require('./manifest.json').version"
git log --first-parent --oneline <latest-tag>..HEAD
```

Recommend:

- Patch for backward-compatible fixes.
- Minor for backward-compatible features.
- Major for intentionally incompatible behavior.

Ask one focused version question when the user did not specify the version. Do not invent a version silently. Published browser versions must be numeric and cannot contain prerelease labels.

## 3. Create the release commit and tag

Run the guarded commands with the selected version:

```powershell
npm run release:version:set -- <version>
npm run release:version:check -- <version>
git diff -- manifest.json package.json package-lock.json companion/package.json companion/package-lock.json
npm run release:commit-tag -- <version>
```

Confirm that only the five version files changed before `release:commit-tag`. That command uses normal Git hooks and creates `chore(release): v<version>` plus annotated tag `v<version>`.

If a hook or command fails, fix only the actual failure when it is within scope. Do not use `--no-verify`. Do not recreate or move a tag without explaining the failure and obtaining the user's decision when a commit or tag was partially created.

## 4. Push the exact release

Use the guarded push command:

```powershell
npm run release:push -- <version>
```

This atomically pushes `main` and only the requested annotated tag. Do not substitute `git push --follow-tags`, which can push unrelated tags.

## 5. Monitor the release workflow

Find the run for the release commit and wait for it:

```powershell
$sha = git rev-parse HEAD
gh run list --workflow Release --commit $sha --limit 1 --json databaseId,status,conclusion,url
gh run watch <run-id> --exit-status
```

If the run is not visible immediately, retry for a bounded period. If it fails, inspect the failed steps with `gh run view <run-id> --log-failed`, report the concrete failure, and leave the commit and tag intact unless the user chooses a recovery path.

## 6. Verify the draft release

Inspect the resulting release:

```powershell
gh release view v<version> --json name,url,isDraft,assets,body
```

Require:

- The release is a draft.
- `ado-boost-extension-<version>.zip` exists.
- `ado-boost-windows-<version>.zip` exists.
- Generated notes include categorized pull requests and categorized direct commits when applicable.

Report the draft release URL, version, workflow result, and asset names. Tell the user the draft is ready for review. Do not publish it without a separate explicit request.

## Recovery guidance

- Before a draft release exists, a failed workflow can be fixed in a new commit. Do not move the tag automatically.
- If the tag must be replaced, explain the local and remote tag consequences and ask for approval before deleting or recreating it.
- Once a release has been published or consumed, increment the patch version instead of moving the tag.
