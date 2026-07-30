"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Bell } from "lucide-react";
import { useAlertsPanel } from "@/context/alerts-panel";
import type { AuthUser } from "@/types";

/**
 * Dark-surface bell button for the sidebar header. Shows the live alerts
 * total and opens the alerts slide-over. Shares its SWR key with any other
 * summary consumer, so no extra network traffic.
 */
export function AlertsBell({ user }: { user: AuthUser }) {
  const t = useTranslations("alerts");
  const { openPanel } = useAlertsPanel();

  const marketParam = user.market_id ? `?market_id=${user.market_id}` : "";
  const { data } = useSWR<{ total: number }>(`/api/alerts/summary${marketParam}`, {
    refreshInterval: 60000,
    revalidateOnFocus: false,
  });
  const total = data?.total ?? 0;

  return (
    <button
      type="button"
      onClick={() => openPanel()}
      aria-label={total > 0 ? t("bellWithCount", { count: total }) : t("bell")}
      title={t("bell")}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: 6,
        border: "1px solid var(--sidebar-border-strong)",
        background: "transparent",
        color: "var(--sidebar-text)",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      <Bell size={14} strokeWidth={1.75} aria-hidden="true" />
      {total > 0 ? (
        <span
          style={{
            position: "absolute",
            top: -5,
            insetInlineEnd: -5,
            minWidth: 15,
            height: 15,
            padding: "0 4px",
            borderRadius: 9999,
            background: "var(--critical, #D72C0D)",
            color: "#FFFFFF",
            fontSize: 9.5,
            fontWeight: 600,
            lineHeight: "15px",
            textAlign: "center",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {total > 99 ? "99+" : total}
        </span>
      ) : null}
    </button>
  );
}
