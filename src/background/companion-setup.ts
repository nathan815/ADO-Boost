import { parseCopilotHealth } from "../core/copilot-gateway";
import type { NativeCopilotClient } from "./native-copilot";

export async function companionSetupHealth(
  sender: chrome.runtime.MessageSender,
  extensionId: string,
  setupUrl: string,
  native: Pick<NativeCopilotClient, "request">
) {
  if (sender.id !== extensionId || sender.url?.split("#")[0] !== setupUrl) {
    throw new Error("Companion setup checks are accepted only from this extension's settings page");
  }
  return parseCopilotHealth(await native.request("health"));
}
