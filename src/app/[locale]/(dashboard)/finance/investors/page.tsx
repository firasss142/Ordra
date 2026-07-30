import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/auth/server-user";
import { canManageInvestments } from "@/lib/investor-permissions";
import { AdminInvestorsClient } from "@/components/investor/AdminInvestorsClient";

export const dynamic = "force-dynamic";

/**
 * Admin surface for investor capital and settlements.
 *
 * super_admin only — this is where money movement is authorised, and
 * canManageInvestments() is enforced again in every route this page calls.
 */
export default async function AdminInvestorsPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();

  if (!user) redirect(`/${params.locale}/login`);
  if (user.role === "investor") redirect(`/${params.locale}/investor`);
  if (!canManageInvestments(user.role)) redirect(`/${params.locale}/dashboard`);

  const admin = createAdminClient();
  const { data: markets } = await admin
    .from("markets")
    .select("id, code, name")
    .eq("is_active", true)
    .order("code");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="m-0 text-[20px] font-semibold text-ink-primary">Investisseurs</h1>
      <AdminInvestorsClient markets={markets ?? []} locale={params.locale} />
    </div>
  );
}
