"use client";

import { useEffect, useMemo, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Ban, FileText, Image as ImageIcon, MessageCircle, RotateCcw, Zap } from "lucide-react";
import type { MessageRow } from "@/lib/whatsapp/send";
import type { ThreadConversation } from "@/lib/whatsapp/thread";
import { StatusGlyph } from "./StatusGlyph";

/**
 * The conversation, oldest first, opened on the newest message. Prototype:
 * whatsapp-agent-v1.html (`threadHtml`, the `.msg` / `.bub` block). In
 * bubbles white, out bubbles WhatsApp green, a template head on templated
 * sends ("Automatique · Expédié" when the system sent it, "Modèle" when an
 * agent did), the agent's name on what they sent, a sent image inside its
 * bubble, a failed row in red with Meta's code and a retry, the opt-out as a
 * system row.
 */
export interface MessageThreadProps {
  messages: MessageRow[];
  conversation: ThreadConversation | null;
  /** Newest inbound the agent had not seen when the thread opened get a soft ring. */
  highlightUnread?: boolean;
  onRetry?: (message: MessageRow) => void;
  className?: string;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function daysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function MessageThread({ messages, conversation, highlightUnread = true, onRetry, className = "" }: MessageThreadProps) {
  const t = useTranslations("whatsapp");
  const locale = useLocale();
  const intlLocale = locale === "ar" ? "ar-LY" : "fr-FR";

  const dayLabel = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "long" });
    return (iso: string) => {
      const n = daysBetween(new Date(iso), new Date());
      if (n <= 0) return t("thread.today");
      if (n === 1) return t("thread.yesterday");
      if (n < 7) return t("thread.daysAgo", { count: n });
      return fmt.format(new Date(iso));
    };
  }, [intlLocale, t]);

  const time = useMemo(() => new Intl.DateTimeFormat(intlLocale, { hour: "2-digit", minute: "2-digit" }), [intlLocale]);
  const shortDate = useMemo(() => new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short" }), [intlLocale]);

  // What was unread when the agent opened the thread stays ringed after it is
  // marked read — marking read is bookkeeping, not "the agent has seen it".
  const ringed = useRef<Set<string>>(new Set());
  if (highlightUnread && conversation?.unread_count) {
    const inbound = messages.filter((m) => m.direction === "in");
    for (const m of inbound.slice(-conversation.unread_count)) ringed.current.add(m.id);
  }

  // Open on the newest message, and follow new ones.
  const endRef = useRef<HTMLSpanElement | null>(null);
  const lastId = messages.at(-1)?.id ?? null;
  useEffect(() => {
    const el = endRef.current;
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "end" });
  }, [lastId]);

  if (messages.length === 0) {
    return (
      <div className={`flex flex-col items-center gap-1.5 px-4 py-8 text-center ${className}`}>
        <span className="inline-flex items-center gap-2 rounded-full border border-[#E5E7EB] bg-white px-3 py-1.5 text-[12.5px] text-[#374151]">
          <MessageCircle size={13} className="text-[#6B7280]" aria-hidden="true" />
          {t("thread.empty")}
        </span>
        <span className="text-[12px] text-[#6B7280]">{t("thread.emptySub")}</span>
      </div>
    );
  }

  let lastDay = "";

  return (
    <div className={`flex flex-col gap-1.5 px-[18px] pb-2 pt-3.5 ${className}`} data-testid="whatsapp-thread">
      {messages.map((m) => {
        const day = dayKey(new Date(m.created_at));
        const sep = day !== lastDay;
        lastDay = day;
        const out = m.direction === "out";
        const failed = m.status === "failed";
        const auto = m.actor_type === "system" || m.actor_type === "campaign";
        const isNew = !out && ringed.current.has(m.id);
        const eventLabel = m.event_key ? t(`events.${m.event_key}` as Parameters<typeof t>[0]) : null;
        const hasImage = m.kind === "image" || (m.kind === "template" && Boolean(m.media_link));
        const text = m.body ?? m.media_caption ?? "";
        return (
          <div key={m.id} className="contents">
            {sep && (
              <span className="mb-1 mt-1.5 self-center rounded-full border border-[#E5E7EB] bg-white px-2.5 py-[3px] text-[11.5px] font-semibold text-[#6B7280]">
                {dayLabel(m.created_at)}
              </span>
            )}
            <div data-dir={m.direction} data-failed={failed || undefined} data-new={isNew || undefined} className={`flex max-w-[78%] flex-col gap-1 ${out ? "self-end" : "self-start"}`}>
              <div
                dir="auto"
                className={[
                  "whitespace-pre-wrap rounded-[14px] border px-3 pb-2 pt-[9px] text-[14.5px] leading-[1.55] [unicode-bidi:plaintext]",
                  out ? "rounded-se-[4px] border-[#CDEBD9] bg-[#E8F6EE] text-[#111827]" : "rounded-ss-[4px] border-[#E5E7EB] bg-white text-[#111827]",
                  failed ? "!border-[#FECACA] !bg-[#FEF2F2]" : "",
                  isNew ? "ring-2 ring-[#BBF7D0]" : "",
                ].join(" ")}
              >
                {m.kind === "template" && (
                  <span className="mb-[5px] flex items-center gap-1.5 text-[11.5px] font-bold text-[#14532D]">
                    {auto ? <Zap size={13} aria-hidden="true" /> : <FileText size={13} aria-hidden="true" />}
                    {auto ? `${t("thread.auto")}${eventLabel ? ` · ${eventLabel}` : ""}` : t("thread.template")}
                  </span>
                )}
                {hasImage &&
                  (m.media_link ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a customer-facing product image hosted elsewhere
                    <img src={m.media_link} alt={t("thread.image")} loading="lazy" className="mb-[7px] block aspect-[4/3] w-full rounded-[9px] bg-[#F3F4F6] object-cover" />
                  ) : (
                    <span className="mb-1.5 flex items-center gap-1.5 rounded-[9px] bg-[#F3F4F6] px-2 py-1.5 text-[12px] text-[#6B7280]">
                      <ImageIcon size={13} aria-hidden="true" />
                      {t("thread.image")}
                    </span>
                  ))}
                {m.kind === "unsupported" ? <span className="italic text-[#6B7280]">{t("thread.unsupported")}</span> : text}
              </div>
              <span className={`flex items-center gap-1.5 px-1 text-[11.5px] text-[#6B7280] ${out ? "justify-end" : ""}`}>
                {out && !auto && m.sent_by_name && (
                  <>
                    <span className="font-semibold text-[#374151]">{m.sent_by_name}</span>
                    <span aria-hidden="true">·</span>
                  </>
                )}
                <span className="tabular-nums [direction:ltr] [unicode-bidi:isolate]">{time.format(new Date(m.created_at))}</span>
                {out && <StatusGlyph status={m.status} code={m.error_code} />}
              </span>
              {failed && onRetry && (
                <button type="button" onClick={() => onRetry(m)} className="inline-flex h-7 items-center gap-1.5 self-end rounded-[7px] border border-[#FECACA] bg-white px-2 text-[12px] font-bold text-[#B91C1C]">
                  <RotateCcw size={12} aria-hidden="true" />
                  {t("thread.retry")}
                </button>
              )}
            </div>
          </div>
        );
      })}
      {conversation?.opted_out_at && (
        <span role="status" className="my-1 inline-flex items-center gap-[7px] self-center rounded-full border border-[#FCD34D] bg-[#FFFBEB] px-3 py-[5px] text-[12px] text-[#B45309] [unicode-bidi:plaintext]">
          <Ban size={13} aria-hidden="true" />
          {t("thread.optedOut", {
            date: `${shortDate.format(new Date(conversation.opted_out_at))} ${time.format(new Date(conversation.opted_out_at))}`,
          })}
        </span>
      )}
      <span ref={endRef} aria-hidden="true" />
    </div>
  );
}
