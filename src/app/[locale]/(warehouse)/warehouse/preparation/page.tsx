import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canScanWarehouse } from "@/lib/role-permissions";
import { createClient } from "@/lib/supabase/server";
import { PreparationClient } from "@/components/warehouse/preparation/PreparationClient";
import { getTranslations } from "next-intl/server";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";

export const dynamic = "force-dynamic";

async function prefetchToLabel(marketScope: string | null): Promise<WarehouseOrderRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_to_label_orders", {
    p_market_id: marketScope,
    p_limit: 200,
  });
  return (data ?? []) as unknown as WarehouseOrderRow[];
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

  const scope = user.role !== "super_admin" ? user.market_id : null;
  const fallbackRows = await prefetchToLabel(scope);

  const t = await getTranslations("warehouse");

  return (
    <PreparationClient
      marketId={user.role === "super_admin" ? null : user.market_id}
      fallbackRows={fallbackRows}
      labels={{
        pageTitle: t("preparation.title"),
        pageSubtitle: t("preparation.subtitle"),
        stageBacklog: t("preparation.stageBacklog"),
        stageTray: t("preparation.stageTray"),
        stageScanner: t("preparation.stageScanner"),
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
          feedbackIdle: t("preparation.scanner.feedbackIdle"),
          recentTitle: t("preparation.scanner.recentTitle"),
          recentEmpty: t("preparation.scanner.recentEmpty"),
          stockAfter: t("preparation.scanner.stockAfter"),
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
        },
      }}
    />
  );
}
