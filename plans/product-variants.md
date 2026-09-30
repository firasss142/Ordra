# Product variants — a real stock-bearing variant axis

## Context

Ordra has no way to create a product with variants. That gap was noticed as a
forward-looking risk; the investigation found it is already costing us.

**Variants are not absent — they are being faked.** The catalogue carries the
same boxing dummy as three separate products (صغير / متوسط / كبير, COGS 25 / 20 /
30, price 129 / 179 / 199), plus a fourth retired row for the *same* size at a
different price. `src/lib/carriers/carrier-warehouse.ts` already carries a
warning comment that carrier matching must never be by name, precisely because
"our catalogue carries two 'دميه ملاكمه حجم كبير' products at different prices".
The workaround has already drawn blood once.

Meanwhile three half-built variant mechanisms exist:

1. `product_variants` has existed since `001_initial_schema.sql`, means **pack
   tiers** (`label` + `quantity` + `units_per_pack` + `price_basis` +
   `display_price`), is read by the agent product sheet and `CreateOrderModal`,
   and has **fully working POST/PATCH routes that no UI calls**
   (`src/app/api/products/[id]/variants/`). Live rows: 2, both E2E fixtures.
2. `order_items.variant_id`, `orders.product_variant_id`,
   `storefront_product_mappings.product_variant_id` and
   `carrier_product_mappings.product_variant_id` all exist. In prod:
   **0 of 8 581 orders and 0 of 4 381 order_items carry a variant id.**
3. The storefronts genuinely send variants (`القرآن-تدبر-وعمل-حجم-كبير`,
   `أكمام…(white, 4 قطع ب 149 دل)`) and intake flattens them —
   `src/lib/storefronts/product-resolver.ts` **hard-codes
   `product_variant_id: null`** on its SKU and name paths, so only a hand-made
   mapping row could ever set it, and none of the 11 do.

**Outcome intended:** a variant that is a real stock-bearing, COGS-bearing,
SKU-bearing object, authored from the product screens, resolved from storefront
intake, and moved by the warehouse RPCs — without disturbing a single existing
order, ledger row or product.

### Decisions taken (do not re-litigate)

| Decision | Choice |
|---|---|
| Variant shape | **Two axes.** An *attribute* variant (Grand) holds stock. A *pack* tier (Pack 2) is a price + quantity multiplier on top of it. No option matrix. |
| Per-variant money | `unit_cogs` and selling price **only**. `floor_price`, `packing_cost`, `confirmation_processing_cost` stay on the product. |
| Variant SKU | Yes, unique per market, **sharing one uniqueness domain with `products.sku`**. |
| Stock grain | **True per-variant stock**, ventilated per warehouse. |
| Permissions | **super_admin only**, same lockdown as products. |
| Existing data | **Untouched.** No order, ledger or product row is rewritten. New model applies to new products. |
| Sequencing | Bugs first, then variants in phases. |

### The one architectural idea

Ordra already solved this exact shape once. `product_site_stock` added a
*warehouse* dimension **without touching the ~51 files that read
`products.current_stock`**: the product row stayed the roll-up total, a trigger
on `inventory_log` ventilated each movement into the finer row, and the
invariant was an inequality — `sum(parts) <= total` — so unallocated units
simply stay at the coarse level. Critically it is **inert until an entrepôt
counts a product** (`20260922000012_site_stock_from_ledger.sql`: "Pas de ligne =
ce produit n'a jamais été compté sur ce site").

The variant dimension follows that precedent exactly, and inherits the same
inertness for free: no product has attribute variants today, so every phase
below is a no-op in production until someone creates the first one.

Second lever: `order_stock_lines(p_order_id)` in
`supabase/migrations/20260924000001_scan_multi_line_stock.sql` is the single
chokepoint that resolves an order into stock movements. **Four of the seven
stock RPCs** (`scan_order_out`, `unscan_order`, `scan_return_in`,
`scan_received_in`) go through it. Teaching it `variant_id` covers all four in
one edit.

---

## Phase 0 — Four live bugs (ship alone, first)

These are independent of variants, are live today, and touch the same files
Phase 1+ will.

1. **`POST /api/products` never writes the `initial_stock` column.**
   `src/app/api/products/route.ts` puts the submitted value into `current_stock`
   only. **9 of 13 live products** have `initial_stock = 0` against real stock,
   so `product_inventory_view.real_inventory` (`initial_stock − delivered`) is
   negative for all of them. `src/app/api/products/list/route.test.ts` papers
   over it with `initial_stock: r.current_stock` — that line is the bug's
   fingerprint and must go.
   - Fix forward: include `initial_stock` in the inserted row.
   - **Backfill is only partial** — 7 products have an `initial_stock` ledger
     row, but 3 (incl. 600 units of دميه ملاكمه حجم كبير) have stock with no
     such row. See *Open decision* below.
2. **Phantom `log_id`.** `src/app/api/products/[id]/stock/route.ts` returns
   `log_entry: { id: row.log_id }`, but `adjust_product_stock` returns only
   `(new_stock, new_damaged)` — always `undefined`. Drop the field from the
   response.
3. **`manual_delete_orders` still restores stock single-product** from
   `orders.product_id/quantity`
   (`supabase/migrations/20260520181559_manual_delete_orders.sql`). It is the
   one RPC the 2026-09-10 multi-product fix missed, and `merge_orders` documents
   knowing it. Route it through `order_stock_lines()` like the other four.
4. **Untracked migration.** `variant_pack_pricing` (`20260624020018`, which added
   `units_per_pack` and `price_basis`) is applied in prod but has **no file** in
   `supabase/migrations/` — repo has 287, prod has this extra. Reconstruct the
   DDL from the live DB and commit it, or the next clean rebuild loses the
   columns the agent sheet reads.

Tests first for each (TDD is non-negotiable): route tests in
`src/app/api/products/route.test.ts` and
`src/app/api/products/[id]/stock/route.test.ts`; a SQL-level test for
`manual_delete_orders` against a multi-line order.

---

## Phase 1 — Variant schema (inert; nothing changes in prod)

One migration. `product_site_stock` has **0 rows** and `inventory_log` has
**130**, so every change below is cheap.

**Extend `product_variants`:**
- `kind TEXT NOT NULL DEFAULT 'pack' CHECK (kind IN ('attribute','pack'))` —
  the default keeps the two existing Biovera rows correct as pack tiers.
- `market_id UUID NOT NULL` — denormalised from the parent, trigger-maintained
  and immutable. Needed because a market-scoped unique index cannot reach
  through the FK.
- `sku TEXT NULL`, `unit_cogs NUMERIC(10,3) NOT NULL DEFAULT 0`,
  `current_stock INTEGER NOT NULL DEFAULT 0`,
  `damaged_return_count INTEGER NOT NULL DEFAULT 0`,
  `created_at` / `updated_at` (the table has never had them).
- `UNIQUE (market_id, sku) WHERE sku IS NOT NULL`, mirroring
  `idx_products_market_sku`.
- **Cross-table SKU guard:** a `BEFORE INSERT/UPDATE` trigger on *both*
  `products` and `product_variants` rejecting a SKU already used by the other
  table in the same market. Without it the resolver's single SKU lookup would
  silently prefer the product — the exact silent-wrong-match class
  `carrier-warehouse.ts` already warns about.
- Apply the **same column-level `REVOKE`** on `product_variants.unit_cogs` from
  `authenticated`/`anon` that `003_rls_fixes.sql` and
  `20260819000007_products_cogs_column_privileges.sql` apply to
  `products.unit_cogs`. A variant COGS is as sensitive as a product COGS.
- RLS: insert/update/delete **super_admin only**, copying
  `20260422_product_stock_lockdown.sql`.

**Add the variant dimension to the stock tables:**
- `inventory_log.variant_id UUID NULL REFERENCES product_variants(id)`.
  Append-only, nullable — no rewrite, no trigger conflict.
- `product_site_stock.variant_id UUID NULL`; drop the PK and replace with
  `UNIQUE NULLS NOT DISTINCT (product_id, variant_id, warehouse_id)`
  (PG 17.6 — confirmed available). `NULL` = the product's unvariant stock.

**Invariants, both inequalities, both deferred constraint triggers**, copying
`assert_site_stock_within_total()`:
- `sum(product_variants.current_stock) <= products.current_stock`
- `sum(site rows for a variant) <= that variant's current_stock`

Unallocated units stay at the coarser level rather than inventing a split —
identical to how site stock behaves today.

**Ledger trigger:** extend `inventory_log_apply_to_site()`
(`20260922000012_site_stock_from_ledger.sql`) to also apply `NEW.change` to
`product_variants.current_stock` when `NEW.variant_id IS NOT NULL`, keeping its
two existing early-returns (`warehouse_id IS NULL`, `reason = 'stock_count'`).

**Order line:** add `order_items.pack_variant_id UUID NULL`. `variant_id` means
the *attribute* variant (what moves stock); `pack_variant_id` records *which
offer* was sold, so "how many Pack 2s did we sell" stays answerable. Stock needs
no new column — a pack is already `order_items.quantity`.

Types to update: `src/types/product.ts`, `src/types/order-items.ts`,
`src/types/product-sheet.ts`.

---

## Phase 2 — Stock RPCs learn the variant

- **`order_stock_lines()`** → return `variant_id`, `GROUP BY oi.product_id,
  oi.variant_id`. Keep the market guard (`JOIN products … market_id`), the
  `ORDER BY` lock ordering, and the `is_primary` flag. This one edit carries
  `scan_order_out`, `unscan_order`, `scan_return_in`, `scan_received_in`.
- Those four: write `variant_id` onto their `inventory_log` rows and extend the
  pre-flight `FOR UPDATE` + `STOCK_UNDERFLOW` check to lock the variant row when
  present. Keep the all-or-nothing property — never a partial deduction.
- **`record_stock_count`** and **`adjust_product_stock`** gain
  `p_variant_id UUID DEFAULT NULL`. Default-null keeps every existing caller
  working unchanged.
- `get_stock_position` (`20260830000001_stock_position_rpc.sql`) —
  leave alone this phase; it reads `orders.product_id` and stays correct at
  product grain.

---

## Phase 3 — Intake resolves to a variant

- `src/lib/storefronts/product-resolver.ts`: add a **variant-SKU path** and stop
  hard-coding `product_variant_id: null` on the SKU and name paths. Keep the
  strongest-first ordering and the `mapped` / `needs_review` / `unmatched`
  semantics in `resolver-types.ts` untouched.
- `/mappings` (`src/app/api/mappings/products/route.ts`,
  `MappingsPageClient.tsx`) — allow binding an external variant to an Ordra
  variant. The column already exists and is already selected.
- **Adapters keep `items[0]` for now.** Every adapter
  (`shopify-adapter.ts:95`, `woocommerce-adapter.ts:85`,
  `lightfunnels-adapter.ts:119`, `easy-orders-adapter.ts:91`,
  `buybox-adapter.ts:95`) discards lines 2..n, and Buybox stringifies upsells
  into `customer_note`. That is a **separate, larger piece of work** — it needs
  the webhook to write `order_items`, which it has never done
  (`src/lib/orders/webhook-handler.ts:469-500` inserts into `orders` only).
  Flagged, deliberately out of scope here.

---

## Phase 4 — Authoring UI

The API already exists and works — it has simply never been called.

- Wire `POST`/`PATCH` `src/app/api/products/[id]/variants/` into
  `src/components/products/ProductEditForm.tsx` (today it exposes only a
  per-variant `agent_note` textarea at the variants section) and add a variant
  step to `src/components/products/ProductCreateForm.tsx` (sections today:
  `identity`, `costModel`, `inventory`).
- **Add the missing `DELETE` route** — it does not exist. Follow the
  rejection-reasons precedent (`docs/rejection-reasons.md`): hard-delete when no
  order references the variant, soft-retire otherwise, because history must stay
  readable.
- Per-variant stock and COGS columns on the product detail screen; keep
  `ProductSheetPacks.tsx` rendering pack tiers for the agent, now filtered to
  `kind = 'pack'`.
- Warehouse pick line already renders `variant_label`
  (`src/components/warehouse/run/RunParcel.tsx`); `src/lib/warehouse/order-lines.ts`
  selects `variant_label` but **not** `variant_id` — add it so the picker can
  key on identity rather than a text snapshot. Note `isMixed` in
  `src/lib/warehouse/scan-buckets.ts` deliberately treats two variants of one
  product as *not* mixed ("Two sizes of the same product is one rack") — revisit
  that only once real variants exist.
- i18n: `src/messages/fr.json` + `ar.json`, RTL-checked.
- UI follows `docs/design-system.md` (light admin surface), not the `design` skill.

---

## Open decision (needs your call during Phase 0)

**How to backfill `initial_stock` for the 9 broken products.** The ledger
recovers 7 of them; 3 have stock with no `initial_stock` row at all. Options:
(a) set `initial_stock = current_stock` for all 9 — an "opening balance = today"
reset that makes `real_inventory` meaningful from now on; (b) backfill the 7
from the ledger and leave 3 wrong; (c) retire `real_inventory` from
`product_inventory_view` entirely, since `record_stock_count` + `last_counted_at`
is now the real reconciliation mechanism. My recommendation is **(a)**, with a
note in the migration saying the opening balance was reset on this date.

---

## Verification

- `npm test` throughout — **test first, always** (TDD, per CLAUDE.md and
  `.claude/skills/test-driven-development/SKILL.md`).
- `npm run typecheck` after every file change; `npm run lint` before commit;
  `npm run build` at the end.
- **Phase 0:** re-run the `initial_stock` audit query — 0 products with
  `initial_stock = 0 AND current_stock > 0`. Delete an order with 3 product
  lines and assert 3 `inventory_log` rows, not 1.
- **Phase 1 inertness check:** after the migration, assert `products.current_stock`
  is byte-identical for all 13 products and `inventory_log` count is unchanged at
  130. Nothing may move until a variant exists.
- **Phase 2:** in a Supabase **branch** (never prod), create a product with 2
  attribute variants, place an order on each, scan out, and assert:
  variant stock fell, `products.current_stock` fell by the same total, the
  inequality invariants hold, and `unscan_order` returns exactly what the scan
  took. Then scan a multi-line order carrying **two variants of one product** —
  the case `order_stock_lines` already aggregates for.
- **RPC auth:** test every RPC **under a real JWT, not as owner** — the
  `search_path` and InitPlan traps in memory both bit here before.
- **Phase 3:** replay a Converty payload carrying a size slug through
  `/api/webhooks/[storefrontId]` against a branch and assert the order lands with
  a non-null `product_variant_id` and `mapping_status = 'mapped'`.
- **Phase 4:** `npm run dev`, log in as `admin@oms.local / testpass123`, create a
  product with sizes + pack tiers, verify the agent product sheet and
  `CreateOrderModal`, then check the Arabic/RTL rendering.
- Run the `rls-reviewer` and `i18n-reviewer` agents before each phase lands.

## Docs to update on completion

`docs/database-schema.md` (read from the live DB, not assumed),
`docs/warehouse-sites-and-statuses.md` (the stock-integrity model gains a third
level), `CLAUDE.md`'s stock-integrity section, and a new
`docs/product-variants.md` linked from `CLAUDE.md` per the progressive-disclosure
rule. Copy this plan to `plans/product-variants.md` as the source of truth.

---

# STATUS — Phase 0 complete (2026-09-20)

| Bug | State | Evidence |
|---|---|---|
| `initial_stock` never written | **Done, in prod** | 4 new tests; 9 products backfilled; 0 remain at `initial_stock = 0` with stock |
| Phantom `log_id` | **Done** | 2 new tests; response now carries the RPC's real `new_damaged` |
| `manual_delete_orders` single-product | **Done, in prod** | Bug reproduced then fixed on a throwaway branch; 5 scenarios verified |
| Untracked `variant_pack_pricing` migration | **Done** | Reconstructed from live DDL as `20260624000004_variant_pack_pricing.sql` |

Backfill outcome: 7 products restored from the append-only ledger, 2 (`دميه ملاكمه
حجم كبير` 600, `حجم متوسط` 200) reset to the day's count and recorded as such.
`inventory_log` stayed at 130 rows — no fake movement was invented.

`manual_delete_orders` branch verification, before → after:
- A×2 B×3 C×5 on one scanned order: old restored **A+1 only** (9 units lost);
  new restores A+2, B+3, C+5, one ledger row each with correct running balances.
- No `order_items` (legacy): falls back to the denormalised row, +7, one row.
- Same product on two lines (4+6): **one** movement of +10, not two stale balances.
- `confirmed` order: no stock restored.
- Product from the other market: refuses, order left `scanned`, zero writes.

**Open decision — RESOLVED.** Hybrid backfill chosen and applied.

---

# Findings that change later phases

## 1. `products.current_stock` is not a shelf count for anything pre-September

3 152 orders have crossed the stock boundary (`scanned` or beyond). Only **109**
ever produced a stock deduction, and all 109 are Libya, September 2026 — after
the warehouse rebuild of 2026-09-09. Tunisia (2 473 orders, Feb–Apr) never
scanned at all.

Biovera is the clearest case: its entire ledger is `initial_stock +1000` and
three `returned +1`, against **1 634 delivered orders**. Its `current_stock` of
1 003 is an opening balance plus three returns; the deliveries are invisible to
it. That is why its `real_inventory` stays negative after the backfill — the
view is correctly flagging a product that shipped more than it ever opened with.

This is historical, not an active leak. But **Phase 1's invariant
`sum(variants) <= products.current_stock` anchors on a number that is only
trustworthy where a physical count has happened.** That is exactly what
`record_stock_count` and `last_counted_at` are for, and why the site model stays
inert until an entrepôt counts. The variant model inherits the same discipline —
state it explicitly in the migration, and expect Libya to count before variant
stock carries real numbers.

Also worth noting: `real_inventory` is `initial_stock − count(delivered ORDERS)`.
It counts orders, not units, and assumes a product is never restocked. It will
mislead on any restocked product regardless of variants.

## 2. The repo's migrations cannot rebuild the database

A branch created from this project applied **70 of 305** migrations, stopping at
`20260427221920` (late April 2026), and came up with **29 tables against
production's 76**. `order_stock_lines`, `manual_delete_orders`, `scan_order_out`
and `product_site_stock` were all absent, so the branch had to be patched by
hand before it could test anything.

All 305 production migrations DO have their SQL stored, and the repo DOES
contain files for the ones after the cutoff — so the replay **errored and
stopped**, it did not run out of material. The first unreplayed migration is
`20260427221926 orders_keyset_index`, which does `CREATE EXTENSION IF NOT EXISTS
pg_trgm` followed by `gin_trgm_ops` indexes; its statements re-run cleanly by
hand on the branch, so the failure is environmental (extension privilege or
`search_path` during replay) rather than a bad statement.

**This blocks branch-based verification as a routine practice** and means there
is currently no disaster-recovery path from migrations alone. It deserves its own
piece of work before Phase 2, which changes seven stock RPCs and badly wants a
rebuildable test environment.

---

# STATUT — Phases 2, 3 et 4 livrées (2026-09-24)

## Ce qui a été fait

**Phase 2 — les RPC apprennent la variante.**
`supabase/migrations/20260924130000_variant_stock_rpcs.sql` réécrit
`order_stock_lines` (grain produit × variante d'attribut, une seule ligne
principale via `row_number()`), les quatre RPC de scan, `manual_delete_orders`,
`record_stock_count` et `adjust_product_stock` (`p_variant_id DEFAULT NULL`).
Quatre déclencheurs de contrainte différés portent les deux inégalités, armés
des DEUX côtés (`products` et `product_variants`).

**Phase 3 — l'intake résout la variante.**
`product-resolver.ts` gagne un chemin SKU de variante (`kind='attribute'`,
borné au marché) qui résout produit ET taille ; `productMatchStatus` le classe
`mapped`. `/api/mappings/products` vérifie désormais que la variante liée
appartient bien au produit. Les adaptateurs gardent `items[0]` — hors périmètre,
comme prévu.

**Phase 4 — l'écran d'édition.**
`ProductVariantsEditor.tsx` (nouveau) : les deux axes séparés visuellement,
CRUD complet, stock en lecture seule. `DELETE` créé de zéro (dur / doux /
refus si stock). `GET` et `POST`/`PATCH` étendus à `kind`, `sku`, `unit_cogs`.
i18n fr + ar.

**Tests SQL** — `supabase/tests/` n'existait pas ; 49 assertions couvrent ce
que Vitest ne peut pas atteindre.

## Ce que cela a coûté de découvrir

1. **La phase 1 avait cassé `record_stock_count` en production.** Remplacer la
   clé primaire `(produit, site)` par `(produit, variante, site)` a laissé le
   `ON CONFLICT (product_id, warehouse_id)` de la RPC sans index correspondant :
   tout comptage par site mourait en `42P10`. Invisible parce que
   `product_site_stock` est vide — une mine, pas un cratère. Prouvé par un
   `EXPLAIN` avant correction.

2. **Le sous-débit agrégé.** Passer au grain variante ouvre un trou : deux
   lignes de 3 sur un produit qui n'a que 5 unités passent chacune leur propre
   test. Garde produit sur la SOMME, garde variante ligne par ligne.

3. **La règle du « non ventilé ».** Un test écrit naïvement (« un palier déduit
   au produit ») a fait exploser l'invariant au COMMIT : le produit était
   ventilé à 100 %. L'invariant avait raison — vendre sans nommer de taille
   suppose qu'il reste des unités non attribuées. La règle est désormais
   contrôlée à l'entrée du scan plutôt que constatée à la validation.

4. **`DROP FUNCTION` + `CREATE` remet les privilèges à zéro ; `CREATE OR
   REPLACE` les conserve.** Vérifié, pas supposé — la note mémoire disait
   l'inverse. Trois fonctions changeaient de signature ici : sans le REVOKE
   explicite, cette migration rouvrait à elle seule le trou anon refermé la
   veille, sur le lecteur du contenu de n'importe quelle commande.

5. **La fiche agent aurait affiché les tailles comme des offres.** La section
   « paliers » ne filtrait pas sur `kind` : créer une taille l'aurait fait
   apparaître à l'agent comme une quantité à proposer, en pleine conversation.

## Deux failles trouvées en auditant, corrigées avec le lot

6. **L'acteur n'était pas lié à la session** dans `scan_return_in` et
   `scan_received_in`. Ces fonctions décident du marché en lisant `users` par
   `p_actor_id` ; sans contrôle, un agent d'entrepôt libyen passant l'id du
   super_admin tunisien clôturait un retour tunisien. `20260909132021`
   annonçait que la correction viendrait dans « 20260922000012 » — migration
   qui n'a jamais existé. Reproduit sous un vrai JWT avant correction
   (`supabase/tests/stock_actor_and_rls_test.sql`).

7. **Un `market_manager` pouvait supprimer une variante** en appelant
   PostgREST directement : `product_variants_delete_sa_mm` datait du schéma
   initial et le verrouillage du stock de 20260427221856 avait oublié DELETE.
   Trois des quatre références sont `ON DELETE SET NULL`, donc l'historique
   perdait le lien en silence. Prouvé par exécution sous le rôle
   `authenticated`, pas seulement par lecture de la politique.

## Reste ouvert

- Adaptateurs boutique : `items[0]` (le webhook n'écrit pas `order_items`).
- `ProductCreateForm` n'a pas d'étape variantes — on crée puis on édite.
- `order-lines.ts` lit `variant_label` mais pas `variant_id`.
- `isMixed` traite encore deux tailles d'un produit comme non mixtes.
- ~~`product_variants.unit_cogs` lisible par l'agent~~ — **fermé le
  2026-09-25.** Le mécanisme était bien celui décrit — les GRANT Postgres sont
  par rôle *Postgres* (`authenticated`), que l'agent partage avec le
  super_admin, donc la frontière ne peut pas vivre en base : révoquer
  casserait la fiche produit pour tout le monde. Mais la portée était bien plus
  petite qu'annoncé. Vérifié route par route : **une seule** était atteignable
  par un agent et renvoyait un coût, `GET /api/products/[id]/variants`, ajoutée
  la veille par ce même lot. `/api/products` avait déjà sa liste
  `AGENT_COLUMNS` ; `/api/products/[id]`, `/products/[id]/profitability`,
  `/products/list/previous` et `/ad-spend/economics` refusent tous l'agent
  avant d'arriver à une colonne de coût. La route sert désormais deux listes
  selon le rôle — il n'y avait pas de chantier « remplacer chaque
  `select("*")` », juste une ligne écrite trop large.
  Reste vrai et non traité : `products.unit_cogs` est accordé à
  `authenticated` en base, ce qui n'expose rien tant qu'aucune route
  atteignable par un agent ne le sélectionne.
- Un `ON DELETE RESTRICT` sur `order_items.variant_id`,
  `orders.product_variant_id` et
  `storefront_product_mappings.product_variant_id` serait la ceinture du
  contrôle de références de la route DELETE. Non posé : changer le
  comportement de suppression d'`orders` dépasse le périmètre.
- Linter Supabase : 131 `authenticated_security_definer_function_executable`,
  4 vues `SECURITY DEFINER`, 1 table sans RLS (`_darb_tracking_backfill_backup`),
  ~75 `function_search_path_mutable` (deux de moins qu'avant : `record_stock_count`
  et `adjust_product_stock` sont désormais épinglées).
