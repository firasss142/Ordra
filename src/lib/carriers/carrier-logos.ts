/**
 * Carrier brand logos, keyed by the carrier `code` column. Assets live in
 * /public. A carrier without an entry has no logo yet — callers fall back to a
 * neutral text chip. Since 2026-10-05 an account can carry its own uploaded
 * `carriers.logo_url`, which wins — it is how Darb Tripoli and Darb Benghazi,
 * one code, can look different. This map is the brand fallback.
 */
export const CARRIER_LOGOS: Record<string, string> = {
  navex: "/navex-logo.png",
  dexpress: "/dexpress-logo.png",
  darb_assabil: "/darb-assabil-logo.png",
  xdelivery: "/xdelivery-logo.jpeg",
};

export function getCarrierLogo(code: string | null | undefined, uploaded?: string | null): string | null {
  if (uploaded) return uploaded;
  if (!code) return null;
  return CARRIER_LOGOS[code] ?? null;
}
