"use client";

/**
 * The second view (« Livreurs ») and the reassign dialog.
 *
 * The dialog no longer promises that « the commission follows the new agent »:
 * the ledger still attributes on the last confirmed transition (CLAUDE.md open
 * discrepancy 4), and the screen must not say what the data does not do.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Phone } from "lucide-react";
import type { CarrierRow, CourierRow } from "@/lib/delivery/board";
import { formatPhone } from "@/lib/delivery/presentation";
import { Avatar } from "./parts";
import type { AgentCard } from "./Strips";

/** A stable accent per carrier account, from its id — the §4.18 carrier hues. */
const ACCENTS = ["#2563EB", "#0D9488", "#7C3AED", "#C2410C", "#0E7490"];
const accentOf = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return ACCENTS[h % ACCENTS.length]; };
const initials = (name: string) => name.split(/[\s—-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

export function CouriersView({ carriers, couriers }: { carriers: CarrierRow[]; couriers: (CourierRow & { carrier: string | null })[] }) {
  const t = useTranslations("delivery.manager.couriers");
  const cn = (n: number, cls: string) => <span className={`cnum num${n ? ` ${cls}` : " zero"}`}>{n}</span>;
  return (
    <>
      <div className="sh"><h2>{t("carsTitle")}</h2><small>{t("carsHint")}</small></div>
      <section className="cars">
        {carriers.map((c) => (
          <div key={c.id} className="card car" style={{ ["--acc" as string]: accentOf(c.id) }}>
            <div className="top"><span className="lg">{initials(c.name)}</span><div><h3>{c.name}</h3><p className="rule">{t("carRule")}</p></div></div>
            <div className="figs">
              <div><b className={`num${c.inFlight ? "" : " zero"}`}>{c.inFlight}</b><small>{t("enRoute")}</small></div>
              <div><b className={`num${c.toTreat ? " warn" : " zero"}`}>{c.toTreat}</b><small>{t("toTreat")}</small></div>
              <div><b className={`num${c.returning ? "" : " zero"}`}>{c.returning}</b><small>{t("returning")}</small></div>
            </div>
          </div>
        ))}
      </section>
      <div className="sh"><h2>{t("title")}</h2><small>{t("hint")}</small></div>
      <section className="card list ctab">
        {couriers.length === 0 ? <div className="empty"><b>{t("title")}</b>{t("none")}</div> : (
          <>
            <div className="thead" aria-hidden>
              <span>{t("c")}</span><span>{t("car")}</span><span className="e">{t("held")}</span><span className="e">{t("na")}</span><span className="e">{t("ret")}</span><span />
            </div>
            {couriers.map((c) => (
              <div key={c.name} className="row">
                <div className="cell"><div className="l1"><bdi>{c.name}</bdi></div>{c.phone ? <div className="l2"><bdi dir="ltr">{formatPhone(c.phone)}</bdi></div> : null}</div>
                <div className="cell l2" style={{ margin: 0 }}>{c.carrier ?? "—"}</div>
                {cn(c.held, "")}{cn(c.noAnswer, "warn")}{cn(c.returning, "bad")}
                <div style={{ textAlign: "end" }}>{c.phone ? <a className="btn sec sm" href={`tel:${c.phone}`}><Phone className="ic" />{t("call")}</a> : null}</div>
              </div>
            ))}
          </>
        )}
      </section>
    </>
  );
}

const VDOT = { late: "var(--warn-dot)", idle: "var(--ink-4)", ok: "var(--live)" } as const;

export function ReassignDialog({ count, agents, fromId, onClose, onGo }: {
  count: number; agents: AgentCard[]; fromId: string | null; onClose: () => void; onGo: (agentId: string) => Promise<void>;
}) {
  const t = useTranslations("delivery.manager");
  const [to, setTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = agents.find((a) => a.id === to) ?? null;
  const go = async () => {
    if (!to) return;
    setBusy(true);
    setError(null);
    try { await onGo(to); } catch (e) { setError(e instanceof Error ? e.message : t("reassign.failed")); setBusy(false); }
  };
  return (
    <>
      <div className="modal-s" onClick={onClose} aria-hidden />
      <div className="modal" role="dialog" aria-modal="true" aria-label={t("reassign.title", { n: count })}>
        <div className="mh"><b>{t("reassign.title", { n: count })}</b><small>{t("reassign.sub")}</small></div>
        <div className="pick">
          {agents.filter((a) => a.id !== fromId).map((a) => (
            <button key={a.id} type="button" className={to === a.id ? "on" : ""} aria-pressed={to === a.id} onClick={() => setTo(a.id)}>
              <Avatar id={a.id} name={a.name} color={a.color} small />
              <span className="nm2">{a.name}</span>
              <span className="ld"><i className="d" style={{ background: VDOT[a.verdict] }} />{t(`verdict.${a.verdict}`)} · {t("reassign.load", { n: a.inFlight })}</span>
            </button>
          ))}
        </div>
        {error ? <p className="err" role="alert">{error}</p> : null}
        <div className="mf">
          <button type="button" className="btn sec" onClick={onClose}>{t("reassign.cancel")}</button>
          <button type="button" className="btn pri" disabled={!target || busy} onClick={() => void go()}>
            {busy ? t("reassign.working") : target ? t("reassign.go", { name: target.name }) : t("reassign.pick")}
          </button>
        </div>
      </div>
    </>
  );
}
