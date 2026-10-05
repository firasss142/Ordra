"use client";

// The blocks of Accueil, calm version (2026-10-05): a header with the doors to
// Performance, one summary card (two hero figures — orders received and the
// revenue cashed — rounded bars of orders received, what 100 of them became, the
// profit) and one light card per store. Every figure arrives
// computed from the API; the page only draws.

import { type CSSProperties } from "react";
import Link from "next/link";
import { OUTCOMES, type Outcome } from "@/lib/performance/orders/facts";
import { toBars } from "@/lib/dashboard/stores/bars";
import type { FlowCol, StoreCard as Card, Summ } from "@/lib/dashboard/stores/view";
import { DateButton, type DpState } from "./Dates";
import { Ic, MoneyVal, NB, StoreLogo, TrendPct, TrendPts, hueVars, moneyText, useHome } from "./ui";

// ── header ──────────────────────────────────────────────────────────────────

export function Header({ dp, setDp }: { dp: DpState | null; setDp: (d: DpState | null) => void }) {
  const c = useHome();
  const { view: v, t, f } = c;
  const ok = v.A.final >= 90;
  return (
    <header className="ph">
      <div>
        <h1>{t("head.hello", { name: c.userName })}</h1>
        <div className="sub">
          <span>
            {c.isToday
              ? t.rich("head.subToday", { market: c.marketName, date: f.dayLong(v.today), time: c.hm(v.nowMin), b: (ch) => <b>{ch}</b> })
              : t.rich("head.subRange", { market: c.marketName, from: f.day(v.window.from), to: f.day(v.window.to), b: (ch) => <b>{ch}</b> })}
          </span>
          {v.A.n > 0 && !c.isToday && (
            <span className={`fin${ok ? "" : " warn"}`} data-tip={t("head.finalTip")}>
              <i />
              {t("head.final", { pct: f.pct(v.A.final) })}
            </span>
          )}
        </div>
      </div>
      <div className="ph-r">
        <nav className="doors">
          <Link className="door" href={c.href("performance/orders")}>
            <Ic n="funnel" />
            {t("all.doorOrders")}
          </Link>
          <Link className="door" href={c.href("team/performance")}>
            <Ic n="team" />
            {t("all.doorTeam")}
          </Link>
          <Link className="door" href={c.href("carriers")}>
            <Ic n="route" />
            {t("all.doorDelivery")}
          </Link>
        </nav>
        <DateButton dp={dp} setDp={setDp} />
      </div>
    </header>
  );
}


// ── the bars of orders received ─────────────────────────────────────────────

/** Orders received: rounded bars by day (by week beyond 45 days, by hour today), the current one in full colour, a dashed average. */
function BarChart({ cols, compact }: { cols: FlowCol[]; compact?: boolean }) {
  const c = useHome();
  const { t, f } = c;
  const b = toBars(cols);
  const max = Math.max(1, b.max);
  const lab = (k: string) => (c.isToday ? t("all.hour", { h: k }) : f.day(k));
  const tip = (x: (typeof b.bars)[number]) =>
    x.fut
      ? t("all.colFuture", { label: lab(x.from) })
      : b.weekly
        ? t("all.weekTip", { from: f.day(x.from), to: f.day(x.to), n: x.n })
        : t("all.pointTip", { label: lab(x.from), n: x.n });
  const name = compact ? t("card.hoursL") : c.isToday ? t("all.curveToday") : b.weekly ? t("all.chartWeeks") : t("all.curveRange");
  const every = b.bars.length <= 10 ? 1 : c.isToday ? 3 : Math.ceil(b.bars.length / 6);
  const unit = c.isToday ? t("all.unitHour") : b.weekly ? t("all.unitWeek") : t("all.unitDay");
  const avg = f.n(b.avg, b.avg < 10 ? 1 : 0);
  const grid = { gridTemplateColumns: `repeat(${b.bars.length},minmax(0,1fr))`, "--gap": `${b.bars.length <= 10 ? 18 : b.bars.length <= 31 ? 6 : 3}px` } as CSSProperties;
  return (
    <div className={`chart${compact ? " compact" : ""}`} role="img" aria-label={name}>
      <div className="plot">
        {b.avg > 0 && !compact && (
          <div className="avg" style={{ bottom: `${((b.avg / max) * 100).toFixed(2)}%` }} data-tip={t("all.avgTip", { n: avg, unit })}>
            <span>{t("all.avg", { n: avg })}</span>
          </div>
        )}
        <div className="bars" style={grid}>
          {b.bars.map((x, j) => (
            <div key={x.from} className={`bc${j === b.hot ? " hot" : ""}${x.fut ? " fut" : ""}`} data-tip={tip(x)}>
              {j === b.hot && !x.fut && <em>{f.n(x.n)}</em>}
              <i style={{ height: x.fut ? undefined : `${Math.max(x.n ? 2 : 0, (x.n / max) * 100).toFixed(2)}%` }} />
            </div>
          ))}
        </div>
      </div>
      <div className="xl" style={grid}>
        {b.bars.map((x, j) => (
          <span key={x.from}>{j % every === 0 || j === b.bars.length - 1 ? (b.weekly ? f.day(x.from) : lab(x.from)) : ""}</span>
        ))}
      </div>
    </div>
  );
}

// ── what the orders became ──────────────────────────────────────────────────

type Outcomes = Pick<Summ, "k" | "r100">;

/** Count first, share second: « 147 livrées (18 %) » — never « sur 100 ». */
function outcomeWords(t: ReturnType<typeof useHome>["t"], f: ReturnType<typeof useHome>["f"], s: Outcomes, keys: readonly Outcome[]) {
  return keys.map((k) => t("out.item", { n: f.n(s.k[k] ?? 0), o: t(`ol.${k}`), pct: f.pct(s.r100[k] ?? 0) })).join(" · ");
}

export function OutcomeBar({ s }: { s: Outcomes }) {
  const { t, f } = useHome();
  const shown = OUTCOMES.filter((k) => s.k[k] > 0);
  return (
    <>
      <div className="obar" role="img" aria-label={`${t("out.title")} : ${outcomeWords(t, f, s, OUTCOMES)}`}>
        {shown.map((k) => (
          <i key={k} className={`k-${k}`} style={{ flexGrow: s.k[k], flexBasis: 0 }} data-tip={outcomeWords(t, f, s, [k])} />
        ))}
      </div>
      <div className="oleg">
        {shown.map((k) => (
          <span key={k} className={`k-${k}`}>
            <i />
            <b>{f.n(s.k[k])}</b>
            {t(`ol.${k}`)}
            <small>{f.pct(s.r100[k])}</small>
          </span>
        ))}
      </div>
    </>
  );
}

// ── 1 · the summary card ────────────────────────────────────────────────────

function Cell({ label, tr, children, hint }: { label: string; tr?: React.ReactNode; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div>
      <div className="lbl">
        {label}
        {tr}
      </div>
      <div className="val">{children}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/** One of the two figures the page leads with. */
function Hero({ icon, tone, label, tr, children, hint }: { icon: string; tone: string; label: string; tr?: React.ReactNode; children: React.ReactNode; hint: React.ReactNode }) {
  return (
    <div className={`hero ${tone}`}>
      <span className="hi">
        <Ic n={icon} />
      </span>
      <div>
        <div className="hl">{label}</div>
        <div className="hn">
          <b>{children}</b>
          {tr}
        </div>
        <div className="meta">{hint}</div>
      </div>
    </div>
  );
}

export function Summary({ pop, setPop }: { pop: boolean; setPop: (o: boolean) => void }) {
  const c = useHome();
  const { view: v, t, f } = c;
  const A = v.A;
  if (!A.n) {
    return (
      <section className="card sum">
        <div className="empty">
          {c.isToday ? t("all.emptyToday", { market: c.marketName }) : t("all.emptyRange", { market: c.marketName, from: f.day(v.window.from), to: f.day(v.window.to) })}
          <small>
            {v.lastOrder && t("all.emptyLast", { day: f.day(v.lastOrder.day), store: v.lastOrder.store ?? "—" })}
            {t("all.emptyHint")}
          </small>
        </div>
      </section>
    );
  }
  const perDay = A.n / v.window.len;
  const m = c.isToday ? null : v.money;
  const conf = <>{A.conf == null ? "—" : f.n(Math.round(A.conf))}<small>{NB}%</small></>;

  let cells: React.ReactNode[];
  if (c.isToday) {
    cells = [
      <Cell key="conf" label={t("tile.confirmed")}>{conf}</Cell>,
      <Cell key="call" label={t("tile.toCall")} hint={t("tile.toCallSub")}>{f.n(A.calling)}</Cell>,
      <Cell key="rej" label={t("tile.rejected")}>{f.n(A.rejAll)}</Cell>,
    ];
  } else if (c.owner && m) {
    cells = [
      <div key="profit" className="money">
        <div className="lbl">
          {t("tile.profit")}
          <TrendPct now={m.cur.profit} prev={m.prev?.profit ?? null} ok={v.comparable && (m.prev?.profit ?? 0) > 0} fmt={(x) => moneyText(f, x)} />
        </div>
        <div className={`val${m.cur.profit < 0 ? " neg" : ""}`}>
          <MoneyVal v={m.cur.profit} />
        </div>
        <button type="button" className="why" data-pop="profit" onClick={() => setPop(!pop)} aria-expanded={pop}>
          <Ic n="info" />
          {t("tile.why")}
        </button>
        {pop && <ProfitPop />}
      </div>,
    ];
  } else {
    cells = [
      <Cell key="conf" label={t("tile.confirmed")} tr={<TrendPts now={A.conf ?? 0} prev={v.P.conf ?? 0} upGood ok={v.comparable} />} hint={t("tile.confirmedSub")}>
        {conf}
      </Cell>,
    ];
  }

  return (
    <section className="card sum">
      <div className="heroes">
        <Hero
          icon="box"
          tone="o"
          label={t("all.eyebrow")}
          tr={<TrendPct now={A.n} prev={v.P.n} ok={v.countOk} fmt={(x) => f.n(x)} />}
          hint={c.isToday ? t("period.todayRange", { day: f.day(v.today), time: c.hm(v.nowMin) }) : t("all.perDay", { n: f.n(perDay, perDay < 10 ? 1 : 0) })}
        >
          {f.n(A.n)}
        </Hero>
        {c.owner && m && (
          <Hero
            icon="cash"
            tone="ca"
            label={t("tile.paid")}
            tr={<TrendPct now={m.cur.paid} prev={m.prev?.paid ?? null} ok={v.comparable} fmt={(x) => moneyText(f, x)} />}
            hint={t("tile.paidSub", { n: f.n(A.d) })}
          >
            <MoneyVal v={m.cur.paid} />
          </Hero>
        )}
      </div>
      <BarChart cols={v.flow} />
      <div className="sum-bot" style={{ "--cells": c.isToday ? 2 : cells.length } as CSSProperties}>
        {c.isToday ? (
          cells[0]
        ) : (
          <div>
            <div className="lbl">
              {t("out.title")}
              <TrendPts now={A.p.del} prev={v.P.p.del} upGood ok={v.comparable} />
            </div>
            <OutcomeBar s={A} />
          </div>
        )}
        {c.isToday ? cells.slice(1) : cells}
      </div>
    </section>
  );
}

function ProfitPop() {
  const c = useHome();
  const { view: v, t, f } = c;
  const m = v.money!.cur;
  const line = (l: string, s: string | null, val: number) => (
    <>
      <span>
        {l}
        {s && <small>{s}</small>}
      </span>
      <b>{moneyText(f, val)}</b>
    </>
  );
  return (
    <div className="pop" role="dialog" aria-label={t("profit.dialog")}>
      <h4>{t("profit.title")}</h4>
      <div className="pl">
        {line(t("profit.paid"), t("profit.paidSub", { n: f.n(v.A.d) }), m.paid)}
        {line(t("profit.cogs"), t("profit.cogsSub"), -m.cogs)}
        {line(t("profit.carrier"), v.money!.failedFree ? t("profit.carrierFree") : t("profit.carrierRet"), -m.carrier)}
        {line(t("profit.packing"), t("profit.packingSub", { n: f.n(v.A.up) }), -m.packing)}
        {m.processing > 0 && line(t("profit.processing"), t("profit.processingSub"), -m.processing)}
        {line(t("profit.ads"), t("profit.adsSub"), -m.ads)}
        <span className="tot">{t("profit.total")}</span>
        <b className="tot">{moneyText(f, m.profit)}</b>
      </div>
      <div className="pnote">{t.rich("profit.note", { from: f.day(v.window.from), to: f.day(v.window.to), b: (ch) => <b>{ch}</b> })}</div>
      <Link className="link" href={c.href("dashboard/pnl")}>
        {t("profit.open")} <Ic n="ext" />
      </Link>
    </div>
  );
}

// ── 2 · one card per store ──────────────────────────────────────────────────

/** The ring of what the store's orders became, soft colours, the delivered count in its middle. */
function Ring({ s }: { s: Outcomes }) {
  const { t, f } = useHome();
  const R = 64;
  const C = 2 * Math.PI * R;
  const gap = 4;
  const tot = OUTCOMES.reduce((a, k) => a + (s.k[k] || 0), 0) || 1;
  let acc = 0;
  const segs = OUTCOMES.map((k) => {
    const x = s.k[k] || 0;
    if (!x) return null;
    const len = (x / tot) * C;
    const whole = x === tot;
    const vis = whole ? C : Math.max(len - gap, 1.5);
    const off = -acc - (whole ? 0 : gap / 2);
    acc += len;
    return (
      <circle
        key={k}
        className={`sg k-${k}`}
        cx="80"
        cy="80"
        r={R}
        strokeDasharray={`${vis.toFixed(2)} ${(C + 10).toFixed(2)}`}
        strokeDashoffset={off.toFixed(2)}
        data-tip={t("card.ringTip", { o: t(`o.${k}`), n: f.n(x), pct: f.pct(s.r100[k]) })}
      />
    );
  });
  return (
    <svg className="ringsvg" viewBox="0 0 160 160" role="img" aria-label={outcomeWords(t, f, s, OUTCOMES)}>
      <circle className="ringtrack" cx="80" cy="80" r={R} />
      <g transform="rotate(-90 80 80)">{segs}</g>
    </svg>
  );
}

/** The card's footer: a soft box, a tinted icon, a few words, the detail underneath. */
function Note({ x }: { x: Card }) {
  const c = useHome();
  const { t, f } = c;
  const n = x.note;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const box = (k: string, icon: string, title: string, sub: string, act?: React.ReactNode) => (
    <div className={`note ${k}`}>
      <span className="ni">
        <Ic n={icon} />
      </span>
      <div>
        <b>{title}</b>
        <small>{sub}</small>
      </div>
      {act}
    </div>
  );
  switch (n.kind) {
    case "broken": {
      const since = n.broken.since;
      const title = !since
        ? t("note.brokenNoTime")
        : c.dayOf(since) === c.view.today
          ? t("note.broken", { time: c.timeOf(since) })
          : t("note.brokenDay", { day: f.day(c.dayOf(since)) });
      return box(
        "bad",
        "plug",
        title,
        t("note.brokenSub", { n: n.broken.n }),
        <Link className="act" href={c.href("system/connections")} onClick={stop}>
          {t("note.brokenAct")}
        </Link>,
      );
    }
    case "stopped":
      return box(
        "bad",
        "moon",
        t("note.stopped", { day: f.day(n.stop.since) }),
        t("note.stoppedSub", { recent: f.n(n.stop.recent), days: f.n(n.stop.days), usual: f.n(n.stop.usual) }) + (c.view.ads ? t("note.stoppedAds") : ""),
      );
    case "unmapped":
      return box(
        "warn",
        "link",
        t("note.unmapped", { n: n.n }),
        t("note.unmappedSub", { platform: t(`platform.${x.platform}`) }),
        <Link className="act" href={c.href("mappings")} onClick={stop}>
          {t("note.unmappedAct")}
        </Link>,
      );
    case "todayOk":
      return box("ok", "check", t("note.todayOk"), t("note.todayOkSub", { ago: c.ago(x.lastAt) }));
    case "new":
      return box("new", "spark", t("note.new"), t("note.newSub", { day: x.firstDay ? f.day(x.firstDay) : "—" }));
    case "few":
      return box("ok", "clock", t("note.few"), t("note.fewSub"));
    case "best":
      return box("good", "star", t("note.best"), t("note.vsMarket", { del: n.del, mkt: n.mkt }));
    case "below":
      return box("warn", "alert", t("note.below"), t("note.vsMarket", { del: n.del, mkt: n.mkt }));
    default:
      return box("ok", "check", t("note.ok"), t("note.vsMarket", { del: n.del, mkt: n.mkt }));
  }
}

/** Today: the store's orders hour by hour, the same bars as the summary, smaller. */
function HourBars({ x }: { x: Card }) {
  const c = useHome();
  const nowH = Math.floor(c.view.nowMin / 60);
  const cols: FlowCol[] = (x.hours ?? []).map((tot, h) => ({ k: String(h), tot, by: [], fut: h > nowH, now: h === nowH }));
  return (
    <div className="sc-hours">
      <BarChart cols={cols} compact />
    </div>
  );
}

function StoreCard({ x, n, onOpen }: { x: Card; n: number; onOpen: (id: string) => void }) {
  const c = useHome();
  const { t, f } = c;
  const a = x.a;
  const early = a.n < 30;
  const pfName = t(`platform.${x.platform}`);
  const at = x.lastAt ? (c.dayOf(x.lastAt) === c.view.today ? t("card.atToday", { time: c.timeOf(x.lastAt) }) : t("card.atDay", { day: f.day(c.dayOf(x.lastAt)), time: c.timeOf(x.lastAt) })) : "";
  const open = () => onOpen(x.id);
  const cell = (l: string, v: React.ReactNode, e: string, zero: boolean) => (
    <div>
      <small>{l}</small>
      <b className={zero ? "z" : ""}>{v}</b>
      <em>{e}</em>
    </div>
  );
  const conf = a.conf == null ? "—" : f.pct(Math.round(a.conf));

  let vis: React.ReactNode;
  if (c.isToday) vis = <HourBars x={x} />;
  else if (early)
    vis = (
      <div className="sc-ring">
        <svg className="ringsvg" viewBox="0 0 160 160" aria-hidden="true">
          <circle className="ringtrack dash" cx="80" cy="80" r="64" />
        </svg>
        <div className="rc early">
          <div className="l">{t("card.earlyL")}</div>
          <div className="h">{t("card.earlyH")}</div>
        </div>
      </div>
    );
  else
    vis = (
      <div className="sc-ring">
        <Ring s={a} />
        <div className="rc">
          <b>{f.n(a.k.del)}</b>
          <div className="l">{t("card.ringL")}</div>
          <div className="p">
            {f.pct(a.r100.del)}
            <TrendPts now={a.p.del} prev={x.prev?.p.del ?? null} upGood ok={x.comparable} />
          </div>
        </div>
      </div>
    );

  const mini = c.isToday ? (
    <>
      {cell(t("card.confirmed"), conf, t("card.confirmedSub"), a.conf == null)}
      {cell(t("card.toCall"), f.n(a.calling), t("card.toCallSub"), !a.calling)}
      {cell(t("card.rejected"), f.n(a.rejAll), t("card.rejectedSub"), !a.rejAll)}
    </>
  ) : (
    <>
      {/* the owner reads the money first; a manager has no money, so rejections close the row */}
      {c.owner && cell(t("card.paid"), <MoneyVal v={x.paid ?? 0} small />, t("card.paidSub", { n: f.n(a.d) }), !x.paid)}
      {cell(t("card.confirmed"), conf, t("card.confirmedSub"), !a.conf)}
      {cell(t("card.returned"), f.n(a.k.ret), t("card.returnedSub"), !a.k.ret)}
      {!c.owner && cell(t("card.rejected"), f.n(a.rejAll), t("card.rejectedSub"), !a.rejAll)}
    </>
  );

  const prods = x.products;
  return (
    <article
      className="card sc"
      data-card={x.id}
      role="button"
      tabIndex={0}
      style={{ ...hueVars(x.hue), "--n": n } as CSSProperties}
      aria-label={t("card.aria", { name: x.name })}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
    >
      <div className="sc-h">
        <StoreLogo name={x.name} logo={x.logo} platform={x.platform} />
        <div className="sc-n">
          <b>{x.name}</b>
          <span className="pfl" data-tip={x.sheets ? t("card.viaSheets", { platform: pfName }) : undefined}>
            {pfName}
          </span>
        </div>
        {x.lastAt && (
          <span className={`fresh${x.alarm ? " quiet" : x.dot === "live" ? " live" : ""}`} data-tip={t("card.freshTip", { at })}>
            <i />
            {c.ago(x.lastAt)}
          </span>
        )}
      </div>
      <div className="sc-cnt">
        <b>{f.n(a.n)}</b>
        <span>
          {t("card.received", { n: a.n })}
          <small>{t("card.share", { pct: f.pct(Math.round(x.share)) })}</small>
        </span>
        <TrendPct now={a.n} prev={x.prevN} ok={c.view.countOk} fmt={(v) => f.n(v)} />
      </div>
      <div className="sc-share">
        <i style={{ width: `${Math.max(1.5, x.share).toFixed(1)}%` }} />
      </div>
      {prods.length > 0 && (
        <div className="prods">
          {prods.slice(0, 2).map((p) => (
            <span key={p} className="pc" data-tip={p}>
              <Ic n="tag" />
              <span>{p}</span>
            </span>
          ))}
          {prods.length > 2 && (
            <span className="pc more" data-tip={prods.slice(2).join(" · ")}>
              +{prods.length - 2}
            </span>
          )}
        </div>
      )}
      {vis}
      <div className="mini">{mini}</div>
      <Note x={x} />
    </article>
  );
}

export function StoresBlock({ onOpen }: { onOpen: (id: string) => void }) {
  const c = useHome();
  const { view: v, t } = c;
  if (!v.stores.length) return null;
  const rows = [...v.stores].sort((a, b) => b.n - a.n);
  return (
    <section>
      <div className="sec-h">
        <h2>{t("stores.title")}</h2>
        <div className="meta">{t("stores.meta")}</div>
      </div>
      <div className="cards">
        {rows.map((x, n) => (
          <StoreCard key={x.id} x={x} n={n} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}
