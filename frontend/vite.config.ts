
// https://vite.dev/config/
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * GitHub Pages serves your site from:
 *   https://<user>.github.io/<repo>/
 *
 * Vite must know the base path so assets load correctly.
 * If you later move to a custom domain or Vercel, you can remove/adjust this.
 */
export default defineConfig({
  plugins: [react()],
  base: "./", // simplest approach for Pages deployments
});

