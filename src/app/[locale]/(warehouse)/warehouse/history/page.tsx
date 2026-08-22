import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canScanWarehouse } from "@/lib/role-permissions";
import { JournalConsole } from "@/components/warehouse/console/JournalConsole";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await getServerUser();
  if (!user) redirect(`/${locale}/login`);
  if (!canScanWarehouse(user.role)) redirect(`/${locale}/queue`);

  // The ledger paginates and filters server-side, so the console owns its own
  // fetching: a filter must query the whole ledger, not just the loaded page.
  return <JournalConsole locale={locale} />;
}
