"use client";

import { useTranslations } from "next-intl";

interface Props {
  count: number;
  onReveal: () => void;
  onDismiss: () => void;
}

export function NewFollowUpsBanner({ count, onReveal, onDismiss }: Props) {
  const t = useTranslations("crm.followUps.banner");
  if (count === 0) return null;

  const label = count === 1 ? t("revealOne") : t("revealMany", { count });

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 14px",
        borderRadius: 9999,
        background: "#EAF7EF",
        border: "1px solid #CDE9D7",
        color: "#008060",
        fontSize: 13,
        fontWeight: 500,
        alignSelf: "flex-start",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#008060",
          display: "inline-block",
        }}
      />
      <button
        type="button"
        onClick={onReveal}
        style={{
          border: "none",
          background: "transparent",
          color: "#008060",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          padding: 0,
        }}
      >
        {label}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("dismiss")}
        style={{
          border: "none",
          background: "transparent",
          color: "#6D7175",
          fontSize: 13,
          cursor: "pointer",
          padding: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
