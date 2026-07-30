import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { canScanWarehouse } from "@/lib/role-permissions";
import { createClient } from "@/lib/supabase/server";
import { PreparationClient } from "@/components/warehouse/preparation/PreparationClient";
import { getTranslations } from "next-intl/server";
import { buildQueuePageMeta } from "@/lib/warehouse/queue-cursor";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import type { WarehouseQueuePage } from "@/hooks/useWarehouseQueue";

export const dynamic = "force-dynamic";

const PAGE_LIMIT = 50;

async function prefetchToLabel(
  marketScope: string | null,
): Promise<WarehouseQueuePage> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_to_label_orders", {
    p_market_id: marketScope,
    p_limit: PAGE_LIMIT + 1,
    p_cursor_created_at: null,
    p_cursor_id: null,
  });
  const { rows, nextCursor } = buildQueuePageMeta(
    (data ?? []) as unknown as WarehouseOrderRow[],
    PAGE_LIMIT,
  );
  return { orders: rows, nextCursor };
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await getServerUser();
  if (!user) redirect(`/${locale}/login`);
  if (!canScanWarehouse(user.role)) redirect(`/${locale}/queue`);

  const { marketId: scope } = await getActiveMarketScope(user);
  const fallbackPage = await prefetchToLabel(scope);

  const t = await getTranslations({ locale, namespace: "warehouse" });

  return (
    <PreparationClient
      marketId={scope}
      fallbackPage={fallbackPage}
      labels={{
        pageTitle: t("preparation.title"),
        pageSubtitle: t("preparation.subtitle"),
        stageBacklog: t("preparation.stageBacklog"),
        stageTray: t("preparation.stageTray"),
        stageScanner: t("preparation.stageScanner"),
        mode: {
          scan: t("preparation.mode.scan"),
          workbench: t("preparation.mode.workbench"),
          ariaLabel: t("preparation.mode.ariaLabel"),
        },
        scanFirst: {
          inputPlaceholder: t("preparation.scanFirst.inputPlaceholder"),
          openCamera: t("scanner.openCamera"),
          idleHeadline: t("preparation.scanFirst.idleHeadline"),
          idleHint: t("preparation.scanFirst.idleHint"),
          customerHeading: t("preparation.scanFirst.customerHeading"),
          recentTitle: t("preparation.scanFirst.recentTitle"),
          recentEmpty: t("preparation.scanFirst.recentEmpty"),
          stockAfterShort: t.raw("preparation.scanFirst.stockAfterShort") as string,
          stockAfterLabel: t("preparation.scanFirst.stockAfterLabel"),
          successBadge: t("preparation.scanFirst.successBadge"),
          warningBadge: t("preparation.scanFirst.warningBadge"),
          errorBadge: t("preparation.scanFirst.errorBadge"),
          qty: t("preparation.scanFirst.qty"),
          errors: {
            ORDER_NOT_FOUND: t("preparation.scanFirst.errors.ORDER_NOT_FOUND"),
            MARKET_MISMATCH: t("preparation.scanFirst.errors.MARKET_MISMATCH"),
            INVALID_STATUS: t("preparation.scanFirst.errors.INVALID_STATUS"),
            NO_LABEL_PRINTED: t("preparation.scanFirst.errors.NO_LABEL_PRINTED"),
            STOCK_UNDERFLOW: t("preparation.scanFirst.errors.STOCK_UNDERFLOW"),
            NETWORK_ERROR: t("preparation.scanFirst.errors.NETWORK_ERROR"),
          },
        },
        stats: {
          labelsPrinted: t("preparation.stats.labelsPrinted"),
          ordersScanned: t("preparation.stats.ordersScanned"),
          avgCycle: t("preparation.stats.avgCycle"),
          traySize: t("preparation.stats.traySize"),
        },
        tray: {
          empty: t("preparation.tray.empty"),
          printBtn: t("preparation.tray.printBtn"),
          printing: t("preparation.tray.printing"),
          selectAll: t("preparation.tray.selectAll"),
          progress: t("preparation.tray.progress"),
          traySizeWarning: t("preparation.tray.traySizeWarning"),
        },
        scanner: {
          inputPlaceholder: t("preparation.scanner.inputPlaceholder"),
          openCamera: t("scanner.openCamera"),
          feedbackIdle: t("preparation.scanner.feedbackIdle"),
          recentTitle: t("preparation.scanner.recentTitle"),
          recentEmpty: t("preparation.scanner.recentEmpty"),
          stockAfter: t.raw("preparation.scanner.stockAfter") as string,
        },
        backlog: {
          title: t("preparation.backlog.title"),
          empty: t("preparation.backlog.empty"),
          colCity: t("preparation.backlog.colCity"),
          colCustomer: t("preparation.backlog.colCustomer"),
          colProduct: t("preparation.backlog.colProduct"),
          colId: t("preparation.backlog.colId"),
          addToTray: t("preparation.backlog.addToTray"),
          inTray: t("preparation.backlog.inTray"),
          newReveal: t("preparation.backlog.newReveal"),
          dismiss: t("preparation.backlog.dismiss"),
          lowStock: t("preparation.backlog.lowStock"),
          criticalStock: t("preparation.backlog.criticalStock"),
          loadMore: t("preparation.backlog.loadMore"),
          loadingMore: t("preparation.backlog.loadingMore"),
        },
      }}
    />
  );
}
