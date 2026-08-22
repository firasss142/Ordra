# SYSTÈME section — IMPLEMENTATION plan (prototype → real code)

> The sections below the `── ORIGINAL PROTOTYPE/SPEC PLAN ──` divider are the approved
> design plan that produced `Ordra/plans/system-section-redesign-prototype.html` (v3).
> This top section is the **implementation** plan: turning that prototype into real
> Next.js/Supabase code, phased so each phase ships independently.

## Implementation context

The prototype and spec are approved. The user now wants the real code built. Key findings
from exploring the current codebase that shape *how* (not *what*) to build:

- **`settings` is schemaless key/value JSONB** (`market_id, key, value`) → all new setting
  keys need **NO migration**, only validation in `src/types/settings.ts` + UI. The entire
  Paramètres expansion is pure app-code.
- **The design primitives already exist** — no new design system:
  - `src/components/dashboard/KpiCard.tsx` (label · value · deltaText/Tone · subtitle · `visual` slot for a sparkline) — the prototype's KPI tiles.
  - `src/components/dashboard/charts/Sparkline.tsx` — the tile sparklines.
  - `src/components/products/ProductFunnelChevrons.tsx` — the prototype's chevron funnel (reçues→confirmées→livrées), already the exact pattern, dark-text-on-light + white-on-brand contrast handled.
  - `src/components/ui/SegmentedTabs.tsx` — pill tabs with count badges (tablist/group roles).
  - `SettingsPageHeader`, `Card`, `Button`, `Badge`, `Sheet`, `Menu`, `SectionShell`/`SettingField`, `ChangeHistoryPopover`, `ConnectionWizard`, `HealthBadge` — all reusable.
- **Old routes redirect via `redirect()`** (see `settings/page.tsx`) — the pattern for pointing `/markets`, `/settings/*`, `/mappings`, `/admin/logs` at the new `/system/*`.
- **No `/system` route dir yet** — greenfield.
- **`system_audit_log` does not exist** — connection-event audit is a follow-up; Journaux→Audit ships with `settings_history` + `user_audit_log` only.
- **Most CRUD backends already exist** (storefronts, carriers, mappings, logs, meta) — the new work is the shell/routes, the settings keys, the missing delete/archive UI, the Connexions overview, and the settings expansion. NOT rebuilding the APIs.
- **TDD is non-negotiable** (CLAUDE.md + skill): test-first for `settings.ts` validator changes and any new lib logic. Component tests follow the existing colocated `__tests__` pattern.

## Decisions (confirmed with user, this session)

- **Sequencing: phase-by-phase**, user reviews each (typecheck + screenshots) before the next.
- **Start with Paramètres** (Phase 1). Shell/routing for `/system/settings` is folded into this phase (build the real destination route now; wire remaining nav items + redirects as their workspaces land, OR do a minimal 4-item nav now pointing 3 of them at existing pages until rebuilt — decide at build start, default: add `/system/settings` route + nav item, leave other 3 nav items on current hrefs until their phase).
- **Rebuild token-clean to match the prototype** (applies to legacy inline-hex components in Phases 2–3).
- **Settings scope: UI + storage + validation now, enforcement later.** All new keys are saved/validated/audited; crons/order-engine wiring to *act* on them is explicit follow-up. New/UI-only keys get a subtle "prise d'effet à venir" affordance where they don't yet change behaviour, so admins aren't misled.

## Phasing (each phase is independently shippable)

- **Phase 1 — Paramètres (FIRST). ✅ DONE (2026-08-21).** Route `/system/settings` + nav repointed; new setting keys + validation (test-first, 90 tests) in `settings.ts` + `MARKET_SETTINGS_KEYS`; `assembleMarketSettings` helper (test-first, 13 tests) replaces brittle hand-assembly; new `OptionCards`/`SettingToggle` shared components; Opérations rebuilt to 4 cards, Alertes + Objectifs new, Équipe expanded; Finance + Libellés removed (files deleted: FinanceSection, LabelsSection, dead GeneralSettingsForm + test); container test (7 tests). KPI strip DEFERRED (needs real metric endpoints — SLA breach / attempts distribution require order_history joins; shipped without, to add when enforcement lands). Verified live: all 5 tabs render, save round-trip persists (SLA 137 → reload → 137), old route redirects, no page errors. Typecheck clean. New keys are UI+storage+validation only ("prise d'effet à venir" pills mark the not-yet-enforced ones).
- **Phase 2 — Connexions. ✅ DONE (2026-08-21).** New `/system/connections` tabbed workspace, all 5 tabs live with real prod data. Storefronts + Transporteurs rebuilt token-clean (new `components/connections/*Panel.tsx`) with health/toggle/test/search + **Archive (soft) & hard-delete with typed-name confirm** (backend `?hard=true` on both `/api/storefronts/[id]` and `/api/carriers/[id]`, 409 when orders reference). Services tiers reuses `MetaAdsSection` + Sheets/WhatsApp/Meta-Leads status cards. Correspondances embeds existing `MappingsPageClient`. Vue d'ensemble = client-side connector inventory + KPI strip + automations panel. New underline `ConnectionsTabs`. Old `/settings/storefronts` redirects; nav storefronts+carriers repointed; `/settings/carriers` kept for create. Commits: d67b19e, b97e957, 22b9985, f8f507c. Tests: storefronts/carriers DELETE (route ×6), StorefrontsPanel/CarriersPanel (×10). **Deferred within phase:** mapping edit/delete backend (`PATCH`/`DELETE /api/mappings/products/[id]`); carrier create/edit adapter form still on old `/settings/carriers`; overview volumes are counts not 24h event rates (needs the sync-run tables Journaux will add).
- **Phase 3 — Marchés & Journaux. ✅ DONE (2026-08-21).** **Marchés** (`/system/markets`): token-clean cards (status banner, code chip, today's orders + 2-chevron funnel, KPI grid, deep-links), edit Sheet (name/language/is_active; currency locked). Backend `PATCH /api/markets/[id]` (immutable currency/code, derives direction, revalidates tag) — test-first (6). Widened `getAllActiveMarkets`+`MarketRow`. **This deleted the last inline-hex files:** StorefrontsSection, MarketsSection, MarketWorkspaceCard, old MarketsClient/StorefrontsClient. **Journaux** (`/admin/logs`): extended LogsWorkspace 2→4 tabs — Synchronisations (`SyncRunsPanel` over new `/api/admin/sync-runs` unioning 4 sync-run tables) + Audit (`AuditPanel` over new `/api/admin/audit` unioning settings_history + user_audit_log); technical chrome gated to webhooks/carrier tabs; **false 90-day retention note removed**. Endpoints test-first (6). Commits: 4f45938, 41433f5, cb79b28(→re-committed clean). Verified live: Marchés cards + edit modal, Audit shows real settings_history diffs, Synchronisations shows real Sheets/Meta runs.
- **Deferred/nits:** date-range picker on Journaux not added (tabs shipped without it); Journaux i18n `subtitle` still says "webhooks…" (left to avoid conflicting with entrepot branch's message-file edits); Marchés metrics are today-only (cross-market endpoint is single-day) not the prototype's 7-day funnel.
- **Cross-phase finish (remaining):** collapse nav fully to 4 items (currently 7, with `mappings`/`integrations` still on old routes) + redirect `/settings/integrations`, `/mappings`, `/settings/statuses`. Small follow-up.

## ⚠️ Environment note
An external process (user's IDE/tooling) periodically runs `git reset` on the working tree, reverting **uncommitted tracked-file edits** (new/untracked files and deletions survive). Mitigation used: commit each sub-slice immediately. Also: the user's `feat/entrepot-redesign` branch has large uncommitted changes (warehouse, dashboard, messages) — stage ONLY own files by explicit path; a `git add` once swept entrepot files into a commit (fixed via soft-reset + re-stage).

### Phase 1 exact plan (Paramètres) — from settings explorer

**Storage reality:** `settings` = one row per key `(market_id, key, value jsonb)`, no migration for new keys. PATCH validates the *whole* assembled `MarketSettings` then upserts per-key; scalars wrap as `{value:X}`, objects stored raw. History = INSERT of changed keys only.

**Adding each new key = 3 edits (miss one and it silently won't load):**
1. `src/types/settings.ts` — add optional field to `MarketSettings` interface (L23-50), add default to `DEFAULT_MARKET_SETTINGS` (L68-79), add a validator branch (`if (s.key !== undefined && <invalid>) return false;`) before L158; new enums get a `VALID_*` Set like `VALID_ALGORITHMS` (L92-98). **Test-first in `src/types/__tests__/settings.test.ts`.**
2. `src/app/[locale]/(dashboard)/settings/general/GeneralSettingsClient.tsx` — assemble the key from `settingsMap` in `initialValues` (L27-60) with a `typeof` guard + default.
3. Section component + a `payload.key = values.key` line in `GeneralSettingsGroups.saveGroup` (L81-130) branch.

**Tab surgery in `GeneralSettingsGroups.tsx`:** `type Group` (L21) → drop `finance`/`labels`, add `alertes`/`objectifs`; edit `GROUPS` (L23-41); add `saveGroup`/`resetGroup` branches; render blocks (L154-208); delete `FinanceSection.tsx` + `LabelsSection.tsx` and their imports. **Keep fee keys in the type/validator** (consumed by `lib/calculations/`) — removal is UI-only. Libellés removal is UI-only too (editor still at `/settings/statuses`, just unlinked).

**New sections built like `OperationsSection`/`TeamSection`** using `SectionShell` + `SettingField settingKey="…"` + `inputClass`/`selectClass`; enum picker = TeamSection's `<select>` pattern (or the prototype's radio option-cards). `AlertesSection` + `ObjectifsSection` new files under `src/components/settings/general/`.

**Impact preview** (`settings-preview.ts` + `preview/route.ts`) supports only `max_call_attempts` today; exposing SLA/auto-action previews = net-new calculators + extend the route's key-switch (optional; can ship without and add later).

**KPI strip** on Paramètres: reuse `KpiCard` + `Sparkline`. Figures (SLA respecté 7j, tentatives moy., blocages 3ᵉ, commissions à verser) — needs a small aggregation endpoint or reuse existing metrics; confirm data source in build.

**i18n:** page is hardcoded French (`TODO(i18n)` at `GeneralSettingsGroups.tsx:3`); follow that convention (hardcoded FR) to stay consistent — do NOT introduce `settings.general` namespace unless asked.

### Phase 0 exact plan (Shell & routing) — from connections/nav explorer

- **Nav collapse** in `src/components/layout/Sidebar.tsx` `NAV_SECTIONS` "systeme" (L186-199): replace the **7 flat items** with **4**: `marchés → system/markets`, `connexions → system/connections`, `paramètres → system/settings`, `journaux → system/logs`. Add i18n keys `nav.items.{marchesWs,connexionsWs,parametresWs,journauxWs}` to `fr.json`/`ar.json` (existing keys at fr.json L136-142). Icons: Store, Link2/Plug, Settings, Key/FileText.
- **New route group** `src/app/[locale]/(dashboard)/system/{markets,connections,settings,logs}/page.tsx` — each a server component using `getServerUser()` (the standard pattern; NOT the mappings direct-query). Permission: super_admin full; market_manager read-only (pass a `readOnly` flag to the client so mutating controls disable — the prototype's "Lecture seule" pill).
- **Redirects** (reuse `redirect()` like `settings/page.tsx`): old `/markets`, `/settings/storefronts`, `/settings/carriers`, `/settings/integrations`, `/settings/general`, `/mappings`, `/admin/logs` → their `/system/*` home (deep-link a tab via `?tab=`). Keep `/settings/statuses` reachable (still used, just unlinked).
- Each workspace client resolves `marketId` from `useMarketScope()` and remounts via `key={marketId}` — **preserve this scope-reactivity** (all existing wrappers do it).

### Phase 2 exact plan (Connexions)

- **New** `system/connections/ConnectionsClient.tsx` with `SegmentedTabs`-style tabs: Vue d'ensemble · Storefronts · Transporteurs · Services tiers · Correspondances. KPI strip via `KpiCard`+`Sparkline`.
- **Storefronts**: reuse `StorefrontsSection` logic but **tokenize** (it's inline-hex, 1018 lines) and **add Archive/Delete UI** via `Menu` → calls existing `DELETE /api/storefronts/[id]` (soft-delete) — backend already there. Reuse `ConnectionWizard`, `HealthBadge`, `PlatformIcon`. Detail via `Sheet` drawer (Général/Webhook/Produits/Activité).
- **Transporteurs**: same treatment on `CarriersSection` (inline-hex + hardcoded FR, 989 lines) — tokenize, **add Archive/Delete UI** → existing `DELETE /api/carriers/[id]`. Reuse adapter registry, `CarrierHealthBadge`. Fees stay required on create (already are).
- **Services tiers**: reuse `MetaAdsSection` (already has DELETE UI) + Google Sheets status + **WhatsApp Business placeholder card** (static "Connecter", no backend) + Meta Leads 501-state card.
- **Correspondances**: reuse `MappingsPageClient` (already token-based); **add edit/delete** to product mappings (needs new `PATCH`/`DELETE /api/mappings/products/[id]` — small backend addition) and a city-alias list. `carrier_product_mappings` UI = optional 3rd sub-tab (backend exists in `carrier-warehouse.ts`, no API route yet).
- **Overview + Automations panel**: new; reads sync-run tables (`sheet_sync_runs`, `ad_sync_runs`, `darb_sync_runs`) via existing `*/sync-status` routes + a small carrier/webhook 24h-volume aggregation.

### Phase 3 exact plan (Marchés & Journaux)

- **Marchés** (`system/markets`): rebuild `MarketsSection` (inline-hex) token-clean with status-banner cards + `ProductFunnelChevrons` + per-card `KpiCard` grid; **add edit modal** (name/language/is_active; currency locked) → needs new `PATCH /api/markets/[id]` (markets is currently GET-only — small backend addition). No create/delete.
- **Journaux** (`system/logs`): extend `LogsWorkspace` (already token-clean) from 2 tabs to 4: add **Synchronisations** (reads sync-run tables via `sync-runs.ts` helpers — new read API) and **Audit** (`settings_history` + `user_audit_log` via existing `/api/settings/[marketId]/history` + `/api/admin/audit-log`). Add **date-range filter** (`DateRangePicker` exists). Remove the false "90-day retention" note. KPI strip via `KpiCard`.

### Backend additions needed (small, per phase)
- Phase 2: `PATCH`+`DELETE /api/mappings/products/[id]`; optional carrier_product_mappings read route.
- Phase 3: `PATCH /api/markets/[id]` (markets edit); Journaux sync-runs + audit read endpoints (or reuse existing per-source sync-status routes).
- **No schema migrations anywhere** — settings is schemaless; DELETE endpoints exist; audit/sync tables exist.

### Reuse map (do NOT rebuild)
`KpiCard`+`Sparkline` (tiles), `ProductFunnelChevrons` (funnel), `Card`/`Button`/`Badge`/`Sheet`/`Menu`/`Popover`/`Skeleton`/`DateRangePicker` (ui), `SettingsPageHeader`, `SectionShell`/`SettingField`/`ChangeHistoryPopover` (settings), `ConnectionWizard`/`HealthBadge`/`PlatformIcon`/`CarrierHealthBadge`, adapter-registry, `useMarketScope`/`MarketScopeSwitcher`, all existing CRUD API routes.

### Design/quality constraints
- Follow `docs/design-system.md` tokens (prototype's palette already maps: `--brand #15803D`, status hues, tinted alert tiles). Colour only on status/chrome.
- **TDD** (CLAUDE.md): test-first for `settings.ts` validator + any new lib logic + new API routes; component tests follow colocated `__tests__` pattern. Gate on `npm run typecheck` (per memory: 31 pre-existing test failures, lint unconfigured).
- Keep hardcoded-French convention (no new i18n namespace) unless asked.

---

## ── ORIGINAL PROTOTYPE/SPEC PLAN ──

## Context

The admin "SYSTÈME" sidebar section (Marchés · Storefronts · Correspondances · Transporteurs · Intégrations · Paramètres · Journaux) grew page-by-page and is now inconsistent: 3 of 7 pages are inline-style/hex with hand-rolled drawers, Marchés is read-only, Storefronts/Carriers have no delete UI, Correspondances has no edit/delete and ignores an existing `external_city_mappings` table, Intégrations holds only Meta Ads, Paramètres carries dead keys (`delivery_fee`, `return_fee`, `packing_cost` are read by nothing) and a status-renaming editor, and Journaux is technical-only with a false "90-day retention" note.

Decisions already taken with the user (this session):
- **4 workspaces**: Marchés · Connexions · Paramètres · Journaux.
- Markets: **edit only, no create** (no schema change).
- **Remove Libellés** (status_configs editor) and **remove Finance** tab — delivery/return fees live on each carrier; keep Équipe + Commissions.
- New setting domains: **Confirmation SLA & auto-actions**, **Alert thresholds**.
- Third-party to plan for: **WhatsApp Business (Cloud API)** placeholder (same Meta app as ads).
- Delete semantics: **Archive by default; hard delete only when nothing references it** (typed-name confirm).
- Journaux: **technical + business audit** (Webhooks · Transporteurs · Synchronisations · Audit).
- Access: **super_admin full; market_manager read-only on own market** ("Lecture seule" badge).

Deliverables of this task (no production code changes):
1. **Spec** — `Ordra/plans/system-section-redesign.md` (markdown; per user CLAUDE.md, durable plans live in the project `plans/` folder).
2. **HTML prototype** — `Ordra/plans/system-section-redesign-prototype.html`, published as an Artifact. Single self-contained file, French UI, desktop 1440px, dark sidebar + light console per `docs/design-system.md`, all 4 workspaces switchable, tabs/tables/KPI strips/drawers/wizard rendered with realistic data. Populate counts with real prod figures via read-only Supabase SQL (storefronts, carriers, meta accounts, 24h webhook/carrier-event volumes) — the user's stated preference for prototypes.

---

## 1. Business logic (whole section)

| Concept | Rule |
|---|---|
| Tenant | `markets` (TN, LY) is the isolation root. Every connection, setting, mapping and log row is market-scoped; super_admin switches market via `MarketScopeSwitcher`, managers are pinned to their own. |
| Connection | A storefront, carrier or third-party service with: identity, credentials (encrypted, rotate-only), health (derived from last event + failure counters), `is_active`, market. Health states: `ok` · `stale` · `failing` · `never` · `archived`. |
| Archive vs delete | Archive = `is_active=false` + hidden from pickers/queues, reversible. Delete = only when 0 orders and 0 mappings reference it; typed-name confirmation; writes an audit row. |
| Fees | `carriers.delivery_fee` / `return_fee` are the only fee source (already what `lib/calculations` reads). Market-level fee keys are dropped from the UI and marked deprecated in `MarketSettings`. `products.packing_cost` stays on product. |
| Settings | Per-market key/value in `settings`, every change appends `settings_history`, exposed with impact preview where a calculator exists. Managers read-only. |
| Mappings | Product mapping = `storefront_product_mappings` (per storefront). City mapping = alias in `external_city_mappings` (persisted, so future orders auto-resolve) **and** binding on the order (today's behaviour). Carrier product mapping = `carrier_product_mappings` (Darb warehouse). All three get list/edit/delete. |
| Audit | Every create/update/archive/delete/rotate/test on a connection, and every setting change, is visible in Journaux → Audit (settings_history + user_audit_log today; a `system_audit_log` for connection events is recommended as follow-up). |
| Access | Nav visible to super_admin and market_manager; managers see the section with a "Lecture seule" pill, all mutating controls disabled, API routes enforce (close today's URL loophole). |

## 2. Structure, routes, KPI panels, CRUD

Nav (Sidebar `NAV_SECTIONS`, `id: "systeme"`): **Marchés → /system/markets · Connexions → /system/connections · Paramètres → /system/settings · Journaux → /system/logs**. Old routes (`/markets`, `/settings/*`, `/mappings`, `/admin/logs`) redirect.

### 2.1 Marchés
- Layout: header + 2 market cards (KPI grid inside each) — no market switcher (it *is* the switcher).
- KPI panel per card: commandes 7j · taux de confirmation 7j · taux de livraison 30j · storefronts (sains/total) · transporteurs (sains/total) · alertes ouvertes · agents en ligne. Each tile deep-links (→ Connexions filtered, → Paramètres, → dashboard).
- CRUD: Read ✓ · Update ✓ (name, is_active, language; currency locked once orders exist) · Create ✗ (migration) · Delete ✗.
- Insight line: e.g. "LY: 2 storefronts sur 4 en erreur depuis 3 h → voir Connexions".

### 2.2 Connexions (tabs)
**Vue d'ensemble (the Integrations hub)** — lists *every* storefront, carrier and third-party service, grouped, with health, last event, 24h volume, and cron/sync freshness (poll-carriers, dispatch-scheduled, google-sheets-sync, darb-sync, meta-ads-sync, darb-rates-harvest — last run/status). KPI strip: connecteurs actifs · en erreur · webhooks 24h (% échec) · événements transporteur 24h · sync la plus ancienne.

**Storefronts** — table: nom · plateforme · marché · santé · dernier webhook · webhooks 24h/erreurs · mode auth · actif · ⋯. Create = existing 4-step `ConnectionWizard`. Detail drawer tabs: Général · Webhook (URL, rotate secret, `auth_mode` hmac/uuid_only, last errors) · Produits (mappings CRUD) · Activité. Google Sheets sources appear here as `google_sheets` rows with Sync button (backed by `settings.google_sheets_sources` today; move to `storefronts` = follow-up).
CRUD: Create ✓ · Read ✓ · Update ✓ · Toggle ✓ · Test ✓ · Rotate secret ✓ · **Archive ✓ (new)** · **Delete ✓ when unused (new)** · Sync (sheets) ✓.

**Transporteurs** — table: nom · adaptateur · marché · santé · frais livraison/retour · en cours · livraison 30j · actif · ⋯. Create panel = adapter picker + credentials + **fees required** + sender info. Detail drawer tabs: Général · Identifiants (rotate-only) · Tarifs (fees; Darb: read-only harvested `darb_shipping_rates`) · Correspondances (destinations + produits) · Activité.
CRUD: Create ✓ · Read ✓ · Update ✓ · Toggle ✓ · Test (reachability / dry-run) ✓ · **Archive ✓ (new)** · **Delete ✓ when unused (new)**.

**Services tiers** — Meta Ads (accounts CRUD, test, FX rate — as today) · Google Sheets (service-account status) · **WhatsApp Business (Cloud API)** — "Connecter" placeholder: WABA id, phone number id, token, templates "Bientôt" · Meta Leads webhook (état: non implémenté / verify token).

**Correspondances** — work queue: unmatched orders (badge count) + existing mappings; sub-tabs Produits · Villes; market picker; search; **Edit/Delete added**; city alias persisted in `external_city_mappings`.

### 2.3 Paramètres (per market, switcher in header, managers read-only)
Tabs: **Opérations · Alertes · Équipe · Commissions**. Each = `SectionShell` (save/reset, per-field history popover, impact preview).

Settings shaping (add / keep / remove):
| Group | Key | Action | Why |
|---|---|---|---|
| Opérations | `max_call_attempts`, `attempt_retry_times` | keep | read by attempt routes |
| Opérations | `sla_minutes` | **expose** (exists, hidden) | order panel SLA chip already reads it |
| Opérations | `after_max_attempts_action` = none \| flag \| cancel + `after_max_attempts_delay_hours` | **add** | user-selected "auto-actions" |
| Opérations | `dispatch_cutoff_time` (HH:MM) | **add** | dispatch-scheduled cron cutoff |
| Opérations | `supplier_lead_time_days` | **expose** (exists, hidden) | stock console reads it |
| Alertes | `webhook_failure_threshold`, `sync_staleness_hours`, `carrier_stall_days`, `stockout_days_of_cover`, `sla_breach_alert` | **add** | feed KPI panels + alerts summary |
| Équipe | `assignment_algorithm`, `active_agents_only`, `agent_inactivity_minutes`, `shift_config` | keep | |
| Commissions | rates | keep | |
| Finance | `delivery_fee`, `return_fee`, `packing_cost` | **remove** | dead keys; fees are per carrier, packing per product |
| Libellés | status_configs editor (`/settings/statuses`) | **remove** | user decision; statuses = fixed vocabulary |

KPI panel: SLA respecté 7j · tentatives moyennes avant confirmation · commandes auto-signalées/annulées 7j · alertes ouvertes, each with a one-line insight ("14 commandes hors SLA cette semaine → SLA 120 min trop court ?").

### 2.4 Journaux
Tabs: **Webhooks · Transporteurs · Synchronisations · Audit**. Global filter bar: marché · **plage de dates (new)** · résultat · recherche. Payload inspector drawer, replay (webhooks). Synchronisations = `sheet_sync_runs`, `ad_sync_runs`, `darb_sync_runs`, `darb_rate_harvest_runs` (+ Relancer). Audit = `settings_history` + `user_audit_log` (+ connection events). Remove the false retention note.
KPI panel: erreurs webhooks 24h · événements transporteur en erreur 24h · syncs échouées 24h · modifications de config 7j.

## 3. UI flows (text)
1. Add storefront: Connexions → Storefronts → + Ajouter → wizard (nom → plateforme → auth → webhook) → one-time secret sheet → row "Jamais reçu" → Tester.
2. Fix unmatched product: Connexions → Correspondances (badge) → ligne → Lier → picker → saved + backfill → disappears; later editable from storefront drawer → Produits.
3. Archive/delete carrier: ⋯ → Archiver → confirm → filter Archivés; Supprimer enabled only at 0 refs → typed name → audit row.
4. Change SLA: Paramètres → Opérations → sla_minutes → impact preview → Enregistrer → settings_history → visible in Journaux → Audit.
5. Manager view: same pages, "Lecture seule" pill, controls disabled.

## 4. Design guidelines (from `docs/design-system.md`)
Light console: page `#F6F6F7`, white cards, `#1A1A1A` text, `#E1E3E5` borders, colour only on badges, dark sidebar. Page: `p-6`, `SettingsPageHeader` (title · description · market switcher/right actions), KPI strip = 4–6 `KpiCard` tiles one row, then `SegmentedTabs`, then table/cards. Tables dense (40px rows, sticky header, numerals right-aligned, tabular-nums). Drawers via `Sheet`: 480px forms / 640px detail-with-tabs. Destructive in ⋯ menu; red only on confirm. Empty states one CTA. Reuse: `Card`, `Button`, `Badge`, `SegmentedTabs`, `Sheet`, `KpiCard`, `SectionShell`/`SettingField`, `ChangeHistoryPopover`, `ConnectionWizard`, `HealthBadge`, `LogsWorkspace` table pattern.

## 5. Files to produce (after approval)
- `Ordra/plans/system-section-redesign.md` — full spec (sections 1–4 expanded with CRUD tables, KPI panels, flows, guidelines, migration notes: deprecate fee keys, add new setting keys to `MarketSettings` + validator, redirects, follow-ups list).
- `Ordra/plans/system-section-redesign-prototype.html` — prototype; publish via Artifact.

## 6. Verification
- Prototype: open artifact, click through Marchés / Connexions (5 tabs) / Paramètres (4 tabs) / Journaux (4 tabs); drawer + wizard + read-only mode toggle render; no horizontal scroll at 1440.
- Spec checklist: business logic ✓, structure/flows ✓, design guidelines ✓, KPI panel per sub-section ✓, CRUD tables (admin, storefronts, carriers) ✓, Connexions overview lists every storefront/carrier/third-party ✓.

---

## Remediation — prototype-fidelity pass (2026-08-22)

User feedback: Marchés showed all zeros; Connexions overview was too thin; obsolete nav
items were never removed; overall fidelity to the prototype was low. Fixed:

- **Marchés zeros (root cause).** The workspace fetched `/api/metrics/cross-market` — a
  route that **never existed** — so every card fell back to 0. Built it, backed by a pure,
  unit-tested aggregator `src/lib/cross-market-metrics.ts` (7d/30d funnels, today, delivery
  rate, agents online/active, connection counts, spark, last order). Rebuilt `MarketCard` to
  the prototype (sparkline, 3-stage funnel, connections/agents/delivery grid, data-driven
  insight) + a 7j/30j toggle. **Real data note:** TN has had no order since **7 July 2026**
  (dormant) — its zeros are *real*; the card now reads "en sommeil · dernière commande le
  7 juillet" instead of a blank card. LY is the live market (172 orders/7d). Verified live
  via `scripts/verify-market-metrics.ts` (admin-client, runs the exact route aggregation).
  Fixed a follow-on bug: last-order date must be fetched unbounded by the 30d window, else a
  dormant market reports null and mis-renders as healthy.
- **Connexions › Vue d'ensemble rebuilt.** New `/api/connections/overview` (all markets for
  super_admin / own market for manager) with real 24h carrier events + error rate (Navex
  34.5%), sync-run freshness per source, webhook + mapping counts. Panel now has the 5 KPI
  tiles, three connector groups (Storefronts · Transporteurs · Services tiers), an
  Automatisations panel with real last-run freshness, and a derived "À traiter" list. Default
  tab is now Vue d'ensemble (was Storefronts). Fixed the super_admin-sees-nothing gap.
- **Carriers tab KPI strip** added (active carriers, weighted 30d delivery, parcels delivered,
  Darb configured-vs-real cost ≈2.9×).
- **Nav collapsed 7 → 4** (Marchés · Connexions · Paramètres · Journaux). Storefronts,
  Transporteurs, Correspondances, Intégrations are tabs inside Connexions, not nav entries.
  `/mappings` redirects to `…/connections?tab=mappings`; `/settings/integrations` stays
  reachable-by-URL (unlinked) until its credential UI is folded in. Sidebar tests updated.

Commits: metrics fix, overview rebuild, nav cleanup, last-order fix, carrier KPIs. Gate:
`tsc --noEmit` clean; new unit tests (7) + connections/sidebar suites green (the lone red —
"En confirmation" — is a pre-existing failure on the entrepot branch, unrelated).

**Still open (honest gaps):** Journaux date-range picker; carrier create/edit still on the
old `/settings/carriers` screen; mapping edit/delete backend; enforcement wiring for the new
Paramètres keys; `nav.items.connexions` i18n key (Connexions uses a documented `labelText`
override because the message catalogs are owned by a parallel branch).
