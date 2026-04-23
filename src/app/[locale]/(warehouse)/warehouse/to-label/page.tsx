import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/auth/server-user";
import { canScanWarehouse } from "@/lib/role-permissions";
import { ToLabelQueue } from "@/components/warehouse/ToLabelQueue";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";

export const dynamic = "force-dynamic";

async function prefetchToLabel(
  marketScope: string | null,
): Promise<WarehouseOrderRow[]> {
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

  return (
    <ToLabelQueue
      marketId={user.role === "super_admin" ? null : user.market_id}
      fallbackRows={fallbackRows}
      locale={locale}
    />
  );
}
