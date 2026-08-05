/**
 * Seed carrier_product_mappings for stock Darb Assabil holds in their own
 * warehouse (مخزن طرابلس) and fulfils on our behalf.
 *
 * WHY EXPLICIT: the mapping CANNOT be derived by name. Our Libya catalogue
 * carries two large-boxing-doll products — "دميه ملاكمه حجم كبير" (199) and
 * "دمية الملاكمة حجم كبير (179 دل)" (179) — while Darb has one at 199. A fuzzy
 * match would ship the wrong item, so every pair below is stated by hand and
 * cross-checked against the live carrier catalogue before insert.
 *
 * The carrier-side ids are read LIVE from Darb (never hardcoded), so a
 * re-created product on their side is picked up rather than silently stale.
 * Matching is by their `productName`; a pair whose price disagrees with the
 * live catalogue is REFUSED, not guessed.
 *
 * Idempotent: upserts on (carrier_id, product_id, product_variant_id).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/seed-darb-warehouse-products.ts
 *   npx tsx --env-file=.env.local scripts/seed-darb-warehouse-products.ts --apply
 */
import { createClient } from "@supabase/supabase-js";
import { buildConfig } from "../src/lib/carriers/dispatch";

const APPLY = process.argv.includes("--apply");
const CARRIER_CODE = "darb_assabil";
const CARRIER_NAME_MATCH = "Tripoli"; // the account holding the warehouse stock

/**
 * OMS product id  ->  the carrier's productName, plus the sale price we expect
 * to see on their side. The price is a guard, not data: a mismatch aborts.
 */
const PAIRS: { productId: string; carrierProductName: string; expectSalePrice: number }[] = [
  {
    productId: "7bfabff2-7f13-49b4-98df-b33db5ad235a", // Quran
    carrierProductName: "القران تدبر وعمل حجم كبير",
    expectSalePrice: 249,
  },
  {
    productId: "e907b151-0b2e-4b72-9d05-91e25621af4d", // كتاب الداء والدواء للإمام ابن القيم
    carrierProductName: "كتاب الداء والدواء ابن القيم",
    expectSalePrice: 179,
  },
  {
    productId: "24ef8174-5ce8-4843-b72a-e8ef2a73cd41", // دميه ملاكمه حجم صغير
    carrierProductName: " دميه ملاكمه حجم صغير",
    expectSalePrice: 129,
  },
  {
    productId: "6f347bea-d5e7-4356-b233-6f47091564a2", // دميه ملاكمه حجم متوسط
    carrierProductName: "دميه ملاكمه حجم متوسط",
    expectSalePrice: 179,
  },
  {
    productId: "19d40d38-bfbe-4607-93e7-ba849eaf73d3", // دميه ملاكمه حجم كبير
    carrierProductName: "دميه ملاكمه حجم كبير",
    expectSalePrice: 199,
  },
  // DELIBERATELY UNMAPPED: "دمية الملاكمة حجم كبير (179 دل)"
  // (70afbf75-be0c-4ae1-8595-2a9cb9f1da21). Its name says كبير but its price
  // (179) matches متوسط, so which carrier product it refers to is genuinely
  // ambiguous. Ask the business, then add it here — do not guess.
];

type CarrierWarehouseProduct = {
  _id: string;
  productName: string;
  salePrice: number;
  wholeSalePrice: number;
  currency: string;
  variants: { _id: string; sku: string }[];
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Supabase env missing");
  const db = createClient(url, key);

  const { data: carriers } = await db
    .from("carriers")
    .select(
      "id, name, code, api_endpoint, api_credentials, delivery_fee, return_fee, market_id"
    )
    .eq("code", CARRIER_CODE);

  const carrier = (carriers ?? []).find((c) =>
    (c.name as string).includes(CARRIER_NAME_MATCH)
  );
  if (!carrier) throw new Error(`Carrier ${CARRIER_CODE}/${CARRIER_NAME_MATCH} not found`);
  console.log(`Carrier: ${carrier.name} (${carrier.id})`);

  const config = buildConfig(carrier as never);
  const base = (config.apiEndpoint || "https://v2.sabil.ly").replace(/\/$/, "");
  const headers = {
    "Content-Type": "application/json",
    Authorization: `apikey ${config.apiCredentials.api_key}`,
    "X-API-VERSION": "1.0.0",
    "X-ACCOUNT-ID": config.apiCredentials.account_id,
  };

  // Live carrier catalogue + the warehouse each SKU actually sits in.
  const prodRes = await fetch(
    `${base}/api/warehouse/products?offset=0&limit=200&includeTotalCount=true`,
    { headers }
  );
  const prodBody = await prodRes.json();
  if (prodBody?.status !== true) throw new Error("Failed to read carrier products");
  const products: CarrierWarehouseProduct[] = prodBody.data.results ?? [];
  console.log(`Carrier catalogue: ${products.length} product(s)`);

  const stockRes = await fetch(
    `${base}/api/warehouse/products/stock/me?withLockedQuantities=true`,
    { headers }
  );
  const stockBody = await stockRes.json();
  const stock: { warehouse: string; product: string; variant: string }[] =
    stockBody?.status === true ? stockBody.data ?? [] : [];

  const rows: Record<string, unknown>[] = [];
  const problems: string[] = [];

  for (const pair of PAIRS) {
    const match = products.find(
      (p) => p.productName.trim() === pair.carrierProductName.trim()
    );
    if (!match) {
      problems.push(`No carrier product named "${pair.carrierProductName.trim()}"`);
      continue;
    }
    if (match.salePrice !== pair.expectSalePrice) {
      problems.push(
        `Price guard failed for "${match.productName.trim()}": expected ${pair.expectSalePrice}, carrier says ${match.salePrice}`
      );
      continue;
    }
    const variant = match.variants?.[0];
    if (!variant) {
      problems.push(`"${match.productName.trim()}" has no variant`);
      continue;
    }
    const stockRow = stock.find(
      (s) => s.product === match._id && s.variant === variant._id
    );
    if (!stockRow) {
      problems.push(`"${match.productName.trim()}" holds no stock at any warehouse`);
      continue;
    }

    rows.push({
      carrier_id: carrier.id,
      product_id: pair.productId,
      product_variant_id: null,
      external_product_id: match._id,
      external_variant_id: variant._id,
      external_sku: variant.sku ?? null,
      external_warehouse_id: stockRow.warehouse,
      external_sale_price: match.salePrice,
      is_active: true,
    });
    console.log(
      `  ✓ ${match.productName.trim()} → ${match._id} / ${variant._id} @ ${stockRow.warehouse}`
    );
  }

  if (problems.length) {
    console.error("\nProblems:");
    for (const p of problems) console.error(`  ✗ ${p}`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — ${rows.length} row(s) would be upserted. Re-run with --apply.`);
    return;
  }
  if (rows.length === 0) {
    console.log("\nNothing to insert.");
    return;
  }

  const { error } = await db
    .from("carrier_product_mappings")
    .upsert(rows, { onConflict: "carrier_id,product_id,product_variant_id" });
  if (error) throw error;
  console.log(`\nUpserted ${rows.length} mapping(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
