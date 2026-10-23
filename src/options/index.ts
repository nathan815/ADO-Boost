import { FEATURE_REGISTRY, type FeatureGroup, type FeatureSettings, defaultSettings, resolveFeature } from "../features/registry";
import { ChromeSettingsStorage, MemorySettingsStorage, SettingsService } from "../features/settings-service";
import { RuntimeCompanionAccountsGateway } from "../core/companion-accounts";
import { CompanionAccountSettings } from "../ui/companion-accounts";
import { CompanionSetupPage } from "../companion-setup/page";
import { requestCompanionSetupHealth } from "../core/companion-setup";
import { OptionsTabs } from "./tabs";

const isFixture = typeof chrome === "undefined" || !chrome.storage?.local;
const service = new SettingsService(isFixture ? new MemorySettingsStorage() : new ChromeSettingsStorage());
const rootElement = document.querySelector<HTMLElement>("#app");
if (!rootElement) throw new Error("Settings root is missing");
const root = rootElement;
const tabs = new OptionsTabs(document, window.location);
const accountSettings = isFixture ? null : new CompanionAccountSettings(new RuntimeCompanionAccountsGateway(), document);
const setupRoot = document.createElement("div");
setupRoot.className = "copilot-connection";
tabs.connection.append(setupRoot);
const setup = new CompanionSetupPage(setupRoot, {
  health: isFixture ? async () => ({ connected: false, authenticated: false, detail: "Synthetic offline fixture." }) : requestCompanionSetupHealth,
  copy: (text) => navigator.clipboard.writeText(text),
  platform: isFixture ? "unknown" : (await chrome.runtime.getPlatformInfo()).os,
  onHealth: (health) => tabs.setSetupRequired(!health.connected || !health.authenticated)
});
if (accountSettings) {
  const section = document.createElement("section");
  section.id = "companion-account-settings";
  section.className = "setting-list";
  section.setAttribute("aria-label", "Copilot account");
  section.append(accountSettings.element);
  tabs.connection.append(section);
}

let settings = await service.load();
let search = "";

const groupLabels: Record<FeatureGroup, string> = {
  overview: "PR overview",
  navigation: "Grouping and navigation",
  review: "Review progress and announcements",
  diffs: "Diff enhancements",
  discussions: "Drafts and discussions",
  copilot: "Copilot"
};

function render(): void {
  const visible = FEATURE_REGISTRY.filter((feature) =>
    `${feature.label} ${feature.description} ${groupLabels[feature.group]} ${feature.group === "copilot" ? "account login" : ""}`.toLowerCase().includes(search.toLowerCase())
  );
  root.innerHTML = `
    <header class="page-header"><div class="page-title"><img class="page-logo" src="./icons/ado-boost.svg" alt="ADO Boost"><div><h1>ADO Boost</h1><p>${isFixture ? "Synthetic offline fixture. " : ""}Choose which ADO Boost features appear in your pull request workflow.</p></div></div><label class="master"><input id="master" type="checkbox" ${settings.masterEnabled ? "checked" : ""}><span>Extension enabled</span></label></header>
  `;
  root.append(tabs.element);
  tabs.settings.innerHTML = `
    <div class="search-row"><input id="search" type="search" value="${escapeHtml(search)}" placeholder="Search settings" aria-label="Search settings"><select id="theme" aria-label="Theme"><option value="system" ${settings.presentation.theme === "system" ? "selected" : ""}>System theme</option><option value="light" ${settings.presentation.theme === "light" ? "selected" : ""}>Light</option><option value="dark" ${settings.presentation.theme === "dark" ? "selected" : ""}>Dark</option></select></div>
    <main>${([...new Set(visible.map((feature) => feature.group))] as FeatureGroup[]).map((group) => `
      <section><h2>${groupLabels[group]}</h2><div class="setting-list">${visible.filter((feature) => feature.group === group).map((feature) => {
        const resolution = resolveFeature(settings, feature.id);
        return `<label class="setting"><span><strong>${feature.label}</strong><small>${feature.description}${resolution.reason && settings.features[feature.id] ? ` <b>${resolution.reason}.</b>` : ""}</small></span><input type="checkbox" data-feature="${feature.id}" ${settings.features[feature.id] ? "checked" : ""}></label>`;
      }).join("")}</div></section>
    `).join("") || `<p class="empty">No settings match that search.</p>`}</main>
    <footer><button id="restore" class="secondary" type="button">Restore defaults</button><output id="status" aria-live="polite">Settings save automatically.</output></footer>
  `;
  bind();
}

function bind(): void {
  root.querySelector<HTMLInputElement>("#master")?.addEventListener("change", (event) => void update({ ...settings, masterEnabled: (event.target as HTMLInputElement).checked }));
  root.querySelector<HTMLInputElement>("#search")?.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement;
    const { selectionStart, selectionEnd, selectionDirection } = input;
    search = input.value;
    render();
    const replacement = root.querySelector<HTMLInputElement>("#search");
    replacement?.focus({ preventScroll: true });
    replacement?.setSelectionRange(selectionStart, selectionEnd, selectionDirection ?? undefined);
  });
  root.querySelector<HTMLSelectElement>("#theme")?.addEventListener("change", (event) => void update({ ...settings, presentation: { ...settings.presentation, theme: (event.target as HTMLSelectElement).value as FeatureSettings["presentation"]["theme"] } }));
  for (const input of root.querySelectorAll<HTMLInputElement>("[data-feature]")) {
    input.addEventListener("change", () => {
      const id = input.dataset.feature as keyof FeatureSettings["features"];
      void update({ ...settings, features: { ...settings.features, [id]: input.checked } });
    });
  }
  root.querySelector("#restore")?.addEventListener("click", () => {
    if (confirm("Restore all ADO Boost feature and presentation settings to their defaults? Saved review progress remains untouched.")) void update(defaultSettings());
  });
}

async function update(next: FeatureSettings): Promise<void> {
  settings = next;
  try {
    await service.save(settings);
    render();
    const output = root.querySelector<HTMLOutputElement>("#status");
    if (output) output.textContent = "Saved.";
  } catch (error) {
    const output = root.querySelector<HTMLOutputElement>("#status");
    if (output) output.textContent = error instanceof Error ? error.message : "Settings could not be saved.";
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[character] as string);
}

render();
void accountSettings?.load();
void setup.refresh();
