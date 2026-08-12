import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      // Live checks talk to the real Google Sheets API and read .env.local.
      // They are how the sync rewrite was proven before shipping, and they must
      // be run deliberately — in CI they have no credentials and would fail:
      //   npx vitest run src/lib/google-sheets/__live__ --testTimeout=180000
      "**/__live__/**",
    ],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
