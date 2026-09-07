/**
 * Refresh the Darb Assabil destination catalogue from the carrier's live branch
 * directory, keeping only (city, area) pairs the carrier actually accepts.
 *
 * WHY two sources: `GET /api/local/branches/public` (no auth) lists every branch
 * and its areas, but it also lists pairs the shipment API rejects — a city
 * filed as its own area (طرابلس/طرابلس, تاجوراء/تاجوراء → "Unable to fetch
 * branch"). So every pair NOT already in the catalogue is checked against
 * `POST /api/local/shipments/calculate/shipping` (read-only preview) before it
 * is added. Pairs already in the catalogue are kept unless `--revalidate` is
 * passed, in which case all of them are re-checked (~300 calls).
 *
 * Writes:
 *   - src/lib/carriers/darb-assabil-areas-data.json  (with --write)
 *   - darb_destinations (upsert active; missing pairs deactivated) with --db
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/refresh-darb-destinations.ts            # dry: print diff
 *   npx tsx --env-file=.env.local scripts/refresh-darb-destinations.ts --write    # rewrite JSON
 *   npx tsx --env-file=.env.local scripts/refresh-darb-destinations.ts --write --db
 *   npx tsx --env-file=.env.local scripts/refresh-darb-destinations.ts --revalidate --write --db
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { buildConfig } from "../src/lib/carriers/dispatch";
import type { CarrierConfig } from "../src/lib/carriers/types";

const JSON_PATH = resolve(fileURLToPath(new URL(".", import.meta.url)), "../src/lib/carriers/darb-assabil-areas-data.json");
/** Darb Assabil — Tripoli. Any active Darb account can validate; ids are stable. */
const TRIPOLI_CARRIER_ID = "4f1271c8-b1f2-4836-9293-8ab3d0b18e69";
const PAGE = 500;
const DELAY_MS = 200;

const argv = process.argv.slice(2);
const WRITE = argv.includes("--write");
const DB = argv.includes("--db");
const REVALIDATE = argv.includes("--revalidate");

type Catalogue = Record<string, string[]>;

interface Branch {
  city?: string;
  area?: string;
  areas?: Array<{ area?: string }>;
}

async function fetchLiveDirectory(base: string): Promise<Catalogue> {
  const live = new Map<string, Set<string>>();
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(`${base}/api/local/branches/public?limit=${PAGE}&offset=${offset}`, {
      headers: { "X-API-VERSION": "1.0.0" },
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json()) as { status?: boolean; data?: { results?: Branch[] } };
    if (!res.ok || body.status !== true) throw new Error(`branches page ${offset}: HTTP ${res.status}`);
    const rows = body.data?.results ?? [];
    for (const b of rows) {
      if (!b.city) continue;
      const set = live.get(b.city) ?? new Set<string>();
      if (b.area) set.add(b.area);
      for (const a of b.areas ?? []) if (a.area) set.add(a.area);
      live.set(b.city, set);
    }
    if (rows.length < PAGE) break;
  }
  const out: Catalogue = {};
  for (const [city, areas] of live) out[city] = [...areas];
  return out;
}

async function acceptsPair(
  config: CarrierConfig,
  serviceId: string,
  city: string,
  area: string,
): Promise<{ ok: boolean; message: string | null }> {
  const base = (config.apiEndpoint || "https://v2.sabil.ly").replace(/\/$/, "");
  const res = await fetch(`${base}/api/local/shipments/calculate/shipping`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `apikey ${config.apiCredentials.api_key}`,
      "X-API-VERSION": "1.0.0",
      "X-ACCOUNT-ID": config.apiCredentials.account_id,
    },
    body: JSON.stringify({
      service: serviceId,
      paymentBy: "sales",
      products: [{ title: "Probe article 1", quantity: 1, amount: 100, currency: "lyd", isChargeable: true }],
      to: { countryCode: "lby", city, area },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    status?: boolean;
    messages?: Array<{ message?: string }>;
  };
  return { ok: res.ok && body.status === true, message: body.messages?.[0]?.message ?? null };
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: carrier, error } = await admin
    .from("carriers")
    .select("id, code, api_endpoint, api_credentials, delivery_fee, return_fee")
    .eq("id", TRIPOLI_CARRIER_ID)
    .single();
  if (error || !carrier) throw new Error(`carrier fetch failed: ${error?.message}`);
  const config = buildConfig(carrier);
  const { data: svc } = await admin
    .from("darb_services")
    .select("service_id")
    .eq("is_default", true)
    .limit(1);
  const serviceId = svc?.[0]?.service_id;
  if (!serviceId) throw new Error("no default darb_services row");

  const base = (config.apiEndpoint || "https://v2.sabil.ly").replace(/\/$/, "");
  const current = JSON.parse(readFileSync(JSON_PATH, "utf8")) as Catalogue;
  const live = await fetchLiveDirectory(base);
  console.log(
    `live: ${Object.keys(live).length} cities / ${Object.values(live).flat().length} pairs · ` +
      `catalogue: ${Object.keys(current).length} / ${Object.values(current).flat().length}`,
  );

  // Candidate = live pair. Keep it if already in the catalogue (unless
  // --revalidate) or if the shipping calculator accepts it.
  const next: Catalogue = {};
  const added: string[] = [];
  const rejected: string[] = [];
  // Walk cities in the catalogue's existing order first (stable diffs), then
  // any city the directory added since.
  const cityOrder = [
    ...Object.keys(current).filter((c) => c in live),
    ...Object.keys(live).filter((c) => !(c in current)),
  ];
  for (const city of cityOrder) {
    const areas = live[city];
    const kept: string[] = [];
    for (const area of areas) {
      const known = (current[city] ?? []).includes(area);
      if (known && !REVALIDATE) {
        kept.push(area);
        continue;
      }
      const verdict = await acceptsPair(config, serviceId, city, area);
      await new Promise((r) => setTimeout(r, DELAY_MS));
      if (verdict.ok) {
        kept.push(area);
        if (!known) added.push(`${city} / ${area}`);
      } else {
        rejected.push(`${city} / ${area} — ${verdict.message ?? "rejected"}`);
      }
    }
    // Preserve the catalogue's existing order; append new areas after it.
    const ordered = [
      ...(current[city] ?? []).filter((a) => kept.includes(a)),
      ...kept.filter((a) => !(current[city] ?? []).includes(a)),
    ];
    if (ordered.length > 0) next[city] = ordered;
  }
  const removed: string[] = [];
  for (const [city, areas] of Object.entries(current)) {
    for (const area of areas) {
      if (!(next[city] ?? []).includes(area)) removed.push(`${city} / ${area}`);
    }
  }

  console.log(`added (${added.length}):`);
  for (const a of added) console.log(`  + ${a}`);
  console.log(`removed (${removed.length}):`);
  for (const r of removed) console.log(`  - ${r}`);
  console.log(`rejected by calculate/shipping (${rejected.length}):`);
  for (const r of rejected) console.log(`  ✗ ${r}`);

  if (!WRITE) {
    console.log("\nDry run — pass --write to rewrite the JSON, --db to upsert darb_destinations.");
    return;
  }

  writeFileSync(JSON_PATH, JSON.stringify(next, null, 2) + "\n");
  console.log(`wrote ${JSON_PATH}`);

  if (!DB) return;
  const now = new Date().toISOString();
  const rows = Object.entries(next).flatMap(([city, areas]) =>
    areas.map((area) => ({ city, area, is_active: true, updated_at: now })),
  );
  const { error: upErr } = await admin
    .from("darb_destinations")
    .upsert(rows, { onConflict: "city,area" });
  if (upErr) throw new Error(`upsert failed: ${upErr.message}`);
  // Deactivate pairs the catalogue no longer carries (never delete — orders reference ids).
  const { data: all } = await admin.from("darb_destinations").select("id, city, area, is_active");
  const stale = (all ?? []).filter(
    (d) => d.is_active && !(next[d.city] ?? []).includes(d.area),
  );
  if (stale.length > 0) {
    const { error: deErr } = await admin
      .from("darb_destinations")
      .update({ is_active: false, updated_at: now })
      .in("id", stale.map((d) => d.id));
    if (deErr) throw new Error(`deactivate failed: ${deErr.message}`);
  }
  console.log(`darb_destinations: ${rows.length} active, ${stale.length} deactivated`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
