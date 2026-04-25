"use client";

import { useState } from "react";
import useSWR from "swr";
import { CarriersSection } from "@/components/settings/CarriersSection";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import type { AuthUser } from "@/types";

interface Market {
  id: string;
  name: string;
  code: string;
}

interface Props {
  user: AuthUser;
  initialMarkets: Market[];
  initialMarketId: string;
}

export function CarriersClient({
  user,
  initialMarkets,
  initialMarketId,
}: Props) {
  const isRtl = user.direction === "rtl";
  const [selectedMarketId, setSelectedMarketId] =
    useState<string>(initialMarketId);

  const { data: marketsData } = useSWR<{ data: Market[] }>(
    user.role === "super_admin" ? "/api/markets" : null,
    { fallbackData: { data: initialMarkets } },
  );
  const markets = marketsData?.data ?? initialMarkets;

  const marketId = selectedMarketId || user.market_id || "";

  return (
    <div
      style={{
        padding: 24,
        backgroundColor: "#F6F6F7",
        minHeight: "100vh",
        direction: isRtl ? "rtl" : "ltr",
      }}
    >
      <SettingsPageHeader
        title="Transporteurs"
        markets={markets}
        selectedMarketId={selectedMarketId}
        onChange={setSelectedMarketId}
        showMarketSelector={user.role === "super_admin"}
        isRtl={isRtl}
      />

      <CarriersSection key={marketId} role={user.role} marketId={marketId} />
    </div>
  );
}
