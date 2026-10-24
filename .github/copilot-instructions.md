# Repository instructions

## README scope

Keep `README.md` a concise, stable landing page: what ADO Boost does, a short feature overview, essential installation, privacy pointers, and links to focused documentation.

- Do not append a README paragraph or bullet for every feature or fix. Update an existing summary only when the top-level feature overview genuinely changes.
- Keep changelog-style updates, implementation details, exhaustive settings lists, and click-by-click UI descriptions out of the README.
- Put user-facing behavior and setup details in `docs/user-guide.md`, contributor instructions in `docs/development.md`, companion-specific details in `companion/README.md`, and data-handling details in `PRIVACY.md`. Update the relevant existing section instead of duplicating it.
- Change the README when installation, prerequisites, the top-level feature overview, or documentation links need to change. Routine feature work should not grow it.
- Delete obsolete or repetitive prose rather than relocating it just to preserve text. Do not hard wrap Markdown paragraphs.

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
