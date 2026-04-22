"use client";

import { useTranslations } from "next-intl";

interface Props {
  count: number;
  onReveal: () => void;
  onDismiss: () => void;
}

/**
 * Inline banner that appears above the order table when realtime buffers new
 * INSERT rows matching current filters. Doesn't interrupt scroll — the user
 * chooses when to fold them in.
 */
export function NewOrdersBanner({ count, onReveal, onDismiss }: Props) {
  const t = useTranslations("orders.banner");
  if (count === 0) return null;
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 14px",
        background: "#F1F8F5",
        border: "1px solid #B8DCCB",
        borderRadius: 8,
        color: "#008060",
        fontSize: 13,
        fontWeight: 500,
      }}
    >
      <button
        type="button"
        onClick={onReveal}
        style={{
          background: "none",
          border: "none",
          color: "#008060",
          fontSize: 13,
          fontWeight: 500,
          cursor: "pointer",
          padding: 0,
          textDecoration: "underline",
        }}
      >
        {t("reveal", { count })}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("dismiss")}
        style={{
          background: "none",
          border: "none",
          color: "#6D7175",
          fontSize: 14,
          cursor: "pointer",
          padding: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
