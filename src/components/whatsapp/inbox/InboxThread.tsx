"use client";

import { useEffect, useMemo, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Ban, Clock, Image as ImageIcon, User } from "lucide-react";
import type { ThreadPayload } from "@/lib/whatsapp/thread";
import type { TemplateRow } from "@/components/whatsapp/TemplatesTable";
import { windowUntil } from "@/lib/whatsapp/compose";
import { StatusGlyph } from "../StatusGlyph";
import { InboxComposer } from "./InboxComposer";
import { formatPhone } from "./inbox-utils";

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function daysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * The middle column (prototype `inbox()`, `C`): who, the 24 h window, the
 * bubbles — the customer in white, an agent in green signed with their name,
 * an automatic message dashed — then the reply box while the window is open,
 * or the « Envoyer un modèle » bar once it has closed.
 */
export function InboxThread({
  conversationId,
  fallbackName,
  fallbackPhone,
  thread,
  templates,
  marketCode,
  onThreadChanged,
}: {
  conversationId: string;
  fallbackName: string | null;
  fallbackPhone: string;
  thread: ThreadPayload | null;
  templates: TemplateRow[];
  marketCode: "ly" | "tn";
  onThreadChanged: () => void;
}) {
  const t = useTranslations("whatsappAdmin.inbox");
  const tw = useTranslations("whatsapp");
  const locale = useLocale();
  const intlLocale = locale === "ar" ? "ar-LY" : "fr-FR";
  const conv = thread?.conversation ?? null;
  const name = conv?.profile_name?.trim() || fallbackName;
  const phone = formatPhone(conv?.phone_e164 ?? fallbackPhone);
  const messages = useMemo(() => thread?.messages ?? [], [thread]);

  const time = useMemo(() => new Intl.DateTimeFormat(intlLocale, { hour: "2-digit", minute: "2-digit" }), [intlLocale]);
  const longDay = useMemo(() => new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "long" }), [intlLocale]);
  const dayLabel = (iso: string) => {
    const n = daysBetween(new Date(iso), new Date());
    if (n <= 0) return tw("thread.today");
    if (n === 1) return tw("thread.yesterday");
    return longDay.format(new Date(iso));
  };

  const endRef = useRef<HTMLSpanElement | null>(null);
  const lastId = messages.at(-1)?.id ?? null;
  useEffect(() => {
    const el = endRef.current;
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "end" });
  }, [lastId, conversationId]);

  const until = thread?.window_open ? windowUntil(thread.window_closes_at, new Date(), locale) : null;
  const wnd = thread ? (
    thread.window_open ? (
      <span className="tag good wnd">
        <Clock className="ic" strokeWidth={2} aria-hidden />
        {until?.tomorrow ? t("wOpenTomorrow", { time: until.time }) : t("wOpen", { time: until?.time ?? "" })}
      </span>
    ) : (
      <span className="tag wnd">
        <Clock className="ic" strokeWidth={2} aria-hidden />
        {t("wClosed")}
      </span>
    )
  ) : null;

  let lastDay = "";
  return (
    <section className="card col" data-testid="inbox-thread">
      <div className="chead">
        <span className="cav">{name ? name[0].toUpperCase() : <User className="ic" strokeWidth={1.9} aria-hidden />}</span>
        <div style={{ minWidth: 0 }}>
          <h2 dir="auto">{name ?? "—"}</h2>
          <div className="s num">{phone}</div>
        </div>
        {wnd}
      </div>
      <div className="thread">
        {thread && messages.length === 0 && <span className="day">{tw("thread.empty")}</span>}
        {messages.map((m) => {
          const d = dayKey(new Date(m.created_at));
          const sep = d !== lastDay;
          lastDay = d;
          const out = m.direction === "out";
          const auto = out && (m.actor_type === "system" || m.actor_type === "campaign");
          const failed = m.status === "failed";
          const hasImage = m.kind === "image" || (m.kind === "template" && Boolean(m.media_link));
          const text = m.body ?? m.media_caption ?? "";
          const cls = `bub ${!out ? "in" : auto ? "auto" : "out"}${failed ? " failed" : ""}`;
          const by = auto ? t("autoBy") : out ? m.sent_by_name : null;
          return (
            <div key={m.id} style={{ display: "contents" }}>
              {sep && <span className="day">{dayLabel(m.created_at)}</span>}
              <div className={cls} data-dir={m.direction}>
                {by && <div className="by">{by}</div>}
                {hasImage &&
                  (m.media_link ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a product image hosted elsewhere
                    <img src={m.media_link} alt={tw("thread.image")} loading="lazy" />
                  ) : (
                    <p className="unsup">
                      <ImageIcon className="ic" strokeWidth={1.9} aria-hidden /> {tw("thread.image")}
                    </p>
                  ))}
                {m.kind === "unsupported" ? <p className="unsup">{tw("thread.unsupported")}</p> : text ? <p dir="auto">{text}</p> : null}
                <small>
                  <time className="num">{time.format(new Date(m.created_at))}</time>
                  {out && <StatusGlyph status={m.status} code={m.error_code} />}
                </small>
              </div>
            </div>
          );
        })}
        {conv?.opted_out_at && (
          <span role="status" className="day warn">
            <Ban className="ic" strokeWidth={2} aria-hidden style={{ width: 12, height: 12, verticalAlign: -2, marginInlineEnd: 5 }} />
            {tw("thread.optedOut", { date: `${longDay.format(new Date(conv.opted_out_at))} ${time.format(new Date(conv.opted_out_at))}` })}
          </span>
        )}
        <span ref={endRef} aria-hidden />
      </div>
      <InboxComposer key={conversationId} conversationId={conversationId} thread={thread} templates={templates} marketCode={marketCode} onThreadChanged={onThreadChanged} />
    </section>
  );
}
