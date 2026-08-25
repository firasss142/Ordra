import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canViewOwnPortfolio } from "@/lib/investor-permissions";
import { ActivityClient } from "@/components/investor/ActivityClient";

export const dynamic = "force-dynamic";

export default async function InvestorActivityPage({ params }: { params: { locale: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (!canViewOwnPortfolio(user.role)) redirect(`/${params.locale}/dashboard`);
  return <ActivityClient locale={params.locale} />;
}
