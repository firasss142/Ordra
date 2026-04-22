type MarketCode = "tn" | "ly";
type Locale = "fr" | "ar";
type Direction = "ltr" | "rtl";

export function getLocaleForMarket(market: MarketCode | null): Locale {
  if (market === "ly") return "ar";
  return "fr";
}

export function getDirectionForLocale(locale: Locale): Direction {
  return locale === "ar" ? "rtl" : "ltr";
}
