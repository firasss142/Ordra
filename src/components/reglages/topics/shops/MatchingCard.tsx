"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Check, Info, Package, Search } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import type { MarketCode } from "@/lib/markets";
import { suggestMatch, type MatchCandidate, type MatchSuggestion } from "@/lib/reglages/match-suggest";
import { Drawer, Mark } from "../../kit/parts";
import { RgButton } from "../../kit/RgButton";
import type { ShopRow } from "./common";

interface UnmatchedOrder {
  id: string;
  created_at: string;
  storefront_id: string;
  product_name: string;
  external_variant_id: string | null;
  external_product_id: string | null;
  customer_city: string | null;
}
type Kind = "products" | "cities";
/** One received name and the orders waiting on it. */
interface Group {
  key: string;
  name: string;
  orderIds: string[];
  oldest: string;
  /** Products only. */
  storefront_id?: string;
  external_variant_id?: string;
  external_product_id?: string | null;
}
type Option = MatchCandidate & { sub?: string; /** Products only: Ordra's product photo. */ image?: string | null };

/** A product photo, or a neutral parcel when it has none. */
function Thumb({ src, large = false }: { src?: string | null; large?: boolean }) {
  return (
    <span className={`rg-thumb${large ? " lg" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- no images.remotePatterns configured */}
      {src ? <img src={src} alt="" loading="lazy" /> : <Package aria-hidden />}
    </span>
  );
}

/** A name waiting more than this many days is drawn in amber. */
const OLD_DAYS = 14;
/** Parallel binds when one click releases many orders (cities bind per order). */
const CONCURRENCY = 6;

async function runLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<boolean>): Promise<number> {
  let ok = 0;
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      if (await fn(item).catch(() => false)) ok += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return ok;
}

/**
 * « Produits et villes à associer » — a work list under Boutiques
 * (prototypes/reglages-v4.html). A shop sent a product or a city Ordra did not
 * recognise; the order waits here. Ordra proposes the matching name
 * (lib/reglages/match-suggest); « Associer » accepts it, « Choisir… » opens the
 * picker, and one button accepts every identical name at once. A product is
 * matched once per shop and reference; a city is set on each waiting order.
 */
export function MatchingCard({ marketId, marketCode, shops, editable }: { marketId: string; marketCode: MarketCode | null; shops: ShopRow[]; editable: boolean }) {
  const t = useTranslations("reglages");
  const locale = useLocale();
  const toast = useToast();
  const { data: prodData, mutate: mutateProducts } = useSWR<{ data: UnmatchedOrder[] }>(`/api/mappings/unmatched?type=products&market_id=${marketId}`);
  const { data: cityData, mutate: mutateCities } = useSWR<{ data: UnmatchedOrder[] }>(`/api/mappings/unmatched?type=cities&market_id=${marketId}`);
  const [tab, setTab] = useState<Kind | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState<Group | null>(null);
  const [busy, setBusy] = useState(false);

  const products = useMemo(() => group(prodData?.data, (o) => (o.external_variant_id ? `${o.storefront_id}:${o.external_variant_id}` : null), (o) => o.product_name), [prodData]);
  const cities = useMemo(() => group(cityData?.data, (o) => (o.customer_city ? o.customer_city : null), (o) => o.customer_city ?? ""), [cityData]);

  // Candidates are only loaded when something waits on them.
  const { data: productList } = useSWR<{ data: { id: string; name: string; sku?: string | null; image_url?: string | null }[] }>(products.length ? `/api/products?market_id=${marketId}` : null);
  const { data: destList } = useSWR<{ data: { id: string | number; city?: string; area?: string; name?: string; name_ar?: string | null }[] }>(
    cities.length ? `/api/mappings/cities?market_id=${marketId}` : null,
  );
  const productOptions: Option[] = useMemo(() => (productList?.data ?? []).map((p) => ({ id: p.id, label: p.name, sub: p.sku ?? undefined, image: p.image_url ?? null })), [productList]);
  const cityOptions: Option[] = useMemo(
    () =>
      (destList?.data ?? []).map((d) => ({
        id: String(d.id),
        label: d.city ? (d.area ? `${d.city} — ${d.area}` : d.city) : d.name ?? "",
        alt: d.name_ar ?? null,
        sub: d.name_ar ?? undefined,
      })),
    [destList],
  );

  if (!prodData || !cityData) return null;

  const kind: Kind = tab ?? (products.length || !cities.length ? "products" : "cities");
  const rows = kind === "products" ? products : cities;
  const options = kind === "products" ? productOptions : cityOptions;
  const suggestion = (g: Group): (MatchSuggestion & { label: string; image?: string | null }) | null => {
    const s = suggestMatch(g.name, options);
    const o = s && options.find((x) => x.id === s.id);
    return s && o ? { ...s, label: o.label, image: o.image } : null;
  };
  const suggestions = new Map(rows.map((g) => [g.key, suggestion(g)]));
  const same = rows.filter((g) => suggestions.get(g.key)?.confidence === "same");
  const sameOrders = same.reduce((n, g) => n + g.orderIds.length, 0);
  const waiting = rows.reduce((n, g) => n + g.orderIds.length, 0);
  const oldest = rows.reduce<string | null>((m, g) => (!m || g.oldest < m ? g.oldest : m), null);
  const most = Math.max(1, ...rows.map((g) => g.orderIds.length));
  const shopOf = (id?: string) => shops.find((s) => s.id === id);
  const pending = (n: number) => (n === 1 ? t("matching.pendingOne") : t("matching.pendingMany", { n }));

  const now = Date.now();
  const ageDays = (iso: string) => Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  const loc = locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR";
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return new Intl.DateTimeFormat(loc, { day: "numeric", month: "short", ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}) }).format(d);
  };
  const fmtAgo = (iso: string) => {
    const days = ageDays(iso);
    const rtf = new Intl.RelativeTimeFormat(loc, { numeric: "auto" });
    if (days < 1) return rtf.format(0, "day");
    if (days < 30) return rtf.format(-days, "day");
    if (days < 365) return rtf.format(-Math.floor(days / 30), "month");
    return rtf.format(-Math.floor(days / 365), "year");
  };

  /** Bind every order of `g` to `optionId`; true when all of them took. */
  const bindOne = async (k: Kind, g: Group, optionId: string): Promise<boolean> => {
    if (k === "products") {
      const res = await fetch("/api/mappings/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storefront_id: g.storefront_id, external_variant_id: g.external_variant_id, external_product_id: g.external_product_id, product_id: optionId }),
      });
      return res.ok;
    }
    const field = marketCode === "ly" ? "darb_destination_id" : "city_id";
    const value = marketCode === "ly" ? Number(optionId) : optionId;
    const ok = await runLimited(g.orderIds, CONCURRENCY, async (orderId) =>
      (await fetch("/api/mappings/cities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId, [field]: value }),
      })).ok,
    );
    return ok === g.orderIds.length;
  };

  /** Bind several groups, each to its own option; one toast for the lot. */
  const bindMany = async (pairs: { g: Group; optionId: string }[]) => {
    if (!pairs.length) return true;
    setBusy(true);
    try {
      const k = kind;
      const ok = await runLimited(pairs, k === "products" ? CONCURRENCY : 1, ({ g, optionId }) => bindOne(k, g, optionId));
      await (k === "products" ? mutateProducts() : mutateCities());
      setSelected(new Set());
      if (ok === pairs.length) toast.show({ message: pairs.length === 1 ? t("matching.done") : t("matching.doneMany", { n: ok }), tone: "info" });
      else toast.show({ message: t("matching.partial", { ok, n: pairs.length }), tone: "critical" });
      return ok === pairs.length;
    } finally {
      setBusy(false);
    }
  };
  const accept = (gs: Group[]) =>
    bindMany(gs.flatMap((g) => {
      const s = suggestions.get(g.key);
      return s ? [{ g, optionId: s.id }] : [];
    }));

  const switchTab = (k: Kind) => {
    setTab(k);
    setSelected(new Set());
  };
  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const tabs = (
    <div role="tablist" aria-label={t("matching.title")} className="rg-segc">
      {(["products", "cities"] as const).map((k) => (
        <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => switchTab(k)}>
          {t(`matching.${k}`)}
          <span className="n num">{(k === "products" ? products : cities).length}</span>
        </button>
      ))}
    </div>
  );

  if (!products.length && !cities.length) {
    return (
      <section className="rg-card" aria-label={t("matching.title")}>
        <div className="rg-mdone">
          <span className="okc">
            <Check aria-hidden />
          </span>
          <div>
            <b>{t("matching.allMatched")}</b>
            <small>{t("matching.allMatchedSub")}</small>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rg-card rg-match" aria-label={t("matching.title")}>
      <header>
        <div className="min-w-0 flex-1">
          <h3>{t("matching.title")}</h3>
          <p>{t("matching.desc")}</p>
        </div>
        <div className="flex-none">{tabs}</div>
      </header>

      {rows.length === 0 ? (
        <div className="rg-mdone border-t border-line-subtle">
          <span className="okc">
            <Check aria-hidden />
          </span>
          <div>
            <b>{t("matching.allMatched")}</b>
            <small>{t(kind === "products" ? "matching.noProduct" : "matching.noCity")}</small>
          </div>
        </div>
      ) : (
        <>
          <div className="rg-mhead">
            <span className="big num">{waiting}</span>
            <div className="txt">
              {t(kind === "products" ? "matching.waitProducts" : "matching.waitCities", { n: waiting })}
              {oldest && (
                <small>
                  {t("matching.oldest")} <span className={ageDays(oldest) > OLD_DAYS ? "old" : undefined}>{fmtDate(oldest)}</span>
                </small>
              )}
            </div>
            {editable && same.length > 0 && (
              <RgButton variant="primary" size="sm" disabled={busy} onClick={() => void accept(same)}>
                <Check aria-hidden />
                {t("matching.acceptSame", { n: same.length, orders: sameOrders })}
              </RgButton>
            )}
          </div>

          <table>
            <colgroup>
              {editable && <col style={{ width: 48 }} />}
              <col />
              <col style={{ width: 92 }} />
              <col className="hide-sm" style={{ width: 104 }} />
              <col className="hide-sm" style={{ width: 236 }} />
              {editable && <col style={{ width: 186 }} />}
            </colgroup>
            <thead>
              <tr>
                {editable && <th className="rg-th" aria-label={t("matching.select")} />}
                <th className="rg-th">{t("matching.colReceived")}</th>
                <th className="rg-th text-end">{t("matching.colOrders")}</th>
                <th className="rg-th hide-sm">{t("matching.colSince")}</th>
                <th className="rg-th hide-sm">{t("matching.colProposal")}</th>
                {editable && <th className="rg-th" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => {
                const s = suggestions.get(g.key) ?? null;
                const on = selected.has(g.key);
                const shop = shopOf(g.storefront_id);
                const old = ageDays(g.oldest) > OLD_DAYS;
                return (
                  <tr key={g.key} className={on ? "rg-sel" : undefined}>
                    {editable && (
                      <td className="rg-td">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          aria-label={t("matching.selectOne", { name: g.name })}
                          disabled={!s || busy}
                          className="rg-cb"
                          onClick={() => toggle(g.key)}
                        >
                          {on && <Check aria-hidden />}
                        </button>
                      </td>
                    )}
                    <td className="rg-td">
                      <div className="rg-recv">
                        {kind === "products" && (
                          <Mark size={26} src={shop?.logo_url}>
                            {(shop?.name ?? "?").slice(0, 1).toUpperCase()}
                          </Mark>
                        )}
                        <div>
                          <b title={g.name}>{g.name}</b>
                          {kind === "products" && (
                            <small>
                              {shop?.name ?? "—"} · {t("matching.ref", { ref: g.external_variant_id ?? "" })}
                            </small>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="rg-td">
                      <div className="rg-bar">
                        <span className="bt" aria-hidden>
                          <i style={{ width: `${Math.max(8, (g.orderIds.length / most) * 100)}%`, ...(old ? { ["--c" as string]: "#F2B562" } : {}) }} />
                        </span>
                        <b>{g.orderIds.length}</b>
                      </div>
                    </td>
                    <td className="rg-td hide-sm">
                      <div className={`rg-age${old ? " old" : ""}`}>
                        {fmtDate(g.oldest)}
                        <small>{fmtAgo(g.oldest)}</small>
                      </div>
                    </td>
                    <td className="rg-td hide-sm">
                      {s ? (
                        <div className="rg-prop">
                          <ArrowRight aria-hidden />
                          {kind === "products" && <Thumb src={s.image} />}
                          <div>
                            <b title={s.label}>{s.label}</b>
                            <span className={`rg-conf ${s.confidence}`}>
                              {s.confidence === "same" && <Check aria-hidden />}
                              {t(s.confidence === "same" ? "matching.same" : "matching.near")}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <span className="rg-prop none">{t("matching.noProposal")}</span>
                      )}
                    </td>
                    {editable && (
                      <td className="rg-td">
                        <div className="rg-acts">
                          {s && (
                            <RgButton variant="soft" size="sm" disabled={busy} onClick={() => void accept([g])}>
                              {t("matching.associate")}
                            </RgButton>
                          )}
                          <RgButton variant={s ? "quiet" : "secondary"} size="sm" disabled={busy} onClick={() => setPicking(g)}>
                            {t("matching.choose")}
                          </RgButton>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {selected.size > 0 && (
        <div className="rg-bulk" role="toolbar" aria-label={t("matching.title")}>
          <span>{t("matching.selected", { n: selected.size })}</span>
          <RgButton variant="primary" size="sm" disabled={busy} onClick={() => void accept(rows.filter((g) => selected.has(g.key)))}>
            <Check aria-hidden />
            {t("matching.acceptSelected")}
          </RgButton>
          <RgButton variant="quiet" size="sm" onClick={() => setSelected(new Set())}>
            {t("common.cancel")}
          </RgButton>
        </div>
      )}

      {picking && (
        <PickerDrawer
          kind={kind}
          group={picking}
          shopName={shopOf(picking.storefront_id)?.name}
          since={fmtDate(picking.oldest)}
          pending={pending(picking.orderIds.length)}
          options={options}
          suggestion={suggestions.get(picking.key) ?? null}
          onClose={() => setPicking(null)}
          onBind={async (optionId) => {
            if (await bindMany([{ g: picking, optionId }])) setPicking(null);
          }}
        />
      )}
    </section>
  );
}

/** Group waiting orders by the name a shop sent, most orders first. */
function group(orders: UnmatchedOrder[] | undefined, keyOf: (o: UnmatchedOrder) => string | null, nameOf: (o: UnmatchedOrder) => string): Group[] {
  const map = new Map<string, Group>();
  for (const o of orders ?? []) {
    const key = keyOf(o);
    if (!key) continue;
    const g = map.get(key) ?? {
      key,
      name: nameOf(o),
      orderIds: [],
      oldest: o.created_at,
      storefront_id: o.storefront_id,
      external_variant_id: o.external_variant_id ?? undefined,
      external_product_id: o.external_product_id,
    };
    g.orderIds.push(o.id);
    if (o.created_at && o.created_at < g.oldest) g.oldest = o.created_at;
    map.set(key, g);
  }
  return Array.from(map.values()).sort((a, b) => b.orderIds.length - a.orderIds.length || a.oldest.localeCompare(b.oldest));
}

function PickerDrawer({
  kind,
  group: g,
  shopName,
  since,
  pending,
  options,
  suggestion,
  onClose,
  onBind,
}: {
  kind: Kind;
  group: Group;
  shopName?: string;
  since: string;
  pending: string;
  options: Option[];
  suggestion: MatchSuggestion | null;
  onClose: () => void;
  onBind: (optionId: string) => Promise<void>;
}) {
  const t = useTranslations("reglages");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(suggestion?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const proposed = suggestion ? options.find((o) => o.id === suggestion.id) ?? null : null;
  const needle = q.trim().toLowerCase();
  const rest = (needle ? options.filter((o) => `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(needle)) : options).filter((o) => o.id !== proposed?.id).slice(0, 60);
  const searchLabel = kind === "products" ? t("matching.searchProduct") : t("matching.searchCity");

  const opt = (o: Option) => (
    <button key={o.id} type="button" role="radio" aria-checked={picked === o.id} className={`rg-opt${kind === "products" ? " img" : ""}`} onClick={() => setPicked(o.id)}>
      {kind === "products" && <Thumb src={o.image} large />}
      <span className="min-w-0">
        <b>{o.label}</b>
        {o.sub && <small dir="auto">{o.sub}</small>}
      </span>
      <span aria-hidden className="rad" />
    </button>
  );

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={kind === "products" ? t("matching.productTitle") : t("matching.cityTitle")}
      title={`« ${g.name} »`}
      subtitle={
        <>
          {kind === "products" && (
            <span>
              {shopName ?? "—"} · {t("matching.ref", { ref: g.external_variant_id ?? "" })} ·
            </span>
          )}
          <span>
            {pending} · {t("matching.since", { date: since })}
          </span>
        </>
      }
      footer={
        <>
          {error && (
            <span role="alert" className="text-[12.5px] text-status-critical">
              {error}
            </span>
          )}
          <span className="flex-1" />
          <RgButton onClick={onClose}>{t("common.cancel")}</RgButton>
          <RgButton
            variant="primary"
            disabled={busy}
            onClick={async () => {
              if (!picked) {
                setError(t("matching.pick"));
                return;
              }
              setBusy(true);
              await onBind(picked);
              setBusy(false);
            }}
          >
            {kind === "products" ? t("matching.associate") : t("matching.bindN", { n: g.orderIds.length })}
          </RgButton>
        </>
      }
    >
      <label className="rg-search">
        <Search aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchLabel} aria-label={searchLabel} />
      </label>
      <div role="radiogroup" aria-label={searchLabel} className="flex flex-col gap-[12px]">
        {proposed && !needle && (
          <div className="rg-gl rg-opts">
            <div className="eyebrow">{t("matching.proposed")}</div>
            {opt(proposed)}
          </div>
        )}
        <div className="rg-gl rg-opts">
          <div className="eyebrow">{kind === "products" ? t("matching.allProducts") : t("matching.allDestinations")}</div>
          {rest.length === 0 ? <p className="m-0 px-[8px] py-[6px] text-[13px] text-ink-secondary">{t("matching.nothingFound")}</p> : rest.map(opt)}
        </div>
      </div>
      <div className="rg-gl rg-eff">
        <Info aria-hidden />
        <span>{kind === "products" ? t("matching.productEffect") : t("matching.cityEffect")}</span>
      </div>
    </Drawer>
  );
}
