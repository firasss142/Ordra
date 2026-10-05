"use client";

// Finances › Investisseurs — prototypes/finances-investisseurs-v1.html.
//
// « Comment travaille leur argent » : the overview as an equation (gagné =
// déjà versé + à verser), an « À faire » line when a closed month waits for its
// statements, one card per person in their own colour, and a drawer per person.
// Figures come from GET /api/finance/investors (the engine's own day series,
// cut into closed months). Writes — contract, closing, payments — open the
// investor console, which holds the RPC-backed forms.

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { CalendarCheck, Check, ChevronRight, Clock, FileText, Info, Landmark, Lock, Package, Percent, Plus, TrendingUp, Wallet } from "lucide-react";
import { jsonFetcher } from "@/lib/fetchers";
import type { InvestorView, MonthShare } from "@/lib/finance/investors/model";
import type { InvestorsPageData } from "@/lib/finance/investors/load";
import { Drawer, DrawerClose, Money, makeFmt, useTip, type Fmt, type Loc } from "../kit/ui";
import "../kit/finance-kit.css";
import "./investors.css";

type View = InvestorsPageData & { currency: string };
type T = ReturnType<typeof useTranslations>;
const HEX: Record<string, string> = { indigo: "#444CE7", pink: "#DD2590", cyan: "#088AB2", gold: "#CA8504", lime: "#4CA30D" };
const b = (c: ReactNode) => <b>{c}</b>;
const d = (n: number) => ({ ["--d" as string]: n }) as CSSProperties;

const intl = new Map<string, Intl.DateTimeFormat>();
function fmtDate(loc: Loc, iso: string, opts: Intl.DateTimeFormatOptions) {
  const k = loc + JSON.stringify(opts);
  let f = intl.get(k);
  if (!f) intl.set(k, (f = new Intl.DateTimeFormat(loc === "ar" ? "ar-LY-u-nu-latn" : "fr-FR", { ...opts, timeZone: "UTC" })));
  return f.format(new Date(iso.length === 7 ? `${iso}-15T12:00:00Z` : iso.length === 10 ? `${iso}T12:00:00Z` : iso));
}
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const addMonths = (key: string, n: number) => {
  const t = Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};

export function InvestorsPage({ marketId, marketName, locale, canManage }: { marketId: string | null; marketName: string; locale: string; canManage: boolean }) {
  const t = useTranslations("financeInvestors");
  const loc: Loc = locale === "ar" ? "ar" : "fr";
  const tip = useTip();
  const [open, setOpen] = useState<string | null>(null);
  const { data, error } = useSWR<View>(marketId ? `/api/finance/investors?market_id=${marketId}` : null, jsonFetcher, { revalidateOnFocus: false });
  const f = useMemo(() => makeFmt(loc, data?.currency ?? "LYD"), [loc, data?.currency]);
  const consoleHref = (tab: string) => `/${locale}/finance/investors?view=console&tab=${tab}`;

  const M = (key: string, style: "long" | "short" = "long", year = false) => fmtDate(loc, key, { month: style, ...(year ? { year: "numeric" } : {}) });
  const D = (iso: string, year = false) => fmtDate(loc, iso, { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) });
  const sel = data?.investors.find((x) => x.id === open) ?? null;
  const maxMonth = data ? Math.max(1, ...data.investors.flatMap((x) => x.months.slice(-5).map((m) => m.share))) : 1;

  return (
    <div className="fin" onMouseOver={tip.onOver} onMouseMove={tip.onMove} onMouseLeave={tip.onLeave}>
      <div className="page">
        <header className="ph rise" style={d(0)}>
          <div>
            <div className="crumb">{t("crumb")} <ChevronRight className="ic" aria-hidden /> {t("title")}</div>
            <h1>{t("title")}</h1>
            <div className="sub">
              {marketName}
              {data && (
                <>
                  <span className="sep" />
                  {t("people", { n: data.investors.length })}
                  <span className="sep" />
                  {t("entrusted", { v: f.money(data.overview.capital) })}
                  <span className="chip" data-tip={t("chipTip", { next: cap(M(addMonths(data.lastClosed, 1))) })}>
                    <Lock className="ic" aria-hidden />
                    {t("chip", { month: M(data.lastClosed) })}
                  </span>
                </>
              )}
            </div>
          </div>
          {canManage && marketId && (
            <div className="ph-r">
              <div className="acts">
                <a className="btn2" href={`/${locale}/users`} data-tip={t("addInvestorTip")}><Plus className="ic" aria-hidden />{t("addInvestor")}</a>
                <a className="btn" href={consoleHref("deals")}><Plus className="ic" aria-hidden />{t("addDeal")}</a>
              </div>
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
            <div className="sk" style={{ height: 150 }} />
            <div className="sk" style={{ height: 560 }} />
          </>
        )}
        {data && data.investors.length === 0 && (
          <div className="empty">
            <p>{t("empty")}</p>
            <p style={{ fontWeight: 500, marginTop: 6 }}>{t("emptyHow")}</p>
          </div>
        )}

        {data && data.investors.length > 0 && (
          <>
            <Overview data={data} f={f} t={t} M={M} />
            {data.todo && canManage && (
              <section className="card todo rise" style={d(2)} aria-label={t("todoEyebrow")}>
                <span className="hold"><FileText className="ic" aria-hidden /></span>
                <div className="todo-t">
                  <span className="eyebrow">{t("todoEyebrow")}</span>
                  <b>{t("todoTitle", { month: cap(M(data.todo.month)), n: data.todo.people.length })}</b>
                  <small>
                    {t("todoSmall", {
                      list: data.investors.filter((x) => data.todo!.people.includes(x.id)).map((x) => x.name.split(" ")[0]).join(" · "),
                      v: f.money(data.todo.amount),
                    })}
                  </small>
                </div>
                <span className="stack">{data.investors.filter((x) => data.todo!.people.includes(x.id)).map((x) => <Avatar key={x.id} x={x} size={24} />)}</span>
                <a className="btn2 sm" href={consoleHref("close")} data-tip={t("todoTip")}><Check className="ic" aria-hidden />{t("todoBtn")}</a>
              </section>
            )}
            <section className="grp" aria-label={t("secTitle")}>
              <div className="sec-h rise" style={d(2)}>
                <div>
                  <h2>{t("secTitle")}</h2>
                  <p className="q">{t("secQ")}</p>
                </div>
                <div className="rt">
                  <span className="lg2"><i className="sw" style={{ ["--k" as string]: "#475467" }} />{t("lgPaid")}</span>
                  <span className="lg2"><i className="sw" style={{ ["--k" as string]: "#C9CED7" }} />{t("lgDue")}</span>
                  <span className="lg2" style={{ color: "var(--ink-3)" }}>{t("lgScale")}</span>
                </div>
              </div>
              <div className="cards">
                {data.investors.map((x, i) => (
                  <Card key={x.id} x={x} n={i} sel={open === x.id} data={data} f={f} t={t} M={M} D={D} maxMonth={maxMonth} onOpen={() => setOpen(x.id)} />
                ))}
              </div>
            </section>
            <p className="foot rise" style={d(7)}>
              <Info className="ic" aria-hidden />
              <span>{t.rich("foot", { b })}</span>
            </p>
          </>
        )}
      </div>

      <Drawer open={!!sel} onClose={() => setOpen(null)} hue={sel ? HEX[sel.hue] : undefined} labelledBy="inv-dr-title" closeLabel={t("close")}>
        {sel && data && <InvestorDrawer x={sel} data={data} f={f} t={t} M={M} D={D} canManage={canManage} consoleHref={consoleHref} onClose={() => setOpen(null)} />}
      </Drawer>
      <div className="tip" ref={tip.ref} role="tooltip" />
    </div>
  );
}

function Avatar({ x, size }: { x: InvestorView; size: 24 | 44 | 48 }) {
  return <span className={`av s${size} h-${x.hue}`} aria-hidden style={size === 44 ? undefined : undefined}>{x.initials}</span>;
}

function Overview({ data, f, t, M }: { data: View; f: Fmt; t: T; M: (k: string, s?: "long" | "short", y?: boolean) => string }) {
  const o = data.overview;
  const mx = Math.max(1, ...o.months.map((m) => m.share));
  const last = o.months[o.months.length - 1];
  const nPays = data.investors.reduce((a, x) => a + x.payments.length, 0);
  const next = data.investors.map((x) => x.nextPayout).filter(Boolean).sort()[0] as string | undefined;
  const tile = (cls: string, icon: ReactNode, label: string, n: number, status: ReactNode, tipText: string, extra?: ReactNode) => (
    <div className={`card t ${cls}`} data-tip={tipText}>
      <div className="t-h"><span className="hold">{icon}</span>{label}{extra}</div>
      <div className="t-n"><Money f={f} v={n} /></div>
      <div className="t-s">{status}</div>
    </div>
  );
  return (
    <section className="ov rise" style={d(1)} aria-label="Leur argent, en tout">
      {tile(
        "first",
        <Landmark className="ic" aria-hidden />,
        t("tEntrusted"),
        o.capital,
        <>
          <span className="pill">{t("dealsOpen", { n: data.investors.reduce((a, x) => a + x.deals.filter((dl) => dl.status !== "closed").length, 0) })}</span>
          <span className="stack">{data.investors.map((x) => <Avatar key={x.id} x={x} size={24} />)}</span>
        </>,
        t("capTip"),
      )}
      {tile(
        "",
        <TrendingUp className="ic" aria-hidden />,
        t("tEarned"),
        o.earned,
        <>
          <span className="pill"><Lock className="ic" aria-hidden />{t("closedMonths")}</span>
          {last && <span className="t-m">{t("earnedSpan", { last: M(last.key, "short"), v: f.n(last.share) })}</span>}
        </>,
        t("earnedTip"),
        <span className="spark" aria-hidden>
          {o.months.map((m, i) => (
            <i key={m.key} style={{ ["--h" as string]: `${Math.max(1, (m.share / mx) * 26).toFixed(1)}px`, ["--i" as string]: i }} data-tip={t("sparkTip", { month: cap(M(m.key, "long", true)), v: f.money(m.share) })} />
          ))}
        </span>,
      )}
      <span className="op" aria-hidden data-tip={t("eqTip")}>=</span>
      {tile("", <Check className="ic" aria-hidden />, t("tPaid"), o.paid, <><span className="pill good"><Check className="ic" aria-hidden />{t("upToDate")}</span><span className="t-m">{t("payments", { n: nPays })}</span></>, t("paidTip"))}
      <span className="op" aria-hidden>+</span>
      {tile("", <CalendarCheck className="ic" aria-hidden />, t("tDue"), o.due, next ? <span className="pill"><Clock className="ic" aria-hidden />{t("nextPay", { date: fmtDate(f.loc, next, { day: "numeric", month: "short" }) })}</span> : null, t("dueTip"))}
    </section>
  );
}

function stateOf(t: T, m: MonthShare) {
  return m.settled ? t("stSettled") : t("stOpen");
}

function Ring({ x, n, f, t, M }: { x: InvestorView; n: number; f: Fmt; t: T; M: (k: string, s?: "long" | "short", y?: boolean) => string }) {
  const R = 59.5, C = 2 * Math.PI * R, gap = 3.2, capital = Math.max(x.capital, 1);
  let acc = 0;
  const segs = x.months.filter((m) => m.share > 0).map((m) => {
    const len = Math.min((m.share / capital) * C, C), vis = Math.max(len - gap, 1.5);
    const el = (
      <circle
        key={m.key}
        className={`rg-s ${m.settled ? "paid" : "due"}`}
        cx="68" cy="68" r={R}
        strokeDasharray={`${vis.toFixed(2)} ${(C + 10).toFixed(2)}`}
        strokeDashoffset={(-acc - gap / 2).toFixed(2)}
        data-tip={t("ringTip", { month: cap(M(m.key, "long", true)), v: f.money(m.share), p: f.n((m.share / capital) * 100, 1), state: stateOf(t, m) })}
      />
    );
    acc += len;
    return el;
  });
  return (
    <svg viewBox="0 0 136 136" aria-hidden>
      <circle className="rg-t" cx="68" cy="68" r={R} />
      <defs>
        <mask id={`rm${n}`} maskUnits="userSpaceOnUse" x="0" y="0" width="136" height="136">
          <circle className="sweep" cx="68" cy="68" r={R} transform="rotate(-90 68 68)" style={{ ["--n" as string]: n }} />
        </mask>
      </defs>
      <g mask={`url(#rm${n})`}><g className="segs" transform="rotate(-90 68 68)">{segs}</g></g>
    </svg>
  );
}

function Card({ x, n, sel, data, f, t, M, D, maxMonth, onOpen }: {
  x: InvestorView; n: number; sel: boolean; data: View; f: Fmt; t: T; maxMonth: number; onOpen: () => void;
  M: (k: string, s?: "long" | "short", y?: boolean) => string; D: (iso: string, y?: boolean) => string;
}) {
  const since = x.deals.map((dl) => dl.start).sort()[0];
  const closed = x.months.length;
  const slots = Array.from({ length: 5 }, (_, i) => addMonths(data.lastClosed, i - 4));
  const byKey = new Map(x.months.map((m) => [m.key, m]));
  const deal0 = x.deals[0];
  return (
    <article
      className={`card inv h-${x.hue}${sel ? " sel" : ""} rise`}
      style={d(3 + n)}
      role="button"
      tabIndex={0}
      aria-label={t("open", { name: x.name })}
      onClick={(e) => !(e.target as Element).closest("a") && onOpen()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
    >
      <span className="halo" aria-hidden />
      <div className="inv-h">
        <Avatar x={x} size={44} />
        <div className="inv-n"><b>{x.name}</b>{since && <small>{t("since", { month: M(since.slice(0, 7), "long", true) })}</small>}</div>
        <span className="go" aria-hidden><ChevronRight className="ic" /></span>
      </div>
      <Rhythm x={x} t={t} D={D} />
      <div className="inv-m">
        <div className="ring">
          <Ring x={x} n={n} f={f} t={t} M={M} />
          <div className="rc"><b>{f.n(x.roc)}<small>%</small></b><span>{t("ofCapital")}</span><em>{t("earnedIn", { n: closed })}</em></div>
        </div>
        <div className="fig">
          <div><span>{t("fCapital")}</span><b><Money f={f} v={x.capital} /></b></div>
          <div><span>{t("fEarned")}</span><b><Money f={f} v={x.earned} /></b></div>
          <div><span><i className="sw s-paid" />{t("fPaid")}</span><b className={x.paid ? "" : "z"}>{x.paid ? <Money f={f} v={x.paid} /> : "0"}</b></div>
          <div><span><i className="sw s-due" />{t("fDue")}</span><b className={x.due ? "" : "z"}>{x.due ? <Money f={f} v={x.due} /> : "0"}</b></div>
        </div>
      </div>
      {x.deals.map((dl) => (
        <div className="deal" key={dl.id}>
          <div className="deal-h">
            <span className="pi">{dl.productImage ? <img src={dl.productImage} alt="" /> : <Package className="ic" aria-hidden />}</span>
            <b>{dl.productName}</b>
            <span className="kind"><Percent className="ic" aria-hidden />{t("kindShare", { pct: f.n(dl.sharePct, dl.sharePct % 1 ? 1 : 0) })}</span>
          </div>
          <div className="per" data-tip={t("periodTip", { from: D(dl.start, true), to: D(dl.end, true), n: dl.monthsTotal, i: dl.monthIdx })}>
            <div className="per-bar">
              <i style={{ ["--w" as string]: `${dl.elapsedPct.toFixed(1)}%` }} />
              <span className="now" style={{ ["--w" as string]: `${dl.elapsedPct.toFixed(1)}%` }}><span>{t("today")}</span></span>
            </div>
            <div className="per-d"><span>{D(dl.start, true)}</span><b>{t("monthOf", { i: dl.monthIdx, n: dl.monthsTotal })}</b><span>{D(dl.end, true)}</span></div>
          </div>
          <div className="deal-r">
            {dl.last ? (
              <>
                <span>{t("lastRes", { month: M(dl.last.key) })}</span>
                <b><Money f={f} v={dl.last.share} /></b>
                <span className="m">{t("lastHow", { pct: f.n(dl.sharePct, dl.sharePct % 1 ? 1 : 0), v: f.n(dl.last.profit) })}</span>
              </>
            ) : (
              <span className="m">{t("noResult")}</span>
            )}
          </div>
        </div>
      ))}
      <div className="mb">
        <div className="mb-h"><span className="eyebrow">{t("mbTitle")}</span></div>
        <div className="mb-c">
          {slots.map((k, i) => {
            const m = byKey.get(k);
            if (!m) return <div className="mb-col" key={k} data-tip={t("mbNone", { month: cap(M(k, "long", true)) })}><span className="mb-v z">—</span><span className="mb-b none" /></div>;
            return (
              <div
                className="mb-col"
                key={k}
                data-tip={t("mbTip", { month: cap(M(k, "long", true)), v: f.money(m.share), pct: deal0 ? f.n(deal0.sharePct) : "—", profit: f.n(m.profit), product: x.deals.map((dl) => dl.productName).join(" + "), state: stateOf(t, m) })}
              >
                <span className="mb-v">{f.n(m.share)}</span>
                <span className={`mb-b ${m.settled ? "paid" : "due"}`} style={{ ["--h" as string]: `${Math.max(3, (Math.max(0, m.share) / maxMonth) * 62).toFixed(1)}px`, ["--i" as string]: i }} />
              </div>
            );
          })}
        </div>
        <div className="mb-x">{slots.map((k) => <span key={k}>{M(k, "short")}</span>)}</div>
      </div>
    </article>
  );
}

function Rhythm({ x, t, D }: { x: InvestorView; t: T; D: (iso: string, y?: boolean) => string }) {
  const c = t(`cadence.${x.cadence}`);
  return (
    <div className="rh">
      <span className="rchip" data-tip={t("rhythmTip", { c })}>
        <CalendarCheck className="ic" aria-hidden />
        <span>{x.nextPayout ? t.rich("rhythmNext", { b, c, date: D(x.nextPayout) }) : t.rich("rhythm", { b, c })}</span>
      </span>
    </div>
  );
}

function MoneyChart({ x, data, f, t, M }: { x: InvestorView; data: View; f: Fmt; t: T; M: (k: string, s?: "long" | "short", y?: boolean) => string }) {
  const W = 480, H = 222, L = 44, R = 12, T = 30, B = 38, pw = W - L - R, ph = H - T - B;
  const start = x.deals.map((dl) => dl.start.slice(0, 7)).sort()[0];
  const end = x.deals.map((dl) => dl.end.slice(0, 7)).sort().slice(-1)[0];
  if (!start || !end) return null;
  const ms: string[] = [];
  for (let k = start; k <= end && ms.length < 60; k = addMonths(k, 1)) ms.push(k);
  const n = ms.length, cw = pw / n, capital = Math.max(x.capital, 1);
  let cum = 0;
  const pts = x.months.map((m) => {
    cum += m.share;
    return { m, cum, i: ms.indexOf(m.key) };
  }).filter((p) => p.i >= 0);
  const top = Math.max(capital, cum) * 1.16, base = T + ph;
  const X = (i: number) => L + (i + 0.5) * cw, Y = (v: number) => T + ph * (1 - v / top);
  const step = top > 40000 ? 20000 : top > 15000 ? 10000 : top > 6000 ? 2000 : 1000;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const ti = ms.indexOf(data.today.slice(0, 7));
  const tx = ti >= 0 ? L + (ti + Number(data.today.slice(8, 10)) / 31) * cw : null;
  const path = pts.map((p) => `L${X(p.i).toFixed(1)},${Y(p.cum).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const capEnd = fmtDate(f.loc, x.deals.map((dl) => dl.end).sort().slice(-1)[0], { day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="mch">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("chartAria", { cap: f.money(capital), cum: f.money(last?.cum ?? 0), n: pts.length })}>
        <g className="gl">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={Y(v).toFixed(1)} y2={Y(v).toFixed(1)} />
              <text x={L - 8} y={(Y(v) + 3.5).toFixed(1)} textAnchor="end">{v ? `${f.n(v / 1000)} k` : "0"}</text>
            </g>
          ))}
        </g>
        {pts.map((p) => (
          <g className="hc" key={p.m.key} data-tip={t("chartTip", { month: cap(M(p.m.key, "long", true)), v: f.money(p.m.share), cum: f.n(p.cum), p: f.n((p.cum / capital) * 100, 1), state: stateOf(t, p.m) })}>
            <rect x={(L + p.i * cw).toFixed(1)} y={T} width={cw.toFixed(1)} height={ph} />
            <line className="xh" x1={X(p.i).toFixed(1)} x2={X(p.i).toFixed(1)} y1={T} y2={base} />
          </g>
        ))}
        {last && <path className="ar" d={`M${X(pts[0].i).toFixed(1)},${base} ${path} L${X(last.i).toFixed(1)},${base} Z`} pointerEvents="none" />}
        {last && <path className="c-ln" d={`M${X(pts[0].i).toFixed(1)},${Y(pts[0].cum).toFixed(1)} ${path}`} pointerEvents="none" />}
        <line className="cap" x1={L} x2={W - R} y1={Y(capital).toFixed(1)} y2={Y(capital).toFixed(1)} pointerEvents="none" />
        <circle className="capd" cx={W - R} cy={Y(capital).toFixed(1)} r="4.5" />
        <text className="capl" x={W - R} y={(Y(capital) + 17).toFixed(1)} textAnchor="end">{t("capLabel", { v: f.n(capital) })}</text>
        <text className="capl2" x={W - R} y={(Y(capital) + 31).toFixed(1)} textAnchor="end">{t("capBack", { date: capEnd })}</text>
        {pts.map((p) => <circle key={p.m.key} className={`c-dot${p.m.settled ? "" : " o"}`} cx={X(p.i).toFixed(1)} cy={Y(p.cum).toFixed(1)} r="4.5" pointerEvents="none" />)}
        {last && <text className="c-end" x={(X(last.i) - 7).toFixed(1)} y={(Y(last.cum) - 11).toFixed(1)} textAnchor="end">{f.n(last.cum)}</text>}
        {tx != null && (
          <g className="nw" pointerEvents="none">
            <line x1={tx.toFixed(1)} x2={tx.toFixed(1)} y1={T - 5} y2={base} />
            <circle cx={tx.toFixed(1)} cy={T - 5} r="3.5" />
            <text x={tx.toFixed(1)} y={T - 13} textAnchor="middle">{t("today")}</text>
          </g>
        )}
        {ms.map((k, i) => (
          <g key={k}>
            <text className={`xl${i === ti ? " cur" : ""}`} x={X(i).toFixed(1)} y={base + 16} textAnchor="middle">{n > 14 && i % 2 ? "" : M(k, "short")}</text>
            {(i === 0 || k.endsWith("-01")) && <text className="yr" x={X(i).toFixed(1)} y={base + 30} textAnchor="middle">{k.slice(0, 4)}</text>}
          </g>
        ))}
      </svg>
    </div>
  );
}

function InvestorDrawer({ x, data, f, t, M, D, canManage, consoleHref, onClose }: {
  x: InvestorView; data: View; f: Fmt; t: T; canManage: boolean; consoleHref: (tab: string) => string; onClose: () => void;
  M: (k: string, s?: "long" | "short", y?: boolean) => string; D: (iso: string, y?: boolean) => string;
}) {
  const since = x.deals.map((dl) => dl.start).sort()[0];
  const lastEnd = x.deals.map((dl) => dl.end).sort().slice(-1)[0];
  const sh = (icon: ReactNode, title: string, meta?: string) => (
    <div className="sh">{icon}<h4>{title}</h4>{meta && <span className="m">{meta}</span>}</div>
  );
  return (
    <>
      <div className={`dr-h h-${x.hue}`}>
        <Avatar x={x} size={48} />
        <div className="dh-t">
          <h3 id="inv-dr-title">{x.name}</h3>
          <p>{t("drSub", { month: since ? M(since.slice(0, 7), "long", true) : "—", deals: x.deals.map((dl) => `${dl.productName} · ${t("kindShare", { pct: f.n(dl.sharePct) })}`).join(" · ") })}</p>
          <Rhythm x={x} t={t} D={D} />
        </div>
        <DrawerClose onClose={onClose} label={t("close")} />
      </div>
      <div className={`dr-b h-${x.hue}`}>
        <div className="dfig">
          <div><small>{t("fCapital")}</small><b><Money f={f} v={x.capital} /></b>{lastEnd && <em>{t("dCapitalEm", { date: D(lastEnd, true) })}</em>}</div>
          <div><small>{t("fEarned")}</small><b><Money f={f} v={x.earned} /></b><em>{t("dEarnedEm", { p: f.n(x.roc) })}</em></div>
          <div><small><i className="sw s-paid" />{t("fPaid")}</small><b className={x.paid ? "" : "z"}>{x.paid ? <Money f={f} v={x.paid} /> : "0"}</b><em>{x.payments.length ? t("payments", { n: x.payments.length }) : t("dPaidNone")}</em></div>
          <div><small><i className="sw s-due" />{t("fDue")}</small><b className={x.due ? "" : "z"}>{x.due ? <Money f={f} v={x.due} /> : "0"}</b><em>{x.due && x.nextPayout ? t("nextPay", { date: D(x.nextPayout) }) : t("dDueNone")}</em></div>
        </div>

        <section className="dr-sec">
          {sh(<TrendingUp className="ic" aria-hidden />, t("chartTitle"), t("chartMeta"))}
          <div className="clg"><span><i className="lk" />{t("lgCap")}</span><span><i className="la" />{t("lgCum")}</span><span><i className="ld" />{t("lgSettled")}</span><span><i className="ld o" />{t("lgOpen")}</span></div>
          <MoneyChart x={x} data={data} f={f} t={t} M={M} />
        </section>

        {x.deals.map((dl) => {
          const own = x.months.filter((m) => m.key >= dl.start.slice(0, 7));
          const mx = Math.max(1, ...own.map((m) => m.profit));
          return (
            <section className="dr-sec" key={dl.id}>
              {sh(<Package className="ic" aria-hidden />, t("dealTitle"), t("kindShare", { pct: f.n(dl.sharePct) }))}
              <dl className="terms">
                <dt>{t("termProduct")}</dt><dd>{dl.productName}</dd>
                <dt>{t("termDeal")}</dt><dd>{t("termDealV", { pct: f.n(dl.sharePct), product: dl.productName })} <small>{t("termDealS")}</small></dd>
                <dt>{t("termCapital")}</dt><dd><Money f={f} v={dl.capital} /> <small>{t("termCapitalS", { date: D(dl.end, true) })}</small></dd>
                <dt>{t("termLength")}</dt><dd>{D(dl.start, true)} → {D(dl.end, true)} <small>{t("termLengthS", { n: dl.monthsTotal, i: dl.monthIdx })}</small></dd>
                <dt>{t("termPay")}</dt><dd>{cap(t(`cadence.${x.cadence}`))} <small>{t("termPayS")}</small></dd>
              </dl>
              {x.deals.length === 1 && own.length > 0 && (
                <>
                  <div className="mt">
                    <div className="mr hd"><span>{t("colMonth")}</span><span /><span>{t("colProduct")}</span><span>{t("colShare")}</span></div>
                    {own.map((m) => (
                      <div className="mr" key={m.key} data-tip={t("rowTip", { month: cap(M(m.key, "long", true)), product: dl.productName, profit: f.money(m.profit), pct: f.n(dl.sharePct), v: f.money(m.share), state: stateOf(t, m) })}>
                        <b>{M(m.key, "short")}</b>
                        <span className="pb" style={{ ["--w" as string]: `${((Math.max(0, m.profit) / mx) * 100).toFixed(1)}%`, ["--s" as string]: `${dl.sharePct}%` }}><i /></span>
                        <span className="n mu">{f.n(m.profit)}</span>
                        <span className="n">{f.n(m.share)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mlg"><span><i style={{ background: "rgba(15,23,40,.12)" }} />{t("lgProduct")}</span><span><i style={{ background: "var(--a5)" }} />{t("lgSharePct", { pct: f.n(dl.sharePct) })}</span></div>
                </>
              )}
            </section>
          );
        })}

        <section className="dr-sec">
          {sh(<FileText className="ic" aria-hidden />, t("stmtTitle"), t("stmtMeta", { n: x.months.length }))}
          {x.months.slice().reverse().map((m) => (
            <div className="lr" key={m.key}>
              <span className="hold"><FileText className="ic" aria-hidden /></span>
              <div className="lr-t">
                <b>{cap(M(m.key, "long", true))}</b>
                <small>{x.deals.length === 1 ? t("stmtLine", { pct: f.n(x.deals[0].sharePct), profit: f.n(m.profit), product: x.deals[0].productName }) : x.deals.map((dl) => dl.productName).join(" + ")}</small>
              </div>
              <b className="lr-a"><Money f={f} v={m.share} /></b>
              {m.settled ? <span className="stt ok"><Check className="ic" aria-hidden />{t("inStatement")}</span> : <span className="tag warn">{t("toClose")}</span>}
            </div>
          ))}
        </section>

        <section className="dr-sec">
          {sh(<Wallet className="ic" aria-hidden />, t("payTitle"), x.method ? t(`method.${x.method}`) : undefined)}
          {x.payments.length === 0 ? (
            <div className="empty sm">{t("payNone")}</div>
          ) : (
            <>
              {x.payments.map((p, i) => (
                <div className="lr py" key={`${p.date}-${i}`}>
                  <span className="hold"><Wallet className="ic" aria-hidden /></span>
                  <div className="lr-t"><b>{D(p.date, true)}</b><small>{x.method ? t(`method.${x.method}`) : t("payLine")}</small></div>
                  <b className="lr-a"><Money f={f} v={p.amount} /></b>
                </div>
              ))}
              <div className="tot"><span>{t("payTotal", { n: x.payments.length })}</span><b><Money f={f} v={x.paid} /></b></div>
            </>
          )}
        </section>
      </div>
      {canManage && (
        <div className={`dr-f h-${x.hue}`}>
          <a className="btn sm" href={consoleHref("withdrawals")}><Wallet className="ic" aria-hidden />{t("recordPay")}</a>
          <a className="btn2 sm" href={consoleHref("deals")}>{t("editDeal")}</a>
          <a className="btn2 sm" href={consoleHref("investors")} data-tip={t("consoleTip")}>{t("console")}</a>
        </div>
      )}
    </>
  );
}
