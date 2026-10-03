# Ordra — Order Management System

**The product is called Ordra.** "OMS" is the generic descriptor (order management
system), not a name — it survives in code identifiers, paths and older plans, and that
is fine, but new prose says Ordra.

## WHY
Internal order management for multi-market COD e-commerce (Tunisia + Libya).
Webhook intake → agent phone confirmation → carrier dispatch → performance tracking.
Two fully isolated markets under one system. Desktop-first.

## WHAT
- Next.js 14 App Router + TypeScript + Tailwind
- Supabase (database + auth + RLS + Realtime)
- Vitest + Testing Library (TDD — test first, always)
- SWR for client-side data fetching (instant navigation)
- Deployed on Vercel
- Two markets: Tunisia (French, LTR) + Libya (Arabic, RTL)
- Five roles: super_admin (cross-market), market_manager (own market), agent (own queue), warehouse_agent, investor (external; own portal only)

## Stack layout
There are FOUR route groups — (auth), (dashboard), (warehouse), (investor).
**There is no `(agent)` group.** The agent shell is a ROLE BRANCH inside (dashboard):
`(dashboard)/layout.tsx` returns `<AgentDashboardShell>` when `user.role === "agent"`,
and the agent's pages are `(dashboard)/queue`, `/leads`, `/follow-ups`, `/commissions`
reached through `components/layout/AgentNavTabs.tsx`.

src/
  app/[locale]/(auth)/       → login
  app/[locale]/(dashboard)/  → manager + super_admin views, AND the agent shell by role
  app/[locale]/(warehouse)/  → entrepôt: bench, scan, dispatch, returns, stock, history
  app/[locale]/(investor)/   → investor portal (mobile-first PWA, no staff chrome)
  app/api/                   → ~237 route handlers; app/api/webhooks/ = storefront intake
  components/ui/             → Button, Input, Card, Badge, Modal, Toast
  components/layout/         → Sidebar, Topbar, NavItem, AgentNavTabs, shells
  lib/supabase/              → browser + server clients
  lib/calculations/          → financial logic (SERVER-SIDE ONLY — never client)
  lib/investors/             → investor v2 engine — see docs/investor-domain.md
  lib/carriers/              → CarrierAdapter interface + implementations (largest dir)
  lib/storefronts/           → StorefrontAdapter interface + implementations
  lib/leads/                 → CRM prospect pipeline (Clients → Prospects)
  lib/ad-spend/ lib/meta-ads/→ ad spend + Meta sync; break-even.ts holds the money math
  lib/team/ lib/commissions/ → control room, performance, agent commissions
  types/                     → TypeScript types + order status definitions
  hooks/                     → ~80 SWR data hooks (flat)
  messages/                  → i18n translations (fr.json, ar.json)
  test/                      → test setup + shared helpers (NOT production code)

## Commands
- npm run dev — local dev server
- npm test — run tests (TDD: run constantly)
- supabase/tests/run.sh — SQL tests (stock invariants, RPC grants) against the LOCAL db only
- npm run test:run — single test pass
- npm run typecheck — after every file change
- npm run lint — before every commit
- npm run build — verify production build

## TDD — NON-NEGOTIABLE
- Read .claude/skills/test-driven-development/SKILL.md
- Write failing test FIRST → watch it fail → minimal code to pass → refactor
- No production code without a failing test
- Test utilities in src/test/helpers/ — NEVER add test-only methods to production code
- Read .claude/skills/test-driven-development/testing-anti-patterns.md before adding mocks

## Critical rules
- **UI/UX & Design**: `docs/design-system.md` governs ALL product UI — Shopify-inspired
  dark sidebar (#0E1013), light content (#F6F6F7), brand green (#15803D) for chrome,
  functional colour only on status. The `.claude/skills/design` skill is for MARKETING
  surfaces only (dark, cinematic) and must never be applied under `src/`.
- Market isolation enforced via RLS at data layer — never rely on UI filtering alone
- Save every Claude-created plan under `/plans`
- Revenue = orders.total_price ONLY — never other price fields
- All cost variables from DB settings table — NEVER hardcode fees or rates
- Financial calculations → lib/calculations/ server-side only — never in client components
- APPEND-ONLY, enforced by DB trigger — never update or delete: `order_history`,
  `inventory_log`, `agent_commission_ledger`, `delivery_actions`. Correct a row by
  appending its reversal. (Also immutable, different shape: `investor_deal_statements`,
  `investor_ledger_entries`, and `investor_deal_terms` which is insert-only — terms are
  amended by adding an effective-dated row.)
- Libya has TWO PHYSICAL WAREHOUSES (Tripoli, Benghazi), one per Darb account; orders.warehouse_id follows carrier_id by trigger
- A Darb bind is verified by re-reading the shipment: HTTP success is not proof the sticker stuck
- A warehouse_agent with no `warehouse_id` sees NOTHING and can scan nothing — unassigned must never mean unrestricted; assign via Utilisateurs before their first shift
- Confirm is atomic and never depends on the carrier API — confirm puts the order in `confirmed`, the carrier upload happens in a separate "upload" action that lands on `uploaded` (or stays `confirmed` on any failure)
- Carrier upload is synchronous — immediate success/failure feedback to agent
- Adapter pattern for storefronts and carriers — new integrations = new adapter, zero core changes
- **Storefront intake keeps EVERY line since 2026-09-25.** Adapters fill `lines[]`;
  `orders` still carries the FIRST line denormalised (~50 readers) and `order_items`
  carries them all. Each line resolves its own product/variant, and `mapping_status` is
  the WORST of all lines — one unrecognised line must reach the review queue. `lines` is
  optional: a single-line source omits it and the old path applies unchanged.
- Supabase service role → server only (webhooks, admin user creation) — never in browser client
- A `settings.value` is bare (`30`) OR wrapped (`{"value": 30}`). SQL reads a scalar through `public.setting_scalar(value)`, never `(value #>> '{}')::int`; that cast stopped nightly archiving for six weeks. See docs/reglages.md

## OMS status model — two phases

Assignment is ownership (`orders.assigned_to`), not a lifecycle status.
A new order is `pending` whether assigned or not.

### Phase 1: Confirmation (agent workflow)
pending → attempt_1/2/3 → callback_scheduled → confirmed → uploaded → scanned (exits agent's hands)
                                                         → rejected (TERMINAL)
                                                         → dispatch_scheduled → uploaded (cron auto, never reverts to confirmed)
cancelled (TERMINAL — manager/system, any pre-dispatch status)

### Phase 2: Fulfillment (carrier lifecycle, post-scan)
Libya (Darb Assabil) — the carrier's own vocabulary, since 2026-09-09:
scanned → at_carrier → in_transit → out_for_delivery ⇄ delivery_delayed → delivered (TERMINAL)
                                  → returning → to_be_returned → returned (TERMINAL)
                                                              → received → confirmed (re-sent)
Tunisia keeps: scanned → dispatched → deposit → in_transit → delivered | returned
A status is never walked backwards (order_status_rank). See docs/warehouse-sites-and-statuses.md.

## Key boundaries
- confirmed = phone confirmation outcome only; no carrier work yet (still in agent queue, awaiting upload)
- uploaded = carrier API succeeded; `tracking_number` + `carrier_id` set; ready to print + scan
- scanned = STOCK BOUNDARY: warehouse scan-out deducts stock −qty (uploaded → scanned)
- dispatched = carrier acknowledged receipt; order enters in-flight tracking pool
- deposit = COST BOUNDARY: carrier fees begin here (stock already deducted at scanned)
- delivered = revenue realized
- returned = stock +qty (unless damaged, which increments damaged_return_count)

On upload failure (carrier API error, timeout, validation reject) the order stays `confirmed` (or `dispatch_scheduled` for cron-driven uploads). Never rolled back further. Retry is just a retry.

## Stock integrity model
THREE LEVELS since 2026-09-20. `products.current_stock` is the MARKET total (what finance
reads); `product_variants.current_stock` holds one attribute variant's share of it; and
`product_site_stock` ventilates per warehouse, keyed (product, variant, warehouse) with
variant NULL meaning "the product's unvarianted stock". A trigger on inventory_log applies
every movement to BOTH finer rows, so no RPC does that arithmetic itself — see
docs/warehouse-sites-and-statuses.md + docs/product-variants.md. Two INEQUALITIES, never
equalities: sum(attribute variants) <= market total, and sum(sites) <= the level above.
What has not been counted stays at the coarser level rather than inventing a split, which
is why the whole model is INERT until someone creates a variant or counts a site.

**`current_stock` is not a shelf count for anything before Sept 2026.** 3 152 orders have
crossed the stock boundary; only ~109 ever produced a `scanned` ledger row, all Libya,
post-rebuild. Tunisia never scanned at all. Treat it as trustworthy only where
`record_stock_count` has run. See the stock-ledger-discontinuity note.

**Ce qui part sans variante nommée sort du NON VENTILÉ** (`total − somme(variantes)`).
Sur un produit ventilé à 100 %, un colis « produit nu » est refusé : « quelle taille
le client a-t-il reçue ? » n'a pas de réponse. Contrôlé à l'entrée de `scan_order_out`
et `adjust_product_stock` ; les 4 déclencheurs différés restent le filet.

Stock changes via EXACTLY these paths — anything else is a bug:
1. super_admin sets initial_stock on product creation (one inventory_log row, reason='initial_stock')
2. super_admin calls adjust_product_stock RPC for manual corrections (reason='manual_adjustment' or 'damaged_writeoff')
3. warehouse_agent / market_manager / super_admin call scan_order_out (−qty) or scan_return_in (+qty or damaged)
4. record_stock_count (per SITE; the count is what creates a site row) and scan_received_in (+qty)
5. unscan_order (+qty, reason='scan_reversal') and manual_delete_orders (+qty on a scanned order)
6. **post_reception** (+qty per line, reason='reception') and reverse_reception
   (−qty, reason='reception_reversal') — supplier goods, since 2026-09-30. It is the ONLY
   path besides a physical count that CREATES a `product_site_stock` row: the ventilation
   trigger does an UPDATE, never an upsert, so a reception into a never-counted
   (product, variant, site) would move the market total and silently miss the building.
   Damaged-on-arrival stays on the reception line and never enters stock — it is NOT
   `damaged_return_count`, which means "came back broken from a customer".
Paths 1–5 resolve an order's contents through `order_stock_lines(order_id)` — the single
definition of "what is in this parcel" (order_items when present, else the denormalised row).
Path 6 does NOT: a reception has no order, its lines ARE the document, and it names its
warehouse explicitly instead of inheriting one from `orders.warehouse_id`.
Since 2026-09-24 it aggregates PER (PRODUCT, ATTRIBUTE VARIANT): two sizes of one product write
two movements so the ledger says which size left, while two PACK TIERS of one product still
write one — a pack is not an object on a shelf, so `order_stock_lines` normalises it to NULL and
the movement happens at product grain. `balance_after` stays the product's MARKET total on every
row. Underflow is checked at three grains before the first write (product sum, each variant,
and the unallocated remainder), because per-variant checks alone let two lines of one product
each pass and the total go negative.
inventory_log.reason is CHECK-constrained; order_history and inventory_log are append-only BY TRIGGER.
`record_stock_count` and `adjust_product_stock` take `p_variant_id` (DEFAULT NULL, so every
pre-existing caller is unchanged). A count of a SITE poses the site's value; what it adds comes
FIRST out of the uncounted pool (non ventilé), so the total only rises by the excess, a drop is a
loss, and once every active building has counted, the level equals the sum of the buildings
(20261002190000 — before it, a first count added the whole count and doubled the stock). It never
poses the variant's total, which would erase the other buildings' stock. Market managers and agents NEVER mutate stock. Market managers and warehouse_agents CAN toggle products.is_active via toggle_product_active RPC — that is the ONLY product field they can change.

## Terminal statuses: delivered, returned, rejected, cancelled, deleted
## Fulfillment statuses set by: system (carrier webhook/polling) or manager (manual update)
## Agents NEVER set: scanned, dispatched, deposit, in_transit, delivered, returned

## Status transition rules
- Agents set: attempt_*, callback_scheduled, confirmed, dispatch_scheduled, uploaded (via upload-to-carrier action), rejected
- Warehouse sets: scanned (uploaded → scanned via scan_order_out)
- System sets: pending (webhook intake), dispatched (warehouse marks once carrier picks up), deposit, in_transit, delivered, returned, unverified
- Managers can force: cancelled, deleted (any pre-dispatch status)
- Terminal = no further transitions: delivered, returned, rejected, cancelled, deleted
- Max attempts: configurable per market via settings table (default 3)

## Rejection reasons (required when status = rejected) — CONFIGURABLE since 2026-09-19
Two levels. GROUPS are fixed (their keys are `rejection_reason` enum values, and
~1 800 orders carry one): refus_client | commande_invalide | injoignable |
livraison_impossible | autre. Four more sit in the enum as history only —
faux_numero, doublon, prix, non_serieux — and nothing writes them.
SUB-REASONS are full CRUD per market, in `rejection_reason_configs`; the old
`orders_rejection_subreason_check` is gone, so the reject route validates against
that table, not a compiled list. Delete = hard-delete if no order uses it, soft
retire otherwise (history must stay readable). A rejected order's badge shows the
short sub-reason in the rejected red with its GROUP's icon — never the bare word
"Rejeté", and never a group colour (every other hue is a live status; since 2026-10-02).
Edited at Réglages › Motifs de rejet. See docs/rejection-reasons.md.

## Agent queue sort order
1. callback_scheduled where callback_time ≤ now
2. attempt_* sorted oldest created_at first
3. pending (untouched, owned by agent) sorted oldest created_at first
4. confirmed (awaiting upload to carrier) shows the "Upload" affordance until uploaded

## Navigation (as coded in components/layout/Sidebar.tsx → NAV_SECTIONS)
Accueil → Dashboard · Commandes → Commandes, Archivées · Entrepôt (id `logistique`) →
Aujourd'hui, Sortir, Rentrer, Stock · Livraison → Suivi transporteur, Tableau livraison · Finances
(canViewFinances) → P&L global, Produits & marges, Stock & inventaire, Dépenses pub,
Investisseurs · Clients → Prospects, Relances · Équipe → Salle de contrôle, Performance,
Accès · Système → Réglages (super_admin + market_manager; one page by topic, see
docs/reglages.md), Journaux (super_admin, /system/logs).

Several live pages are NOT reachable from the sidebar and are reached by URL or deep
link only: /warehouse/preparation (→ /warehouse/out), /warehouse/scan, /warehouse/count,
/warehouse/stock/[productId], /warehouse/dispatch,
/warehouse/history, /warehouse/settings, /dashboard/alerts, /assign, /unassigned,
/confirmation-flow, /profile, /settings/integrations, /settings/statuses. Removing a nav
entry has not meant deleting its page — check before assuming a route is dead.

## Design system
- Shopify-inspired: dark sidebar (#0E1013), light content (#F6F6F7), white cards
- One brand green (#15803D) for chrome: active nav, primary CTA, focus ring
- System fonts, 14px base, black text on white — maximum contrast
- Zero gradients, zero shadows at rest, zero decoration
- Functional color ONLY on status badges — everything else black/white/gray
- Finance surfaces add measured categorical palettes (`--fin-*`, `--ads-*`) — §4.21
- Accès (/users) gives one hue per ROLE (`--role-*`, `.tone-*`) — §4.23; never a status
- RTL: full layout mirror for Arabic market
- See docs/design-system.md for full tokens and rules

## References (load on demand — do NOT @-include these)
- Réglages + Journaux — the Système area rebuilt 2026-10-02 (topics, who edits what, the
  save bar, the 24 hidden settings, server pieces): docs/reglages.md + plans/reglages-redesign.md
- Entrepôt « day loop » — Aujourd'hui (the four jobs: Sortir, Rentrer, Recevoir, Compter),
  the job hues (green family), the count run, and the first-count pool rule:
  plans/entrepot-day-loop-redesign.md
- Full Ordra specification: docs/oms-spec.md (aspirational — where it disagrees with
  docs/database-schema.md, the schema doc is closer, and the live DB is closest)
- Database schema reference (READ FROM THE LIVE DB, 73 tables): docs/database-schema.md
- Delivery follow-up — customers, delivery_actions, zones, worklist, the /delivery screen
  (agent page + manager board shipped; `lost` status and the commission rule are not):
  docs/delivery-worklist.md + plans/suivi-livraison.md
- Ad spend + Meta sync (break-even math, cost stack, cohort basis): docs/ad-spend.md +
  plans/ad-spend-meta-sync-redesign.md (NOT ad-spend-campaign-redesign.md — superseded)
- Ad spend mapping — per ad set, several products per campaign, dated history; meta
  rows of ad_spend are a projection rewritten whole; two-step rollout (cutover
  migration AFTER deploy): docs/ad-spend-mapping.md + plans/ad-spend-adset-mapping.md
- CRM prospects/leads + Équipe (control room, performance, presence): docs/crm-and-team.md
- Salle de contrôle v5 (/team) — the day, the period table, the agent panel, the four RPCs,
  the control-room settings and the bell's three alerts: docs/team-control-room.md +
  plans/team-control-room-v5.md (spec `prototypes/team-v5.html`)
- Prospects — the agent worklist (six derived buckets, the call outcome, the win-back
  trigger, the columns that do not exist): docs/prospects-worklist.md
- Distribution des commandes — l'algorithme par pourcentages, la disponibilité
  agent (déclaration + battement de cœur), le drain du pool, la remise à zéro de
  minuit, et ce qui a remplacé `active_agents_only`: docs/order-distribution.md +
  plans/percentage-distribution-and-agent-readiness.md
- Order status pipeline: docs/order-pipeline.md
- Scheduled jobs — all 12 pg_cron jobs + the notifications tick: docs/notifications-cron.md
- Design system tokens + rules: docs/design-system.md
- Accès (/users) — role tiles, the file per person, the role palette, what the old page hid
  (dead Permissions toggle, journal always « Système », the market UUID): plans/acces-redesign.md +
  prototypes/acces-v2.html (structure and rationale in acces-v1.html)
- Business profitability logic: docs/business-logic.md (created in Session 12)
- Investor domain v2 (deals, facts, accrual, settlement, rollup, surfaces): docs/investor-domain.md
- Claude Code mastery patterns: docs/mastery-guide.md
- Darb Assabil (Libya carrier) live API contract + sync engine: docs/darb-assabil-sync.md
- Libya destinations (Darb city/zone catalogue, refresh script, the one picker, phone guard): docs/darb-destinations.md
- Warehouse sites, Darb statuses, the scanned list and the sticker guard (2026-09-09 rebuild): docs/warehouse-sites-and-statuses.md + plans/warehouse-darb-workflow-rebuild.md
- Carrier rate recommendation ("meilleur choix" ladder, why true-cost must not decide per-destination, 2026-09-09 regression): docs/carrier-rate-recommendation.md
- Agent commissions (rules, ledger, RPCs, surfaces): docs/agent-commissions.md
- Entrepôt desk console (light, source of truth): docs/design/entrepot/README.md
- Entrepôt mobile agent shell (mockups + which figure comes from which query): docs/design/entrepot/mobile/README.md
- Warehouse agent shell v2, bench-first (critique, prototype, decisions of 2026-09-08): plans/warehouse-agent-ux-critique.md + prototypes/warehouse-agent-v2.html
- Libya warehouse E2E fixture (Darb sandbox, seed/teardown, audit findings): docs/warehouse-e2e-fixture.md + plans/warehouse-ly-e2e-test-fixture.md
- Orders page performance + real-time (steps 1–5 landed, invariants, how to re-check): docs/orders-page-performance.md + plans/orders-page-performance-plan.md
- Scan run, scanned-list filters, per-site stock, multi-product stock fix (2026-09-10): docs/warehouse-scan-run.md + plans/warehouse-scan-run.md
- Order presence + the agent lock (who has an order open, the hard block, why the trigger is SECURITY INVOKER): docs/order-presence-and-locking.md + plans/order-presence-and-locking.md
- Ramassage Darb du jour (« le chauffeur est passé », par site, remise à zéro à minuit sans cron): docs/darb-pickup-switch.md + plans/darb-pickup-day-switch.md
- Réglages transporteurs, préférences de commande (défaut + verrou par option) et
  activation des sites d'entrepôt — Réglages › Livraison (transporteurs) et › Entrepôts (sites):
  docs/carrier-settings-and-order-preferences.md + plans/carrier-and-order-preferences-settings.md
- Motifs de rejet — la table configurable, la règle de suppression, et pourquoi la
  pastille est toujours rouge et porte l'icône du groupe: docs/rejection-reasons.md +
  plans/rejection-reasons-crud-and-badge.md
- Intake multi-lignes — les cinq adaptateurs lisent TOUTES les lignes, le webhook écrit
  `order_items`, chaque ligne résout son produit, et `mapping_status` est le pire de
  toutes: docs/storefront-multi-line-intake.md
- Variantes produit — les deux axes (attribut porte le stock, palier multiplie), le SKU
  partagé avec products, les trois niveaux de stock, la règle du « non ventilé », et
  pourquoi DROP+CREATE d'une RPC rouvre l'accès anon: docs/product-variants.md +
  plans/product-variants.md
- Réception de marchandises — les trois documents du métier, pourquoi la validation crée
  la ligne de site, pourquoi le coût est capturé mais jamais propagé seul, les quatre
  actions (déclarer, renvoyer à l'agent, valider, contre-passer), et la limite assumée du
  modèle de paiement: docs/reception-de-marchandises.md +
  plans/reception-de-marchandises.md + plans/reception-parite-maquette.md
  (prototypes `prototypes/reception-marchandises-v3.html` — la maquette est la référence
  de l'écran et le code en est la copie ; la v3 du 2 octobre 2026 est presque entièrement
  SOUSTRACTIVE : un seul signal de couleur par ligne, pas de puce « sans objet », cinq
  colonnes au lieu de huit, un bandeau au lieu de trois, l'avarie derrière un geste, et
  seuls les coûts qui bougent dans le dialogue de validation)
- Doublons (écran de revue en lot, pré-cochage haute confiance) et fusion de
  commandes (même client, produits différents, une seule livraison, adresse
  choisie explicitement): docs/duplicates-and-merge.md +
  plans/duplicate-review-and-order-merge.md
- Recherche agent sur tout le marché — ses commandes en droits complets, celles des
  collègues / non attribuées / supprimées en aperçu lecture seule (jamais le panneau :
  sa présence bloquerait le manager), RLS non élargie, variantes arabes + accents pliées
  dans la recherche partagée (migration à appliquer AVANT le déploiement):
  docs/agent-market-search.md + plans/agent-market-search.md
- Voix du client — feedback by category and moment, the F key, courier/import feeds, the
  manager page: docs/customer-voice.md + plans/voix-du-client.md
- WhatsApp Business Cloud API — credentials per market, the send gate, the
  lifecycle outbox + pg_cron drain, the webhook contract (401 on bad signature),
  the inbox, campaigns from the business number, Meta checklist and warm-up:
  docs/whatsapp-cloud-api.md + plans/whatsapp-cloud-api.md (prototypes
  `prototypes/whatsapp-{agent,manager}-v1.html`)

## Open discrepancies (found in the 2026-09-13 doc audit — code untouched)
Documented where they live; none of these were "fixed" silently, because each is a
decision, not a typo.
1. **Two definitions of customer "risk".** `customer_risk_class()` counts
   (returned + rejected); `src/lib/customer-history/classify.ts` counts rejected only,
   and has 4 values to the DB's 3. The badge and the column can disagree — today for
   exactly 1 of 7 117 customers, and that will grow with every return.
   → docs/delivery-worklist.md §2
2. **`line-strong` (#DADCE0, Tailwind) ≠ `--border-strong` (#C9CCCF, CSS var)** — same
   intent, two values. → docs/design-system.md §2
3. **The delivery worklist and the manager board are both live at /delivery, but the surfaces
   its plan marks for deletion (Relances, Tableau livraison) are still live.** The board now
   covers what /in-delivery showed; deleting the old pages is the plan's deletion phase.
   → docs/delivery-worklist.md
4. **The reassign sheet on /delivery says the delivery commission follows the new owner; the
   ledger does not do that yet.** Decision 38 changed the rule to "assigned_to at delivered",
   but `agent_commission_ledger` still attributes to the agent of the last confirmed
   transition. The UI is ahead of the data — change the RPC before anyone is paid on a
   reassigned parcel. → docs/agent-commissions.md + plans/suivi-livraison.md
5. **391 stale `uploaded` orders** are hidden from the worklist rather than archived —
   deliberate, but they are still `uploaded` in the data.
6. **`_darb_tracking_backfill_backup` is the one table with no RLS.** Leftover; drop it
   once the backfill is confirmed good.

Never read a row count from `pg_stat_user_tables.n_live_tup` — it is a planner estimate
and was wrong by three orders of magnitude on `order_items` during this very audit. Use
`count(*)`.

## Local test credentials
- super_admin: admin@oms.local / testpass123
- tn_manager: [manager.tn](http://manager.tn/)@oms.local / testpass123
- ly_manager: [manager.ly](http://manager.ly/)@oms.local / testpass123
- tn_agent_1: [agent1.tn](http://agent1.tn/)@oms.local / testpass123
- tn_agent_2: [agent2.tn](http://agent2.tn/)@oms.local / testpass123
- ly_agent_1: [agent1.ly](http://agent1.ly/)@oms.local / testpass123 — **soft-deleted in prod (seen 2026-09-17); use manager.ly to see /delivery**
- tn_warehouse: warehouse.tn@oms.local / testpass123
- ly_warehouse: warehouse.ly@oms.local / testpass123