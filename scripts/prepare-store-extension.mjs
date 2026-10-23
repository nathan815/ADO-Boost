import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export async function prepareStoreExtension(source, destination) {
  const sourcePath = resolve(source);
  const destinationPath = resolve(destination);
  if (destinationPath === sourcePath || destinationPath.startsWith(`${sourcePath}${sep}`)) {
    throw new Error("Store staging directory must be outside the unpacked extension directory");
  }

  const manifest = JSON.parse(await readFile(resolve(sourcePath, "manifest.json"), "utf8"));
  delete manifest.key;

  await mkdir(dirname(destinationPath), { recursive: true });
  await mkdir(destinationPath);
  await cp(sourcePath, destinationPath, { recursive: true });
  await writeFile(resolve(destinationPath, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, destination, ...extra] = process.argv.slice(2);
  if (!source || !destination || extra.length) {
    throw new Error("Usage: node scripts/prepare-store-extension.mjs SOURCE DESTINATION");
  }
  await prepareStoreExtension(source, destination);
  console.log(`Prepared Edge Store extension at ${resolve(destination)}`);
}
