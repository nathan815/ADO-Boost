import { execFileSync, spawnSync } from "node:child_process";

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const releaseFiles = [
  "manifest.json",
  "package.json",
  "package-lock.json",
  "companion/package.json",
  "companion/package-lock.json"
];
const [version] = process.argv.slice(2);

if (!version || !versionPattern.test(version)) {
  throw new Error("Usage: node scripts/release-commit-tag.mjs MAJOR.MINOR.PATCH");
}

const branch = git(["branch", "--show-current"]).trim();
if (branch !== "main") throw new Error(`Releases must be created from main; current branch is ${branch || "detached HEAD"}`);

execFileSync(process.execPath, ["scripts/release-version.mjs", "check", version], { stdio: "inherit" });

const tag = `v${version}`;
if (git(["tag", "--list", tag]).trim()) throw new Error(`Tag ${tag} already exists`);

const status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
const changedFiles = status
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => line.slice(3).split(" -> ").at(-1));
const unrelatedFiles = changedFiles.filter((file) => !releaseFiles.includes(file));
if (unrelatedFiles.length > 0) {
  throw new Error(`Commit or stash non-version changes before releasing:\n${unrelatedFiles.map((file) => `- ${file}`).join("\n")}`);
}
if (changedFiles.length === 0) throw new Error(`No version changes found for ${version}`);

git(["add", "--", ...releaseFiles], { stdio: "inherit" });
git(["commit", "-m", `chore(release): ${tag}`], { stdio: "inherit" });
git(["tag", "-a", tag, "-m", `ADO Boost ${version}`], { stdio: "inherit" });
console.log(`Created release commit and annotated tag ${tag}. Push with: git push origin main --follow-tags`);

function git(args, options = {}) {
  if (options.stdio) {
    const result = spawnSync("git", args, { stdio: options.stdio });
    if (result.status !== 0) throw new Error(`git ${args[0]} failed with exit code ${result.status}`);
    return "";
  }
  return execFileSync("git", args, { encoding: "utf8" });
}
