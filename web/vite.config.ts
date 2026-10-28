import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development Vite serves the UI and proxies /api to Express, so the browser sees one origin
// (same as production, where Express serves the built files).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:4000", changeOrigin: false } },
  },
});
