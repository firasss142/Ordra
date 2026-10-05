"use client";

// One calm line of filters (prototype `filterLine` / `menuHTML` / `chipsRow`):
// Statut · Agent · Boutique · Plus de filtres, every value with what picking it
// would return, then the active filters as chips with « Tout effacer ».

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { presentStatus } from "@/lib/orders/status-presentation";
import { NONE, UNASSIGNED, type ClearableFilterKey, type OrderListFilters } from "@/lib/orders/list-filters";
import type { OrderStatus } from "@/types/order-status";
import type { FacetCounts } from "@/app/api/orders/facet-counts/route";
import type { Fmt } from "@/components/performance/orders/ui";
import { Avatar, FreeAvatar, Ic, Thumb, platformWords, storeVars, type StoreInfo } from "./ui";

export const CALL_STATUSES = ["pending", "attempt_1", "attempt_2", "attempt_3", "callback_scheduled", "confirmed", "dispatch_scheduled", "rejected", "cancelled"] as const;
const DELIVERY_STATUSES = ["uploaded", "scanned", "at_carrier", "dispatched", "deposit", "in_transit", "out_for_delivery", "delivery_delayed", "delivered", "returning", "to_be_returned", "received", "returned"] as const;
/** Tunisia's words and the rare ones show only when an order carries them. */
const ONLY_WHEN_PRESENT = new Set(["dispatched", "deposit", "received"]);
export const OUTCOME_STATUSES = ["delivered", "returned", "rejected", "cancelled"] as const;

export interface Agent {
  id: string;
  full_name: string;
  is_active?: boolean;
}
export interface Named {
  id: string;
  name: string;
  image_url?: string | null;
}

type MenuKey = "st" | "ag" | "sh" | "more";

interface Props {
  filters: OrderListFilters;
  update: (patch: Partial<OrderListFilters>) => void;
  counts: FacetCounts | undefined;
  total: number | null;
  agents: Agent[];
  stores: StoreInfo[];
  products: Named[];
  carriers: Named[];
  cities: string[];
  f: Fmt;
  statusLabel: (s: string) => string;
  onGotoDeleted?: () => void;
}

export function FilterLine(p: Props) {
  const t = useTranslations("commandes.filters");
  const [menu, setMenu] = useState<MenuKey | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { filters: fl } = p;
  const archive = fl.scope === "archive";
  const deletedTab = archive && fl.archiveTab === "deleted";

  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  const toggle = (key: "statuses" | "agentIds" | "storefrontIds" | "cities" | "productIds" | "carrierIds", v: string) => {
    const cur = fl[key] as string[];
    p.update({ [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] } as Partial<OrderListFilters>);
  };
  const n = (bucket: keyof FacetCounts, k: string) => p.counts?.[bucket]?.[k] ?? 0;

  const mi = (key: Parameters<typeof toggle>[0], v: string, on: boolean, label: ReactNode, count: number, lead?: ReactNode) => (
    <button key={`${key}:${v}`} type="button" className={`mi${on ? " on" : ""}${count ? "" : " zero"}`} role="menuitemcheckbox" aria-checked={on} onClick={() => toggle(key, v)}>
      <span className="cb">{on && <Ic n="check" />}</span>
      {lead}
      <span className="ml">{label}</span>
      <span className="n">{p.f.n(count)}</span>
    </button>
  );

  const statusItem = (s: string) =>
    mi("statuses", s, fl.statuses.includes(s as OrderStatus), p.statusLabel(s), n("statuses", s), <span className={`dotk h-${presentStatus(s).hue}`} />);

  const menus: Record<MenuKey, () => ReactNode> = {
    st: () =>
      archive ? (
        <div className="menu" role="menu">{OUTCOME_STATUSES.map(statusItem)}</div>
      ) : (
        <div className="menu" role="menu">
          <h6>{t("confirmation")}</h6>
          {CALL_STATUSES.map(statusItem)}
          <h6>{t("delivery")}</h6>
          {DELIVERY_STATUSES.filter((s) => !ONLY_WHEN_PRESENT.has(s) || n("statuses", s) > 0 || fl.statuses.includes(s as OrderStatus)).map(statusItem)}
        </div>
      ),
    ag: () => (
      <div className="menu" role="menu">
        {!archive && mi("agentIds", UNASSIGNED, fl.agentIds.includes(UNASSIGNED), <i className="none">{t("unassigned")}</i>, n("agents", UNASSIGNED), <FreeAvatar />)}
        {p.agents.map((a) => mi("agentIds", a.id, fl.agentIds.includes(a.id), a.full_name, n("agents", a.id), <Avatar id={a.id} name={a.full_name} />))}
      </div>
    ),
    sh: () => (
      <div className="menu" role="menu">
        {p.stores.map((s) =>
          mi(
            "storefrontIds",
            s.id,
            fl.storefrontIds.includes(s.id),
            <>
              {s.name} <span className="q">· {platformWords(s)}</span>
            </>,
            n("storefronts", s.id),
            <span className="shop" style={storeVars(s)}>
              <i />
            </span>,
          ),
        )}
      </div>
    ),
    more: () => {
      const cities = [...new Set([...p.cities, ...fl.cities.filter((c) => c !== NONE)])]
        .filter((c) => n("cities", c) > 0 || fl.cities.includes(c))
        .sort((a, b) => n("cities", b) - n("cities", a));
      const products = [...p.products].sort((a, b) => n("products", b.id) - n("products", a.id));
      return (
        <div className="menu" role="menu">
          <h6>{t("city")}</h6>
          {cities.map((c) => mi("cities", c, fl.cities.includes(c), <span dir="auto">{c}</span>, n("cities", c)))}
          {mi("cities", NONE, fl.cities.includes(NONE), <span className="miss">{t("noCity")}</span>, n("cities", NONE))}
          <h6>{t("product")}</h6>
          {products.map((pr) => mi("productIds", pr.id, fl.productIds.includes(pr.id), <span dir="auto">{pr.name}</span>, n("products", pr.id), <Thumb src={pr.image_url} seed={pr.id} size={22} />))}
          <h6>{t("carrier")}</h6>
          {p.carriers.map((c) => mi("carrierIds", c.id, fl.carrierIds.includes(c.id), c.name, n("carriers", c.id)))}
          {mi("carrierIds", NONE, fl.carrierIds.includes(NONE), t("notSent"), n("carriers", NONE))}
          {!archive && p.onGotoDeleted && (
            <>
              <div className="msep" />
              <button type="button" className="mi act" onClick={p.onGotoDeleted}>
                <Ic n="trash" />
                <span className="ml">{t("deletedLink")}</span>
                <Ic n="ext" className="flip" />
              </button>
            </>
          )}
        </div>
      );
    },
  };

  const fb = (k: MenuKey, icon: string, label: string, cnt: number) => (
    <div className="fbw" key={k}>
      <button type="button" className={`fb${cnt ? " on" : ""}${menu === k ? " open" : ""}`} aria-haspopup="menu" aria-expanded={menu === k} onClick={() => setMenu(menu === k ? null : k)}>
        <Ic n={icon} />
        {label}
        {cnt > 0 && <em>{cnt}</em>}
        <Ic n="down" className="chev" />
      </button>
      {menu === k && menus[k]()}
    </div>
  );

  return (
    <div className="fl" ref={ref}>
      {!deletedTab && fb("st", "filter", archive ? t("outcome") : t("status"), fl.statuses.length)}
      {fb("ag", "user", t("agent"), fl.agentIds.length)}
      {fb("sh", "store", t("store"), fl.storefrontIds.length)}
      {fb("more", "sliders", t("more"), fl.cities.length + fl.productIds.length + fl.carrierIds.length)}
      <span className="count">{p.total == null ? t("loading") : t.rich("count", { n: p.total, b: () => <b>{p.f.n(p.total ?? 0)}</b> })}</span>
    </div>
  );
}

// ── chips ───────────────────────────────────────────────────────────────────

interface ChipsProps {
  filters: OrderListFilters;
  tileLabel: string | null;
  dateLabel: string | null;
  statusLabel: (s: string) => string;
  agentName: (id: string) => string;
  storeName: (id: string) => string;
  productName: (id: string) => string;
  carrierName: (id: string) => string;
  onClear: (key: ClearableFilterKey) => void;
  onClearAll: () => void;
}

export function Chips(p: ChipsProps) {
  const t = useTranslations("commandes.chips");
  const fl = p.filters;
  const archive = fl.scope === "archive";
  const list = (vals: string[], name: (v: string) => string) => {
    const a = vals.map(name);
    return a.length > 3 ? `${a.slice(0, 3).join(", ")} ${t("more", { n: a.length - 3 })}` : a.join(", ");
  };
  const chips: [ClearableFilterKey, string, string][] = [];
  if (p.tileLabel) chips.push(["preset", t("tile"), p.tileLabel]);
  if (fl.q.trim()) chips.push(["q", t("q"), `« ${fl.q.trim()} »`]);
  if (p.dateLabel) chips.push(["date", t("dates"), p.dateLabel]);
  if (fl.statuses.length) chips.push(["statuses", archive ? t("outcome") : t("status"), list(fl.statuses, p.statusLabel)]);
  if (fl.agentIds.length) chips.push(["agentIds", t("agent"), list(fl.agentIds, p.agentName)]);
  if (fl.storefrontIds.length) chips.push(["storefrontIds", t("store"), list(fl.storefrontIds, p.storeName)]);
  if (fl.cities.length) chips.push(["cities", t("city"), list(fl.cities, (v) => (v === NONE ? t("noCity") : v))]);
  if (fl.productIds.length) chips.push(["productIds", t("product"), list(fl.productIds, p.productName)]);
  if (fl.carrierIds.length) chips.push(["carrierIds", t("carrier"), list(fl.carrierIds, (v) => (v === NONE ? t("notSent") : p.carrierName(v)))]);
  if (!chips.length) return null;
  return (
    <div className="chips">
      {chips.map(([k, a, b]) => (
        <span className="chip" key={k}>
          {a} : <b>{b}</b>
          <button type="button" aria-label={t("remove", { what: a })} onClick={() => p.onClear(k)}>
            <Ic n="x" />
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <button type="button" className="clearall" onClick={p.onClearAll}>
          {t("clearAll")}
        </button>
      )}
    </div>
  );
}
