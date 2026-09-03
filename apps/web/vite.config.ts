import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: ".",
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
