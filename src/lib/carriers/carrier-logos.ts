/**
 * Carrier brand logos, keyed by the carrier `code` column. Assets live in
 * /public. A carrier without an entry has no logo yet — callers fall back to a
 * neutral text chip. (Carriers have no logo column in the DB; this static map is
 * the source of truth, matching the convention in CarrierHealthBadge.)
 */
export const CARRIER_LOGOS: Record<string, string> = {
  navex: "/navex-logo.png",
  dexpress: "/dexpress-logo.png",
  darb_assabil: "/darb-assabil-logo.png",
};

export function getCarrierLogo(code: string | null | undefined): string | null {
  if (!code) return null;
  return CARRIER_LOGOS[code] ?? null;
}
