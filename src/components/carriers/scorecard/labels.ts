import type { ScorecardCarrier } from "@/lib/carriers/scorecard/types";
import { carrierTitle } from "@/lib/carriers/scorecard/view-model";

type T = (key: string, values?: Record<string, string | number>) => string;

const BRANDS = new Set(["darb_assabil", "navex", "dexpress", "cosmos"]);

/** « Darb Assabil » under a Darb account's city; « Toute la Tunisie » under a national carrier. */
export function carrierSubtitle(c: Pick<ScorecardCarrier, "code" | "account_label">, marketCode: string, t: T): string {
  if (c.account_label && BRANDS.has(c.code)) return t(`brand.${c.code}`);
  if (marketCode === "ly" || marketCode === "tn") return t(`national.${marketCode}`);
  return "";
}

/** The name in « rendus par Darb », « Copier pour Darb », « Encore chez Navex ». */
export function carrierShort(c: Pick<ScorecardCarrier, "code" | "name" | "account_label">, locale: string, t: T): string {
  if (c.code === "darb_assabil") return t("brandShort.darb_assabil");
  return carrierTitle(c, locale);
}
