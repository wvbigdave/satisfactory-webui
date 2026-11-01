import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Build output is committed to Git and shipped inside the Python package; the
// stdlib server serves web/app/ as static assets. No runtime Node is required
// on the target host — only the pre-built files.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/",
  build: {
    outDir: "../satisfactory_webui/web/app",
    emptyOutDir: true,
    assetsDir: "assets",
    sourcemap: false,
  },
  server: {
    proxy: { "/api": "http://192.168.4.60:8082" },
  },
});
