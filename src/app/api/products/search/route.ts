import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const requested = req.nextUrl.searchParams.get("market_id");

  let marketId: string;
  if (actor.role === "super_admin") {
    marketId = requested ?? actor.market_id ?? "";
  } else {
    if (requested && requested !== actor.market_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    marketId = actor.market_id ?? "";
  }

  if (!marketId) {
    return NextResponse.json({ data: [] });
  }

  const q = req.nextUrl.searchParams.get("q");

  let query = supabase
    .from("products")
    .select(
      // `kind` sépare la TAILLE (qui porte le stock) du PALIER (un conditionnement
      // de vente, pas un objet sur une étagère), et `current_stock` donne à chaque
      // taille le chiffre qui dit s'il en manque. Les deux colonnes sont accordées
      // à `authenticated` en production — vérifié avant de les demander, parce que
      // les privilèges de `product_variants` sont colonne par colonne.
      "id, market_id, name, sku, default_price, current_stock, is_active, image_url, product_variants(id, label, kind, current_stock, is_active)",
    )
    .eq("market_id", marketId)
    .eq("is_active", true)
    // Redondant avec is_active tant qu'on n'archive que du désactivé, mais on ne
    // fait pas reposer l'exclusion d'un produit archivé sur un invariant tenu
    // ailleurs : la RPC pourrait changer, ce filtre non.
    .is("deleted_at", null);

  if (q) {
    /*
     * LA RÉFÉRENCE EST CHERCHABLE, PARCE QU'ELLE EST AFFICHÉE.
     *
     * Le sélecteur de réception écrit « hm-01 » sous chaque produit, donc taper
     * « hm-01 » est le geste naturel. Tant que la requête ne regardait que le
     * NOM, ce geste ne renvoyait rien : montrer un identifiant qu'on ne peut pas
     * chercher est un piège qu'on se tend à soi-même.
     *
     * La virgule et les parenthèses sont la SYNTAXE de `.or()` : une virgule
     * dans la saisie y ajouterait une condition et ferait remonter des lignes
     * qu'on n'a pas demandées. On les retire plutôt que de les échapper —
     * aucune référence produit n'en contient, et un filtre silencieusement
     * élargi est plus dangereux qu'une recherche qui ne trouve rien.
     */
    const safe = q.replace(/[(),]/g, " ").trim();
    if (safe) {
      query = query.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%`);
    }
  }

  const { data, error } = await query.order("name");

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  const normalized = (data ?? []).map(({ default_price, ...rest }) => ({
    ...rest,
    unit_price: default_price ?? 0,
  }));

  return NextResponse.json(
    { data: normalized },
    {
      headers: {
        "Cache-Control": "private, max-age=60, stale-while-revalidate=600",
      },
    },
  );
}

export const GET = withRouteErrors("/api/products/search", "GET", handleGET);
