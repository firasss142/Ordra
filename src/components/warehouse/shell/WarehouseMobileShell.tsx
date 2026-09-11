"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();
  const runHref = `/${locale}/warehouse/scan`;

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

  /*
   * A run takes the whole screen.
   *
   * The agent is holding a parcel and reading a sticker number; four
   * destinations and a floating button along the bottom are four ways to lose
   * the batch by mistake. The run carries its own way out — a labelled exit at
   * the top — so nothing is trapped.
   */
  const inRun = pathname === runHref || pathname.startsWith(`${runHref}/`);

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
        className={inRun ? "wh-safe-top" : "wh-safe-top pb-[calc(56px+env(safe-area-inset-bottom,0px)+84px)]"}
      >
        {children}
      </main>
      {inRun ? null : (
        <>
          {/* One scanner for the whole shell. It opens a RUN — pick what stays
              in your hand, then work the batch — rather than a lone sheet that
              forgot the parcel on every navigation. */}
          <ScanFab href={runHref} label={t("nav.quickScan")} />
          <WarehouseBottomBar tabs={tabs} />
        </>
      )}
    </div>
  );
}
