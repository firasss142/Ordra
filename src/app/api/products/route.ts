import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canViewProducts, canManageProducts } from "@/lib/product-permissions";
import { isValidProduct } from "@/types/product";
import { getActor } from "@/lib/auth/actor";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;
  const actorMarketId = actor.market_id ?? "";

  // Determine which market to query
  let targetMarketId: string | null = null;
  if (role === "super_admin") {
    const qp = req.nextUrl.searchParams.get("market_id");
    targetMarketId = qp || null; // null = all markets
  } else {
    targetMarketId = actorMarketId;
  }

  // Agents are scoped to their own market (read-only — used for order creation picker)
  if (role === "agent" && !actorMarketId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // market_manager with no market_id is a data integrity error — deny access
  if (role === "market_manager" && !targetMarketId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Permission check (agents bypass canViewProducts — scoped to own market above)
  if (role !== "agent" && targetMarketId && !canViewProducts(role, targetMarketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Agents only need basic fields — serve from products table
  // Managers/admins get system_inventory + real_inventory from the view
  const useView = role !== "agent";

  const rawPage = req.nextUrl.searchParams.get("page");
  const paginate = rawPage !== null;
  const pageParam = Number(rawPage ?? "1");
  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? "50");
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;
  const limit = Math.max(
    1,
    Math.min(200, Number.isFinite(limitParam) ? limitParam : 50),
  );

  const countOpts = paginate ? { count: "exact" as const } : undefined;

  // Explicit column list, never "*". A missing column under "*" arrives as an
  // absent key with no error — that is exactly how unit_cogs, packing_cost and
  // is_active went undetected long enough to render "NaN LYD", paint every
  // health dot red, and make the row toggle unable to deactivate anything.
  // Naming the columns turns a view/route drift into a PostgREST error.
  // Widened by 20260824000001_product_inventory_view_full_columns.sql.
  const VIEW_COLUMNS = [
    "id",
    "market_id",
    "name",
    "sku",
    "image_url",
    "unit_cogs",
    "packing_cost",
    "confirmation_processing_cost",
    "default_price",
    "initial_stock",
    "current_stock",
    "system_inventory",
    "real_inventory",
    "low_stock_threshold",
    "damaged_return_count",
    "is_active",
  ].join(", ");

  // Agents never receive COST columns — what a product costs us is none of
  // their business. `default_price` is not a cost: it is what the customer
  // pays, and the agent types it into every order they confirm.
  //
  // It was missing here until 2026-09-15, so ConvertLeadModal prefilled 0 for
  // agents and four Tunisian orders were confirmed at 0.000 on 2026-05-05.
  // Revenue is orders.total_price only, so those four never appeared in a P&L.
  const AGENT_COLUMNS =
    "id, name, image_url, default_price, current_stock, is_active, market_id";

  let query = useView
    ? supabase
        .from("product_inventory_view")
        .select(`${VIEW_COLUMNS}, product_variants(count)`, countOpts)
        .order("name", { ascending: true })
    : supabase
        .from("products")
        .select(`${AGENT_COLUMNS}, product_variants(count)`, countOpts)
        // La branche agent lit la table de base : le filtre d'archive de
        // product_inventory_view ne la couvre pas. Sans ceci, un produit archivé
        // resterait visible dans la file de confirmation.
        .is("deleted_at", null)
        .order("name", { ascending: true });

  if (paginate) {
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);
  }

  if (targetMarketId) {
    query = query.eq("market_id", targetMarketId);
  }

  // NewLeadModal and ConvertLeadModal have always sent &is_active=true; the
  // route never read it, so both pickers listed deactivated products.
  const rawActive = req.nextUrl.searchParams.get("is_active");
  if (rawActive === "true" || rawActive === "false") {
    query = query.eq("is_active", rawActive === "true");
  }

  // Server-side name search — filters the WHOLE catalog, not the current page.
  const rawQ = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (rawQ) {
    const escaped = rawQ.replace(/[%_]/g, (m) => `\\${m}`);
    query = query.ilike("name", `%${escaped}%`);
  }

  const { data, error, count } = await query;

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  // PostgREST's inferred row type for an embedded aggregate does not survive a
  // template-literal select string, so the rows are widened once here.
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const products = rows.map((p) => {
    const { product_variants, ...rest } = p;
    const variants = product_variants as { count: number }[] | undefined;
    return {
      ...rest,
      image_url: (rest.image_url as string | null) ?? null,
      variant_count: variants?.[0]?.count ?? 0,
    };
  });

  if (!paginate) {
    return NextResponse.json({ data: products });
  }

  const total = count ?? products.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return NextResponse.json({
    data: products,
    pagination: { total, page, limit, totalPages },
  });
}

async function handlePOST(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;
  const actorMarketId = actor.market_id ?? "";

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Determine market_id: market_manager uses their own, super_admin can specify
  const marketId = role === "super_admin" ? (body.market_id as string) : actorMarketId;
  if (!marketId) {
    return NextResponse.json({ error: "market_id is required" }, { status: 400 });
  }

  if (!canManageProducts(role, marketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  /*
   * A product can be born with its sizes.
   *
   * Creating the product and then going back to edit it is how the catalogue
   * ended up carrying one boxing dummy as three separate products: nobody takes
   * the second step. Orchestrating from the browser (1 + N + M requests) would
   * just move the problem — a product created, two variants of three, and no
   * way to know where it stopped. The server runs the sequence.
   */
  type VariantInput = {
    label: string;
    sku: string | null;
    unit_cogs: number;
    display_price: number;
    initial_stock: number;
  };

  const rawVariants = Array.isArray(body.variants) ? body.variants : [];
  const variants: VariantInput[] = [];
  for (const raw of rawVariants) {
    if (typeof raw !== "object" || raw === null) {
      return NextResponse.json({ error: "Invalid variant" }, { status: 400 });
    }
    const v = raw as Record<string, unknown>;
    const label = typeof v.label === "string" ? v.label.trim() : "";
    if (label === "") {
      return NextResponse.json(
        { error: "Chaque variante doit porter un nom" },
        { status: 400 },
      );
    }
    const price = typeof v.display_price === "number" ? v.display_price : 0;
    if (!(price > 0)) {
      return NextResponse.json(
        { error: `La variante « ${label} » doit avoir un prix de vente` },
        { status: 400 },
      );
    }
    const cogs = typeof v.unit_cogs === "number" && v.unit_cogs >= 0 ? v.unit_cogs : 0;
    const stock =
      typeof v.initial_stock === "number" && v.initial_stock >= 0
        ? Math.trunc(v.initial_stock)
        : 0;
    variants.push({
      label,
      sku: typeof v.sku === "string" && v.sku.trim() !== "" ? v.sku.trim() : null,
      unit_cogs: cogs,
      display_price: price,
      initial_stock: stock,
    });
  }
  const hasVariants = variants.length > 0;

  /*
   * When the product varies, cost / price / SKU / stock belong to the VARIANTS.
   * Leaving them on the product too would create two truths — and the product
   * is what finance reads when no variant is named, so the wrong one would win.
   * The product keeps only what does not vary: packing, processing, floor price,
   * low-stock threshold.
   */
  const variantStockTotal = variants.reduce((sum, v) => sum + v.initial_stock, 0);
  const initialStock = hasVariants
    ? variantStockTotal
    : typeof body.initial_stock === "number"
      ? body.initial_stock
      : 0;

  const defaultPrice = hasVariants
    ? null
    : typeof body.default_price === "number" && body.default_price >= 0
      ? body.default_price
      : null;

  const sku =
    !hasVariants && typeof body.sku === "string" && body.sku.trim() !== ""
      ? body.sku.trim()
      : null;

  const productRow = {
    name: body.name,
    sku,
    unit_cogs: hasVariants ? 0 : body.unit_cogs,
    packing_cost: body.packing_cost,
    market_id: marketId,
    confirmation_processing_cost:
      typeof body.confirmation_processing_cost === "number"
        ? body.confirmation_processing_cost
        : 0,
    default_price: defaultPrice,
    low_stock_threshold:
      typeof body.low_stock_threshold === "number" ? body.low_stock_threshold : 0,
    // Two different facts, not one. `initial_stock` is the opening balance and
    // never moves again; `current_stock` is the running figure. They are equal
    // only at this instant. Writing the quantity to `current_stock` alone left
    // every product at `initial_stock = 0`, which made
    // `product_inventory_view.real_inventory` (initial − delivered) negative.
    initial_stock: initialStock,
    current_stock: initialStock,
    damaged_return_count: 0,
    is_active: true,
  };

  if (!isValidProduct(productRow)) {
    return NextResponse.json({ error: "Invalid product data" }, { status: 400 });
  }

  const { data: product, error: insertError } = await supabase
    .from("products")
    .insert(productRow)
    .select()
    .single();

  if (insertError) {
    if ((insertError as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "SKU already in use" }, { status: 409 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  /*
   * The variants, then their opening balances.
   *
   * Order matters. The product row is already born carrying the FULL total, so
   * `sum(variants) <= products.current_stock` holds at every step: the variants
   * start at zero and climb to it. Creating them first and raising the product
   * afterwards would break that inequality at COMMIT.
   *
   * No RPC here: each ledger row names its variant, and the trigger from
   * 20260920162309 is what moves `product_variants.current_stock`. Doing the
   * arithmetic here as well would count everything twice.
   */
  if (hasVariants) {
    let created = 0;
    let running = 0;
    for (const v of variants) {
      const { data: variantRow, error: variantError } = await supabase
        .from("product_variants")
        .insert({
          product_id: product.id,
          kind: "attribute",
          label: v.label,
          sku: v.sku,
          unit_cogs: v.unit_cogs,
          display_price: v.display_price,
          quantity: 1,
          is_active: true,
        })
        .select("id")
        .single();

      if (variantError || !variantRow) {
        /*
         * The product already exists and there is no transaction spanning these
         * calls, so it cannot be cleanly undone. Say so — 207, with what was
         * created — instead of answering 201 on a half-built product and
         * leaving the author to discover the gap later.
         */
        const code = (variantError as { code?: string } | null)?.code;
        return NextResponse.json(
          {
            data: product,
            variants_created: created,
            error:
              code === "23505"
                ? `Le SKU de la variante « ${v.label} » est déjà utilisé`
                : `La variante « ${v.label} » n'a pas pu être créée`,
          },
          { status: 207 },
        );
      }

      created += 1;
      if (v.initial_stock > 0) {
        running += v.initial_stock;
        // `balance_after` stays the product's MARKET total, running — the same
        // grandeur a simple product's opening row records.
        const { error: logError } = await supabase.from("inventory_log").insert({
          product_id: product.id,
          variant_id: variantRow.id,
          order_id: null,
          change: v.initial_stock,
          balance_after: running,
          reason: "initial_stock",
          note: null,
          actor_id: actor.id,
        });
        if (logError) {
          return NextResponse.json(
            {
              data: product,
              variants_created: created,
              error: `Le stock initial de « ${v.label} » n'a pas été enregistré`,
            },
            { status: 207 },
          );
        }
      }
    }

    return NextResponse.json(
      { data: product, variants_created: created },
      { status: 201 },
    );
  }

  // If initial_stock > 0, create inventory log entry
  if (initialStock > 0) {
    const { error: logError } = await supabase.from("inventory_log").insert({
      product_id: product.id,
      order_id: null,
      change: initialStock,
      balance_after: initialStock,
      reason: "initial_stock",
      note: null,
      actor_id: actor.id,
    });

    if (logError) return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: product }, { status: 201 });
}

export const GET = withRouteErrors("/api/products", "GET", handleGET);
export const POST = withRouteErrors("/api/products", "POST", handlePOST);
