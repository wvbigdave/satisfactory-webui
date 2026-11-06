import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Build output is committed to Git and shipped inside the Python package; the
// stdlib server serves web/app/ as static assets. No runtime Node is required
// on the target host — only the pre-built files.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  base: "/",
  build: {
    outDir: "../satisfactory_webui/web/app",
    emptyOutDir: true,
    assetsDir: "assets",
    sourcemap: false,
    // Keep every asset as a real file: the branding emblem should be a served,
    // inspectable PNG rather than a base64 blob inlined into the bundle.
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // Split the heavyweight libraries into their own long-lived chunks.
        // Routes are already split via React.lazy, so the initial page load
        // stays small and vendor code caches independently of app changes.
        manualChunks: {
          charts: ["recharts"],
          motion: ["motion"],
        },
      },
    },
  },
  server: {
    proxy: { "/api": loadEnv(mode, ".", "SATISFACTORY_").SATISFACTORY_DEV_PROXY || "http://127.0.0.1:8082" },
  },
}));
