"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { User } from "lucide-react";
import type { WorklistRow } from "@/lib/delivery/types";
import type { QueuedBody } from "@/hooks/useDeliveryActionQueue";
import { useWhatsAppThread } from "@/hooks/useWhatsAppThread";
import { useWhatsAppTemplates } from "@/hooks/useWhatsAppTemplates";
import { resolveOrderVariables } from "@/lib/whatsapp/render";
import { suggestCatalogueKey } from "@/lib/whatsapp/compose";
import { WhatsAppComposer } from "@/components/whatsapp/WhatsAppComposer";
import { SheetFrame } from "./Sheets";
import { Ltr } from "./ui";

/**
 * The /delivery WhatsApp sheet once the market's business number is live.
 * Prototype whatsapp-agent-v1.html `waSheet()`: the customer card, the
 * language toggle, « Choisir le modèle », « Texte du message », and a send
 * button that really sends. The server records the delivery action itself,
 * so the queued body carries `alreadyRecorded` and the ledger is written
 * once; the sheet then stays on « Envoyé » with the live status and
 * « Fermer ».
 */
export function WhatsAppLiveSheet({ row, market, marketId, onClose, onSent }: {
  row: WorklistRow;
  market: "ly" | "tn";
  marketId: string;
  onClose: () => void;
  onSent: (body: QueuedBody) => void;
}) {
  const t = useTranslations("delivery");
  const { thread, mutate, error } = useWhatsAppThread({ order_id: row.order_id, market_id: marketId });
  const { templates } = useWhatsAppTemplates(marketId);

  const variables = useMemo(
    () =>
      resolveOrderVariables({
        order_number: row.external_id,
        customer_name: row.customer_name,
        customer_address: [row.customer_address, row.customer_city].filter(Boolean).join("، "),
        customer_city: row.customer_city,
        total_price: row.total_price,
        currency: market === "ly" ? "LYD" : "TND",
        tracking_number: row.tracking_number,
        carrier_name: row.carrier_name,
        courier_name: row.handler_name,
        agent_name: row.agent_name,
      }),
    [row, market],
  );

  return (
    <SheetFrame title={t("wa.title")} onClose={onClose} closeBoxed>
      <div data-testid="wa-sheet-who" className="mb-1.5 flex items-center gap-2.5 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[#E5E7EB] bg-[#F3F4F6] text-[#9CA3AF]">
          <User size={18} aria-hidden="true" />
        </span>
        <b className="min-w-0 truncate text-[15px] text-[#111827] [unicode-bidi:plaintext]">{row.customer_name ?? "—"}</b>
        <Ltr className="ms-auto shrink-0 text-[14px] tabular-nums text-[#374151]">{row.customer_phone ?? ""}</Ltr>
      </div>

      <WhatsAppComposer
        variant="sheet"
        className="mt-3"
        target={{ order_id: row.order_id }}
        thread={thread}
        loadError={Boolean(error)}
        templates={templates}
        variables={variables}
        defaultLanguage={market === "ly" ? "ar" : "fr"}
        templateSet="agent"
        defaultCatalogueKey={suggestCatalogueKey(row)}
        logDeliveryAction
        onThreadChanged={() => void mutate()}
        onClose={onClose}
        onSent={(message) => {
          onSent({
            action_type: "whatsapp_customer",
            outcome: "sent",
            note: null,
            next_action_at: null,
            template_key: templates.find((x) => x.id === message.template_id)?.catalogue_key ?? null,
            alreadyRecorded: true,
          });
        }}
        onCall={() => {
          if (row.customer_phone) window.location.href = `tel:${row.customer_phone}`;
        }}
      />
    </SheetFrame>
  );
}
