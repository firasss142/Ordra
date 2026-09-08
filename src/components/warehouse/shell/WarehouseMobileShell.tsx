"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Boxes, PackageOpen, RotateCcw, Settings } from "lucide-react";
import type { AuthUser } from "@/types";
import { jsonFetcher } from "@/lib/fetchers";
import { WarehouseBottomBar, type BottomTab } from "./WarehouseBottomBar";
import { ScanFab } from "./ScanFab";

/**
 * The warehouse agent's shell.
 *
 * Four destinations along the bottom, in the order the agent works: the bench
 * (home: what to scan, grouped by sticker roll), returns, stock, settings. A
 * floating scan button opens the bench's scan sheet from anywhere. No header:
 * the market is not something an agent can change, and identity lives in
 * Réglages.
 *
 * Managers keep the desk console — `(warehouse)/layout.tsx` picks by role.
 * See plans/warehouse-agent-ux-critique.md for why the KPI dashboard went.
 */

interface QueueCounts {
  queue?: { returnsInbox?: number };
}

export function WarehouseMobileShell({
  user,
  direction,
  children,
}: {
  user: AuthUser;
  direction: "ltr" | "rtl";
  children: React.ReactNode;
}) {
  const t = useTranslations("warehouse");
  const locale = user.locale;

  /*
   * Same key the dashboard uses, so SWR serves both from one request. The
   * badge is the reason an agent glances at the bar at all — "is anything
   * waiting for me" answered without navigating.
   */
  const { data } = useSWR<QueueCounts>("/api/warehouse/summary", jsonFetcher, {
    revalidateOnFocus: true,
    refreshInterval: 60_000,
  });

  const tabs: BottomTab[] = useMemo(() => {
    const returns = data?.queue?.returnsInbox ?? 0;
    return [
      {
        href: `/${locale}/warehouse`,
        label: t("nav.bench"),
        icon: PackageOpen,
        exact: true,
        prefetchKey: "/api/warehouse/to-label?limit=200",
      },
      {
        href: `/${locale}/warehouse/returns`,
        label: t("nav.returns"),
        icon: RotateCcw,
        // Zero is not a badge. An empty queue should read as calm, not as an
        // unread notification.
        count: returns || undefined,
        prefetchKey: "/api/warehouse/returns",
      },
      {
        href: `/${locale}/warehouse/stock`,
        label: t("nav.inventory"),
        icon: Boxes,
        prefetchKey: "/api/warehouse/stock",
      },
      {
        href: `/${locale}/warehouse/settings`,
        label: t("nav.settings"),
        icon: Settings,
      },
    ];
  }, [locale, t, data]);

  return (
    <div
      className="wh-console wh-mobile min-h-screen"
      style={{ direction }}
    >
      <main
        id="main-content"
        data-testid="wh-mobile-main"
        // Clears the fixed bar and the home indicator. Without it the last
        // card on every screen sits behind the bar and cannot be tapped.
        className="wh-safe-top pb-[calc(56px+env(safe-area-inset-bottom,0px)+84px)]"
      >
        {children}
      </main>
      {/* One scanner for the whole shell: the bench sheet, opened by a query
          flag so the button works from any tab without a second station. */}
      <ScanFab href={`/${locale}/warehouse?scan=1`} label={t("nav.quickScan")} />
      <WarehouseBottomBar tabs={tabs} />
    </div>
  );
}
