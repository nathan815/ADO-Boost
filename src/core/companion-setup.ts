import type { CopilotHealth } from "./copilot-gateway";

export const COMPANION_INSTALL_COMMAND = "Invoke-WebRequest https://raw.githubusercontent.com/nathan815/ADO-Boost/main/scripts/install.ps1 -OutFile \"$env:TEMP\\install-ado-boost.ps1\"; if ($?) { & \"$env:TEMP\\install-ado-boost.ps1\" }";

export function companionSetupUrl(): string {
  return typeof chrome !== "undefined" && chrome.runtime?.getURL ? chrome.runtime.getURL("options.html#copilot-connection") : "./options.html#copilot-connection";
}

export async function openCompanionSetup(): Promise<void> {
  const response: unknown = await chrome.runtime.sendMessage({ channel: "adopp-ui", kind: "open-companion-setup" });
  if (!response || typeof response !== "object" || !("ok" in response) || response.ok !== true) {
    throw new Error(response && typeof response === "object" && "error" in response && typeof response.error === "string" ? response.error : "Could not open companion setup");
  }
}

export async function requestCompanionSetupHealth(): Promise<CopilotHealth> {
  const response = await chrome.runtime.sendMessage({ channel: "adopp-companion-setup", kind: "health" }) as { ok: true; data: CopilotHealth } | { ok: false; error: string } | undefined;
  if (!response) throw new Error("No response from ADO Boost. Reload this page to try again.");
  if (!response.ok) throw new Error(response.error);
  return response.data;
}
