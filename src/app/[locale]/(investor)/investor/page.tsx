import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/auth/server-user";
import { canViewOwnPortfolio } from "@/lib/investor-permissions";
import { loadPortfolio } from "@/lib/investors/portfolio";
import { PortfolioClient } from "@/components/investor/PortfolioClient";

export const dynamic = "force-dynamic";

/**
 * Server-renders the portfolio, then hands it to the client as SWR
 * fallbackData under the same key the client polls — the pattern used by
 * DashboardClient, which avoids a duplicate fetch on first paint.
 */
export default async function InvestorPortfolioPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();

  if (!user) redirect(`/${params.locale}/login`);
  if (!canViewOwnPortfolio(user.role)) redirect(`/${params.locale}/dashboard`);

  const admin = createAdminClient();
  const portfolio = await loadPortfolio(admin, user.id);

  if (!portfolio) {
    // Role granted but no investors row yet — an onboarding gap, not an error
    // the investor can act on.
    return (
      <div className="rounded-[10px] border border-line-subtle bg-surface-card p-8 text-center">
        <p className="m-0 text-[14px] text-ink-secondary">
          Votre profil investisseur n&apos;est pas encore configuré.
        </p>
      </div>
    );
  }

  return <PortfolioClient initialData={portfolio} />;
}
