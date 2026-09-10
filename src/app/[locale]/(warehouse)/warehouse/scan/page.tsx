import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canScanWarehouse } from "@/lib/role-permissions";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { createClient } from "@/lib/supabase/server";
import { getZoneIndex } from "@/lib/warehouse/zone-index-cache";
import { zoneForOrder } from "@/lib/warehouse/zone-index";
import { attachProductImages } from "@/lib/warehouse/product-images";
import { attachOrderLines } from "@/lib/warehouse/order-lines";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import { ScanRun } from "@/components/warehouse/run/ScanRun";

/**
 * La tournée de scan.
 *
 * Cette route était une redirection vers le banc : le « mode scan » historique
 * était un troisième rendu de la même file, et le bouton du bureau renvoyait
 * donc à la page qu'on venait de quitter. Elle porte maintenant la tournée —
 * une décision (un produit, ou une couleur), puis les colis à la suite.
 *
 * Même écran pour l'agent, le manager et le super_admin : c'est le même geste
 * physique, et deux implémentations finiraient par diverger sur ce que « lié »
 * veut dire.
 */

const RUN_PAGE_LIMIT = 200;

export const dynamic = "force-dynamic";

export default async function ScanRunPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await getServerUser();
  if (!user) redirect(`/${locale}/login`);
  if (!canScanWarehouse(user.role)) redirect(`/${locale}/queue`);

  const { marketId: scope, marketCode } = await getActiveMarketScope(user);
  const market: "ly" | "tn" = marketCode === "ly" ? "ly" : "tn";
  const supabase = await createClient();
  const site = await resolveSiteFilter(supabase, { actor: user, requested: null });

  /*
   * Sans bâtiment, pas de tournée : l'agent verrait les colis des deux
   * entrepôts et chaque scan serait refusé par la garde SQL. L'écran nomme la
   * raison au lieu d'ouvrir une caméra qui ne peut rien lier.
   */
  if (site.unassigned) {
    return (
      <ScanRun
        market={market}
        locale={locale}
        currency={market === "ly" ? "LYD" : "TND"}
        initialOrders={[]}
        siteUnassigned
      />
    );
  }

  const [{ data }, zoneIndex, siteName] = await Promise.all([
    supabase.rpc("get_to_label_orders", {
      p_market_id: scope,
      p_limit: RUN_PAGE_LIMIT,
      p_cursor_created_at: null,
      p_cursor_id: null,
      p_warehouse_id: site.warehouseId,
    }),
    getZoneIndex(supabase),
    // Le nom peint sur le mur, dans la langue du marché — jamais traduit par clé.
    site.warehouseId
      ? supabase
          .from("warehouses")
          .select("name_fr, name_ar")
          .eq("id", site.warehouseId)
          .maybeSingle<{ name_fr: string; name_ar: string }>()
          .then((r) => (marketCode === "ly" ? r.data?.name_ar : r.data?.name_fr) ?? null)
      : Promise.resolve(null),
  ]);

  const pictured = await attachProductImages(supabase, (data ?? []) as unknown as WarehouseOrderRow[]);
  // Toutes les lignes du colis : un colis à trois produits doit se présenter
  // comme tel avant que l'agent ne colle quoi que ce soit.
  const lined = await attachOrderLines(supabase, pictured);
  const orders = lined.map((row) => ({ ...row, zone: zoneForOrder(row, zoneIndex) }));

  return (
    <ScanRun
      market={market}
      locale={locale}
      currency={market === "ly" ? "LYD" : "TND"}
      initialOrders={orders}
      siteName={siteName}
    />
  );
}
