"use client";

// 3 · « Où partent les commandes » and 4 · « Les plus grosses fuites »
// (prototype `flowShell`, `drawFlow`, `leaksBlock`).

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { FAM_TONE, type FamKey } from "@/lib/performance/orders/model";
import { Ic, Trend, Vs, glue, usePerf } from "./ui";

const FAM_ICON: Record<FamKey, string> = {
  junk: "g_commande_invalide",
  autre: "g_autre",
  refus: "g_refus_client",
  injoign: "g_injoignable",
  retour: "ret",
  avant: "stop",
};
export const famTone = (k: FamKey) => `var(--o-${FAM_TONE[k]})`;
export const famIcon = (k: FamKey) => FAM_ICON[k];

function FlowSvg() {
  const { view, t, f, openDrill } = usePerf();
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const A = view.A;
  if (A.n < 30) {
    return (
      <div id="flow" ref={host}>
        <div className="empty">{t("flow.tooFew")}</div>
      </div>
    );
  }
  const W = Math.max(640, width);
  const NW = 12, Y0 = 70, BH = 150, k = BH / A.n;
  const th = (v: number) => Math.max(v ? 2.5 : 0, v * k);
  const alive = [A.n, A.n - A.junk, A.n - A.junk - A.x - A.c, A.up - A.b, A.d];
  const Bs = view.B && !view.B.empty ? view.B.s : null;
  const balive = Bs ? [Bs.n, Bs.n - Bs.junk, Bs.n - Bs.junk - Bs.x - Bs.c, Bs.up - Bs.b, Bs.d] : null;
  const names = [t("flow.received"), t("flow.real"), t("flow.confirmed"), t("flow.left"), t("flow.delivered")];
  const X = [0.01, 0.255, 0.5, 0.745, 0.955].map((x) => x * (W - NW));
  type L = { k: string; n: number; bn: number | null; lab: string; drill: string; open?: boolean };
  const leaks: L[][] = [
    [{ k: "junk", n: A.junk, bn: Bs ? Bs.junk : null, lab: t("flow.lJunk"), drill: "out:junk" }],
    [
      { k: "rej", n: A.x, bn: Bs ? Bs.x : null, lab: t("flow.lRej"), drill: "out:rej" },
      { k: "pend", n: A.c, bn: Bs ? Bs.c : null, lab: t("flow.lCalling"), drill: "bk:c", open: true },
    ],
    [
      { k: "ret", n: A.b, bn: Bs ? Bs.b : null, lab: t("flow.lBefore"), drill: "fam:avant" },
      { k: "pend", n: A.u, bn: Bs ? Bs.u : null, lab: t("flow.lToUpload"), drill: "bk:u", open: true },
    ],
    [
      { k: "ret", n: A.f, bn: Bs ? Bs.f : null, lab: t("flow.lReturned"), drill: "fam:retour" },
      { k: "road", n: A.r, bn: Bs ? Bs.r : null, lab: t("flow.lRoad"), drill: "bk:r", open: true },
    ],
  ];
  const poolY = Y0 + BH + 46, H = poolY + 104;
  const col = (key: string) => `var(--o-${key})`;
  const per = (n: number) => {
    const v = (n / A.n) * 100;
    return f.n(v, v < 1 ? 1 : 0);
  };

  const leakEls: JSX.Element[] = [];
  for (let i = 0; i < 4; i++) {
    let y = Y0 + th(alive[i + 1]);
    leaks[i].forEach((L, j) => {
      if (!L.n) return;
      const h = th(L.n), x1 = X[i] + NW, x2 = X[i] + (X[i + 1] - X[i]) * (j ? 0.78 : 0.34), y2 = poolY;
      const xm = (x1 + x2) / 2;
      const d = `M${x1},${y} C${xm},${y} ${x2 - 30},${y2 - 40} ${x2},${y2} L${x2 + 10},${y2} C${x2 - 20},${y2 - 40} ${xm},${y + h} ${x1},${y + h} Z`;
      const tip = t("flow.leakTip", { l: L.lab, n: L.n, nf: f.n(L.n), per: per(L.n) }) + (L.open ? t("flow.open") : "");
      leakEls.push(
        <g key={`${i}-${j}`} className="fl-leak" data-tip={tip} onClick={() => openDrill(L.drill)}>
          <path d={d} fill={`url(#lg-${L.k})`} opacity={L.open ? 0.55 : undefined} />
          <rect x={x2} y={y2} width={10} height={Math.max(6, h)} rx={3} fill={col(L.k)} {...(L.open ? { fillOpacity: 0.35, stroke: col(L.k), strokeDasharray: "3 3" } : {})} />
          <text className="fl-pl" x={x2 + 18} y={y2 + 13}>{L.lab}</text>
          <text className="fl-pv" x={x2 + 18} y={y2 + 30}>{t("flow.perLine", { nf: f.n(L.n), per: per(L.n) })}</text>
          {L.bn != null && Bs && (
            <text className="fl-pv" x={x2 + 18} y={y2 + 46} style={{ fill: "var(--cB)", fontWeight: 800 }}>
              {t("flow.bPer", { per: f.n((L.bn / Bs.n) * 100) })}
            </text>
          )}
        </g>,
      );
      y += h;
    });
  }

  return (
    <div id="flow" ref={host}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={t("flow.aria", { list: alive.map((v, i) => `${names[i]} ${v}`).join(", ") })}>
        <defs>
          <linearGradient id="fg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={W} y2="0">
            <stop offset="0" style={{ stopColor: "var(--flow-a)" }} />
            <stop offset="1" style={{ stopColor: "var(--flow-b)" }} />
          </linearGradient>
          {["junk", "rej", "ret", "pend", "road"].map((key) => (
            <linearGradient key={key} id={`lg-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: col(key), stopOpacity: 0.75 }} />
              <stop offset="1" style={{ stopColor: col(key), stopOpacity: 0.95 }} />
            </linearGradient>
          ))}
        </defs>
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} className="fl-band" x={X[i] + NW} y={Y0} width={X[i + 1] - X[i] - NW} height={th(alive[i + 1])} fill="url(#fg)" opacity={0.42} />
        ))}
        {leakEls}
        {alive.map((v, i) => {
          const last = i === 4;
          const anchor = last ? "end" : "start";
          const tx = last ? X[i] + NW : X[i];
          return (
            <g key={`n${i}`}>
              <rect x={X[i]} y={Y0} width={NW} height={th(v)} rx={4} fill={last ? "var(--o-del)" : "var(--ink)"} opacity={last ? 1 : 0.85} />
              <text className="fl-st" x={tx} y={Y0 - 44} textAnchor={anchor}>{names[i]}</text>
              <text className="fl-n" x={tx} y={Y0 - 16} textAnchor={anchor} style={last ? { fill: "var(--o-del)" } : undefined}>{f.n(v)}</text>
              <text className="fl-p" x={tx} y={Y0 - 2} textAnchor={anchor}>
                {i ? t("flow.stagePer", { per: Math.round((v / A.n) * 100) }) : "100"}
                {balive && Bs && i > 0 && (
                  <tspan style={{ fill: "var(--cB)", fontWeight: 800 }}>{t("flow.stageB", { per: Math.round((balive[i] / Bs.n) * 100) })}</tspan>
                )}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function Flow() {
  const { view, t, f } = usePerf();
  const { A, P } = view;
  const pctOrDash = (v: number | null) => (v == null ? "—" : f.pct(v));
  return (
    <section className="card">
      <div className="chead">
        <div>
          <h2>{t("flow.title")}</h2>
          <div className="q">{t("flow.q")}</div>
        </div>
        <div className="rt">
          <span className="rate" data-tip={t("flow.confTip")}>
            {t("flow.conf")} <b>{pctOrDash(A.conf)}</b>
            {A.conf != null && <Trend now={A.conf} prev={P.conf} upGood />}
            <Vs v={(s) => s.conf} fmt={pctOrDash} />
          </span>
          <span className="rate" data-tip={t("flow.delivTip")}>
            {t("flow.deliv")} <b>{pctOrDash(A.deliv)}</b>
            {A.deliv != null && <Trend now={A.deliv} prev={P.deliv} upGood />}
            <Vs v={(s) => s.deliv} fmt={pctOrDash} />
          </span>
        </div>
      </div>
      <FlowSvg />
      <div className="fl-f">
        <span>
          <span className="sw k-junk" />
          {t("flow.fJunk")}
        </span>
        <span>
          <span className="sw k-rej" />
          {t("flow.fRej")}
        </span>
        <span>
          <span className="sw k-ret" />
          {t("flow.fRet")}
        </span>
        <span>
          <span className="dashsw" />
          {t("flow.fOpen")}
        </span>
        <span>{t("flow.fThick")}</span>
      </div>
    </section>
  );
}

export function Leaks() {
  const { view, t, f, product, agentName, subLabel, bLabel, openDrill } = usePerf();
  const { A } = view;
  if (A.n < 30 || !view.leaks.length) return null;
  const n1 = (v: number) => f.n(v, v < 10 ? 1 : 0);
  return (
    <section className="card">
      <div className="chead">
        <div>
          <h2>{t("leaks.title")}</h2>
          <div className="q">{t("leaks.q")}</div>
        </div>
      </div>
      <div className="lk">
        {view.leaks.map((r, i) => {
          const segs: [string, number][] = r.subs.length ? r.subs : [[r.key, r.n]];
          const where = r.where;
          const whereTxt = !where
            ? ""
            : where.kind === "spread"
              ? t("leaks.spread")
              : where.kind === "product"
                ? t("leaks.whereProduct", { name: product(where.id)?.name ?? "?", r: where.r, avg: where.avg })
                : t("leaks.whereAgent", { name: agentName(where.id), r: where.r, avg: where.avg });
          return (
            <button key={r.key} type="button" className="lk-row" style={{ "--t": famTone(r.key) } as CSSProperties} onClick={() => openDrill(`fam:${r.key}`)}>
              <span className="rk">{i + 1}</span>
              <span className="lk-t">
                <span className="lk-ic">
                  <Ic n={famIcon(r.key)} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <b>{t(`fam.${r.key}`)}</b>
                  <small>{glue(whereTxt)}</small>
                </span>
              </span>
              <span>
                <span className="lk-bar">
                  {segs.map(([k, v]) => (
                    <i key={k} style={{ width: `${(v / A.n) * 100 * 2.2}%` }} data-tip={`${r.subs.length ? subLabel(k) : t(`fam.${r.key}`)} · ${f.n(v)}`} />
                  ))}
                </span>
                {r.bPer != null && (
                  <span className="lk-bar b" data-tip={t("leaks.bTip", { label: bLabel, per: f.n(r.bPer, 1) })}>
                    <i style={{ width: `${r.bPer * 2.2}%` }} />
                  </span>
                )}
                <span className="lk-sub">
                  {r.subs.length ? (
                    r.subs.slice(0, 3).map(([k, v]) => (
                      <span key={k}>
                        {glue(subLabel(k))} <b>{f.n(v)}</b>
                      </span>
                    ))
                  ) : (
                    <span>{t("leaks.nOrders", { nf: f.n(r.n) })}</span>
                  )}
                </span>
              </span>
              <span className="lk-n">
                <b>{n1(r.per)}</b>
                <small>/100</small>
                <div>
                  {r.bPer != null ? (
                    <span className="vs">
                      <i />B {n1(r.bPer)}
                    </span>
                  ) : (
                    t("leaks.nCmd", { nf: f.n(r.n) })
                  )}
                </div>
              </span>
              <span>
                <Trend now={r.per} prev={r.prevPer} upGood={false} />
              </span>
              <span className="lk-go">
                <Ic n="right" />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
