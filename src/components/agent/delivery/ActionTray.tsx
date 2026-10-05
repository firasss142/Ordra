"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { WorklistRow } from "@/lib/delivery/types";
import { OUTCOMES_BY_ACTION, NOTE_MAX, type AgentActionType } from "@/lib/delivery/actions";
import { inTwoHours, tomorrowAt } from "@/lib/delivery/schedule";
import { suggestedReminder, type Reminder } from "@/lib/delivery/presentation";
import type { QueuedBody } from "@/hooks/useDeliveryActionQueue";
import { FeedbackOffer, useFeedbackOffer } from "@/components/feedback/FeedbackOffer";
import { useFeedbackTopics } from "@/hooks/useFeedback";
import { offersFeedback } from "@/lib/feedback/taxonomy";
import { momentOf } from "@/lib/feedback/moment";
import { Ic } from "@/components/agent/shared";

export type Who = Exclude<AgentActionType, "whatsapp_customer">;
const WHOS: Who[] = ["call_customer", "call_courier", "call_branch", "note"];
const REMINDERS: Reminder[] = ["in2h", "tomorrow10", "none"];

/**
 * « Enregistrer une action » (prototype dlvActionSheet) — who you talked to, what came of it,
 * why, and when to come back. A modal on a desktop, a bottom sheet on a phone. Voix du client:
 * « Veut annuler » / « Retour confirmé » still offer to keep the customer's words (live ActionSheet).
 */
export function ActionTray({ row, initialWho, phone, tz, now, feedbackEnabled, marketId, onClose, onSubmit }: {
  row: WorklistRow;
  initialWho: Who;
  phone: boolean;
  tz: string;
  now: number;
  feedbackEnabled: boolean;
  marketId: string | null;
  onClose: () => void;
  onSubmit: (body: QueuedBody) => void;
}) {
  const t = useTranslations("agentDelivery");
  const tFeedback = useTranslations("feedback.offer");
  const titleId = useId();
  const [who, setWho] = useState<Who>(initialWho);
  const [res, setRes] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [rem, setRem] = useState<Reminder>("none");
  const [remTouched, setRemTouched] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const results = who === "note" ? [] : (OUTCOMES_BY_ACTION[who] as readonly string[]);
  const topics = useFeedbackTopics(marketId, feedbackEnabled);
  const offer = useFeedbackOffer({ topics, words: note, remark: row.latest_remark, remarkClass: row.remark_class });
  const offering = feedbackEnabled && who !== "note" && offersFeedback(res);
  const keeping = offering && offer.state.on && offer.state.category !== null;
  const ready = who === "note" ? note.trim().length > 0 : res !== null && (!keeping || note.trim().length > 0);

  const save = () => {
    if (!ready) return;
    onSubmit({
      action_type: who,
      outcome: who === "note" ? "none" : (res as string),
      note: note.trim() || null,
      next_action_at: rem === "in2h" ? inTwoHours(now) : rem === "tomorrow10" ? tomorrowAt(now, tz, 10) : null,
      template_key: null,
      ...(keeping ? { feedback: { category: offer.state.category!, topic_id: offer.state.topicId } } : {}),
    });
  };

  const tray = (
    <div className="tray lt">
      <div className="tray-h">
        <span className="hold h-neutral"><Ic n="check" /></span>
        <span className="tt">
          <b id={titleId}>{t("sheet.title")}</b>
          <small dir="auto">{row.customer_name}{row.tracking_number ? <> · <span className="num">{row.tracking_number}</span></> : null}</small>
        </span>
        <button type="button" className="xbtn" onClick={onClose} aria-label={t("detail.close")}><Ic n="x" /></button>
      </div>
      <div className="rg">
        <h6>{t("sheet.who")}</h6>
        <div className="seg sm2">
          {WHOS.map((k) => (
            <button key={k} type="button" className={who === k ? "on" : ""} aria-pressed={who === k}
              onClick={() => { setWho(k); setRes(null); }}>
              {t(`sheet.whos.${k}`)}
            </button>
          ))}
        </div>
      </div>
      {results.length > 0 && (
        <div className="rg">
          <h6>{t("sheet.result")}</h6>
          <div className="rch h-violet">
            {results.map((r) => (
              <button key={r} type="button" className={`rc${res === r ? " on" : ""}`} aria-pressed={res === r}
                onClick={() => { setRes(r); if (!remTouched) setRem(suggestedReminder(r)); }}>
                {t(`sheet.outcomes.${r}`)}
              </button>
            ))}
          </div>
        </div>
      )}
      {offering && (
        <FeedbackOffer kind="delivery" offer={offer} topics={topics} remark={row.latest_remark}
          moment={momentOf(row.status, true)} status={row.status} />
      )}
      <textarea className="inp" placeholder={keeping ? tFeedback("wordsLabel") : t("sheet.why")} dir="auto" style={{ height: 56 }}
        maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="rg">
        <h6>{t("sheet.remind")}</h6>
        <div className="rch h-violet">
          {REMINDERS.map((k) => (
            <button key={k} type="button" className={`rc${rem === k ? " on" : ""}`} aria-pressed={rem === k}
              onClick={() => { setRem(k); setRemTouched(true); }}>
              {t(`sheet.reminders.${k}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="trayf">
        <button type="button" className="fa" onClick={onClose}>{t("sheet.cancel")}</button>
        <button type="button" className="fa pri wide" disabled={!ready} onClick={save}>
          <Ic n="check" /><span>{t("sheet.save")}</span>
        </button>
      </div>
    </div>
  );

  if (phone) {
    return (
      <>
        <div className="shscrim" onClick={onClose} />
        <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="grab" />
          {tray}
        </div>
      </>
    );
  }
  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mbox" role="dialog" aria-modal="true" aria-labelledby={titleId}>{tray}</div>
    </div>
  );
}
