"use client";

// 1 · the result (a sentence + one bar per outcome, Aurore calme), the money (owner only), and
// « À regarder » — prototype `hero`, `money`, `watch`.

import Link from "next/link";
import type { CSSProperties } from "react";
import { OUTCOMES, type Outcome } from "@/lib/performance/orders/facts";
import { OutcomeRows } from "@/components/shared/charts/OutcomeRows";
import type { SumM, WatchCard } from "@/lib/performance/orders/view";
import { Ic, MoneyVal, Trend, Vs, glue, usePerf } from "./ui";

export function Hero() {
  const { view, state, t, f, prevName, selName, agName, bLabel, openDrill } = usePerf();
  const { A, P, B } = view;
  if (A.n < 30) {
    return (
      <section className="card ov" id="ov">
        <div className="empty">{glue(A.n ? t("hero.tooFew", { n: A.n, nf: f.n(A.n) }) : t("hero.none"))}</div>
      </section>
    );
  }
  const hasP = Object.keys(state.sel).length > 0;
  const by = state.ag.length ? t("hero.by", { a: agName(state.ag) }) : "";
  const hint: Record<Outcome, string> = {
    del: t("hero.hDel"),
    ret: t("hero.hRet", { pct: f.pct((A.ret / Math.max(1, A.up)) * 100) }),
    rej: t("hero.hRej", { autre: f.n(view.heroAutre) }),
    junk: t("hero.hJunk"),
    pend: t("hero.hPend"),
  };
  const up: Record<Outcome, boolean | null> = { del: true, ret: false, rej: false, junk: false, pend: null };
  const em = (c: React.ReactNode) => <em>{c}</em>;
  // Aurore calme (2026-10-05): the sentence says counts, not « sur 100 ».
  const hl = hasP
    ? t.rich("hero.hlSel", { n: f.n(A.n), p: selName(state.sel), by, del: f.n(A.del), em })
    : t.rich("hero.hlAll", { n: f.n(A.n), by, del: f.n(A.del), em });
  return (
    <section className="card ov" id="ov">
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
      <OutcomeRows
        label={t("hero.rows")}
        total={A.n}
        num={f.n}
        pct={f.pct}
        rows={OUTCOMES.map((k) => ({
          key: k,
          label: t(`o.${k}`),
          color: `var(--o-${k})`,
          n: A[k],
          hint: glue(hint[k]),
          tip: t("hero.stTip", { o: t(`o1.${k}`), def: t(`odef.${k}`) }),
          trend:
            up[k] === null ? null : (
              <>
                {B && <Vs v={(x) => x.p[k]} />}
                <Trend now={A.p[k]} prev={P.p[k]} upGood={up[k] as boolean} />
              </>
            ),
          onClick: () => openDrill(`out:${k}`),
        }))}
      />
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
