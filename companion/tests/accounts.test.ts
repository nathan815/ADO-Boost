import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { accountEnvironment, accountSchema, availableAccounts, companionEnvironment, requirePinnedAccount, sameAccount } from "../src/accounts.js";

const work = { host: "https://github.com", login: "work_account" };
const personal = { host: "https://github.com", login: "personal" };
const directories: string[] = [];
async function temporary(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "ado-boost-accounts-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("companion account selection", () => {
  it("lists only account metadata, deduplicates and never returns credentials", async () => {
    const home = await temporary();
    await writeFile(join(home, "config.json"), JSON.stringify({
      logged_in_users: [personal, work, { ...work, login: "WORK_ACCOUNT" }],
      last_logged_in_user: personal,
      copilot_tokens: { secret: "not-for-the-extension" }
    }));
    expect(await availableAccounts(home)).toEqual([personal, work]);
    expect(await availableAccounts(join(home, "missing"))).toEqual([]);
  });

  it("supports camel-case CLI metadata and reports corrupt files rather than hiding them", async () => {
    const home = await temporary();
    await writeFile(join(home, "config.json"), JSON.stringify({ loggedInUsers: [work], lastLoggedInUser: personal }));
    expect(await availableAccounts(home)).toEqual([work, personal]);
    await writeFile(join(home, "config.json"), "{");
    await expect(availableAccounts(home)).rejects.toThrow();
  });

  it("selects the pinned stored account in an isolated profile without changing global state or copying tokens", async () => {
    const home = await temporary();
    const sourceHome = join(home, "source");
    await mkdir(sourceHome);
    const source = JSON.stringify({ last_logged_in_user: personal, logged_in_users: [personal, work], copilot_tokens: { fake: "never-copy" } });
    await writeFile(join(sourceHome, "config.json"), source);
    await writeFile(join(sourceHome, "settings.json"), `// Copilot user settings\n{ "model": "preferred-model", "hooks": {}, }`);
    const env = await accountEnvironment(join(home, "profiles"), work, {
      COPILOT_HOME: sourceHome, GH_TOKEN: "wrong-token", COPILOT_PROVIDER_BASE_URL: "https://unrelated.invalid", PATH: "path"
    });
    expect(env.COPILOT_HOME).not.toBe(sourceHome);
    expect(env).toMatchObject({ COPILOT_GH_HOST: "github.com", PATH: "path", COPILOT_MODEL: "preferred-model" });
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.COPILOT_PROVIDER_BASE_URL).toBeUndefined();
    expect(JSON.parse(await readFile(join(env.COPILOT_HOME!, "config.json"), "utf8"))).toEqual({
      last_logged_in_user: work, logged_in_users: [work]
    });
    expect(await readFile(join(sourceHome, "config.json"), "utf8")).toBe(source);
    const personalEnv = await accountEnvironment(join(home, "profiles"), personal, { COPILOT_HOME: sourceHome, COPILOT_MODEL: "environment-model" });
    expect(personalEnv.COPILOT_HOME).not.toBe(env.COPILOT_HOME);
    expect(personalEnv.COPILOT_MODEL).toBe("environment-model");
  });

  it("strips auth overrides case-insensitively while retaining runtime environment", () => {
    expect(companionEnvironment({
      Path: "runtime", LOCALAPPDATA: "local", github_token: "x", COPILOT_SDK_AUTH_TOKEN: "x",
      GH_HOST: "other", https_proxy: "proxy", COPILOT_PROVIDER_API_KEY_COMMAND: "command", COPILOT_API_URL: "other"
    })).toEqual({ Path: "runtime", LOCALAPPDATA: "local" });
  });

  it("fails closed for missing pins, missing identities, signed-out and wrong accounts or hosts", () => {
    expect(() => requirePinnedAccount(undefined, { isAuthenticated: true })).toThrow("Choose");
    expect(() => requirePinnedAccount(work, { isAuthenticated: false })).toThrow("Sign in");
    for (const auth of [
      { isAuthenticated: true },
      { isAuthenticated: true, ...personal },
      { isAuthenticated: true, ...work, host: "https://tenant.ghe.com" }
    ]) expect(() => requirePinnedAccount(work, auth)).toThrow("mismatch");
    expect(() => requirePinnedAccount(work, { isAuthenticated: true, ...work, login: "WORK_ACCOUNT", host: "github.com" })).not.toThrow();
  });

  it("bounds account selectors to supported hosts and safe profile path components", () => {
    expect(sameAccount(work, { ...work, login: "WORK_ACCOUNT" })).toBe(true);
    expect(accountSchema.parse({ ...work, host: "GitHub.com" }).host).toBe(work.host);
    for (const host of ["http://github.com", "https://github.com/evil", "https://user@github.com", "https://evil.invalid", "https://github.com:4430"]) {
      expect(accountSchema.safeParse({ ...work, host }).success).toBe(false);
    }
    for (const login of ["../work", "..", "work\\other", "", "work name"]) expect(accountSchema.safeParse({ ...work, login }).success).toBe(false);
  });
});
