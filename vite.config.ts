import { defineConfig, type Plugin } from "vite";

export function isolateAdoComponentStyles(): Plugin {
  const emptyStylesModule = "\0ado-ui-side-effect-styles";
  return {
    name: "isolate-ado-component-styles",
    enforce: "pre",
    resolveId(source, importer) {
      // Components import global CSS as a side effect; only explicit inline styles belong in our shadow root.
      if (source.endsWith(".css") && importer?.replaceAll("\\", "/").includes("/node_modules/azure-devops-ui/")) return emptyStylesModule;
      return null;
    },
    load(id) {
      if (id === emptyStylesModule) return "export {};";
      return null;
    }
  };
}

export default defineConfig({
  plugins: [isolateAdoComponentStyles()],
  build: {
    target: "chrome114",
    sourcemap: false,
    emptyOutDir: false,
    rollupOptions: {
      input: {
        background: "src/background/index.ts",
        options: "src/options/index.ts",
        popup: "src/popup/index.ts",
        demo: "src/demo/index.ts"
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
