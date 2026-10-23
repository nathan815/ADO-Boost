import { readFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import JSON5 from "json5";
import type { GetAuthStatusResponse } from "@github/copilot-sdk";

export const accountSchema = z.object({
  host: z.string().transform((value, context) => {
    try {
      const url = new URL(value.includes("://") ? value : `https://${value}`);
      if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash
        || !(url.hostname === "github.com" || /^[a-z0-9-]+\.ghe\.com$/.test(url.hostname))) throw new Error();
      return url.origin;
    } catch {
      context.addIssue({ code: "custom", message: "Choose github.com or a GitHub Enterprise Cloud host" });
      return z.NEVER;
    }
  }),
  login: z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
});

export type CopilotAccount = z.infer<typeof accountSchema>;

export function sameAccount(left: CopilotAccount, right: CopilotAccount): boolean {
  return left.host === right.host && left.login.toLowerCase() === right.login.toLowerCase();
}

export async function readJsonIfPresent(path: string): Promise<unknown | undefined> {
  try {
    return JSON5.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function availableAccounts(copilotHome = process.env.COPILOT_HOME ?? join(homedir(), ".copilot")): Promise<CopilotAccount[]> {
  const value = await readJsonIfPresent(join(copilotHome, "config.json"));
  if (value === undefined) return [];
  const config = z.object({
    logged_in_users: z.array(accountSchema).optional(),
    loggedInUsers: z.array(accountSchema).optional(),
    last_logged_in_user: accountSchema.optional(),
    lastLoggedInUser: accountSchema.optional()
  }).parse(value);
  const accounts = [...config.logged_in_users ?? config.loggedInUsers ?? []];
  const last = config.last_logged_in_user ?? config.lastLoggedInUser;
  if (last) accounts.push(last);
  return accounts.filter((account, index) => accounts.findIndex((other) => sameAccount(account, other)) === index);
}

export function companionEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([name]) =>
    !/(^|_)(TOKEN|SECRET|PASSWORD|AUTH|API_KEY)$/i.test(name)
    && !/^(HTTP|HTTPS|ALL|NO)_PROXY$/i.test(name)
    && !/^COPILOT_(HOME|GH_HOST|PROVIDER_.*|OFFLINE|API_URL)$/i.test(name)
    && !/^GH_HOST$/i.test(name)
  ));
}

export async function accountEnvironment(profileRoot: string, account: CopilotAccount, source: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  const home = join(profileRoot, new URL(account.host).hostname, `user-${account.login.toLowerCase()}`);
  await mkdir(home, { recursive: true });
  const configPath = join(home, "config.json");
  const existing = z.record(z.string(), z.unknown()).parse(await readJsonIfPresent(configPath) ?? {});
  delete existing.lastLoggedInUser;
  delete existing.loggedInUsers;
  // Only account metadata is seeded. Copilot retrieves the existing token from the OS credential store.
  await writeJsonAtomic(configPath, {
    ...existing,
    last_logged_in_user: account,
    logged_in_users: [account]
  });
  return {
    ...companionEnvironment(source),
    COPILOT_HOME: home,
    COPILOT_GH_HOST: new URL(account.host).hostname
  };
}

export function requirePinnedAccount(account: CopilotAccount | undefined, auth: GetAuthStatusResponse): void {
  if (!account) throw accountError("account-required", "Choose a Copilot account in ADO Boost settings or run ado-boost setup --account <username>.");
  if (!auth.isAuthenticated) throw accountError("login-required", `Run ado-boost setup to sign in to Copilot as ${account.login} (${account.host}), then refresh.`);
  const actual = accountSchema.safeParse({ host: auth.host, login: auth.login });
  if (!actual.success || !sameAccount(account, actual.data)) {
    throw accountError("account-mismatch", `Copilot account mismatch: pinned ${account.login} (${account.host}), but the CLI reported ${auth.login ?? "an unknown account"} (${auth.host ?? "unknown host"}). No PR context was sent.`);
  }
}

function accountError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
