import { z } from "zod";

const accountSchema = z.object({
  host: z.string().url(),
  login: z.string().min(1).max(100)
});
export const companionAccountsSchema = z.object({
  accounts: z.array(accountSchema),
  selected: accountSchema.nullable()
});
export type CompanionAccount = z.infer<typeof accountSchema>;
export type CompanionAccounts = z.infer<typeof companionAccountsSchema>;

export interface CompanionAccountsGateway {
  list(): Promise<CompanionAccounts>;
  select(account: CompanionAccount): Promise<CompanionAccounts>;
}

export class RuntimeCompanionAccountsGateway implements CompanionAccountsGateway {
  list(): Promise<CompanionAccounts> {
    return this.send("accounts");
  }

  select(account: CompanionAccount): Promise<CompanionAccounts> {
    return this.send("select-account", account);
  }

  private async send(kind: string, account?: CompanionAccount): Promise<CompanionAccounts> {
    const response: unknown = await chrome.runtime.sendMessage({ channel: "adopp-companion-accounts", kind, account });
    const result = z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), data: companionAccountsSchema }),
      z.object({ ok: z.literal(false), error: z.string() })
    ]).parse(response);
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }
}
