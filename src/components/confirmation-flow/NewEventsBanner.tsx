"use client";

import { useTranslations } from "next-intl";

interface NewEventsBannerProps {
  count: number;
  onFlush: () => void;
}

export function NewEventsBanner({ count, onFlush }: NewEventsBannerProps) {
  const t = useTranslations("confirmationFlow");
  if (count === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 50,
        background: "#1A1A1A",
        color: "#FFFFFF",
        padding: "8px 16px",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 500,
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
      }}
    >
      <span>
        {count} {t("banner.updates")}
      </span>
      <button
        onClick={onFlush}
        style={{
          background: "rgba(255,255,255,0.15)",
          border: "1px solid rgba(255,255,255,0.3)",
          borderRadius: 4,
          color: "#FFFFFF",
          fontSize: 12,
          fontWeight: 500,
          padding: "3px 10px",
          cursor: "pointer",
        }}
      >
        {t("banner.refresh")}
      </button>
    </div>
  );
}
