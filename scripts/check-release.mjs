import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const failures = [];
const patterns = [
  ["internal package feed", /(?:pkgs\.visualstudio\.com|pkgs\.dev\.azure\.com|1es-public)/i],
  ["internal service", /(?:[\w.-]+\.sharepoint\.com|corp\.microsoft\.com|microsoft\.visualstudio\.com)/i],
  ["corporate email", /[\w.+-]+@microsoft\.com/i],
  ["developer path", /[a-z]:[\\/](?:users|projects)[\\/]/i],
  ["developer fixture identity", /Nathan Johnson|johnsonn/i],
  ["session metadata", /Copilot-Session:|refs\/copilot\/checkpoints\/|copilot checkpoint: [a-f0-9-]{36}/i],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["access token", /(?:gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|AKIA[0-9A-Z]{16}|eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,})/],
  ["credential URL", /https?:\/\/[^/\s:@]+:[^/\s@]+@/i]
];
const forbiddenName = /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|host-config\.json|launcher\.json|\.impeccable)(?:\/|$)|\.(?:map|pem|pfx|key|tgz)$/i;
const normalize = (path) => path.replaceAll("\\", "/");

function scan(label, data) {
  // Also inspect UTF-16 strings embedded in Windows executables.
  for (const text of [data.toString("utf8"), data.toString("utf16le")]) {
    for (const [category, pattern] of patterns) {
      if (pattern.test(text)) failures.push(`${label}: ${category}`);
    }
  }
}

function scanFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const label = normalize(relative(root, path));
    if (entry.isSymbolicLink()) {
      failures.push(`${label}: unexpected symbolic link`);
    } else if (entry.isDirectory()) {
      scanFiles(path);
    } else {
      if (forbiddenName.test(label)) failures.push(`${label}: forbidden release file`);
      scan(label, readFileSync(path));
    }
  }
}

function git(args) {
  return execFileSync("git", args, { cwd: root, maxBuffer: 128 * 1024 * 1024 });
}

const sourceFiles = git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).toString().split("\0").filter(Boolean);
for (const file of sourceFiles) {
  if (file === "scripts/check-release.mjs") continue; // The guard contains the patterns it rejects.
  if (forbiddenName.test(file)) failures.push(`${file}: forbidden source file`);
  const path = join(root, file);
  if (!existsSync(path)) failures.push(`${file}: tracked file missing`);
  else scan(file, readFileSync(path));
}

scan("Git commit metadata", git(["log", "--all", "--format=%an <%ae>%n%cn <%ce>%n%B"]));
scan("Git refs", git(["for-each-ref", "--format=%(refname)"]));
const objects = git(["rev-list", "--objects", "--all"]).toString().trim().split("\n").filter(Boolean);
const paths = new Map(objects.map((line) => {
  const space = line.indexOf(" ");
  return [space < 0 ? line : line.slice(0, space), space < 0 ? "" : line.slice(space + 1)];
}));
const objectIds = [...paths.keys()];
const batch = execFileSync("git", ["cat-file", "--batch"], {
  cwd: root, input: `${objectIds.join("\n")}\n`, maxBuffer: 128 * 1024 * 1024
});
let offset = 0;
for (const id of objectIds) {
  const end = batch.indexOf(10, offset);
  const [actualId, type, sizeText] = batch.subarray(offset, end).toString().split(" ");
  const size = Number(sizeText);
  if (end < 0 || actualId !== id || !Number.isSafeInteger(size)) throw new Error("Invalid Git object framing");
  offset = end + 1;
  if (type === "blob") {
    const path = paths.get(id);
    if (forbiddenName.test(path)) failures.push(`History ${path}: forbidden release file`);
    if (path !== "scripts/check-release.mjs") scan(`History ${id.slice(0, 12)} ${path}`, batch.subarray(offset, offset + size));
  }
  offset += size + 1;
}

for (const directory of ["dist", "companion/dist", "companion/prebuilt-extension"]) {
  const path = join(root, directory);
  if (!existsSync(path)) failures.push(`${directory}: build required before release check`);
  else scanFiles(path);
}

const manifestPath = join(root, "dist", "manifest.json");
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.name !== "ADO Boost" || manifest.short_name !== "ADO Boost") failures.push("Built extension has stale branding");
}
const companionManifest = join(root, "companion", "prebuilt-extension", "manifest.json");
if (existsSync(companionManifest) && existsSync(manifestPath)
    && !readFileSync(companionManifest).equals(readFileSync(manifestPath))) {
  failures.push("Companion extension manifest differs from the current build");
}

const npmCli = process.env.npm_execpath;
if (!npmCli || !existsSync(npmCli)) throw new Error("Run this guard through npm run release:check or npm run pack:local");
const packed = JSON.parse(execFileSync(process.execPath, [npmCli, "pack", "--dry-run", "--json", "--ignore-scripts"], {
  cwd: join(root, "companion"), encoding: "utf8"
}))[0];
const packagedPaths = new Set(packed.files.map((file) => file.path));
for (const required of ["LICENSE", "dist/cli.js", "dist/host.js", "dist/ado-boost-native-host.exe", "dist/Go-LICENSE.txt", "prebuilt-extension/manifest.json"]) {
  if (!packagedPaths.has(required)) failures.push(`Companion package missing ${required}`);
}
for (const file of packagedPaths) {
  if (forbiddenName.test(file)) failures.push(`Companion package includes forbidden file ${file}`);
  if (!/^(?:package\.json|README\.md|LICENSE|dist\/|prebuilt-extension\/)/.test(file)) {
    failures.push(`Companion package includes unexpected file ${file}`);
  }
}

if (failures.length) {
  console.error([...new Set(failures)].join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Release guard passed: ${sourceFiles.length} source files, ${objects.length} Git objects, build outputs, and ${packagedPaths.size} package files.`);
}
