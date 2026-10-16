import { execFileSync, spawnSync } from "node:child_process";

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const [version] = process.argv.slice(2);

if (!version || !versionPattern.test(version)) {
  throw new Error("Usage: node scripts/release-push.mjs MAJOR.MINOR.PATCH");
}

const branch = git(["branch", "--show-current"]).trim();
if (branch !== "main") throw new Error(`Releases must be pushed from main; current branch is ${branch || "detached HEAD"}`);

const status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
if (status.trim()) throw new Error("Commit or stash all changes before pushing a release");

execFileSync(process.execPath, ["scripts/release-version.mjs", "check", version], { stdio: "inherit" });

const tag = `v${version}`;
if (!git(["tag", "--list", tag]).trim()) throw new Error(`Tag ${tag} does not exist; run release:commit-tag first`);
const head = git(["rev-parse", "HEAD"]).trim();
const tagCommit = git(["rev-list", "-n", "1", tag]).trim();
if (tagCommit !== head) throw new Error(`Tag ${tag} must point to the current main commit`);

const result = spawnSync("git", ["push", "--atomic", "origin", "main", `refs/tags/${tag}`], { stdio: "inherit" });
if (result.status !== 0) throw new Error(`Release push failed with exit code ${result.status}`);
console.log(`Pushed main and ${tag}. The release workflow will create a draft release.`);

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}
