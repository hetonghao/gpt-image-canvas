import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8787";
const devServerPort = Number.parseInt(process.env.VITE_DEV_SERVER_PORT ?? "5173", 10);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@gpt-image-canvas/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url))
    }
  },
  server: {
    port: Number.isInteger(devServerPort) && devServerPort > 0 ? devServerPort : 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
        ws: true
      }
    }
  }
});
