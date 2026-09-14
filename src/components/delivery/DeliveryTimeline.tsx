"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Clock, FileText, MessageCircle, NotebookPen, Phone, Truck } from "lucide-react";
import { useDeliveryTimeline } from "@/hooks/useDeliveryTimeline";
import type { TimelineEntry } from "@/lib/delivery/types";
import { useWhen, type IconComponent } from "./ui";

type Filter = "all" | "mine" | "carrier";

const glyph = (e: TimelineEntry): IconComponent => {
  if (e.source === "order") return FileText;
  if (e.source === "carrier" || e.source === "remark") return Truck;
  if (e.kind === "whatsapp_customer") return MessageCircle;
  if (e.kind === "note") return NotebookPen;
  return Phone;
};

/**
 * Journal d'activité: order moves, Darb events, the courier conversation and
 * what people recorded, newest first, with three filters.
 */
export function DeliveryTimeline({
  orderId, locale, tz, now, compact = false,
}: { orderId: string; locale: string; tz: string; now: number; compact?: boolean }) {
  const t = useTranslations("delivery");
  const tStatus = useTranslations("orders.statuses");
  const when = useWhen(now, tz, locale);
  const [filter, setFilter] = useState<Filter>("all");
  const { timeline, isLoading } = useDeliveryTimeline(orderId, locale === "ar" ? "ar" : "fr");

  const shown = timeline.filter((e) =>
    filter === "mine" ? e.source === "action" && e.mine : filter === "carrier" ? e.source === "carrier" || e.source === "remark" : true,
  );
  const items = compact ? shown.slice(0, 5) : shown;

  const actor = (e: TimelineEntry) =>
    e.source === "order" ? t("timeline.system") : e.source === "action" ? (e.mine ? t("timeline.you") : e.actor ?? t("timeline.system")) : e.actor;
  const title = (e: TimelineEntry) => {
    if (e.source === "order") return tStatus.has(e.kind) ? tStatus(e.kind) : e.kind;
    if (e.source === "remark") return `${e.actor ?? t("timeline.courier_message")} (${t("detail.carrier")})`;
    if (e.source === "carrier") return e.text ?? e.kind;
    const type = t.has(`sheet.types.${e.kind}`) ? t(`sheet.types.${e.kind}`) : t.has(`timeline.${e.kind}`) ? t(`timeline.${e.kind}`) : e.kind;
    const outcome = e.outcome && t.has(`sheet.outcomes.${e.outcome}`) ? t(`sheet.outcomes.${e.outcome}`) : "";
    return outcome ? `${type} · ${outcome}` : type;
  };
  const detail = (e: TimelineEntry) => {
    if (e.source === "carrier") return e.actor ?? null;
    if (e.source === "remark") return e.text ? `« ${e.text} »` : null;
    if (e.source === "action") return e.text ?? actor(e);
    return e.text;
  };

  return (
    <section className={compact ? "" : "mt-2.5 rounded-xl border border-[#E5E7EB] bg-white px-4 py-3.5"}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className={`me-auto flex items-center gap-2 font-semibold text-[#111827] ${compact ? "text-[15px]" : "text-[15px]"}`}>
          <Clock size={18} aria-hidden />{t("detail.history")}
        </h3>
        {!compact && (
          <div className="inline-flex gap-1.5" role="group" aria-label={t("detail.history")}>
            {(["all", "mine", "carrier"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={`h-[30px] rounded-lg border px-3 text-[12.5px] font-semibold ${filter === f ? "border-[#86EFAC] bg-[#DCFCE7] text-[#15803D]" : "border-[#E5E7EB] bg-white text-[#374151]"}`}
              >
                {t(`tl.${f}`)}
              </button>
            ))}
          </div>
        )}
      </div>
      {isLoading ? (
        <div className="mt-3 space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="h-9 animate-pulse rounded-md bg-[#F3F4F6]" />)}
        </div>
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm text-[#6B7280]">{t("detail.noEvents")}</p>
      ) : (
        <ol className="mt-2">
          {items.map((e, i) => {
            const Glyph = glyph(e);
            return (
              <li key={`${e.source}-${e.id}`} className="relative grid grid-cols-[12px_46px_20px_minmax(0,1fr)] items-start gap-x-2.5 py-1.5">
                {i < items.length - 1 && <span aria-hidden className="absolute bottom-[-6px] start-[5px] top-[18px] w-px bg-[#E5E7EB]" />}
                <i aria-hidden className={`mt-[7px] h-[9px] w-[9px] justify-self-center rounded-full ${e.source === "action" && e.mine ? "bg-[#15803D]" : "bg-[#D1D5DB]"}`} />
                <span className="pt-0.5 text-[13px] tabular-nums text-[#6B7280]">{when(e.at, true)}</span>
                <Glyph size={16} aria-hidden className="mt-0.5 text-[#6B7280]" />
                <span className="min-w-0">
                  <b className="block truncate text-[13.5px] font-semibold text-[#111827] [unicode-bidi:plaintext]">{title(e)}</b>
                  {detail(e) && <span className="block truncate text-[12.5px] text-[#6B7280] [unicode-bidi:plaintext]">{detail(e)}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
