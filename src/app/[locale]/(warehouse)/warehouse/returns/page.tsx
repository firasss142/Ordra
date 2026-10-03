import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { canScanWarehouse } from "@/lib/role-permissions";
import { createClient } from "@/lib/supabase/server";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";
import { marketTimezone } from "@/lib/markets";
import { ReturnsConsole } from "@/components/warehouse/console/ReturnsConsole";
import { ReturnsHome } from "@/components/warehouse/returns/ReturnsHome";

export const dynamic = "force-dynamic";

/**
 * Entrepôt › Rentrer. The agent's phone (prototype R.returns / R.verdict) and
 * the manager's desk (C.returns) read the same GET /api/warehouse/returns,
 * which pins an agent to their own building whatever the URL says.
 * `?order=<id>` opens that parcel's verdict on either surface — it is where the
 * Scan sheet lands a returned parcel.
 */
export default async function Page({
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

  const { marketId, marketCode } = await getActiveMarketScope(user);

  // The desk follows the top bar's building switch; absent = every building.
  if (user.role !== "warehouse_agent") {
    return <ReturnsConsole marketId={marketId} warehouseId={requested ?? null} />;
  }

  // The agent's eyebrow: their building and the market's date.
  const supabase = await createClient();
  const site = await resolveSiteFilter(supabase, { actor: user, requested: null });
  const siteName = site.warehouseId
    ? await supabase
        .from("warehouses")
        .select("name_fr, name_ar")
        .eq("id", site.warehouseId)
        .maybeSingle<{ name_fr: string; name_ar: string }>()
        // A place name painted on a wall: Libya reads it in Arabic.
        .then((r) => (marketCode === "ly" ? r.data?.name_ar : r.data?.name_fr) ?? null)
    : null;
  const dateLabel = new Intl.DateTimeFormat(locale === "ar" ? "ar-LY" : "fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: marketTimezone(marketId),
  }).format(new Date());

  return <ReturnsHome marketId={marketId} siteName={siteName} dateLabel={dateLabel} />;
}
