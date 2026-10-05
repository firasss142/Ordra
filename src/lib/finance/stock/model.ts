/**
 * Stock & inventaire (prototypes/finances-stock-v1.html) — « l'argent qui dort ».
 *
 * Pure: the loader hands the market position, the per-site units and what
 * each site shipped; this file values it (purchase price), splits it per
 * warehouse, sorts it into three states and says what to rebuy.
 *
 * Value is shown AS IF RIGHT (owner's decision, against the recommendation —
 * plans/finances-redesign.md « Accepted risks »).
 */

export type Health = "good" | "warn" | "bad";

/** More days of cover than this and the stock « dort ». */
export const SLEEP_COVER_DAYS = 90;
/** No sale for this long and the stock is « à liquider ». */
export const LIQUIDATE_AFTER_DAYS = 60;
/** Rebuy when the shelf empties inside the lead time plus this margin. */
export const REBUY_MARGIN_DAYS = 14;
/** A suggested order covers the lead time plus this many days of sales. */
export const ORDER_COVER_DAYS = 45;

export interface StockInput {
  today: string;
  windowDays: number;
  leadTimeDays: number;
  sites: { id: string; name: string }[];
  products: {
    id: string;
    name: string;
    image: string | null;
    cost: number;
    price: number;
    /** market total */
    units: number;
    /** units shipped per day on the market, over the window */
    rate: number;
    daysSinceSale: number | null;
    lastCounted: string | null;
    /** units shipped per day, oldest first */
    series: number[];
  }[];
  siteUnits: { product: string; site: string; units: number }[];
  /** units each site shipped in the window — splits the market rate */
  siteShipped: { product: string; site: string; units: number }[];
  /** open purchase-order lines still expected, per site */
  onOrder: { product: string; site: string; qty: number; eta: string | null; ref: string }[];
}

export interface StockRow {
  id: string;
  name: string;
  image: string | null;
  units: number;
  value: number;
  rate: number;
  days: number | null;
  state: Health;
  daysSinceSale: number | null;
  /** already ordered for this site */
  order: { qty: number; eta: string | null; ref: string; risk: boolean } | null;
  /** suggested order */
  buy: { qty: number; cost: number } | null;
}

export interface SiteBlock {
  id: string;
  name: string;
  value: number;
  days: number | null;
  good: number;
  warn: number;
  bad: number;
  products: number;
  rebuy: StockRow[];
  sleep: StockRow[];
  all: StockRow[];
  budget: number;
}

export interface ProductSheet {
  id: string;
  name: string;
  image: string | null;
  cost: number;
  price: number;
  units: number;
  value: number;
  rate: number;
  days: number | null;
  lastCounted: string | null;
  series: number[];
  sites: { id: string | null; name: string | null; units: number; value: number; days: number | null; state: Health | null }[];
  /** the site to order for: a suggestion, else the shortest cover */
  orderSite: string | null;
}

export interface StockView {
  total: { value: number; days: number | null; sale: number; good: number; warn: number; bad: number };
  sites: SiteBlock[];
  unassigned: { value: number; products: { id: string; name: string; image: string | null; units: number; value: number; state: Health }[] };
  products: ProductSheet[];
}

export function classify(rate: number, units: number, daysSinceSale: number | null): Health {
  if (rate <= 0) return daysSinceSale != null && daysSinceSale < LIQUIDATE_AFTER_DAYS ? "warn" : "bad";
  return units / rate > SLEEP_COVER_DAYS ? "warn" : "good";
}

export function rebuyQty(rate: number, units: number, leadTimeDays: number): number {
  const need = rate * (leadTimeDays + ORDER_COVER_DAYS) - units;
  return Math.max(10, Math.ceil(need / 10) * 10);
}

const cover = (units: number, rate: number) => (rate > 0 ? Math.round(units / rate) : null);
const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
const byValue = (a: StockRow, b: StockRow) => b.value - a.value;

export function buildStockView(input: StockInput): StockView {
  const key = (p: string, s: string) => `${p}|${s}`;
  const unitsAt = new Map<string, number>();
  for (const r of input.siteUnits) unitsAt.set(key(r.product, r.site), (unitsAt.get(key(r.product, r.site)) ?? 0) + r.units);
  const shippedAt = new Map<string, number>();
  for (const r of input.siteShipped) shippedAt.set(key(r.product, r.site), (shippedAt.get(key(r.product, r.site)) ?? 0) + r.units);
  const ordered = new Map<string, StockInput["onOrder"][number]>();
  for (const o of input.onOrder) {
    const k = key(o.product, o.site);
    const prev = ordered.get(k);
    ordered.set(k, prev ? { ...prev, qty: prev.qty + o.qty, eta: [prev.eta, o.eta].filter(Boolean).sort()[0] ?? null } : o);
  }

  const rowsBySite = new Map<string, StockRow[]>(input.sites.map((s) => [s.id, []]));
  const sheets: ProductSheet[] = [];
  const unassigned: StockView["unassigned"]["products"] = [];
  let perDayValue = 0;
  let sale = 0;

  for (const p of input.products) {
    perDayValue += p.rate * p.cost;
    sale += p.units * p.price;
    const placed = input.sites.map((s) => unitsAt.get(key(p.id, s.id)) ?? 0);
    const shipped = input.sites.map((s) => shippedAt.get(key(p.id, s.id)) ?? 0);
    const shippedSum = shipped.reduce((a, b) => a + b, 0);
    const placedSum = placed.reduce((a, b) => a + b, 0);
    const sheetSites: ProductSheet["sites"] = [];

    input.sites.forEach((s, i) => {
      const units = placed[i];
      // the market rate, split by what each site shipped (else by what it holds)
      const share = shippedSum > 0 ? shipped[i] / shippedSum : placedSum > 0 ? units / placedSum : 0;
      const rate = p.rate * share;
      if (units <= 0 && rate <= 0) return;
      const state = classify(rate, units, p.daysSinceSale);
      const days = cover(units, rate);
      const o = ordered.get(key(p.id, s.id));
      const runsShort = state === "good" && days != null && days <= input.leadTimeDays + REBUY_MARGIN_DAYS;
      const row: StockRow = {
        id: p.id,
        name: p.name,
        image: p.image,
        units,
        value: units * p.cost,
        rate,
        days,
        state,
        daysSinceSale: p.daysSinceSale,
        order: o ? { qty: o.qty, eta: o.eta, ref: o.ref, risk: days != null && o.eta != null && days < dayDiff(input.today, o.eta) } : null,
        buy: runsShort && !o ? { qty: rebuyQty(rate, units, input.leadTimeDays), cost: rebuyQty(rate, units, input.leadTimeDays) * p.cost } : null,
      };
      rowsBySite.get(s.id)!.push(row);
      sheetSites.push({ id: s.id, name: s.name, units, value: row.value, days, state });
    });

    const rest = Math.max(0, p.units - placedSum);
    if (rest > 0) {
      const state = classify(p.rate, p.units, p.daysSinceSale);
      unassigned.push({ id: p.id, name: p.name, image: p.image, units: rest, value: rest * p.cost, state });
      sheetSites.push({ id: null, name: null, units: rest, value: rest * p.cost, days: null, state: null });
    }

    const own = [...rowsBySite.values()].flat().filter((r) => r.id === p.id);
    const suggested = own.find((r) => r.buy);
    const shortest = [...own].filter((r) => r.days != null).sort((a, b) => a.days! - b.days!)[0];
    const siteOf = (r: StockRow | undefined) => (r ? input.sites.find((s) => rowsBySite.get(s.id)!.includes(r))?.id ?? null : null);
    sheets.push({
      id: p.id,
      name: p.name,
      image: p.image,
      cost: p.cost,
      price: p.price,
      units: p.units,
      value: p.units * p.cost,
      rate: p.rate,
      days: cover(p.units, p.rate),
      lastCounted: p.lastCounted,
      series: p.series,
      sites: sheetSites,
      orderSite: siteOf(suggested) ?? siteOf(shortest) ?? input.sites[0]?.id ?? null,
    });
  }

  const sites: SiteBlock[] = input.sites.map((s) => {
    const all = rowsBySite.get(s.id)!.sort(byValue);
    const sum = (h: Health) => all.filter((r) => r.state === h).reduce((a, r) => a + r.value, 0);
    const value = all.reduce((a, r) => a + r.value, 0);
    const perDay = all.reduce((a, r) => a + r.rate * (r.units > 0 ? r.value / r.units : 0), 0);
    const rebuy = all.filter((r) => r.buy || (r.order && r.state === "good" && r.days != null && r.days <= input.leadTimeDays + REBUY_MARGIN_DAYS));
    return {
      id: s.id,
      name: s.name,
      value,
      days: perDay > 0 ? Math.round(value / perDay) : null,
      good: sum("good"),
      warn: sum("warn"),
      bad: sum("bad"),
      products: all.length,
      rebuy: rebuy.sort((a, b) => (a.days ?? 0) - (b.days ?? 0)),
      sleep: all.filter((r) => r.state !== "good"),
      all,
      budget: rebuy.reduce((a, r) => a + (r.buy?.cost ?? 0), 0),
    };
  });

  unassigned.sort((a, b) => b.value - a.value);
  const uValue = unassigned.reduce((a, r) => a + r.value, 0);
  const uSum = (h: Health) => unassigned.filter((r) => r.state === h).reduce((a, r) => a + r.value, 0);
  const good = sites.reduce((a, s) => a + s.good, 0) + uSum("good");
  const warn = sites.reduce((a, s) => a + s.warn, 0) + uSum("warn");
  const bad = sites.reduce((a, s) => a + s.bad, 0) + uSum("bad");
  const value = sites.reduce((a, s) => a + s.value, 0) + uValue;

  return {
    total: { value, days: perDayValue > 0 ? Math.round(value / perDayValue) : null, sale, good, warn, bad },
    sites,
    unassigned: { value: uValue, products: unassigned },
    products: sheets,
  };
}
