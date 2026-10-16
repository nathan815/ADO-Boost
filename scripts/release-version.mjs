import { readFile, writeFile } from "node:fs/promises";

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const files = [
  ["manifest.json", ["version"]],
  ["package.json", ["version"]],
  ["package-lock.json", ["version"], ["packages", "", "version"]],
  ["companion/package.json", ["version"]],
  ["companion/package-lock.json", ["version"], ["packages", "", "version"]]
];
const [command, requestedVersion] = process.argv.slice(2);

if (!["check", "set"].includes(command) || !requestedVersion || !versionPattern.test(requestedVersion)) {
  throw new Error("Usage: node scripts/release-version.mjs <check|set> MAJOR.MINOR.PATCH");
}

for (const [file, ...paths] of files) {
  const document = JSON.parse(await readFile(file, "utf8"));
  for (const path of paths) {
    const current = get(document, path);
    if (command === "check" && current !== requestedVersion) {
      throw new Error(`${file} has version ${String(current)}; expected ${requestedVersion}`);
    }
    if (command === "set") set(document, path, requestedVersion);
  }
  if (command === "set") await writeFile(file, `${JSON.stringify(document, null, 2)}\n`);
}

console.log(`${command === "set" ? "Set" : "Verified"} release version ${requestedVersion}`);

function get(document, path) {
  return path.reduce((value, key) => value?.[key], document);
}

function set(document, path, value) {
  const parent = path.slice(0, -1).reduce((current, key) => {
    if (!current?.[key] || typeof current[key] !== "object") throw new Error(`Missing version path ${path.join(".")}`);
    return current[key];
  }, document);
  parent[path.at(-1)] = value;
}
