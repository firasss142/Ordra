"use client";

// The blocks of Accueil, in the prototype's order and with its markup
// (prototypes/dashboard-v2.html: header · banner · allStores · storesBlock ·
// quietRow · defs). Every figure arrives computed from the API.

import { useId, type CSSProperties } from "react";
import Link from "next/link";
import { OUTCOMES, type Outcome } from "@/lib/performance/orders/facts";
import type { FlowCol, StoreCard as Card } from "@/lib/dashboard/stores/view";
import { DateButton, type DpState } from "./Dates";
import {
  Ic,
  MoneyVal,
  NB,
  PLATFORM_GLYPH,
  TrendPct,
  TrendPts,
  glue,
  hueVars,
  initials,
  moneyText,
  useHome,
} from "./ui";

export type Sort = "cmd" | "liv" | "paye";

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
            <span className={`pill${ok ? "" : " warn"}`} data-tip={t("head.finalTip")}>
              <Ic n={ok ? "check" : "clock"} />
              {t("head.final", { pct: f.pct(v.A.final) })}
            </span>
          )}
        </div>
      </div>
      <DateButton dp={dp} setDp={setDp} />
    </header>
  );
}

// ── banner: a market-wide fact that explains the cards below it ──────────────

export function Banner() {
  const c = useHome();
  const a = c.view.ads;
  if (!a) return null;
  return (
    <div className="banner">
      <span className="bi">
        <Ic n="mega" />
      </span>
      <div>
        <b>{c.t("banner.title", { day: c.f.day(a.since) })}</b>
        <p>{glue(c.t("banner.body", { ccy: c.f.sym, days: a.days, n: a.todayOrders }))}</p>
      </div>
      {c.owner && (
        <Link className="btn2" href={c.href("finance/ad-spend")}>
          {c.t("banner.open")} <Ic n="ext" />
        </Link>
      )}
    </div>
  );
}

// ── 1 · all stores ──────────────────────────────────────────────────────────

const pctS = (f: ReturnType<typeof useHome>["f"], v: number) => (v < 1 ? `< 1${NB}%` : f.pct(v));

function Tile({ cls = "", icon, label, tr, children, sub }: { cls?: string; icon: React.ReactNode; label: string; tr?: React.ReactNode; children: React.ReactNode; sub: string }) {
  return (
    <div className={`st sm ${cls}`}>
      <div className="st-h">
        {icon}
        {label}
        {tr}
      </div>
      <div className="st-n">{children}</div>
      <div className="st-s">{sub}</div>
    </div>
  );
}

export function AllStores({ pop, setPop, onGo }: { pop: boolean; setPop: (o: boolean) => void; onGo: (id: string) => void }) {
  const c = useHome();
  const { view: v, t, f } = c;
  const A = v.A;
  if (!A.n) {
    return (
      <section className="card sum">
        <div className="sum-h">
          <div>
            <h2>{t("all.title")}</h2>
            <div className="meta">{t("all.connected", { market: c.marketName, n: v.connected })}</div>
          </div>
        </div>
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
  const rows = v.stores;
  const max = Math.max(1, ...rows.map((x) => x.n));
  const perDay = A.n / v.window.len;
  const sw = (k: Outcome) => <span className={`sw k-${k}`} />;
  const m = v.money;

  let sec: React.ReactNode;
  if (c.isToday) {
    sec = (
      <>
        <Tile icon={<Ic n="phone" />} label={t("tile.confirmed")} sub={t("tile.confirmedToday", { up: f.n(A.up), dec: f.n(A.up + A.rejAll) })}>
          <b>{A.conf == null ? "—" : f.n(Math.round(A.conf))}</b>
          <small>{NB}%</small>
        </Tile>
        <Tile icon={<Ic n="clock" />} label={t("tile.toCall")} sub={t("tile.toCallSub")}>
          <b>{f.n(A.calling)}</b>
        </Tile>
        <Tile cls="k-rej" icon={sw("rej")} label={t("tile.rejected")} sub={t("tile.rejectedSub", { n: f.n(A.never) })}>
          <b>{f.n(A.rejAll)}</b>
        </Tile>
      </>
    );
  } else if (c.owner && m) {
    sec = (
      <>
        <Tile cls="k-del" icon={sw("del")} label={t("tile.delivered")} tr={<TrendPts now={A.p.del} prev={v.P.p.del} upGood ok={v.comparable} />} sub={t("tile.deliveredSub", { n: f.n(A.d) })}>
          <b>{A.r100.del}</b>
          <small>/100</small>
        </Tile>
        <Tile icon={<Ic n="coins" />} label={t("tile.paid")} tr={<TrendPct now={m.cur.paid} prev={m.prev?.paid ?? null} ok={v.comparable} fmt={(x) => moneyText(f, x)} />} sub={t("tile.paidSub", { n: f.n(A.d) })}>
          <b>
            <MoneyVal v={m.cur.paid} />
          </b>
        </Tile>
        <div className={`st sm${m.cur.profit < 0 ? " neg" : ""}`}>
          <div className="st-h">
            <Ic n="trend" />
            {t("tile.profit")}
            <TrendPct now={m.cur.profit} prev={m.prev?.profit ?? null} ok={v.comparable && (m.prev?.profit ?? 0) > 0} fmt={(x) => moneyText(f, x)} />
          </div>
          <div className="st-n">
            <b>
              <MoneyVal v={m.cur.profit} />
            </b>
          </div>
          <button type="button" className="why" data-pop="profit" onClick={() => setPop(!pop)} aria-expanded={pop}>
            <Ic n="info" />
            {t("tile.why")}
          </button>
          {pop && <ProfitPop />}
        </div>
      </>
    );
  } else {
    sec = (
      <>
        <Tile cls="k-del" icon={sw("del")} label={t("tile.delivered")} tr={<TrendPts now={A.p.del} prev={v.P.p.del} upGood ok={v.comparable} />} sub={t("tile.deliveredSub", { n: f.n(A.d) })}>
          <b>{A.r100.del}</b>
          <small>/100</small>
        </Tile>
        <Tile icon={<Ic n="phone" />} label={t("tile.confirmed")} tr={<TrendPts now={A.conf ?? 0} prev={v.P.conf ?? 0} upGood ok={v.comparable} />} sub={t("tile.confirmedSub")}>
          <b>{A.conf == null ? "—" : f.n(Math.round(A.conf))}</b>
          <small>{NB}%</small>
        </Tile>
        <Tile cls="k-ret" icon={sw("ret")} label={t("tile.returned")} tr={<TrendPts now={A.p.ret} prev={v.P.p.ret} upGood={false} ok={v.comparable} />} sub={t("tile.returnedSub", { n: f.n(A.ret) })}>
          <b>{A.r100.ret}</b>
          <small>/100</small>
        </Tile>
      </>
    );
  }

  return (
    <section className="card sum" id="mix">
      <div className="sum-top">
        <div className="tot">
          <span className="eyebrow">{t("all.eyebrow")}</span>
          <div className="tot-n">
            <b>{f.n(A.n)}</b>
            <TrendPct now={A.n} prev={v.P.n} ok={v.countOk} fmt={(x) => f.n(x)} />
          </div>
          <div className="meta">
            {c.isToday
              ? t("all.metaToday", { time: c.hm(v.nowMin), n: f.n(v.P.n) })
              : t("all.metaRange", { perDay: f.n(perDay, perDay < 10 ? 1 : 0), n: rows.length })}
          </div>
          <div className="slist">
            {rows.map((x) => (
              <button key={x.id} type="button" className="srow" data-store={x.id} onClick={() => onGo(x.id)} style={hueVars(x.hue)}>
                <i className="sq" />
                <span className="sn">{x.name}</span>
                <span className="sbar">
                  <i style={{ width: `${Math.max(2, (x.n / max) * 100).toFixed(1)}%` }} />
                </span>
                <b>{f.n(x.n)}</b>
                <small>{pctS(f, x.share)}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="flow">
          <div className="flow-h">
            <span className="eyebrow">{c.isToday ? t("all.flowToday") : t("all.flowRange")}</span>
            <div className="doors">
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
            </div>
          </div>
          <Columns cols={v.flow} multi />
        </div>
      </div>
      <div className="t3">{sec}</div>
    </section>
  );
}

/** The arrival of orders, stacked by store — hour by hour today, day by day otherwise (prototype `columns`). */
export function Columns({ cols, multi }: { cols: FlowCol[]; multi: boolean }) {
  const c = useHome();
  const { t, f, view } = c;
  const hue = new Map(view.stores.map((s) => [s.id, s]));
  const mx = Math.max(1, ...cols.map((x) => x.tot));
  const lab = (k: string) => (c.isToday ? t("all.hour", { h: k }) : f.day(k));
  const step = c.isToday ? 3 : Math.ceil(cols.length / 7);
  const g = { gridTemplateColumns: `repeat(${cols.length},minmax(0,1fr))` };
  return (
    <>
      <div className="cols" style={g}>
        {cols.map((col) => {
          const tip = col.fut
            ? t("all.colFuture", { label: lab(col.k) })
            : t("all.colTip", { label: lab(col.k), n: col.tot }) + (multi ? col.by.map(([id, n]) => ` · ${hue.get(id)?.name ?? ""} ${f.n(n)}`).join("") : "");
          return (
            <div key={col.k} className={`col${col.fut ? " fut" : ""}${col.now ? " now" : ""}`} data-tip={tip}>
              {col.by.map(([id, n]) => {
                const s = hue.get(id);
                return <i key={id} data-store={id} style={{ ...(s ? hueVars(s.hue) : {}), height: `${((n / mx) * 100).toFixed(2)}%` }} />;
              })}
            </div>
          );
        })}
      </div>
      <div className="clab" style={g}>
        {cols.map((col, j) => (
          <span key={col.k}>{j % step === 0 ? lab(col.k) : ""}</span>
        ))}
      </div>
    </>
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

function Ring({ r100 }: { r100: Record<Outcome, number> }) {
  const { t } = useHome();
  const id = useId().replace(/:/g, "");
  const Rr = 66;
  const Cc = 2 * Math.PI * Rr;
  const gap = 3.2;
  const tot = OUTCOMES.reduce((s, k) => s + (r100[k] || 0), 0);
  let acc = 0;
  const segs = OUTCOMES.map((k) => {
    const x = r100[k] || 0;
    if (!x) return null;
    const len = (x / tot) * Cc;
    const vis = tot === x ? Cc : Math.max(len - gap, 1.2);
    const off = -acc - (tot === x ? 0 : gap / 2);
    acc += len;
    return (
      <circle
        key={k}
        className={`sg k-${k}`}
        cx="84"
        cy="84"
        r={Rr}
        strokeDasharray={`${vis.toFixed(2)} ${(Cc + 10).toFixed(2)}`}
        strokeDashoffset={off.toFixed(2)}
        data-tip={t("card.ringTip", { o: t(`o.${k}`), n: x, def: t(`odef.${k}`) })}
      />
    );
  });
  return (
    <svg className="ringsvg" viewBox="0 0 168 168" aria-hidden="true">
      <circle className="ringtrack" cx="84" cy="84" r={Rr} />
      <defs>
        <mask id={`m${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="168" height="168">
          <circle className="sweep" cx="84" cy="84" r={Rr} transform="rotate(-90 84 84)" />
        </mask>
      </defs>
      <g mask={`url(#m${id})`}>
        <g className="segs" transform="rotate(-90 84 84)">
          {segs}
        </g>
      </g>
    </svg>
  );
}

function Note({ x }: { x: Card }) {
  const c = useHome();
  const { t, f } = c;
  const n = x.note;
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
  const stop = (e: React.MouseEvent) => e.stopPropagation();
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
        <Link className="act" href={c.href("system/connections")} onClick={stop} title={n.broken.msg || undefined}>
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

function StoreCard({ x, n, onOpen }: { x: Card; n: number; onOpen: (id: string) => void }) {
  const c = useHome();
  const { t, f } = c;
  const a = x.a;
  const early = a.n < 30;
  const pfName = t(`platform.${x.platform}`);
  const cell = (l: string, v: React.ReactNode, e: string, z: boolean) => (
    <div>
      <small>{l}</small>
      <b className={z ? "z" : ""}>{v}</b>
      <em>{e}</em>
    </div>
  );
  let vis: React.ReactNode;
  if (c.isToday) {
    const cols: FlowCol[] = (x.hours ?? []).map((tot, h) => ({
      k: String(h),
      tot,
      by: tot ? [[x.id, tot]] : [],
      fut: h > Math.floor(c.view.nowMin / 60),
      now: h === Math.floor(c.view.nowMin / 60),
    }));
    vis = (
      <div className="sc-hours">
        <Columns cols={cols} multi={false} />
      </div>
    );
  } else {
    vis = (
      <div className="sc-ring">
        {early ? (
          <>
            <svg className="ringsvg" viewBox="0 0 168 168" aria-hidden="true">
              <circle className="ringtrack dash" cx="84" cy="84" r="66" />
            </svg>
            <div className="rc early">
              <div className="l">{t("card.earlyL")}</div>
              <div className="h">{t("card.earlyH")}</div>
            </div>
          </>
        ) : (
          <>
            <Ring r100={a.r100} />
            <div className="rc">
              <div className="big">
                <b>{a.r100.del}</b>
                <small>/100</small>
              </div>
              <div className="l">{t("card.ringL")}</div>
              <TrendPts now={a.p.del} prev={x.prev?.p.del ?? null} upGood ok={x.comparable} />
            </div>
          </>
        )}
      </div>
    );
  }
  const prods = x.products;
  const mini = c.isToday ? (
    <>
      {cell(t("card.confirmed"), a.conf == null ? "—" : f.pct(Math.round(a.conf)), t("card.confirmedToday", { n: f.n(a.up) }), a.conf == null)}
      {cell(t("card.toCall"), f.n(a.calling), t("card.toCallSub"), !a.calling)}
      {cell(t("card.rejected"), f.n(a.rejAll), t("card.rejectedSub", { n: f.n(a.never) }), !a.rejAll)}
    </>
  ) : (
    <>
      {cell(t("card.confirmed"), a.conf == null ? "—" : f.pct(Math.round(a.conf)), t("card.confirmedSub"), !a.conf)}
      {cell(t("card.delivered"), f.n(a.d), t("card.deliveredSub"), !a.d)}
      {c.owner
        ? cell(t("card.paid"), <MoneyVal v={x.paid ?? 0} small />, t("card.paidSub"), !x.paid)
        : cell(
            t("card.returned"),
            early ? (
              f.n(a.ret)
            ) : (
              <>
                {a.r100.ret}
                <span className="ccy">/100</span>
              </>
            ),
            t("card.returnedSub", { n: f.n(a.ret) }),
            !a.ret,
          )}
    </>
  );
  const at = x.lastAt ? (c.dayOf(x.lastAt) === c.view.today ? t("card.atToday", { time: c.timeOf(x.lastAt) }) : t("card.atDay", { day: f.day(c.dayOf(x.lastAt)), time: c.timeOf(x.lastAt) })) : "";
  const open = () => onOpen(x.id);
  return (
    <article
      className="sc"
      data-store={x.id}
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
        <span className="sav">
          {initials(x.name)}
          {x.dot && <i className={`dot${x.dot === "idle" ? "" : ` ${x.dot}`}`} />}
        </span>
        <div className="sc-n">
          <b>{x.name}</b>
          <span className="pfl" data-tip={x.sheets ? t("card.viaSheets", { platform: pfName }) : pfName}>
            <i className="pg">{PLATFORM_GLYPH[x.platform]}</i>
            <span>{pfName}</span>
          </span>
        </div>
        {x.lastAt && (
          <span className={`fresh${x.alarm ? " quiet" : ""}`} data-tip={t("card.freshTip", { at })}>
            <Ic n="clock" />
            {c.ago(x.lastAt)}
          </span>
        )}
      </div>
      <div className="sc-cnt">
        <b>{f.n(a.n)}</b>
        <span>
          {t("card.received", { n: a.n })}
          <small>{t("card.share", { pct: pctS(f, x.share) })}</small>
        </span>
        <TrendPct now={a.n} prev={x.prevN} ok={c.view.countOk} fmt={(v) => f.n(v)} />
      </div>
      <div className="sc-share">
        <i style={{ width: `${Math.max(1.5, x.share).toFixed(1)}%` }} />
      </div>
      <div className="prods">
        {prods.length === 1 ? (
          <>
            <span className="pc">
              <Ic n="tag" />
              {prods[0]}
            </span>
            <span className="meta">{t("card.unique")}</span>
          </>
        ) : (
          <>
            {prods.slice(0, 2).map((p) => (
              <span key={p} className="pc">
                <Ic n="tag" />
                {p}
              </span>
            ))}
            {prods.length > 2 && (
              <span className="pc more" data-tip={prods.slice(2).join(" · ")}>
                +{prods.length - 2}
              </span>
            )}
          </>
        )}
      </div>
      {vis}
      <div className="mini">{mini}</div>
      <Note x={x} />
    </article>
  );
}

export function StoresBlock({ sort, setSort, onOpen }: { sort: Sort; setSort: (s: Sort) => void; onOpen: (id: string) => void }) {
  const c = useHome();
  const { view: v, t } = c;
  if (!v.stores.length) return <QuietRow alone />;
  const s: Sort = !c.owner && sort === "paye" ? "cmd" : sort;
  const key = (x: Card) => (s === "liv" ? (x.n >= 30 ? x.a.p.del : -1) : s === "paye" ? (x.paid ?? 0) : x.n);
  const rows = [...v.stores].sort((a, b) => key(b) - key(a) || b.n - a.n);
  const sorts: [Sort, string][] = [
    ["cmd", t("stores.sortCmd")],
    ["liv", t("stores.sortLiv")],
    ...(c.owner ? ([["paye", t("stores.sortPaye")]] as [Sort, string][]) : []),
  ];
  return (
    <section>
      <div className="sec-h">
        <div>
          <h2>{t("stores.title")}</h2>
          <div className="meta">{c.isToday ? t("stores.metaToday") : t("stores.metaRange")}</div>
        </div>
        <div className="rt">
          {!c.isToday && (
            <div className="legend">
              {OUTCOMES.map((k) => (
                <span key={k}>
                  <i className={`sw k-${k}`} />
                  {t(`o.${k}`)}
                </span>
              ))}
            </div>
          )}
          <div className="seg" role="tablist" aria-label={t("stores.sort")}>
            <span>{t("stores.sort")}</span>
            {sorts.map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={s === k} className={s === k ? "on" : ""} onClick={() => setSort(k)}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="cards" id="cards">
        {rows.map((x, n) => (
          <StoreCard key={x.id} x={x} n={n} onOpen={onOpen} />
        ))}
      </div>
      <QuietRow alone={false} />
    </section>
  );
}

// ── 3 · stores with nothing in the period — one line, not empty cards ────────

function QuietRow({ alone }: { alone: boolean }) {
  const c = useHome();
  const { view: v, t, f } = c;
  const add = c.owner ? (
    <Link className="qchip qadd" href={c.href("system/connections")}>
      <Ic n="plus" />
      {t("quiet.add")}
    </Link>
  ) : null;
  if (!v.quiet.length) return add ? <div className="quiet">{add}</div> : null;
  return (
    <div className="quiet" style={alone ? { marginTop: 0 } : undefined}>
      <Ic n="moon" />
      <span>{t("quiet.line", { n: v.quiet.length })}</span>
      {v.quiet.map((q) => (
        <Link key={q.id} className="qchip" style={hueVars("slate")} href={c.href("system/connections")}>
          <span className="sav">{initials(q.name)}</span>
          <span>
            <b>{q.name}</b>
            <small>{q.lastDay ? t("quiet.last", { day: f.day(q.lastDay) }) : q.notYet ? t("quiet.notYet") : t("quiet.never")}</small>
          </span>
          <i className="pg" data-tip={t(`platform.${q.platform}`)}>
            {PLATFORM_GLYPH[q.platform]}
          </i>
        </Link>
      ))}
      {add}
    </div>
  );
}

export function Defs() {
  const { t } = useHome();
  return (
    <details className="defs">
      <summary>{t("defs.summary")}</summary>
      <div>{t.rich("defs.body", { b: (ch) => <b>{ch}</b> })}</div>
    </details>
  );
}
