import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { withStagingDirectory } from "../src/staging.js";

describe("setup staging", () => {
  it("cleans a partial staging directory without changing the owned install", async () => {
    const root = await mkdtemp(join(tmpdir(), "ado-boost-staging-"));
    const installed = join(root, "extension", "marker.txt");
    const stage = join(root, ".staging-test");
    await writeFile(installed, "owned", { flag: "wx" }).catch(async () => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(root, "extension"), { recursive: true });
      await writeFile(installed, "owned");
    });
    await expect(withStagingDirectory(stage, async () => {
      await writeFile(join(stage, "partial.txt"), "partial");
      throw new Error("copy failed");
    })).rejects.toThrow("copy failed");
    await expect(readFile(join(stage, "partial.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(installed, "utf8")).toBe("owned");
    await rm(root, { recursive: true, force: true });
  });
});
