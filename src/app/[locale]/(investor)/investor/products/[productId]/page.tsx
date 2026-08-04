import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/auth/server-user";
import { canViewOwnPortfolio } from "@/lib/investor-permissions";
import { loadPortfolio } from "@/lib/investors/portfolio";
import { PositionDetailClient } from "@/components/investor/PositionDetailClient";

export const dynamic = "force-dynamic";

/**
 * One funded product in full.
 *
 * loadPortfolio() already returns every position the investor holds, so this
 * page reuses it rather than adding a per-product query — and the client then
 * polls the same /api/investor/portfolio key as the overview, sharing one SWR
 * cache entry instead of opening a second poll.
 *
 * A product the investor does not hold redirects home rather than 404ing: the
 * distinction between "no such product" and "not yours" is itself a disclosure.
 */
export default async function InvestorProductPage({
  params,
}: {
  params: { locale: string; productId: string };
}) {
  const user = await getServerUser();

  if (!user) redirect(`/${params.locale}/login`);
  if (!canViewOwnPortfolio(user.role)) redirect(`/${params.locale}/dashboard`);

  const admin = createAdminClient();
  const portfolio = await loadPortfolio(admin, user.id);

  if (!portfolio) redirect(`/${params.locale}/investor`);
  if (!portfolio.positions.some((p) => p.productId === params.productId)) {
    redirect(`/${params.locale}/investor`);
  }

  return (
    <PositionDetailClient
      initialData={portfolio}
      productId={params.productId}
      locale={params.locale}
    />
  );
}
