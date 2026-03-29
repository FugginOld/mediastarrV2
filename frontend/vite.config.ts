import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "../frontend-dist"),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:7979",
        changeOrigin: true,
      },
      "/login": {
        target: "http://127.0.0.1:7979",
        changeOrigin: true,
      },
      "/logout": {
        target: "http://127.0.0.1:7979",
        changeOrigin: true,
      },
    },
  },
});
