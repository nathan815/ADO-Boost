---
name: chrome-extension-e2e
description: Test ADO Boost end to end in a dedicated Chrome profile, load or reload its unpacked extension through CDP, and verify the real extension on an authenticated Azure DevOps page. Use whenever changing extension behavior needs live browser verification, the user asks to test or reload the extension in Chrome, or isolated-profile extension testing is requested. Prefer this workflow over asking the user to reload chrome://extensions manually.
compatibility: Windows, installed Google Chrome with Extensions.loadUnpacked support, Node.js 22.12 or newer, PowerShell, and agent-browser. The human completes authentication.
---

# Isolated Chrome extension testing

Use one workflow: build the actual extension, attach to a dedicated Chrome profile, load it through browser-level CDP, then verify its behavior on the intended page. A DOM injection harness is not equivalent to the installed extension: it misses isolated/MAIN-world messaging, permissions, settings, CSP, and lifecycle behavior.

## Isolation and safety

- Keep this browser separate from the user's everyday browser. Use `%LOCALAPPDATA%\ADOBoost\ChromeDebug9223`, debugging port `9223`, and a named agent-browser session. Do not attach to an arbitrary browser on port `9222`.
- Bind debugging to loopback only. The debug endpoint can control this browser and its authenticated pages; do not expose it to a network or proxy.
- Do not copy cookies, tokens, or a normal browser profile. Let the human sign in once inside the dedicated profile. Do not automate credential, MFA, certificate-warning, or OS authentication prompts.
- Reuse the profile across runs so authentication and extension-local settings persist. Do not delete it during cleanup.
- Only load the locally built, trusted checkout. Do not install unrelated software or extensions, disable sandbox/CSP/site isolation, use remote-debugging origin wildcards, or bypass security warnings.
- Treat Azure DevOps testing as read-only. File selection, filters, comparisons, and local extension settings are suitable checks; native reviewed checkboxes persist server-side and are not disposable test controls. Do not post, vote, resolve, submit, merge, or otherwise write to the service without separate authorization.
- Keep unrelated tabs untouched, even when they share this debug browser. Never run `agent-browser close` or `close --all` against the shared debug profile.
- Preserve existing worktree edits. Testing is not permission to commit, push, restore defaults, or erase saved drafts/progress.

## 1. Inspect and build

Read the affected behavior, repository scripts, and current diff before choosing checks. From the repository root:

```powershell
git status --short
npm run typecheck
npm test -- tests/native-tree.test.ts tests/native-pr-enhancer.test.ts tests/settings.test.ts
npm run build
```

Adjust test selectors to the change. Each command must succeed before loading the bundle. Use a longer test timeout only when a genuine scheduling timeout is established; do not hide assertions or implementation failures.

`dist` is the real unpacked extension. Build before every reload; modifying source alone does not update the installed extension.

## 2. Start or reuse isolated Chrome

Use the bundled launcher:

```powershell
& .\.github\skills\chrome-extension-e2e\scripts\start-chrome.ps1
```

It resolves installed Chrome, starts the dedicated profile with extension-debugging support, verifies a responsive Chrome CDP endpoint, and reuses an existing listener only when its process belongs to the expected profile. It reports a port conflict rather than terminating a browser or silently switching ports.

The launcher accepts `-Port`, `-ProfileDirectory`, and `-ChromePath`. If choosing a different port/profile, pass the same port to the reload helper and agent-browser. Never run two browsers against the same profile simultaneously. For concurrent agent work, allocate separate profile directories, CDP ports, and agent-browser session names; separate session names alone do not isolate a browser.

The Chrome flag `--enable-unsafe-extension-debugging` is needed for the browser-level `Extensions.loadUnpacked` command. Use it only in this dedicated local debug profile. If an existing Chrome was started without it, ask the user to close that debug browser and relaunch it; do not kill Chrome processes or interact with their regular browser.

If authentication is required, give the human the target page in this browser and wait for them to complete sign-in.

## 3. Load or reload the extension through CDP

From the repository root:

```powershell
node .\.github\skills\chrome-extension-e2e\scripts\reload-extension.mjs --extension .\dist --port 9223
```

The helper gets the browser WebSocket from `http://127.0.0.1:9223/json/version` and calls:

```json
{"id":1,"method":"Extensions.loadUnpacked","params":{"path":"<absolute local dist directory>"}}
```

This is the browser endpoint, not a page target or a `Runtime.evaluate` call. Loading the same directory reloads the extension and preserves its ID/settings in the tested Chrome configuration. Use the returned extension ID; do not hardcode one from a different checkout or profile.

If the command is unavailable or denied, report the error and check the launch flags, Chrome version, and local policies. Do not fall back silently to a harness or claim the extension was reloaded.

Loading the extension does not refresh content scripts already injected into a page. Reload the intended test tab next.

## 4. Attach browser automation and explicitly select the test tab

Invoke the `agent-browser` skill and read its current CLI guide before using its commands:

```powershell
agent-browser skills get core
agent-browser --session ado-boost-e2e connect 9223
agent-browser --session ado-boost-e2e tab
```

Identify the user-provided PR URL and record its stable `tabId`. Create a new test tab if necessary instead of navigating an unrelated one. The following `t1` is an example, not a guaranteed target:

```powershell
agent-browser --session ado-boost-e2e tab t1
agent-browser --session ado-boost-e2e get url
agent-browser --session ado-boost-e2e reload
agent-browser --session ado-boost-e2e wait '[data-adopp-react-stat]'
```

Verify the URL before reloading. The active/default target can change when the user opens a tab or extension loading changes focus. Explicitly select the known test tab before each reload or navigation; reconnect after a daemon/session expiry.

Prefer scoped snapshots and small DOM evaluations over full-page snapshots, which can dump an entire PR's diff:

```powershell
agent-browser --session ado-boost-e2e snapshot -i -s '.repos-compare-filter'
agent-browser --session ado-boost-e2e eval 'document.querySelector("[data-adopp-total-file-count]")?.textContent'
```

Wait for behavior-specific conditions rather than arbitrary sleeps or only network idle. Waiting for badges is appropriate only in a compatible Files comparison with enhancements enabled; unavailable and disabled states need different assertions.

## 5. Verify the real feature

Read `references\ado-boost-checklist.md` and select the relevant acceptance checks. Derive totals and expected matching files from the actual PR; the examples `12` and `3` are not universal assertions.

Exercise actual controls and verify the resulting native model/UI, not just that a button exists. Prefer agent-browser refs or semantic selectors. Refresh snapshots after DOM changes.

If a hidden/background tab does not receive pointer events, a DOM `.click()` on an inspected, unambiguous filter control can exercise its real handler. This verifies handler/model behavior, not physical pointer interaction. Do not use it to claim scrolling, focus, drag, or hit-testing coverage.

PowerShell interprets unquoted `@eN` as splatting: quote refs such as `'@e5'`. For complex JavaScript quoting, use a PowerShell single-quoted here-string, encode it with `[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($js))`, then pass `eval -b $encoded`.

For settings tests, open `chrome-extension://<returned ID>/options.html` in an owned temporary tab and record its ID. Toggle only the setting under test, then switch back explicitly to the PR tab. Restore original values and close only the temporary tab.

## 6. Finish without disturbing the environment

Clear temporary filters, restore the previous comparison/file selection and any settings changed for testing, remove owned diagnostic globals, and close only tabs created for the checks. Leave the dedicated Chrome/profile available for later runs. Remove owned scratch files, not profile data or the session root.

Report the implementation result and any meaningful limitation. Distinguish automated/unit coverage, installed-extension browser checks, and untested pointer/pagination/host variants when validation details are requested. Do not claim a full end-to-end pass from an injected harness alone.

## Helper checks

```powershell
node --test .\.github\skills\chrome-extension-e2e\scripts\reload-extension.test.mjs
```

The prompts in `evals\evals.json` cover cold start, reload, and isolation/cleanup. Run real-browser scenarios serially within a profile, never in competing agents sharing that browser.
