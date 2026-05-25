/**
 * Probe: fire N sequential requests against /merchant/ajax-order-case/{id}
 * to feel out rate-limiting / throttling behavior.
 *
 * Prints per-request timing + HTTP status + any non-200s with their headers.
 * If everything's 200 and consistently fast, the SWR 60s dedupe in v1 is
 * more than enough. If we see 429/503/slowdowns, the v1 cap needs tightening.
 *
 * Usage:
 *   npx tsx scripts/probe-dexpress-rate-burst.ts <trackingNumber> [N=10]
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto";
import { DexpressClient } from "@/lib/carriers/dexpress/client";
import type { CarrierConfig } from "@/lib/carriers/types";

const trackingNumber = process.argv[2];
const N = Number(process.argv[3] ?? 10);

if (!trackingNumber) {
  console.error(
    "Usage: npx tsx scripts/probe-dexpress-rate-burst.ts <trackingNumber> [N=10]"
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

  const baseUrl = config.apiEndpoint.replace(/\/$/, "");
  const url = `${baseUrl}/merchant/ajax-order-case/${trackingNumber}`;

  console.log("");
  console.log(`tracking # : ${trackingNumber}`);
  console.log(`bursting   : ${N} sequential requests`);
  console.log(`URL        : ${url}`);
  console.log("");

  const results: Array<{
    idx: number;
    elapsedMs: number;
    status: number;
    bodyLength: number;
    notes: string;
  }> = [];

  const burstStart = Date.now();
  for (let i = 1; i <= N; i++) {
    const t0 = Date.now();
    let status = -1;
    let bodyLength = 0;
    const notes: string[] = [];

    try {
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
      status = response.status;

      const retryAfter = response.headers.get("retry-after");
      const ratelimitRemaining =
        response.headers.get("x-ratelimit-remaining") ??
        response.headers.get("ratelimit-remaining");
      const ratelimitLimit =
        response.headers.get("x-ratelimit-limit") ??
        response.headers.get("ratelimit-limit");
      if (retryAfter) notes.push(`retry-after=${retryAfter}`);
      if (ratelimitRemaining) notes.push(`remaining=${ratelimitRemaining}`);
      if (ratelimitLimit) notes.push(`limit=${ratelimitLimit}`);

      const body = await response.text();
      bodyLength = body.length;

      if (status !== 200) {
        notes.push("NON-200");
        console.log("");
        console.log(`✗ request ${i} returned ${status}`);
        console.log("  headers:");
        response.headers.forEach((v, k) => console.log(`    ${k}: ${v}`));
        console.log("  body:", body.slice(0, 400));
      }
    } catch (e) {
      notes.push(`THREW: ${(e as Error).message}`);
    }

    const elapsedMs = Date.now() - t0;
    results.push({ idx: i, elapsedMs, status, bodyLength, notes: notes.join(", ") });
    console.log(
      `  #${String(i).padStart(2)}  ${String(status).padEnd(3)}  ${String(elapsedMs).padStart(5)}ms  ${bodyLength}B  ${notes.join(", ")}`
    );
  }
  const burstElapsed = Date.now() - burstStart;

  console.log("");
  console.log("─── SUMMARY ───────────────────────────────────");
  const elapsed = results.map((r) => r.elapsedMs);
  const sorted = [...elapsed].sort((a, b) => a - b);
  const sum = elapsed.reduce((a, b) => a + b, 0);
  const avg = Math.round(sum / N);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const p50 = sorted[Math.floor(N / 2)];
  const p95 = sorted[Math.floor(N * 0.95)] ?? max;
  const non200 = results.filter((r) => r.status !== 200).length;

  console.log(`total wall  : ${burstElapsed}ms for ${N} requests`);
  console.log(`per-req min : ${min}ms`);
  console.log(`per-req avg : ${avg}ms`);
  console.log(`per-req p50 : ${p50}ms`);
  console.log(`per-req p95 : ${p95}ms`);
  console.log(`per-req max : ${max}ms`);
  console.log(`non-200     : ${non200} / ${N}`);
  console.log(
    `req/sec     : ${(N / (burstElapsed / 1000)).toFixed(2)}`
  );

  if (non200 === 0) {
    console.log("");
    console.log("✓ no rate-limiting observed at this burst rate");
    console.log("  → SWR's 60s dedupe in v1 is comfortably within tolerance");
  } else {
    console.log("");
    console.log("⚠️  rate-limiting observed — see non-200 details above");
  }
}

main().catch((e) => {
  console.error("");
  console.error("✗ probe failed:", e);
  process.exit(1);
});
