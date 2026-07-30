import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/auth/server-user";
import { canRequestWithdrawal } from "@/lib/investor-permissions";
import { loadPortfolio } from "@/lib/investors/portfolio";
import { WithdrawalsClient } from "@/components/investor/WithdrawalsClient";

export const dynamic = "force-dynamic";

export default async function InvestorWithdrawalsPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();

  if (!user) redirect(`/${params.locale}/login`);
  if (!canRequestWithdrawal(user.role)) redirect(`/${params.locale}/dashboard`);

  const admin = createAdminClient();
  const portfolio = await loadPortfolio(admin, user.id);

  if (!portfolio) redirect(`/${params.locale}/investor`);

  // Only the SETTLED, released balance is offered. Pending accruals and the
  // held reserve are excluded here and again server-side in the POST handler.
  return (
    <WithdrawalsClient
      available={portfolio.balance.available}
      market={portfolio.marketCode}
    />
  );
}
