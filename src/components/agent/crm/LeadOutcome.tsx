"use client";

/**
 * `leadOutcome` — « Résultat de l'appel »: four tiles, then whatever the chosen one needs.
 * Inside the prospect on a desktop (`.m2` in the detail), a bottom sheet on a phone.
 * « Veut commander » is not saved here: it opens the prefilled order form.
 */
import { useState } from "react";
import { Ic, type AgentHue } from "@/components/agent/shared";
import { callbackChoices } from "@/lib/prospects/presentation";
import type { ProspectRow } from "@/lib/prospects/types";
import { canSaveOutcome, type OutKind } from "./crm-model";
import type { CrmWords } from "./words";

/** What the tray hands back: the outcome the API takes, plus the note. */
export type OutcomeDraft =
  | { kind: "no_answer"; note: string | null }
  | { kind: "callback"; at: string; note: string | null }
  | { kind: "lost"; reason: string; note: string | null };

const LOUT: [OutKind, AgentHue, string][] = [
  ["want", "green", "bag"],
  ["later", "violet", "clock"],
  ["na", "amber", "phoneoff"],
  ["no", "red", "thumbdown"],
];

/** The prototype's five words, mapped onto `LEAD_LOST_REASONS`. */
const LOST = ["price", "not_interested", "competitor", "wrong_number", "autre"] as const;

export function LeadOutcome({ row, w, tz, initial = null, onClose, onSave, onWant }: {
  row: ProspectRow;
  w: CrmWords;
  tz: string;
  /** « Clore » opens the tray on « Pas intéressé ». */
  initial?: OutKind | null;
  onClose: () => void;
  onSave: (draft: OutcomeDraft) => void;
  onWant: (row: ProspectRow) => void;
}) {
  const { t } = w;
  const [kind, setKind] = useState<OutKind | null>(initial);
  const [sub, setSub] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [choices] = useState(() => callbackChoices(Date.now(), tz));

  const save = () => {
    if (!canSaveOutcome(kind, sub)) return;
    const n = note.trim() === "" ? null : note.trim();
    if (kind === "want") onWant(row);
    else if (kind === "na") onSave({ kind: "no_answer", note: n });
    else if (kind === "later") {
      const c = choices.find((x) => x.key === sub);
      if (c) onSave({ kind: "callback", at: c.at, note: n });
    } else if (kind === "no" && sub) onSave({ kind: "lost", reason: sub, note: n });
  };

  return (
    <div className="tray lt">
      <div className="tray-h">
        <span className="hold h-neutral"><Ic n="phone" /></span>
        <span className="tt"><b>{t("out.title")}</b><small dir="auto">{row.customer_name}</small></span>
        <button type="button" className="xbtn" onClick={onClose} aria-label={t("out.cancel")}><Ic n="x" /></button>
      </div>
      <div className="oc4 sm">
        {LOUT.map(([k, hue, icon]) => (
          <button
            key={k}
            type="button"
            className={`oct h-${hue}${kind === k ? " sel" : ""}`}
            aria-pressed={kind === k}
            onClick={() => { setKind(k); setSub(null); }}
          >
            <Ic n={icon} />
            {t(`out.${k}`)}
          </button>
        ))}
      </div>
      {kind === "later" ? (
        <div className="rch h-violet">
          {choices.map((c) => (
            <button key={c.key} type="button" className={`rc${sub === c.key ? " on" : ""}`} aria-pressed={sub === c.key} onClick={() => setSub(c.key)}>
              {t(`out.when.${c.key}`)}
            </button>
          ))}
        </div>
      ) : null}
      {kind === "no" ? (
        <div className="rch h-red">
          {LOST.map((r) => (
            <button key={r} type="button" className={`rc${sub === r ? " on" : ""}`} aria-pressed={sub === r} onClick={() => setSub(r)}>
              {t(`out.lost.${r}`)}
            </button>
          ))}
        </div>
      ) : null}
      {kind === "want" ? <p className="q" style={{ fontSize: 13 }}>{t("out.wantHint")}</p> : null}
      <textarea
        className="inp"
        placeholder={t("out.note")}
        aria-label={t("out.note")}
        dir="auto"
        style={{ height: 52 }}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="trayf">
        <button type="button" className="fa" onClick={onClose}>{t("out.cancel")}</button>
        <button type="button" className="fa pri wide" disabled={!canSaveOutcome(kind, sub)} onClick={save}>
          <Ic n="check" />
          <span>{t("out.save")}</span>
        </button>
      </div>
    </div>
  );
}
