/**
 * Probe: can we read Darb Assabil shipments in BULK, and what fields come back?
 *
 * WHY: today every Darb status refresh is one HTTP call per order
 * (fetchDarbShipment → GET /api/local/shipments/:id), run at concurrency 3 from a
 * browser-triggered route with no maxDuration. With 150 non-terminal orders the
 * sweep is killed mid-flight, which is why orders carry 6 different
 * carrier_status_synced_at batches and 17 have never resolved at all.
 *
 * The vendor's Postman collection declares the `:id` path segment of
 * GET /api/local/shipments/:id as "(optional)" and documents a large filter set
 * (status, negateStatus, reference, range, offset, limit, sort, includeTotalCount,
 * search). If that holds, one paginated LIST call replaces 150 per-order calls.
 *
 * This script answers, BEFORE any schema or sync-engine work:
 *   (a) does list mode (no :id) actually work, and what is totalCount?
 *   (b) does negateStatus filter server-side, or must we filter locally?
 *   (c) what does a shipment record REALLY contain? (handler / conversation /
 *       cancellationCause / invoices / completedAt / withdrawal fields)
 *   (d) what do the 17 orphan shipments look like — hard-deleted, or findable
 *       again via ?reference= / ?search=?
 *
 * READ-ONLY. GET requests only. Never POST/PATCH/DELETE against Darb, never
 * writes to Supabase. Probe (c) writes ONE local JSON file per account to the
 * scratchpad so the real field shape can be diffed later.
 *
 * Usage (loads app env for Supabase + ENCRYPTION_KEY):
 *   npx tsx --env-file=.env.local scripts/probe-darb-shipments-list.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/probe-darb-shipments-list.ts
 *   npx tsx --env-file=.env.local scripts/probe-darb-shipments-list.ts --only=a,b
 *   npx tsx --env-file=.env.local scripts/probe-darb-shipments-list.ts --account=tripoli
 *   npx tsx --env-file=.env.local scripts/probe-darb-shipments-list.ts --out=/tmp/darb
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildConfig, type CarrierRow } from "../src/lib/carriers/dispatch";
import type { CarrierConfig } from "../src/lib/carriers/types";

const TRIPOLI = "4f1271c8-b1f2-4836-9293-8ab3d0b18e69";
const BENGHAZI = "43077d36-3d61-40d6-ae35-59ed15cec8f7";
const TERMINAL_SLUGS = ["completed", "cancelled", "returned"];

// ── CLI ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf("=");
  return eq === -1 ? "" : hit.slice(eq + 1);
};
const DRY_RUN = flag("dry-run") !== undefined;
const DELAY_MS = Number(flag("delay-ms") ?? 300);
const ACCOUNT_FILTER = (flag("account") ?? "both").toLowerCase();
const OUT_DIR = flag("out") ?? "/tmp/darb-probe";
const ORPHAN_LIMIT = Number(flag("orphans") ?? 5);
const ONLY = (flag("only") ?? "a,b,c,d")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const runs = (q: string) => ONLY.includes(q);

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const admin = createClient(
  env("NEXT_PUBLIC_SUPABASE_URL"),
  env("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pad = (s: string, n: number): string => {
  const len = [...s].length;
  return len >= n ? s : s + " ".repeat(n - len);
};
function heading(text: string) {
  console.log(`\n${"─".repeat(78)}\n${text}\n${"─".repeat(78)}`);
}

// ── Accounts ───────────────────────────────────────────────────────────
interface Account {
  key: "tripoli" | "benghazi";
  label: string;
  carrierId: string;
  config: CarrierConfig;
}

async function loadAccount(
  key: "tripoli" | "benghazi",
  carrierId: string,
): Promise<Account> {
  const { data, error } = await admin
    .from("carriers")
    // Resolve by ID, never .eq("code", …).single() — two rows share darb_assabil.
    .select("id, name, code, api_endpoint, api_credentials, delivery_fee, return_fee")
    .eq("id", carrierId)
    .single();
  if (error || !data) {
    throw new Error(`carrier ${carrierId} fetch failed: ${error?.message}`);
  }
  const row: CarrierRow = {
    id: data.id,
    code: data.code,
    api_endpoint: data.api_endpoint,
    api_credentials: data.api_credentials,
    delivery_fee: Number(data.delivery_fee),
    return_fee: Number(data.return_fee),
  };
  return { key, label: data.name as string, carrierId, config: buildConfig(row) };
}

// ── The one network primitive ──────────────────────────────────────────
interface GetResult {
  ok: boolean;
  httpStatus: number;
  /** Vendor envelope flag. HTTP 200 does NOT mean success. */
  envelopeOk: boolean;
  body: unknown;
  message: string | null;
  ms: number;
  retryAfter: string | null;
}

async function getJson(
  config: CarrierConfig,
  path: string,
  query: Record<string, string | number | boolean | string[]> = {},
): Promise<GetResult> {
  const base = (config.apiEndpoint || "https://v2.sabil.ly").replace(/\/$/, "");
  const qs = new URLSearchParams();
  // An array value is emitted as a REPEATED param (?k=a&k=b) — Darb rejects
  // comma-separated enums with "Invalid choice!".
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) for (const item of v) qs.append(k, item);
    else qs.set(k, String(v));
  }
  const url = `${base}${path}${qs.toString() ? `?${qs}` : ""}`;

  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `apikey ${config.apiCredentials.api_key}`,
        "X-API-VERSION": "1.0.0",
        "X-ACCOUNT-ID": config.apiCredentials.account_id,
      },
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return {
      ok: false,
      httpStatus: 0,
      envelopeOk: false,
      body: null,
      message: e instanceof Error ? e.message : "transport failure",
      ms: Date.now() - started,
      retryAfter: null,
    };
  }
  const ms = Date.now() - started;
  const retryAfter = response.headers.get("retry-after");

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = await response.text();
  }

  const rec = (body ?? {}) as Record<string, unknown>;
  const envelopeOk = rec.status === true;
  const messages = rec.messages as Array<{ message?: string }> | undefined;
  const message = envelopeOk
    ? null
    : (messages?.[0]?.message ??
      (typeof rec.message === "string" ? rec.message : null) ??
      (typeof body === "string" ? body.slice(0, 200) : "status:false"));

  await sleep(DELAY_MS);
  return { ok: envelopeOk, httpStatus: response.status, envelopeOk, body, message, ms, retryAfter };
}

/** `data.results[]` for list-shaped responses (the single-GET uses the same shape). */
function resultsOf(body: unknown): Array<Record<string, unknown>> {
  const b = (body ?? {}) as Record<string, unknown>;
  const data = (b.data ?? {}) as Record<string, unknown>;
  const results = data.results;
  return Array.isArray(results) ? (results as Array<Record<string, unknown>>) : [];
}

function totalCountOf(body: unknown): number | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const data = (b.data ?? {}) as Record<string, unknown>;
  return typeof data.totalCount === "number" ? data.totalCount : null;
}

/** Recursive key inventory — "which fields does this record actually carry?" */
function inventory(o: unknown, prefix = "", depth = 0, acc: Map<string, string> = new Map()) {
  if (depth > 4 || o === null || typeof o !== "object") return acc;
  if (Array.isArray(o)) {
    acc.set(`${prefix}[]`, `array(${o.length})`);
    if (o.length > 0) inventory(o[0], `${prefix}[0]`, depth + 1, acc);
    return acc;
  }
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v === null) acc.set(path, "null");
    else if (Array.isArray(v)) {
      acc.set(path, `array(${v.length})`);
      if (v.length > 0) inventory(v[0], `${path}[0]`, depth + 1, acc);
    } else if (typeof v === "object") {
      acc.set(path, "object");
      inventory(v, path, depth + 1, acc);
    } else {
      const s = String(v);
      acc.set(path, `${typeof v} = ${s.length > 48 ? `${s.slice(0, 48)}…` : s}`);
    }
  }
  return acc;
}

/** The fields this whole project hinges on — report presence explicitly. */
const FIELDS_OF_INTEREST = [
  "handler",
  "handler.fname",
  "handler.lname",
  "handler.phone",
  "recipientHandler",
  "initialHandler",
  "initialHandleAt",
  "conversation",
  "cancellationCause",
  "cancellationRequested",
  "delayedUntil",
  "resendCount",
  "cancelCount",
  "completedAt",
  "invoices",
  "notes",
  "priority",
  "attachments",
  "timeline",
  "toBranchGroup",
  "toZoneCode",
  "deliveryWithdrawalAt",
  "deliveryWithdrawalReferences",
  "salesWithdrawalAt",
  "createdAt",
  "updatedAt",
  "reference",
  "status",
];

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  console.log("Darb Assabil shipments-LIST probe — READ ONLY (GET only, no writes)");
  console.log(`  probes  : ${ONLY.join(",")}`);
  console.log(`  delay   : ${DELAY_MS}ms`);
  console.log(`  out dir : ${OUT_DIR}`);
  if (DRY_RUN) console.log("  MODE    : --dry-run (no network calls)");

  const wanted: Array<["tripoli" | "benghazi", string]> =
    ACCOUNT_FILTER === "tripoli"
      ? [["tripoli", TRIPOLI]]
      : ACCOUNT_FILTER === "benghazi"
        ? [["benghazi", BENGHAZI]]
        : [
            ["tripoli", TRIPOLI],
            ["benghazi", BENGHAZI],
          ];

  const accounts: Account[] = [];
  for (const [key, id] of wanted) accounts.push(await loadAccount(key, id));

  console.log("\nAccounts:");
  for (const a of accounts) {
    console.log(`  ${pad(a.key, 10)} ${pad(a.label, 28)} account_id=${a.config.apiCredentials.account_id}`);
  }

  if (DRY_RUN) {
    console.log("\nDRY RUN: no calls made. Probes that would run:");
    for (const q of ONLY) console.log(`  (${q})`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });

  // ── (a) does list mode work? ─────────────────────────────────────────
  const listWorks = new Map<string, boolean>();
  if (runs("a")) {
    heading("PROBE (a) — does GET /api/local/shipments (no :id) return a list?");
    for (const a of accounts) {
      const r = await getJson(a.config, "/api/local/shipments", {
        offset: 0,
        limit: 5,
        includeTotalCount: true,
      });
      const rows = resultsOf(r.body);
      const total = totalCountOf(r.body);
      listWorks.set(a.key, r.ok && rows.length > 0);
      console.log(
        `  ${pad(a.key, 10)} http=${r.httpStatus} envelope=${r.envelopeOk} rows=${rows.length} totalCount=${total ?? "—"} ${r.ms}ms`,
      );
      if (!r.ok) console.log(`    message: ${r.message}`);
      else if (rows.length > 0) {
        console.log(
          `    sample: _id=${rows[0]._id} reference=${rows[0].reference} status=${rows[0].status}`,
        );
      }
    }
    const anyWorks = [...listWorks.values()].some(Boolean);
    console.log(
      anyWorks
        ? "\nVERDICT (a): LIST MODE WORKS → bulk sync is viable; build fetchDarbShipmentPage()."
        : "\nVERDICT (a): LIST MODE UNAVAILABLE → keep the per-_id fetch; only batching strategy changes.",
    );
  }

  // ── (b) does negateStatus filter server-side? ────────────────────────
  if (runs("b")) {
    heading("PROBE (b) — does negateStatus / status filter server-side?");
    for (const a of accounts) {
      if (listWorks.size > 0 && listWorks.get(a.key) === false) {
        console.log(`  ${pad(a.key, 10)} skipped (list mode unavailable)`);
        continue;
      }
      // Multi-value enums: Darb rejects CSV ("Invalid choice!"). Try the
      // encodings that could work, and report which one the vendor accepts.
      const encodings: Array<[string, Record<string, string | number | boolean | string[]>]> = [
        ["negateStatus repeated", { negateStatus: TERMINAL_SLUGS }],
        ["negateStatus single  ", { negateStatus: "completed" }],
        ["status repeated      ", { status: TERMINAL_SLUGS }],
      ];
      for (const [label, extra] of encodings) {
        const r = await getJson(a.config, "/api/local/shipments", {
          offset: 0,
          limit: 50,
          includeTotalCount: true,
          ...extra,
        });
        const rows = resultsOf(r.body);
        const leaked = rows.filter((x) => TERMINAL_SLUGS.includes(String(x.status)));
        const seen = new Map<string, number>();
        for (const x of rows) {
          const s = String(x.status);
          seen.set(s, (seen.get(s) ?? 0) + 1);
        }
        console.log(
          `  ${pad(a.key, 10)} ${label} → http=${r.httpStatus} rows=${rows.length} total=${totalCountOf(r.body) ?? "—"} terminal_in_result=${leaked.length}${r.message ? ` :: ${r.message}` : ""}`,
        );
        if (seen.size) {
          console.log(
            `    ${" ".repeat(10)} statuses: ${[...seen.entries()].map(([s, n]) => `${s}=${n}`).join(" ")}`,
          );
        }
      }

      const only = await getJson(a.config, "/api/local/shipments", {
        offset: 0,
        limit: 20,
        includeTotalCount: true,
        status: "released",
      });
      const onlyRows = resultsOf(only.body);
      const offTarget = onlyRows.filter((r) => String(r.status) !== "released");
      console.log(
        `  ${pad(a.key, 10)} status=released → rows=${onlyRows.length} total=${totalCountOf(only.body) ?? "—"} off_target=${offTarget.length}`,
      );

      const paged = await getJson(a.config, "/api/local/shipments", {
        offset: 5,
        limit: 5,
        includeTotalCount: true,
      });
      const pagedRows = resultsOf(paged.body);
      console.log(
        `  ${pad(a.key, 10)} offset=5&limit=5 → rows=${pagedRows.length} (pagination ${pagedRows.length > 0 ? "responds" : "returned nothing"})`,
      );
    }
    console.log(
      "\nVERDICT (b): server-side filtering usable if terminal_leaked=0 and off_target=0 above.",
    );
  }

  // ── (e) bulk-paging strategy ─────────────────────────────────────────
  if (runs("e")) {
    heading("PROBE (e) — can we page the WHOLE account cheaply? (limit ceiling, sort, range)");
    for (const a of accounts) {
      // How large a page will the vendor actually serve?
      for (const limit of [100, 200, 500]) {
        const r = await getJson(a.config, "/api/local/shipments", {
          offset: 0,
          limit,
          includeTotalCount: true,
        });
        const rows = resultsOf(r.body);
        console.log(
          `  ${pad(a.key, 10)} limit=${pad(String(limit), 5)} → http=${r.httpStatus} rows=${rows.length} total=${totalCountOf(r.body) ?? "—"} ${r.ms}ms${r.message ? ` :: ${r.message}` : ""}`,
        );
      }

      // Does sort work? Newest-updated first is what makes delta sync possible.
      for (const sort of ['{"updatedAt":-1}', '{"createdAt":-1}']) {
        const r = await getJson(a.config, "/api/local/shipments", {
          offset: 0,
          limit: 3,
          sort,
        });
        const rows = resultsOf(r.body);
        console.log(
          `  ${pad(a.key, 10)} sort=${pad(sort, 20)} → http=${r.httpStatus} rows=${rows.length} first.updatedAt=${rows[0]?.updatedAt ?? "—"}${r.message ? ` :: ${r.message}` : ""}`,
        );
      }

      // Full sweep cost at the best page size.
      const probe = await getJson(a.config, "/api/local/shipments", {
        offset: 0,
        limit: 1,
        includeTotalCount: true,
      });
      const total = totalCountOf(probe.body) ?? 0;
      console.log(
        `  ${pad(a.key, 10)} full sweep = ${Math.ceil(total / 200)} call(s) at limit=200 for ${total} shipments`,
      );
    }
    console.log(
      "\nVERDICT (e): page the whole account and filter locally — multi-value enum filters are unsupported.",
    );
  }

  // ── (c) what does a record REALLY contain? ───────────────────────────
  if (runs("c")) {
    heading("PROBE (c) — real field shape of a shipment record");
    for (const a of accounts) {
      // Take a live, non-terminal order we actually own, so the record is
      // representative (a completed shipment may not carry handler/conversation).
      const { data: orderRows } = await admin
        .from("orders")
        .select("id, tracking_number, carrier_extra, carrier_status_slug")
        .eq("carrier_id", a.carrierId)
        .not("carrier_status_slug", "in", `(${TERMINAL_SLUGS.join(",")})`)
        .not("carrier_extra->>darb_assabil_id", "is", null)
        .limit(3);

      const candidates = (orderRows ?? []).filter(
        (o) => typeof (o.carrier_extra as Record<string, unknown>)?.darb_assabil_id === "string",
      );
      if (candidates.length === 0) {
        console.log(`  ${pad(a.key, 10)} no non-terminal order with an internal id — skipped`);
        continue;
      }

      let dumped = false;
      for (const cand of candidates) {
        const internalId = String(
          (cand.carrier_extra as Record<string, unknown>).darb_assabil_id,
        );
        const r = await getJson(a.config, `/api/local/shipments/${encodeURIComponent(internalId)}`);
        const rows = resultsOf(r.body);
        if (!r.ok || rows.length === 0) {
          console.log(`  ${pad(a.key, 10)} ${internalId} → not usable (http=${r.httpStatus} ${r.message ?? ""})`);
          continue;
        }

        const rec = rows[0];
        const file = join(OUT_DIR, `shape-${a.key}.json`);
        writeFileSync(file, JSON.stringify(rec, null, 2), "utf8");
        console.log(`  ${pad(a.key, 10)} dumped full record → ${file}`);
        console.log(`             _id=${rec._id} reference=${rec.reference} status=${rec.status}`);

        const inv = inventory(rec);
        console.log(`\n  Fields of interest (${a.key}):`);
        for (const f of FIELDS_OF_INTEREST) {
          const hit = inv.get(f);
          console.log(`    ${pad(f, 32)} ${hit ? `PRESENT  ${hit}` : "absent"}`);
        }
        const handlerKeys = [...inv.keys()].filter((k) => k.startsWith("handler"));
        if (handlerKeys.length) {
          console.log(`\n    handler.* → ${handlerKeys.map((k) => `${k}=${inv.get(k)}`).join("  ")}`);
        }
        const convKeys = [...inv.keys()].filter((k) => k.startsWith("conversation"));
        if (convKeys.length) {
          console.log(`    conversation.* → ${convKeys.join(", ")}`);
        }
        const tlKeys = [...inv.keys()].filter((k) => k.startsWith("timeline[0]"));
        if (tlKeys.length) {
          console.log(`    timeline[0].* → ${tlKeys.join(", ")}`);
        }
        console.log(`\n    total distinct paths: ${inv.size}`);
        dumped = true;
        break;
      }
      if (!dumped) console.log(`  ${pad(a.key, 10)} could not dump a record`);
    }
    console.log(
      "\nVERDICT (c): every PRESENT field above is a column we can mirror. absent = not offered on this record.",
    );
  }

  // ── (f) per-status field coverage + cross-account resolution ─────────
  if (runs("f")) {
    heading("PROBE (f) — which fields appear on completed / cancelled / returned records?");
    const perStatus = ["completed", "cancelled", "returned", "released"];
    const LATE_FIELDS = [
      "completedAt",
      "cancellationCause",
      "cancellationRequested",
      "cancelCount",
      "resendCount",
      "conversation",
      "deliveryWithdrawalAt",
      "deliveryWithdrawalReferences",
      "salesWithdrawalAt",
      "salesWithdrawalReferences",
      "undoCompletionCount",
      "handler",
      "handlerAccount",
      "attachments",
      "invoices",
      "delayedUntil",
    ];
    for (const a of accounts) {
      console.log(`\n  ${a.key}:`);
      for (const status of perStatus) {
        const r = await getJson(a.config, "/api/local/shipments", {
          offset: 0,
          limit: 1,
          status,
          sort: '{"updatedAt":-1}',
        });
        const rec = resultsOf(r.body)[0];
        if (!rec) {
          console.log(`    ${pad(status, 11)} no record`);
          continue;
        }
        const inv = inventory(rec);
        const present = LATE_FIELDS.filter((f) => inv.has(f));
        console.log(`    ${pad(status, 11)} ref=${pad(String(rec.reference), 12)} → ${present.join(", ") || "(none of interest)"}`);
        for (const f of ["cancellationCause", "completedAt", "resendCount", "cancelCount", "deliveryWithdrawalAt"]) {
          if (inv.has(f)) console.log(`      ${pad(f, 26)} ${inv.get(f)}`);
        }
        if (inv.has("conversation[]")) {
          console.log(`      conversation → ${inv.get("conversation[]")} :: ${[...inv.keys()].filter((k) => k.startsWith("conversation[0]")).join(", ")}`);
        }
      }
    }

    // Cross-account: do Benghazi-assigned orders actually live in the Tripoli account?
    heading("PROBE (f2) — do Benghazi-assigned orders resolve under the TRIPOLI account?");
    const tripoli = accounts.find((a) => a.key === "tripoli");
    const benghazi = accounts.find((a) => a.key === "benghazi");
    if (!tripoli || !benghazi) {
      console.log("  needs both accounts (--account=both) — skipped");
    } else {
      const { data: bgOrders } = await admin
        .from("orders")
        .select("id, tracking_number, carrier_extra, carrier_status_slug")
        .eq("carrier_id", benghazi.carrierId)
        .not("carrier_extra->>darb_assabil_id", "is", null)
        .limit(6);
      let underBenghazi = 0;
      let underTripoli = 0;
      let nowhere = 0;
      for (const o of bgOrders ?? []) {
        const iid = String((o.carrier_extra as Record<string, unknown>).darb_assabil_id);
        const inBg = resultsOf(
          (await getJson(benghazi.config, `/api/local/shipments/${encodeURIComponent(iid)}`)).body,
        );
        const inTr = resultsOf(
          (await getJson(tripoli.config, `/api/local/shipments/${encodeURIComponent(iid)}`)).body,
        );
        const where = inBg.length ? "BENGHAZI" : inTr.length ? "TRIPOLI" : "NEITHER";
        if (inBg.length) underBenghazi++;
        else if (inTr.length) underTripoli++;
        else nowhere++;
        console.log(
          `  order ${o.id.slice(0, 8)} ref=${pad(String(o.tracking_number), 12)} slug=${pad(String(o.carrier_status_slug), 11)} → ${where}${inTr.length ? ` (status=${inTr[0].status})` : ""}`,
        );
      }
      console.log(
        `\n  benghazi=${underBenghazi} tripoli=${underTripoli} neither=${nowhere}`,
      );
      console.log(
        underTripoli > 0
          ? "  VERDICT (f2): Benghazi-assigned orders live in the TRIPOLI account →\n" +
              "                the sync MUST try both accounts, not just the order's carrier_id."
          : "  VERDICT (f2): accounts are self-consistent.",
      );
    }
  }

  // ── (g) does the list endpoint return EVERY shipment? ────────────────
  if (runs("g")) {
    heading("PROBE (g) — is the unfiltered list complete? (per-status totals vs the whole list)");
    const ALL_SLUGS = [
      "pending",
      "booked",
      "processing",
      "on-branch",
      "released",
      "resent",
      "delayed",
      "returning",
      "completed",
      "returned",
      "cancelled",
    ];
    for (const a of accounts) {
      const unfiltered = totalCountOf(
        (
          await getJson(a.config, "/api/local/shipments", {
            offset: 0,
            limit: 1,
            includeTotalCount: true,
          })
        ).body,
      );
      let sum = 0;
      const parts: string[] = [];
      for (const slug of ALL_SLUGS) {
        const t = totalCountOf(
          (
            await getJson(a.config, "/api/local/shipments", {
              offset: 0,
              limit: 1,
              includeTotalCount: true,
              status: slug,
            })
          ).body,
        );
        if (t) {
          sum += t;
          parts.push(`${slug}=${t}`);
        }
      }
      console.log(`  ${pad(a.key, 10)} unfiltered total = ${unfiltered}`);
      console.log(`  ${pad("", 10)} per-status sum    = ${sum}   (${parts.join(" ")})`);
      console.log(
        sum > (unfiltered ?? 0)
          ? `  ${pad("", 10)} → THE UNFILTERED LIST HIDES ${sum - (unfiltered ?? 0)} SHIPMENT(S).\n` +
              `  ${pad("", 10)}   A bulk sweep alone is NOT complete — per-status paging or an\n` +
              `  ${pad("", 10)}   per-order fallback is required.`
          : `  ${pad("", 10)} → unfiltered list is complete.`,
      );
    }
  }

  // ── (d) the orphans ──────────────────────────────────────────────────
  if (runs("d")) {
    heading(`PROBE (d) — the orphan orders: are they recoverable?`);
    // The true orphan population is NOT just "slug IS NULL". Darb re-references
    // every shipment after creation, so an order whose tracking_number still
    // carries the creation-time `SH…` value has NEVER been read back
    // successfully — including the 57 sitting at a stale "pending".
    const { data: orphans } = await admin
      .from("orders")
      .select(
        "id, tracking_number, carrier_id, carrier_extra, created_at, customer_phone, customer_city, carrier_status_slug",
      )
      .in("carrier_id", accounts.map((a) => a.carrierId))
      .like("tracking_number", "SH%")
      .order("created_at", { ascending: false })
      .limit(ORPHAN_LIMIT);

    const rows = orphans ?? [];
    console.log(`  probing ${rows.length} orphan order(s) (of 17 total; --orphans=N to change)\n`);

    const outcomes: Record<string, number> = {};
    for (const o of rows) {
      const account = accounts.find((a) => a.carrierId === o.carrier_id);
      if (!account) continue;
      const internalId = String(
        (o.carrier_extra as Record<string, unknown>)?.darb_assabil_id ?? "",
      );
      const ref = o.tracking_number ?? "";
      console.log(`  order ${o.id.slice(0, 8)} ${pad(account.key, 10)} ref=${pad(ref, 12)} _id=${internalId}`);

      // Step 1 — by internal _id (what the sync does today).
      const byId = internalId
        ? await getJson(account.config, `/api/local/shipments/${encodeURIComponent(internalId)}`)
        : null;
      const idRows = byId ? resultsOf(byId.body) : [];
      console.log(
        `    by _id       → http=${byId?.httpStatus ?? "—"} envelope=${byId?.envelopeOk ?? "—"} rows=${idRows.length}${byId?.message ? ` :: ${byId.message}` : ""}`,
      );
      if (idRows.length > 0) {
        console.log(`      FOUND status=${idRows[0].status} reference=${idRows[0].reference}`);
        outcomes.found_by_id = (outcomes.found_by_id ?? 0) + 1;
        continue;
      }

      // Step 2 — by human reference.
      const byRef = ref
        ? await getJson(account.config, "/api/local/shipments", {
            reference: ref,
            offset: 0,
            limit: 5,
            includeTotalCount: true,
          })
        : null;
      const refRows = byRef ? resultsOf(byRef.body) : [];
      console.log(
        `    by reference → http=${byRef?.httpStatus ?? "—"} rows=${refRows.length}${byRef?.message ? ` :: ${byRef.message}` : ""}`,
      );
      if (refRows.length > 0) {
        console.log(
          `      FOUND status=${refRows[0].status} _id=${refRows[0]._id} (stored _id is STALE)`,
        );
        outcomes.found_by_reference = (outcomes.found_by_reference ?? 0) + 1;
        continue;
      }

      // Step 3 — free-text search (reference, then phone).
      const bySearch = await getJson(account.config, "/api/local/shipments", {
        search: ref || String(o.customer_phone ?? ""),
        offset: 0,
        limit: 5,
        includeTotalCount: true,
      });
      const searchRows = resultsOf(bySearch.body);
      console.log(
        `    by search    → http=${bySearch.httpStatus} rows=${searchRows.length}${bySearch.message ? ` :: ${bySearch.message}` : ""}`,
      );
      if (searchRows.length > 0) {
        console.log(
          `      CANDIDATES: ${searchRows.map((r) => `${r.reference}/${r.status}`).join(", ")}`,
        );
        outcomes.found_by_search = (outcomes.found_by_search ?? 0) + 1;
        continue;
      }

      console.log("      GONE — not resolvable by _id, reference, or search → hard-deleted at Darb");
      outcomes.hard_deleted = (outcomes.hard_deleted ?? 0) + 1;
    }

    console.log(`\n  Outcome distribution: ${JSON.stringify(outcomes)}`);
    console.log(
      "\nVERDICT (d): this is the resolution ladder the reconcile script will implement.\n" +
        "             hard_deleted orders need a human decision — never auto-cancel them.",
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
