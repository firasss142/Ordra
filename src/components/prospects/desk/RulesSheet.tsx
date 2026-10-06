"use client";

/** « Règles »: what Ordra turns into prospects, and how it hands them out. */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PhoneOff, Repeat, Undo2, X } from "lucide-react";
import type { RecoverySettings } from "@/lib/prospects/desk/types";
import { RECOVERABLE_SUBREASONS } from "@/lib/prospects/desk/rules";
import type { AgentCard } from "@/lib/prospects/desk/model";
import { Avatar } from "./parts";

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`sw${on ? " on" : ""}`} onClick={() => onChange(!on)} />;
}

function Num({ value, onChange, label, min, max, width }: { value: number; onChange: (v: number) => void; label: string; min: number; max: number; width?: number }) {
  return (
    <input className="inp" type="number" inputMode="numeric" min={min} max={max} aria-label={label} value={value} style={width ? { width } : undefined}
      onChange={(e) => onChange(Math.trunc(Number(e.target.value)))} />
  );
}

export function RulesSheet({ open, settings, agents, reasonLabel, counts, onClose, onSave }: {
  open: boolean; settings: RecoverySettings | null; agents: AgentCard[]; reasonLabel: (k: string) => string;
  counts: Record<string, number> | null; onClose: () => void; onSave: (s: RecoverySettings) => Promise<string | null>;
}) {
  const t = useTranslations("prospects.desk.rulesSheet");
  const [d, setD] = useState<RecoverySettings | null>(settings);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setD(settings); setError(null); } }, [open, settings]);
  const up = (patch: (s: RecoverySettings) => RecoverySettings) => setD((s) => (s ? patch(s) : s));
  const icon = (I: typeof PhoneOff) => <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: "rgba(15,23,40,.05)" }}><I className="ic" /></span>;

  return (
    <aside className={`drawer${open ? " on" : ""}`} aria-label={t("title")} aria-hidden={!open}>
      <div className="dh"><div className="tt"><h3>{t("title")}</h3><p>{t("sub")}</p></div><button type="button" className="ib" onClick={onClose} aria-label={t("cancel")}><X className="ic" /></button></div>
      {d ? (
        <div className="db">
          <div className="sec"><div className="rule-h"><b>{t("enabled")}</b><Switch on={d.enabled} label={t("enabled")} onChange={(v) => up((s) => ({ ...s, enabled: v }))} /></div>
            {!d.enabled ? <p className="help">{t("enabledSub")}</p> : null}
          </div>
          <div style={d.enabled ? undefined : { opacity: 0.45, pointerEvents: "none" }} className="db" >
            <div className="sec">
              <div className="rule-h">{icon(PhoneOff)}<b>{t("rej")}</b><Switch on={d.rej.on} label={t("rej")} onChange={(v) => up((s) => ({ ...s, rej: { ...s.rej, on: v } }))} /></div>
              <div style={d.rej.on ? undefined : { opacity: 0.45, pointerEvents: "none" }}>
                <div className="fld"><span className="n2">{t("delay")} <Num value={d.rej.delay_days} min={0} max={60} label={t("delay")} onChange={(v) => up((s) => ({ ...s, rej: { ...s.rej, delay_days: v } }))} /> {t("delay2")}</span></div>
                <p className="help" style={{ marginTop: 12, fontWeight: 700, color: "var(--ink-2)" }}>{t("reasons")}</p>
                <div className="reasons">
                  {RECOVERABLE_SUBREASONS.map((k) => {
                    const on = d.rej.subreasons.includes(k);
                    return (
                      <label key={k} className={on ? "" : "off"}>
                        <input type="checkbox" checked={on} onChange={(e) => up((s) => ({ ...s, rej: { ...s.rej, subreasons: e.target.checked ? [...s.rej.subreasons, k] : s.rej.subreasons.filter((x) => x !== k) } }))} />
                        {reasonLabel(k)}{counts && counts[k] !== undefined ? <small className="num">{counts[k]}</small> : null}
                      </label>
                    );
                  })}
                </div>
                <p className="help">{t("never")}</p>
              </div>
            </div>
            <div className="sec">
              <div className="rule-h">{icon(Undo2)}<b>{t("ret")}</b><Switch on={d.ret.on} label={t("ret")} onChange={(v) => up((s) => ({ ...s, ret: { on: v } }))} /></div>
              <p className="help">{t("retSub")}</p>
            </div>
            <div className="sec">
              <div className="rule-h">{icon(Repeat)}<b>{t("old")}</b><Switch on={d.old.on} label={t("old")} onChange={(v) => up((s) => ({ ...s, old: { ...s.old, on: v } }))} /></div>
              <div className="fld" style={d.old.on ? undefined : { opacity: 0.45, pointerEvents: "none" }}>
                <span className="n2">{t("after")} <Num value={d.old.after_days} min={7} max={365} label={t("after")} onChange={(v) => up((s) => ({ ...s, old: { ...s.old, after_days: v } }))} /> {t("after2")}</span>
              </div>
            </div>
            <div className="sec"><h4>{t("dist")}</h4>
              <div className="fld" style={{ marginTop: 0 }}><span className="n2">{t("hour")}
                <select className="inp" style={{ width: 92 }} value={d.dist.hour} aria-label={t("hour")} onChange={(e) => up((s) => ({ ...s, dist: { ...s.dist, hour: Number(e.target.value) } }))}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
                </select></span></div>
              <div className="fld"><span className="n2">{t("cap")} <Num value={d.dist.file_cap} min={1} max={200} label={t("cap")} onChange={(v) => up((s) => ({ ...s, dist: { ...s.dist, file_cap: v } }))} /> {t("cap2")}</span></div>
              <div className="fld"><span className="n2">{t("release")} <Num value={d.dist.release_days} min={1} max={30} label={t("release")} onChange={(v) => up((s) => ({ ...s, dist: { ...s.dist, release_days: v } }))} /> {t("release2")}</span></div>
              <div className="fld"><span className="n2">{t("tries")} <Num value={d.dist.max_tries} min={1} max={10} label={t("tries")} onChange={(v) => up((s) => ({ ...s, dist: { ...s.dist, max_tries: v } }))} /> {t("tries2")}</span></div>
              <div className="fld" style={{ marginTop: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
                <span className="avs">{agents.filter((a) => a.in_rotation).map((a) => <Avatar key={a.id} id={a.id} name={a.name} color={a.color} size={24} />)}</span>
                <span className="help" style={{ margin: 0 }}>{t("agents")} ({agents.filter((a) => a.in_rotation).length})</span>
              </div>
              <p className="help" style={{ marginTop: 12 }}>{t("note")}</p>
            </div>
          </div>
        </div>
      ) : <div className="db"><div className="skel" style={{ height: 240 }} /></div>}
      <div className="df">
        <span className="meta" style={error ? { color: "var(--bad)" } : undefined}>{error ? t("invalid", { field: error }) : ""}</span>
        <button type="button" className="btn sec" onClick={onClose}>{t("cancel")}</button>
        <button type="button" className="btn pri" disabled={!d || busy} onClick={async () => { if (!d) return; setBusy(true); const e = await onSave(d); setBusy(false); setError(e); }}>{t("save")}</button>
      </div>
    </aside>
  );
}
