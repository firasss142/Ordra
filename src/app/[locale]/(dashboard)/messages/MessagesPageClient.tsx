"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Info } from "lucide-react";
import { ConversationsList } from "@/components/whatsapp/ConversationsList";
import { ConversationDrawer } from "@/components/whatsapp/ConversationDrawer";
import { useOrphanConversations } from "@/hooks/useOrphanConversations";
import { useWhatsAppAvailability } from "@/hooks/useWhatsAppAvailability";
import { useMarketScope } from "@/context/market-scope";
import { marketIdToCode } from "@/lib/markets";
import type { AuthUser } from "@/types";
import { MessagesHeader } from "./MessagesHeader";

/**
 * Clients › Messages — WhatsApp conversations nothing has claimed
 * (prototype `messages`). A manager answers, then attaches the thread to the
 * order or the prospect it belongs to; the owning agent takes over from
 * there. A market that is not connected still gets the page, with the
 * reason — and Modèles stays one click away in the header.
 */
export function MessagesPageClient({ user, locale }: { user: AuthUser; locale: string }) {
  const t = useTranslations("whatsappAdmin.inbox");
  const tCommon = useTranslations("whatsappAdmin.common");
  const isRtl = user.direction === "rtl";
  const router = useRouter();
  const scope = useMarketScope();
  const isSuperAdmin = user.role === "super_admin";
  const marketId = isSuperAdmin ? scope.marketId : user.market_id;
  const marketCode = marketIdToCode(marketId) ?? "tn";
  const [listScope, setListScope] = useState<"orphans" | "all">("orphans");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { conversations, counts, isLoading, mutate } = useOrphanConversations(marketId, listScope);
  const { availability } = useWhatsAppAvailability(marketId);

  return (
    <div dir={isRtl ? "rtl" : "ltr"} className="min-h-screen bg-surface-page p-4 sm:p-6">
      <MessagesHeader active="conversations" locale={locale} title={t("title")} sub={t("sub")} />
      {!marketId ? (
        <p className="m-0 rounded-[8px] border border-line-subtle bg-surface-card px-4 py-10 text-center text-[13.5px] text-ink-secondary">{t("pickMarket")}</p>
      ) : (
        <>
          {availability?.connected === false && (
            <div role="status" className="mb-3.5 flex items-start gap-2.5 rounded-[8px] border border-[#C9DBF5] bg-prod-info-bg px-3 py-2.5 text-[13px] leading-[1.45] text-[#1F4F94]">
              <Info size={16} className="mt-px flex-none" aria-hidden />
              <div>
                {t("notConnected")}
                {isSuperAdmin && (
                  <>
                    {" "}
                    <Link href={`/${locale}/system/settings/whatsapp`} className="font-semibold underline underline-offset-2">
                      {tCommon("goToConnections")}
                    </Link>
                  </>
                )}
              </div>
            </div>
          )}
          <div data-testid="messages-grid" className="grid h-[calc(100vh-200px)] min-h-[520px] grid-cols-1 gap-3.5 lg:grid-cols-[minmax(0,1fr)_460px]">
            <ConversationsList
              conversations={conversations}
              selectedId={selectedId}
              onSelect={setSelectedId}
              scope={listScope}
              onScope={setListScope}
              counts={counts}
              isLoading={isLoading}
            />
            {selectedId ? (
              <ConversationDrawer
                key={selectedId}
                conversationId={selectedId}
                marketId={marketId}
                marketCode={marketCode}
                locale={locale}
                onChanged={() => void mutate()}
                onOpenOrder={(id) => router.push(`/${locale}/orders?open=${id}`)}
                onOpenLead={(id) => router.push(`/${locale}/leads/${id}`)}
              />
            ) : (
              <div className="grid place-items-center rounded-[8px] border border-line-subtle bg-surface-card p-10 text-center text-[13.5px] text-ink-secondary">{t("pick")}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
