import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareStoreExtension } from "../scripts/prepare-store-extension.mjs";

const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(manifest) {
  const root = await mkdtemp(join(tmpdir(), "ado-boost-store-"));
  directories.push(root);
  const source = join(root, "dist");
  const destination = join(root, "release", "edge-store");
  await mkdir(join(source, "icons"), { recursive: true });
  await writeFile(join(source, "manifest.json"), JSON.stringify(manifest));
  await writeFile(join(source, "content.js"), "console.log('extension');");
  await writeFile(join(source, "icons", "icon.png"), Buffer.from([0, 1, 2, 255]));
  return { source, destination };
}

describe("Edge Store staging", () => {
  it("removes only the store manifest key and preserves the unpacked extension", async () => {
    const manifest = { manifest_version: 3, name: "ADO Boost", version: "0.2.0", key: "public-key", permissions: ["storage", "nativeMessaging"] };
    const { source, destination } = await fixture(manifest);
    await prepareStoreExtension(source, destination);

    const { key, ...expected } = manifest;
    expect(JSON.parse(await readFile(join(destination, "manifest.json"), "utf8"))).toEqual(expected);
    expect(JSON.parse(await readFile(join(source, "manifest.json"), "utf8"))).toEqual(manifest);
    for (const file of ["content.js", join("icons", "icon.png")]) {
      expect(await readFile(join(destination, file))).toEqual(await readFile(join(source, file)));
    }
  });

  it("accepts a manifest that already has no key", async () => {
    const manifest = { manifest_version: 3, name: "ADO Boost", version: "0.2.0" };
    const { source, destination } = await fixture(manifest);
    await prepareStoreExtension(source, destination);
    expect(JSON.parse(await readFile(join(destination, "manifest.json"), "utf8"))).toEqual(manifest);
  });

  it("refuses an existing staging directory rather than packaging stale files", async () => {
    const { source, destination } = await fixture({ key: "public-key" });
    await mkdir(destination, { recursive: true });
    await expect(prepareStoreExtension(source, destination)).rejects.toThrow(/EEXIST/);
  });

  it("refuses to overwrite or stage inside the unpacked build", async () => {
    const { source } = await fixture({ key: "public-key" });
    await expect(prepareStoreExtension(source, source)).rejects.toThrow(/outside/);
    await expect(prepareStoreExtension(source, join(source, "store"))).rejects.toThrow(/outside/);
  });
});
