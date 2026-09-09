import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": p("./src"),
      "@wyre/api": p("../../packages/api/src/index.ts"),
      "@wyre/tokens/css": p("../../packages/tokens/dist/tokens.css"),
    },
  },
  server: { port: 5173, strictPort: false, host: true },
});
