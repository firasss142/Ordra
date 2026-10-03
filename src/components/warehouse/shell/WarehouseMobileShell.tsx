"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Boxes, Home, PackageOpen, RotateCcw } from "lucide-react";
import type { AuthUser } from "@/types";
import { jsonFetcher } from "@/lib/fetchers";
import type { TodayResponse } from "@/app/api/warehouse/today/route";
import { WarehouseBottomBar, type BottomTab } from "./WarehouseBottomBar";
import { ScanButton } from "./ScanButton";

/**
 * The warehouse agent's shell.
 *
 * The bottom bar follows the day: Aujourd'hui (home — the four jobs), Sortir,
 * the Scan action in the centre, Rentrer, Stock. Recevoir and Compter are jobs
 * reached from Aujourd'hui and Stock rather than tabs; Réglages moved behind
 * the avatar on Aujourd'hui — it is not a job. Each job tab wears its hue.
 *
 * Managers keep the desk console — `(warehouse)/layout.tsx` picks by role.
 * See plans/entrepot-day-loop-redesign.md.
 */

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
   * The returns badge. It used to poll /api/warehouse/summary every minute —
   * a leaderboard, a trend and low stock computed to draw one number. The day
   * loop has the figure, scoped to the agent's building.
   */
  const { data } = useSWR<TodayResponse>("/api/warehouse/today", jsonFetcher, {
    revalidateOnFocus: true,
    refreshInterval: 60_000,
  });
  const returns = data && !data.siteUnassigned ? data.counts.returnsAtCarrier : 0;

  const tabs: BottomTab[] = useMemo(
    () => [
      { href: `/${locale}/warehouse`, label: t("nav.today"), icon: Home, exact: true, prefetchKey: "/api/warehouse/today" },
      {
        href: `/${locale}/warehouse/out`,
        label: t("nav.out"),
        icon: PackageOpen,
        hue: "job-out",
        prefetchKey: "/api/warehouse/to-label?limit=200",
      },
      {
        href: `/${locale}/warehouse/returns`,
        label: t("nav.returnsJob"),
        icon: RotateCcw,
        hue: "job-returns",
        // Zero is not a badge. An empty queue should read as calm, not as an
        // unread notification.
        count: returns || undefined,
        prefetchKey: "/api/warehouse/returns",
      },
      {
        href: `/${locale}/warehouse/stock`,
        label: t("nav.stock"),
        icon: Boxes,
        hue: "job-receive",
        prefetchKey: "/api/warehouse/stock",
      },
    ],
    [locale, t, returns],
  );

  /*
   * A run takes the whole screen — the scan run and the count run alike.
   *
   * The agent is holding a parcel and reading a sticker number; destinations
   * along the bottom are ways to lose the batch by mistake. The run carries its
   * own way out — a labelled exit at the top — so nothing is trapped.
   */
  const countHref = `/${locale}/warehouse/count`;
  const inRun =
    pathname === runHref || pathname.startsWith(`${runHref}/`) || pathname === countHref;

  return (
    <div
      className="wh-console wh-mobile min-h-screen"
      style={{ direction }}
    >
      <main
        id="main-content"
        data-testid="wh-mobile-main"
        // Clears the fixed bar, the raised scan button and the home indicator.
        className={inRun ? "wh-safe-top" : "wh-safe-top pb-[calc(56px+env(safe-area-inset-bottom,0px)+40px)]"}
      >
        {children}
      </main>
      {inRun ? null : (
        <WarehouseBottomBar
          tabs={tabs}
          center={<ScanButton href={`/${locale}/warehouse/out?scan=1`} label={t("nav.scan")} />}
        />
      )}
    </div>
  );
}
