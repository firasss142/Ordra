"use client";

// 5 · « Par produit » / « Par taille », 6 · « Par agent », 7 · « Jour après
// jour », and « Comment lire cette page » (prototype `products`, `agentsBlock`,
// `daysBlock`, `defs`). A row click filters the whole page; a second click on
// the only selected row clears it.

import Link from "next/link";
import type { CSSProperties } from "react";
import { OUTCOMES } from "@/lib/performance/orders/facts";
import { Av, Ic, Sbar, TagAB, ThinB, Thumb, glue, usePerf } from "./ui";
import { famTone } from "./Flow";

function Delta({ d, tip }: { d: number; tip: string }) {
  const { f } = usePerf();
  const r = Math.round(d);
  return (
    <span className={`tr ${r > 0 ? "good" : r < 0 ? "bad" : "eq"}`} data-tip={tip}>
      {r ? (
        <>
          <Ic n={r > 0 ? "up" : "dn"} />
          {f.n(Math.abs(r))}
        </>
      ) : (
        "="
      )}
    </span>
  );
}

function Legend() {
  const { t } = usePerf();
  return (
    <div className="rt legend">
      {OUTCOMES.map((k) => (
        <span key={k} className={`k-${k}`}>
          <span className="sw" />
          {t(`o1.${k}`)}
        </span>
      ))}
    </div>
  );
}

export function ByProduct() {
  const { view, state, t, f, product, agName, bLabel, setState } = usePerf();
  const bp = view.byProduct;
  const one = bp.mode === "sizes" ? bp.productId : null;
  const who = state.ag.length ? t("byProduct.who", { a: agName(state.ag) }) : "";
  const ks = Object.keys(state.sel);
  const showThin = !!view.B && !view.B.empty && (state.cmp?.kind === "d" || state.cmp?.kind === "a");
  const q = one
    ? t("byProduct.qSizes", { p: product(one)?.name ?? "?", who })
    : ks.length
      ? t("byProduct.qSel", { who })
      : t("byProduct.qAll", { who });
  const head = (
    <div className="chead">
      <div>
        <h2>{one ? t("byProduct.titleSizes") : t("byProduct.title")}</h2>
        <div className="q">
          {glue(q)} {t("byProduct.click")}
          {showThin ? t("byProduct.thinB", { label: bLabel }) : ""}
        </div>
      </div>
      <Legend />
    </div>
  );
  if (!bp.rows.length) {
    return (
      <section className="card">
        {head}
        <div className="empty">{t("byProduct.tooFew")}</div>
      </section>
    );
  }
  const what = one ? t("byProduct.refOne") : t("byProduct.refAll");
  const pick = (id: string, v: string | null) => {
    if (v == null) {
      const only = ks.length === 1 && state.sel[id] === null;
      setState({ ...state, sel: only ? {} : { [id]: null } });
    } else {
      const s = state.sel[id];
      const only = Array.isArray(s) && s.length === 1 && s[0] === v;
      setState({ ...state, sel: { [id]: only ? null : [v] } });
    }
  };
  return (
    <section className="card">
      {head}
      <div className="pr">
        {bp.rows.map((r) => {
          const s = r.s;
          const label = r.variant ? product(r.id)?.sizes.find((z) => z.id === r.variant)?.label ?? "?" : product(r.id)?.name ?? "?";
          return (
            <button key={`${r.id}:${r.variant ?? ""}`} type="button" className={`pr-row${r.a ? " sel" : r.b ? " selb" : ""}${r.ok ? "" : " thin"}`} onClick={() => pick(r.id, r.variant)}>
              <span className="pr-p">
                <Thumb id={r.id} />
                <span style={{ minWidth: 0 }}>
                  <b>
                    {r.a && <TagAB w="A" />}
                    {r.b && <TagAB w="B" />}
                    {label}
                  </b>
                  <small>{t("byProduct.rowSub", { nf: f.n(s.n), pct: f.pct(s.conf ?? 0) })}</small>
                </span>
              </span>
              <span>
                <Sbar s={s} />
                <ThinB s={r.thinB} />
                {r.ok &&
                  (r.leak ? (
                    <span className="leakchip" style={{ "--t": famTone(r.leak.key) } as CSSProperties}>
                      <i />
                      {t("byProduct.leak", { f: t(`fam.${r.leak.key}`).toLowerCase(), ex: Math.round(r.leak.ex) })}
                    </span>
                  ) : (
                    <span className="leakchip" style={{ "--t": "var(--o-del)" } as CSSProperties}>
                      <i />
                      {t("byProduct.noLeak")}
                    </span>
                  ))}
              </span>
              <span className="pr-v">
                {r.ok && r.delta != null ? (
                  <>
                    <b>{Math.round(s.p.del)}</b>
                    <small>/100</small>
                    <div>
                      <Delta d={r.delta} tip={t("byProduct.deltaTip", { ref: Math.round(bp.refDel), what })} />
                    </div>
                  </>
                ) : (
                  <small style={{ whiteSpace: "normal", display: "block", lineHeight: 1.3 }}>{t("byProduct.few")}</small>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <div className="cfoot">
        <span>{t("byProduct.foot", { what, who })}</span>
      </div>
    </section>
  );
}

export function ByAgent({ locale }: { locale: string }) {
  const { view, state, t, f, agentName, selName, bLabel, setState } = usePerf();
  const ba = view.byAgent;
  const hasP = Object.keys(state.sel).length > 0;
  const on = hasP ? t("byAgent.on", { p: selName(state.sel) }) : "";
  const showThin = !!view.B && !view.B.empty && (state.cmp?.kind === "d" || state.cmp?.kind === "p");
  const head = (
    <div className="chead">
      <div>
        <h2>{t("byAgent.title")}</h2>
        <div className="q">
          {glue(t("byAgent.q", { on, marked: state.ag.length ? t("byAgent.marked") : "" }))}
          {showThin ? t("byProduct.thinB", { label: bLabel }) : ""}
        </div>
      </div>
      <div className="rt">
        <Link className="link" href={`/${locale}/team/performance`}>
          {t("byAgent.link")} <Ic n="ext" />
        </Link>
      </div>
    </div>
  );
  if (ba.tooFew) {
    return (
      <section className="card agents">
        {head}
        <div className="empty">{t("byAgent.tooFew")}</div>
      </section>
    );
  }
  const team = ba.teamRd == null ? "—" : f.n(Math.round(ba.teamRd));
  return (
    <section className="card agents">
      {head}
      <div className="pr">
        {ba.rows.map((r) => {
          const s = r.s;
          return (
            <button
              key={r.id}
              type="button"
              className={`pr-row${r.a ? " sel" : r.b ? " selb" : ""}${r.ok ? "" : " thin"}`}
              data-tip={t("byAgent.rowTip", { name: agentName(r.id), nf: f.n(s.n), d: f.n(s.d), j: f.n(s.junk) })}
              onClick={() => setState({ ...state, ag: state.ag.length === 1 && state.ag[0] === r.id ? [] : [r.id] })}
            >
              <span className="pr-p">
                {r.rank != null && (
                  <span className="rk" style={{ width: 22, height: 22, fontSize: 11 }}>
                    {r.rank}
                  </span>
                )}
                <Av id={r.id} />
                <span style={{ minWidth: 0 }}>
                  <b>
                    {r.a && <TagAB w="A" />}
                    {r.b && <TagAB w="B" />}
                    {agentName(r.id)}
                  </b>
                  <small>{t("byAgent.rowSub", { nf: f.n(s.n), pct: f.pct(s.conf ?? 0) })}</small>
                </span>
              </span>
              <span>
                <Sbar s={s} />
                <ThinB s={r.thinB} />
                <span className="leakchip" style={{ "--t": "var(--o-junk)" } as CSSProperties}>
                  <i />
                  {t("byAgent.junk", { pct: f.n(s.p.junk) })}
                </span>
              </span>
              <span className="pr-v">
                {r.ok && r.rd != null && r.delta != null ? (
                  <>
                    <b>{Math.round(r.rd)}</b>
                    <small>/100</small>
                    <div>
                      <Delta d={r.delta} tip={t("byAgent.deltaTip", { team, on: hasP ? t("byAgent.deltaOn") : "" })} />
                    </div>
                  </>
                ) : (
                  <small style={{ whiteSpace: "normal", display: "block", lineHeight: 1.3 }}>{t("byProduct.few")}</small>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <div className="cfoot">
        <span style={{ display: "block" }}>{t.rich("byAgent.foot", { team, b: (c) => <b>{c}</b> })}</span>
      </div>
    </section>
  );
}

export function Days() {
  const { view, t, f, openDrill } = usePerf();
  const cols = view.days.cols;
  const max = Math.max(1, ...cols.map((c) => c.n));
  const grid = { gridTemplateColumns: `repeat(${cols.length},minmax(0,1fr))` };
  const stack = ["pend", "junk", "rej", "ret", "del"] as const;
  return (
    <section className="card">
      <div className="chead">
        <div>
          <h2>{t("days.title")}</h2>
          <div className="q">
            {t("days.q")}
            {view.B && !view.B.empty ? t("days.aOnly") : ""}
          </div>
        </div>
      </div>
      <div className="days" style={grid}>
        {cols.map((c) => {
          const list = c.n ? ` · ${OUTCOMES.filter((k) => c.g[k]).map((k) => `${c.g[k]} ${t(`o.${k}`).toLowerCase()}`).join(", ")}` : "";
          const ad = c.adOn ? (c.ad != null ? t("days.adAmount", { amount: f.money(c.ad) }) : t("days.adOn")) : t("days.adOff");
          return (
            <div key={c.day} className={`dcol${c.n ? "" : " zero"}`} data-tip={t("days.tip", { day: f.dayLong(c.day), n: c.n, list, ad })} onClick={() => openDrill(`day:${c.day}`)}>
              {stack.map((k) => (c.g[k] ? <i key={k} className={`k-${k}`} style={{ height: (c.g[k] / max) * 150 }} /> : null))}
            </div>
          );
        })}
      </div>
      <div className="ads" style={grid} data-tip={t("days.adsTip")}>
        {cols.map((c) => (
          <i key={c.day} className={c.adOn ? "" : "off"} />
        ))}
      </div>
      <div className="dlab" style={grid}>
        {cols.map((c, i) => (
          <span key={c.day}>{cols.length <= 31 || i % 3 === 0 ? +c.day.slice(8) : ""}</span>
        ))}
      </div>
      {view.days.gapFrom && (
        <div className="gap-note">
          <Ic n="stop" />
          {t("days.gap", { day: f.day(view.days.gapFrom) })}
        </div>
      )}
      <div className="cfoot">
        <span>
          <i style={{ width: 16, height: 6, borderRadius: 3, background: "var(--accent)", opacity: 0.75, display: "inline-block" }} />
          {t("days.legendOn")}
        </span>
        <span>
          <i style={{ width: 16, height: 6, borderRadius: 3, border: "1.5px dashed var(--ink-4)", display: "inline-block" }} />
          {t("days.legendOff")}
        </span>
        <span>{t("days.click")}</span>
      </div>
    </section>
  );
}

export function Defs() {
  const { view, t } = usePerf();
  const b = (c: React.ReactNode) => <b>{c}</b>;
  return (
    <details className="defs">
      <summary>{t("defs.summary")}</summary>
      <div>
        {t.rich("defs.body", { b })}
        {view.withMoney && t.rich("defs.money", { b })}
        {t("defs.tail")}
      </div>
    </details>
  );
}
