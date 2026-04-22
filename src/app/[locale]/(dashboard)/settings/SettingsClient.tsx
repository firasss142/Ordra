"use client";

import { useState } from "react";
import useSWR from "swr";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { GeneralSettingsForm } from "@/components/settings/GeneralSettingsForm";
import { CarriersSection } from "@/components/settings/CarriersSection";
import { StorefrontsSection } from "@/components/settings/StorefrontsSection";
import { MarketsSection } from "@/components/settings/MarketsSection";
import type { AuthUser } from "@/types";
import type { MarketSettings } from "@/types/settings";

interface Market {
  id: string;
  name: string;
  code: string;
}

interface SettingsClientProps {
  user: AuthUser;
  section: string;
  initialMarkets: Market[];
  initialMarketId: string;
}

export function SettingsClient({
  user,
  section,
  initialMarkets,
  initialMarketId,
}: SettingsClientProps) {
  const isRtl = user.direction === "rtl";

  const [selectedMarketId, setSelectedMarketId] =
    useState<string>(initialMarketId);

  const { data: marketsData } = useSWR<{ data: Market[] }>(
    user.role === "super_admin" ? "/api/markets" : null,
    { fallbackData: { data: initialMarkets } },
  );
  const markets = marketsData?.data ?? initialMarkets;

  const marketId = selectedMarketId || user.market_id || "";
  const { data } = useSWR<{ data: { key: string; value: { value: unknown } }[] }>(
    marketId ? `/api/settings/${marketId}` : null,
  );

  const settingsMap = Object.fromEntries(
    (data?.data ?? []).map((row) => [row.key, row.value?.value ?? row.value]),
  );

  const initialValues: MarketSettings = {
    delivery_fee:
      typeof settingsMap.delivery_fee === "number"
        ? settingsMap.delivery_fee
        : 0,
    return_fee:
      typeof settingsMap.return_fee === "number" ? settingsMap.return_fee : 0,
    packing_cost:
      typeof settingsMap.packing_cost === "number"
        ? settingsMap.packing_cost
        : 0,
    max_call_attempts:
      typeof settingsMap.max_call_attempts === "number"
        ? settingsMap.max_call_attempts
        : 3,
    assignment_algorithm:
      typeof settingsMap.assignment_algorithm === "string"
        ? (settingsMap.assignment_algorithm as MarketSettings["assignment_algorithm"])
        : "manual",
    active_agents_only: settingsMap.active_agents_only === true,
    attempt_retry_times: Array.isArray(settingsMap.attempt_retry_times)
      ? (settingsMap.attempt_retry_times as string[]).filter(
          (v) => typeof v === "string",
        )
      : [],
  };

  return (
    <div
      style={{
        padding: 24,
        backgroundColor: "#F6F6F7",
        minHeight: "100vh",
        direction: isRtl ? "rtl" : "ltr",
      }}
    >
      <h1
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: "#1A1A1A",
          margin: "0 0 24px 0",
        }}
      >
        Paramètres
      </h1>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        <SettingsNav role={user.role} activeSection={section} isRtl={isRtl} />

        <div
          style={{
            flex: 1,
            backgroundColor: "white",
            border: "1px solid #E1E3E5",
            borderRadius: "0.5rem",
            padding: 24,
          }}
        >
          {user.role === "super_admin" && markets.length > 0 && (
            <div
              style={{
                marginBottom: 20,
                paddingBottom: 16,
                borderBottom: "1px solid #E1E3E5",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <label
                htmlFor="settings-market-selector"
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "#374151",
                }}
              >
                Marché
              </label>
              <select
                id="settings-market-selector"
                value={selectedMarketId}
                onChange={(e) => setSelectedMarketId(e.target.value)}
                style={{
                  height: 32,
                  padding: "0 8px",
                  fontSize: 13,
                  border: "1px solid #E1E3E5",
                  borderRadius: "0.5rem",
                  background: "white",
                  cursor: "pointer",
                }}
              >
                {markets.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {section === "general" &&
            (data ? (
              <GeneralSettingsForm
                key={`${marketId}:${data?.data?.length ?? 0}`}
                initialValues={initialValues}
                onSubmit={() => {}}
                marketId={marketId}
                role={user.role}
              />
            ) : (
              <div style={{ fontSize: 13, color: "#6D7175" }}>Chargement…</div>
            ))}
          {section === "carriers" && (
            <CarriersSection
              key={marketId}
              role={user.role}
              marketId={marketId}
            />
          )}
          {section === "storefronts" && (
            <StorefrontsSection
              key={marketId}
              role={user.role}
              marketId={marketId}
            />
          )}
          {section === "markets" && user.role === "super_admin" && (
            <MarketsSection role={user.role} />
          )}
        </div>
      </div>
    </div>
  );
}
