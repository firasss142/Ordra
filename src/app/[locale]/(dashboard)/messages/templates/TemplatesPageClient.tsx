"use client";

import { TemplatesTable } from "@/components/whatsapp/TemplatesTable";
import { MessagesShell } from "@/components/whatsapp/inbox/MessagesShell";
import { useMarketScope } from "@/context/market-scope";
import { useOrphanConversations } from "@/hooks/useOrphanConversations";
import { useWhatsAppAvailability } from "@/hooks/useWhatsAppAvailability";
import type { AuthUser } from "@/types";

interface Market {
  id: string;
  name: string;
  code: string;
}

/**
 * Clients › Messages › Modèles, in the Messages header with the Modèles tab
 * active (prototype `templates()`). A super_admin maps, resubmits and deletes
 * in every market; a market_manager reads. Opens on the market chosen in the
 * sidebar for a super_admin.
 */
export function TemplatesPageClient({
  user,
  markets,
  initialMarketId,
  locale,
}: {
  user: AuthUser;
  markets: Market[];
  initialMarketId: string;
  locale: string;
}) {
  const isRtl = user.direction === "rtl";
  const isSuperAdmin = user.role === "super_admin";
  const { marketId: scopeMarketId } = useMarketScope();
  const startMarket = isSuperAdmin && scopeMarketId && markets.some((m) => m.id === scopeMarketId) ? scopeMarketId : initialMarketId;
  const { availability } = useWhatsAppAvailability(startMarket);
  const connected = availability?.connected === true;
  const { counts } = useOrphanConversations(connected ? startMarket : null, "orphans");

  return (
    <MessagesShell active="templates" locale={locale} isRtl={isRtl} count={connected ? (counts?.orphans ?? null) : null}>
      <TemplatesTable
        markets={markets}
        initialMarketId={startMarket}
        readOnly={!isSuperAdmin}
        canDelete={isSuperAdmin}
        connectionsHref={isSuperAdmin ? `/${locale}/system/settings/whatsapp` : null}
      />
    </MessagesShell>
  );
}
