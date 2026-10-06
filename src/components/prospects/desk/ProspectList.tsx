"use client";

/**
 * « La liste »: multi-select Source and Agent (owner, round 3), one State, a
 * name-or-phone search, 25 a page, bulk reassign / export / close.
 */
import { useCallback, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Download, Phone, Search, Truck, Users, UserX, X } from "lucide-react";
import type { DeskRow, ListState } from "@/lib/prospects/desk/list";
import type { DeskSource } from "@/lib/prospects/desk/types";
import type { AgentCard } from "@/lib/prospects/desk/model";
import { fmtMoney, fmtNum, fmtTime } from "./format";
import { Avatar, CheckBox, Cover, useDismiss } from "./parts";
import { SOURCE_ICON } from "./Sources";

export interface ListFilters { sources: DeskSource[]; agents: string[]; state: ListState; q: string; page: number }

interface Opt { v: string; label: string; icon?: ReactNode; count?: number }

function MultiFilter({ label, allLabel, opts, value, onChange }: { label: string; allLabel: string; opts: Opt[]; value: string[]; onChange: (v: string[]) => void }) {
  const t = useTranslations("prospects.desk.list");
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const names = opts.filter((o) => value.includes(o.v)).map((o) => o.label);
  const shown = !value.length ? allLabel : names.length <= 2 ? names.join(", ") : t("selected", { n: names.length });
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <span className="fbw" ref={ref}>
      <button type="button" className={`fb${value.length ? " set" : ""}${open ? " open" : ""}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label} : <b>{shown}</b>
        {value.length ? (
          <span className="x" role="button" aria-label={t("clear")} onClick={(e) => { e.stopPropagation(); onChange([]); setOpen(false); }}><X className="ic" /></span>
        ) : <ChevronDown className="ic" />}
      </button>
      {open ? (
        <div className="pop" role="listbox" aria-multiselectable="true" aria-label={label}>
          {opts.map((o) => {
            const on = value.includes(o.v);
            return (
              <button key={o.v} type="button" role="option" aria-selected={on} className={`opt${on ? " on" : ""}`} onClick={() => toggle(o.v)}>
                <CheckBox on={on} />{o.icon}<span className="ol">{o.label}</span>{o.count !== undefined ? <small className="num">{o.count}</small> : null}
              </button>
            );
          })}
          <div className="popf">
            <button type="button" className="lnk" disabled={!value.length} onClick={() => onChange([])}>{t("clear")}</button>
            <button type="button" className="btn pri sm" onClick={close}>{t("done")}</button>
          </div>
        </div>
      ) : null}
    </span>
  );
}

function StateFilter({ value, onChange }: { value: ListState; onChange: (v: ListState) => void }) {
  const t = useTranslations("prospects.desk.list");
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const states: ListState[] = ["open", "won", "lost", "all"];
  return (
    <span className="fbw" ref={ref}>
      <button type="button" className={`fb${value !== "open" ? " set" : ""}${open ? " open" : ""}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {t("state")} : <b>{t(`states.${value}`)}</b><ChevronDown className="ic" />
      </button>
      {open ? (
        <div className="pop" role="listbox" aria-label={t("state")}>
          {states.map((s) => (
            <button key={s} type="button" role="option" aria-selected={value === s} className={`opt${value === s ? " on" : ""}`} onClick={() => { onChange(s); close(); }}>
              <span className={`rd${value === s ? " on" : ""}`} /><span className="ol">{t(`states.${s}`)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

function StateChip({ r, locale, tz }: { r: DeskRow; locale: string; tz: string }) {
  const t = useTranslations("prospects.desk.list.status");
  if (r.state === "won") {
    const delivered = r.convertedStatus === "delivered";
    return <span className="state won">{delivered ? <Check className="ic" /> : <Truck className="ic" />}{delivered ? t("won_delivered") : r.convertedStatus ? t("won_road") : t("won")}</span>;
  }
  if (r.state === "lost") return <span className="state lost"><X className="ic" />{t("lost")}</span>;
  if (r.status === "callback_scheduled" && r.callbackAt) {
    return r.lateCallback
      ? <span className="state late"><Clock className="ic" />{t("late")}</span>
      : <span className="state"><Clock className="ic" />{t("callback", { time: fmtTime(r.callbackAt, locale, tz) })}</span>;
  }
  if (r.attempts > 0) {
    return <span className="state"><span className="pips">{[1, 2, 3].map((i) => <i key={i} className={i <= r.attempts ? "on" : ""} />)}</span>{t("attempt", { n: r.attempts })}</span>;
  }
  return <span className="state"><Phone className="ic" />{t("to_call")}</span>;
}

export function ProspectList({
  rows, total, loading, filters, onFilters, agents, sourceNames, sel, onSel, openId, onOpen, onExport, onReassign, onClose,
  locale, tz, marketId, emptyHint, engineEmpty, reasonLabel,
}: {
  rows: DeskRow[]; total: number; loading: boolean; filters: ListFilters; onFilters: (f: Partial<ListFilters>) => void;
  agents: AgentCard[]; sourceNames: Record<DeskSource, string>;
  sel: Set<string>; onSel: (s: Set<string>) => void; openId: string | null; onOpen: (id: string) => void;
  onExport: () => void; onReassign: () => void; onClose: () => void;
  locale: string; tz: string; marketId: string; emptyHint: { days: number; after: number }; engineEmpty: boolean;
  reasonLabel: (key: string) => string;
}) {
  const t = useTranslations("prospects.desk.list");
  const b = (c: ReactNode) => <b>{c}</b>;
  const plain = filters.state === "open" && !filters.sources.length && !filters.agents.length && !filters.q;
  const from = total ? (filters.page - 1) * 25 + 1 : 0;
  const to = Math.min(total, filters.page * 25);
  const toggleRow = (id: string) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); onSel(n); };

  const srcOpts: Opt[] = (Object.keys(sourceNames) as DeskSource[]).map((k) => {
    const Icon = SOURCE_ICON[k];
    return { v: k, label: sourceNames[k], icon: <span className="oi"><Icon className="ic" /></span> };
  });
  const agentOpts: Opt[] = [
    { v: "none", label: t("noAgent"), icon: <span className="oi bad"><UserX className="ic" /></span> },
    ...agents.map((a) => ({ v: a.id, label: a.name, icon: <Avatar id={a.id} name={a.name} color={a.color} size={24} />, count: a.file_open })),
  ];

  const whyCell = (r: DeskRow) => {
    const Icon = SOURCE_ICON[r.source];
    let l1: string, l2: ReactNode = null;
    if (r.source === "rej") l1 = r.reason ? `${t("why.rej")} · ${reasonLabel(r.reason)}` : t("why.rej");
    else if (r.source === "ret") { l1 = t("why.ret"); l2 = r.reason ? <bdi dir="auto">« {r.reason} »</bdi> : null; }
    else if (r.source === "old") { l1 = t("why.old"); l2 = r.sourceOrderRef; }
    else { l1 = t("why.camp"); l2 = r.campaignName; }
    return <div className="why"><span className="wi"><Icon className="ic" /></span><div className="cell"><div className="l1">{l1}</div>{l2 ? <div className="l2">{l2}</div> : null}</div></div>;
  };

  let body: ReactNode;
  if (loading && !rows.length) body = <div style={{ padding: 16, display: "grid", gap: 8 }}>{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skel" style={{ height: 46 }} />)}</div>;
  else if (!rows.length) body = <div className="empty">{engineEmpty && plain ? t.rich("empty", { days: emptyHint.days, after: emptyHint.after, b }) : t.rich("noMatch", { b })}</div>;
  else body = (
    <>
      <div role="table" aria-label={t("title")}>
        <div className="thead" role="row">
          <span role="columnheader" />
          {(["client", "why", "product", "agent", "state", "age"] as const).map((c) => <span key={c} role="columnheader">{t(`cols.${c}`)}</span>)}
        </div>
        {rows.map((r) => {
          const on = sel.has(r.id);
          return (
            <div key={r.id} role="row" tabIndex={0} className={`row${on ? " sel" : ""}${openId === r.id ? " open" : ""}`}
              onClick={() => onOpen(r.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(r.id); } }}>
              <span><span role="checkbox" aria-checked={on} aria-label={r.name} onClick={(e) => { e.stopPropagation(); toggleRow(r.id); }}><CheckBox on={on} /></span></span>
              <div className="cell"><div className="l1"><bdi>{r.name}</bdi></div><div className="l2"><bdi dir="ltr">{r.phone}</bdi>{r.city ? <> · <bdi>{r.city}</bdi></> : null}</div></div>
              {whyCell(r)}
              <div className="cell pcell">
                {r.productName ? <Cover product={{ id: r.productName, name: r.productName, image: r.productImage }} w={26} /> : null}
                <div style={{ minWidth: 0 }}>
                  <div className="l1" style={{ fontWeight: 600 }}><bdi>{r.productName ?? "—"}</bdi></div>
                  {r.value !== null ? <div className="l2 num"><bdi>{fmtMoney(r.value, locale, marketId)}</bdi></div> : null}
                </div>
              </div>
              <div className="who2">{r.agentId ? <><Avatar id={r.agentId} name={r.agentName ?? "?"} color={r.agentColor} size={24} /><span>{r.agentName}</span></> : <span className="none">{t("noAgent")}</span>}</div>
              <div><StateChip r={r} locale={locale} tz={tz} /></div>
              <div className={`age${r.ageDays >= 3 && r.state !== "won" && r.state !== "lost" ? " old" : ""}`}>{r.ageDays === 0 ? t("today") : t("days", { n: r.ageDays })}</div>
            </div>
          );
        })}
      </div>
      <div className="pager">
        <span>{t("pager", { from: fmtNum(from, locale), to: fmtNum(to, locale), total: fmtNum(total, locale) })}</span>
        <span className="pg">
          <button type="button" className="btn sec sm" disabled={filters.page <= 1} onClick={() => onFilters({ page: filters.page - 1 })}><ChevronLeft className="ic flip" />{t("prev")}</button>
          <button type="button" className="btn sec sm" disabled={to >= total} onClick={() => onFilters({ page: filters.page + 1 })}>{t("next")}<ChevronRight className="ic flip" /></button>
        </span>
      </div>
    </>
  );

  return (
    <>
      <div className="sh" id="pdk-list" style={{ scrollMarginTop: 16 }}><h2>{t("title")}</h2><small>{filters.state === "open" ? t("open", { n: total }) : t("total", { n: total })}</small></div>
      <section className="card list">
        <div className="fbar">
          <MultiFilter label={t("source")} allLabel={t("all")} opts={srcOpts} value={filters.sources} onChange={(v) => onFilters({ sources: v as DeskSource[], page: 1 })} />
          <StateFilter value={filters.state} onChange={(v) => onFilters({ state: v, page: 1 })} />
          <MultiFilter label={t("agent")} allLabel={t("allM")} opts={agentOpts} value={filters.agents} onChange={(v) => onFilters({ agents: v, page: 1 })} />
          <label className="search"><Search className="ic" /><input value={filters.q} placeholder={t("search")} aria-label={t("search")} onChange={(e) => onFilters({ q: e.target.value, page: 1 })} /></label>
          <button type="button" className="btn sec sm" disabled={!total} onClick={onExport}><Download className="ic" />{t("export")}</button>
        </div>
        {body}
      </section>
      {sel.size ? (
        <div className="bulk" role="toolbar">
          <span>{t("bulk", { n: sel.size })}</span>
          <button type="button" onClick={onReassign}><Users className="ic" />{t("reassign")}</button>
          <button type="button" onClick={onExport}><Download className="ic" />{t("export")}</button>
          <button type="button" onClick={onClose}><X className="ic" />{t("close")}</button>
          <button type="button" aria-label={t("clearSel")} onClick={() => onSel(new Set())}><X className="ic" /></button>
        </div>
      ) : null}
    </>
  );
}
