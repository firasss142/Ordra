"use client";

import { StorefrontsSection } from "@/components/settings/StorefrontsSection";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { useMarketScope } from "@/context/market-scope";
import type { AuthUser } from "@/types";

interface Props {
  user: AuthUser;
}

export function StorefrontsClient({ user }: Props) {
  const isRtl = user.direction === "rtl";
  const { marketId: scopeMarketId } = useMarketScope();
  const marketId = scopeMarketId ?? user.market_id ?? "";

  return (
    <div
      style={{
        padding: 24,
        backgroundColor: "#F6F6F7",
        minHeight: "100vh",
        direction: isRtl ? "rtl" : "ltr",
      }}
    >
      <SettingsPageHeader title="Storefronts" isRtl={isRtl} />

      <StorefrontsSection
        key={marketId}
        role={user.role}
        marketId={marketId}
      />
    </div>
  );
}
