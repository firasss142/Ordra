"use client";

// 1 · the result (waffle + four tiles), the money (owner only), and
// « À regarder » — prototype `hero`, `money`, `watch`.

import Link from "next/link";
import type { CSSProperties } from "react";
import { OUTCOMES } from "@/lib/performance/orders/facts";
import { round100, type Summary } from "@/lib/performance/orders/model";
import type { SumM, WatchCard } from "@/lib/performance/orders/view";
import { Ic, MoneyVal, SW, Trend, Vs, glue, usePerf } from "./ui";

const cA = { "--c": "var(--cA)" } as CSSProperties;
const cB = { "--c": "var(--cB)" } as CSSProperties;

function Waffle({ s, b = false, big = false }: { s: Summary; b?: boolean; big?: boolean }) {
  const { t, openDrill } = usePerf();
  const r = round100(s.p);
  const cells: JSX.Element[] = [];
  let i = 0;
  for (const k of OUTCOMES) {
    for (let j = 0; j < r[k]; j++) {
      const idx = i++;
      cells.push(
        <i
          key={idx}
          className={`wc k-${k}`}
          style={{ "--i": idx } as CSSProperties}
          data-k={b ? undefined : k}
          data-tip={t(b ? "hero.cellB" : "hero.cell", { o: t(`o1.${k}`), n: r[k] })}
          onClick={b ? undefined : () => openDrill(`out:${k}`)}
        />,
      );
    }
  }
  return (
    <div className="waffle" role={big ? "img" : undefined} aria-label={big ? t("hero.waffle", { list: OUTCOMES.map((k) => `${r[k]} ${t(`o.${k}`).toLowerCase()}`).join(", ") }) : undefined}>
      {cells}
    </div>
  );
}

export function Hero() {
  const { view, state, t, f, bLabel, prevName, fullName, selName, agName, openDrill } = usePerf();
  const { A, P, B } = view;
  if (A.n < 30) {
    return (
      <section className="card ov" id="ov">
        <div className="empty" style={{ gridColumn: "1/-1" }}>
          {glue(A.n ? t("hero.tooFew", { n: A.n, nf: f.n(A.n) }) : t("hero.none"))}
        </div>
      </section>
    );
  }
  const r = round100(A.p);
  const hasP = Object.keys(state.sel).length > 0;
  const by = state.ag.length ? t("hero.by", { a: agName(state.ag) }) : "";
  const sub: Record<"del" | "ret" | "rej" | "junk", string> = {
    del: t("hero.subDel", { nf: f.n(A.del) }),
    ret: t("hero.subRet", { nf: f.n(A.ret), pct: f.pct((A.ret / Math.max(1, A.up)) * 100) }),
    rej: t("hero.subRej", { nf: f.n(A.rej), autre: f.n(view.heroAutre) }),
    junk: t("hero.subJunk", { nf: f.n(A.junk) }),
  };
  const up = { del: true, ret: false, rej: false, junk: false };
  const hl = hasP
    ? t.rich("hero.hlSel", { p: selName(state.sel), by, del: r.del, em: (c) => <em>{c}</em> })
    : t.rich("hero.hlAll", { by, del: r.del, em: (c) => <em>{c}</em> });
  return (
    <section className="card ov" id="ov">
      {B ? (
        <div className="wafB">
          <div>
            <div className="wl">
              <span className="tagAB" style={cA}>
                A
              </span>
              {fullName(state.sel, state.ag)}
            </div>
            <Waffle s={A} big />
          </div>
          <div>
            <div className="wl">
              <span className="tagAB" style={cB}>
                B
              </span>
              {bLabel}
            </div>
            {B.s.n < 10 ? <div className="meta">{t("hero.bFew", { nf: f.n(B.s.n) })}</div> : <Waffle s={B.s} b />}
          </div>
        </div>
      ) : (
        <Waffle s={A} big />
      )}
      <div>
        <div className="hl">{hl}</div>
        <div className="hl-s">
          <Trend now={A.p.del} prev={P.p.del} upGood />
          <span>{view.comparable.ok ? t("hero.versusN", { prev: prevName, nf: f.n(P.n) }) : t("hero.versus", { prev: prevName })}</span>
          {B && !B.empty && (
            <span className="vs">
              <i />
              {t("hero.bLine", { label: bLabel, del: Math.round(B.s.p.del) })}
            </span>
          )}
        </div>
        <div className="stats">
          {(["del", "ret", "rej", "junk"] as const).map((k) => (
            <button key={k} type="button" className={`st k-${k}`} data-k={k} data-tip={t("hero.stTip", { o: t(`o1.${k}`), def: t(`odef.${k}`) })} onClick={() => openDrill(`out:${k}`)}>
              <div className="st-h">
                <span className="sw" />
                {t(`o.${k}`)}
                <Trend now={A.p[k]} prev={P.p[k]} upGood={up[k]} />
              </div>
              <div className="st-n">
                <b>{r[k]}</b>
                <small>/100</small>
              </div>
              {B && (
                <div style={{ marginTop: 6 }}>
                  <Vs v={(s) => s.p[k]} />
                </div>
              )}
              <div className="st-s">{glue(sub[k])}</div>
            </button>
          ))}
        </div>
        <div className="ov-f k-pend" data-k="pend">
          <span className="sw" />
          <b>{t("hero.pend", { n: r.pend })}</b>
          <span>{t("hero.pendWhat")}</span>
        </div>
      </div>
    </section>
  );
}

export function Money() {
  const { view, t, f, prevName, bLabel } = usePerf();
  const { A, P, B } = view;
  const m = A.money;
  if (!view.withMoney || !m || !A.n) return null;
  const pm = P.money;
  const bm = B && !B.empty ? B.s : null;
  const tot = m.mDel + m.mLost + m.mRoad;
  const na = <Trend now={0} prev={0} upGood />;

  const tDel = () => {
    if (!view.comparable.ok) return na;
    if (!pm?.mDel) return null;
    const d = Math.round(((m.mDel - pm.mDel) / pm.mDel) * 100);
    if (!d) return <span className="tr eq" data-tip="=">=</span>;
    return (
      <span className={`tr ${d > 0 ? "good" : "bad"}`} data-tip={t("trend.prev", { prev: prevName, v: f.money(pm.mDel) })}>
        <Ic n={d > 0 ? "up" : "dn"} />
        {f.pct(Math.abs(d))}
      </span>
    );
  };
  const tLost = () => {
    if (!view.comparable.ok) return na;
    const p = pm?.lostShare ?? null;
    if (p == null || m.lostShare == null) return null;
    const d = Math.round(m.lostShare) - Math.round(p);
    if (!d) return <span className="tr eq" data-tip="=">=</span>;
    return (
      <span className={`tr ${d > 0 ? "bad" : "good"}`} data-tip={t("money.lostShareTip", { prev: prevName, pct: f.pct(p) })}>
        <Ic n={d > 0 ? "up" : "dn"} />
        {t("money.pts", { n: f.n(Math.abs(d)) })}
      </span>
    );
  };
  const bv = (txt: string, tip: string) =>
    bm ? (
      <div style={{ marginTop: 6 }}>
        <span className="vs" data-tip={`B · ${bLabel} · ${tip}`}>
          <i />B {txt}
        </span>
      </div>
    ) : null;
  const bmm = bm?.money;

  return (
    <section className="card money">
      <div className="chead">
        <div>
          <h2>{t("money.title")}</h2>
          <div className="q">{t("money.q")}</div>
        </div>
        <div className="rt">
          <span className="lock" data-tip={t("money.lockTip")}>
            <Ic n="lock" />
            {t("money.lock")}
          </span>
        </div>
      </div>
      <div className="mny">
        <div className="mtile k-del" data-tip={glue(t("money.delTip"))}>
          <div className="st-h">
            <span className="sw" />
            {t("money.del")}
            {tDel()}
          </div>
          <div className="mval">
            <MoneyVal v={m.mDel} />
          </div>
          {bm && bmm && bv(f.money(bmm.mDel), t("money.bDel", { nf: f.n(bm.d), per: bm.n ? f.money(bmm.mDel / bm.n) : "—" }))}
          <div className="st-s">
            {t("money.delSub", { n: A.d, nf: f.n(A.d), per: f.money(m.mDel / A.n) })}
          </div>
        </div>
        <div className="mtile k-ret" data-tip={t("money.lostTip")}>
          <div className="st-h">
            <span className="sw" />
            {t("money.lost")}
            {tLost()}
          </div>
          <div className="mval">
            <MoneyVal v={m.mLost} />
          </div>
          {bm && bmm && bv(f.money(bmm.mLost), t("money.bLost", { pct: bmm.lostShare == null ? "—" : f.pct(bmm.lostShare) }))}
          <div className="st-s">{t("money.lostSub", { nf: f.n(A.f + A.b), pct: m.lostShare == null ? "—" : f.pct(m.lostShare) })}</div>
        </div>
        <div className="mtile road k-road" data-tip={t("money.roadTip")}>
          <div className="st-h">
            <span className="sw" />
            {t("money.road")}
          </div>
          <div className="mval">
            <MoneyVal v={m.mRoad} />
          </div>
          <div className="st-s">{t("money.roadSub", { nf: f.n(A.r) })}</div>
        </div>
      </div>
      {tot > 0 && (
        <div className="mbar" role="img" aria-label={t("money.bar", { a: f.money(m.mDel), b: f.money(m.mLost), c: f.money(m.mRoad) })}>
          {(
            [
              ["del", m.mDel, t("money.del")],
              ["ret", m.mLost, t("money.lost")],
              ["road", m.mRoad, t("money.road")],
            ] as const
          ).map(([k, v, l]) =>
            v ? <i key={k} className={`k-${k}`} style={{ flex: v }} data-tip={t("money.barTip", { l, v: f.money(v), pct: f.pct((v / tot) * 100) })} /> : null,
          )}
        </div>
      )}
    </section>
  );
}

export function Watch({ locale }: { locale: string }) {
  const { view, state, t, f, agentName, selName, openDrill } = usePerf();
  const card = (c: WatchCard, i: number) => {
    let tone = "var(--o-del)";
    let icon = "check";
    let h = "";
    let p = "";
    let a: JSX.Element | null = null;
    if (c.kind === "intake") {
      tone = "var(--o-rej)";
      icon = "stop";
      const pn = Object.keys(state.sel).length ? ` « ${selName(state.sel)} »` : "";
      h = t("watch.intakeH", { p: pn, day: f.day(c.last) });
      const since = c.since ? t("watch.sinceSome", { n: f.n(c.since) }) : t("watch.sinceNone");
      p = c.adsOn
        ? t("watch.intakeOn", { since, quiet: c.quiet })
        : c.lastAd
          ? t("watch.intakeOff", { since, quiet: c.quiet, ad: f.day(c.lastAd) })
          : t("watch.intakeOffNoDay", { since, quiet: c.quiet });
      a = (
        <Link className="link" href={`/${locale}/finance/ad-spend`}>
          {t("watch.adsLink")} <Ic n="ext" />
        </Link>
      );
    } else if (c.kind === "stuck") {
      tone = "var(--o-ret)";
      icon = "clock";
      h = t("watch.stuckH", { n: c.n, nf: f.n(c.n) });
      p = t("watch.stuckP", { day: f.day(c.oldest) });
      a = (
        <button type="button" className="link" onClick={() => openDrill("stuck")}>
          {t("watch.see", { nf: f.n(c.n) })} <Ic n="right" />
        </button>
      );
    } else if (c.kind === "autre") {
      tone = "var(--o-junk)";
      icon = "g_autre";
      h = t("watch.autreH", { nf: f.n(c.n) });
      p = c.top ? t("watch.autrePBy", { per: c.per, nf: f.n(c.top.n), agent: agentName(c.top.agent) }) : t("watch.autreP", { per: c.per });
      a = (
        <button type="button" className="link" onClick={() => openDrill("fam:autre")}>
          {t("watch.see", { nf: f.n(c.n) })} <Ic n="right" />
        </button>
      );
    } else if (c.kind === "city") {
      tone = "var(--o-ret)";
      icon = "truck";
      h = t("watch.cityH", { city: c.city });
      p = t("watch.cityP", { r: f.pct(c.r), rest: f.pct(c.rest), nf: f.n(c.n) });
      a = (
        <Link className="link" href={`/${locale}/carriers`}>
          {t("watch.cityLink")} <Ic n="ext" />
        </Link>
      );
    } else {
      h = t("watch.okH");
      p = t("watch.okP");
    }
    return (
      <div key={i} className="w" style={{ "--t": tone } as CSSProperties}>
        <div className="w-h">
          <span className="w-ic">
            <Ic n={icon} />
          </span>
          <b>{glue(h)}</b>
        </div>
        <p>{glue(p)}</p>
        {a}
      </div>
    );
  };
  return (
    <section>
      <div className="chead" style={{ padding: "0 2px 12px" }}>
        <div>
          <h2>{t("watch.title")}</h2>
        </div>
      </div>
      <div className="watch">{view.watch.map(card)}</div>
    </section>
  );
}

export type { SumM };
