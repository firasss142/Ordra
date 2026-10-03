/**
 * Telling two accounts of the same carrier apart.
 *
 * Libya runs two Darb Assabil accounts as two `carriers` rows sharing
 * `code = 'darb_assabil'` and differing by `name` and warehouse — see
 * 20260816000003_carriers_unique_per_account.sql. `getCarrierLogo` keys on the
 * code, so both render the identical PNG.
 *
 * Since 2026-10-03 an account is named by its warehouse CITY in its own colour
 * (`carriers.accent_color`): a full band on Transporteurs, a solid pill in the
 * agent queue. The thin hashed ring this file used to compute was not readable
 * (owner, 2026-10-03) and is gone. Colour is never the only signal — the city
 * is written in the pill.
 *
 * Only codes listed here are multi-account. A carrier with one account needs
 * no city: naming it would be decoration.
 */

const MULTI_ACCOUNT_CODES = new Set(["darb_assabil"]);

export function isMultiAccountCarrier(code: string | null | undefined): boolean {
  return !!code && MULTI_ACCOUNT_CODES.has(code);
}
