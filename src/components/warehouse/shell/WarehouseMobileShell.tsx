"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Boxes, LayoutDashboard, Package, PackageOpen } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import type { AuthUser } from "@/types";
import { jsonFetcher } from "@/lib/fetchers";
import { WarehouseBottomBar, type BottomTab } from "./WarehouseBottomBar";
import { ScanFab } from "./ScanFab";

/**
 * The warehouse agent's shell — a phone app, not a narrowed desk console.
 *
 * The agent works standing, one-handed, holding a parcel. That single fact
 * drives the whole shape: navigation at the bottom where a thumb reaches,
 * the scan action floating above it, and a graph-paper ground that separates
 * the working surface from the white cards sitting on it.
 *
 * Managers keep the desktop console — see `(warehouse)/layout.tsx`, which
 * picks a shell by role.
 */

interface QueueCounts {
  queue?: { toPrepare?: number; returnsInbox?: number };
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
   * The same key the Aujourd'hui screen uses, so SWR serves both from one
   * request. The badges are the reason an agent looks at the bar at all —
   * "is there anything waiting for me" is answered without navigating.
   */
  const { data } = useSWR<QueueCounts>("/api/warehouse/summary", jsonFetcher, {
    revalidateOnFocus: true,
    refreshInterval: 60_000,
  });

  const tabs: BottomTab[] = useMemo(() => {
    const toPrepare = data?.queue?.toPrepare ?? 0;
    const returns = data?.queue?.returnsInbox ?? 0;
    return [
      {
        href: `/${locale}/warehouse`,
        label: t("nav.today"),
        icon: LayoutDashboard,
        exact: true,
        prefetchKey: "/api/warehouse/summary",
      },
      {
        href: `/${locale}/warehouse/preparation`,
        label: t("nav.preparation"),
        icon: Package,
        // Zero is not a badge. An empty queue should read as calm, not as a
        // notification saying "0".
        count: toPrepare || undefined,
        prefetchKey: "/api/warehouse/to-label",
      },
      {
        href: `/${locale}/warehouse/returns`,
        label: t("nav.returns"),
        icon: PackageOpen,
        count: returns || undefined,
        prefetchKey: "/api/warehouse/returns",
      },
      {
        href: `/${locale}/warehouse/stock`,
        label: t("nav.stock"),
        icon: Boxes,
        prefetchKey: "/api/warehouse/stock",
      },
    ];
  }, [locale, t, data]);

  return (
    <div
      className="wh-console wh-grid-ground min-h-screen bg-wh-bg"
      style={{ direction }}
    >
      <Topbar user={user} marketName="" />
      <main
        id="main-content"
        data-testid="wh-mobile-main"
        // Clears the fixed bar and the home indicator. Without it the last
        // card on every screen sits behind the bar and cannot be tapped.
        className="pb-[calc(56px+env(safe-area-inset-bottom,0px)+84px)]"
      >
        {children}
      </main>
      <ScanFab href={`/${locale}/warehouse/scan`} label={t("nav.scan")} />
      <WarehouseBottomBar tabs={tabs} />
    </div>
  );
}
