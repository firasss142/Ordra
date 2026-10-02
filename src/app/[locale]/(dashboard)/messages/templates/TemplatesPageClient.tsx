"use client";

import { useTranslations } from "next-intl";
import { TemplatesTable } from "@/components/whatsapp/TemplatesTable";
import { useMarketScope } from "@/context/market-scope";
import type { AuthUser } from "@/types";
import { MessagesHeader } from "../MessagesHeader";

interface Market {
  id: string;
  name: string;
  code: string;
}

/**
 * Clients › Messages › Modèles. A super_admin maps, resubmits and deletes;
 * a market_manager reads (prototype `modeles`, role=manager). Opens on the
 * market chosen in the sidebar for a super_admin.
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
  const t = useTranslations("whatsappAdmin.templates");
  const isRtl = user.direction === "rtl";
  const isSuperAdmin = user.role === "super_admin";
  const { marketId: scopeMarketId } = useMarketScope();
  const startMarket = isSuperAdmin && scopeMarketId && markets.some((m) => m.id === scopeMarketId) ? scopeMarketId : initialMarketId;

  return (
    <div dir={isRtl ? "rtl" : "ltr"} className="min-h-screen bg-surface-page p-4 sm:p-6">
      <TemplatesTable
        markets={markets}
        initialMarketId={startMarket}
        readOnly={!isSuperAdmin}
        canDelete={isSuperAdmin}
        connectionsHref={isSuperAdmin ? `/${locale}/system/settings/whatsapp` : null}
        renderHeader={(actions) => <MessagesHeader active="templates" locale={locale} title={t("title")} sub={t("sub")} actions={actions} />}
      />
    </div>
  );
}
