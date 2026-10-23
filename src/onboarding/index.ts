import { requestCompanionSetupHealth } from "../core/companion-setup";
import { createOnboarding } from "./page";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Welcome page root is missing");
const { os } = await chrome.runtime.getPlatformInfo();
const page = createOnboarding(root, {
  health: requestCompanionSetupHealth,
  copy: (text) => navigator.clipboard.writeText(text),
  platform: os
});
window.addEventListener("pagehide", () => page.stop());
window.addEventListener("pageshow", () => page.start());
page.start();
