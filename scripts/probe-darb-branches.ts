/**
 * Probe: what does Darb Assabil's branch directory contain, and does anything
 * in it carry the sticker-roll COLOUR?
 *
 * WHY: the warehouse must know which coloured roll a parcel needs BEFORE it is
 * picked up. The colour is printed on the roll, so the first question is
 * whether the carrier exposes it at all. Three signals were already ruled out
 * from data we hold:
 *   - `toZoneCode` (8 values) merges zones the colour poster keeps apart
 *     (TR spans طرابلس + ترهونة; WA spans اجدابيا + الكفرة);
 *   - `breakdown.branchToBranch` is a radial distance band from the ORIGIN
 *     branch, so it differs per account and cuts across the poster's cards;
 *   - `toBranchGroup` (19 values) maps cleanly — each group sits inside exactly
 *     one card, on 823/823 mirrored shipments, identically for both accounts.
 *
 * So `branchGroup` is the join key. This script fetches the authoritative
 * directory behind it and answers three things:
 *   1. every (branchGroup, city, area) triple, per account — which resolves the
 *      45 destination strings our orders carry that are areas, not catalogue
 *      cities (جنزور, صرمان, شحات, اوباري…);
 *   2. whether `الزاوية` really belongs to TR or ZWY (live data shows both,
 *      inside BOTH accounts, so it is area-dependent — not account-dependent);
 *   3. whether ANY key anywhere in the payload looks like a colour. The vendor
 *      Postman collection has no such key, but `toZoneCode` is also absent from
 *      the documented schema and present live — so the schema is not the whole
 *      truth and this has to be checked against a real response.
 *
 * READ-ONLY. GET only, one paginated endpoint, no Supabase writes, no disk
 * writes unless --out is passed.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/probe-darb-branches.ts
 *   npx tsx --env-file=.env.local scripts/probe-darb-branches.ts --raw
 *   npx tsx --env-file=.env.local scripts/probe-darb-branches.ts --out=report/darb-branches.json
 *   npx tsx --env-file=.env.local scripts/probe-darb-branches.ts --sync   # refresh darb_branches
 *
 * `--sync` is the ONLY write, and it writes only to our own mirror table
 * (`darb_branches`). Darb is never written to by this script.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildConfig, type CarrierRow } from "../src/lib/carriers/dispatch";
import type { CarrierConfig } from "../src/lib/carriers/types";

const PAGE_LIMIT = 500;

// Anything that could plausibly name a colour, in either language. Matched
// against the full key PATH so a nested `style.color` is caught too.
const COLOUR_HINTS = [
  "color", "colour", "hex", "rgb", "swatch", "tint", "shade",
  "band", "tag", "sticker", "roll", "label", "لون", "الوان", "لصاقة", "شريط",
];

const argv = process.argv.slice(2);
const has = (name: string) => argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const val = (name: string) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const SHOW_RAW = has("raw");
const SYNC = has("sync");
const OUT = val("out");

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const admin = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const baseUrl = (c: CarrierConfig) => (c.apiEndpoint || "https://v2.sabil.ly").replace(/\/$/, "");
const headers = (c: CarrierConfig) => ({
  "Content-Type": "application/json",
  Authorization: `apikey ${c.apiCredentials.api_key}`,
  "X-API-VERSION": "1.0.0",
  "X-ACCOUNT-ID": c.apiCredentials.account_id,
});

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Walk every nested key and return `path -> sample value` for the whole record. */
function flatten(value: unknown, prefix = "", out = new Map<string, unknown>()): Map<string, unknown> {
  if (Array.isArray(value)) {
    // One sample element is enough to learn the shape of a homogeneous array.
    if (value.length > 0) flatten(value[0], `${prefix}[]`, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Rec)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
    return out;
  }
  out.set(prefix, value);
  return out;
}

async function fetchPage(config: CarrierConfig, offset: number) {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(PAGE_LIMIT),
    includeTotalCount: "true",
  });
  const res = await fetch(`${baseUrl(config)}/api/local/branches/public?${params}`, {
    method: "GET",
    headers: headers(config),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let body: Rec = {};
  try {
    body = JSON.parse(text) as Rec;
  } catch {
    return { http: res.status, ok: false, records: [] as Rec[], total: null as number | null, raw: text.slice(0, 400) };
  }
  const data = asRec(body.data);
  const results = Array.isArray(data.results) ? (data.results as Rec[]) : [];
  return {
    http: res.status,
    // Vendor contract: HTTP 200 does NOT mean success — the envelope decides.
    ok: body.status === true,
    records: results,
    total: typeof data.totalCount === "number" ? data.totalCount : null,
    raw: text.slice(0, 400),
  };
}

async function main() {
  console.log("Darb Assabil — branch directory probe (READ-ONLY, GET only)\n");

  const { data: rows, error } = await admin
    .from("carriers")
    .select("id, name, code, api_endpoint, api_credentials, delivery_fee, return_fee")
    .eq("code", "darb_assabil")
    .eq("is_active", true);
  if (error) throw new Error(error.message);

  const report: Record<string, unknown> = {};
  const rawByAccount = new Map<string, Rec[]>();
  const colourKeysSeen = new Set<string>();
  const allShapes = new Set<string>();

  for (const row of rows ?? []) {
    let config: CarrierConfig;
    try {
      config = buildConfig(row as unknown as CarrierRow);
    } catch (e) {
      console.log(`── ${row.name}: credentials unusable — ${(e as Error).message}\n`);
      continue;
    }

    console.log(`── ${row.name} ${"─".repeat(Math.max(0, 52 - String(row.name).length))}`);

    const records: Rec[] = [];
    let total: number | null = null;
    for (let offset = 0; ; offset += PAGE_LIMIT) {
      const page = await fetchPage(config, offset);
      if (offset === 0) {
        total = page.total;
        console.log(`   http=${page.http} envelope=${page.ok} totalCount=${page.total ?? "—"}`);
        if (!page.ok) {
          console.log(`   raw: ${page.raw}`);
          break;
        }
      }
      records.push(...page.records);
      if (page.records.length < PAGE_LIMIT) break;
      if (offset > 5000) break; // paranoia stop
    }

    if (records.length === 0) {
      console.log("   no records — nothing to report\n");
      continue;
    }
    console.log(`   fetched ${records.length} branch records\n`);
    rawByAccount.set(String(row.name), records);

    // 1. Every key path the payload actually carries.
    for (const rec of records.slice(0, 50)) {
      for (const key of flatten(rec).keys()) allShapes.add(key);
    }

    // 2. Does anything look like a colour?
    for (const key of allShapes) {
      const lower = key.toLowerCase();
      if (COLOUR_HINTS.some((h) => lower.includes(h))) colourKeysSeen.add(key);
    }

    // 3. branchGroup → cities/areas, the directory we came for.
    const byGroup = new Map<
      string,
      { code: Set<string>; cities: Set<string>; areas: Set<string>; colors: Set<string> }
    >();
    const cityToGroups = new Map<string, Set<string>>();
    for (const rec of records) {
      const group = str(rec.branchGroup) ?? "(none)";
      const code = str(rec.branchCode);
      const city = str(rec.city);
      const area = str(rec.area);
      if (!byGroup.has(group)) {
        byGroup.set(group, {
          code: new Set(), cities: new Set(), areas: new Set(), colors: new Set(),
        });
      }
      const g = byGroup.get(group)!;
      if (code) g.code.add(code);
      const colour = str(rec.color);
      if (colour) g.colors.add(colour);
      if (city) {
        g.cities.add(city);
        if (!cityToGroups.has(city)) cityToGroups.set(city, new Set());
        cityToGroups.get(city)!.add(group);
      }
      if (area) g.areas.add(area);
      // areas[] carries its own per-area names alongside the rates.
      if (Array.isArray(rec.areas)) {
        for (const a of rec.areas as Rec[]) {
          const nested = str(asRec(a).area);
          if (nested) g.areas.add(nested);
        }
      }
    }

    console.log("   branchGroup  COLOR      code             cities                             areas");
    for (const [group, g] of [...byGroup.entries()].sort()) {
      const cities = [...g.cities].join(" · ");
      console.log(
        `   ${group.padEnd(12)} ${[...g.colors].join(",").padEnd(10)} ${[...g.code].join(",").padEnd(16)} ${cities.slice(0, 34).padEnd(35)} ${g.areas.size}`,
      );
    }

    // 4. Cities that belong to more than one branch group — the ambiguity that
    //    decides which roll الزاوية needs.
    const split = [...cityToGroups.entries()].filter(([, gs]) => gs.size > 1);
    console.log(`\n   cities spanning >1 branch group: ${split.length}`);
    for (const [city, gs] of split) console.log(`     ${city} → ${[...gs].join(", ")}`);

    report[String(row.name)] = {
      carrier_id: row.id,
      total,
      fetched: records.length,
      groups: Object.fromEntries(
        [...byGroup.entries()].map(([g, v]) => [
          g,
          { colors: [...v.colors], codes: [...v.code], cities: [...v.cities], areas: [...v.areas] },
        ]),
      ),
      split_cities: Object.fromEntries(split.map(([c, gs]) => [c, [...gs]])),
    };

    if (SHOW_RAW) {
      console.log("\n   RAW sample record:");
      console.log(JSON.stringify(records[0], null, 2).split("\n").map((l) => `     ${l}`).join("\n"));
    }
    console.log("");
  }

  console.log("─".repeat(60));
  console.log(`Distinct key paths in the branch payload: ${allShapes.size}`);
  console.log([...allShapes].sort().map((k) => `  ${k}`).join("\n"));
  console.log("");
  if (colourKeysSeen.size === 0) {
    console.log(">>> NO COLOUR FIELD. Darb does not expose the roll colour.");
    console.log("    The colour must be recorded per roll on our side.");
  } else {
    console.log(">>> POSSIBLE COLOUR-BEARING KEYS — inspect these:");
    for (const k of colourKeysSeen) console.log(`      ${k}`);
  }


  if (SYNC) {
    console.log("\n── syncing darb_branches ──────────────────────────────");
    const accounts = [...rawByAccount.values()];
    if (accounts.length === 0) {
      console.log("   nothing fetched — not touching the mirror");
    } else {
      // Both accounts publish the same directory; assert it before relying on
      // it, so a silent divergence becomes a loud refusal rather than a
      // half-written table.
      const signature = (recs: Rec[]) =>
        recs
          .map((r) => `${str(r.branchGroup)}|${str(r.city)}|${str(r.area)}|${str(r.color)}`)
          .sort()
          .join("\n");
      if (accounts.length > 1 && signature(accounts[0]) !== signature(accounts[1])) {
        throw new Error(
          "The two Darb accounts no longer publish the same branch directory. " +
            "darb_branches is not keyed on carrier_id, so this must be resolved first.",
        );
      }

      // One row per (branch_group, city, area) — the table's key. The nested
      // areas[] carry the real per-area names; the top-level `area` is the
      // branch's own seat.
      const rows = new Map<string, Record<string, unknown>>();
      const put = (group: string, code: string | null, city: string, area: string, color: string | null) => {
        rows.set(`${group}|${city}|${area}`, {
          branch_group: group,
          branch_code: code,
          city,
          area,
          color: color ? color.toLowerCase() : null,
        });
      };
      for (const rec of accounts[0]) {
        const group = str(rec.branchGroup);
        const city = str(rec.city);
        if (!group || !city) continue;
        const code = str(rec.branchCode);
        const colour = str(rec.color);
        put(group, code, city, "", colour);
        const seat = str(rec.area);
        if (seat) put(group, code, city, seat, colour);
        if (Array.isArray(rec.areas)) {
          for (const a of rec.areas as Rec[]) {
            const name = str(asRec(a).area);
            if (name) put(group, code, city, name, colour);
          }
        }
      }

      const payload = [...rows.values()];
      const { error: upsertError } = await admin
        .from("darb_branches")
        .upsert(payload, { onConflict: "branch_group,city,area" });
      if (upsertError) throw new Error(`darb_branches upsert failed: ${upsertError.message}`);

      // Drop anything Darb no longer publishes, so a closed branch cannot keep
      // colouring orders. Compared on the composite key we just wrote.
      const keep = new Set(rows.keys());
      const { data: existing } = await admin
        .from("darb_branches")
        .select("branch_group, city, area");
      const stale = (existing ?? []).filter(
        (r) => !keep.has(`${r.branch_group}|${r.city}|${r.area}`),
      );
      for (const r of stale) {
        await admin
          .from("darb_branches")
          .delete()
          .eq("branch_group", r.branch_group)
          .eq("city", r.city)
          .eq("area", r.area);
      }

      console.log(`   upserted ${payload.length} rows, removed ${stale.length} stale`);
    }
  }

  if (OUT) {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");
    console.log(`\nDirectory written to ${OUT}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
