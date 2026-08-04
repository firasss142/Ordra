import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/auth/server-user";
import { canViewOwnPortfolio } from "@/lib/investor-permissions";
import { AccountClient } from "@/components/investor/AccountClient";

export const dynamic = "force-dynamic";

export default async function InvestorAccountPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();

  if (!user) redirect(`/${params.locale}/login`);
  if (!canViewOwnPortfolio(user.role)) redirect(`/${params.locale}/dashboard`);

  const admin = createAdminClient();

  // reserve_pct and payout_method explain figures the investor meets on the
  // other three tabs — the reserve withheld from every statement, and how the
  // money physically reaches them. The account page held neither.
  const [{ data: investor }, { data: userRow }] = await Promise.all([
    admin
      .from("investors")
      .select("legal_name, reserve_pct, payout_method")
      .eq("id", user.id)
      .single(),
    admin.from("users").select("market_id, markets(code, name, currency)").eq("id", user.id).single(),
  ]);

  const marketRel = userRow?.markets as
    | { code: string; name: string; currency: string }
    | { code: string; name: string; currency: string }[]
    | null
    | undefined;
  const market = Array.isArray(marketRel) ? marketRel[0] : marketRel;

  return (
    <AccountClient
      user={user}
      locale={params.locale}
      legalName={(investor?.legal_name as string) ?? ""}
      marketName={market?.name ?? null}
      currency={market?.currency ?? null}
      reservePct={investor?.reserve_pct != null ? Number(investor.reserve_pct) : null}
      payoutMethod={(investor?.payout_method as string) ?? null}
    />
  );
}
