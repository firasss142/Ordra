"use client";

// A = products × agents; Comparer = Non · Autres produits · Autres agents ·
// Autres dates (prototype `filterBar`, `picker`, `agPicker`).

import type { CSSProperties } from "react";
import type { ProductSel } from "@/lib/performance/orders/facts";
import type { PerfState } from "@/lib/performance/orders/query";
import { DatePopover, openDp, type DpState } from "./Dates";
import { Av, Ic, Thumb, glue, usePerf } from "./ui";

export type Pop = null | "a" | "ag" | "b" | "bag";

const cA = { "--c": "var(--cA)" } as CSSProperties;
const cB = { "--c": "var(--cB)" } as CSSProperties;

function toggleProduct(sel: ProductSel, id: string): ProductSel {
  const next = { ...sel };
  if (next[id] !== undefined) delete next[id];
  else next[id] = null;
  return next;
}

function toggleSize(sel: ProductSel, id: string, v: string, all: string[]): ProductSel {
  const next = { ...sel };
  const cur = next[id];
  let arr: string[] = cur === undefined ? [v] : cur === null ? all.filter((x) => x !== v) : cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
  arr = all.filter((x) => arr.includes(x));
  if (!arr.length) delete next[id];
  else next[id] = arr.length === all.length ? null : arr;
  return next;
}

const toggleAg = (ag: string[], id: string) => (ag.includes(id) ? ag.filter((x) => x !== id) : [...ag, id]);

function Chips({ sel, which, onRemove }: { sel: ProductSel; which: "a" | "b"; onRemove: (id: string) => void }) {
  const { t, product } = usePerf();
  const ks = Object.keys(sel);
  if (!ks.length) {
    return (
      <span className="allb">
        <Ic n="layers" />
        {t("filter.allProducts")}
      </span>
    );
  }
  return (
    <>
      {ks.map((id) => {
        const p = product(id);
        const s = sel[id];
        return (
          <span key={id} className="pchip" style={which === "a" ? cA : cB}>
            <Thumb id={id} />
            {p?.name ?? "?"}
            {s ? (
              <small>{s.map((v) => p?.sizes.find((z) => z.id === v)?.label ?? "?").join(" · ")}</small>
            ) : p?.sizes.length ? (
              <small>{t("filter.allSizes")}</small>
            ) : null}
            <button type="button" className="x" aria-label={t("filter.remove")} onClick={() => onRemove(id)}>
              <Ic n="x" />
            </button>
          </span>
        );
      })}
    </>
  );
}

function AgChips({ ag, which, onRemove }: { ag: string[]; which: "a" | "b"; onRemove: (id: string) => void }) {
  const { t, agentName } = usePerf();
  if (!ag.length) {
    return (
      <span className="allb">
        <Ic n="team" />
        {t("filter.allTeam")}
      </span>
    );
  }
  return (
    <>
      {ag.map((id) => (
        <span key={id} className="pchip" style={which === "a" ? cA : cB}>
          <Av id={id} />
          {agentName(id)}
          <button type="button" className="x" aria-label={t("filter.remove")} onClick={() => onRemove(id)}>
            <Ic n="x" />
          </button>
        </span>
      ))}
    </>
  );
}

function ProductPicker({ sel, which, onChange, onClose }: { sel: ProductSel; which: "a" | "b"; onChange: (s: ProductSel) => void; onClose: () => void }) {
  const { view, t, f, product } = usePerf();
  const del = (x: number | null) => (x == null ? "—" : f.n(Math.round(x)));
  return (
    <div className="picker" style={which === "a" ? cA : cB}>
      <h5>{which === "a" ? t("filter.pickA") : t("filter.pickB")}</h5>
      {view.pickers.products.map((it) => {
        const p = product(it.id);
        if (!p) return null;
        const st = sel[it.id] === undefined ? "" : sel[it.id] === null ? "on" : "part";
        const sizeIds = p.sizes.map((z) => z.id);
        return (
          <div key={it.id} style={{ display: "contents" }}>
            <button type="button" className="pk" onClick={() => onChange(toggleProduct(sel, it.id))}>
              <span className={`cb ${st}`}>{st === "on" && <Ic n="check" />}</span>
              <Thumb id={it.id} />
              <span>
                <b>{p.name}</b>
                <small>{t("filter.pickRow", { nf: f.n(it.n), del: del(it.delPer) })}</small>
              </span>
              <small>{p.sizes.length ? t("filter.nSizes", { n: p.sizes.length }) : ""}</small>
            </button>
            {p.sizes.map((z) => {
              const zs = it.sizes?.find((x) => x.id === z.id);
              const s = sel[it.id];
              const on = s === null || (Array.isArray(s) && s.includes(z.id));
              return (
                <button key={z.id} type="button" className="pk sz" onClick={() => onChange(toggleSize(sel, it.id, z.id, sizeIds))}>
                  <span className={`cb ${on ? "on" : ""}`}>{on && <Ic n="check" />}</span>
                  <span>
                    <b>{z.label}</b>
                    <small>{t("filter.pickRow", { nf: f.n(zs?.n ?? 0), del: del(zs?.delPer ?? null) })}</small>
                  </span>
                  <span />
                </button>
              );
            })}
          </div>
        );
      })}
      <div className="pk-f">
        <button type="button" className="chipb" onClick={() => onChange({})}>
          {which === "a" ? t("filter.allProducts") : t("filter.clear")}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          {t("filter.ok")}
        </button>
      </div>
    </div>
  );
}

function AgentPicker({ ag, which, onChange, onClose }: { ag: string[]; which: "a" | "b"; onChange: (a: string[]) => void; onClose: () => void }) {
  const { view, state, t, f, agentName, selName } = usePerf();
  const on = Object.keys(state.sel).length ? t("filter.agPickOn", { p: selName(state.sel) }) : "";
  return (
    <div className="picker" style={{ ...(which === "a" ? cA : cB), width: 360 }}>
      <h5>
        {which === "a" ? t("filter.agPickA") : t("filter.agPickB")}
        {glue(on)}
      </h5>
      {view.pickers.agents.map((it) => {
        const sel = ag.includes(it.id);
        return (
          <button key={it.id} type="button" className="pk" onClick={() => onChange(toggleAg(ag, it.id))}>
            <span className={`cb ${sel ? "on" : ""}`}>{sel && <Ic n="check" />}</span>
            <Av id={it.id} />
            <span>
              <b>{agentName(it.id)}</b>
              <small>
                {it.delPer == null
                  ? t("filter.agRowFew", { nf: f.n(it.n) })
                  : t("filter.agRow", { nf: f.n(it.n), del: f.n(Math.round(it.delPer)) })}
              </small>
            </span>
            <span />
          </button>
        );
      })}
      <div className="pk-f">
        <button type="button" className="chipb" onClick={() => onChange([])}>
          {which === "a" ? t("filter.allTeam") : t("filter.clear")}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          {t("filter.ok")}
        </button>
      </div>
    </div>
  );
}

export function FilterBar({ pop, setPop, dp, setDp }: { pop: Pop; setPop: (p: Pop) => void; dp: DpState | null; setDp: (d: DpState | null) => void }) {
  const { view, state, t, f, setState } = usePerf();
  const set = (patch: Partial<PerfState>) => setState({ ...state, ...patch });
  const nA = Object.keys(state.sel).length;
  const cmp = state.cmp;
  const bSel = cmp?.kind === "p" ? cmp.sel : {};
  const bAg = cmp?.kind === "a" ? cmp.ag : [];
  const nB = Object.keys(bSel).length;

  const chooseCmp = (k: "" | "p" | "a" | "d") => {
    setDp(null);
    if (!k) {
      setPop(null);
      set({ cmp: null });
      return;
    }
    if (k === "p") {
      const next = cmp?.kind === "p" ? cmp : { kind: "p" as const, sel: {} };
      set({ cmp: next });
      setPop(Object.keys(next.sel).length ? null : "b");
    } else if (k === "a") {
      const next = cmp?.kind === "a" ? cmp : { kind: "a" as const, ag: [] };
      set({ cmp: next });
      setPop(next.ag.length ? null : "bag");
    } else {
      const next = cmp?.kind === "d" ? cmp : { kind: "d" as const, from: view.window.pf, to: view.window.pt };
      set({ cmp: next });
      setPop(null);
      setDp(openDp("b", next, view.first));
    }
  };

  return (
    <div className="fbar">
      <div className="fgrp">
        <span className="flab">
          <span className="tagAB" style={cA}>
            A
          </span>
          {t("filter.products")}
        </span>
        <Chips sel={state.sel} which="a" onRemove={(id) => set({ sel: toggleProduct(state.sel, id) })} />
        <button type="button" className="addb" style={cA} onClick={() => setPop(pop === "a" ? null : "a")}>
          <Ic n={nA ? "layers" : "search"} />
          {nA ? t("filter.edit") : t("filter.chooseProducts")}
        </button>
        {pop === "a" && <ProductPicker sel={state.sel} which="a" onChange={(sel) => set({ sel })} onClose={() => setPop(null)} />}
      </div>
      <div className="fgrp">
        <span className="flab">{t("filter.agents")}</span>
        <AgChips ag={state.ag} which="a" onRemove={(id) => set({ ag: toggleAg(state.ag, id) })} />
        <button type="button" className="addb" style={cA} onClick={() => setPop(pop === "ag" ? null : "ag")}>
          <Ic n={state.ag.length ? "team" : "search"} />
          {state.ag.length ? t("filter.edit") : t("filter.chooseAgents")}
        </button>
        {pop === "ag" && <AgentPicker ag={state.ag} which="a" onChange={(ag) => set({ ag })} onClose={() => setPop(null)} />}
      </div>
      <span className="fsep" />
      <div className="fgrp">
        <span className="flab">{t("filter.compare")}</span>
        <span className="cmpseg">
          {(["", "p", "a", "d"] as const).map((k) => (
            <button key={k || "no"} type="button" className={(cmp?.kind ?? "") === k ? "on" : ""} onClick={() => chooseCmp(k)}>
              {t(k === "" ? "filter.cmpNo" : k === "p" ? "filter.cmpP" : k === "a" ? "filter.cmpA" : "filter.cmpD")}
            </button>
          ))}
        </span>
      </div>
      {cmp?.kind === "p" && (
        <div className="fgrp">
          <span className="tagAB" style={cB}>
            B
          </span>
          {nB > 0 && <Chips sel={bSel} which="b" onRemove={(id) => set({ cmp: { kind: "p", sel: toggleProduct(bSel, id) } })} />}
          <button type="button" className="addb" style={cB} onClick={() => setPop(pop === "b" ? null : "b")}>
            <Ic n="search" />
            {nB ? t("filter.edit") : t("filter.chooseBp")}
          </button>
          {pop === "b" && <ProductPicker sel={bSel} which="b" onChange={(sel) => set({ cmp: { kind: "p", sel } })} onClose={() => setPop(null)} />}
        </div>
      )}
      {cmp?.kind === "a" && (
        <div className="fgrp">
          <span className="tagAB" style={cB}>
            B
          </span>
          {bAg.length > 0 && <AgChips ag={bAg} which="b" onRemove={(id) => set({ cmp: { kind: "a", ag: toggleAg(bAg, id) } })} />}
          <button type="button" className="addb" style={cB} onClick={() => setPop(pop === "bag" ? null : "bag")}>
            <Ic n="search" />
            {bAg.length ? t("filter.edit") : t("filter.chooseBa")}
          </button>
          {pop === "bag" && <AgentPicker ag={bAg} which="b" onChange={(ag) => set({ cmp: { kind: "a", ag } })} onClose={() => setPop(null)} />}
        </div>
      )}
      {cmp?.kind === "d" && (
        <div className="fgrp">
          <span className="tagAB" style={cB}>
            B
          </span>
          <button type="button" className="dchip" onClick={() => setDp(dp?.w === "b" ? null : openDp("b", cmp, view.first))}>
            <Ic n="cal" />
            {f.range(cmp.from, cmp.to)}
            <Ic n="down" />
          </button>
          {dp?.w === "b" && <DatePopover dp={dp} setDp={setDp} />}
        </div>
      )}
      {(nA > 0 || state.ag.length > 0 || cmp) && (
        <button type="button" className="clr" onClick={() => { setPop(null); setState({ ...state, sel: {}, ag: [], cmp: null }); }}>
          <Ic n="x" />
          {t("filter.reset")}
        </button>
      )}
      {view.B && (
        <span className="cmpnote" style={{ marginInlineStart: "auto" }}>
          <span className="tagAB" style={cA}>
            A
          </span>
          <b>{f.n(view.A.n)}</b> {t("filter.cmd")}{" "}
          <span className="tagAB" style={cB}>
            B
          </span>
          <b>{f.n(view.B.s.n)}</b> {t("filter.cmd")}
          {view.B.s.n < 30 && (
            <>
              {" · "}
              <span style={{ color: "var(--bad)" }}>{glue(t("filter.bTooSmall"))}</span>
            </>
          )}
        </span>
      )}
    </div>
  );
}
