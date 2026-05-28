/**
 * Probe: GET /merchant/ajax-order-case/{trackingNumber} via the existing
 * DexpressClient session. Prints status, headers, raw body, parsed shape.
 *
 * Usage:
 *   npx tsx scripts/probe-dexpress-ajax-status.ts <trackingNumber>
 *   npx tsx scripts/probe-dexpress-ajax-status.ts --bad-id           # probes 99999999
 *   npx tsx scripts/probe-dexpress-ajax-status.ts --bad-id <num>     # custom bad ID
 *
 * Closes open-question #1 (raw body shape) and #7 (behavior on unknown IDs)
 * in delivery_company_docs/Dexpress/tracking/dexpress-tracking-briefing.md.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto";
import { DexpressClient } from "@/lib/carriers/dexpress/client";
import type { CarrierConfig } from "@/lib/carriers/types";

const args = process.argv.slice(2);
const badIdMode = args.includes("--bad-id");
const positional = args.filter((a) => !a.startsWith("--"));
const trackingNumber = badIdMode
  ? positional[0] ?? "99999999"
  : positional[0];

if (!badIdMode && !trackingNumber) {
  console.error(
    "Usage: npx tsx scripts/probe-dexpress-ajax-status.ts <trackingNumber>"
  );
  console.error(
    "       npx tsx scripts/probe-dexpress-ajax-status.ts --bad-id [trackingNumber=99999999]"
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

  const path = `/merchant/ajax-order-case/${trackingNumber}`;
  const baseUrl = config.apiEndpoint.replace(/\/$/, "");
  const url = `${baseUrl}${path}`;

  console.log("");
  console.log(`mode        : ${badIdMode ? "BAD-ID (probing not-found behavior)" : "normal"}`);
  console.log(`tracking #  : ${trackingNumber}`);
  console.log(`→ GET ${url}`);

  const t0 = Date.now();
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9,fr;q=0.8,ar;q=0.7",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${baseUrl}/merchant/pending-orders`,
      Cookie: `laravel_session=${session.laravelSession}`,
    },
  });
  const elapsedMs = Date.now() - t0;

  console.log("");
  console.log("─── RESPONSE ──────────────────────────────────");
  console.log("elapsed     :", elapsedMs, "ms");
  console.log("HTTP status :", response.status);
  console.log("Status text :", response.statusText);
  console.log("");
  console.log("Response headers:");
  response.headers.forEach((value, key) => {
    console.log(`  ${key}: ${value}`);
  });

  const location = response.headers.get("location");
  if (response.status >= 300 && response.status < 400) {
    console.log("");
    console.log("✗ REDIRECT — Location:", location);
    if (location && /\/login/i.test(location)) {
      console.log("✗ Session was rejected — bounced to /login.");
    }
    process.exit(2);
  }

  const rawText = await response.text();
  console.log("");
  console.log("─── RAW BODY (verbatim) ───────────────────────");
  console.log(rawText);
  console.log("─── end raw body ──────────────────────────────");
  console.log("");
  console.log("Raw body length:", rawText.length, "bytes");
  console.log("First 10 chars  :", JSON.stringify(rawText.slice(0, 10)));

  console.log("");
  console.log("─── JSON.parse(rawText) ───────────────────────");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    console.log("✗ JSON.parse threw:", (e as Error).message);
    console.log("Conclusion: body is not JSON. See raw body above.");
    process.exit(3);
  }

  console.log("typeof parsed :", typeof parsed);
  console.log("parsed value  :", parsed);

  if (parsed && typeof parsed === "object") {
    const p = parsed as Record<string, unknown>;
    console.log("");
    console.log("─── Shape check ───────────────────────────────");
    console.log("response_case :", p.response_case);
    console.log("status_name   :", p.status_name);
    console.log("order_status  :", p.order_status, "(type:", typeof p.order_status + ")");
    console.log("order_accept  :", p.order_accept, "(type:", typeof p.order_accept + ")");

    // Any unexpected keys?
    const knownKeys = new Set([
      "response_case",
      "status_name",
      "order_status",
      "order_accept",
    ]);
    const extraKeys = Object.keys(p).filter((k) => !knownKeys.has(k));
    if (extraKeys.length > 0) {
      console.log("");
      console.log("⚠️  EXTRA KEYS (not in briefing):", extraKeys);
      for (const k of extraKeys) {
        console.log(`  ${k} =`, p[k]);
      }
    }
  }

  console.log("");
  console.log("✓ done");
}

main().catch((e) => {
  console.error("");
  console.error("✗ probe failed:", e);
  process.exit(1);
});
