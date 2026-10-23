import { describe, expect, it, vi } from "vitest";
import { resolveSetupAccount } from "../src/setup-account.js";

const account = { login: "reviewer", host: "https://github.com" };
const other = { login: "different", host: "https://github.com" };
function dependencies() {
  return {
    accounts: vi.fn().mockResolvedValue([account]),
    verify: vi.fn().mockResolvedValue({ isAuthenticated: true, ...account }),
    login: vi.fn().mockResolvedValue(undefined),
    confirm: vi.fn().mockResolvedValue(true),
    choose: vi.fn().mockResolvedValue(account),
    interactive: true
  };
}

describe("setup account sign-in", () => {
  it("signs in on first install, rereads accounts, and continues setup with the selected identity", async () => {
    const deps = dependencies();
    deps.accounts.mockResolvedValueOnce([]);
    await expect(resolveSetupAccount(undefined, deps)).resolves.toEqual(account);
    expect(deps.confirm).toHaveBeenCalledOnce();
    expect(deps.login).toHaveBeenCalledWith("https://github.com");
    expect(deps.accounts).toHaveBeenCalledTimes(2);
    expect(deps.choose).toHaveBeenCalledWith([account]);
    expect(deps.verify).toHaveBeenCalledWith(account);
  });

  it("preserves a valid pin and skips login and account selection", async () => {
    const deps = dependencies();
    await expect(resolveSetupAccount(account, deps)).resolves.toEqual(account);
    expect(deps.login).not.toHaveBeenCalled();
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.choose).not.toHaveBeenCalled();
  });

  it("offers sign-in for an expired saved account, then verifies it again", async () => {
    const deps = dependencies();
    deps.verify.mockResolvedValueOnce({ isAuthenticated: false });
    await expect(resolveSetupAccount(account, deps)).resolves.toEqual(account);
    expect(deps.login).toHaveBeenCalledOnce();
    expect(deps.verify).toHaveBeenCalledTimes(2);
    expect(deps.choose).not.toHaveBeenCalled();
  });

  it("signs in to the requested enterprise host without falling back to another account", async () => {
    const enterprise = { login: "work", host: "https://company.ghe.com" };
    const deps = dependencies();
    deps.accounts.mockResolvedValueOnce([account]).mockResolvedValue([enterprise]);
    deps.verify.mockResolvedValue({ isAuthenticated: true, ...enterprise });
    await expect(resolveSetupAccount(enterprise, deps)).resolves.toEqual(enterprise);
    expect(deps.login).toHaveBeenCalledWith(enterprise.host);
    expect(deps.choose).not.toHaveBeenCalled();
  });

  it("does not start sign-in when declined or in noninteractive / --yes mode", async () => {
    const deps = dependencies();
    deps.accounts.mockResolvedValue([]);
    deps.confirm.mockResolvedValueOnce(false);
    await expect(resolveSetupAccount(undefined, deps)).rejects.toThrow("sign-in declined");
    expect(deps.login).not.toHaveBeenCalled();
    deps.interactive = false;
    await expect(resolveSetupAccount(undefined, deps)).rejects.toThrow("interactive terminal without --yes");
    expect(deps.login).not.toHaveBeenCalled();
    expect(deps.confirm).toHaveBeenCalledOnce();
  });

  it("supports an authenticated explicit account noninteractively but does not pick an account silently", async () => {
    const deps = { ...dependencies(), interactive: false };
    await expect(resolveSetupAccount(account, deps)).resolves.toEqual(account);
    await expect(resolveSetupAccount(undefined, deps)).rejects.toThrow("Select an account explicitly");
    expect(deps.choose).not.toHaveBeenCalled();
    deps.verify.mockResolvedValueOnce({ isAuthenticated: false });
    await expect(resolveSetupAccount(account, deps)).rejects.toThrow("interactive terminal without --yes");
    expect(deps.login).not.toHaveBeenCalled();
  });

  it("surfaces login failures, missing accounts after sign-in, and repeated auth failures without looping", async () => {
    const deps = dependencies();
    deps.accounts.mockResolvedValue([]);
    deps.login.mockRejectedValueOnce(new Error("CLI login exited with code 1"));
    await expect(resolveSetupAccount(undefined, deps)).rejects.toThrow("CLI login exited");
    await expect(resolveSetupAccount(undefined, deps)).rejects.toThrow("did not return a signed-in account");
    deps.accounts.mockResolvedValue([account]);
    deps.verify.mockResolvedValue({ isAuthenticated: false });
    deps.login.mockClear();
    await expect(resolveSetupAccount(account, deps)).rejects.toThrow("still signed out");
    expect(deps.login).toHaveBeenCalledOnce();
  });

  it("blocks wrong accounts and host startup errors rather than silently switching identities", async () => {
    const deps = dependencies();
    deps.accounts.mockResolvedValueOnce([]).mockResolvedValue([other]);
    await expect(resolveSetupAccount(account, deps)).rejects.toThrow("not signed in as reviewer");
    expect(deps.verify).not.toHaveBeenCalled();
    deps.accounts.mockResolvedValue([account]);
    deps.verify.mockResolvedValueOnce({ isAuthenticated: true, ...other });
    await expect(resolveSetupAccount(account, deps)).rejects.toThrow("account mismatch");
    deps.verify.mockRejectedValueOnce(new Error("CLI startup failed"));
    deps.login.mockClear();
    await expect(resolveSetupAccount(account, deps)).rejects.toThrow("CLI startup failed");
    expect(deps.login).not.toHaveBeenCalled();
  });
});
