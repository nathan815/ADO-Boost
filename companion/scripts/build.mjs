import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";

const exec = promisify(execFile);
const dist = new URL("../dist/", import.meta.url);
const extension = new URL("../prebuilt-extension/", import.meta.url);

await rm(dist, { recursive: true, force: true });
await rm(extension, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await build({
  entryPoints: {
    cli: fileURLToPath(new URL("../src/cli.ts", import.meta.url)),
    host: fileURLToPath(new URL("../src/host.ts", import.meta.url))
  },
  outdir: fileURLToPath(dist),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  banner: { js: "#!/usr/bin/env node" }
});
await exec("go", ["build", "-trimpath", "-ldflags=-s -w", "-o", fileURLToPath(new URL("adoplusplus-native-host.exe", dist)), fileURLToPath(new URL("../launcher/main.go", import.meta.url))]);
await cp(new URL("../../dist/", import.meta.url), extension, { recursive: true });
await writeFile(new URL("protocol-version.txt", dist), "1\n");
console.log("Built companion host and prebuilt extension");
