"use client";

import { useTranslations } from "next-intl";
import type { CarrierListItem } from "@/hooks/useCarriers";

interface CarrierSelectorProps {
  carriers: CarrierListItem[];
  onSelect: (carrier: CarrierListItem) => void;
  onCancel: () => void;
}

const btnStyle: React.CSSProperties = {
  width: "100%",
  height: 44,
  padding: "0 16px",
  fontSize: 14,
  fontWeight: 500,
  backgroundColor: "white",
  color: "#1A1A1A",
  border: "1px solid #E1E3E5",
  borderRadius: "0.375rem",
  cursor: "pointer",
  textAlign: "start",
};

const cancelBtnStyle: React.CSSProperties = {
  height: 36,
  padding: "0 16px",
  fontSize: 14,
  fontWeight: 500,
  backgroundColor: "white",
  color: "#6D7175",
  border: "1px solid #D1D5DB",
  borderRadius: "0.375rem",
  cursor: "pointer",
};

export function CarrierSelector({
  carriers,
  onSelect,
  onCancel,
}: CarrierSelectorProps) {
  const t = useTranslations("queue");

  return (
    <div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: "#1A1A1A",
          marginBottom: 12,
        }}
      >
        {t("selectCarrier")}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
        {carriers.map((carrier) => (
          <button
            key={carrier.id}
            style={btnStyle}
            onClick={() => onSelect(carrier)}
          >
            {carrier.name}
          </button>
        ))}
      </div>
      <button style={cancelBtnStyle} onClick={onCancel}>
        {t("cancel")}
      </button>
    </div>
  );
}
