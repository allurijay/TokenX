import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/v1": "http://127.0.0.1:4100",
      "/health": "http://127.0.0.1:4100",
      "/api-docs": "http://127.0.0.1:4100",
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
