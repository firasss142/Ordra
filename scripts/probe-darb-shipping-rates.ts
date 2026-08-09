/**
 * Probe: does Darb Assabil quote DIFFERENT shipping prices from the "Tripoli"
 * account vs the "Benghazi" account for the same destination?
 *
 * WHY: both carrier rows currently carry an identical flat delivery_fee (10 LYD),
 * so "recommend the cheaper Darb account for this customer's address" is always a
 * tie. Darb's own POST /api/local/shipments/calculate/shipping returns the real
 * per-shipment price with a { branchToBranch, pickFromDoor, dropToDoor } breakdown,
 * and we have never called it. This script answers — before any schema, harvest or
 * UI work — whether a per-destination rate table is worth building at all.
 *
 * READ-ONLY. It calls ONLY the calculate/shipping *preview* endpoint (the vendor
 * doc describes it as optional and non-mutating). It never touches
 * /api/local/shipments, never writes to Supabase, never writes to disk.
 *
 * Verdicts printed:
 *   (a) do the two accounts differ for the same destination?   ← the decision gate
 *   (b) does the fee depend on products[].amount (COD value)?
 *   (c) does it depend on service / quantity / paymentBy?
 *   (d) are the breakdown legs stable per account?
 *   (e) are service ids portable between the two accounts?
 *
 * Usage (loads app env for Supabase + ENCRYPTION_KEY):
 *   npx tsx --env-file=.env.local scripts/probe-darb-shipping-rates.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/probe-darb-shipping-rates.ts
 *   npx tsx --env-file=.env.local scripts/probe-darb-shipping-rates.ts --only=a,b
 *   npx tsx --env-file=.env.local scripts/probe-darb-shipping-rates.ts --account=benghazi
 *   npx tsx --env-file=.env.local scripts/probe-darb-shipping-rates.ts --json
 */
import { createClient } from "@supabase/supabase-js";
import { buildConfig, type CarrierRow } from "../src/lib/carriers/dispatch";
import { DARB_ASSABIL_CITIES } from "../src/lib/carriers/darb-assabil-areas";
import type { CarrierConfig } from "../src/lib/carriers/types";

const TRIPOLI = "4f1271c8-b1f2-4836-9293-8ab3d0b18e69";
const BENGHAZI = "43077d36-3d61-40d6-ae35-59ed15cec8f7";

// ── CLI ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf("=");
  return eq === -1 ? "" : hit.slice(eq + 1);
};
const DRY_RUN = flag("dry-run") !== undefined;
const AS_JSON = flag("json") !== undefined;
const DELAY_MS = Number(flag("delay-ms") ?? 300);
const ACCOUNT_FILTER = (flag("account") ?? "both").toLowerCase();
const ONLY = (flag("only") ?? "a,b,c,d,e")
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

// ── Destinations ───────────────────────────────────────────────────────
// Read from the bundled catalogue at runtime — never hardcode an area, so a
// catalogue change cannot silently invalidate the probe.
interface Destination {
  label: string;
  city: string;
  area: string;
}

/** Pick an area of `city`: prefer `preferred` if the city actually serves it, else the nth. */
function areaOf(city: string, preferred: string | null, nth = 0): string {
  const areas = DARB_ASSABIL_CITIES[city];
  if (!areas || areas.length === 0) {
    throw new Error(`Probe destination city not in catalogue: ${city}`);
  }
  if (preferred && areas.includes(preferred)) return preferred;
  return areas[Math.min(nth, areas.length - 1)];
}

function buildDestinations(): Destination[] {
  const spec: Array<[string, string, string | null, number]> = [
    // label,        city,          preferred area,  fallback index
    ["D1 west/core", "طرابلس", "الرياضية", 0],
    ["D2 west/alt", "طرابلس", "تاجوراء", 1],
    ["D3 west", "الزاوية", null, 0],
    ["D4 centre", "مصراتة", null, 0],
    ["D5 hinge", "سرت", null, 0],
    ["D6 east/core", "بنغازي", "بنغازي", 0],
    ["D7 east/alt", "بنغازي", null, 1],
    ["D8 far east", "درنة", null, 0],
    ["D9 border", "طبرق", null, 0],
    ["D10 east", "البيضاء", "شحات", 1],
    ["D11 south", "سبها", null, 0],
    ["D12 remote", "الكفرة", "الكفرة", 0],
  ];
  return spec.map(([label, city, preferred, nth]) => ({
    label,
    city,
    area: areaOf(city, preferred, nth),
  }));
}

// ── Accounts ───────────────────────────────────────────────────────────
interface Account {
  key: "tripoli" | "benghazi";
  label: string;
  carrierId: string;
  config: CarrierConfig;
  defaultServiceId: string;
}

async function loadAccount(
  key: "tripoli" | "benghazi",
  carrierId: string,
  catalogueDefaultServiceId: string,
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
  const config = buildConfig(row);
  // Per-carrier default wins; fall back to the global darb_services default.
  // The Benghazi row currently has no default_service_id — worth knowing, since
  // the adapter reads creds.default_service_id when no service_id extra is passed.
  const credDefault = config.apiCredentials.default_service_id ?? "";
  if (!credDefault) {
    console.warn(
      `  WARN ${data.name}: no default_service_id in credentials — falling back to the darb_services catalogue default.`,
    );
  }
  return {
    key,
    label: data.name as string,
    carrierId,
    config,
    defaultServiceId: credDefault || catalogueDefaultServiceId,
  };
}

/** Catalogue service ids, and the one flagged is_default. */
async function catalogueServices(): Promise<{ ids: string[]; defaultId: string }> {
  const { data, error } = await admin
    .from("darb_services")
    .select("service_id, title, is_default")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`darb_services fetch failed: ${error.message}`);
  const rows = data ?? [];
  const ids = rows.map((r) => r.service_id as string);
  const defaultId = (rows.find((r) => r.is_default)?.service_id as string) ?? ids[0];
  if (!defaultId) throw new Error("darb_services has no rows — cannot pick a service");
  return { ids, defaultId };
}

// ── The one network call ───────────────────────────────────────────────
interface QuoteInput {
  serviceId: string;
  paymentBy: "sales" | "receiver";
  city: string;
  area: string;
  amount: number;
  quantity?: number;
  lines?: number;
}

interface QuoteResult {
  ok: boolean;
  shipping: number | null;
  currency: string | null;
  breakdown: Record<string, number> | null;
  httpStatus: number;
  message: string | null;
  ms: number;
  retryAfter: string | null;
}

function buildBody(input: QuoteInput): Record<string, unknown> {
  const lines = input.lines ?? 1;
  const products = Array.from({ length: lines }, (_, i) => ({
    // The calculate endpoint enforces a products[].title min-length; a 1-char
    // title returns a misleading 400 @ products.0.title, not a destination error.
    title: `Probe article ${i + 1}`,
    quantity: input.quantity ?? 1,
    amount: input.amount,
    currency: "lyd",
    isChargeable: input.amount > 0,
  }));
  return {
    service: input.serviceId,
    paymentBy: input.paymentBy,
    products,
    to: { countryCode: "lby", city: input.city, area: input.area },
  };
}

async function quote(config: CarrierConfig, input: QuoteInput): Promise<QuoteResult> {
  const base = (config.apiEndpoint || "https://v2.sabil.ly").replace(/\/$/, "");
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(`${base}/api/local/shipments/calculate/shipping`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `apikey ${config.apiCredentials.api_key}`,
        "X-API-VERSION": "1.0.0",
        "X-ACCOUNT-ID": config.apiCredentials.account_id,
      },
      body: JSON.stringify(buildBody(input)),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    return {
      ok: false,
      shipping: null,
      currency: null,
      breakdown: null,
      httpStatus: 0,
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

  // HTTP 200 does NOT mean success — always check body.status === true.
  const rec = (body ?? {}) as Record<string, unknown>;
  if (rec.status !== true) {
    const messages = rec.messages as Array<{ message?: string }> | undefined;
    const msg =
      messages?.[0]?.message ??
      (typeof rec.message === "string" ? rec.message : null) ??
      (typeof body === "string" ? body.slice(0, 160) : "status:false");
    return {
      ok: false,
      shipping: null,
      currency: null,
      breakdown: null,
      httpStatus: response.status,
      message: msg,
      ms,
      retryAfter,
    };
  }

  const data = (rec.data ?? {}) as Record<string, unknown>;
  const invoices = (data.invoices ?? []) as Array<Record<string, unknown>>;
  const items = (invoices[0]?.items ?? []) as Array<Record<string, unknown>>;
  const shippingItem = items.find((i) => i.type === "shipping");
  if (!shippingItem) {
    // A missing shipping line is NOT a 0 fee — report it as a failure.
    return {
      ok: false,
      shipping: null,
      currency: null,
      breakdown: null,
      httpStatus: response.status,
      message: "no shipping item in invoice",
      ms,
      retryAfter,
    };
  }
  return {
    ok: true,
    shipping: Number(shippingItem.amount),
    currency: (shippingItem.currency as string) ?? (invoices[0]?.currency as string) ?? null,
    breakdown: (shippingItem.breakdown as Record<string, number>) ?? null,
    httpStatus: response.status,
    message: null,
    ms,
    retryAfter,
  };
}

// ── Bookkeeping ────────────────────────────────────────────────────────
interface Call {
  probe: string;
  account: string;
  dest: string;
  city: string;
  area: string;
  serviceId: string;
  paymentBy: string;
  amount: number;
  quantity: number;
  lines: number;
  result: QuoteResult;
}

const calls: Call[] = [];
let planned = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run(
  probe: string,
  account: Account,
  dest: { label: string; city: string; area: string },
  input: QuoteInput,
): Promise<QuoteResult | null> {
  planned += 1;
  if (DRY_RUN) return null;
  const result = await quote(account.config, input);
  calls.push({
    probe,
    account: account.key,
    dest: dest.label,
    city: input.city,
    area: input.area,
    serviceId: input.serviceId,
    paymentBy: input.paymentBy,
    amount: input.amount,
    quantity: input.quantity ?? 1,
    lines: input.lines ?? 1,
    result,
  });
  await sleep(DELAY_MS);
  return result;
}

// ── Formatting ─────────────────────────────────────────────────────────
const EPS = 0.0005;
const fee = (r: QuoteResult | undefined): string =>
  !r ? "—" : r.ok && r.shipping != null ? r.shipping.toFixed(3) : `ERR(${r.httpStatus})`;
const legs = (r: QuoteResult | undefined): string => {
  if (!r?.ok || !r.breakdown) return "—";
  return Object.entries(r.breakdown)
    .map(([k, v]) => `${k}=${Number(v)}`)
    .join(" ");
};
const pad = (s: string, n: number): string => {
  // Arabic strings render wide in terminals; pad on visible length, good enough.
  const len = [...s].length;
  return len >= n ? s : s + " ".repeat(n - len);
};
function heading(text: string) {
  console.log(`\n${"─".repeat(78)}\n${text}\n${"─".repeat(78)}`);
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  const destinations = buildDestinations();

  console.log("Darb Assabil shipping-rate probe — READ ONLY (calculate/shipping preview)");
  console.log(`  destinations : ${destinations.length}`);
  console.log(`  probes       : ${ONLY.join(",")}`);
  console.log(`  delay        : ${DELAY_MS}ms`);
  if (DRY_RUN) console.log("  MODE         : --dry-run (no network calls)");

  const wanted: Array<["tripoli" | "benghazi", string]> =
    ACCOUNT_FILTER === "tripoli"
      ? [["tripoli", TRIPOLI]]
      : ACCOUNT_FILTER === "benghazi"
        ? [["benghazi", BENGHAZI]]
        : [
            ["tripoli", TRIPOLI],
            ["benghazi", BENGHAZI],
          ];

  const catalogue = await catalogueServices();

  const accounts: Account[] = [];
  console.log("");
  for (const [key, id] of wanted) accounts.push(await loadAccount(key, id, catalogue.defaultId));

  console.log("\nAccounts:");
  for (const a of accounts) {
    console.log(`  ${pad(a.key, 10)} ${pad(a.label, 26)} default_service=${a.defaultServiceId}`);
  }
  console.log("\nDestinations:");
  for (const d of destinations) {
    console.log(`  ${pad(d.label, 14)} ${pad(d.city, 12)} / ${d.area}`);
  }

  // ── (a) account divergence ───────────────────────────────────────────
  if (runs("a")) {
    heading("PROBE (a) — do the two accounts quote differently for the same destination?");
    for (const d of destinations) {
      for (const a of accounts) {
        await run("a", a, d, {
          serviceId: a.defaultServiceId,
          paymentBy: "sales",
          city: d.city,
          area: d.area,
          amount: 199,
        });
      }
    }
    if (!DRY_RUN) {
      console.log(
        `${pad("dest", 14)} ${pad("city/area", 26)} ${pad("tripoli", 10)} ${pad("benghazi", 10)} ${pad("Δ", 9)} legs`,
      );
      let differing = 0;
      let maxDelta = 0;
      for (const d of destinations) {
        const t = calls.find((c) => c.probe === "a" && c.account === "tripoli" && c.dest === d.label)?.result;
        const b = calls.find((c) => c.probe === "a" && c.account === "benghazi" && c.dest === d.label)?.result;
        let delta = "—";
        if (t?.ok && b?.ok && t.shipping != null && b.shipping != null) {
          const diff = t.shipping - b.shipping;
          if (Math.abs(diff) > EPS) {
            differing += 1;
            maxDelta = Math.max(maxDelta, Math.abs(diff));
          }
          delta = diff.toFixed(3);
        }
        console.log(
          `${pad(d.label, 14)} ${pad(`${d.city}/${d.area}`, 26)} ${pad(fee(t), 10)} ${pad(fee(b), 10)} ${pad(delta, 9)} T[${legs(t)}] B[${legs(b)}]`,
        );
      }
      const comparable = destinations.filter((d) => {
        const t = calls.find((c) => c.probe === "a" && c.account === "tripoli" && c.dest === d.label)?.result;
        const b = calls.find((c) => c.probe === "a" && c.account === "benghazi" && c.dest === d.label)?.result;
        return t?.ok && b?.ok;
      }).length;
      console.log(
        differing > 0
          ? `\nVERDICT (a): ACCOUNTS DIFFER on ${differing}/${comparable} comparable destinations (max Δ = ${maxDelta.toFixed(3)} LYD)`
          : `\nVERDICT (a): IDENTICAL on all ${comparable} comparable destinations → the rate table is NOT worth building; descope to historical true cost.`,
      );
    }
  }

  // ── (b) COD-value sensitivity ────────────────────────────────────────
  if (runs("b")) {
    heading("PROBE (b) — does the shipping fee depend on products[].amount (COD value)?");
    const amounts = [0, 50, 199, 500, 2000];
    const subset = destinations.filter((d) =>
      ["D1 west/core", "D5 hinge", "D6 east/core", "D12 remote"].includes(d.label),
    );
    for (const d of subset) {
      for (const a of accounts) {
        for (const amount of amounts) {
          await run("b", a, d, {
            serviceId: a.defaultServiceId,
            paymentBy: "sales",
            city: d.city,
            area: d.area,
            amount,
          });
        }
      }
    }
    if (!DRY_RUN) {
      console.log(`${pad("dest", 14)} ${pad("account", 10)} ${amounts.map((x) => pad(String(x), 10)).join("")}`);
      let dependent = false;
      for (const d of subset) {
        for (const a of accounts) {
          const row = amounts.map((amount) =>
            pad(
              fee(
                calls.find(
                  (c) => c.probe === "b" && c.account === a.key && c.dest === d.label && c.amount === amount,
                )?.result,
              ),
              10,
            ),
          );
          const vals = amounts
            .map(
              (amount) =>
                calls.find(
                  (c) => c.probe === "b" && c.account === a.key && c.dest === d.label && c.amount === amount,
                )?.result,
            )
            .filter((r) => r?.ok && r.shipping != null)
            .map((r) => r!.shipping!);
          if (vals.length > 1 && Math.max(...vals) - Math.min(...vals) > EPS) dependent = true;
          console.log(`${pad(d.label, 14)} ${pad(a.key, 10)} ${row.join("")}`);
        }
      }
      console.log(
        dependent
          ? "\nVERDICT (b): AMOUNT-DEPENDENT — the rate is not a (city, area) scalar; the table needs a quote_amount band dimension."
          : "\nVERDICT (b): AMOUNT-INVARIANT — a (city, area) scalar rate is valid.",
      );
    }
  }

  // ── (c) service / quantity / paymentBy sensitivity ───────────────────
  if (runs("c") || runs("e")) {
    heading("PROBE (c)+(e) — service / quantity / paymentBy sensitivity, and service-id portability");
    const subset = destinations.filter((d) => ["D1 west/core", "D6 east/core"].includes(d.label));
    const serviceIds = Array.from(
      new Set([...catalogue.ids, ...accounts.map((a) => a.defaultServiceId)]),
    );

    for (const d of subset) {
      for (const a of accounts) {
        for (const serviceId of serviceIds) {
          await run("c-service", a, d, {
            serviceId,
            paymentBy: "sales",
            city: d.city,
            area: d.area,
            amount: 199,
          });
        }
        for (const quantity of [1, 3]) {
          await run("c-qty", a, d, {
            serviceId: a.defaultServiceId,
            paymentBy: "sales",
            city: d.city,
            area: d.area,
            amount: 199,
            quantity,
          });
        }
        await run("c-lines", a, d, {
          serviceId: a.defaultServiceId,
          paymentBy: "sales",
          city: d.city,
          area: d.area,
          amount: 199,
          lines: 2,
        });
        for (const paymentBy of ["sales", "receiver"] as const) {
          await run("c-payment", a, d, {
            serviceId: a.defaultServiceId,
            paymentBy,
            city: d.city,
            area: d.area,
            amount: 199,
          });
        }
      }
    }

    if (!DRY_RUN) {
      if (runs("c")) {
        console.log("\nService sensitivity:");
        console.log(`${pad("dest", 14)} ${pad("account", 10)} ${serviceIds.map((s) => pad(s.slice(-6), 10)).join("")}`);
        let serviceSensitive = false;
        for (const d of subset) {
          for (const a of accounts) {
            const vals: number[] = [];
            const row = serviceIds.map((s) => {
              const r = calls.find(
                (c) => c.probe === "c-service" && c.account === a.key && c.dest === d.label && c.serviceId === s,
              )?.result;
              if (r?.ok && r.shipping != null) vals.push(r.shipping);
              return pad(fee(r), 10);
            });
            if (vals.length > 1 && Math.max(...vals) - Math.min(...vals) > EPS) serviceSensitive = true;
            console.log(`${pad(d.label, 14)} ${pad(a.key, 10)} ${row.join("")}`);
          }
        }

        const cmp = (probe: string, pick: (c: Call) => boolean) => {
          let sensitive = false;
          for (const d of subset) {
            for (const a of accounts) {
              const vals = calls
                .filter((c) => c.probe === probe && c.account === a.key && c.dest === d.label && pick(c))
                .map((c) => c.result)
                .filter((r) => r.ok && r.shipping != null)
                .map((r) => r.shipping!);
              if (vals.length > 1 && Math.max(...vals) - Math.min(...vals) > EPS) sensitive = true;
            }
          }
          return sensitive;
        };
        const qtySensitive = cmp("c-qty", () => true);
        const paymentSensitive = cmp("c-payment", () => true);

        console.log("\nQuantity / multi-line / paymentBy:");
        for (const d of subset) {
          for (const a of accounts) {
            const q1 = calls.find((c) => c.probe === "c-qty" && c.account === a.key && c.dest === d.label && c.quantity === 1)?.result;
            const q3 = calls.find((c) => c.probe === "c-qty" && c.account === a.key && c.dest === d.label && c.quantity === 3)?.result;
            const l2 = calls.find((c) => c.probe === "c-lines" && c.account === a.key && c.dest === d.label)?.result;
            const ps = calls.find((c) => c.probe === "c-payment" && c.account === a.key && c.dest === d.label && c.paymentBy === "sales")?.result;
            const pr = calls.find((c) => c.probe === "c-payment" && c.account === a.key && c.dest === d.label && c.paymentBy === "receiver")?.result;
            console.log(
              `${pad(d.label, 14)} ${pad(a.key, 10)} qty1=${pad(fee(q1), 9)} qty3=${pad(fee(q3), 9)} 2lines=${pad(fee(l2), 9)} sales=${pad(fee(ps), 9)} receiver=${fee(pr)}`,
            );
          }
        }
        console.log(`\nVERDICT (c): SERVICE-SENSITIVE: ${serviceSensitive ? "yes" : "no"}`);
        console.log(`             QUANTITY-SENSITIVE: ${qtySensitive ? "yes" : "no"}`);
        console.log(`             PAYMENTBY-SENSITIVE: ${paymentSensitive ? "yes" : "no"}`);
      }

      if (runs("e")) {
        console.log("\nService-id × account accept/reject grid:");
        console.log(`${pad("service_id", 26)} ${accounts.map((a) => pad(a.key, 12)).join("")}`);
        let portable = true;
        for (const s of serviceIds) {
          const cells = accounts.map((a) => {
            const any = calls.filter(
              (c) => c.probe === "c-service" && c.account === a.key && c.serviceId === s,
            );
            const okAny = any.some((c) => c.result.ok);
            if (any.length > 0 && !okAny) portable = false;
            return pad(any.length === 0 ? "—" : okAny ? "accept" : "REJECT", 12);
          });
          console.log(`${pad(s, 26)} ${cells.join("")}`);
        }
        console.log(
          portable
            ? "\nVERDICT (e): PORTABLE — both accounts accept the same service ids."
            : "\nVERDICT (e): NOT PORTABLE — darb_services needs a carrier_id before harvesting.",
        );
      }
    }
  }

  // ── (d) breakdown shape ──────────────────────────────────────────────
  if (runs("d") && !DRY_RUN) {
    heading("PROBE (d) — breakdown leg shape and stability");
    const keys = new Set<string>();
    for (const c of calls) {
      if (c.result.breakdown) for (const k of Object.keys(c.result.breakdown)) keys.add(k);
    }
    console.log(`Observed legs: ${[...keys].join(", ") || "(none)"}`);
    for (const a of accounts) {
      for (const k of keys) {
        const vals = calls
          .filter((c) => c.account === a.key && c.result.breakdown && k in c.result.breakdown)
          .map((c) => Number(c.result.breakdown![k]));
        if (vals.length === 0) continue;
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        console.log(
          `  ${pad(a.key, 10)} ${pad(k, 16)} ${max - min > EPS ? `VARIES ${min} … ${max}` : `constant ${min}`} (n=${vals.length})`,
        );
      }
    }
    console.log(
      "\nVERDICT (d): see above — a leg that VARIES by destination is the per-destination signal.",
    );
  }

  // ── Failures + latency ───────────────────────────────────────────────
  if (!DRY_RUN) {
    const failures = calls.filter((c) => !c.result.ok);
    heading(`FAILURES — ${failures.length} of ${calls.length} calls`);
    for (const f of failures.slice(0, 40)) {
      console.log(
        `  ${pad(f.probe, 11)} ${pad(f.account, 10)} ${pad(`${f.city}/${f.area}`, 26)} svc=${f.serviceId.slice(-6)} http=${f.result.httpStatus} :: ${f.result.message}`,
      );
    }
    if (failures.length > 40) console.log(`  … and ${failures.length - 40} more`);

    const times = calls.map((c) => c.result.ms).sort((a, b) => a - b);
    const pct = (p: number) => (times.length ? times[Math.min(times.length - 1, Math.floor(times.length * p))] : 0);
    const throttled = calls.filter((c) => c.result.httpStatus === 429 || c.result.retryAfter);
    heading("LATENCY");
    console.log(`  calls=${calls.length}  p50=${pct(0.5)}ms  p95=${pct(0.95)}ms  max=${times[times.length - 1] ?? 0}ms`);
    console.log(
      throttled.length
        ? `  THROTTLING OBSERVED on ${throttled.length} calls (429 / Retry-After) → cap harvest concurrency.`
        : `  No 429 / Retry-After seen at ${DELAY_MS}ms spacing.`,
    );

    if (AS_JSON) {
      heading("RAW");
      console.log(JSON.stringify(calls, null, 2));
    }
  } else {
    console.log(`\nDRY RUN: ${planned} calls would be made (~${Math.round((planned * DELAY_MS) / 1000)}s at ${DELAY_MS}ms spacing).`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
