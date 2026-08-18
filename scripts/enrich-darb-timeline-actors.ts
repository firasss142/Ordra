/**
 * Fill in per-event actor NAMES for in-flight Darb shipments.
 *
 * WHY this is a separate pass: Darb serves two different payload depths.
 *   GET /api/local/shipments        (list)  → timeline[].createdBy is a bare ObjectId
 *   GET /api/local/shipments/:id    (single) → timeline[].createdBy is a full person
 *                                              { _id, fname, lname, phone }
 * The bulk sweep uses the list endpoint (3 requests for both accounts), so it
 * cannot know WHO performed each step — only that 469 distinct individuals were
 * involved. `timeline[].phone` is NOT a substitute: it is the branch line, shared
 * by a whole office.
 *
 * So: bulk-sweep everything cheaply, then spend one request each on the small set
 * of shipments still moving, where "which courier is sitting on this parcel, and
 * who refused the handoff" is an operational question someone will actually ask.
 * Terminal shipments are skipped — their history is already frozen.
 *
 * Rows are UPDATEd in place, which is the one sanctioned exception to
 * darb_timeline_events being append-only: this adds the actor's identity to an
 * existing event, it never changes what happened or inserts new history.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/enrich-darb-timeline-actors.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/enrich-darb-timeline-actors.ts --apply
 *   npx tsx --env-file=.env.local scripts/enrich-darb-timeline-actors.ts --apply --limit=50
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildConfig, type CarrierRow } from "../src/lib/carriers/dispatch";
import { projectDarbTimeline } from "../src/lib/carriers/darb-assabil-shipment";
import type { CarrierConfig } from "../src/lib/carriers/types";

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const hit = argv.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf("=");
  return eq === -1 ? "" : hit.slice(eq + 1);
};
const APPLY = flag("apply") !== undefined;
const LIMIT = Number(flag("limit") ?? 0);
const DELAY_MS = Number(flag("delay-ms") ?? 150);
const TERMINAL = ["completed", "returned", "cancelled"];

function env(n: string): string {
  const v = process.env[n];
  if (!v) throw new Error(`Missing env ${n}`);
  return v;
}

const admin: SupabaseClient = createClient(
  env("NEXT_PUBLIC_SUPABASE_URL"),
  env("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pad = (s: string, n: number) => ([...s].length >= n ? s : s + " ".repeat(n - [...s].length));

async function fetchOne(
  config: CarrierConfig,
  darbId: string,
): Promise<Record<string, unknown> | null> {
  const base = (config.apiEndpoint || "https://v2.sabil.ly").replace(/\/$/, "");
  const res = await fetch(`${base}/api/local/shipments/${encodeURIComponent(darbId)}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `apikey ${config.apiCredentials.api_key}`,
      "X-API-VERSION": "1.0.0",
      "X-ACCOUNT-ID": config.apiCredentials.account_id,
    },
    signal: AbortSignal.timeout(20000),
  });
  await sleep(DELAY_MS);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return null;
  }
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.status !== true) return null;
  const data = (b.data ?? {}) as Record<string, unknown>;
  const results = Array.isArray(data.results) ? data.results : [];
  return (results[0] as Record<string, unknown>) ?? null;
}

async function main() {
  console.log(`Darb timeline actor enrichment — ${APPLY ? "APPLY" : "DRY RUN"}`);

  const { data: carrierRows } = await admin
    .from("carriers")
    .select("id, name, code, api_endpoint, api_credentials, delivery_fee, return_fee")
    .eq("code", "darb_assabil");
  const configById = new Map<string, CarrierConfig>();
  for (const r of carrierRows ?? []) {
    try {
      configById.set(r.id, buildConfig(r as unknown as CarrierRow));
    } catch {
      /* skip unusable account */
    }
  }

  let q = admin
    .from("darb_shipments")
    .select("darb_id, carrier_id, reference, status_slug, order_id")
    .not("status_slug", "in", `(${TERMINAL.join(",")})`)
    .order("latest_event_at", { ascending: false });
  if (LIMIT > 0) q = q.limit(LIMIT);
  const { data: shipments, error } = await q;
  if (error) throw new Error(error.message);

  const rows = shipments ?? [];
  console.log(`  ${rows.length} in-flight shipment(s) to enrich\n`);

  let enriched = 0;
  let eventsNamed = 0;
  let missing = 0;
  const people = new Map<string, string>();

  for (const s of rows) {
    const config = configById.get(s.carrier_id as string);
    if (!config) continue;

    const record = await fetchOne(config, s.darb_id as string);
    if (!record) {
      missing += 1;
      continue;
    }

    const events = projectDarbTimeline(s.darb_id as string, record).filter(
      (e) => e.actorName !== null,
    );
    if (events.length === 0) continue;

    for (const e of events) {
      if (e.actorId && e.actorName) people.set(e.actorId, e.actorName);
      if (APPLY) {
        await admin
          .from("darb_timeline_events")
          // Identity only — never touches type, description, remarks or timestamp.
          .update({ actor_name: e.actorName, actor_phone: e.actorPhone })
          .eq("darb_id", e.darbId)
          .eq("event_id", e.eventId);
      }
      eventsNamed += 1;
    }
    enriched += 1;

    if (enriched % 25 === 0) {
      console.log(`  … ${enriched}/${rows.length} shipments, ${eventsNamed} events named`);
    }
  }

  console.log(`\n  shipments enriched : ${enriched}`);
  console.log(`  events named       : ${eventsNamed}`);
  console.log(`  not found at Darb  : ${missing}`);
  console.log(`  distinct people    : ${people.size}`);
  if (people.size) {
    console.log("\n  Staff seen handling in-flight parcels:");
    for (const name of [...people.values()].slice(0, 25)) console.log(`    ${pad(name, 44)}`);
    if (people.size > 25) console.log(`    … and ${people.size - 25} more`);
  }
  if (!APPLY) console.log("\n  DRY RUN — nothing written. Re-run with --apply.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
