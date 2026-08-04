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
    // The dashboard shell supplies no horizontal padding — every page adds its
    // own, and this one did not, so the panels sat flush against the sidebar
    // and the viewport edge. Matches the ad-spend page, the richest header in
    // the app.
    <div className="flex min-h-screen flex-col gap-5 bg-surface-page px-4 pb-16 pt-5 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 text-[20px] font-semibold tracking-[-0.01em] text-ink-primary">
            Investisseurs
          </h1>
          <p className="m-0 mt-1 text-[13px] text-ink-secondary">
            Capital, clôtures de période, retraits et corrections. Le grand livre est
            immuable — tout ici s&apos;écrit en avant.
          </p>
        </div>
      </header>

      <AdminInvestorsClient markets={markets ?? []} locale={params.locale} />
    </div>
  );
}
