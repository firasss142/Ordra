"use client";

/**
 * The list card: list states, filter buttons that say their value (§4.7b),
 * the sort, the search; a line for the one agent filtered; plain hairline
 * rows; a pager of 25. Rows carry no action buttons — acting happens in the
 * panel. Pure: everything is computed by BoardView.
 */
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeftRight, Check, ChevronDown, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import type { WorklistRow } from "@/lib/delivery/types";
import { orderRef, situationOf } from "@/lib/delivery/presentation";
import { lastTrace, LIST_STATES, type ListSort, type ListState, type LiveBucket } from "@/lib/delivery/manager";
import { Money, useDuration, useSituationSub, useWhen } from "../ui";
import { Avatar, CheckBox, SitChip, Thumb, agentVars, useDismiss } from "./parts";
import type { AgentCard } from "./Strips";

export interface ListFilters {
  state: ListState;
  buckets: LiveBucket[];
  agents: string[];
  sits: string[];
  carriers: string[];
  q: string;
  sort: ListSort;
  page: number;
}
export const NO_FILTERS: ListFilters = { state: "live", buckets: [], agents: [], sits: [], carriers: [], q: "", sort: "priority", page: 1 };
export const PER_PAGE = 25;
/** The agent filter's value for parcels nobody follows. */
export const NO_AGENT = "_none";

export interface FilterOption { v: string; l: string; n: number; icon?: ReactNode }
type MultiKey = "buckets" | "agents" | "sits" | "carriers";

function FilterButton({ k, label, all, opts, value, open, onOpen, onChange }: {
  k: MultiKey; label: string; all: string; opts: FilterOption[]; value: string[]; open: boolean;
  onOpen: (k: MultiKey | null) => void; onChange: (v: string[]) => void;
}) {
  const t = useTranslations("delivery.manager.f");
  const ref = useDismiss(open, () => onOpen(null));
  const names = opts.filter((o) => value.includes(o.v)).map((o) => o.l);
  const shown = !value.length ? all : names.length <= 2 ? names.join(", ") : t("nSel", { n: names.length });
  return (
    <span className="fbw" ref={ref}>
      <button type="button" className={`fb${value.length ? " set" : ""}${open ? " open" : ""}`} aria-expanded={open} onClick={() => onOpen(open ? null : k)}>
        {label} : <b>{shown}</b>{value.length ? null : <ChevronDown className="ic" />}
      </button>
      {value.length ? <button type="button" className="fbx" aria-label={t("clear")} onClick={() => { onChange([]); onOpen(null); }}><X className="ic" /></button> : null}
      {open ? (
        <div className="pop" role="listbox" aria-multiselectable="true" aria-label={label}>
          {opts.map((o) => {
            const on = value.includes(o.v);
            return (
              <button key={o.v} type="button" role="option" aria-selected={on} className="opt"
                onClick={() => onChange(on ? value.filter((x) => x !== o.v) : [...value, o.v])}>
                <CheckBox on={on} />{o.icon}<span>{o.l}</span><small className="num">{o.n}</small>
              </button>
            );
          })}
        </div>
      ) : null}
    </span>
  );
}

export interface ParcelListProps {
  page: WorklistRow[];
  total: number;
  stateCounts: Record<ListState, number>;
  filters: ListFilters;
  onFilters: (f: Partial<ListFilters>) => void;
  options: Record<MultiKey, FilterOption[]>;
  oneAgent: AgentCard | null;
  onReassignAgent: (id: string) => void;
  late: Set<string>;
  colors: Map<string, string | null>;
  selection: Set<string>;
  onToggleSel: (id: string) => void;
  openId: string | null;
  onOpen: (id: string) => void;
  nothingInFlight: boolean;
  market: "ly" | "tn";
  locale: string;
  tz: string;
  now: number;
}

export function ParcelList(p: ParcelListProps) {
  const t = useTranslations("delivery.manager");
  const tDel = useTranslations("delivery");
  const [pop, setPop] = useState<MultiKey | null>(null);
  const duration = useDuration();
  const sub = useSituationSub();
  const when = useWhen(p.now, p.tz, p.locale);
  const f = p.filters;
  const any = f.buckets.length + f.agents.length + f.sits.length + f.carriers.length > 0 || f.q.trim() !== "";
  const pages = Math.max(1, Math.ceil(p.total / PER_PAGE));
  const pg = Math.min(f.page, pages);
  const SORTS: ListSort[] = ["priority", "wait", "amount"];

  const actionLabel = (r: WorklistRow) => {
    const type = r.last_action_type && tDel.has(`sheet.types.${r.last_action_type}`) ? tDel(`sheet.types.${r.last_action_type}`) : r.last_action_type ?? "";
    const outcome = r.last_action_outcome && tDel.has(`sheet.outcomes.${r.last_action_outcome}`) ? tDel(`sheet.outcomes.${r.last_action_outcome}`) : "";
    return [r.agent_name, outcome ? `${type} · ${outcome}` : type].filter(Boolean).join(" · ");
  };

  const multi = (k: MultiKey, label: string, all: string) => (
    <FilterButton k={k} label={label} all={all} opts={p.options[k]} value={f[k]} open={pop === k} onOpen={setPop}
      onChange={(v) => p.onFilters({ [k]: v, page: 1 } as Partial<ListFilters>)} />
  );

  return (
    <section className="card list" id="dlb-list">
      <div className="fbar">
        <div className="segs" role="tablist" aria-label={t("states.label")}>
          {LIST_STATES.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={f.state === k}
              className={`${f.state === k ? "on" : ""}${k === "late" && p.stateCounts.late ? " late" : ""}`}
              onClick={() => p.onFilters({ state: k, page: 1 })}>
              {t(`states.${k}`)}{" "}<small className="num">{p.stateCounts[k]}</small>
            </button>
          ))}
        </div>
        {f.state === "live" ? multi("buckets", t("f.bucket"), t("f.all")) : null}
        {multi("agents", t("f.agent"), t("f.all"))}
        {multi("sits", t("f.sit"), t("f.allF"))}
        {multi("carriers", t("f.carrier"), t("f.all"))}
        <button type="button" className="fb" onClick={() => p.onFilters({ sort: SORTS[(SORTS.indexOf(f.sort) + 1) % SORTS.length] })}>
          {t("f.sort")} : <b>{t(`sort.${f.sort}`)}</b><ChevronDown className="ic" />
        </button>
        {any ? <button type="button" className="btn sm ghost" onClick={() => p.onFilters({ buckets: [], agents: [], sits: [], carriers: [], q: "", page: 1 })}>{t("empty.clear")}</button> : null}
        <label className="search"><Search className="ic" />
          <input type="search" value={f.q} placeholder={t("search")} aria-label={t("search")} onChange={(e) => p.onFilters({ q: e.target.value, page: 1 })} />
        </label>
      </div>

      {p.oneAgent ? (
        <div className="aline" style={agentVars(p.oneAgent.id, p.oneAgent.color)}>
          <Avatar id={p.oneAgent.id} name={p.oneAgent.name} color={p.oneAgent.color} />
          <div className="tt"><b>{p.oneAgent.name}</b><p>{t("aline", { n: p.oneAgent.inFlight, verdict: t(`verdict.${p.oneAgent.verdict}`) })}</p></div>
          {p.oneAgent.inFlight ? (
            <button type="button" className="btn sec sm" onClick={() => p.onReassignAgent(p.oneAgent!.id)}>
              <ArrowLeftRight className="ic" />{t("todo.reassignAll", { n: p.oneAgent.inFlight })}
            </button>
          ) : null}
        </div>
      ) : null}

      {p.nothingInFlight && f.state === "live" ? (
        <div className="empty"><b>{t("empty.all")}</b>{t("empty.allSub")}</div>
      ) : p.total === 0 ? (
        <div className="empty"><b>{t("empty.list")}</b>{t("empty.listSub")}
          {any ? <div style={{ marginTop: 12 }}><button type="button" className="btn sec sm" onClick={() => p.onFilters({ buckets: [], agents: [], sits: [], carriers: [], q: "", page: 1 })}>{t("empty.clear")}</button></div> : null}
        </div>
      ) : (
        <>
          <div className="thead" aria-hidden>
            <span /><span>{t("cols.sit")}</span><span>{t("cols.client")}</span><span>{t("cols.prod")}</span><span>{t("cols.agent")}</span>
            <span>{t("cols.trace")}</span><span className="e">{t("cols.wait")}</span><span className="e">{t("cols.amt")}</span>
          </div>
          {p.page.map((r) => {
            const s = situationOf(r, p.now);
            const sel = p.selection.has(r.order_id);
            const isLate = p.late.has(r.order_id);
            const trace = lastTrace(r);
            const item = r.items[0];
            return (
              <div key={r.order_id} className={`row${sel ? " sel" : ""}${p.openId === r.order_id ? " open" : ""}`} data-order-id={r.order_id} onClick={() => p.onOpen(r.order_id)}>
                {r.bucket !== "done" ? (
                  <button type="button" role="checkbox" aria-checked={sel} aria-label={t("select", { name: r.customer_name ?? "" })} className={`cb${sel ? " on" : ""}`}
                    onClick={(e) => { e.stopPropagation(); p.onToggleSel(r.order_id); }}>
                    {sel ? <Check className="ic" /> : null}
                  </button>
                ) : <span />}
                <div className="cell"><SitChip sit={s.key} label={tDel(`sit.${s.key}`)} /><div className="l2" style={{ marginTop: 4 }}>{sub(s)}</div></div>
                <div className="cell">
                  <div className="l1"><bdi className="cname">{r.customer_name ?? "—"}</bdi></div>
                  <div className="l2"><bdi dir="ltr">#{orderRef(r)}</bdi>{r.customer_city ? <> · <bdi>{r.customer_city}</bdi></> : null}</div>
                </div>
                <div className="cell prod">
                  <Thumb item={item} />
                  <div style={{ minWidth: 0 }}>
                    <div className="l1" style={{ fontSize: 13 }}>{item?.product_name ?? "—"}</div>
                    <div className="l2"><bdi dir="ltr">×{item?.quantity ?? 1}</bdi>{r.items.length > 1 ? ` +${r.items.length - 1}` : ""}{r.carrier_name ? ` · ${r.carrier_name}` : ""}</div>
                  </div>
                </div>
                <div className={`cell who2${r.assigned_to ? "" : " none"}`}>
                  <Avatar id={r.assigned_to} name={r.agent_name} color={r.assigned_to ? p.colors.get(r.assigned_to) : null} small />
                  <span>{r.assigned_to ? r.agent_name ?? "—" : t("f.noAgent")}</span>
                </div>
                <div className="trace">
                  {trace?.kind === "action" ? (
                    <><div className="l1">{actionLabel(r)}</div><div className="l2">{when(trace.at)}</div></>
                  ) : trace?.kind === "remark" ? (
                    <><div className="l1" style={{ fontWeight: 600 }}>{t("courierSays")} : « <bdi>{trace.text}</bdi> »</div><div className="l2">{when(trace.at)}</div></>
                  ) : <div className="l2" style={{ margin: 0 }}>—</div>}
                </div>
                <div className={`age${isLate ? " late" : ""}`}>{duration(r.hours_on_status ?? 0)}{isLate ? <small>{t("late")}</small> : null}</div>
                <div className="amt"><Money amount={r.total_price} market={p.market} locale={p.locale} /></div>
              </div>
            );
          })}
          <div className="pager">
            <span>{t("page", { from: (pg - 1) * PER_PAGE + 1, to: Math.min(pg * PER_PAGE, p.total), total: p.total })}</span>
            <span className="pg">
              <button type="button" className="btn sec sm" disabled={pg <= 1} onClick={() => p.onFilters({ page: pg - 1 })}><ChevronLeft className="ic flip" />{t("prev")}</button>
              <button type="button" className="btn sec sm" disabled={pg >= pages} onClick={() => p.onFilters({ page: pg + 1 })}>{t("next")}<ChevronRight className="ic flip" /></button>
            </span>
          </div>
        </>
      )}
    </section>
  );
}
