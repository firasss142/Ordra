/**
 * Probe: is our API key allowed to bind a barcode reference to a shipment?
 *
 * WHY: `PATCH /api/local/shipments/reference/:id` is the call Darb's own app makes
 * when a warehouse operator scans the sticker onto a parcel. It sets the shipment
 * reference and appends the `referenced` timeline event. Moving that scan into the
 * OMS would drop the second app from the warehouse and let us learn the real
 * carrier reference immediately instead of hours later via the sweep.
 *
 * But the endpoint appears ONLY in the vendor Postman collection — it is absent
 * from INTEGRATION_GUIDE.md, so it is undocumented and its permission model is
 * unknown. This script establishes whether the key may call it at all, BEFORE any
 * feature code is written.
 *
 * SAFETY: every PATCH targets a well-formed but NON-EXISTENT ObjectId
 * (000000000000000000000000). There is no shipment at that id, so nothing can be
 * mutated. We are reading the *shape of the refusal*, not changing state:
 *
 *   404 / status:false "not found"  → key is permitted   → build it
 *   401 / 403                       → key lacks scope    → STOP, ask Darb
 *   200                             → alarming           → investigate
 *
 * It also probes whether an arbitrary string is accepted or references are
 * validated, by sending a nonsense code and a plausible one and comparing the
 * refusals. A validation error that fires BEFORE the not-found error tells us the
 * reference is checked server-side — which is the safer world to be in.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/probe-darb-reference-permission.ts
 */
import { createClient } from "@supabase/supabase-js";
import { buildConfig, type CarrierRow } from "../src/lib/carriers/dispatch";
import type { CarrierConfig } from "../src/lib/carriers/types";

/** Valid 24-hex ObjectId that cannot exist — all zeroes. */
const NONEXISTENT_ID = "000000000000000000000000";

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

interface Probe {
  label: string;
  httpStatus: number;
  envelopeOk: boolean | null;
  message: string | null;
  raw: string;
}

async function call(
  config: CarrierConfig,
  method: "GET" | "PATCH",
  path: string,
  body?: unknown,
): Promise<Probe & { label: string }> {
  const base = (config.apiEndpoint || "https://v2.sabil.ly").replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `apikey ${config.apiCredentials.api_key}`,
        "X-API-VERSION": "1.0.0",
        "X-ACCOUNT-ID": config.apiCredentials.account_id,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return {
      label: "",
      httpStatus: 0,
      envelopeOk: null,
      message: e instanceof Error ? e.message : "transport failure",
      raw: "",
    };
  }
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* non-JSON body — keep raw */
  }
  const messages = parsed.messages as Array<{ message?: string }> | undefined;
  return {
    label: "",
    httpStatus: res.status,
    envelopeOk: typeof parsed.status === "boolean" ? (parsed.status as boolean) : null,
    message:
      messages?.[0]?.message ??
      (typeof parsed.message === "string" ? parsed.message : null),
    raw: text.slice(0, 300),
  };
}

function verdict(p: Probe): string {
  if (p.httpStatus === 401 || p.httpStatus === 403) {
    return "DENIED — key lacks the scope. STOP: ask Darb to enable it.";
  }
  if (p.httpStatus === 200 && p.envelopeOk === true) {
    return "UNEXPECTED 200 on a non-existent id — investigate before any real test.";
  }
  if (p.httpStatus === 404 || p.envelopeOk === false) {
    return "PERMITTED — endpoint reachable, refused only because the id does not exist.";
  }
  return `Unclear (HTTP ${p.httpStatus}).`;
}

async function main() {
  console.log("Darb reference-binding permission probe");
  console.log(`  target id: ${NONEXISTENT_ID} (valid format, cannot exist)`);
  console.log("  NOTHING can be mutated — we are reading the shape of the refusal.\n");

  const { data, error } = await admin
    .from("carriers")
    .select("id, name, code, api_endpoint, api_credentials, delivery_fee, return_fee")
    .eq("code", "darb_assabil")
    .eq("is_active", true);
  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    let config: CarrierConfig;
    try {
      config = buildConfig(row as unknown as CarrierRow);
    } catch (e) {
      console.log(`  ${row.name}: credentials unusable — ${(e as Error).message}\n`);
      continue;
    }
    console.log(`── ${row.name} ${"─".repeat(Math.max(0, 50 - String(row.name).length))}`);

    // Baseline: what does a plain not-found look like on a KNOWN-GOOD endpoint?
    const baseline = await call(config, "GET", `/api/local/shipments/${NONEXISTENT_ID}`);
    console.log(
      `  GET  shipments/:id      → http=${baseline.httpStatus} envelope=${baseline.envelopeOk} ${baseline.message ?? ""}`,
    );

    // The question: is PATCH reference/:id permitted at all?
    const plausible = await call(
      config,
      "PATCH",
      `/api/local/shipments/reference/${NONEXISTENT_ID}`,
      { reference: "1609999" },
    );
    console.log(
      `  PATCH reference (valid-looking code) → http=${plausible.httpStatus} envelope=${plausible.envelopeOk}`,
    );
    console.log(`         message: ${plausible.message ?? "(none)"}`);
    console.log(`         raw    : ${plausible.raw}`);

    // Does it validate the reference, or accept any string? A validation error
    // firing before the not-found error means references are checked server-side.
    const nonsense = await call(
      config,
      "PATCH",
      `/api/local/shipments/reference/${NONEXISTENT_ID}`,
      { reference: "!!! not a sticker !!!" },
    );
    console.log(
      `  PATCH reference (nonsense code)      → http=${nonsense.httpStatus} envelope=${nonsense.envelopeOk}`,
    );
    console.log(`         message: ${nonsense.message ?? "(none)"}`);

    console.log(`\n  VERDICT: ${verdict(plausible)}`);
    if (plausible.message !== nonsense.message) {
      console.log(
        "  NOTE: the two codes produced DIFFERENT refusals → the reference itself is validated.",
      );
    } else {
      console.log(
        "  NOTE: identical refusals → cannot tell yet whether the reference is validated.",
      );
    }
    console.log("");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
