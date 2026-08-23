/**
 * Darb Assabil — binding a pre-printed sticker to a shipment.
 *
 * This is step 5 of `docs/darb-warehouse-workflow.md`, the moment a parcel
 * becomes routable: the sticker number replaces the temporary `SH…` reference
 * and Darb starts tracking the parcel by it. Until now the OMS recorded the
 * number on our side only, so the operator still had to redo the scan in Darb's
 * own app — which was the whole thing this was meant to remove.
 *
 * TWO IDENTIFIERS, ONE OF WHICH WE OFTEN LACK. `PATCH /shipments/reference/:id`
 * is keyed on Darb's internal `_id`, not the `SH…` reference we store. Only 84
 * of the 407 Libyan orders on the bench carry that id in `carrier_extra`, so a
 * lookup usually has to happen first. It is worth making: the same response
 * carries `toBranchGroup`, which is what decides the roll colour.
 *
 * NEITHER FUNCTION THROWS. A carrier being unreachable is an ordinary outcome
 * at a packing bench, and the route needs to turn it into a message an operator
 * can act on rather than a 500.
 */

import type { CarrierConfig } from "./types";
import { darbFetch, darbUrl } from "./darb-assabil-http";

export interface DarbShipmentLookup {
  /** Darb's internal `_id` — the only key the reference endpoint accepts. */
  internalId: string;
  /** The reference Darb currently holds, which may already be a sticker. */
  reference: string | null;
  /** Destination branch, and therefore the sticker-roll colour. */
  branchGroup: string | null;
  rawStatus: string | null;
}

export interface DarbBindResult {
  ok: boolean;
  /** Darb's own wording on refusal — better than anything we could invent. */
  message: string | null;
}

type Rec = Record<string, unknown>;
const asRecord = (value: unknown): Rec =>
  value && typeof value === "object" ? (value as Rec) : {};
const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

function vendorMessage(body: unknown): string | null {
  const b = asRecord(body);
  const messages = b.messages as Array<{ message?: string }> | undefined;
  return str(messages?.[0]?.message) ?? str(b.message);
}

/**
 * Read a shipment out of a list response. The single-shipment GET returns a
 * list shape too, so `data.results[0]` is right either way.
 *
 * No `_id` means no hit even when a record came back: without it the shipment
 * cannot be addressed, so reporting it found would only defer the failure.
 */
export function parseShipmentLookup(body: unknown): DarbShipmentLookup | null {
  const b = asRecord(body);
  // HTTP 200 does not mean success — the envelope decides.
  if (b.status !== true) return null;

  const results = asRecord(b.data).results;
  const first = Array.isArray(results) ? asRecord(results[0]) : null;
  if (!first) return null;

  const internalId = str(first._id);
  if (!internalId) return null;

  return {
    internalId,
    reference: str(first.reference),
    branchGroup: str(first.toBranchGroup),
    rawStatus: str(first.status),
  };
}

/** Turn a PATCH response into a verdict, keeping Darb's message on refusal. */
export function parseBindResponse(httpStatus: number, body: unknown): DarbBindResult {
  const b = asRecord(body);
  if (httpStatus === 200 && b.status === true) return { ok: true, message: null };
  return {
    ok: false,
    message: vendorMessage(body) ?? `Darb a refusé la liaison (HTTP ${httpStatus})`,
  };
}

/**
 * Find a shipment by the reference we hold, returning its internal id and its
 * destination branch.
 *
 * Single-value params only. Darb rejects a comma-separated filter with HTTP 400
 * and — far worse — silently honours only the LAST value of a repeated one,
 * returning confidently wrong data. See `docs/darb-assabil-sync.md` §1.
 */
export async function resolveDarbShipment(
  reference: string | null | undefined,
  config: CarrierConfig,
): Promise<DarbShipmentLookup | null> {
  const ref = (reference ?? "").trim();
  if (!ref) return null;

  const params = new URLSearchParams({ reference: ref, limit: "1", offset: "0" });
  const response = await darbFetch(darbUrl(config, `/api/local/shipments?${params}`), config, {
    method: "GET",
  });
  if (!response.ok) return null;

  return parseShipmentLookup(response.body);
}

/**
 * Bind a sticker number to a shipment. Idempotent by nature: re-sending the
 * same number rebinds identically, and sending a different one replaces it —
 * which is what makes a mis-scan fixable (workflow rule 6) and what makes it
 * safe to call this BEFORE committing anything on our side.
 */
export async function bindDarbReference(
  internalId: string,
  sticker: string,
  config: CarrierConfig,
): Promise<DarbBindResult> {
  const id = (internalId ?? "").trim();
  const reference = (sticker ?? "").trim();
  if (!id) return { ok: false, message: "Aucun identifiant d'expédition Darb" };
  if (!reference) return { ok: false, message: "Aucun numéro de sticker" };

  const response = await darbFetch(
    darbUrl(config, `/api/local/shipments/reference/${encodeURIComponent(id)}`),
    config,
    { method: "PATCH", body: JSON.stringify({ reference }) },
  );

  if (!response.ok) {
    return { ok: false, message: response.error };
  }
  return parseBindResponse(response.status, response.body);
}
