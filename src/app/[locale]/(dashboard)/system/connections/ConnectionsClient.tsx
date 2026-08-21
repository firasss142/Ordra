"use client";

import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { ConnectionsTabs, type ConnTab } from "@/components/connections/ConnectionsTabs";
import { StorefrontsPanel } from "@/components/connections/StorefrontsPanel";
import { CarriersPanel } from "@/components/connections/CarriersPanel";
import { ServicesPanel } from "@/components/connections/ServicesPanel";
import { OverviewPanel } from "@/components/connections/OverviewPanel";
import { MappingsPageClient } from "@/app/[locale]/(dashboard)/mappings/MappingsPageClient";
import { useMarketScope } from "@/context/market-scope";
import { marketIdToCode } from "@/lib/markets";
import type { AuthUser } from "@/types";

interface Market {
  id: string;
  name: string;
  code: string;
}

interface Props {
  user: AuthUser;
  readOnly?: boolean;
  markets: Market[];
}

const TABS: ConnTab[] = [
  { key: "overview", label: "Vue d'ensemble" },
  { key: "storefronts", label: "Storefronts" },
  { key: "carriers", label: "Transporteurs" },
  { key: "services", label: "Services tiers" },
  { key: "mappings", label: "Correspondances" },
];

export function ConnectionsClient({ user, readOnly = false, markets }: Props) {
  const isRtl = user.direction === "rtl";
  const { marketId: scopeMarketId } = useMarketScope();
  const marketId = scopeMarketId ?? user.market_id ?? "";
  const tMarkets = useTranslations("nav.markets");
  const code = marketIdToCode(marketId);
  const marketName = code ? tMarkets(code) : "";
  const currency = code === "ly" ? "LYD" : "TND";
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "fr";

  const searchParams = useSearchParams();
  const requested = searchParams?.get("tab");
  const [tab, setTab] = useState<string>(
    requested && TABS.some((t) => t.key === requested) ? requested : "storefronts",
  );

  return (
    <div dir={isRtl ? "rtl" : "ltr"} className="min-h-screen bg-surface-page p-4 sm:p-6">
      <SettingsPageHeader
        title="Connexions"
        description="Tout ce à quoi l'OMS parle — storefronts, transporteurs, services et correspondances."
        isRtl={isRtl}
      />

      <ConnectionsTabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === "storefronts" && (
        <StorefrontsPanel role={user.role} marketId={marketId} marketName={marketName} readOnly={readOnly} />
      )}

      {tab === "carriers" && (
        <CarriersPanel role={user.role} marketId={marketId} currency={currency} readOnly={readOnly} />
      )}

      {tab === "services" && (
        <ServicesPanel markets={markets} readOnly={readOnly} />
      )}

      {tab === "mappings" && (
        <MappingsPageClient role={user.role} marketId={user.market_id ?? ""} locale={locale} />
      )}

      {tab === "overview" && (
        <OverviewPanel marketId={marketId} onNavigate={setTab} />
      )}
    </div>
  );
}
