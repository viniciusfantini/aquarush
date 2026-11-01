import { defineConfig } from "vite";

// base relativo: permite publicar em GitHub Pages (/aquarush/) ou qualquer subpasta.
export default defineConfig({
  base: "./",
  build: { target: "es2022", chunkSizeWarningLimit: 6000 },
});
