# Repository instructions

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) for every new commit:

```text
<type>[optional scope][!]: <description>
```

Use an imperative, user-readable description without a trailing period. Keep the first line concise because it appears in generated release notes.

Allowed types:

- `feat`: A user-visible feature or enhancement.
- `fix`: A user-visible bug fix.
- `docs`: Documentation-only changes.
- `perf`: A user-visible performance improvement.
- `refactor`: Internal restructuring without a user-visible behavior change.
- `test`: Test-only changes.
- `build`: Build system or dependency changes.
- `ci`: Continuous integration or release automation changes.
- `style`: Formatting or visual-only changes that do not change behavior.
- `chore`: Other maintenance work.
- `revert`: Reverts a previous change.

Add `!` before the colon for a breaking change, such as `feat(api)!: remove the legacy endpoint`.

Examples:

```text
feat(review): add file-type filters
fix(companion): preserve the installed host runtime
docs: explain Edge Store publishing
ci: publish versioned release archives
```
