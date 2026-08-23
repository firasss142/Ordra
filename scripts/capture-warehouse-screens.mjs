/**
 * Capture the warehouse screens from a running dev server.
 *
 * Logging in through the form is unreliable headlessly, so this mints a session
 * with the service key and injects it as the `@supabase/ssr` cookie the server
 * reads: `base64-` + base64(JSON of the session), chunked at 3180 chars into
 * `sb-<ref>-auth-token.N`.
 *
 * Read-only against the app; the only writes are the PNGs.
 *
 *   node scripts/capture-warehouse-screens.mjs [--market=ly] [--out=report/shots]
 */
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
// Playwright is not a project dependency; use the npx-cached copy that matches
// the cached chromium build.
const { chromium } = require(
  `${process.env.HOME}/.npm/_npx/db89d7302a373f10/node_modules/playwright`,
);

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const MARKET = arg("market", "ly");
const OUT = arg("out", "report/shots");
const BASE = arg("base", "http://localhost:3000");
const EMAIL = arg("email", "admin@oms.local");

// .env.local is not loaded for a bare `node`, so read it directly.
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const REF = new URL(SUPABASE_URL).hostname.split(".")[0];

const SCREENS = [
  ["preparation", `/fr/warehouse/preparation`],
  ["scan-mode", `/fr/warehouse/scan`],
  ["today", `/fr/warehouse`],
];

async function mintSession() {
  const admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: EMAIL,
  });
  if (error) throw new Error(`generateLink: ${error.message}`);

  const anon = createClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.properties.hashed_token,
  });
  if (verifyError) throw new Error(`verifyOtp: ${verifyError.message}`);
  return verified.session;
}

/** The exact cookie shape @supabase/ssr writes, chunked the way it chunks. */
function sessionCookies(session) {
  const payload = `base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`;
  const CHUNK = 3180;
  const chunks = [];
  for (let i = 0; i < payload.length; i += CHUNK) chunks.push(payload.slice(i, i + CHUNK));
  return chunks.map((value, i) => ({
    name: `sb-${REF}-auth-token.${i}`,
    value,
    domain: "localhost",
    path: "/",
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  }));
}

const errors = [];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const session = await mintSession();

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([
    ...sessionCookies(session),
    { name: "oms_scope_market", value: MARKET, domain: "localhost", path: "/" },
  ]);

  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));

  for (const [name, path] of SCREENS) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 120000 });
    // SWR revalidates after hydration; let the real numbers land.
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(`${name.padEnd(20)} ${page.url()}`);

    // Take the first parcel so the roll strip has something to answer for.
    // Clicking "Prendre" only sets client state — nothing is scanned or sent.
    if (name === "preparation") {
      const take = page.getByRole("button", { name: /^Prendre$/ }).first();
      if (await take.count()) {
        await take.click();
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${OUT}/${name}-in-hand.png` });
        console.log(`${(name + "-in-hand").padEnd(20)} parcel taken`);
      }

      // The roll registry, which is what arms the sticker guard.
      const rolls = page.getByRole("button", { name: /^Rouleaux/ }).first();
      if (await rolls.count()) {
        await rolls.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${OUT}/sticker-rolls.png` });
        console.log(`${"sticker-rolls".padEnd(20)} registry opened`);
        await page.keyboard.press("Escape");
      }
    }
  }

  await browser.close();

  if (errors.length) {
    console.log(`\n${errors.length} console error(s):`);
    for (const e of [...new Set(errors)].slice(0, 10)) console.log(`  ${e}`);
    process.exitCode = 1;
  } else {
    console.log("\nno console errors");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
