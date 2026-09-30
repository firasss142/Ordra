"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Link2 } from "lucide-react";
import { fetcher } from "@/lib/swr-config";
import type { ThreadPayload } from "@/lib/whatsapp/thread";
import { useWhatsAppTemplates } from "@/hooks/useWhatsAppTemplates";
import { resolveLeadVariables } from "@/lib/whatsapp/render";
import { MessageThread } from "./MessageThread";
import { WhatsAppComposer } from "./WhatsAppComposer";
import { ClaimSearch, type ClaimTarget } from "./ClaimSearch";

/**
 * One conversation of the inbox — prototype `messages`, the right-hand card:
 * the name at the start of the header and the number at the end, the thread,
 * the reply box (open on free text while the customer's window is open — a
 * manager here is answering someone who just wrote), and « Rattacher à ».
 * Opening it marks the thread read.
 */
export function ConversationDrawer({
  conversationId,
  marketId,
  marketCode,
  onChanged,
  onOpenOrder,
  onOpenLead,
}: {
  conversationId: string;
  marketId: string;
  marketCode: "ly" | "tn";
  /** Unused by the card itself; kept so callers need not change. */
  locale?: string;
  /** Kept for callers; the card has no close button (the list selects). */
  onClose?: () => void;
  onChanged: () => void;
  onOpenOrder?: (orderId: string) => void;
  onOpenLead?: (leadId: string) => void;
}) {
  const t = useTranslations("whatsappAdmin.inbox");
  const { data, mutate } = useSWR<{ data: ThreadPayload }>(`/api/whatsapp/conversations/${conversationId}`, fetcher, { revalidateOnFocus: false });
  const { templates } = useWhatsAppTemplates(marketId);
  const thread = data?.data ?? null;
  const conv = thread?.conversation ?? null;
  const [busy, setBusy] = useState(false);
  const [creatingLead, setCreatingLead] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reading clears the unread count and the owner's bell row.
  const unread = conv?.unread_count ?? 0;
  useEffect(() => {
    if (!conv?.id || unread === 0) return;
    void fetch(`/api/whatsapp/conversations/${conv.id}/read`, { method: "POST" }).then(() => {
      void mutate();
      onChanged();
    });
  }, [conv?.id, unread, mutate, onChanged]);

  const claim = useCallback(
    async (target: ClaimTarget) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/whatsapp/conversations/${conversationId}/claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(target.kind === "order" ? { order_id: target.id } : { lead_id: target.id }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body?.error === "already_anchored" ? t("alreadyAnchored") : (body?.message ?? body?.error ?? t("claimRefused")));
          return;
        }
        void mutate();
        onChanged();
      } finally {
        setBusy(false);
      }
    },
    [conversationId, mutate, onChanged, t],
  );

  const createLead = useCallback(async () => {
    if (!conv) return;
    setCreatingLead(true);
    setError(null);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market_id: marketId, customer_name: conv.profile_name ?? conv.phone_e164, customer_phone: conv.phone_e164, source: "whatsapp" }),
      });
      const body = await res.json().catch(() => ({}));
      const leadId: string | undefined = body?.data?.id ?? body?.id;
      if (!res.ok || !leadId) {
        setError(body?.error ?? t("leadRefused"));
        return;
      }
      await claim({ kind: "lead", id: leadId, title: "", sub: "" });
    } finally {
      setCreatingLead(false);
    }
  }, [conv, marketId, claim, t]);

  const phone = conv ? conv.phone_e164.replace(/^(216|218)/, "+$1 ") : "";
  const title = conv?.profile_name?.trim() || phone || "…";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[8px] border border-line-subtle bg-surface-card" data-testid="conversation-drawer">
      <div data-testid="conversation-header" className="flex items-center gap-2.5 border-b border-line-subtle px-3.5 py-3">
        <h2 className="m-0 min-w-0 truncate text-[14px] font-semibold text-ink-primary [unicode-bidi:plaintext]">{title}</h2>
        {conv && (
          <span dir="ltr" className="ms-auto shrink-0 text-[12.5px] tabular-nums text-ink-secondary">
            {phone}
          </span>
        )}
      </div>
      {conv && (conv.current_order_id || conv.current_lead_id) && (
        <div className="border-b border-line-subtle px-3.5 py-1.5 text-[12px]">
          {conv.current_order_id && (
            <button type="button" onClick={() => onOpenOrder?.(conv.current_order_id!)} className="inline-flex items-center gap-1 text-status-action hover:underline">
              <Link2 size={12} aria-hidden="true" /> {t("anchoredOrder")}
            </button>
          )}
          {conv.current_lead_id && (
            <button type="button" onClick={() => onOpenLead?.(conv.current_lead_id!)} className="inline-flex items-center gap-1 text-status-action hover:underline">
              <Link2 size={12} aria-hidden="true" /> {t("anchoredLead")}
            </button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-sunken">
        <MessageThread messages={thread?.messages ?? []} conversation={conv} />
      </div>

      <WhatsAppComposer
        target={{ conversation_id: conversationId }}
        thread={thread}
        templates={templates}
        variables={resolveLeadVariables({ customer_name: conv?.profile_name ?? null })}
        defaultLanguage={marketCode === "ly" ? "ar" : "fr"}
        templateSet="agent"
        preferFreeText
        placeholder={t("placeholder")}
        onThreadChanged={() => void mutate()}
      />

      {error && (
        <p role="alert" className="m-0 border-t border-line-subtle px-3.5 py-2 text-[12.5px] text-status-critical">
          {error}
        </p>
      )}

      {conv && !conv.current_order_id && !conv.current_lead_id && (
        <ClaimSearch marketId={marketId} onPick={claim} onCreateLead={createLead} busy={busy} creatingLead={creatingLead} />
      )}
    </div>
  );
}
