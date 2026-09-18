# Database Schema Reference — Ordra

**Source of truth: the live database**, project `vshynigvgrlihngozuwb` (Supabase,
eu-central-1). This file is a reading of it, taken 2026-09-13, not a design document.
Where this file and the spec disagree, this file is closer — and the database is closer
still. Regenerate the inventories below with the queries in §11 rather than editing
them by hand from memory.

The earlier version of this page named `docs/oms-spec.md` as its source and listed
15 tables. The database has **73 tables and 4 views**. That drift is the reason for the
inversion: the spec says what we meant to build, this page says what is deployed.

---

## 1. How to read this

- **RLS everywhere.** Every table in `public` has row-level security enabled except
  `_darb_tracking_backfill_backup` (a one-off backup, not application data). Market
  isolation is enforced here, never in the UI — see §10.
- **Append-only means a trigger, not a convention.** Four tables reject `UPDATE`/`DELETE`
  at the database level (§3). Nothing in the app can talk them out of it.
- **Scale is uneven.** `carrier_event_log` holds ~525 000 rows; `products` holds 13.
  Treat the first as a log and the second as a catalogue when you write queries.

---

## 2. Table inventory (73 tables, 4 views)

Grouped by domain. "Rows" is the planner's live estimate on 2026-09-13 — an order of
magnitude, not a count.

### Core order flow

| Table | Cols | Rows | Purpose |
|---|---|---|---|
| `orders` | 70 | 8 184 | The central record. 8 triggers (§3, §4). |
| `order_items` | 11 | 4 372 | Per-line products, across 4 328 orders (true `count(*)`). |
| `order_history` | 9 | 2 962 | Status transitions. **Append-only.** |
| `order_presence` | 8 | 22 | Who has an order open; the agent lock. |
| `order_follow_ups` / `order_follow_up_entries` | 15 / 9 | — | Relances (Clients → Relances). |
| `status_configs` | 13 | — | Per-market status display config. |

### Customers & CRM

| Table | Cols | Rows | Purpose |
|---|---|---|---|
| `customers` | 19 | 7 117 | One row per normalized phone per market. §5. |
| `leads` / `lead_history` | 24 / 8 | 1 992 | Prospect pipeline. |
| `prospect_campaigns` | 6 | — | Campaign definitions behind Clients → Prospects. |

### Delivery follow-up (2026-09-12 →)

| Table | Cols | Rows | Purpose |
|---|---|---|---|
| `delivery_actions` | 16 | — | What was done about a late parcel. **Append-only.** §6. |
| `delivery_zone_stats` | 9 | 76 | Per-zone delivery rate, recomputed nightly. §6. |

### Products & stock

| Table | Cols | Rows | Purpose |
|---|---|---|---|
| `products` | 30 | 13 | Catalogue + COGS + `current_stock` (market total). |
| `product_variants` | 9 | — | Variant → quantity mapping. |
| `product_site_stock` | 7 | — | Per-warehouse ventilation of the market total. |
| `inventory_log` | 14 | 83 | Every stock movement. **Append-only**, 5 triggers. |
| `warehouses` | 9 | 3 | Physical sites (Libya has two). |

### Carriers — Darb Assabil (Libya)

`darb_shipments` (49 cols, 1 156), `darb_timeline_events` (14, 1 690),
`darb_sync_runs` (14, 7 634), `darb_shipping_rates` (19, 608), `darb_destinations`,
`darb_zones`, `darb_branches`, `darb_services`, `darb_conversation`,
`darb_rate_harvest_runs`. Contract and sync engine: `docs/darb-assabil-sync.md`.

### Carriers — shared & Dexpress (Tunisia)

`carriers` (19), `carrier_event_log` (10, **525 002** — the largest table),
`carrier_product_mappings`, `label_prints`, `cities`, `external_city_mappings`,
`dexpress_places`, `dexpress_states`, `dexpress_sessions`.

### Finance — ad spend

`ad_spend` (25, 207), `ad_sync_runs` (14, 709), `meta_ad_accounts` (15),
`meta_campaign_mappings` (9). Surfaces Finances → Dépenses pub.

### Finance — investors (v2 engine)

`investors`, `investor_deals`, `investor_deal_terms`, `investor_deal_statements` (42),
`investor_deal_snapshots`, `investor_order_facts` (42, 2 191),
`investor_daily_product_facts` (28, 351), `investor_ledger_entries`,
`investor_settlements`, `investor_withdrawals`, `investor_withdrawal_requests`,
`investor_notifications`, `investor_rollup_runs` (2 490), `investment_agreements`.
Domain model: `docs/investor-domain.md`.

### Team & commissions

`users` (16, 35), `agent_commission_rates`, `agent_commission_ledger` (**append-only**),
`agent_targets`, `agent_notifications` (665), `assignment_rules`, `user_audit_log`.

### Platform & integrations

`markets`, `settings` (55), `settings_history`, `storefronts`,
`storefront_product_mappings`, `webhook_delivery_log` (14),
`sheet_sync_runs` (3 063), `sheet_sync_failed_rows`, `alert_acknowledgements`.

### Views

`follow_up_campaigns`, `order_carrier_cost`, `product_inventory_view`,
`product_return_rate_view`. Views carry no RLS of their own — they inherit from their
base tables, so never expose one to a client that must not read the base.

---

## 3. Append-only tables — enforced by trigger

Four tables reject mutation in the database:

| Table | Trigger |
|---|---|
| `order_history` | `trg_order_history_append_only` |
| `inventory_log` | `trg_inventory_log_append_only` (+ `inventory_log_no_update`, `inventory_log_no_delete`) |
| `agent_commission_ledger` | `trg_agent_commission_ledger_append_only` |
| `delivery_actions` | `trg_delivery_actions_append_only` |

`delivery_actions` is the newest and is **not** named in CLAUDE.md's critical rules,
which list only the first two. The rule is the same: correct a row by appending its
reversal, never by editing it.

Adjacent immutability, different shape: `investor_deal_statements`
(`trg_..._immutable`), `investor_deal_terms` (insert-only — terms are amended by adding
an effective-dated row), and `investor_ledger_entries` (append-only).

---

## 4. `orders` — the triggers that make it work

`orders` carries eight triggers. They are not decoration; several are load-bearing
invariants documented elsewhere:

| Trigger | What it guarantees |
|---|---|
| `trg_orders_link_customer` | Every order resolves to a `customers` row on insert. |
| `trg_orders_refresh_customer` | Customer counters/risk recomputed as the order moves. |
| `trg_orders_set_warehouse` | `warehouse_id` follows `carrier_id` (the Libya two-site rule). |
| `trg_orders_stamp_terminal` | Stamps the terminal timestamp once a terminal status lands. |
| `trg_orders_lock_guard` | Enforces the agent lock; `order_items` has its own twin. |
| `trg_orders_broadcast_upd` / `_ins_del` | Realtime broadcast to the orders console. |
| `trg_orders_updated_at` | Touch column. |

---

## 5. `customers`

One row per `(market_id, phone_normalized)`. Created and maintained by trigger from
`orders` — the application does not insert here directly.

| Column | Type | Note |
|---|---|---|
| `phone_normalized` | text NOT NULL | The identity. See `normalize_phone()`. |
| `phones` | text[] | Every raw spelling seen for this customer. |
| `name`, `last_address`, `last_city`, `last_city_id`, `last_darb_destination_id` | | Last-seen values, not history. |
| `orders_count`, `delivered_count`, `returned_count`, `rejected_count`, `cancelled_count` | int | Maintained by `refresh_customer_stats()`. |
| `risk_class` | text, default `'none'` | Derived by `customer_risk_class()` from the counters. |
| `first_order_at`, `last_order_at` | timestamptz | |

**The leading-zero trap.** Phone identity depends on `normalize_phone()`; migration
`20260926000002_normalize_phone_trunk_zero.sql` exists because a trunk zero made one
customer look like two. Any new phone entry path must go through that function.

---

## 6. Delivery follow-up

**`delivery_actions`** — append-only. Each row is one intervention on a parcel that is
late or at risk, and it snapshots the context it was taken in, so later analysis does
not have to reconstruct it: `status_at_action`, `carrier_slug_at_action`,
`remark_class_at_action`. Plus `action_type`, `channel`, `outcome`, `note`,
`template_key`, `next_action_at`, and the actor. Written by
`record_delivery_action(...)`.

**`delivery_zone_stats`** — `(market_id, zone_key)` with `delivered_count`,
`returned_count`, `sample`, `delivery_rate`, over a `window_days` window (default 90).
Recomputed by `refresh_delivery_zone_stats(p_window_days)` on the
`delivery-zone-stats-nightly` cron (02:17). `sample` is there to be checked: a zone with
a handful of parcels has a delivery rate that means nothing.

**The worklist.** `get_delivery_worklist(p_market_id, p_agent_id)` is **SECURITY
INVOKER** — it is the caller's RLS that scopes it, which is what makes it safe to hand
an agent. Risk comes from `evaluate_delivery_risk(p_order_id)`, zone identity from
`delivery_zone_key(...)`, and thresholds from `delivery_setting_int(market, key,
default)` so they stay per-market settings rather than constants.

---

## 7. Enums (live values)

```
order_status      pending | new | assigned | attempt_1 | attempt_2 | attempt_3 |
                  callback_scheduled | confirmed | dispatch_scheduled | uploaded |
                  dispatching | scanned | at_carrier | dispatched | deposit |
                  in_transit | out_for_delivery | delivery_delayed | unverified |
                  returning | to_be_returned | received | delivered | returned |
                  rejected | cancelled | deleted                            (27)

rejection_reason  refus_client | faux_numero | doublon | injoignable | prix |
                  non_serieux | autre | commande_invalide | livraison_impossible (9)

return_reason     packaging | product_defect | customer_damage | carrier_damage | other
lead_status       new | assigned | attempt_1 | attempt_2 | attempt_3 |
                  callback_scheduled | qualified | won | lost | archived
lead_source       manual_call | facebook_comment | facebook_dm | instagram_dm |
                  whatsapp | tiktok_comment | other | campaign
lead_lost_reason  not_interested | price | unreachable | competitor | duplicate |
                  wrong_number | spam | autre
follow_up_status  open | in_progress | resolved | escalated
```

`rejection_reason` carries **9** values. CLAUDE.md documents 7 — `commande_invalide`
and `livraison_impossible` were added without reaching the rules. Ordering within
`order_status` is not the pipeline; use `order_status_rank()` for that.

---

## 8. Functions

~160 application functions live in `public` (plus `pg_trgm` / `btree_gist` internals,
which are not ours — filter on `proname NOT LIKE 'gbt%'` and friends). They are the
write path: **the application mutates through RPCs, not through table writes.**

Security mode is a deliberate choice per function, not a default:

- **SECURITY DEFINER** — the overwhelming majority. They enforce their own role and
  market checks internally.
- **SECURITY INVOKER** — chosen where the caller's RLS *is* the intended guard:
  `get_delivery_worklist`, `get_order_facet_counts`, `get_orders_kpi_counts`,
  `get_confirmation_rate_windows`, `follow_ups_status_counts`,
  `follow_ups_overdue_by_agent`, `get_stock_position_scope`, plus the pure helpers
  (`normalize_phone`, `order_status_rank`, `market_tz`, `customer_risk_class`,
  `delivery_zone_key`, `delivery_setting_int`) and every trigger function.

Changing a function's security mode changes who can read what. Do not flip one to
DEFINER to "fix" a permission error.

Stock mutation is confined to: `adjust_product_stock`, `scan_order_out`,
`scan_return_in`, `scan_received_in`, `record_stock_count`, `unscan_order`,
`manual_delete_orders`, and initial stock at product creation. Any other path is a bug.

---

## 9. Flagged discrepancies (2026-09-13)

Recorded, not fixed — code and data were left alone.

1. **`rejection_reason` has 9 values, CLAUDE.md documents 7** (§7).
2. **`delivery_actions` is append-only but is not in CLAUDE.md's append-only rule** (§3).
3. **`_darb_tracking_backfill_backup` has no RLS** and is the only such table. It is a
   leftover backup; it should be dropped once the backfill is confirmed good.

> **A retracted flag, kept as a warning about this page's own method.** An earlier draft
> of this section claimed `order_items` held 16 rows against 8 184 orders and that the
> multi-product stock model might therefore be reading an empty table. **That was
> wrong.** `order_items` holds **4 372 rows across 4 328 distinct orders**. The "16" came
> from `pg_stat_user_tables.n_live_tup`, which is a *planner estimate* refreshed by
> autovacuum, not a count — and on this table it was stale by three orders of magnitude.
>
> Every "Rows" figure in §2 comes from that same estimate and carries the same caveat:
> read them as orders of magnitude, and run `count(*)` before drawing any conclusion
> from one.

---

## 10. RLS and market isolation

Every application table has RLS on. The two market rows (`tn`, `ly`) are both active and
both carry real volume (TN 4 203 orders / 3 761 customers; LY 3 981 / 3 356), so
isolation is not theoretical.

Roles in `users.role` (live counts): `super_admin` 2, `market_manager` 8, `agent` 15,
`warehouse_agent` 9, `investor` 1.

`warehouse_agent` also carries `warehouse_id`, and **only 2 of 9 have one set**. An
unassigned warehouse agent must see nothing — see
`docs/warehouse-sites-and-statuses.md`, which documents the period when unassigned
wrongly meant unrestricted.

---

## 11. Regenerating this page

```sql
-- tables, views, RLS, column counts
select c.relname, c.relkind, c.relrowsecurity,
       (select count(*) from pg_attribute a
         where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) as cols
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','v','m') order by c.relkind, c.relname;

-- functions and their security mode
select p.proname, case when p.prosecdef then 'DEFINER' else 'INVOKER' end,
       pg_get_function_identity_arguments(p.oid)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prokind='f' order by p.proname;

-- enums
select t.typname, string_agg(e.enumlabel,' | ' order by e.enumsortorder)
from pg_type t join pg_enum e on e.enumtypid=t.oid
join pg_namespace n on n.oid=t.typnamespace
where n.nspname='public' group by t.typname;

-- triggers (append-only guards live here)
select c.relname, string_agg(t.tgname, ', ')
from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and not t.tgisinternal group by c.relname;
```

Migrations: `supabase/migrations/`, 263 files as of 2026-09-13. The filename date is
when it was written, not necessarily when it reached production — the database, not the
folder, is the authority.
