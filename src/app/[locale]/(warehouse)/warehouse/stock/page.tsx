import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canScanWarehouse } from "@/lib/role-permissions";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { createClient } from "@/lib/supabase/server";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";
import { marketTimezone } from "@/lib/markets";
import { StockConsole } from "@/components/warehouse/console/StockConsole";

export const dynamic = "force-dynamic";

/**
 * Entrepôt › Stock — units, for the people who hold them.
 *
 * Distinct from /dashboard/stock, which values the same shelves at COGS and
 * stays super-admin. Everyone who can scan can count.
 *
 * The agent gets the phone (`R.stock`), every other role the desk (`C.stock`).
 * The building in view is the agent's own — pinned, whatever the address says
 * — or the desk's `?warehouse_id=` (absent = every building).
 */
export default async function WarehouseStockPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ warehouse_id?: string }>;
}) {
  const { locale } = await params;
  const { warehouse_id: requested } = await searchParams;
  const user = await getServerUser();
  if (!user) redirect(`/${locale}/login`);
  if (!canScanWarehouse(user.role)) redirect(`/${locale}/queue`);

  const supabase = await createClient();
  const site = await resolveSiteFilter(supabase, { actor: user, requested: requested ?? null });
  const isAgent = user.role === "warehouse_agent";

  let eyebrow: string | null = null;
  if (isAgent) {
    const { marketId, marketCode } = await getActiveMarketScope(user);
    // The building's own name, in the market's language — a place name painted
    // on a wall, never translated by key — then the market's date.
    const siteName = site.warehouseId
      ? await supabase
          .from("warehouses")
          .select("name_fr, name_ar")
          .eq("id", site.warehouseId)
          .maybeSingle<{ name_fr: string; name_ar: string }>()
          .then((r) => (marketCode === "ly" ? r.data?.name_ar : r.data?.name_fr) ?? null)
      : null;
    const date = new Intl.DateTimeFormat(locale === "ar" ? "ar-LY" : "fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: marketTimezone(marketId),
    }).format(new Date());
    eyebrow = [siteName, date].filter(Boolean).join(" · ");
  }

  return (
    <StockConsole
      locale={locale}
      role={user.role}
      variant={isAgent ? "agent" : "desk"}
      siteId={site.warehouseId}
      eyebrow={eyebrow}
    />
  );
}
