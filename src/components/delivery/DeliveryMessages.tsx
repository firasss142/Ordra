"use client";

import { useTranslations } from "next-intl";
import { useWhatsAppThread } from "@/hooks/useWhatsAppThread";
import { MessageThread } from "@/components/whatsapp/MessageThread";
import { WhatsAppGlyph } from "@/components/whatsapp/WhatsAppGlyph";

/**
 * « Messages » under the parcel's timeline on /delivery: what was said on
 * WhatsApp, read-only — sending stays in the sheet. Shown once the market's
 * connection is known; a market that is not connected says so in one line
 * (owner decision 2026-09-25: shown disabled, not hidden).
 */
export function DeliveryMessages({ orderId, marketId, onOpenSheet }: { orderId: string; marketId: string; onOpenSheet: () => void }) {
  const t = useTranslations("whatsapp");
  const { thread } = useWhatsAppThread({ order_id: orderId, market_id: marketId });
  const messages = thread?.messages ?? [];
  return (
    <section className="mt-2.5 overflow-hidden rounded-xl border border-[#E5E7EB] bg-white" aria-label={t("tabMessages")}>
      <div className="flex items-center gap-2 border-b border-[#F3F4F6] px-4 py-2.5">
        <WhatsAppGlyph size={15} className="text-[#15803D]" />
        <span className="text-[14px] font-semibold text-[#111827]">{t("tabMessages")}</span>
        {(thread?.conversation?.unread_count ?? 0) > 0 && (
          <b className="grid h-5 min-w-[20px] place-items-center rounded-full bg-[#15803D] px-1.5 text-[11.5px] text-white">{thread!.conversation!.unread_count}</b>
        )}
        <span className="flex-1" />
        <button type="button" onClick={onOpenSheet} className="text-[12.5px] font-semibold text-[#15803D] hover:underline">
          {t("button")}
        </button>
      </div>
      {thread && !thread.config_active && messages.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-[#6B7280]">{t("composer.noConfig")}</p>
      ) : (
        <div className="max-h-[260px] overflow-y-auto bg-[#F9FAFB]">
          <MessageThread messages={messages.slice(-8)} conversation={thread?.conversation ?? null} highlightUnread={false} />
        </div>
      )}
    </section>
  );
}
