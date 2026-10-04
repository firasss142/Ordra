"use client";

// 4 · Par produit — heatmap tiles, products × (team + each ranked agent) (prototype `produits`).

import type { CSSProperties } from "react";
import { Av, Ic, useTp } from "./ui";

const RAMP = ["#E6F9EE", "#C4F1D8", "#97E4BC", "#63D49A", "#36BE7C", "#1EA266", "#118553", "#0B6A43", "#064E33"];
/** Green deepens with livrées pour 100, 0 → 40. */
function tileStyle(v: number): CSSProperties {
  const i = Math.max(0, Math.min(RAMP.length - 1, Math.round((v / 40) * (RAMP.length - 1))));
  return { background: RAMP[i], color: i >= 4 ? "#fff" : "var(--ink)" };
}
const ARABIC = /[؀-ۿ]/;

export function Products() {
  const { view, t, f, agent, dimIf, setFocus } = useTp();
  const P = view.products, cols = P.cols;
  const head = (
    <div className="chead">
      <div>
        <h2>{t("pr.title")}</h2>
        <div className="q">{t("pr.q")}</div>
      </div>
    </div>
  );
  if (!P.rows.length || !cols.length) {
    return (
      <section className="card pr">
        {head}
        <div className="empty">{t("pr.empty")}</div>
      </section>
    );
  }
  return (
    <section className="card pr">
      {head}
      <div className="pr-grid" style={{ gridTemplateColumns: `minmax(150px,1.7fr) repeat(${cols.length + 1},minmax(48px,1fr))` }}>
        <div />
        <div className="pr-h">
          <span className="tm">
            <Ic n="team" />
          </span>
          {t("pr.team")}
        </div>
        {cols.map((id) => (
          <div key={id} className={`pr-h${dimIf(id)}`} onClick={() => setFocus(id)} style={{ cursor: "pointer" }}>
            <Av a={agent(id)} />
            {agent(id).name}
          </div>
        ))}
        {P.rows.map((row) => {
          const tv = row.t[0] ? (row.t[1] / row.t[0]) * 100 : 0;
          return [
            <div key={`${row.id}-p`} className="pr-p">
              <span className="pr-thumb">
                <Ic n="book" />
              </span>
              <div className="pr-t">
                <div className="pr-n" dir={ARABIC.test(row.name) ? "rtl" : "ltr"}>
                  {row.name}
                </div>
                <div className="pr-c">{t("pr.orders", { n: row.t[0], nf: f.n(row.t[0]) })}</div>
              </div>
            </div>,
            <div key={`${row.id}-t`} className="tile team" style={tileStyle(tv)} data-tip={t("pr.teamTip", { d: f.n(row.t[1]), n: f.n(row.t[0]), v: f.n(Math.round(tv)) })}>
              {f.n(Math.round(tv))}
            </div>,
            ...cols.map((id) => {
              const c = row.ag[id] ?? [0, 0];
              const name = agent(id).name;
              if (c[0] < 10) {
                return (
                  <div key={`${row.id}-${id}`} className={`tile na${dimIf(id)}`} data-tip={t("pr.fewTip", { name, n: c[0], nf: f.n(c[0]) })}>
                    —
                  </div>
                );
              }
              const v = (c[1] / c[0]) * 100, weak = c[0] >= 20 && v <= tv - 5;
              return (
                <div
                  key={`${row.id}-${id}`}
                  className={`tile${dimIf(id)}`}
                  style={tileStyle(v)}
                  data-tip={t("pr.tip", { name, d: f.n(c[1]), n: f.n(c[0]), v: f.n(Math.round(v)), team: f.n(Math.round(tv)) }) + (weak ? t("pr.weakTip") : "")}
                >
                  {f.n(Math.round(v))}
                  {weak && <span className="weak">▼{f.n(Math.round(tv - v))}</span>}
                </div>
              );
            }),
          ];
        })}
      </div>
      <div className="pr-f">
        <span>
          <i className="ramp" />
          {t("pr.legRamp")}
        </span>
        <span>
          <i className="wk">▼</i>
          {t("pr.legWeak")}
        </span>
        <span>{t("pr.legFew")}</span>
        {P.others[0] > 0 && <span>{t("pr.others", { n: f.n(P.others[0]), o: f.n(P.others[1]) })}</span>}
      </div>
    </section>
  );
}
