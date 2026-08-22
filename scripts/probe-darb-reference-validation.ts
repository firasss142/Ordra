/**
 * Probe: does Darb validate that a barcode reference belongs to our own sticker stock?
 *
 * WHY: binding a sticker from the OMS (PATCH /api/local/shipments/reference/:id) is
 * confirmed working. The remaining unknown is whether Darb checks the number against
 * the account's allocated rolls. That answer decides how much guarding the OMS needs:
 *   - validated server-side  → a typo simply fails, we can trust the carrier
 *   - NOT validated          → a typo silently binds a number that may belong to
 *                              another merchant, so the OMS must constrain input itself
 *
 * Uses a number confirmed to be ~2.4M away from any block this account has ever used,
 * and resolving to nothing in either account. Reverts immediately either way.
 */
import { createClient } from "@supabase/supabase-js";
import { buildConfig, type CarrierRow } from "../src/lib/carriers/dispatch";
import type { CarrierConfig } from "../src/lib/carriers/types";

const STICKER = process.env.PROBE_REF ?? "4443873";
const TARGET_REF = process.env.PROBE_TARGET ?? "SH2057999";

const hdrs = (c: CarrierConfig) => ({
  "Content-Type": "application/json",
  Authorization: `apikey ${c.apiCredentials.api_key}`,
  "X-API-VERSION": "1.0.0",
  "X-ACCOUNT-ID": c.apiCredentials.account_id,
});
const base = (c: CarrierConfig) => (c.apiEndpoint || "https://v2.sabil.ly").replace(/\/$/, "");

async function getById(c: CarrierConfig, id: string) {
  const r = await fetch(`${base(c)}/api/local/shipments/${id}`, { headers: hdrs(c) });
  const b: any = await r.json().catch(() => ({}));
  return b?.data?.results?.[0] ?? null;
}
async function setRef(c: CarrierConfig, id: string, reference: string) {
  const r = await fetch(`${base(c)}/api/local/shipments/reference/${id}`, {
    method: "PATCH", headers: hdrs(c), body: JSON.stringify({ reference }),
  });
  const t = await r.text(); let b: any = {}; try { b = JSON.parse(t); } catch {}
  return { http: r.status, ok: b?.status === true, msg: b?.messages?.[0]?.message ?? null, raw: t.slice(0, 200) };
}

async function main() {
  console.log(`Darb reference-validation probe\n  ${STICKER} → ${TARGET_REF}\n`);
  const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: ship } = await a.from("darb_shipments").select("darb_id,carrier_id").eq("reference", TARGET_REF).single();
  if (!ship) throw new Error(`target ${TARGET_REF} not in mirror`);
  const { data: row } = await a.from("carriers").select("id,name,code,api_endpoint,api_credentials,delivery_fee,return_fee").eq("id", ship.carrier_id).single();
  const c = buildConfig(row as unknown as CarrierRow);
  const id = ship.darb_id as string;

  const before = await getById(c, id);
  const tlB = (before?.timeline ?? []).length;
  console.log(`1. BEFORE reference=${before?.reference} status=${before?.status} timeline=${tlB}`);

  const bind = await setRef(c, id, STICKER);
  console.log(`\n2. PATCH → ${STICKER}: http=${bind.http} status=${bind.ok} ${bind.msg ?? ""}`);
  if (!bind.ok) console.log(`   raw: ${bind.raw}`);

  const after = await getById(c, id);
  console.log(`\n3. AFTER  reference=${after?.reference} timeline=${(after?.timeline ?? []).length} (+${(after?.timeline ?? []).length - tlB})`);
  const accepted = after?.reference === STICKER;
  console.log(`\n   >>> ${accepted ? "ACCEPTED — Darb does NOT validate sticker ownership" : "REJECTED — Darb validates the number"} <<<`);

  if (accepted) {
    console.log(`\n4. REVERTING → ${TARGET_REF}`);
    const rev = await setRef(c, id, TARGET_REF);
    const fin = await getById(c, id);
    console.log(`   http=${rev.http} status=${rev.ok} → reference now ${fin?.reference}`);
    console.log(`   ${fin?.reference === TARGET_REF ? "reverted cleanly" : "*** REVERT FAILED — MANUAL FIX NEEDED ***"}`);
  } else {
    console.log("   (nothing changed — no revert needed)");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
