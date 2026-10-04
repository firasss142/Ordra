"use client";

// 1 · Sur 100 commandes attribuées — the waffle and four tiles (prototype `overview`).

import type { CSSProperties } from "react";
import { ORDER, per100, round100, type OKey } from "@/lib/team/performance/model";
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
  const pr = per100(tm), r = round100(pr);
  const pp = view.teamPrev && view.teamPrev.a ? per100(view.teamPrev) : null;
  const range = `${f.day(w.from)} → ${f.day(w.to)}`;
  const parcels = tm.del + tm.road + tm.ret;
  const subs: Record<Exclude<OKey, "pend">, string> = {
    del: t("ov.subDel", { n: tm.del, nf: f.n(tm.del) }),
    ret: t("ov.subRet", { n: f.n(tm.ret), pct: parcels ? f.pct((tm.ret / parcels) * 100) : "—" }),
    rej: t("ov.subRej", { n: f.n(tm.rej), autre: f.n(tm.autre) }),
    junk: t("ov.subJunk", { n: f.n(tm.junk) }),
  };

  const cells: JSX.Element[] = [];
  let i = 0;
  for (const k of ORDER) {
    for (let j = 0; j < r[k]; j++) {
      cells.push(<i key={i} className={`wc k-${k}`} style={{ "--i": i } as CSSProperties} data-k={k} data-tip={t("ov.cellTip", { label: t(`o1.${k}`), n: r[k] })} />);
      i += 1;
    }
  }

  return (
    <section className="card ov" id="ov">
      <div className="waffle" role="img" aria-label={t("ov.aria", { list: ORDER.map((k) => `${r[k]} ${t(`o.${k}`).toLowerCase()}`).join(", ") })}>
        {cells}
      </div>
      <div>
        <div className="ov-h">
          <h2>{t("ov.title")}</h2>
          <span className="meta">{t("ov.meta", { n: f.n(tm.a), range })}</span>
        </div>
        <div className="stats">
          {(["del", "ret", "rej", "junk"] as const).map((k) => (
            <div key={k} className={`st k-${k}`} data-k={k} data-tip={`${t(`o1.${k}`)} = ${t(`oDef.${k}`)}`}>
              <div className="st-h">
                <span className="sw" />
                {t(`o.${k}`)}
                {pp && <Trend now={pr[k]} prev={pp[k]} upGood={UP[k]} hide={k === "ret" && w.young} />}
              </div>
              <div className="st-n">
                <b>{f.n(r[k])}</b>
                <small>/100</small>
              </div>
              <div className="st-s">{subs[k]}</div>
            </div>
          ))}
        </div>
        <div className="ov-f k-pend" data-k="pend">
          <span className="sw" />
          <b>{t("ov.pend", { n: f.n(r.pend) })}</b>
          <span>{t("ov.pendWhere")}</span>
          <span>·</span>
          <span>{t("ov.arrows", { prev: prevName })}</span>
        </div>
        {w.young && (
          <div className="note">
            <Ic n="info" />
            <span>{t("ov.young")}</span>
          </div>
        )}
      </div>
    </section>
  );
}
