"use client";

// Finances › Stock & inventaire — prototypes/finances-stock-v1.html.
//
// The money asleep in stock and what to rebuy: a hero for the market, one
// block per warehouse, the « pas encore dans un entrepôt » line, a product
// drawer. Every figure comes computed from GET /api/finance/stock.

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Clock, Download, Info, MapPin, Moon, ShoppingCart, Store, Warehouse } from "lucide-react";
import { jsonFetcher } from "@/lib/fetchers";
import type { Health, ProductSheet, SiteBlock, StockRow } from "@/lib/finance/stock/model";
import type { StockPageData } from "@/lib/finance/stock/load";
import { Drawer, DrawerClose, Money, makeFmt, useTip, type Fmt, type Loc } from "../kit/ui";
import "../kit/finance-kit.css";
import "./stock.css";

type View = StockPageData & { currency: string };
type T = ReturnType<typeof useTranslations>;
const WINDOWS = [7, 28, 90] as const;
const SEV: Health[] = ["good", "warn", "bad"];
/** rows per list before « + N autres » — the page stays short whatever the catalogue */
const CAP = 5;
const b = (c: ReactNode) => <b>{c}</b>;
const em = (c: ReactNode) => <em>{c}</em>;
const pct = (a: number, total: number) => (total > 0 ? Math.round((a / total) * 100) : 0);

function dateLabel(loc: Loc, iso: string, withYear = false) {
  return new Intl.DateTimeFormat(loc === "ar" ? "ar-LY-u-nu-latn" : "fr-FR", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(
    new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso),
  );
}
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const initials = (name: string) => name.replace(/[^\p{L}\p{N} ]/gu, "").trim().slice(0, 2);

function Thumb({ name, image, sm }: { name: string; image: string | null; sm?: boolean }) {
  return (
    <i className={`pg${sm ? " sm" : ""}`} aria-hidden>
      {image ? <img src={image} alt="" /> : initials(name)}
    </i>
  );
}

export function StockPage({ marketId, marketName, locale }: { marketId: string | null; marketName: string; locale: string }) {
  const t = useTranslations("financeStock");
  const loc: Loc = locale === "ar" ? "ar" : "fr";
  const sp = useSearchParams();
  const tip = useTip();
  const initialWin = Number(sp.get("win"));
  const [win, setWin] = useState<number>(WINDOWS.includes(initialWin as 7) ? initialWin : 28);
  const [open, setOpen] = useState<string | null>(sp.get("p"));
  const [hl, setHl] = useState<Record<string, Health | undefined>>({});

  const { data, error } = useSWR<View>(marketId ? `/api/finance/stock?market_id=${marketId}&window=${win}` : null, jsonFetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
  });
  const f = useMemo(() => makeFmt(loc, data?.currency ?? "LYD"), [loc, data?.currency]);

  const setWindow = (w: number) => {
    setWin(w);
    const q = new URLSearchParams(window.location.search);
    q.set("win", String(w));
    window.history.replaceState(null, "", `${window.location.pathname}?${q}`);
  };
  const openProduct = useCallback((id: string | null) => {
    setOpen(id);
    const q = new URLSearchParams(window.location.search);
    if (id) q.set("p", id);
    else q.delete("p");
    window.history.replaceState(null, "", `${window.location.pathname}${q.size ? `?${q}` : ""}`);
  }, []);

  const exportCsv = useCallback(() => {
    if (!data) return;
    const lines = [t("csvHead")];
    for (const s of data.sites) for (const r of s.all) lines.push([r.name, s.name, r.units, r.value, r.days ?? "", t(`sev.${r.state}.w`)].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(","));
    for (const r of data.unassigned.products) lines.push([r.name, t("unassigned"), r.units, r.value, "", t(`sev.${r.state}.w`)].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([`﻿${lines.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `stock-${data.today}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [data, t]);

  const sheet = data && open ? data.products.find((p) => p.id === open) ?? null : null;
  const buyHref = (site: string, product: string, qty?: number) =>
    `/${locale}/finance/purchases?new=po&site=${site}&product=${product}${qty ? `&qty=${qty}` : ""}`;

  return (
    <div className="fin" onMouseOver={tip.onOver} onMouseMove={tip.onMove} onMouseLeave={tip.onLeave}>
      <div className="page">
        <header className="ph rise" style={{ ["--d" as string]: 0 }}>
          <div>
            <div className="crumb">
              {t("crumb")} <ChevronRight className="ic" aria-hidden /> {t("title")}
            </div>
            <h1>{t("title")}</h1>
            <div className="sub">
              {marketName} <span className="sep" /> {t("sub")}
              {data && (
                <span className="chip">
                  <Clock className="ic" aria-hidden />
                  {t("chip", { day: dateLabel(loc, data.today) })}
                </span>
              )}
            </div>
          </div>
          {marketId && (
            <div className="ph-r">
              <div className="acts">
                <div className="seg" role="tablist" aria-label={t("sales")}>
                  <span>{t("sales")}</span>
                  {WINDOWS.map((w) => (
                    <button key={w} type="button" role="tab" aria-selected={w === win} className={w === win ? "on" : ""} onClick={() => setWindow(w)}>
                      {t("win", { n: w })}
                    </button>
                  ))}
                </div>
                <button className="btn2" type="button" data-tip={t("exportTip")} onClick={exportCsv} disabled={!data}>
                  <Download className="ic" aria-hidden />
                  {t("export")}
                </button>
              </div>
              <div className="cmp">{t("cmp", { n: win })}</div>
            </div>
          )}
        </header>

        {!marketId && (
          <section className="card" style={{ padding: "40px 32px", textAlign: "center", display: "grid", gap: 8 }}>
            <b style={{ fontSize: 17 }}>{t("chooseTitle")}</b>
            <p style={{ color: "var(--ink-3)" }}>{t("chooseText")}</p>
          </section>
        )}
        {marketId && error && <div className="err">{t("error")}</div>}
        {marketId && !data && !error && (
          <>
            <div className="sk" style={{ height: 300 }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div className="sk" style={{ height: 520 }} />
              <div className="sk" style={{ height: 520 }} />
            </div>
          </>
        )}

        {data && data.total.value === 0 && data.sites.every((s) => !s.all.length) && <p className="empty">{t("empty")}</p>}
        {data && (data.total.value > 0 || data.sites.some((s) => s.all.length)) && (
          <>
            <Hero data={data} f={f} t={t} hl={hl.hero} setHl={(h) => setHl((x) => ({ ...x, hero: h }))} />
            <div className="sites">
              {data.sites.map((s, i) => (
                <Site
                  key={s.id}
                  s={s}
                  i={i}
                  total={data.total.value}
                  f={f}
                  t={t}
                  loc={loc}
                  today={data.today}
                  hl={hl[s.id]}
                  setHl={(h) => setHl((x) => ({ ...x, [s.id]: h }))}
                  onOpen={openProduct}
                  buyHref={buyHref}
                />
              ))}
            </div>
            {data.unassigned.value > 0 && (
              <div className="card unas rise" style={{ ["--d" as string]: 4 }}>
                <span className="hold"><MapPin className="ic" aria-hidden /></span>
                <span className="pgs">
                  {data.unassigned.products.slice(0, 6).map((p) => (
                    <span key={p.id} role="button" tabIndex={0} data-tip={`${p.name} · ${f.n(p.units)} u · ${f.money(p.value)}`} onClick={() => openProduct(p.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && openProduct(p.id)}>
                      <Thumb name={p.name} image={p.image} />
                    </span>
                  ))}
                  {data.unassigned.products.length > 6 && <i className="pg">+{data.unassigned.products.length - 6}</i>}
                </span>
                <p className="t">{t.rich("unasLine", { b, v: f.money(data.unassigned.value), n: f.n(data.unassigned.products.length) })}</p>
                <a className="link" href={`/${locale}/warehouse/stock`}>
                  {t("count")}
                  <ChevronRight className="ic" aria-hidden />
                </a>
              </div>
            )}
            <p className="foot rise" style={{ ["--d" as string]: 5 }}>
              <Info className="ic" aria-hidden />
              <span>
                {t.rich("foot", { b, n: data.windowDays })}{" "}
                <a className="link" href={`/${locale}/finance/purchases`}>
                  {t("toPurchases")}
                  <ChevronRight className="ic" aria-hidden />
                </a>
              </span>
            </p>
          </>
        )}
      </div>

      <Drawer open={!!sheet} onClose={() => openProduct(null)} hue="#667085" labelledBy="stock-dr-title" closeLabel={t("close")}>
        {sheet && data && <ProductDrawer p={sheet} data={data} f={f} t={t} loc={loc} locale={locale} onClose={() => openProduct(null)} buyHref={buyHref} />}
      </Drawer>
      <div className="tip" ref={tip.ref} role="tooltip" />
    </div>
  );
}

function HealthBar({ v, f, t, sm }: { v: { good: number; warn: number; bad: number; value: number }; f: Fmt; t: T; sm?: boolean }) {
  return (
    <div className={`hbar${sm ? " sm" : ""}`} role="img" aria-label={SEV.map((k) => `${t(`sev.${k}.w`)} ${f.money(v[k])}`).join(", ")}>
      {SEV.map((k, i) =>
        v[k] > 0 ? (
          <i
            key={k}
            className={`h-${k}`}
            style={{ flex: v[k], animationDelay: `${200 + i * 90}ms` }}
            data-tip={t("sevTip", { t: t(`sev.${k}.t`), v: f.money(v[k]), p: pct(v[k], v.value), s: t(`sev.${k}.s`) })}
          />
        ) : null,
      )}
    </div>
  );
}

function HealthLegend({ v, f, t, sm, setHl }: { v: { good: number; warn: number; bad: number; value: number }; f: Fmt; t: T; sm?: boolean; setHl: (h: Health | undefined) => void }) {
  return (
    <div className={`hlg${sm ? " sm" : ""}`} onMouseLeave={() => setHl(undefined)}>
      {SEV.map((k) => (
        <button key={k} type="button" className={`h-${k}`} onMouseEnter={() => setHl(k)} onFocus={() => setHl(k)} onBlur={() => setHl(undefined)}>
          <span className="lw"><i className="hdot" />{t(`sev.${k}.t`)}</span>
          <b><Money f={f} v={v[k]} /></b>
          <small>{t("sevShare", { p: pct(v[k], v.value) })}</small>
        </button>
      ))}
    </div>
  );
}

function Hero({ data, f, t, hl, setHl }: { data: View; f: Fmt; t: T; hl: Health | undefined; setHl: (h: Health | undefined) => void }) {
  const m = data.total;
  const asleep = m.warn + m.bad;
  const roundK = (v: number) => (v >= 10000 ? Math.round(v / 1000) * 1000 : Math.round(v / 10) * 10);
  return (
    <section className="card hero rise" style={{ ["--d" as string]: 1 }} aria-label={t("eyebrow")}>
      <div>
        <div className="eyebrow">{t("eyebrow")}</div>
        <div className="hero-n"><Money f={f} v={m.value} /></div>
        <div className="hero-st">
          <span className="pill"><Clock className="ic" aria-hidden />{m.days != null ? t("daysPill", { n: f.n(m.days) }) : t("noDays")}</span>
          {m.sale > 0 && (
            <span className="pill" data-tip={t("saleTip")}><Store className="ic" aria-hidden />{t("salePill", { v: f.money(roundK(m.sale)) })}</span>
          )}
        </div>
        <div className="glass wh">
          {data.sites.map((s) => (
            <div className="wh-r" key={s.id}>
              <span>{s.name}</span>
              <span className="wh-bar"><i style={{ ["--w" as string]: `${pct(s.value, m.value)}%` }} data-tip={t("whTip", { name: s.name, v: f.money(s.value), p: pct(s.value, m.value) })} /></span>
              <b><Money f={f} v={s.value} /></b>
            </div>
          ))}
          {data.unassigned.value > 0 && (
            <div className="wh-r un">
              <span>{t("unassigned")}</span>
              <span className="wh-bar"><i style={{ ["--w" as string]: `${pct(data.unassigned.value, m.value)}%` }} data-tip={t("unasTip", { v: f.money(data.unassigned.value) })} /></span>
              <b><Money f={f} v={data.unassigned.value} /></b>
            </div>
          )}
        </div>
      </div>
      <div data-hl={hl}>
        <div className="eyebrow">{t("eyebrow2")}</div>
        <h2 className="hero-hl">{asleep > 0 ? t.rich("hl", { em, v: f.money(asleep) }) : t("hlNone")}</h2>
        {asleep > 0 && <p className="hero-q">{t("hlQ", { p: pct(asleep, m.value) })}</p>}
        <HealthBar v={m} f={f} t={t} />
        <HealthLegend v={m} f={f} t={t} setHl={setHl} />
      </div>
    </section>
  );
}

function Site({ s, i, total, f, t, loc, today, hl, setHl, onOpen, buyHref }: {
  s: SiteBlock; i: number; total: number; f: Fmt; t: T; loc: Loc; today: string;
  hl: Health | undefined; setHl: (h: Health | undefined) => void; onOpen: (id: string) => void;
  buyHref: (site: string, product: string, qty?: number) => string;
}) {
  const [all, setAll] = useState(false);
  const toOrder = s.rebuy.filter((r) => r.buy);
  const row = (r: StockRow, children: ReactNode, meta: ReactNode) => (
    <div className="pr2" key={r.id} role="button" tabIndex={0} onClick={(e) => !(e.target as Element).closest("a") && onOpen(r.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen(r.id)}>
      <Thumb name={r.name} image={r.image} />
      <span className="pr2-t"><b>{r.name}</b>{meta}</span>
      <span className="pr2-a">{children}</span>
    </div>
  );
  const rebuyRow = (r: StockRow) => {
    const meta = (
      <small>
        <span>{r.units <= 0 ? t("outHere") : t("daysLeft", { n: f.n(r.days ?? 0) })}</span>
        <span className="sep" />
        <span>{t("perDay", { r: f.n(r.rate, 1) })}</span>
      </small>
    );
    const act = r.order ? (
      <>
        <span className="ordered"><Check className="ic" aria-hidden />{r.order.eta ? t("ordered", { q: f.n(r.order.qty), eta: dateLabel(loc, r.order.eta) }) : t("orderedNoEta", { q: f.n(r.order.qty) })}</span>
        {r.order.risk && r.days != null && (
          <span className="wtag" data-tip={t("riskTip", { u: f.n(r.units), r: f.n(r.rate, 1), ref: r.order.ref })}>
            <AlertTriangle className="ic" aria-hidden />
            {t("risk", { date: dateLabel(loc, addDays(today, r.days)) })}
          </span>
        )}
      </>
    ) : r.buy ? (
      <a className="btn sm" href={buyHref(s.id, r.id, r.buy.qty)} data-tip={t("buyTip", { q: f.n(r.buy.qty), cost: f.money(r.value / Math.max(r.units, 1)) })}>
        <ShoppingCart className="ic" aria-hidden />
        {t("buy", { q: f.n(r.buy.qty), v: f.money(r.buy.cost) })}
      </a>
    ) : null;
    return row(r, act, meta);
  };
  const sleepRow = (r: StockRow) => {
    const line =
      r.rate <= 0
        ? r.daysSinceSale == null ? t("neverSold") : t("noSaleFor", { d: f.n(r.daysSinceSale) })
        : r.daysSinceSale != null && r.daysSinceSale >= 7
          ? t("lastSale", { d: f.n(r.daysSinceSale), r: f.n(r.rate, 1) })
          : t("slow", { r: f.n(r.rate, 1), d: f.n(r.days ?? 0) });
    return row(
      r,
      <>
        <b><Money f={f} v={r.value} /></b>
        <span className={`stag h-${r.state}`}><i className="hdot" />{t(`sev.${r.state}.w`)}</span>
      </>,
      <small><span>{line}</span></small>,
    );
  };

  return (
    <section className="card site rise" style={{ ["--d" as string]: 2 + i }} aria-labelledby={`site-${s.id}`} data-hl={hl}>
      <div className="site-h">
        <span className="hold"><Warehouse className="ic" aria-hidden /></span>
        <div>
          <h2 id={`site-${s.id}`}>{s.name}</h2>
          <p>{t("siteSub", { n: f.n(s.products) })}</p>
        </div>
        <span className="chip share" data-tip={t("siteShareTip", { name: s.name, v: f.money(s.value), total: f.money(total) })}>{t("siteShare", { p: pct(s.value, total) })}</span>
      </div>
      {s.all.length === 0 ? (
        <p className="empty" style={{ marginTop: 16 }}>{t("siteEmpty")}</p>
      ) : (
        <>
          <div className="site-n">
            <b><Money f={f} v={s.value} /></b>
            {s.days != null && <span className="pill"><Clock className="ic" aria-hidden />{t("daysPill", { n: f.n(s.days) })}</span>}
          </div>
          <HealthBar v={s} f={f} t={t} sm />
          <HealthLegend v={s} f={f} t={t} sm setHl={setHl} />
          <div className="glass blk">
            <div className="blk-h">
              <span className="eyebrow"><ShoppingCart className="ic" aria-hidden />{t("rebuy")}</span>
              {toOrder.length ? (
                <span className="meta">{t("rebuyMeta", { n: f.n(toOrder.length), v: f.money(s.budget) })}</span>
              ) : (
                <span className="blk-ok"><Check className="ic" aria-hidden />{t("rebuyOk")}</span>
              )}
            </div>
            {s.rebuy.slice(0, CAP).map(rebuyRow)}
            {s.rebuy.length > CAP && (
              <button className="pr2 rest" type="button" onClick={() => setAll(true)}>
                {t("moreRows", { n: s.rebuy.length - CAP })}
              </button>
            )}
          </div>
          <div className="glass blk">
            <div className="blk-h">
              <span className="eyebrow"><Moon className="ic" aria-hidden />{t("sleep")}</span>
              {s.sleep.length ? (
                <span className="meta">{t("sleepMeta", { v: f.money(s.warn + s.bad) })}</span>
              ) : (
                <span className="blk-ok"><Check className="ic" aria-hidden />{t("sleepNone")}</span>
              )}
            </div>
            {s.sleep.slice(0, CAP).map(sleepRow)}
            {s.sleep.length > CAP && (
              <button className="pr2 rest" type="button" onClick={() => setAll(true)}>
                {t("moreRowsValue", { n: s.sleep.length - CAP, v: f.money(s.sleep.slice(CAP).reduce((a, r) => a + r.value, 0)) })}
              </button>
            )}
          </div>
          <button className="more" type="button" aria-expanded={all} onClick={() => setAll((x) => !x)}>
            {all ? t("less") : t("more", { n: f.n(s.all.length) })}
            <ChevronDown className="ic" aria-hidden />
          </button>
          {all && (
            <div className="glass all on">
              <div className="ar hd">
                <span />
                <span>{t("colProduct")}</span>
                <span className="n">{t("colUnits")}</span>
                <span className="n">{t("colValue")}</span>
                <span className="n">{t("colDays")}</span>
                <span>{t("colState")}</span>
              </div>
              {s.all.map((r) => (
                <button className="ar" type="button" key={r.id} onClick={() => onOpen(r.id)}>
                  <Thumb name={r.name} image={r.image} sm />
                  <b>{r.name}</b>
                  <span className="n">{f.n(r.units)}</span>
                  <span className="n v">{f.n(r.value)}</span>
                  <span className="n">{r.days == null ? "—" : `${f.n(r.days)} j`}</span>
                  <span className={`st h-${r.state}`}><i className="hdot" />{t(`sev.${r.state}.w`)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ProductDrawer({ p, data, f, t, loc, locale, onClose, buyHref }: {
  p: ProductSheet; data: View; f: Fmt; t: T; loc: Loc; locale: string; onClose: () => void;
  buyHref: (site: string, product: string, qty?: number) => string;
}) {
  const top = Math.max(...p.series, 1);
  const shipped = p.series.reduce((a, c) => a + c, 0);
  const step = data.seriesBucketDays;
  const firstDay = addDays(data.today, -(p.series.length * step - 1));
  const counted = p.lastCounted ? dateLabel(loc, p.lastCounted, true) : t("never");
  return (
    <>
      <div className="dr-h">
        <span className="pg" style={{ width: 48, height: 48, borderRadius: 15, fontSize: 16 }}>{p.image ? <img src={p.image} alt="" /> : initials(p.name)}</span>
        <div>
          <h3 id="stock-dr-title">{p.name}</h3>
          <p>{t("drawerSub", { cost: f.money(p.cost), price: f.money(p.price) })}</p>
        </div>
        <DrawerClose onClose={onClose} label={t("close")} />
      </div>
      <div className="dr-b">
        <div className="dk"><b><Money f={f} v={p.value} /></b><span>{t("drawerUnits", { n: f.n(p.units) })}</span></div>
        <div className="dfacts">
          <div><small>{t("fRate")}</small><b>{t("fRateV", { r: f.n(p.rate, 1) })}</b></div>
          <div><small>{t("fDays")}</small><b>{p.days == null ? "—" : t("fDaysV", { n: f.n(p.days) })}</b></div>
          <div><small>{t("fCount")}</small><b>{counted}</b></div>
        </div>
        <div className="dr-sec">
          <h4>{t("bySite")}</h4>
          <div className="dt hd"><span>{t("colWhere")}</span><span className="n">{t("colUnits")}</span><span className="n">{t("colValue")}</span><span className="n">{t("colDays")}</span></div>
          {p.sites.map((r) => (
            <div className="dt" key={r.id ?? "unas"}>
              <span>
                {r.state ? <i className={`hdot h-${r.state}`} data-tip={t(`sev.${r.state}.w`)} /> : <MapPin className="ic" aria-hidden style={{ color: "var(--ink-q)" }} />}
                {r.name ?? t("unassigned")}
              </span>
              <span className="n">{f.n(r.units)}</span>
              <span className="n v">{f.n(r.value)}</span>
              <span className="n">{r.days == null ? "—" : `${f.n(r.days)} j`}</span>
            </div>
          ))}
          <div className="dt tot"><span>{t("total")}</span><span className="n">{f.n(p.units)}</span><span className="n v">{f.n(p.value)}</span><span className="n">{p.days == null ? "—" : `${f.n(p.days)} j`}</span></div>
        </div>
        {p.series.length > 0 && (
          <div className="dr-sec">
            <h4>{step > 1 ? t("seriesWeek", { n: p.series.length * step }) : t("seriesDay", { n: p.series.length })}</h4>
            <div className="spk" role="img" aria-label={t("seriesSum", { n: f.n(shipped), d: p.series.length * step })}>
              {p.series.map((n, i) => (
                <i key={i} className={n ? "" : "z"} style={{ ["--h" as string]: `${(n / top) * 100}%`, ["--i" as string]: i }} data-tip={t("seriesTip", { d: dateLabel(loc, addDays(firstDay, i * step)), n: f.n(n) })} />
              ))}
            </div>
            <div className="spx"><span>{dateLabel(loc, firstDay)}</span><span>{t("seriesSum", { n: f.n(shipped), d: p.series.length * step })}</span><span>{t("todayLbl")}</span></div>
          </div>
        )}
        <div className="dnote"><Info className="ic" aria-hidden /><span>{t("dnote", { x: counted })}</span></div>
      </div>
      <div className="dr-f">
        {p.orderSite && (
          <a className="btn sm" href={buyHref(p.orderSite, p.id)}>
            <ShoppingCart className="ic" aria-hidden />
            {t("order")}
            <ChevronRight className="ic" aria-hidden />
          </a>
        )}
        <a className="btn2 sm" href={`/${locale}/warehouse/stock`}>
          {t("moves")}
          <ChevronRight className="ic" aria-hidden />
        </a>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 500, marginInlineStart: "auto" }}>{t("esc")}</span>
      </div>
    </>
  );
}
