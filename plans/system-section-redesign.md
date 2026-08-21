# SYSTÈME — Redesign Specification

**Status:** approved design spec, not yet implemented.
**Scope:** the whole admin "SYSTÈME" section — business logic, structure, CRUD, KPIs, layout, UI flow.
**Prototype (v2):** `plans/system-section-redesign-prototype.html` — interactive, real prod data, role toggle.
**Date:** 2026-08-18. All production figures below are live reads from project `vshynigvgrlihngozuwb`.

---

## 1. Context

The section grew page-by-page into seven flat pages (Marchés · Storefronts · Correspondances · Transporteurs · Intégrations · Paramètres · Journaux). It is now inconsistent in three ways at once: **visually** (3 of 7 pages are inline-style hex with hand-rolled drawers; only `settings/general` and `admin/logs` use the design tokens), **functionally** (no delete anywhere except Meta, no edit on mappings, markets read-only), and **conceptually** ("Intégrations" holds only Meta Ads while the real integrations live under three other pages).

This spec rebuilds it as **four workspaces** with one mental model: *a market owns connections; connections have health; settings tune behaviour; journals prove what happened.*

### Decisions taken with the product owner

| Decision | Value |
|---|---|
| Structure | 4 workspaces: **Marchés · Connexions · Paramètres · Journaux** |
| Markets | Edit only — no create (no schema change) |
| Settings — remove | **Finance tab** (fees belong to each carrier) and **Libellés** (status renaming) |
| Settings — add | **Confirmation SLA & auto-actions**, **Alert thresholds** |
| Third-party | Plan for **WhatsApp Business Cloud API** (same Meta app as ads) |
| Delete | Archive by default; hard delete only when nothing references it |
| Journaux | Technical **and** business audit |
| Access | super_admin full; market_manager read-only on own market |

---

## 2. What the audit found — the evidence the design answers to

These are live production facts. Each one drives a design decision, so they belong in the spec rather than a side note.

| # | Finding | Consequence for the design |
|---|---|---|
| 1 | **`max_call_attempts` is 9 (TN) and 8 (LY), but the status model stops at `attempt_3`.** `getNextAttemptStatus("attempt_3")` returns `null` (`src/lib/attempt-logic.ts:11`) and `isMaxAttemptsReached` never fires (`3 >= 9` is false), so `POST /api/orders/[id]/attempt` answers **400 "Cannot log no-response"** instead of auto-rejecting. Agents are hard-blocked at the third attempt in **both markets**. | The stepper must cap at **3**, and the field needs a live consequence line. A settings UI that lets you enter an unreachable number is the bug's delivery mechanism. |
| 2 | **Zero webhooks in 7 days** (`webhook_delivery_log`), yet the two highest-volume storefronts have 3 176 and 3 030 orders — they ingest via **Google Sheets sync and import**, not webhooks. 8 of 13 storefronts have `last_webhook_received_at = null`. | Health must be **per intake mode** (webhook / sync / import), not "no webhook = failing". Today's badge would paint healthy connectors red. |
| 3 | **15 849 carrier events in 24 h, 5 472 of them errors — a 34.5 % error rate, all Navex.** Nothing surfaces this. | The Connexions overview and Journaux both need an error-rate KPI with a threshold, not just a raw count. |
| 4 | **`platform` values in production include `converty` and `google_sheets`**, neither of which is in `STOREFRONT_PLATFORMS` (`src/types/storefront.ts`), and the DB column has no CHECK. Three lists disagree (type = 5, UI labels = 4, DB = 7 distinct). | One source of truth for platforms, including the sheet-backed and import-only ones. |
| 5 | **Cosmos carries 226 orders and 14 in flight with `delivery_fee = 0`, no adapter and no credentials.** `TestCarrier3` has 0 orders and 0 fees — leftover test data. | Fees become **required** on carrier create; the list must show "no adapter / manual" honestly; unused carriers must be deletable. |
| 6 | **Market-level `delivery_fee` / `return_fee` / `packing_cost` are read by nothing.** Every calculation reads `carriers.delivery_fee` (`lib/calculations/*`, `lib/products/metrics.ts`) or `products.packing_cost`. TN still stores 6 / 2 / 0.5. | Confirms the decision to delete the Finance tab. The keys are **deprecated, not silently dropped** — see §12. |
| 7 | **`assignment_algorithm` has two different JSON shapes in production**: TN `{"type":"workload"}`, LY `{"value":"manual"}`. The orchestrator defensively reads both (`src/lib/orders/auto-assignment-orchestrator.ts:33`). | The settings writer must normalise on save; a one-off migration fixes the existing rows. |
| 8 | **Settings keys live in production with no UI at all**: `auto_archive_after_days` (30, read by a pg_cron function), `goal_daily_treated`, `goal_min_rate`, `goal_conf_per_hour`, `goal_team_weekly_conf` (no reader found in `src/`), `darb_last_sync_at` (a runtime cursor, not a setting). | Three fates: **expose** (`auto_archive_after_days`), **relocate to Objectifs** (`goal_*`), **hide from settings entirely** (`darb_last_sync_at` is machine state and belongs in Journaux → Synchronisations). |
| 9 | **`external_city_mappings` exists and is unused** (2 rows) — the Villes tab binds the order directly and never writes an alias, so the same city name re-enters the queue forever. `carrier_product_mappings` (5 rows) has no UI at all. | Correspondances must write the alias **and** bind the order, and must surface carrier product mappings. |
| 10 | **`settings_history` recorded 2 changes in 7 days, `user_audit_log` 0** — the audit trail exists and nobody can see it. The UI also claims 90-day archival ("logs.retentionNote") while **no retention job exists**. | Journaux gets an Audit tab; the false retention note is deleted, and retention becomes a real setting backed by a real job. |

---

## 3. Business logic

### 3.1 Entities

| Entity | Definition | Table |
|---|---|---|
| **Market** | Isolation root. Owns every connection, setting, mapping and log row. Currency and language are market-level; RLS enforces the boundary. | `markets` |
| **Connection** | Anything the OMS talks to: a **storefront** (orders in), a **carrier** (parcels out), or a **service** (Meta Ads, Google Sheets, WhatsApp). Common shape: identity · market · credentials (encrypted, rotate-only) · intake/dispatch mode · health · `is_active`. | `storefronts`, `carriers`, `meta_ad_accounts`, `settings.google_sheets_sources` |
| **Mapping** | A translation between an external vocabulary and the OMS one: product, city, carrier product. | `storefront_product_mappings`, `external_city_mappings`, `carrier_product_mappings` |
| **Setting** | Per-market key/value tuning behaviour. Every write appends history. | `settings` + `settings_history` |
| **Journal entry** | Append-only evidence: webhook delivery, carrier event, sync run, config change. | `webhook_delivery_log`, `carrier_event_log`, `*_sync_runs`, `settings_history`, `user_audit_log` |

### 3.2 Connection health — mode-aware (replaces the current webhook-only rule)

Health is computed against the connection's **own intake mode**, which is finding #2's fix:

| Mode | Connections | Healthy when | Stale when | Failing when |
|---|---|---|---|---|
| `webhook` | Shopify, EasyOrders, WooCommerce, Lightfunnels, Buybox | last delivery < 24 h and `webhook_failure_count` = 0 | last delivery 24 h–7 d | `webhook_failure_count` ≥ `webhook_failure_threshold`, or last status = `error` |
| `sync` | Google Sheets, Meta Ads, Darb sync | last successful run < `sync_staleness_hours` | run older than that | last run failed, or lock held |
| `import` | Converty (manual/one-off) | rows imported in the last 30 d | older | n/a |
| `dispatch` | Carriers | error rate 24 h < threshold and credentials valid | no events 24 h | error rate ≥ threshold, or auth failure |

States: **Actif** · **Silencieux** (stale) · **En erreur** · **Jamais utilisé** · **Archivé**. A connection with no configured mode reads **Non configuré**, never a false green.

### 3.3 Archive vs delete

| Action | Condition | Effect |
|---|---|---|
| **Archiver** | Always available | `is_active = false`; hidden from agent/warehouse pickers; kept in every historical calculation; reversible; audit row |
| **Supprimer** | Only when **0 orders** and **0 mappings** reference it | Hard delete; typed-name confirmation; audit row. Disabled with the reason shown ("226 commandes y font référence") |

Rationale: orders reference `storefront_id` / `carrier_id` for the life of the business. Deleting a referenced connection either breaks history or silently rewrites it. Archive is the default because it is the only reversible option; delete exists solely to clear test junk like `TestCarrier3`.

### 3.4 Fees

`carriers.delivery_fee` / `carriers.return_fee` are the **only** delivery-cost source; `products.packing_cost` is the only packing source. Market-level fee keys are removed from the UI. Tunisia's requirement — different fees per delivery company — is satisfied by definition, since the fee already lives on the carrier row.

> Known gap, carried forward unchanged: a flat per-carrier fee understates real billing (Darb's effective cost is ≈2.9× the 10 LYD flat fee, and `darb_shipping_rates` holds harvested per-destination rates). The Tarifs tab **shows** the harvested rates read-only beside the flat fee so the discrepancy is visible. Replacing the flat fee with a rate table is out of scope here.

### 3.5 Access

| Role | Marchés | Connexions | Paramètres | Journaux |
|---|---|---|---|---|
| super_admin | Read + edit | Full CRUD, all markets | Full, all markets | Full |
| market_manager | Read own market | Read own market | Read own market | Read own market (webhooks + sync only) |
| everyone else | No nav entry, 404 on URL | | | |

Managers see the section with a **"Lecture seule"** pill in the header; every mutating control is `disabled` with a tooltip. Server-side enforcement is mandatory — today `settings/general`, `settings/storefronts` and `mappings` allow managers to *write* by URL while the nav hides the section, which is the loophole this closes.

---

## 4. Information architecture

```
SYSTÈME  (super_admin · market_manager read-only)
├── Marchés        /system/markets      Two market cards, health rollup, market-level edit
├── Connexions     /system/connections  ?tab=overview|storefronts|carriers|services|mappings
├── Paramètres     /system/settings     ?market=tn|ly&tab=operations|alerts|team|goals|commissions
└── Journaux       /system/logs         ?tab=webhooks|carriers|syncs|audit
```

Redirects from the old routes: `/markets` → `/system/markets`; `/settings/storefronts` → `…/connections?tab=storefronts`; `/settings/carriers` → `…?tab=carriers`; `/settings/integrations` → `…?tab=services`; `/mappings` → `…?tab=mappings`; `/settings/general` → `/system/settings`; `/settings/statuses` → `/system/settings` (editor removed); `/admin/logs`, `/admin/webhook-logs`, `/admin/carrier-events` → `/system/logs`.

Every page: `SettingsPageHeader` (title · one-line description · right slot: market switcher, read-only pill, primary action) → **KPI strip** → `SegmentedTabs` → content. Deep links carry tab and filter state in the query string so a KPI tile can link to a filtered view.

---

## 5. Marchés

**Purpose:** the section's home. Answers "is each market healthy, and what is it configured to do?"

**Layout:** header, then one card per market (2-up, 1-up under 1100px). No market switcher — the page *is* the switcher. Each card: identity row (flag-free code pill, name, currency, language, direction, active toggle) → 4-tile KPI grid → connection rollup line → insight line → actions (`Modifier`, `Ouvrir le tableau de bord`, `Voir les connexions`).

**KPI panel (per market, all deep-linked)**

| KPI | Source | Insight rule |
|---|---|---|
| Commandes 7 j | `orders` created 7 d | vs previous 7 d, ±% |
| Taux de confirmation 7 j | confirmed ÷ treated | amber below `goal_min_rate` |
| Taux de livraison 30 j | delivered ÷ (delivered + returned) | amber below 70 % |
| Connexions saines | storefronts + carriers by §3.2 | red if any failing, links to the filtered tab |

**Insight line** (one sentence, computed, links to the fix): e.g. *"Tunisie : 34 % des événements transporteur sont en erreur sur 24 h — voir Navex."*

**CRUD**

| Op | Available | Notes |
|---|---|---|
| Create | ✗ | `markets.code` has a CHECK constraint on `('tn','ly')`; adding a market is a migration. The empty slot is shown as a disabled "Ajouter un marché" card with that reason. |
| Read | ✓ | |
| Update | ✓ | `name`, `language`, `direction`, `is_active`. **`currency` locked once the market has orders** (it would rewrite historical money). |
| Archive | ✓ | `is_active = false` — hides the market everywhere; blocked while orders are in flight. |
| Delete | ✗ | Never. |

---

## 6. Connexions

**Purpose:** one inventory of everything the OMS talks to. This is the "Intégration" sub-section the brief asks for — it lists **every storefront, every delivery company and every third-party system** in a single place, with the per-type tabs behind it.

Tabs: **Vue d'ensemble · Storefronts · Transporteurs · Services · Correspondances**.

### 6.0 KPI strip (whole workspace)

| KPI | Value today (prod) | Threshold |
|---|---|---|
| Connecteurs actifs | 19 of 20 (1 archived) | — |
| En erreur | 1 (Navex) | any > 0 → red |
| Événements 24 h | 15 849 | — |
| Taux d'erreur 24 h | **34.5 %** | ≥ 5 % → red |
| Sync la plus ancienne | Sheets 15 min · Meta 1 h · Darb 8 min | > `sync_staleness_hours` → amber |

### 6.1 Vue d'ensemble — the integration inventory

Grouped list, one row per connection: icon · name · type · market · mode · health · last event · 24 h volume · error rate · ⋯. Groups: **Storefronts (13) · Transporteurs (6) · Services (3) · Automatisations (6 crons)**.

Automatisations row-set is read-only and shows each scheduled job with its last run: `poll-carriers`, `dispatch-scheduled`, `google-sheets-sync`, `darb-sync`, `darb-rates-harvest`, `meta-ads-sync`. It exists because a "healthy" connector with a dead cron is invisible otherwise.

### 6.2 Storefronts

Table columns: nom · plateforme · marché · **mode** (webhook/sync/import) · santé · dernier événement · commandes · 24 h · mode auth · ⋯

Detail drawer (640px) tabs: **Général** (name, platform, market, active) · **Réception** (webhook URL, rotate secret, `auth_mode` hmac/uuid_only — currently invisible in the UI despite existing since migration `20260622000001`; for sheet sources: spreadsheet, range, schedule, Sync now) · **Produits** (mappings for this storefront, full CRUD) · **Activité** (last 20 deliveries, links to Journaux).

| Op | Today | Target |
|---|---|---|
| Create | ✓ wizard | ✓ same 4-step `ConnectionWizard`, plus a **mode** step so sheet/import sources stop pretending to be webhook sources |
| Read | ✓ | ✓ + mode-aware health |
| Update | ✓ | ✓ |
| Toggle actif | ✓ | ✓ |
| Test | ✓ | ✓ |
| Rotate secret | ✓ | ✓ (+ reveal-once sheet) |
| Sync now | ✓ sheets only | ✓ |
| **Archive** | ✗ | **✓ new** |
| **Delete** | endpoint only, no UI | **✓ new**, gated on 0 orders + 0 mappings |

### 6.3 Transporteurs (delivery companies)

Table columns: nom · adaptateur · marché · santé · **frais livraison** · **frais retour** · en cours · livrés 30 j · taux d'erreur 24 h · ⋯

Detail drawer tabs: **Général** · **Identifiants** (adapter-driven fields, rotate-only, never returned) · **Tarifs** (delivery/return fee — required; for Darb, the harvested `darb_shipping_rates` shown read-only beside the flat fee, with the gap called out) · **Correspondances** (destinations: `cities` / `dexpress_states` / `darb_destinations`; products: `carrier_product_mappings` — first UI these have ever had) · **Activité**.

| Op | Today | Target |
|---|---|---|
| Create | ✓ | ✓ + **fees required** (Cosmos shipped 226 orders at fee 0) |
| Read | ✓ | ✓ + error rate |
| Update | ✓ | ✓ |
| Toggle actif | ✓ | ✓ |
| Test (reachability / dry-run) | ✓ | ✓ |
| **Archive** | ✗ | **✓ new** |
| **Delete** | endpoint only, no UI | **✓ new**, gated (frees `TestCarrier3`) |

### 6.4 Services (third-party)

One card per service — status, last activity, primary action.

| Service | State today | Card content |
|---|---|---|
| **Meta Ads** | 1 account (`Totella AdAccount 5`, LY, USD), synced hourly, 13 rows | Accounts CRUD, test, FX rate, last sync — the existing `MetaAdsSection`, restyled |
| **Google Sheets** | service account, 15-min cron, sources in `settings.google_sheets_sources` | Service-account identity, sources count, last run, Sync now |
| **WhatsApp Business (Cloud API)** | not connected | **New placeholder**: WABA ID, phone number ID, token, verify token; "Templates — bientôt". Same Meta app as ads, separate page context |
| **Meta Leads (webhook)** | `/api/webhooks/meta/[sourceId]` returns **501** | Shown as **Non implémenté** with the callback URL + verify token, so the state is honest |

### 6.5 Correspondances

A work queue, not a table dump. Header shows the unmatched count as a badge (today: **0 products, 0 cities** — the queue is clean, which the empty state should celebrate rather than look broken).

Sub-tabs **Produits · Villes · Produits transporteur**, each with: unmatched queue on top, existing mappings below, search, market filter.

| Op | Today | Target |
|---|---|---|
| Create | ✓ both | ✓ all three |
| Read | products only | ✓ all three, with search + pagination |
| **Update** | ✗ | **✓ new** |
| **Delete** | ✗ | **✓ new** (a wrong mapping is currently only fixable in SQL) |
| **Persist city alias** | ✗ | **✓ new** — write `external_city_mappings` **and** bind the order, so the same city never returns to the queue |

---

## 7. Paramètres

Per-market, market switcher in the header, managers read-only. Left rail: **Opérations · Alertes · Équipe · Objectifs · Commissions** (Finance and Libellés shown struck-through as *retiré* so nobody looks for them). Each group is a stack of `SectionShell` cards — grouped fields, per-field history, group-level Save/Reset — and every numeric field carries a **consequence line** computed live ("Navex est à 34,5 % — l'alerte se déclencherait immédiatement").

### 7.1 Opérations — four cards, the whole order lifecycle

| Card | Field | Key | State | Note |
|---|---|---|---|---|
| Confirmation | Tentatives max | `max_call_attempts` | **fix: cap 3** | finding #1 |
| | Après la dernière tentative | `after_max_attempts_action` (`reject`\|`flag`\|`none`) + `after_max_attempts_delay_hours` | add | makes today's silent auto-reject explicit |
| | Heures de rappel automatique | `attempt_retry_times` | keep | 3 slots, `notifications-check` runs each minute |
| | Fenêtre de rappel programmé | `callback_max_days`, `callback_grace_minutes` | add | bounds `callback_scheduled_at`; overdue → badge + manager notice |
| | Délai de confirmation (SLA) | `sla_minutes` | expose | |
| | Motifs de rejet | — | read-only | fixed vocabulary, shown as chips |
| Réception | Doublons | `duplicate_window_hours` | add | exact `external_id` dupes already blocked by UNIQUE; this catches the re-ordering customer |
| | Affectation à l'arrivée | `auto_assign_on_intake` | add (bool) | off = "À affecter" queue |
| | Montant de commande | `order_amount_min/max` | add | out of range → flagged, never dropped |
| | Ville non reconnue | `unknown_city_policy` (`queue`\|`fuzzy`) | add | fuzzy uses `external_city_mappings` |
| Expédition & suivi | Heure limite d'expédition | `dispatch_cutoff_time` | add | |
| | Téléversement automatique | `auto_upload_on_confirm` | add (bool) | upload stays a separate step; failure keeps `confirmed` |
| | Colis sans nouvelle | `unverified_after_days` | add | trigger for the existing `unverified` status |
| | Retours | `auto_restock_on_return_scan` | add (bool) | `scan_return_in` |
| Cycle de vie & stock | Archivage automatique | `auto_archive_after_days` | expose | pg_cron already reads it |
| | Délai fournisseur | `supplier_lead_time_days` | expose | |
| | Frais livraison/retour/emballage | — | **removed** | shown as a struck-through note with the reason |

### 7.2 Alertes — new group

`carrier_error_rate_threshold` (5 %) · `webhook_failure_threshold` (3) · `sync_staleness_hours` (2) · `carrier_stall_days` (5) · `stockout_days_of_cover` (7) · `sla_breach_alert` (bool). Each row shows a meter of *today's* value against the threshold. Destinataires: in-app (bell + banner on the connection); e-mail / WhatsApp marked *bientôt*.

### 7.3 Équipe — two cards

**Affectation**: algorithm as five option cards (charge de travail · tourniquet · par produit · par région · manuel), `max_open_orders_per_agent` (add), `active_agents_only` (keep), and a **rules table** for product/region rules stored in `assignment_rules.config` (first UI). Shape of `assignment_algorithm` normalised on save (finding #7).
**Présence & heures ouvrées**: presence ladder (online < 5 min fixed · idle < `agent_inactivity_minutes` · offline), `orphan_reassign_after_minutes` + toggle (add — makes "Files orphelines" actionable), `outside_hours_policy` (`hold`\|`assign`, add), `shift_config` with day toggles and timezone (LY still on `Africa/Tunis` in prod — flagged inline).

### 7.4 Objectifs — new tab

`goal_daily_treated`, `goal_min_rate`, `goal_conf_per_hour`, `goal_team_weekly_conf` — already in prod, each with a meter of the current 7-day figure.

### 7.5 Commissions — full lifecycle from `docs/agent-commissions.md`

KPI strip (à verser · accumulé ce mois · reprises · dernier calcul + "Lancer maintenant"). **Barème du marché**: switch (dated pause, never a delete), flat amount, effective date, attribution rule and automatic reversal shown as fixed behaviour. **Par agent**: switch, own rate vs market, since, deliveries this month, balance, ⋯ (taux propre · relevé/CSV · paiement · ajustement ± · suspendre). **Paiements & garde-fous**: negative-balance policy (refuse \| allow with note — the RPC's explicit flag), payment methods, and the effective-dated rate history as a timeline.

### 7.6 KPI panel

SLA respecté 7 j (meter) · tentatives avant confirmation (distribution 1re/2e/3e) · blocages à la 3ᵉ tentative (sparkline — finding #1 made visible) · commissions à verser.

## 8. Journaux

Tabs: **Webhooks · Transporteurs · Synchronisations · Audit**. Shared filter bar: marché · **plage de dates (new — the current page has none)** · résultat · recherche. Shared payload-inspector drawer (the existing `LogsWorkspace` pattern, which is already token-compliant).

| Tab | Source | Actions |
|---|---|---|
| Webhooks | `webhook_delivery_log` | Rejouer (existing) |
| Transporteurs | `carrier_event_log` | inspect; **error-rate banner** when ≥ threshold |
| **Synchronisations** (new) | `sheet_sync_runs` + `sheet_sync_failed_rows`, `ad_sync_runs`, `darb_sync_runs`, `darb_rate_harvest_runs` | Relancer; failed-row detail |
| **Audit** (new) | `settings_history`, `user_audit_log`, connection events | read-only; who changed what, from what, to what |

**Removed:** the retention note claiming ">90 days archived to cold storage" — no such job exists. **Replaced by:** a real `log_retention_days` setting plus a pruning cron (§12), so the sentence becomes true before it is shown again.

**KPI panel:** erreurs webhooks 24 h · **taux d'erreur transporteur 24 h (34.5 % — red)** · syncs échouées 24 h · modifications de config 7 j.

---

## 9. Consolidated CRUD matrix

| Entity | Create | Read | Update | Toggle | Test | Archive | Delete | Extra |
|---|---|---|---|---|---|---|---|---|
| Market | ✗ migration | ✓ | ✓ (currency locked w/ orders) | ✓ | — | ✓ | ✗ | — |
| Storefront | ✓ wizard | ✓ | ✓ | ✓ | ✓ | **✓ new** | **✓ new** gated | rotate secret, sync now |
| Carrier | ✓ (fees required) | ✓ | ✓ | ✓ | ✓ reach/dry-run | **✓ new** | **✓ new** gated | rotate credentials |
| Meta account | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | FX rate |
| Sheet source | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | sync now |
| WhatsApp | ✓ (new) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Product mapping | ✓ | ✓ | **✓ new** | — | — | — | **✓ new** | backfills open orders |
| City mapping | ✓ | **✓ new** | **✓ new** | — | — | — | **✓ new** | **persists alias (new)** |
| Carrier product mapping | **✓ new** | **✓ new** | **✓ new** | ✓ | — | — | **✓ new** | — |
| Setting | — | ✓ | ✓ | — | — | — | reset to default | history + preview |
| Journal entry | — | ✓ | — | — | — | — | — | replay / relaunch |

---

## 10. UI flows

1. **Connect a storefront** — Connexions → Storefronts → `+ Ajouter` → wizard: *nom → plateforme → **mode d'intégration** → identifiants → récapitulatif*. Webhook mode ends on a reveal-once secret sheet; sync mode ends on a spreadsheet picker + first sync. Row lands as **Jamais utilisé** until the first event.
2. **Resolve an unmatched order** — Connexions → Correspondances (badge) → row → `Lier` → pick product/city → save. Writes the mapping **and** back-fills every open order carrying that external id, so the queue drains rather than repeating.
3. **Retire a carrier** — row ⋯ → `Archiver` (immediate, reversible, appears under the *Archivés* filter). `Supprimer` is enabled only at 0 references; otherwise it is disabled with the count as the reason. Deleting asks the operator to type the carrier name.
4. **Change a setting** — Paramètres → Opérations → edit → the consequence line updates live → `Enregistrer` → `settings_history` row → visible in Journaux → Audit within a second.
5. **Investigate an error spike** — Connexions KPI "Taux d'erreur 24 h" (red) → Journaux → Transporteurs pre-filtered to that carrier + errors → payload inspector → fix credentials in the carrier drawer without losing the filter.
6. **Manager view** — same four pages, "Lecture seule" pill, every mutating control disabled; API rejects writes independently of the UI.

---

## 11. Design guidelines

Follow `docs/design-system.md` — it is authoritative; nothing here overrides it.

**Ground:** page `#F6F6F7`, cards `#FFFFFF` with `1px solid #ECEEF0`, radius 6px (8px for panels), **no shadow at rest**. Sidebar `#0E1013`, active nav item a filled `--brand #15803D` pill.
**Type:** system stack, 14px base. Page title 20/600, section 15/600, body 14/400, meta 13/400 `#6D7175`, table header 13/500 uppercase `0.05em`. Numbers `tabular-nums`, right-aligned.
**Colour:** functional only. Status pairs — success `#008060`/`#F1F8F5`, warning `#B98900`/`#FFF8E6`, critical `#D72C0D`/`#FFF4F4`, action `#2C6ECB`, neutral `#6D7175`/`#F6F6F7`. Green `#15803D` is chrome (CTA, active pill, active tile); `#10B981` is **sidebar only**.
**Rhythm:** 8px base — 24px page padding and section gaps, 16px card padding, 12px card gaps, 8px inline.
**Structure:** header → KPI strip (4–5 tiles, one row, `minmax(200px,1fr)`) → tabs → content. Tables 44px rows, sticky header, hover `#F7F7F7`. Drawers: 480px for forms, 640px for detail-with-tabs, `shadow-panel`, focus trap, Esc.
**State encoding:** never colour alone — every health state is dot + label + colour, so it survives greyscale and colour-blindness.
**Destructive:** only inside the ⋯ menu; red appears only in the confirmation, never on the resting row.
**Empty states:** one sentence + one CTA. A clean mapping queue reads *"Aucune correspondance en attente"* with a checkmark, not an empty grid.
**RTL:** logical properties throughout; the Arabic market mirrors fully.

**Data display (v2):** every KPI tile = uppercase label · hero value (proportional figures) · delta pill · one visual (12-point sparkline with a 10 % area wash, a meter whose track is a lighter step of the same hue, a segmented distribution bar with 2 px surface gaps, or a ring for a ratio) · one-line footer with the "why". Severity is a 3 px left stripe on the tile plus the value colour — never colour alone. Chart neutral is `#8C9196`; `--brand` marks the current period; status colours appear only on the mark that carries state. Rows that need attention get an inset 3 px stripe (`.sev-crit`). Overview groups open with a mini distribution bar of their health mix. Hourly density = 24 stacked columns (errors in critical on top, processed in chart-neutral) with a hover tooltip.

**Reuse, do not rebuild:** `SettingsPageHeader`, `Card`, `Button`, `Badge`, `SegmentedTabs`, `Sheet`, `KpiCard`, `SectionShell`/`SettingField`, `ChangeHistoryPopover`, `ConnectionWizard`, `HealthBadge`, `CarrierHealthBadge`, `useMarketScope`, `jsonFetcher`, and the `LogsWorkspace` table/inspector pattern. The four pages currently written with inline hex (`MarketsSection`, `MarketWorkspaceCard`, `StorefrontsSection`, `CarriersSection`, `MappingsPageClient`) are rewritten onto tokens; `admin/logs` and `settings/general` are the reference implementations.

---

## 12. Data-model and API changes

**No destructive migration.** Additive only:

1. `MarketSettings` — add `after_max_attempts_action`, `after_max_attempts_delay_hours`, `dispatch_cutoff_time`, `auto_archive_after_days`, the six alert thresholds, the four `goal_*` keys, `log_retention_days`; extend `isValidMarketSettings` (cap `max_call_attempts` at **3**).
2. Mark `delivery_fee` / `return_fee` / `packing_cost` `@deprecated` in `MarketSettings`; leave the rows in place. A later cleanup migration deletes them once nothing reads them for a full release.
3. Normalise `assignment_algorithm` to `{"value": …}` on write; one-off migration for the TN row.
4. `storefronts` — add `intake_mode` (`webhook` | `sync` | `import`), backfilled from `platform`; add a CHECK on `platform` after aligning the three lists (include `converty`, `google_sheets`).
5. New `system_audit_log` (actor, entity_type, entity_id, action, before, after, market_id, created_at) written by every connection mutation — `user_audit_log` covers users only.
6. New API: `PATCH /api/markets/[id]`; `POST /api/storefronts/[id]/archive`, `…/carriers/[id]/archive`; `GET …/references` (the count that gates delete); `PATCH|DELETE /api/mappings/products/[id]`, `…/cities/[id]`; `GET|POST|PATCH|DELETE /api/mappings/carrier-products`; `GET /api/admin/logs/syncs`; `GET /api/admin/logs/audit`.
7. Retention cron honouring `log_retention_days`, then restore the retention note.
8. Remove `/settings/statuses` and `GeneralSettingsForm.tsx` (dead since the group redesign) plus its test.

---

## 13. Build order

| Phase | Content | Why first |
|---|---|---|
| **0** | Cap `max_call_attempts` at 3 + fix the two prod rows | Finding #1 is an active agent-blocking bug — ship it before any UI work |
| 1 | Routes, redirects, shell, header, KPI/tab primitives, read-only mode | Everything else mounts on it |
| 2 | Connexions: overview + storefronts + carriers (incl. archive/delete + mode-aware health) | Highest-value surface |
| 3 | Paramètres: new groups, consequence lines, remove Finance + Libellés | Delivers the settings reshape |
| 4 | Correspondances (edit/delete + city alias + carrier products) | Unblocks the SQL-only fixes |
| 5 | Journaux: syncs + audit tabs, date range, retention | Closes the audit gap |
| 6 | Marchés edit, Services incl. WhatsApp placeholder | Lowest urgency |

TDD per `CLAUDE.md`: failing test first. `StorefrontsSection`, `MarketsSection`, `MappingsPageClient`, `LogsWorkspace` and `MetaAdsSection` have **no tests today** — the rewrite is the opportunity to add them.

## 14. Explicitly out of scope

Creating markets · replacing the flat carrier fee with a per-destination rate table · implementing the Meta leads webhook (stays a visible 501) · sending WhatsApp messages (connection UI only) · moving Google Sheets sources out of `settings` into their own table · order-level ad attribution.
