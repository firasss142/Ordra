/**
 * Probe: GET /merchant/track-order/{trackingNumber} (the rich HTML tracking
 * page). Prints status + first 2KB of body and saves the full HTML as a
 * fixture under delivery_company_docs/Dexpress/tracking/fixtures/.
 *
 * Purpose:
 *   1. Confirm the briefing's structural claims (timeline portlets, status
 *      header pattern with "حالة الطلب :", timeline-item DOM) still hold.
 *   2. Capture a fresh fixture that future parseTrackingHtml tests can run
 *      against — adding to the 4 fixtures the briefing already lists.
 *
 * Usage:
 *   npx tsx scripts/probe-dexpress-track-order-html.ts <trackingNumber>
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto";
import { DexpressClient } from "@/lib/carriers/dexpress/client";
import type { CarrierConfig } from "@/lib/carriers/types";

const trackingNumber = process.argv[2];
if (!trackingNumber) {
  console.error(
    "Usage: npx tsx scripts/probe-dexpress-track-order-html.ts <trackingNumber>"
  );
  process.exit(64);
}

function loadEnv(path: string) {
  let content: string;
  try {
    content = readFileSync(resolve(path), "utf8");
  } catch {
    return;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnv(".env.local");

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data: carrier, error } = await supabase
    .from("carriers")
    .select("id, code, api_endpoint, api_credentials, delivery_fee, return_fee")
    .eq("code", "dexpress")
    .eq("is_active", true)
    .single();

  if (error || !carrier) {
    throw new Error(
      `No active Dexpress carrier: ${error?.message ?? "not found"}`
    );
  }

  const creds = JSON.parse(decrypt(carrier.api_credentials));
  const config: CarrierConfig = {
    id: carrier.id,
    code: "dexpress",
    apiEndpoint: carrier.api_endpoint,
    apiCredentials: creds,
    deliveryFee: carrier.delivery_fee,
    returnFee: carrier.return_fee,
  };

  const client = new DexpressClient(carrier.id, config);
  console.log("→ ensureSession");
  const session = await client.ensureSession();
  console.log("✓ session ok, expires", session.expiresAt.toISOString());

  const path = `/merchant/track-order/${trackingNumber}`;
  console.log(`→ getMerchantPage ${path}`);

  const t0 = Date.now();
  const page = await client.getMerchantPage(path);
  const elapsedMs = Date.now() - t0;

  console.log("");
  console.log("─── RESPONSE ──────────────────────────────────");
  console.log("elapsed     :", elapsedMs, "ms");
  console.log("HTTP status :", page.status);
  console.log("HTML length :", page.html.length, "bytes");

  // Structural checks against the briefing's claims.
  console.log("");
  console.log("─── Briefing-claim checks ─────────────────────");
  const checks: Array<[string, boolean, string?]> = [
    [
      "Status header pattern   'حالة الطلب :'",
      page.html.includes("حالة الطلب"),
    ],
    [
      "Timeline portlet present .timeline-item",
      /class="[^"]*timeline-item/.test(page.html),
    ],
    [
      "Timeline-body-title class",
      /class="[^"]*timeline-body-title/.test(page.html),
    ],
    [
      "Date icon fa-calendar",
      /fa-calendar/.test(page.html),
    ],
    [
      "Sidebar menu (badge harvest)",
      /class="[^"]*nav-link nav-toggle/.test(page.html),
    ],
    [
      "Looks like login page (BAD)",
      /name="email"/.test(page.html) && /name="password"/.test(page.html),
      "should be false; true means session was rejected",
    ],
    [
      "Looks like portlet container",
      /portlet light bordered/.test(page.html),
    ],
  ];
  for (const [label, ok, note] of checks) {
    const mark = ok ? "✓" : "✗";
    console.log(`  ${mark} ${label}${note ? "  (" + note + ")" : ""}`);
  }

  // Extract the current status from the header (briefing pattern).
  const headerMatch = page.html.match(/حالة الطلب\s*:\s*([^<\n]+?)\s*</);
  if (headerMatch) {
    console.log("");
    console.log("Current status from header:", JSON.stringify(headerMatch[1]));
  } else {
    console.log("");
    console.log("⚠️  Could not extract status from header.");
  }

  // Count timeline items.
  const timelineItems = page.html.match(/class="[^"]*timeline-item/g) ?? [];
  console.log("Timeline items found      :", timelineItems.length);

  console.log("");
  console.log("─── First 2KB of body ─────────────────────────");
  console.log(page.html.slice(0, 2000));
  console.log("─── end excerpt ───────────────────────────────");

  // Save to fixture.
  const fixtureDir = resolve(
    "delivery_company_docs/Dexpress/tracking/fixtures"
  );
  const fixturePath = resolve(
    fixtureDir,
    `track-order-${trackingNumber}.html`
  );
  mkdirSync(dirname(fixturePath), { recursive: true });
  writeFileSync(fixturePath, page.html, "utf8");
  console.log("");
  console.log("✓ saved fixture →", fixturePath);
}

main().catch((e) => {
  console.error("");
  console.error("✗ probe failed:", e);
  process.exit(1);
});
