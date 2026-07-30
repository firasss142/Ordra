import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canViewOwnPortfolio } from "@/lib/investor-permissions";
import { InvestorShell } from "@/components/investor/InvestorShell";

/**
 * Investor portal shell.
 *
 * A separate route group with its own chrome, following the (warehouse)
 * precedent — no Sidebar, no staff navigation, nothing that hints at the rest
 * of the OMS. Investors are external users and this is the only surface they
 * ever see.
 *
 * The guard is duplicated in middleware (which bounces any investor request
 * outside /investor and /profile) and again here, matching the house pattern of
 * checking in both the route and the page.
 */
export default async function InvestorLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const user = await getServerUser();

  if (!user) redirect(`/${params.locale}/login`);
  if (!canViewOwnPortfolio(user.role)) {
    // Staff who wander in go back to their own home rather than seeing a 403.
    redirect(`/${params.locale}/dashboard`);
  }

  return (
    <InvestorShell user={user} locale={params.locale}>
      {children}
    </InvestorShell>
  );
}
