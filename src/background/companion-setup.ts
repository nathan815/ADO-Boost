import { parseCopilotHealth } from "../core/copilot-gateway";
import type { NativeCopilotClient } from "./native-copilot";

export async function companionSetupHealth(
  sender: chrome.runtime.MessageSender,
  extensionId: string,
  setupUrl: string,
  native: Pick<NativeCopilotClient, "request">
) {
  const allowedUrls = [setupUrl, new URL("onboarding.html", setupUrl).href];
  if (sender.id !== extensionId || !sender.url || !allowedUrls.includes(sender.url.split("#")[0]!)) {
    throw new Error("Companion setup checks are accepted only from this extension's settings or welcome page");
  }
  return parseCopilotHealth(await native.request("health"));
}
