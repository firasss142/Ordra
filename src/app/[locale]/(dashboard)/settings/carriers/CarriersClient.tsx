"use client";

import { CarriersSection } from "@/components/settings/CarriersSection";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { useMarketScope } from "@/context/market-scope";
import type { AuthUser } from "@/types";

interface Props {
  user: AuthUser;
}

export function CarriersClient({ user }: Props) {
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
      <SettingsPageHeader title="Transporteurs" isRtl={isRtl} />

      <CarriersSection key={marketId} role={user.role} marketId={marketId} />
    </div>
  );
}
