import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/auth/server-user";
import { canViewOwnPortfolio } from "@/lib/investor-permissions";
import { loadPortfolio } from "@/lib/investors/portfolio";
import { StatementsClient } from "@/components/investor/StatementsClient";

export const dynamic = "force-dynamic";

export default async function InvestorStatementsPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();

  if (!user) redirect(`/${params.locale}/login`);
  if (!canViewOwnPortfolio(user.role)) redirect(`/${params.locale}/dashboard`);

  const admin = createAdminClient();
  const portfolio = await loadPortfolio(admin, user.id);

  if (!portfolio) redirect(`/${params.locale}/investor`);

  return <StatementsClient market={portfolio.marketCode} />;
}
