"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Bell } from "lucide-react";
import { useAlertsPanel } from "@/context/alerts-panel";
import { fetcher } from "@/lib/swr-config";
import { NavBadge } from "@/components/layout/sidebar/NavBadge";
import type { AuthUser } from "@/types";

/**
 * The sidebar's alerts button. In the full bar and the phone top bar it is a
 * pill — bell and count side by side, in the shared count chip — where the old
 * 28 px square wore a 9.5 px « 99+ » on its corner. In the 64 px rail the
 * number moves into the accessible name and a dot stands in for it.
 * Shares its SWR key with every other summary consumer.
 */
export function AlertsBell({ user, variant = "pill" }: { user: AuthUser; variant?: "pill" | "rail" }) {
  const t = useTranslations("alerts");
  const { openPanel } = useAlertsPanel();

  const marketParam = user.market_id ? `?market_id=${user.market_id}` : "";
  const { data } = useSWR<{ total: number }>(`/api/alerts/summary${marketParam}`, fetcher, {
    refreshInterval: 60000,
    revalidateOnFocus: false,
  });
  const total = data?.total ?? 0;
  const label = total > 0 ? t("bellWithCount", { count: total }) : t("bell");

  if (variant === "rail") {
    return (
      <button type="button" className="sb-rbtn" onClick={() => openPanel()} aria-label={label} title={t("bell")}>
        <Bell size={18} strokeWidth={1.75} aria-hidden="true" />
        {total > 0 && <span className="sb-rdot sb-rdot-critical" aria-hidden="true" />}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={total > 0 ? "sb-alerts" : "sb-alerts sb-alerts-zero"}
      onClick={() => openPanel()}
      aria-label={label}
      title={t("bell")}
    >
      <Bell size={15} strokeWidth={1.75} aria-hidden="true" />
      <NavBadge count={total} tone="critical" />
    </button>
  );
}
