import { AdoApi, type HttpClient } from "../adapters/ado-api";
import { MemoryBrowserStore } from "../adapters/browser";
import type { PullRequestAnalysis } from "../core/types";
import { defaultSettings } from "../features/registry";
import { MemorySettingsStorage, SettingsService } from "../features/settings-service";
import { ReviewPanel } from "../ui/review-panel";
import type { WriteGateway } from "../core/write-gateway";
import type { CopilotGateway } from "../core/copilot-gateway";

document.body.innerHTML = `
  <header class="fake-topbar"><strong>Azure DevOps</strong><span>Repos</span><span>Pull requests</span></header>
  <div class="fake-workspace">
  <main class="fake-page" data-adopp-panel-content>
    <p class="fixture-label">Synthetic offline fixture</p>
    <h1>Improve resilient checkout and review telemetry</h1>
    <p class="meta">Alex Reviewer wants to merge 6 files into main</p>
    <nav><button>Overview</button><button class="active">Files</button><button>Updates</button></nav>
    <section class="fake-diff"><aside>src<br>tests<br>docs<br>package-lock.json</aside><pre><span class="removed">- return fetch(url)</span>
<span class="added">+ return retry(() =&gt; fetch(url), signal)</span>
<span class="added">+   .catch(reportFailure)</span></pre></section>
  </main>
  </div>
`;

const style = document.createElement("style");
style.textContent = `
  :root{font-family:"Segoe UI",system-ui,sans-serif;color:#242424;background:#f3f3f3}.fake-topbar{height:44px;display:flex;align-items:center;gap:22px;padding:0 20px;color:white;background:#0078d4}.fake-page{width:min(1100px,calc(100% - 40px));margin:28px auto;background:white;padding:24px;min-height:650px;box-shadow:0 1px 4px rgb(0 0 0 / 12%)}.fixture-label{display:inline-block;margin:0 0 12px;padding:3px 7px;color:#6b4d00;background:#fff4ce;border:1px solid #e6c35c;border-radius:3px;font-size:12px;font-weight:700}.fake-page h1{margin:0;font-size:24px}.meta{color:#616161}.fake-page nav{display:flex;gap:4px;margin:24px -24px 0;padding:0 24px;border-bottom:1px solid #ddd}.fake-page nav button{border:0;background:transparent;padding:10px 12px}.fake-page nav .active{border-bottom:2px solid #0078d4}.fake-diff{display:grid;grid-template-columns:220px 1fr;margin-top:18px;border:1px solid #ddd}.fake-diff aside{padding:18px;line-height:2;background:#f7f7f7;border-right:1px solid #ddd}.fake-diff pre{padding:18px;font-family:Consolas,monospace}.added{display:block;background:#dff6dd;color:#0b6a0b}.removed{display:block;background:#fde7e9;color:#a4262c}
`;
document.head.append(style);

const files = [
  { trackingId: 1, path: "/src/retry.ts", changeType: "edit", objectId: "a1", additions: 28, deletions: 8, state: "exact" as const, generated: false, lockfile: false },
  { trackingId: 2, path: "/src/checkout.ts", changeType: "edit", objectId: "a2", additions: 14, deletions: 4, state: "exact" as const, generated: false, lockfile: false },
  { trackingId: 3, path: "/tests/retry.test.ts", changeType: "add", objectId: "a3", additions: 62, deletions: 0, state: "exact" as const, generated: false, lockfile: false },
  { trackingId: 4, path: "/docs/reviewing.md", changeType: "edit", objectId: "a4", additions: 10, deletions: 2, state: "exact" as const, generated: false, lockfile: false },
  { trackingId: 5, path: "/package-lock.json", changeType: "edit", objectId: "a5", additions: 120, deletions: 116, state: "exact" as const, generated: false, lockfile: true },
  { trackingId: 6, path: "/dist/client.min.js", changeType: "edit", objectId: "a6", additions: null, deletions: null, state: "unavailable" as const, detail: "File exceeds analysis limit", generated: true, lockfile: false }
];

const analysis: PullRequestAnalysis = {
  context: {
    origin: location.origin,
    organization: "fixture-org",
    project: "fixture-project",
    repository: "fixture-repo",
    repositoryId: "fixture-repo-id",
    pullRequestId: 418,
    title: "Improve resilient checkout and review telemetry",
    sourceCommit: "source-commit",
    targetCommit: "target-commit",
    mergeBaseCommit: "merge-base-commit",
    iterationId: 4,
    identity: "fixture/418/4",
    reviewer: { id: "fixture-reviewer", displayName: "Alex Reviewer" }
  },
  files,
  groups: [],
  threads: { state: "available", active: 3, resolved: 5, total: 8 },
  completedTrackingIds: new Set([4])
};

class OfflineHttpClient implements HttpClient {
  async fetch(): Promise<Response> {
    return new Response(JSON.stringify({ message: "Synthetic fixture does not perform writes" }), { status: 503 });
  }
}

const store = new MemoryBrowserStore();
const settingsService = new SettingsService(new MemorySettingsStorage());
const fixtureSettings = defaultSettings();
fixtureSettings.presentation.theme = "light";
style.textContent += `.fake-workspace{display:flex;height:calc(100vh - 44px);overflow:hidden}.fake-page{overflow:auto;min-height:0;margin:0;padding:24px;box-shadow:none}body{margin:0}`;
const panel = new ReviewPanel({
  analysis,
  api: new AdoApi(new OfflineHttpClient()),
  store,
  settingsService,
  settings: fixtureSettings,
  openSettings: () => undefined,
  writes: {
    postAnnouncement: async () => { throw new Error("Synthetic fixture does not perform writes"); },
    submitReview: async () => { throw new Error("Synthetic fixture does not perform writes"); },
    retryDecision: async () => { throw new Error("Synthetic fixture does not perform writes"); },
    setThreadStatus: async () => { throw new Error("Synthetic fixture does not perform writes"); }
  } satisfies WriteGateway,
  copilot: {
    health: async () => ({ connected: false, authenticated: false, detail: "Synthetic fixture" }),
    semanticGroups: async () => { throw new Error("Synthetic fixture does not transmit PR context"); },
    chat: async () => { throw new Error("Synthetic fixture does not transmit PR context"); }
  } satisfies CopilotGateway,
  reviewKey: "fixture-review",
  synthetic: true
});
panel.openDiscussions();
