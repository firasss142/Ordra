"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import { useDeliveryTimeline } from "@/hooks/useDeliveryTimeline";
import type { TimelineEntry } from "@/lib/delivery/types";
import { useWhen } from "./ui";

type Filter = "all" | "mine" | "carrier";

/**
 * Historique: order moves, Darb events, the courier conversation and what
 * people recorded, newest first, with the prototype's three filters.
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

  const title = (e: TimelineEntry) => {
    if (e.source === "order") return tStatus.has(e.kind) ? tStatus(e.kind) : e.kind;
    if (e.source === "remark") return t("timeline.courier_message");
    if (e.source === "carrier") return e.text ?? e.kind;
    const type = t.has(`sheet.types.${e.kind}`) ? t(`sheet.types.${e.kind}`) : t.has(`timeline.${e.kind}`) ? t(`timeline.${e.kind}`) : e.kind;
    const outcome = e.outcome && t.has(`sheet.outcomes.${e.outcome}`) ? t(`sheet.outcomes.${e.outcome}`) : "";
    return outcome ? `${type} · ${outcome}` : type;
  };
  const detail = (e: TimelineEntry) => (e.source === "carrier" ? null : e.text);
  const actor = (e: TimelineEntry) =>
    e.source === "order" ? t("timeline.system") : e.source === "action" ? (e.mine ? t("timeline.you") : e.actor ?? t("timeline.system")) : e.actor;

  return (
    <section className={compact ? "" : "mt-4"}>
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 className={`me-auto flex items-center gap-2 font-semibold text-[#111827] ${compact ? "text-[15px]" : "text-[17px]"}`}>
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
                className={`h-8 rounded-lg border px-3 text-[13.5px] ${filter === f ? "border-[#93B4F5] bg-[#EFF5FF] font-semibold text-[#2563EB]" : "border-[#E5E7EB] bg-white text-[#374151]"}`}
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
        <ol className="mt-2.5">
          {items.map((e, i) => (
            <li key={`${e.source}-${e.id}`} className="relative grid grid-cols-[14px_minmax(0,1fr)_auto] gap-2.5 py-2 sm:grid-cols-[14px_64px_minmax(0,1fr)_auto]">
              {i < items.length - 1 && <span aria-hidden className="absolute bottom-[-8px] start-[6px] top-[22px] w-px bg-[#E5E7EB]" />}
              <i aria-hidden className={`mt-1.5 h-[9px] w-[9px] justify-self-center rounded-full ${e.source === "action" && e.mine ? "bg-[#F59E0B]" : e.source === "order" ? "bg-[#D1D5DB]" : "bg-[#9CA3AF]"}`} />
              <span className="hidden pt-px text-sm tabular-nums text-[#6B7280] sm:block">{when(e.at, true)}</span>
              <span className="min-w-0">
                <b className="block text-[14.5px] font-medium text-[#111827] [unicode-bidi:plaintext]">{title(e)}</b>
                {detail(e) && <span className="block text-[13.5px] text-[#6B7280] [unicode-bidi:plaintext]">{detail(e)}</span>}
                <span className="block text-[13px] text-[#6B7280] sm:hidden">{when(e.at)}</span>
              </span>
              <span className="whitespace-nowrap pt-px text-[13.5px] text-[#6B7280]">{actor(e)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
