# Commandes — the rebuilt area (prototypes/commandes-v4.html, built 2026-10-04)

The spec is the prototype; the decisions behind it are in `plans/commandes-redesign.md`.
Four screens share one stylesheet (`src/components/orders/commandes/commandes.css`, the
prototype's own CSS scoped under `.cmd` by a script — px on purpose) and one set of atoms
(`commandes/ui.tsx`).

| Screen | Route | Component |
| --- | --- | --- |
| Commandes | `/orders` | `commandes/CommandesPage.tsx` |
| Archivées | `/orders/archive` (`?state=eligible\|archived\|recent\|deleted`) | `commandes/ArchivePage.tsx` |
| Commandes répétées | `/orders/duplicates` (`?f=rep\|dup\|risk\|ok`) | `commandes/RepeatedPage.tsx` |
| The order panel | everywhere, agents included | `queue/OrderDetailPanel/` (root carries `.cmd`) |
| Nouvelle commande | drawer | `orders/CreateOrderModal.tsx` |

## The four work shortcuts — a count is the list it opens

`preset` in the URL; counted by `get_orders_work_counts` (`/api/orders/status-counts`), listed
by `lib/orders/list-query.ts`, faceted by `get_order_facet_counts_v2`. The three restate the
same predicates; change one, change all three.

| Tile | Predicate |
| --- | --- |
| Reçues aujourd'hui (`today`) | `created_at >=` the market's midnight |
| Non assignées (`unassigned`) | `status = pending AND assigned_to IS NULL` — not "no agent, any status" (the old 14-vs-347 bug) |
| À rappeler (`recall`) | `attempt_1..3` + `callback_scheduled`; hint = callbacks past their time |
| Téléchargées aujourd'hui (`uploaded_today`) | an `uploaded` row in `order_history` since midnight, whatever the order became since; hint = `confirmed` still waiting |

`preset=callbacks` (old deep links) reads as `recall`; `in_delivery` is gone.

## Filters

Every facet is multi-select and CSV in the URL: `status`, `agent_id` (`unassigned`),
`storefront_id`, `city` (`none` = not set), `product_id`, `carrier_id` (`none` = not sent).
`/api/orders/list` and `/api/orders/export` apply them through `applyOrderListFilters` — the
CSV is the rows on screen. A "none" pick is an `or=(col.is.null,col.in.(…))`; values are
double-quoted (`inList`) — checked against the real PostgREST, not only mocks.

## Archivées

Tabs = `scope=archive&state=…`. `deleted` (Supprimées) is every soft-deleted order and lives
only here; « Restaurer » = `/api/orders/bulk-recover` (one `recover_deleted_order` per order).
« Ranger tout seul » writes `auto_archive_after_days` through `/api/settings/{market}`;
**0 = off** (the validator accepts 0 since this build; `archive_finished_orders` always read
0 as off). The tabs split at that delay, or 30 days when it is off. Counts:
`/api/orders/archive/counts`. The analysis (`get_archive_summary`, its route) is gone — the
SQL function is left in place, unused.

## Commandes répétées

`/api/orders/repeat-customers` (`get_repeat_customers`: a customer with an order this week and
≥ 2 orders over 90 days, every order oldest first) + `/api/orders/duplicates`, merged in
`lib/orders/repeat-customers.ts` `buildCases`: a duplicate group counts once; reliability
À risque = ≥ 2 lost and more lost than delivered, Fiable = delivered and nothing lost.
The cleanup keeps the order picked with ★, else the one at the carrier, else the first; deletes
go through `/api/orders/bulk-delete-duplicates` (any group member can be the anchor), 100 pairs
per call. « Pas un doublon » = `/api/orders/duplicates/dismiss` → `duplicate_dismissals`; a
group whose every member is dismissed stops showing (list and row tags) until a new copy
arrives. Duplicate groups are same phone **and same product** (`get_duplicate_groups`), so
« Fusionner » (different products) rarely appears; it opens the kept order's panel, where the
merge lives. Agents read the page; only managers delete or dismiss.

## SQL

`supabase/migrations/20261005140000_commandes_v4.sql` — `duplicate_dismissals` (+ RLS),
`get_orders_work_counts`, `get_order_facet_counts_v2`, `get_repeat_customers`; all INVOKER,
revoked from anon. The old `get_order_facet_counts` stays until nothing calls it.
