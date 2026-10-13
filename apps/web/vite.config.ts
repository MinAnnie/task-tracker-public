import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Port 3000 is often taken on dev machines (e.g. by Dokploy), so the API runs on
// 3001 in development. Override with API_PROXY_TARGET if yours differs.
const apiServer = process.env.API_PROXY_TARGET ?? "http://localhost:3001";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // In development the browser only talks to Vite, which forwards API and auth
    // calls to the Hono server. Requests keep the browser's `Origin`
    // (http://localhost:5173), so set APP_BASE_URL=http://localhost:5173 for the
    // server in development: the same-origin check then passes and the OAuth
    // callback returns to this dev server.
    proxy: {
      "/health": apiServer,
      "/api": apiServer,
      "/auth": apiServer,
      "/webhooks": apiServer,
    },
  },
});
