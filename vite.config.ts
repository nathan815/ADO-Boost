import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "chrome114",
    sourcemap: false,
    emptyOutDir: false,
    rollupOptions: {
      input: {
        background: "src/background/index.ts",
        options: "src/options/index.ts",
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
