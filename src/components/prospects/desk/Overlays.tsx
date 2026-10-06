"use client";

/** The prospect drawer and the three dialogs: export, reassign, close. */
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { ArrowUpRight, Check, ChevronDown, Download, FileText, Grid3x3, Loader2, MessageCircle, Phone, X } from "lucide-react";
import { fetcher } from "@/lib/swr-config";
import type { DeskRow } from "@/lib/prospects/desk/list";
import type { AgentCard } from "@/lib/prospects/desk/model";
import { fmtDay, fmtMoney, fmtTime } from "./format";
import { Avatar, Cover } from "./parts";
import { SOURCE_ICON } from "./Sources";

export function Scrim({ on, onClick }: { on: boolean; onClick: () => void }) {
  return <div className={`scrim${on ? " on" : ""}`} onClick={onClick} aria-hidden />;
}

interface HistoryRow { id: string; status_from: string | null; status_to: string; actor_type: string | null; note: string | null; created_at: string }

export function ProspectDrawer({ row, open, onClose, onReassign, onCloseLead, locale, tz, marketId, reasonLabel }: {
  row: DeskRow | null; open: boolean; onClose: () => void; onReassign: () => void; onCloseLead: () => void;
  locale: string; tz: string; marketId: string; reasonLabel: (k: string) => string;
}) {
  const t = useTranslations("prospects.desk.drawer");
  const ts = useTranslations("prospects.desk.list");
  const { data } = useSWR<{ data: { history?: HistoryRow[] } }>(open && row ? `/api/leads/${row.id}` : null, fetcher);
  const history = (data?.data?.history ?? []).filter((h) => h.status_to !== h.status_from).slice().reverse();
  if (!row) return <aside className="drawer" aria-hidden />;
  const Icon = SOURCE_ICON[row.source];
  const b = (c: ReactNode) => <b>{c}</b>;
  const story = row.source === "rej" ? t.rich("storyRej", { reason: row.reason ? reasonLabel(row.reason) : "—", b })
    : row.source === "ret" ? <>{t("storyRet")}{row.reason ? <span className="q"><bdi dir="auto">« {row.reason} »</bdi></span> : null}</>
    : row.source === "old" ? t("storyOld")
    : row.campaignName ? t("storyCamp", { name: row.campaignName }) : t("storyManual");
  const orderId = row.convertedOrderId ?? row.sourceOrderId;
  const orderRef = row.convertedOrderId ? row.convertedRef : row.sourceOrderRef;
  const wa = row.phone.replace(/\D/g, "");
  const evLabel = (s: string) => s.startsWith("attempt_") ? ts("status.attempt", { n: Number(s.slice(8)) })
    : s === "callback_scheduled" ? ts("status.callback", { time: "" }).trim() : s === "won" ? ts("status.won") : s === "lost" ? ts("status.lost")
    : s === "new" || s === "assigned" ? ts("status.to_call") : s;

  return (
    <aside className={`drawer${open ? " on" : ""}`} aria-label={row.name} aria-hidden={!open}>
      <div className="dh">
        <div className="tt">
          <h3><bdi>{row.name}</bdi></h3>
          <p><bdi dir="ltr">{row.phone}</bdi>{row.city ? <> · <bdi>{row.city}</bdi></> : null}</p>
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            <span className="state"><Icon className="ic" />{ts(`why.${row.source}`)}</span>
            {row.agentId ? <span className="state"><Avatar id={row.agentId} name={row.agentName ?? "?"} color={row.agentColor} size={24} />{row.agentName}</span> : <span className="state lost">{ts("noAgent")}</span>}
          </div>
        </div>
        <a className="ib" href={`tel:${row.phone}`} aria-label={t("call")} data-tip={t("call")}><Phone className="ic" /></a>
        <a className="ib wa" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" aria-label={t("whatsapp")} data-tip={t("whatsapp")}><MessageCircle className="ic" /></a>
        <button type="button" className="ib" onClick={onClose} aria-label={t("close")}><X className="ic" /></button>
      </div>
      <div className="db">
        <div className="sec"><h4>{t("why")}</h4><p className="story">{story}</p></div>
        {row.productName || orderRef ? (
          <div className="sec"><h4>{row.convertedOrderId ? t("won") : t("order")}</h4>
            <div className="ordc">
              {row.productName ? <Cover product={{ id: row.productName, name: row.productName, image: row.productImage }} w={34} /> : null}
              <div className="tt"><b><bdi>{row.productName ?? "—"}</bdi></b><small className="num">{[orderRef, row.value !== null ? fmtMoney(row.value, locale, marketId) : null].filter(Boolean).join(" · ")}</small></div>
              {orderId ? <a className="lnk" href={`/${locale}/orders/${orderId}`}>{t("openOrder")}<ArrowUpRight className="ic flip" /></a> : null}
            </div>
          </div>
        ) : null}
        <div className="sec"><h4>{t("history")}</h4>
          {history.length ? (
            <div className="tl">
              {history.map((h, i) => (
                <div key={h.id} className={`ev${i === 0 ? " now" : ""}`}>
                  <i /><span>{evLabel(h.status_to)}{h.note ? ` · ${h.note}` : ""}</span>
                  <small>{fmtDay(h.created_at, locale)} {fmtTime(h.created_at, locale, tz)}</small>
                </div>
              ))}
            </div>
          ) : <p className="help" style={{ margin: 0 }}>{t("noHistory")}</p>}
        </div>
      </div>
      {row.state !== "won" && row.state !== "lost" ? (
        <div className="df"><span className="meta" /><button type="button" className="btn sec" onClick={onCloseLead}>{t("closeLead")}</button><button type="button" className="btn pri" onClick={onReassign}>{t("reassign")}</button></div>
      ) : null}
    </aside>
  );
}

const EXPORT_COLS = ["name", "phone", "city", "source", "why", "product", "value", "agent", "state", "age", "order", "created"] as const;
const DEFAULT_ON = new Set(["name", "phone", "city", "source", "why", "product", "value", "agent", "state", "age"]);

export function ExportDialog({ open, onClose, filteredCount, selection, monthLabel, onRun }: {
  open: boolean; onClose: () => void; filteredCount: number; selection: string[]; monthLabel: string;
  onRun: (o: { scope: "filtered" | "ids" | "month"; format: "excel" | "csv"; cols: string[] }) => Promise<string>;
}) {
  const t = useTranslations("prospects.desk.export");
  const tr = useTranslations("prospects.desk.reassign");
  const [scope, setScope] = useState<"filtered" | "ids" | "month">(selection.length ? "ids" : "filtered");
  const [format, setFormat] = useState<"excel" | "csv">("excel");
  const [cols, setCols] = useState<Set<string>>(() => new Set(DEFAULT_ON));
  const [showCols, setShowCols] = useState(false);
  const [phase, setPhase] = useState<"idle" | "working" | "done" | "error">("idle");
  const n = scope === "ids" ? selection.length : scope === "filtered" ? filteredCount : null;
  const run = async () => {
    setPhase("working");
    try {
      await onRun({ scope, format, cols: EXPORT_COLS.filter((c) => cols.has(c)) });
      setPhase("done");
      setTimeout(() => { setPhase("idle"); onClose(); }, 900);
    } catch { setPhase("error"); }
  };
  const Scope = ({ k, title, sub, disabled }: { k: typeof scope; title: string; sub: string; disabled?: boolean }) => (
    <button type="button" className={`scope${scope === k ? " on" : ""}`} disabled={disabled} onClick={() => setScope(k)}>
      <span className={`rd${scope === k ? " on" : ""}`} /><span><b>{title}</b><small>{sub}</small></span>
    </button>
  );
  if (!open) return null;
  return (
    <div className="modal on" role="dialog" aria-modal="true" aria-label={t("title")}>
      <div className="dh" style={{ border: 0, paddingBottom: 6 }}>
        <span className="exi"><Download className="ic" /></span>
        <div className="tt"><h3>{t("title")}</h3><p>{t("sub")}</p></div>
        <button type="button" className="ib" onClick={onClose} aria-label={t("title")}><X className="ic" /></button>
      </div>
      <div className="exb">
        <div className="fld" style={{ marginTop: 4 }}><span>{t("scope")}</span>
          <Scope k="filtered" title={t("filtered")} sub={t("filteredSub", { n: filteredCount })} />
          <Scope k="ids" title={t("selection")} sub={selection.length ? t("selectionSub", { n: selection.length }) : t("selectionNone")} disabled={!selection.length} />
          <Scope k="month" title={t("month", { month: monthLabel })} sub={t("monthSub")} />
        </div>
        <div className="fld"><span>{t("format")}</span>
          <div className="segc">
            <button type="button" className={format === "excel" ? "on" : ""} onClick={() => setFormat("excel")}><Grid3x3 className="ic" />Excel</button>
            <button type="button" className={format === "csv" ? "on" : ""} onClick={() => setFormat("csv")}><FileText className="ic" />CSV</button>
          </div>
        </div>
        <div className="fld">
          <button type="button" className="colsh" aria-expanded={showCols} onClick={() => setShowCols((s) => !s)}>
            <span>{t("columns")}</span><small>{t("columnsN", { n: cols.size })}</small><ChevronDown className={`ic${showCols ? " rot" : ""}`} />
          </button>
          {showCols ? (
            <div className="colsg">
              {EXPORT_COLS.map((c) => (
                <label key={c}><input type="checkbox" checked={cols.has(c)} onChange={(e) => { const s = new Set(cols); if (e.target.checked) s.add(c); else s.delete(c); setCols(s); }} />{t(`cols.${c}`)}</label>
              ))}
            </div>
          ) : null}
        </div>
        {phase === "error" ? <p className="help" style={{ color: "var(--bad)" }}>{t("failed")}</p> : null}
      </div>
      <div className="df" style={{ borderRadius: "0 0 20px 20px", marginTop: 14 }}>
        <span className="meta" />
        <button type="button" className="btn sec" onClick={onClose}>{tr("cancel")}</button>
        <button type="button" className={`btn pri exgo ${phase === "working" ? "working" : phase === "done" ? "done" : ""}`} disabled={phase !== "idle" && phase !== "error" || !cols.size || n === 0} onClick={run}>
          <span className="exfill" />
          <span className="exl">
            {phase === "working" ? <><Loader2 className="ic spin" />{t("working")}</> : phase === "done" ? <><Check className="ic" />{t("ready")}</> : <><Download className="ic" />{t("go")}{n !== null ? ` · ${n}` : ""}</>}
          </span>
        </button>
      </div>
    </div>
  );
}

export function ReassignDialog({ open, count, agents, fileCap, onClose, onGo }: {
  open: boolean; count: number; agents: AgentCard[]; fileCap: number; onClose: () => void; onGo: (agentId: string) => Promise<void>;
}) {
  const t = useTranslations("prospects.desk.reassign");
  const tt = useTranslations("prospects.desk.team");
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  return (
    <div className="modal on" role="dialog" aria-modal="true" aria-label={t("title")}>
      <div className="dh" style={{ border: 0, paddingBottom: 4 }}>
        <div className="tt"><h3>{t("title")}</h3><p>{t("sub", { n: count })}</p></div>
        <button type="button" className="ib" onClick={onClose} aria-label={t("cancel")}><X className="ic" /></button>
      </div>
      <div className="pick">
        {agents.map((a) => (
          <button key={a.id} type="button" className={pick === a.id ? "on" : ""} onClick={() => setPick(a.id)}>
            <Avatar id={a.id} name={a.name} color={a.color} size={24} />
            <b style={{ fontSize: 14 }}>{a.name}</b>
            <span style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600 }}>{a.online ? tt("online") : tt("offline")}</span>
            <span className={`fill num${a.file_open >= fileCap ? " full" : ""}`}>{t("fill", { n: a.file_open, cap: fileCap })}</span>
          </button>
        ))}
      </div>
      <div className="df" style={{ borderRadius: "0 0 20px 20px", marginTop: 12 }}>
        <span className="meta" />
        <button type="button" className="btn sec" onClick={onClose}>{t("cancel")}</button>
        <button type="button" className="btn pri" disabled={!pick || busy} onClick={async () => { if (!pick) return; setBusy(true); try { await onGo(pick); } finally { setBusy(false); } }}>{t("go")}</button>
      </div>
    </div>
  );
}

const LOST_REASONS = ["not_interested", "price", "unreachable", "competitor", "wrong_number", "duplicate", "autre"] as const;

export function CloseDialog({ open, count, onClose, onGo }: { open: boolean; count: number; onClose: () => void; onGo: (reason: string, note: string) => Promise<void> }) {
  const t = useTranslations("prospects.desk.close");
  const tl = useTranslations("prospects.lost");
  const tr = useTranslations("prospects.desk.reassign");
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  return (
    <div className="modal on" role="dialog" aria-modal="true" aria-label={t("title")}>
      <div className="dh" style={{ border: 0, paddingBottom: 4 }}>
        <div className="tt"><h3>{t("title")}</h3><p>{t("sub", { n: count })}</p></div>
        <button type="button" className="ib" onClick={onClose} aria-label={tr("cancel")}><X className="ic" /></button>
      </div>
      <div className="exb">
        <div className="fld" style={{ marginTop: 4 }}><span>{t("reason")}</span>
          <div className="chips">{LOST_REASONS.map((r) => <button key={r} type="button" className={`mchip${reason === r ? " on" : ""}`} onClick={() => setReason(r)}>{reason === r ? <Check className="ic" /> : null}{tl(r)}</button>)}</div>
        </div>
        <label className="fld"><span>{t("note")}</span><input className="inp" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <div className="df" style={{ borderRadius: "0 0 20px 20px", marginTop: 14 }}>
        <span className="meta" />
        <button type="button" className="btn sec" onClick={onClose}>{tr("cancel")}</button>
        <button type="button" className="btn pri" disabled={!reason || busy} onClick={async () => { if (!reason) return; setBusy(true); try { await onGo(reason, note); } finally { setBusy(false); } }}>{t("go")}</button>
      </div>
    </div>
  );
}
