# Réglages — rebuilding the Système area from zero

Started 2026-10-02. Worktree `.claude/worktrees/reglages`, branch `feat/reglages-redesign` (from `origin/main` 3ea92c5).
Prototype: `prototypes/reglages-v2.html` (Phase 0 — gate before any `src/` change). v1 kept for history; v2 = simple Marchés list, no attention counters.

## Context

The owner asked to redesign and restructure the admin/manager settings — Système › Marchés,
Connexions, Paramètres, Journaux — "from ground 0": professional, neat, organised, easy to
browse, simple, clear words. The area was rebuilt in one day on 2026-08-21
(`plans/system-section-redesign.md`); every September feature then bolted on its own tab or card
without anyone revisiting the structure. What the audit of 2026-10-02 found:

- **Split by technical kind, not by topic.** Everything about delivery lives in four places:
  Connexions › Transporteurs, Paramètres › Opérations « Expédition & suivi », Paramètres ›
  Livraison, Paramètres › Alertes « Colis immobile ».
- **About half the controls do nothing.** 24 of the ~45 Paramètres fields have no reader anywhere
  in `src/` or `supabase/migrations/` (checked key by key, 2026-10-02). Only 5 of them say
  « prise d'effet à venir ». The other 19 look live.
- **No shared kit.** Five tab implementations (one nested inside another), eight copies of the
  same switch, seven save patterns (sometimes three inside one tab), four modal implementations,
  ten card-heading sizes, gradients and resting shadows the design system forbids, Tailwind
  classes that produce no CSS (`bg-status-actionBg`, `bg-neutral-bg`), text-only « Chargement… ».
- **Words.** Code identifiers in help text (`scan_return_in`, `archived_at`, « unverified »,
  `markets.code`, `pg_cron … net._http_response`), English (Storefront, Webhook, SLA, Round
  Robin, Tracking), one thing named two or three ways (Services / Services tiers, Paramètres /
  Réglages, Correspondances / Mappings, Boutiques / Storefronts).
- **Bugs.**
  1. « + Ajouter un transporteur » links to `/settings/carriers`, which redirects back — no one
     can add a carrier or rotate its key (the only form that did, `CarriersSection.tsx`, is
     orphaned).
  2. Scope « Tous les marchés »: Paramètres shows its skeleton forever; storefront/carrier/site
     tables come up empty.
  3. The page never says which market is being edited.
  4. Manager rights contradict the written decision (sidebar comment says read-only; code lets
     managers edit Paramètres and write Correspondances; warehouse sites 403 → shown empty; Meta
     form shown, always 403).
  5. Market card links « Connexions » / « Réglages » don't switch to that card's market.
  6. « Réinitialiser ce groupe » misses `duplicate_autoselect_window_hours`,
     `merge_window_hours`, `delivery_first_action_hours`.
- **Language.** Mostly hardcoded French by an old deliberate choice. Libya is the live market
  (1 665 orders in 30 days; Tunisia has none since 2026-07-07) and its four market managers use
  the app in Arabic — they get Arabic menus around French settings.
- **Market sender on labels.** `markets.sender_name` is "Libya" / "Tunisia" and
  `sender_address` / `sender_phone` are NULL in both markets; `label-prints` prints them. No
  screen edits them.

## Owner decisions (2026-10-02)

1. **One « Réglages » page organised by topic**, Shopify-Settings style: the Système sidebar
   section becomes « Réglages » + « Journaux »; inside Réglages a left menu of topics.
2. **Hide every setting that does nothing** until its feature is built. Values stay in the DB;
   the list below is the backlog.
3. **Market manager edits the day-to-day rules of their own market** (call attempts, duplicates,
   rejection reasons, distribution, goals, risky-parcel thresholds, product/city matching); sees
   shops, carriers, warehouses and WhatsApp read-only; never sees Marchés, commissions, ad
   accounts, credentials or Journaux.
4. **French + Arabic**: every string through next-intl, full RTL.

## Decisions I made as the expert

- **Topic order follows an order's journey**, so the menu explains itself: Marchés → Boutiques
  (an order arrives) → Commandes → Motifs de rejet → Équipe (it is confirmed) → Entrepôts →
  Livraison (it ships) → WhatsApp (the customer is told) → Publicité (what it cost to get it).
- **No tabs inside Réglages.** The left menu is the only navigation; a topic is one scrolling page
  of cards. (Five tab systems and a nested tab row are what made the old area feel scuffed.)
  Journaux keeps tabs — four views of one table — in the soft track + white active pill the owner
  asked for on 2026-09-18.
- **Alertes disappears as a topic.** All six of its thresholds are dead except `carrier_stall_days`,
  which the delivery worklist reads — it moves to Livraison › Colis à risque as « Colis immobile ».
- **Connexions › Vue d'ensemble and the Marchés metrics are dropped, not replaced.** v1 put an
  « À vérifier » list per market and attention counters in the menu; the owner rejected it on
  2026-10-02 (« unimportant to display — keep it simple and elegant »). Marchés is now one quiet
  list (market · team language · currency · state → drawer). A settings screen sets things; it
  does not monitor them. Order funnels and delivery rates stay on the Dashboard.
- **One market at a time, said out loud.** Every market-scoped topic shows the market in the
  header. The super_admin's market control at the top of the menu writes the SAME global scope as
  the sidebar switcher (one state, two places — never two states that can disagree, which was the
  2026-04-26 duplication bug). Scope « Tous » shows a one-line prompt « Les réglages se font marché
  par marché » with the two markets as buttons, instead of a skeleton that never ends.
- **One save model.** Form cards: a contextual save bar appears at the top of the content when
  anything changes (« 2 modifications non enregistrées · Annuler · Enregistrer ») and the PATCH
  sends only changed keys. Lists (shops, carriers, sites, reasons): a row switch acts at once with
  a toast; editing opens a drawer with its own Annuler / Enregistrer. Leaving a topic with unsaved
  changes asks first.
- **Read-only is shown as values, not as disabled inputs**, with one line in the card header:
  « Modifiable par un administrateur ». (Disabled inputs are hard to read and look broken.)
- **Per-field history stays** — a small clock button on each setting row opens who changed what,
  when, from → to (`/api/settings/[id]/history`).
- **Carrier creation comes back** as a drawer on Livraison: type (Darb Assabil / Navex /
  Dexpress, from `listAdapterDescriptors`), name, the type's credential fields, linked site,
  fees. « Personnalisé » (needs a code change) is not offered in the UI.
- **Market edit gains the label sender** (`sender_name`, `sender_address`, `sender_phone`) —
  already printed on labels, never editable. Requires the market PATCH to accept them.
- **Wording rules** (glossary below): no code identifiers, no English where French exists, one
  name per thing, help text says what happens in the product, with the number.
- Journaux moves to `/system/logs` (redirect from `/admin/logs`), stays super_admin only.
  Its payload viewer goes light (the dark `#0F172A` well breaks the "content is light" rule).

## Information architecture

Sidebar › Système: **Réglages** (`/system/settings`, super_admin + market_manager) ·
**Journaux** (`/system/logs`, super_admin).

Réglages routes: `/system/settings/{markets|shops|orders|rejections|team|warehouses|delivery|whatsapp|ads}`;
`/system/settings` opens the first visible topic.

| # | Topic FR · AR | Cards (setting keys) | super_admin | manager |
|---|---|---|---|---|
| 1 | Marchés · الأسواق | one list (market · team language · currency · state); row → drawer: name, language, currency locked, active, label sender | edit | hidden |
| 2 | Boutiques · المتاجر | Boutiques (list, add wizard, drawer: name, platform, reception link, secret, Sheets source) · Produits et villes à associer | edit | shops view · matching **edit** |
| 3 | Commandes · الطلبات | Appels de confirmation (`max_call_attempts`, `attempt_retry_times`, `sla_minutes`) · Doublons et fusion (`duplicate_window_hours`, `duplicate_autoselect_window_hours`, `merge_window_hours`) · Archivage (`auto_archive_after_days`) | edit | edit |
| 4 | Motifs de rejet · أسباب الرفض | one card per group (5 fixed), sub-reasons CRUD, drawer for edit, usage count | edit | edit |
| 5 | Équipe · الفريق | Distribution (`assignment_algorithm` + agent shares) · Objectifs (4 `goal_*`) · Commissions | edit | edit · commissions hidden |
| 6 | Entrepôts · المستودعات | Sites (active, default, warehouse agents, linked carrier) · Réapprovisionnement (`supplier_lead_time_days`) | edit | view |
| 7 | Livraison · التوصيل | Transporteurs (list + drawer: identity, connection test, fees, shipping modes, order options) · Colis à risque (`high_value_threshold`, `risk_min_prior_failures`, `zone_low_delivery_rate_pct`, `zone_min_sample`, `carrier_stall_days`) · Tableau de suivi (`delivery_first_action_hours`, `delivery_done_window_hours`) | edit | carriers view · thresholds **edit** |
| 8 | WhatsApp · واتساب | Connexion du numéro · Messages automatiques (`whatsapp_*`) · Modèles (link to `/messages/templates`) | edit | view |
| 9 | Publicité · الإعلانات | Comptes Meta (test, active, disconnect, connect) · Taux de change (`ad_spend_fx_rates`) | edit | hidden |

## Hidden until they work (24 keys, values kept)

`after_max_attempts_action`, `after_max_attempts_delay_hours`, `callback_max_days`,
`callback_grace_minutes`, `auto_assign_on_intake`, `order_amount_min`, `order_amount_max`,
`unknown_city_policy`, `dispatch_cutoff_time`, `auto_upload_on_confirm`,
`unverified_after_days`, `auto_restock_on_return_scan`, `proactive_call_window_hours`,
`carrier_error_rate_threshold`, `webhook_failure_threshold`, `sync_staleness_hours`,
`stockout_days_of_cover`, `sla_breach_alert`, `max_open_orders_per_agent`,
`agent_inactivity_minutes`, `orphan_reassign_after_minutes`, `orphan_reassign_enabled`,
`outside_hours_policy`, `shift_config`. Also hidden: algorithm options « Par produit » /
« Par région » (disabled « bientôt »), the static Google Sheets « Connecté » card and the Meta
Leads « Non implémenté » card. Re-check each with `grep -rl <key> src supabase/migrations`
before un-hiding: a key comes back the day its first reader ships.

## Glossary (one name per thing)

| Concept | FR | AR | Never |
|---|---|---|---|
| storefront | Boutique | متجر | Storefront, SF |
| webhook URL | Lien de réception des commandes | رابط استلام الطلبات | Webhook URL, Endpoint |
| webhook secret | Clé secrète | المفتاح السري | Secret webhook |
| mapping | Associer (un produit, une ville) | ربط | Correspondances, Mappings, Lier |
| SLA | Délai de confirmation visé | المهلة المستهدفة للتأكيد | SLA |
| round robin | Tour à tour | بالتناوب | Round Robin |
| workload | Selon la charge de chaque agent | حسب ضغط العمل | |
| settings | Réglages | الإعدادات | Paramètres (in new copy) |
| super_admin (in copy) | administrateur | المسؤول | super_admin |
| webhook log | Commandes reçues | الطلبات المستلمة | Webhooks |
| audit | Modifications | التعديلات | Audit |
| replay | Relancer le traitement | إعادة المعالجة | Rejouer |
| payload | Données reçues | البيانات المستلمة | Payload, charge utile |

## Page anatomy (one kit)

Content column `max-w-[1180px] mx-auto`, page padding 24px. Inside: menu 232px + content
(form cards max 760px wide, list cards full width).

- **Header**: title 20/600 (« Réglages » › topic name), one-sentence subtitle that says what the
  topic decides, market chip (« Libye ») on market-scoped topics.
- **Card**: white, 1px `line-subtle`, 8px radius, no shadow. Head = 16/600 title + 13px
  description + optional right slot (lock line or action). Body = setting rows.
- **Setting row**: label 14/500 + help 13px secondary on the start side; control on the end side
  (number input with unit inside, switch, option cards, time slots); history clock button.
  Values read-only = plain text.
- **List card**: table with 13/500 secondary headers, 14px cells, row → drawer, switch column,
  ⋯ menu (`ui/Menu`). Filter as soft pill track. Empty state with an icon, a sentence, an action.
- **Drawer**: `ui/Sheet` end, 480px, header band, scrolling body of sections, sticky footer.
- **Save bar**: sticky at the top of the content, appears only when dirty.
- Loading: `ui/Skeleton` shapes, never text.

New shared primitives (in `src/components/ui/`, tested): `Switch`, `Field` (label + help +
control + error, `htmlFor` wired), `NumberInput` (unit adornment, min/max), `EmptyState`.
Settings-local kit in `src/components/settings/kit/`: `SettingsShell` (menu + header),
`SettingsCard`, `SettingRow`, `SaveBar`, `ReadOnlyValue`, `HistoryButton`.

## Data / API changes (small, deliberate)

- `PATCH /api/settings/[marketId]`: accept a partial object (changed keys only); for
  `market_manager` allow only the day-to-day key list (server-side whitelist — RLS can't restrict
  keys; see [[users-rls-column-blind-escalation]]).
- `PATCH /api/markets/[id]`: accept `sender_name`, `sender_address`, `sender_phone`.
- `GET /api/admin/warehouse-sites`: allow market_manager on own market (read).
- Carrier create: reuse `POST /api/carriers` + `GET /api/carriers/adapters`.
- No migration expected. If one appears, REVOKE before GRANT ([[drop-function-resets-grants]]).

## What the real-data dry run found (prototype, 2026-10-02)

Feeding the prototype production data exposed things no screen shows today:

- **Libya has received no order since 2026-09-29 15:30** (normally ~55/day; 1 656 of the
  1 665 orders in 30 days came from « Converty Libya (Sheets) »). Worth checking the Sheets sync
  now, independent of this redesign.
- **Benghazi site is active while its carrier « Darb Assabil — Benghazi » is inactive** — yet
  that carrier shipped 136 parcels in 30 days, so it was switched off recently.
- **Tunisia: 2 active carriers with no fees** (Cosmos, TestCarrier3); site Tunis has **no
  warehouse agent**; no order since 2026-07-07.
- **5 of 7 active Libyan shops are silent** (> 14 days); 4 look like test shops (Test, bard,
  easyorders-firas-dev, MyStore).
- **`storefronts.last_webhook_received_at` is not "last order"**: the Sheets shop that sends
  99 % of Libya's orders has never received a webhook. « Dernière commande » must come from
  `orders`, not from the webhook columns.
- **`settings_history` has gaps and noise.** Tunisia `sla_minutes` is 120 but its only history
  row says → 137; Tunisia's algorithm went round_robin → manual (May) then workload → manual
  (Aug) with no row for the change in between; Libya has `manual → manual` rows from a format
  migration. The history popover must hide no-op rows, and the save path must always write
  history (find the writer that bypasses it).
- **`orders.mapping_status = 'unmatched'` is stale on 3 868 Libyan orders** that were processed
  normally; the real review queue (pending/unverified only) is empty. Nothing should count
  that column as "work to do".
- Libya's dead `shift_config` says `Africa/Tunis`. Hidden anyway; fix the value when business
  hours are built.

## Phases

0. **Prototype** `prototypes/reglages-v1.html` — every topic, both roles, fr/ar, the states
   below. Owner review. **No `src/` change before approval.**
1. Kit + shell: primitives (TDD), `SettingsShell`, routes, redirects (`/system/connections?tab=*`,
   `/system/markets`, `/settings/*`, `/mappings`, `/admin/logs`), sidebar (2 entries), market
   context + « Tous » prompt, i18n namespace `reglages.*` (fr + ar, parity test).
2. Topics, one commit each, in menu order; each copies its prototype section exactly.
3. Journaux restyle + move.
4. Delete orphans (`settings/CarriersSection`, `settings/TeamSection`, `UsersSection`,
   `StatusLabelWysiwyg`, `GoogleSheets*` widgets, `IntegrationGuidePanel`, old Paramètres
   sections, `/settings/integrations`, `/settings/statuses` — confirm with owner first), update
   CLAUDE.md navigation + docs that cite old placements (carrier settings, rejection reasons,
   distribution, WhatsApp).

Conflict to watch: the main checkout has uncommitted edits to
`RejectionReasonsSection.tsx` and the rejection-reasons routes (another session). Rebase on
`origin/main` before Phase 2 topic 4.

## Verification

- `npm run test:run`, `npm run typecheck`, `npm run build` in the worktree (lint is a no-op here —
  [[npm-run-lint-does-nothing]]).
- Unused-key audit: every `reglages.*` key in fr.json is referenced in `src/`
  ([[prototype-is-the-spec]]).
- Browser pass as super_admin (fr) and `manager.ly` (ar): every topic, scope « Tous », dirty save
  bar, read-only cards, add carrier, edit reason, history popover.
- Section-by-section diff against the prototype before calling a topic done.
