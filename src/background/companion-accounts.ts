import { z } from "zod";
import { companionAccountsSchema } from "../core/companion-accounts";
import type { NativeCopilotClient } from "./native-copilot";

const requestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("accounts") }),
  z.object({ kind: z.literal("select-account"), account: companionAccountsSchema.shape.selected.unwrap() })
]);

export class CompanionAccountsService {
  constructor(
    private readonly native: Pick<NativeCopilotClient, "request">,
    private readonly extensionId: string,
    private readonly optionsUrl: string
  ) {}

  async handle(message: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> {
    if (sender.id !== this.extensionId || sender.url?.split("#")[0] !== this.optionsUrl) {
      throw new Error("Companion account settings are accepted only from this extension's settings page");
    }
    const request = requestSchema.parse(message);
    return companionAccountsSchema.parse(await this.native.request(request.kind, request.kind === "select-account" ? { account: request.account } : {}));
  }
}

export function isCompanionAccountsMessage(value: unknown): boolean {
  return !!value && typeof value === "object" && "channel" in value && value.channel === "adopp-companion-accounts";
}
