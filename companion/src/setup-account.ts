import type { GetAuthStatusResponse } from "@github/copilot-sdk";
import { requirePinnedAccount, sameAccount, type CopilotAccount } from "./accounts.js";

interface SetupAccountDependencies {
  accounts(): Promise<CopilotAccount[]>;
  verify(account: CopilotAccount): Promise<GetAuthStatusResponse>;
  login(host: string): Promise<void>;
  confirm(question: string): Promise<boolean>;
  choose(accounts: CopilotAccount[]): Promise<CopilotAccount>;
  interactive: boolean;
}

export async function resolveSetupAccount(
  preferred: CopilotAccount | undefined,
  dependencies: SetupAccountDependencies
): Promise<CopilotAccount> {
  let accounts = await dependencies.accounts();
  let signedIn = false;
  const signIn = async (account?: CopilotAccount): Promise<void> => {
    const target = account ? `${account.login} (${account.host})` : "GitHub Copilot";
    if (!dependencies.interactive) throw new Error(`Sign-in is required for ${target}. Rerun ado-boost setup in an interactive terminal without --yes.`);
    if (!await dependencies.confirm(`Sign in to ${target} now and continue setup?`)) {
      throw new Error("Copilot sign-in declined. Native host setup was not changed.");
    }
    await dependencies.login(account?.host ?? "https://github.com");
    signedIn = true;
    accounts = await dependencies.accounts();
    if (!accounts.length) throw new Error("Copilot sign-in did not return a signed-in account. Rerun ado-boost setup to retry.");
  };
  if (!accounts.length || preferred && !accounts.some((account) => sameAccount(account, preferred))) {
    await signIn(preferred);
  }
  if (!preferred && !dependencies.interactive) throw new Error("Select an account explicitly with setup --account <username> [--host <host>].");
  const account = preferred ?? await dependencies.choose(accounts);
  const requireKnownAccount = () => {
    if (!accounts.some((candidate) => sameAccount(candidate, account))) {
      throw new Error(`Copilot is not signed in as ${account.login} (${account.host}). Rerun ado-boost setup and sign in with that account.`);
    }
  };
  requireKnownAccount();
  let auth = await dependencies.verify(account);
  if (!auth.isAuthenticated && !signedIn) {
    await signIn(account);
    requireKnownAccount();
    auth = await dependencies.verify(account);
  }
  if (!auth.isAuthenticated) throw new Error("Copilot is still signed out after sign-in. Rerun ado-boost setup to retry.");
  requirePinnedAccount(account, auth);
  return account;
}
