"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Boxes, LayoutGrid, RotateCcw, Settings } from "lucide-react";
import type { AuthUser } from "@/types";
import { jsonFetcher } from "@/lib/fetchers";
import { WarehouseBottomBar, type BottomTab } from "./WarehouseBottomBar";
import { ScanFab } from "./ScanFab";

/**
 * The warehouse agent's shell — the mockups' app, not a narrowed desk console.
 *
 * See docs/design/entrepot/mobile/. Four destinations along the bottom, a
 * floating scan button, a paper ground with a 40px lattice, and NO header:
 * three of the four mockups start straight at the page title. The market
 * badge that used to sit up there is not something an agent can change, and
 * the avatar menu moved to Réglages.
 *
 * Managers keep the desk console — `(warehouse)/layout.tsx` picks by role.
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
        label: t("nav.dashboard"),
        icon: LayoutGrid,
        exact: true,
        prefetchKey: "/api/warehouse/summary",
      },
      {
        href: `/${locale}/warehouse/stock`,
        label: t("nav.inventory"),
        icon: Boxes,
        prefetchKey: "/api/warehouse/stock",
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
        href: `/${locale}/warehouse/settings`,
        label: t("nav.settings"),
        icon: Settings,
      },
    ];
  }, [locale, t, data]);

  return (
    <div
      className="wh-console wh-mobile wm-grid-ground min-h-screen"
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
      <ScanFab href={`/${locale}/warehouse/scan`} label={t("nav.quickScan")} />
      <WarehouseBottomBar tabs={tabs} />
    </div>
  );
}
