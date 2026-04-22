"use client";

import { useState, useCallback } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { useTranslations } from "next-intl";
import { AdSpendManager } from "@/components/dashboard/AdSpendManager";
import { PeriodSelector, type Period } from "@/components/dashboard/MetricsTable";
import type { AdSpendEntry } from "@/components/dashboard/AdSpendManager";
import type { AuthUser } from "@/types";
import { todayISO } from "@/lib/date";

interface Market {
  id: string;
  name: string;
  code: string;
}

interface OverviewResponse {
  data: {
    profitability: { currency: string; period: Period };
    adSpend: AdSpendEntry[];
  };
}

interface AdSpendClientProps {
  user: AuthUser;
  markets: Market[];
}

export function AdSpendClient({ user, markets }: AdSpendClientProps) {
  const t = useTranslations("adSpend");
  const [period, setPeriod] = useState<Period>({
    from_date: todayISO(),
    to_date: todayISO(),
  });
  const [selectedMarketId, setSelectedMarketId] = useState<string>(
    user.role === "super_admin" ? markets[0]?.id ?? "" : user.market_id ?? "",
  );

  const overviewUrl =
    selectedMarketId && period.from_date && period.to_date
      ? `/api/dashboard/overview?from_date=${period.from_date}&to_date=${period.to_date}&market_id=${selectedMarketId}`
      : null;

  const { data, isLoading } = useSWR<OverviewResponse>(overviewUrl);
  const adSpend = data?.data?.adSpend ?? [];

  const handleAdd = useCallback(
    async (entry: {
      amount: number;
      period_start: string;
      period_end: string;
      note: string;
    }) => {
      await fetch("/api/ad-spend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          selectedMarketId ? { ...entry, market_id: selectedMarketId } : entry,
        ),
      });
      globalMutate(overviewUrl);
    },
    [overviewUrl, selectedMarketId],
  );

  const handleEdit = useCallback(
    async (
      id: string,
      patch: { amount?: number; period_start?: string; period_end?: string; note?: string },
    ) => {
      await fetch(`/api/ad-spend/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      globalMutate(overviewUrl);
    },
    [overviewUrl],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await fetch(`/api/ad-spend/${id}`, { method: "DELETE" });
      globalMutate(overviewUrl);
    },
    [overviewUrl],
  );

  return (
    <div
      style={{
        padding: "32px 32px 64px",
        background: "#F6F6F7",
        minHeight: "100vh",
      }}
    >
      <h1
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: "#1A1A1A",
          margin: "0 0 8px 0",
        }}
      >
        {t("title")}
      </h1>
      <p style={{ fontSize: 13, color: "#6D7175", margin: "0 0 20px 0" }}>
        {t("subtitle")}
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <select
          value={selectedMarketId}
          onChange={(e) => setSelectedMarketId(e.target.value)}
          style={{
            padding: "8px 12px",
            fontSize: 14,
            border: "1px solid #D1D5DB",
            borderRadius: 6,
            background: "#FFFFFF",
            color: "#1A1A1A",
          }}
        >
          {markets.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <PeriodSelector period={period} onChange={setPeriod} />
      </div>

      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E1E3E5",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <AdSpendManager
          entries={adSpend}
          period={period}
          onAdd={handleAdd}
          onEdit={handleEdit}
          onDelete={handleDelete}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}
