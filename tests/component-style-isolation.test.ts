import { describe, expect, it } from "vitest";
import { build } from "vite";
import { isolateAdoComponentStyles } from "../vite.config";

describe("ADO component style isolation", () => {
  it("omits library side-effect CSS while retaining explicit shadow-root styles", async () => {
    const result = await build({
      configFile: false,
      logLevel: "silent",
      plugins: [isolateAdoComponentStyles()],
      build: {
        write: false,
        minify: false,
        rollupOptions: {
          input: "src/ui/ado-panel-header.ts",
          preserveEntrySignatures: "strict",
          output: { format: "iife", name: "AdoPanelHeader", inlineDynamicImports: true }
        }
      }
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap((bundle) => "output" in bundle ? bundle.output : []);
    expect(outputs.filter((output) => output.type === "asset" && output.fileName.endsWith(".css"))).toHaveLength(0);
    const script = outputs.find((output) => output.type === "chunk");
    expect(script?.type).toBe("chunk");
    if (script?.type !== "chunk") throw new Error("Expected bundled header script");
    expect(script.code).toContain(".bolt-button");
    expect(script.code).toContain("box-sizing");
    expect(script.code).toContain('stroke="currentColor"');
    expect(script.code).toContain('viewBox="0 0 16 16"');
    expect(outputs.filter((output) => output.type === "asset" && output.fileName.endsWith(".svg"))).toHaveLength(0);
    expect(script.code).not.toContain('document.createElement("style")');
    expect(script.code).not.toContain("document.head.appendChild");
  }, 20000);
});
