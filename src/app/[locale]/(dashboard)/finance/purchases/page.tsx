import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { listMarketsFor, getDefaultMarketId } from "@/lib/markets/list";
import { PurchasesClient } from "@/components/finance/purchases/PurchasesClient";

export const dynamic = "force-dynamic";

/**
 * Finances › Achats — plans/reception-v4-quai-et-bureau.md, étape 1.
 *
 * L'écran qui manquait : `reception_payments` existe depuis le 30 septembre et
 * n'était lu par rien dans Finances, donc « combien je dois à ce fournisseur »
 * était inrépondable. Il ne touche à aucun stock.
 */
export default async function PurchasesPage({ params }: { params: { locale: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (!canViewFinanceSection(user.role)) redirect(`/${params.locale}/dashboard`);

  const markets = await listMarketsFor(user.role, user.market_id);
  const initialMarketId =
    user.role === "super_admin" ? getDefaultMarketId(markets) : (user.market_id ?? "");

  return (
    <PurchasesClient locale={params.locale} markets={markets} initialMarketId={initialMarketId} />
  );
}
