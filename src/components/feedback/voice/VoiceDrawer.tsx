"use client";

import { useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, MessageSquareQuote, Target, Trash2, X } from "lucide-react";
import type { ComplaintStatus } from "@/lib/feedback/taxonomy";
import type { FeedbackSheetRow, FeedbackTopic } from "@/types/feedback";
import { Avatar, catStyle, MOMENT_ICON, Thumb, topicLabel } from "./parts";
import { isToCheck } from "./SheetView";

interface Props {
  row: FeedbackSheetRow;
  topics: FeedbackTopic[];
  timeZone: string;
  busy: boolean;
  onClose: () => void;
  onStatus: (status: ComplaintStatus) => void;
  onTopic: (topicId: string | null) => void;
  onDiscard: () => void;
}

/** One entry — prototype voix-du-client-et-messages-v2, `drawer()`. */
export function VoiceDrawer({ row: r, topics, timeZone, busy, onClose, onStatus, onTopic, onDiscard }: Props) {
  const t = useTranslations("feedback.voice");
  const tf = useTranslations("feedback");
  const locale = useLocale();
  const complaint = r.category === "reclamation";
  const courier = r.source === "courier";
  const who = courier ? t("courier") : r.author?.name ?? "—";
  const MomentIcon = MOMENT_ICON[r.moment];
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone }).format(new Date(r.created_at));
  const label = (x: FeedbackTopic) => (locale.startsWith("ar") ? x.label_ar : x.label_fr);
  // Any reason outside complaints; the category follows the reason.
  const choices = topics.filter((x) => x.category !== "reclamation").sort((a, b) => (a.category === b.category ? a.sort_order - b.sort_order : a.category === "objection" ? -1 : 1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={topicLabel(topics, r.topic_id, locale) ?? t("noReason")}>
        <div className="dh">
          <div>
            <div className="eyebrow" style={catStyle(r.category)}><span className="dot" />{tf(`cat.${r.category}`)}</div>
            <h2>{topicLabel(topics, r.topic_id, locale) ?? t("noReason")}</h2>
            <div className="s">
              {complaint && r.status ? <span className={`st ${r.status}`}><i />{t(`status.${r.status}`)}</span> : isToCheck(r) ? <span className="st check">{t("toCheck")}</span> : null}
              <span>{date}</span>
            </div>
          </div>
          <button type="button" className="x" onClick={onClose} aria-label={t("drawer.close")}><X className="ic" aria-hidden /></button>
        </div>
        <div className="db">
          <div className="gl">
            <div className="eyebrow"><MessageSquareQuote className="ic" aria-hidden />{t("cols.says")}</div>
            <p className="bigq">{r.body}</p>
          </div>
          <div className="gl">
            <dl className="facts">
              <dt>{t("drawer.product")}</dt>
              <dd>{r.product ? <><Thumb id={r.product.id} url={r.product.image_url} small /><span className="ar">{r.product.name}</span></> : t("noProduct")}</dd>
              {(r.customer_name || r.customer_phone) && (
                <>
                  <dt>{t("drawer.customer")}</dt>
                  <dd><span>{r.customer_name}{r.customer_name && r.customer_phone ? " · " : ""}{r.customer_phone && <span dir="ltr" className="num">{r.customer_phone}</span>}</span></dd>
                </>
              )}
              {r.order_id && (
                <>
                  <dt>{t("drawer.order")}</dt>
                  <dd><a href={`/${locale}/orders?open=${r.order_id}`} dir="ltr">#{r.order_ref}</a></dd>
                </>
              )}
              <dt>{t("drawer.moment")}</dt>
              <dd><span className="mom"><MomentIcon className="ic" aria-hidden />{t(`momentLong.${r.moment}`)}</span></dd>
              <dt>{t("drawer.by")}</dt>
              <dd><Avatar id={r.author?.id ?? null} name={who} courier={courier} />{who}</dd>
              <dt>{t("drawer.source")}</dt>
              <dd style={{ fontWeight: 500, color: "var(--ink-2)" }}>{t(`source.${r.source}`)}</dd>
            </dl>
          </div>
          {!complaint && (
            <div className="gl">
              <div className="eyebrow" style={{ marginBottom: 8 }}><Target className="ic" aria-hidden />{t("drawer.reason")}</div>
              <select className="sel" value={r.topic_id ?? ""} disabled={busy} aria-label={t("drawer.reason")}
                onChange={(e) => onTopic(e.target.value || null)}>
                {choices.map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}
                <option value="">{t("noReason")}</option>
              </select>
            </div>
          )}
        </div>
        <div className="df">
          {complaint && r.status === "resolved" && (
            <button type="button" className="btn sec" disabled={busy} onClick={() => onStatus("open")}>{t("reopen")}</button>
          )}
          {complaint && r.status === "open" && (
            <button type="button" className="btn sec" disabled={busy} onClick={() => onStatus("in_progress")}>{t("take")}</button>
          )}
          {complaint && r.status !== "resolved" && (
            <button type="button" className="btn pri" disabled={busy} onClick={() => onStatus("resolved")}><Check className="ic" aria-hidden />{t("resolve")}</button>
          )}
          <span className="sp" />
          <button type="button" className="btn ghost" disabled={busy} onClick={onDiscard}><Trash2 className="ic" aria-hidden />{t("bulk.discard")}</button>
        </div>
      </aside>
    </>
  );
}
