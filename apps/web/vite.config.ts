import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/")) {
            return "vendor-react";
          }
          if (id.includes("node_modules/react-router")) {
            return "vendor-router";
          }
          if (id.includes("node_modules/i18next") || id.includes("node_modules/react-i18next")) {
            return "vendor-i18n";
          }
          if (id.includes("/pages/AdminPages") || id.includes("/pages/AdminMellorasPages")) {
            return "admin-panel";
          }
          if (id.includes("/pages/LegalPage")) {
            return "legal";
          }
          if (id.includes("/i18n/es.json")) {
            return "i18n-es";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/auth": "http://localhost:3001",
      "/api": "http://localhost:3001",
      "/health": "http://localhost:3001",
    },
  },
});
