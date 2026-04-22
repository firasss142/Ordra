"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import type { CarrierConfig } from "@/types/carrier";

interface CarrierSelectProps {
  marketId: string;
  onSelect: (carrier: CarrierConfig) => void;
  onCarriersLoaded?: (count: number) => void;
}

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error("Failed to fetch carriers");
    return r.json();
  });

const rowBase: React.CSSProperties = {
  padding: "12px 16px",
  border: "1px solid #D1D5DB",
  borderRadius: "0.25rem",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 500,
  color: "#1A1A1A",
  backgroundColor: "#FFFFFF",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  userSelect: "none",
};

const rowSelected: React.CSSProperties = {
  ...rowBase,
  border: "2px solid #1A1A1A",
  borderWidth: "2px",
};

export function CarrierSelect({ marketId, onSelect, onCarriersLoaded }: CarrierSelectProps) {
  const t = useTranslations("queue");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading } = useSWR(
    marketId ? `/api/carriers?market_id=${marketId}&is_active=true` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  );

  const carriers: CarrierConfig[] = (data?.data ?? []).filter(
    (c: CarrierConfig) => c.is_active
  );

  useEffect(() => {
    if (!isLoading && onCarriersLoaded) onCarriersLoaded(carriers.length);
  }, [isLoading, carriers.length, onCarriersLoaded]);

  if (isLoading) {
    return (
      <div style={{ fontSize: 14, color: "#6B7280", padding: "8px 0" }}>
        {t("loadingCarriers")}
      </div>
    );
  }

  if (carriers.length === 0) {
    // Parent renders the banner — render nothing here.
    return null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {carriers.map((carrier) => {
        const label = carrier.sender_name ?? carrier.carrier_type;
        const isSelected = selectedId === carrier.id;
        return (
          <div
            key={carrier.id}
            style={isSelected ? rowSelected : rowBase}
            onClick={() => {
              setSelectedId(carrier.id);
              onSelect(carrier);
            }}
          >
            <span>{label}</span>
            <span style={{ fontSize: 12, color: "#6B7280", fontWeight: 400 }}>
              ({carrier.carrier_type})
            </span>
          </div>
        );
      })}
    </div>
  );
}
