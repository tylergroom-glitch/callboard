import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The /api proxy is only used for local `vercel dev`; in production Vercel serves /api itself.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:3000" } },
});
