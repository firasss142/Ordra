"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { User } from "lucide-react";
import type { ProspectRow } from "@/lib/prospects/types";
import { useWhatsAppThread } from "@/hooks/useWhatsAppThread";
import { useWhatsAppTemplates } from "@/hooks/useWhatsAppTemplates";
import { resolveLeadVariables } from "@/lib/whatsapp/render";
import { WhatsAppComposer } from "@/components/whatsapp/WhatsAppComposer";
import { SheetFrame } from "@/components/delivery/Sheets";
import { formatPhone } from "@/lib/prospects/presentation";

/**
 * The prospect's WhatsApp sheet on the worklist. Prototype
 * whatsapp-agent-v1.html `waSheet()` on screen `prospects`: the prospect
 * card, their latest reply quoted at the top when they answered, then the
 * follow-up template, the campaign's own template (named after the
 * campaign), and free text while the 24 h window is open. Not connected:
 * the banner and today's wa.me link.
 */
export function ProspectWhatsAppSheet({ row, market, marketId, onClose }: {
  row: ProspectRow;
  market: "ly" | "tn";
  marketId: string;
  onClose: () => void;
}) {
  const t = useTranslations("delivery");
  const locale = useLocale();
  const { thread, mutate, error } = useWhatsAppThread({ lead_id: row.id, market_id: marketId });
  const { templates } = useWhatsAppTemplates(marketId);

  const variables = useMemo(
    () =>
      resolveLeadVariables({
        customer_name: row.customer_name,
        customer_city: row.customer_city,
        product_name: row.product_name,
        offer: row.campaign_offer,
        agent_name: row.assigned_name,
      }),
    [row],
  );

  // The prospect's words, when they spoke last: what the agent answers to.
  const messages = thread?.messages ?? [];
  const last = messages.at(-1);
  const reply = last && last.direction === "in" ? last : null;
  const time = new Intl.DateTimeFormat(locale === "ar" ? "ar-LY" : "fr-FR", { hour: "2-digit", minute: "2-digit" });

  return (
    <SheetFrame title={t("wa.title")} onClose={onClose} closeBoxed>
      <div className="mb-1.5 flex items-center gap-2.5 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[#E5E7EB] bg-[#F3F4F6] text-[#9CA3AF]">
          <User size={18} aria-hidden="true" />
        </span>
        <b className="min-w-0 truncate text-[15px] text-[#111827] [unicode-bidi:plaintext]">{row.customer_name}</b>
        <span dir="ltr" className="ms-auto shrink-0 text-[14px] tabular-nums text-[#374151]">{formatPhone(row.customer_phone)}</span>
      </div>

      {reply && (
        <div data-testid="prospect-reply" className="mb-0.5 mt-2 flex max-w-full flex-col gap-1">
          <div dir="auto" className="whitespace-pre-wrap rounded-[14px] rounded-ss-[4px] border border-[#E5E7EB] bg-white px-3 pb-2 pt-[9px] text-[14.5px] leading-[1.55] text-[#111827] [unicode-bidi:plaintext]">
            {reply.body ?? reply.media_caption ?? ""}
          </div>
          <span className="px-1 text-[11.5px] tabular-nums text-[#6B7280]">{time.format(new Date(reply.created_at))}</span>
        </div>
      )}

      <WhatsAppComposer
        variant="sheet"
        className="mt-3"
        target={{ lead_id: row.id }}
        thread={thread}
        loadError={Boolean(error)}
        templates={templates}
        variables={variables}
        defaultLanguage={market === "ly" ? "ar" : "fr"}
        templateSet="prospect"
        campaignId={row.campaign_id}
        campaignLabel={row.campaign_name}
        fallbackHref={thread?.phone_e164 ? `https://wa.me/${thread.phone_e164}` : null}
        onThreadChanged={() => void mutate()}
        onClose={onClose}
        onCall={() => {
          window.location.href = `tel:${row.customer_phone}`;
        }}
      />
    </SheetFrame>
  );
}
