"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { MessagesShell } from "@/components/whatsapp/inbox/MessagesShell";
import { DormantCard } from "@/components/whatsapp/inbox/DormantCard";
import { MessagesInbox } from "@/components/whatsapp/inbox/MessagesInbox";
import { useOrphanConversations } from "@/hooks/useOrphanConversations";
import { useWhatsAppAvailability } from "@/hooks/useWhatsAppAvailability";
import { useMarketScope } from "@/context/market-scope";
import { marketIdToCode } from "@/lib/markets";
import type { AuthUser } from "@/types";

/**
 * Clients › Messages in Aurore calme (prototypes/voix-du-client-et-messages-v2.html,
 * page=messages). Not connected — the state of every market today — the
 * dormant card says what the page will do and how to connect; connected, the
 * three-column inbox. Modèles stays one click away in the header either way.
 */
export function MessagesPageClient({ user, locale }: { user: AuthUser; locale: string }) {
  const t = useTranslations("whatsappAdmin.inbox");
  const isRtl = user.direction === "rtl";
  const scope = useMarketScope();
  const isSuperAdmin = user.role === "super_admin";
  const marketId = isSuperAdmin ? scope.marketId : user.market_id;
  const marketCode = marketIdToCode(marketId) ?? "tn";
  const { availability } = useWhatsAppAvailability(marketId);
  const connected = availability?.connected === true;
  const { conversations, counts, isLoading, mutate } = useOrphanConversations(marketId && availability?.connected !== false ? marketId : null, "all");
  const onChanged = useCallback(() => void mutate(), [mutate]);

  return (
    <MessagesShell active="conversations" locale={locale} isRtl={isRtl} count={connected ? (counts?.orphans ?? null) : null}>
      {!marketId ? (
        <section className="card">
          <p className="empty">{t("pickMarket")}</p>
        </section>
      ) : availability?.connected === false ? (
        <DormantCard locale={locale} canConnect={isSuperAdmin} />
      ) : connected ? (
        <MessagesInbox
          marketId={marketId}
          marketCode={marketCode}
          locale={locale}
          isSuperAdmin={isSuperAdmin}
          conversations={conversations}
          counts={counts}
          isLoading={isLoading}
          onChanged={onChanged}
        />
      ) : null}
    </MessagesShell>
  );
}
