import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canScanWarehouse } from "@/lib/role-permissions";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { createClient } from "@/lib/supabase/server";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";
import { fetchDayLoopRows, marketToday } from "@/lib/warehouse/day-loop-server";
import { assembleDayLoop } from "@/lib/warehouse/day-loop-assemble";
import { marketTimezone } from "@/lib/markets";
import type { TodayResponse } from "@/app/api/warehouse/today/route";
import { TodayLive } from "@/components/warehouse/today/TodayLive";

export const dynamic = "force-dynamic";

/**
 * Entrepôt › Aujourd'hui — the section's home, for every role.
 *
 * The four jobs of the day (Sortir, Rentrer, Recevoir, Compter), each the door
 * to its own screen. The bench that used to live here is now /warehouse/out:
 * it answered one of the four questions, which is exactly why the other three
 * were forgotten (0 stock counts in production on 2026-10-02).
 * See plans/entrepot-day-loop-redesign.md.
 */
export default async function WarehouseTodayPage({
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
  const supabase = await createClient();
  const site = await resolveSiteFilter(supabase, { actor: user, requested: requested ?? null });
  const isAgent = user.role === "warehouse_agent";

  let initial: TodayResponse;
  if (site.unassigned) {
    initial = { siteUnassigned: true };
  } else {
    const rows = await fetchDayLoopRows(supabase, { marketId });
    initial = {
      ...assembleDayLoop(rows, {
        focus: site.warehouseId,
        today: marketToday(marketId),
        locale: marketCode === "ly" ? "ar" : "fr",
        withManagerViews: !isAgent,
      }),
      siteUnassigned: false,
      sitePinned: site.pinned,
    };
  }

  // The market's date, in the reader's language and the market's time zone.
  const dateLabel = new Intl.DateTimeFormat(locale === "ar" ? "ar-LY" : "fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: marketTimezone(marketId),
  }).format(new Date());

  return (
    <TodayLive
      initial={initial}
      variant={isAgent ? "agent" : "desk"}
      locale={locale}
      dateLabel={dateLabel}
      warehouseId={site.warehouseId}
      showPickup={marketCode === "ly"}
      marketCode={marketCode === "ly" ? "ly" : marketCode === "tn" ? "tn" : null}
      marketId={marketId}
      today={marketToday(marketId)}
    />
  );
}
