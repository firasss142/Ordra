/**
 * Telling two accounts of the same carrier apart.
 *
 * Libya runs two Darb Assabil accounts as two `carriers` rows sharing
 * `code = 'darb_assabil'` and differing only by `name` — see
 * 20260816000003_carriers_unique_per_account.sql. `getCarrierLogo` keys on the
 * code, so both rendered the identical PNG and an agent scanning the list could
 * not tell a Tripoli shipment from a Benghazi one.
 *
 * The fix is a ring tinted per account. That is colour carrying something which
 * is **not** status, which §1 rule 3 forbids — it is a named exception in §4.18,
 * allowed because two identical 20px wordmarks are not separable either. The
 * condition is that colour is never the only signal: callers must keep the
 * account name in `title` and the city in `aria-label`.
 *
 * Only codes listed here get a ring. A carrier with one account needs no
 * disambiguation, and ringing it would be decoration.
 */

const MULTI_ACCOUNT_CODES = new Set(["darb_assabil"]);

export function isMultiAccountCarrier(code: string | null | undefined): boolean {
  return !!code && MULTI_ACCOUNT_CODES.has(code);
}

/**
 * A stable colour for a carrier account, or null when the carrier has only one
 * account and therefore nothing to disambiguate.
 *
 * Keyed on `carrier_id`, not on `carrier_name`: the name is an editable display
 * string, and a mark that changes when somebody fixes a typo is not a mark.
 *
 * Hues are drawn from a list that deliberately avoids every status band — amber
 * 45, red 12, green 165, teal 187, violet 250 — so an account mark can never be
 * misread as an order state. A full 360° circle was tried first and handed
 * Benghazi hue 356, which is red.
 *
 * **Known limit.** Distinctness is by hash, not by construction, so a future
 * third account could collide with an existing one. The robust fix is to pass
 * each account's index within its code group down from the server, which knows
 * the siblings; that is worth doing if a carrier ever runs more than a handful
 * of accounts. The test asserts the two accounts that exist today differ.
 */
const SAFE_HUES = [212, 305, 95, 272] as const;

export function carrierAccountRing(
  code: string | null | undefined,
  carrierId: string | null | undefined,
): string | null {
  if (!isMultiAccountCarrier(code) || !carrierId) return null;

  // FNV-1a: better avalanche than `hash * 31`, which clusters badly on UUIDs
  // because they share long runs of hex characters.
  let hash = 0x811c9dc5;
  for (let i = 0; i < carrierId.length; i++) {
    hash ^= carrierId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `hsl(${SAFE_HUES[hash % SAFE_HUES.length]} 58% 45%)`;
}
