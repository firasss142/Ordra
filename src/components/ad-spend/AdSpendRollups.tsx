"use client";

import { useTranslations } from "next-intl";
import { Calendar, CalendarRange, LineChart as LineIcon, Gauge } from "lucide-react";
import { AD_SPEND_THEME as D } from "./theme";

interface AdSpendRollupsProps {
  thisWeek: number;
  thisMonth: number;
  ytd: number;
  avgCostPerConf: number | null;
  currency: string;
  locale: string;
}

function formatAmount(n: number, locale: string): string {
  return n.toLocaleString(locale === "ar" ? "ar" : "fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function AdSpendRollups({
  thisWeek,
  thisMonth,
  ytd,
  avgCostPerConf,
  currency,
  locale,
}: AdSpendRollupsProps) {
  const t = useTranslations("adSpend.rollups");

  const cards = [
    { label: t("thisWeek"), value: formatAmount(thisWeek, locale), suffix: currency, icon: <Calendar size={18} strokeWidth={1.5} color={D.muted} /> },
    { label: t("thisMonth"), value: formatAmount(thisMonth, locale), suffix: currency, icon: <CalendarRange size={18} strokeWidth={1.5} color={D.muted} /> },
    { label: t("ytd"), value: formatAmount(ytd, locale), suffix: currency, icon: <LineIcon size={18} strokeWidth={1.5} color={D.muted} /> },
    {
      label: t("avgCostPerConf"),
      value: avgCostPerConf != null ? formatAmount(avgCostPerConf, locale) : "—",
      suffix: avgCostPerConf != null ? `${currency} / ${t("conf")}` : "",
      icon: <Gauge size={18} strokeWidth={1.5} color={D.muted} />,
    },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(min(160px, 100%), 1fr))",
        gap: 16,
      }}
    >
      {cards.map((card) => (
        <div
          key={card.label}
          style={{
            background: D.cardBg,
            border: `1px solid ${D.border}`,
            borderRadius: 8,
            boxShadow: D.shadow,
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "#F6F6F7",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {card.icon}
            </div>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: D.muted,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {card.label}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span
              style={{
                fontSize: "clamp(22px, 5vw, 32px)",
                fontWeight: 700,
                color: D.ink,
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
              }}
            >
              {card.value}
            </span>
            {card.suffix && (
              <span style={{ fontSize: 12, color: D.tertiary, fontWeight: 500 }}>
                {card.suffix}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
