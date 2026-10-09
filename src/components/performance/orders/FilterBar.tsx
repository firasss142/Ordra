"use client";

// The filter bar, redesigned 2026-10-05: one button per filter that SAYS its value (no
// dead « Tous les produits » pill beside a « Choisir » button), « Comparer » as a menu
// of three, and — only while comparing — an « A contre B » line of its own. On phones
// the buttons fall into a 2-column grid and every picker opens as a bottom sheet.

import type { CSSProperties } from "react";
import type { ProductSel } from "@/lib/performance/orders/facts";
import type { PerfState } from "@/lib/performance/orders/query";
import { DatePopover, openDp, type DpState } from "./Dates";
import { Av, Ic, Thumb, glue, usePerf } from "./ui";

export type Pop = null | "a" | "ag" | "b" | "bag" | "cmp";

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

/** One filter = one button: its name, its value, a chevron; when set, tinted with its own ×. */
function FilterButton({ icon, label, value, active, open, onOpen, onClear, tone }: {
  icon: string;
  label: string;
  value: string;
  active: boolean;
  open: boolean;
  onOpen: () => void;
  onClear?: () => void;
  tone?: CSSProperties;
}) {
  const { t } = usePerf();
  return (
    <span className={`fb${active ? " set" : ""}${open ? " open" : ""}`} style={tone}>
      <button type="button" className="fb-main" aria-label={`${label} · ${value}`} aria-expanded={open} onClick={onOpen}>
        <Ic n={icon} />
        <span className="fb-l">{label}</span>
        <span className="fb-v">{value}</span>
        {!(active && onClear) && <Ic n="down" className="fb-c" />}
      </button>
      {active && onClear && (
        <button type="button" className="fb-x" aria-label={t("filter.clearOne", { f: label })} onClick={onClear}>
          <Ic n="x" />
        </button>
      )}
    </span>
  );
}

export function FilterBar({ pop, setPop, dp, setDp }: { pop: Pop; setPop: (p: Pop) => void; dp: DpState | null; setDp: (d: DpState | null) => void }) {
  const { view, state, t, f, setState, selName, agName } = usePerf();
  const set = (patch: Partial<PerfState>) => setState({ ...state, ...patch });
  const nA = Object.keys(state.sel).length;
  const cmp = state.cmp;
  const bSel = cmp?.kind === "p" ? cmp.sel : {};
  const bAg = cmp?.kind === "a" ? cmp.ag : [];
  const nB = Object.keys(bSel).length;
  const toggle = (p: Exclude<Pop, null>) => {
    setDp(null);
    setPop(pop === p ? null : p);
  };

  const chooseCmp = (k: "p" | "a" | "d") => {
    setDp(null);
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
  const cmpLabel = cmp ? t(cmp.kind === "p" ? "filter.cmpP" : cmp.kind === "a" ? "filter.cmpA" : "filter.cmpD") : t("filter.compare");
  const any = nA > 0 || state.ag.length > 0 || !!cmp;

  // B's own button, in the « A contre B » line
  let bBtn: JSX.Element | null = null;
  if (cmp?.kind === "p")
    bBtn = (
      <span className="fgrp">
        <FilterButton icon="layers" label={t("filter.products")} value={nB ? selName(bSel) : t("filter.chooseBp")} active={nB > 0} open={pop === "b"} tone={cB} onOpen={() => toggle("b")} />
        {pop === "b" && <ProductPicker sel={bSel} which="b" onChange={(sel) => set({ cmp: { kind: "p", sel } })} onClose={() => setPop(null)} />}
      </span>
    );
  else if (cmp?.kind === "a")
    bBtn = (
      <span className="fgrp">
        <FilterButton icon="team" label={t("filter.agents")} value={bAg.length ? agName(bAg) : t("filter.chooseBa")} active={bAg.length > 0} open={pop === "bag"} tone={cB} onOpen={() => toggle("bag")} />
        {pop === "bag" && <AgentPicker ag={bAg} which="b" onChange={(ag) => set({ cmp: { kind: "a", ag } })} onClose={() => setPop(null)} />}
      </span>
    );
  else if (cmp?.kind === "d")
    bBtn = (
      <span className="fgrp">
        <span className="fb set dchip" style={cB}>
          <button type="button" className="fb-main" aria-expanded={dp?.w === "b"} onClick={() => setDp(dp?.w === "b" ? null : openDp("b", cmp, view.first))}>
            <Ic n="cal" />
            <span className="fb-v">{f.range(cmp.from, cmp.to)}</span>
            <Ic n="down" className="fb-c" />
          </button>
        </span>
        {dp?.w === "b" && <DatePopover dp={dp} setDp={setDp} />}
      </span>
    );

  return (
    <div className="fbar">
      <div className="frow">
        <span className="fgrp">
          <FilterButton
            icon="layers"
            label={t("filter.products")}
            value={nA ? (nA <= 2 ? selName(state.sel) : t("filter.nProducts", { n: nA })) : t("filter.allProducts")}
            active={nA > 0}
            open={pop === "a"}
            onOpen={() => toggle("a")}
            onClear={() => set({ sel: {} })}
          />
          {pop === "a" && <ProductPicker sel={state.sel} which="a" onChange={(sel) => set({ sel })} onClose={() => setPop(null)} />}
        </span>
        <span className="fgrp">
          <FilterButton
            icon="team"
            label={t("filter.agents")}
            value={state.ag.length ? agName(state.ag) : t("filter.allTeam")}
            active={state.ag.length > 0}
            open={pop === "ag"}
            onOpen={() => toggle("ag")}
            onClear={() => set({ ag: [] })}
          />
          {pop === "ag" && <AgentPicker ag={state.ag} which="a" onChange={(ag) => set({ ag })} onClose={() => setPop(null)} />}
        </span>
        <span className="fsep" aria-hidden="true" />
        <span className="fgrp">
          <span className={`fb cmpb${cmp ? " set" : ""}${pop === "cmp" ? " open" : ""}`} style={cB}>
            <button type="button" className="fb-main" aria-haspopup="menu" aria-expanded={pop === "cmp"} onClick={() => toggle("cmp")}>
              <Ic n="swap" />
              <span className="fb-v">{cmp ? `${t("filter.compare")} · ${cmpLabel}` : cmpLabel}</span>
              <Ic n="down" className="fb-c" />
            </button>
          </span>
          {pop === "cmp" && (
            <div className="cmpmenu" role="menu" aria-label={t("filter.compare")}>
              {(["p", "a", "d"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="menuitem"
                  className={cmp?.kind === k ? "on" : ""}
                  onClick={() => chooseCmp(k)}
                >
                  <span className="cm-ic">
                    <Ic n={k === "p" ? "layers" : k === "a" ? "team" : "cal"} />
                  </span>
                  <span>
                    <b>{t(k === "p" ? "filter.cmpP" : k === "a" ? "filter.cmpA" : "filter.cmpD")}</b>
                    <small>{t(k === "p" ? "filter.cmpHintP" : k === "a" ? "filter.cmpHintA" : "filter.cmpHintD")}</small>
                  </span>
                  {cmp?.kind === k && <Ic n="check" className="cm-on" />}
                </button>
              ))}
            </div>
          )}
        </span>
        {any && (
          <button type="button" className="clr" onClick={() => { setPop(null); setDp(null); setState({ ...state, sel: {}, ag: [], cmp: null }); }}>
            {t("filter.reset")}
          </button>
        )}
      </div>
      {cmp && (
        <div className="vsline">
          <span className="vs-side">
            <span className="tagAB" style={cA}>A</span>
            <b>{nA || state.ag.length ? [nA ? selName(state.sel) : "", state.ag.length ? agName(state.ag) : ""].filter(Boolean).join(" · ") : t("filter.allOrders")}</b>
            <small>{f.n(view.A.n)} {t("filter.cmd")}</small>
          </span>
          <span className="vs-word">{t("filter.vs")}</span>
          <span className="vs-side">
            <span className="tagAB" style={cB}>B</span>
            {bBtn}
            {view.B && <small>{f.n(view.B.s.n)} {t("filter.cmd")}</small>}
            {view.B && view.B.s.n < 30 && <small className="vs-warn">{glue(t("filter.bTooSmall"))}</small>}
          </span>
          <button type="button" className="vs-stop" aria-label={t("filter.stopCmp")} onClick={() => { setPop(null); setDp(null); set({ cmp: null }); }}>
            <Ic n="x" />
            {t("filter.stop")}
          </button>
        </div>
      )}
    </div>
  );
}
