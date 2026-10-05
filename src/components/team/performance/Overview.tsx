"use client";

// 1 · Ce que sont devenues les commandes — « Aurore calme » (2026-10-05): a sentence with the
// counts, then one bar per outcome on one scale (OutcomeRows). The waffle of 100 is retired:
// counts first, the share small, each figure written once.

import { ORDER, per100, type OKey } from "@/lib/team/performance/model";
import { OutcomeRows } from "@/components/shared/charts/OutcomeRows";
import { Ic, Trend, useTp } from "./ui";

const UP: Record<Exclude<OKey, "pend">, boolean> = { del: true, ret: false, rej: false, junk: false };

export function Overview() {
  const { view, t, f, prevName } = useTp();
  const tm = view.team, w = view.window;
  if (!tm.a) {
    return (
      <section className="card ov">
        <div className="empty">{t("ov.empty")}</div>
      </section>
    );
  }
  const pr = per100(tm);
  const pp = view.teamPrev && view.teamPrev.a ? per100(view.teamPrev) : null;
  const parcels = tm.del + tm.road + tm.ret;
  const hint: Record<OKey, string> = {
    del: t("ov.hDel"),
    ret: t("ov.hRet", { pct: parcels ? f.pct((tm.ret / parcels) * 100) : "—" }),
    rej: t("ov.hRej", { autre: f.n(tm.autre) }),
    junk: t("ov.hJunk"),
    pend: t("ov.hPend"),
  };
  const trend = (k: OKey) => (k === "pend" || !pp ? null : <Trend now={pr[k]} prev={pp[k]} upGood={UP[k]} hide={k === "ret" && w.young} />);

  return (
    <section className="card ov" id="ov">
      <div className="ov-h">
        <h2>{t("ov.title")}</h2>
        <span className="meta">{t("ov.meta", { n: f.n(tm.a), range: `${f.day(w.from)} → ${f.day(w.to)}` })}</span>
      </div>
      <p className="lede">{t.rich("ov.lede", { n: f.n(tm.a), d: f.n(tm.del), b: (c) => <b>{c}</b> })}</p>
      {pp && (
        <div className="lede-s">
          <Trend now={pr.del} prev={pp.del} upGood />
          <span>{t("ov.versus", { prev: prevName })}</span>
        </div>
      )}
      <OutcomeRows
        label={t("ov.title")}
        total={tm.a}
        num={f.n}
        pct={f.pct}
        rows={ORDER.map((k) => ({ key: k, label: t(`o.${k}`), color: `var(--o-${k})`, n: tm[k], hint: hint[k], trend: trend(k), tip: `${t(`o1.${k}`)} = ${t(`oDef.${k}`)}` }))}
      />
      {w.young && (
        <div className="note">
          <Ic n="info" />
          <span>{t("ov.young")}</span>
        </div>
      )}
    </section>
  );
}
