"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { ConnectionsTabs, type ConnTab } from "@/components/connections/ConnectionsTabs";
import { StorefrontsPanel } from "@/components/connections/StorefrontsPanel";
import { CarriersPanel } from "@/components/connections/CarriersPanel";
import { useMarketScope } from "@/context/market-scope";
import { marketIdToCode } from "@/lib/markets";
import type { AuthUser } from "@/types";

interface Props {
  user: AuthUser;
  readOnly?: boolean;
}

const TABS: ConnTab[] = [
  { key: "overview", label: "Vue d'ensemble" },
  { key: "storefronts", label: "Storefronts" },
  { key: "carriers", label: "Transporteurs" },
  { key: "services", label: "Services tiers" },
  { key: "mappings", label: "Correspondances" },
];

export function ConnectionsClient({ user, readOnly = false }: Props) {
  const isRtl = user.direction === "rtl";
  const { marketId: scopeMarketId } = useMarketScope();
  const marketId = scopeMarketId ?? user.market_id ?? "";
  const tMarkets = useTranslations("nav.markets");
  const code = marketIdToCode(marketId);
  const marketName = code ? tMarkets(code) : "";
  const currency = code === "ly" ? "LYD" : "TND";

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

      {tab !== "storefronts" && tab !== "carriers" && (
        <div className="rounded-card border border-line-subtle bg-surface-card p-10 text-center text-[13.5px] text-ink-secondary">
          <b className="block text-ink-primary">
            {TABS.find((t) => t.key === tab)?.label}
          </b>
          <span>Cet onglet arrive dans la suite du chantier Connexions.</span>
        </div>
      )}
    </div>
  );
}
