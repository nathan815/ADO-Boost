import coreStyles from "azure-devops-ui/Core/core.css?inline";
import buttonStyles from "azure-devops-ui/Components/Button/Button.css?inline";
import linkStyles from "azure-devops-ui/Components/Link/Link.css?inline";
import spinnerStyles from "azure-devops-ui/Components/Spinner/Spinner.css?inline";
import statusStyles from "azure-devops-ui/Components/Status/Status.css?inline";
import calloutStyles from "azure-devops-ui/Components/Callout/Callout.css?inline";
import portalStyles from "azure-devops-ui/Components/Portal/Portal.css?inline";
import popupStyles from "./popup.css?inline";
import { RECENT_PRS_KEY } from "../core/recent-prs";
import { migrateSettings } from "../features/registry";
import { SETTINGS_KEY } from "../features/settings-service";
import type { PopupMessage } from "../background/popup-service";
import { ExtensionPopup } from "./popup";

async function send<T>(kind: Exclude<PopupMessage["kind"], "record-visit">): Promise<T> {
  const response = await chrome.runtime.sendMessage({ channel: "adopp-popup", kind }) as { ok: true; data: T } | { ok: false; error: string } | undefined;
  if (!response) throw new Error("No response from ADO Boost. Reopen the popup to try again.");
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

const styles = document.createElement("style");
styles.textContent = [coreStyles, buttonStyles, linkStyles, spinnerStyles, statusStyles, calloutStyles, portalStyles, popupStyles].join("\n");
document.head.append(styles);
const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Popup root is missing");
const popup = new ExtensionPopup(root, {
  health: () => send("health"),
  list: () => send("list-recent"),
  clear: () => send("clear-recent"),
  openSettings: () => chrome.runtime.openOptionsPage(),
  settings: async () => migrateSettings((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]),
  subscribe: (listener) => {
    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") return;
      if (RECENT_PRS_KEY in changes) listener("history");
      if (SETTINGS_KEY in changes) listener("settings");
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }
});
popup.start();
addEventListener("pagehide", () => popup.destroy(), { once: true });
