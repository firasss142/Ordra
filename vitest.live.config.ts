import { defineConfig } from "vitest/config";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Live checks against the real Google Sheets API and the real database.
 *
 * Separate from vitest.config.ts on purpose. These read `.env.local`, talk to
 * production, and one of them writes orders — none of that belongs in the
 * suite that runs on every change, and the main config excludes `__live__`
 * precisely so CI never picks them up. They are how the sync rewrite was
 * proven before shipping, and they are run deliberately:
 *
 *   npx vitest run -c vitest.live.config.ts                      # all
 *   npx vitest run -c vitest.live.config.ts pending              # one
 *   BATCH=50 npx vitest run -c vitest.live.config.ts import      # writes!
 *
 * node, not jsdom: the sync only ever runs server-side, and jsdom's
 * URLSearchParams fails google-auth-library's instanceof check.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    testTimeout: 300_000,
    include: ["src/lib/google-sheets/__live__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
