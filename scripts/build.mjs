import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = new URL("../", import.meta.url);
const dist = new URL("../dist/", import.meta.url);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await build({ configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)) });
await build({
  configFile: false,
  build: {
    target: "chrome114",
    sourcemap: true,
    emptyOutDir: false,
    outDir: fileURLToPath(dist),
    rollupOptions: {
      input: fileURLToPath(new URL("../src/content/index.ts", import.meta.url)),
      output: {
        format: "iife",
        entryFileNames: "content.js",
        inlineDynamicImports: true
      }
    }
  }
});
await cp(new URL("../public/", import.meta.url), dist, { recursive: true });

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
await writeFile(new URL("manifest.json", dist), JSON.stringify(manifest, null, 2));
const demoHtml = await readFile(new URL("demo.html", dist), "utf8");
await writeFile(new URL("demo.html", dist), demoHtml.replace("/src/demo/index.ts", "./demo.js"));
const contentScript = await readFile(new URL("content.js", dist), "utf8");
if (/^\s*(?:import|export)\s/m.test(contentScript)) throw new Error("MV3 content.js must be a self-contained classic script");
console.log(`Built unpacked extension at ${fileURLToPath(dist)}`);
