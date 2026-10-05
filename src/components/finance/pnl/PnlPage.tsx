"use client";

// Finances › P&L global — prototypes/finances-pnl-v3.html.
//
// One answer (the month's bénéfice brut and one sentence), the pipe that
// produced it, then Mois par mois. Basis: sales delivered in the month. Every
// figure comes computed from GET /api/finance/pnl; the browser only draws.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { Calendar, Check, ChevronDown, ChevronRight, Download, Info } from "lucide-react";
import { jsonFetcher } from "@/lib/fetchers";
import { per100, pickMonth, STREAMS, type PnlMonth, type Stream } from "@/lib/finance/pnl/months";
import { pipeGeometry, PIPE } from "@/lib/finance/pnl/pipe";
import { Money, Trend, makeFmt, useTip, type Fmt, type Loc } from "../kit/ui";
import "../kit/finance-kit.css";
import "./pnl.css";

interface PnlView {
  today: string;
  currency: string;
  months: PnlMonth[];
}

type T = ReturnType<typeof useTranslations>;

const intl = new Map<string, Intl.DateTimeFormat>();
function monthName(loc: Loc, key: string, style: "long" | "short", year = false) {
  const k = `${loc}|${style}|${year}`;
  let f = intl.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat(loc === "ar" ? "ar-LY-u-nu-latn" : "fr-FR", { month: style, ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
    intl.set(k, f);
  }
  return f.format(new Date(`${key}-15T12:00:00Z`));
}
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const dayOf = (iso: string) => Number(iso.slice(8, 10));
const daysIn = (key: string) => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).getUTCDate();

const b = (chunks: ReactNode) => <b>{chunks}</b>;

export function PnlPage({ marketId, marketName, locale }: { marketId: string | null; marketName: string; locale: string }) {
  const t = useTranslations("financePnl");
  const loc: Loc = locale === "ar" ? "ar" : "fr";
  const sp = useSearchParams();
  const router = useRouter();
  const tip = useTip();
  const [asked, setAsked] = useState<string | null>(sp.get("m"));
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data, error } = useSWR<PnlView>(marketId ? `/api/finance/pnl?market_id=${marketId}` : null, jsonFetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
  });

  const cur = data ? pickMonth(data.months, asked) : -1;
  const open = useCallback(
    (key: string) => {
      setAsked(key);
      setPickerOpen(false);
      window.history.replaceState(null, "", `${window.location.pathname}?m=${key}`);
    },
    [],
  );

  useEffect(() => {
    if (!pickerOpen) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.(".popw")) setPickerOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPickerOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [pickerOpen]);

  const f = useMemo(() => makeFmt(loc, data?.currency ?? "LYD"), [loc, data?.currency]);

  const exportCsv = useCallback(() => {
    if (!data) return;
    const rows = [t("csvHead"), ...data.months.map((m) => [m.key, m.paid, m.cogs, m.ship, m.ads, m.pack, m.profit, m.orders].join(","))];
    const blob = new Blob([`﻿${rows.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pnl-${data.today}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [data, t]);

  const m = data && cur >= 0 ? data.months[cur] : null;
  const prev = data && cur > 0 ? data.months[cur - 1] : null;
  const L = (key: string) => cap(monthName(loc, key, "long", true));

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
              {marketName}
              {m && (
                <>
                  <span className="sep" />
                  {t("sub", { month: L(m.key).toLowerCase() })}
                  {m.live ? (
                    <span className="pill warn">
                      <i className="dot" />
                      {t("live", { day: `${dayOf(m.to)} ${monthName(loc, m.key, "short")}` })}
                    </span>
                  ) : (
                    <span className="pill good">
                      <Check className="ic" aria-hidden />
                      {t("closed")}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
          {data && m && (
            <div className="ph-r">
              <div className="acts">
                <button className="btn2" type="button" data-tip={t("exportTip")} onClick={exportCsv}>
                  <Download className="ic" aria-hidden />
                  {t("export")}
                </button>
                <div className="popw">
                  <button className={`dbtn${pickerOpen ? " open" : ""}`} type="button" aria-haspopup="true" aria-expanded={pickerOpen} onClick={() => setPickerOpen((o) => !o)}>
                    <Calendar className="ic" aria-hidden />
                    <div>
                      <b>{L(m.key)}</b>
                      <small>{m.live ? t("btnLive", { day: `${dayOf(m.to)} ${monthName(loc, m.key, "short")}` }) : t("btnClosed")}</small>
                    </div>
                    <ChevronDown className="ic chev" aria-hidden />
                  </button>
                  {pickerOpen && <MonthPicker months={data.months} cur={cur} f={f} t={t} loc={loc} onPick={open} />}
                </div>
              </div>
            </div>
          )}
        </header>

        {!marketId && (
          <section className="card choose">
            <b>{t("chooseTitle")}</b>
            <p>{t("chooseText")}</p>
          </section>
        )}
        {marketId && error && <div className="err">{t("error")}</div>}
        {marketId && !data && !error && (
          <>
            <div className="sk" style={{ height: 620 }} />
            <div className="sk" style={{ height: 380 }} />
          </>
        )}

        {data && m && (
          <>
            <TopCard m={m} prev={prev} f={f} t={t} loc={loc} locale={locale} onGo={(href) => router.push(href)} />
            <MonthsCard months={data.months} cur={cur} f={f} t={t} loc={loc} onPick={open} />
            <p className="foot rise" style={{ ["--d" as string]: 3 }}>
              <Info className="ic" aria-hidden />
              <span>{t.rich("basis", { b })}</span>
            </p>
          </>
        )}
      </div>
      <div className="tip" ref={tip.ref} role="tooltip" />
    </div>
  );
}

function MonthPicker({ months, cur, f, t, loc, onPick }: { months: PnlMonth[]; cur: number; f: Fmt; t: T; loc: Loc; onPick: (k: string) => void }) {
  const years = [...new Set(months.map((m) => m.key.slice(0, 4)))].reverse();
  return (
    <div className="pop mp" role="menu">
      {years.map((y) => (
        <div key={y}>
          <div className="mp-y">{y}</div>
          <div className="mp-g">
            {months
              .map((m, i) => ({ m, i }))
              .filter(({ m }) => m.key.startsWith(y))
              .reverse()
              .map(({ m, i }) => (
                <button key={m.key} className={`mp-m${i === cur ? " on" : ""}`} type="button" role="menuitemradio" aria-checked={i === cur} onClick={() => onPick(m.key)}>
                  <b>
                    {monthName(loc, m.key, "short").replace(".", "")}
                    {m.live ? ` · ${t("pickLive")}` : ""}
                  </b>
                  <small>{t("pickEarned", { v: f.money(m.profit) })}</small>
                </button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TopCard({ m, prev, f, t, loc, locale, onGo }: { m: PnlMonth; prev: PnlMonth | null; f: Fmt; t: T; loc: Loc; locale: string; onGo: (href: string) => void }) {
  const L = cap(monthName(loc, m.key, "long", true));
  const lower = (k: string) => monthName(loc, k, "long");
  // a live month compares with the same number of days of the month before
  const base = prev ? (m.live ? (prev.profit * dayOf(m.to)) / daysIn(prev.key) : prev.profit) : null;
  const dProf = base && base > 0 ? ((m.profit - base) / base) * 100 : null;
  const n = per100(m.profit, m.paid);

  let sentence: ReactNode;
  if (m.profit < 0) sentence = t.rich("sentenceLoss", { b, v: f.money(-m.profit), orders: f.n(m.orders) });
  else if (m.live) sentence = t.rich("sentenceLive", { b, month: lower(m.key), sym: f.sym, n: f.n(n) });
  else if (prev && prev.paid > 0)
    sentence = t.rich("sentence", { b, sym: f.sym, n: f.n(n), prev: f.n(per100(prev.profit, prev.paid)), prevMonth: lower(prev.key), orders: f.n(m.orders) });
  else sentence = t.rich("sentenceFirst", { b, sym: f.sym, n: f.n(n), orders: f.n(m.orders) });

  const trendTip = prev
    ? m.live
      ? t("trendTipLive", { days: f.n(dayOf(m.to)), month: lower(prev.key) })
      : t("trendTip", { month: cap(monthName(loc, prev.key, "long", true)), v: f.money(prev.profit) })
    : undefined;

  return (
    <section className="card rise" style={{ ["--d" as string]: 1 }} aria-label={t("profit")}>
      <div className="top">
        <div className="eyebrow">{m.live ? t("eyebrowLive", { month: L }) : t("eyebrow", { month: L })}</div>
        <div className="ans-l">
          <i className="sw k-profit" />
          {t("profit")}
          {dProf != null && <Trend f={f} pct={dProf} tip={trendTip} />}
        </div>
        <div className={`ans-n${m.profit < 0 ? " neg" : ""}`}>
          <Money f={f} v={m.profit} />
        </div>
        <p className="ans-s">{sentence}</p>
      </div>

      <div className="pipe-h">
        <h2>{t("pipeTitle", { paid: f.money(m.paid) })}</h2>
        <p>{t("pipeSub")}</p>
      </div>
      {m.paid > 0 ? <Pipe m={m} prev={prev} f={f} t={t} loc={loc} locale={locale} onGo={onGo} /> : <p className="empty pipe-empty">{t("emptyMonth")}</p>}
      <div className="pipe-f">
        <Info className="ic" aria-hidden />
        <span>{t("pipeFoot")}</span>
        <a className="link" href={`/${locale}/products`}>
          {t("byProduct")}
          <ChevronRight className="ic" aria-hidden />
        </a>
      </div>
    </section>
  );
}

const STREAM_HREF: Partial<Record<Stream, string>> = { cogs: "products", ads: "finance/ad-spend" };

function Pipe({ m, prev, f, t, loc, locale, onGo }: { m: PnlMonth; prev: PnlMonth | null; f: Fmt; t: T; loc: Loc; locale: string; onGo: (href: string) => void }) {
  const g = pipeGeometry(m);
  const { top, x0, xEnd, Yb, W, H } = PIPE;
  const tipOf = (k: Stream, v: number) => {
    const lines = [`${t(`streams.${k}`)} · ${f.money(v)} · ${t("per100", { n: f.n(per100(v, m.paid)) })}`, t(`streamTips.${k}`)];
    if (prev && prev.paid > 0) lines.push(t("streamPrev", { month: monthName(loc, prev.key, "long"), n: f.n(per100(prev[k], prev.paid)) }));
    if (STREAM_HREF[k]) lines.push(t("streamOpen"));
    return lines.join("\n");
  };
  return (
    <svg
      className={`flow${g.loss ? " loss" : ""}`}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={t("pipeAria", { paid: f.money(m.paid), cogs: f.money(m.cogs), ship: f.money(m.ship), ads: f.money(m.ads), pack: f.money(m.pack), profit: f.money(m.profit) })}
    >
      <defs>
        <linearGradient id="fin-gMain" x1="0" x2="1">
          <stop offset="0" stopColor="#D5DAE3" />
          <stop offset="1" stopColor="#E6E9EF" />
        </linearGradient>
        <linearGradient id="fin-gEnd" x1="0" x2="1">
          <stop offset="0" stopColor="#27A35A" />
          <stop offset="1" stopColor="#15803d" />
        </linearGradient>
      </defs>
      <text className="in-t" x={x0} y={top - 46}>{t("inLabel")}</text>
      <text className="in-v" x={x0} y={top - 16}>
        {f.n(m.paid)} <tspan className="cu">{f.sym}</tspan>
      </text>
      <text className="out-t" x={xEnd} y={top - 46}>{g.loss ? t("outLoss") : t("outLabel")}</text>
      <text className="out-v" x={xEnd - 92} y={top - 14}>
        {f.n(m.profit)} <tspan className="cu">{f.sym}</tspan>
      </text>
      <text className="out-p" x={xEnd} y={top - 16}>{t("per100", { n: f.n(per100(m.profit, m.paid)) })}</text>
      <path className="main" d={g.main} />
      {g.end.d && <path className="end" d={g.end.d} />}
      {g.rests.filter((r) => r.show).map((r, i) => (
        <text key={i} className="rest sm" x={r.x} y={r.y}>{t("rest", { v: f.n(r.v) })}</text>
      ))}
      {g.end.show && <text className="rest w" x={g.end.x} y={g.end.y}>{f.n(g.end.v)}</text>}
      {g.streams.map((s) => {
        const href = STREAM_HREF[s.k];
        return (
          <g
            key={s.k}
            className={`c k-${s.k}${href ? " go" : ""}`}
            data-tip={tipOf(s.k, s.v)}
            onClick={href ? () => onGo(`/${locale}/${href}`) : undefined}
          >
            {s.d && <path className="br" d={s.d} />}
            <circle className="dot" cx={s.cx} cy={Yb + 18} r={5} />
            <text className="lab-t" x={s.cx} y={Yb + 46}>{t(`streams.${s.k}`)}</text>
            <text className="lab-v" x={s.cx} y={Yb + 72}>{`− ${f.n(s.v)}`}</text>
            <text className="lab-p" x={s.cx} y={Yb + 92}>{t("per100", { n: f.n(per100(s.v, m.paid)) })}</text>
          </g>
        );
      })}
    </svg>
  );
}

function MonthsCard({ months, cur, f, t, loc, onPick }: { months: PnlMonth[]; cur: number; f: Fmt; t: T; loc: Loc; onPick: (k: string) => void }) {
  const top = Math.max(...months.map((m) => m.paid), 1);
  const step = niceStep(top / 4);
  const max = step * Math.ceil(top / step);
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const closed = months.filter((m) => !m.live);
  const total12 = closed.slice(-12).reduce((a, m) => a + m.profit, 0);
  const first = closed.find((m) => m.paid > 0);
  const last = closed[closed.length - 1];
  const k = (v: number) => (v >= 1000 ? `${f.n(v / 1000, v % 1000 ? 1 : 0)} k` : f.n(v));
  return (
    <section className="card rise" style={{ ["--d" as string]: 2 }} aria-label={t("monthsTitle")}>
      <div className="chead">
        <div>
          <h2>{t("monthsTitle")}</h2>
          <p className="q">{t("monthsQ")}</p>
        </div>
        <div className="rt">
          <span className="lg"><i className="paid" />{t("lgPaid")}</span>
          <span className="lg"><i className="prof" />{t("lgProfit")}</span>
          <span className="lg"><i className="live" />{t("lgLive")}</span>
        </div>
      </div>
      <div className="mc">
        <div className="mplot">
          <div className="mgrid">
            {ticks.map((v) => (
              <div key={v} style={{ bottom: `${(v / max) * 100}%` }}>
                <span>{v ? k(v) : "0"}</span>
              </div>
            ))}
          </div>
          <div className="mcols">
            {months.map((m, i) => {
              const h = (m.paid / max) * 100;
              const p = m.paid > 0 ? Math.max(0, (m.profit / m.paid) * 100) : 0;
              const name = cap(monthName(loc, m.key, "long", true));
              const args = { month: name, paid: f.money(m.paid), profit: f.money(m.profit), n: f.n(per100(m.profit, m.paid)) };
              return (
                <button
                  key={m.key}
                  className={`mcol${i === cur ? " sel" : ""}${m.live ? " live" : ""}`}
                  type="button"
                  aria-pressed={i === cur}
                  aria-label={name}
                  data-tip={m.live ? t("colTipLive", args) : t("colTip", args)}
                  onClick={() => onPick(m.key)}
                >
                  <span className={`mval${m.live ? " dim" : ""}${m.profit < 0 ? " neg" : ""}`}>{k(m.profit)}</span>
                  <span className="mbar" style={{ ["--h" as string]: `${h}%`, ["--p" as string]: `${p}%`, ["--i" as string]: i }}>
                    <i />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="mx">
          {months.map((m, i) => (
            <button key={m.key} type="button" className={i === cur ? "sel" : ""} onClick={() => onPick(m.key)}>
              <b>{monthName(loc, m.key, "short")}</b>
              <small>{`${f.n(per100(m.profit, m.paid))} %`}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="mfoot">
        <span>{t.rich("total12", { b, v: f.money(total12) })}</span>
        {first && last && first !== last && (
          <span>
            {t.rich("evolution", {
              b,
              sym: f.sym,
              from: f.n(per100(first.profit, first.paid)),
              m1: monthName(loc, first.key, "short", true),
              to: f.n(per100(last.profit, last.paid)),
              m2: monthName(loc, last.key, "short"),
            })}
          </span>
        )}
        <span>{t("clickMonth")}</span>
      </div>
    </section>
  );
}

/** 1, 2, 2.5 or 5 × a power of ten — round grid steps for the months chart. */
function niceStep(raw: number) {
  if (raw <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const r = raw / p;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p;
}
