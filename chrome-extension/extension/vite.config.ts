import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Builds the MV3 extension into dist/ (load it with "Load unpacked"). public/ holds manifest.json and icons. */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: { sidepanel: resolve(__dirname, "sidepanel.html"), background: resolve(__dirname, "src/background/index.ts") },
      // The service worker is named in manifest.json, so its file name must not carry a hash.
      output: { entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js") },
    },
  },
  test: { environment: "jsdom", include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"] },
});
