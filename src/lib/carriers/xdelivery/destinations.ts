/**
 * Where an X-Delivery parcel goes: governorate + delegation, in THEIR spelling.
 *
 * Tunisian orders carry a governorate only (`customer_city`), never a
 * delegation. The agent may pick one at upload; when they do not, Ordra sends
 * the governorate's main town (owner decision, 2026-10-05). That is safe
 * because X-Delivery routes to a depot by governorate alone — each of the 24
 * maps to exactly one of their 9 depots — so only the driver's local run
 * depends on the delegation, and he has the address.
 *
 * A delegation from ANOTHER governorate is refused rather than corrected: it
 * would send the parcel to the wrong depot.
 */

import { resolveGovernorate } from "../governorates";
import { XDELIVERY_DELEGATIONS } from "./catalogue";

/**
 * The main-town delegation per governorate. Where the town is split
 * Nord/Sud/Est/Ouest the choice only affects the driver's run, never the depot.
 */
export const DEFAULT_DELEGATION: Readonly<Record<string, string>> = {
  Ariana: "Ariana Ville",
  Beja: "Beja Nord",
  "Ben Arous": "Ben Arous",
  Bizerte: "Bizerte Nord",
  Gabes: "Gabes Medina",
  Gafsa: "Gafsa Nord",
  Jendouba: "Jendouba",
  Kairouan: "Kairouan Nord",
  Kasserine: "Kasserine Nord",
  Kebili: "Kebili Nord",
  Kef: "Le Kef Est",
  Mahdia: "Mahdia",
  Mannouba: "Mannouba",
  Medenine: "Medenine Nord",
  Monastir: "Monastir",
  Nabeul: "Nabeul",
  Sfax: "Sfax Ville",
  "Sidi Bouzid": "Sidi Bouzid Ouest",
  Siliana: "Siliana Nord",
  Sousse: "Sousse Ville",
  Tataouine: "Tataouine Nord",
  Tozeur: "Tozeur",
  Tunis: "Tunis Ville",
  Zaghouan: "Zaghouan",
};

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Ordra's spellings that X-Delivery writes differently. */
const ALIASES: Readonly<Record<string, string>> = {
  manouba: "Mannouba",
  "le kef": "Kef",
};

const GOVERNORATE_BY_FOLD: ReadonlyMap<string, string> = new Map(
  Object.keys(XDELIVERY_DELEGATIONS).map((g) => [fold(g), g]),
);

/** Any spelling of a governorate (or a city Ordra knows) → X-Delivery's governorate name. */
export function toXDeliveryGovernorate(input: string | null | undefined): string | null {
  if (!input?.trim()) return null;
  const direct = fold(input);
  const hit = ALIASES[direct] ?? GOVERNORATE_BY_FOLD.get(direct);
  if (hit) return hit;
  const viaOrdra = resolveGovernorate(input);
  if (!viaOrdra) return null;
  const folded = fold(viaOrdra);
  return ALIASES[folded] ?? GOVERNORATE_BY_FOLD.get(folded) ?? null;
}

export type XDeliveryDestination =
  | { ok: true; governorate: string; delegation: string; defaulted: boolean }
  | { ok: false; reason: "unknown_governorate" | "delegation_not_in_governorate" };

export function resolveXDeliveryDestination(input: {
  customerCity: string | null | undefined;
  /** The agent's governorate pick, when the order's city is wrong or missing. */
  governorate?: string | null;
  /** The agent's delegation pick; empty means "use the default". */
  delegation?: string | null;
}): XDeliveryDestination {
  const governorate =
    toXDeliveryGovernorate(input.governorate) ?? toXDeliveryGovernorate(input.customerCity);
  if (!governorate) return { ok: false, reason: "unknown_governorate" };

  const picked = input.delegation?.trim();
  if (!picked) {
    return { ok: true, governorate, delegation: DEFAULT_DELEGATION[governorate], defaulted: true };
  }

  const wanted = fold(picked);
  const match = XDELIVERY_DELEGATIONS[governorate].find((d) => fold(d) === wanted);
  if (!match) return { ok: false, reason: "delegation_not_in_governorate" };
  return { ok: true, governorate, delegation: match, defaulted: false };
}

/**
 * X-Delivery's own form accepts exactly 8 digits. Strips spaces, dashes and
 * the 216 / +216 / 00216 country prefix.
 */
export function normalizeTunisianPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("00216")) digits = digits.slice(5);
  else if (digits.length === 11 && digits.startsWith("216")) digits = digits.slice(3);
  return digits.length === 8 ? digits : null;
}
