
# Suivi livraison — rebuild of `/follow-ups` + `/in-delivery` (and the leads direction)

Brainstormed and decided 2026-09-12. Phase 0 copies this file to `plans/suivi-livraison.md` in the
project (user CLAUDE.md rule: the project copy is the source of truth).

## Context

After upload an order leaves the agent's world: the agent queue stops at `dispatch_scheduled`, the
in-delivery page redirects agents, and the team control room's doctrine is "upload is the outcome".
Commissions already pay on `delivered`. So agents are paid for delivery, measured on upload, and have
no screen where a shipped parcel exists. Meanwhile the agent is the only person who calls the
customer, the courier or the Darb branch, today from a personal phone with no trace.

The old follow-ups page was a manually created sidecar note per order. Its June "time-first"
redesign never worked (the due date cannot be saved, outcomes are never persisted), 600 lines are
unimported, and production holds 665 follow-ups all created in one bulk write in April. Three
unrelated "follow up" mechanisms coexist (`order_follow_ups.due_at`, `orders.callback_scheduled_at`,
`orders.needs_carrier_followup`). Darb already mirrors who holds the parcel and why it is stuck
(`darb_shipments.handler_*`, `latest_remark`, `delayed_until`) every 10 minutes, and
`promote_darb_status` throws the remark away.

Outcome: one agent-facing post-upload worklist ("Suivi livraison", route `/delivery`) ranked by what
to do next, with structured append-only delivery actions, a real `customers` entity, a rule-based
courier-remark classifier, a proactive-call task on risky parcels, an agent delivery scorecard, and a
manager board that replaces `/in-delivery`. Old code and tables are deleted, not patched.

## Decisions (locked with the owner, 2026-09-12)

1. Ownership: the confirming agent keeps their own orders until terminal. No new role.
2. The list starts at `uploaded`, ends at `delivered` / `returned` (cancelled, rejected also terminal).
3. The three real actions become traceable: call customer, call courier or branch, WhatsApp customer.
4. WhatsApp v1 = prefilled `wa.me` links with FR/AR situation templates, logged as an action. The
   official Business API is a separate later decision.
5. Libya first, designed around the Darb mirror. Tunisia is paused (no order since 2026-07-07);
   the page must not break on Navex data, and gets no Tunisia-specific design work.
6. Load: 20 to 60 live parcels per Libyan agent. Buckets with an explicit "act now" group; waiting
   on carrier collapsed by default.
7. Bucket priority: returning (a branch call usually earns a re-attempt) > act now > waiting on
   customer > waiting on carrier > done in the last 24 h.
8. Proactive call only on risky parcels when they go out for delivery. Risk inputs, only these:
   repeat-risk customer, high order value (market setting), destination with low delivery rate
   (new aggregate). First-time customer is deliberately not a risk input.
9. `customers` entity now, as the foundation for this page and for the leads rebuild.
10. Manager v1 = full replacement of `/in-delivery`: cross-agent list, overdue-by-agent, courier
    scorecard from Darb handler data, carrier rate cards, Darb control room folded in.
11. Agent scorecard on the page: delivery rate 30 d, in flight, deliveries saved. Team control room
    doctrine change is a separate later plan.
12. Design: a brand-new visual language for the agent side, specified as tokens + a static prototype
    and approved before any React. Manager view stays on the Shopify light console.
13. AI is out. The action log, the templates and the per-order next action are its future substrate.
14. Delete, do not patch: old follow-ups + in-delivery code, tables, routes, i18n, nav entries.
15. Real return causes in Libya, all four: customer unreachable when the courier calls, refuses at
    the door, address or zone wrong, courier did not really attempt. Courier remarks in production
    cluster into a handful of meanings and become the structured delay reason.

Leads decisions are recorded at the end; the detailed leads plan comes after this rebuild ships.

## Prerequisites (outside this plan)

- **Stale uploads cleanup.** 391 Libyan orders sit in `uploaded` with 7-digit pre-sticker tracking
  numbers and no Darb shipment, all touched by one bulk write on 2026-09-09. One agent would open the
  new page to 267 dead rows. Archive or re-book them before launch. The page assumes every uploaded
  order has a carrier shipment or is younger than `carrier_stall_days`.
- Existing follow-up data is not migrated. Before the drop migration, dump `order_follow_ups` and
  `order_follow_up_entries` to a file the owner keeps outside the repo (they hold customer names and
  phones; nothing of the kind is committed to git).

## Implementation

Working slug: `delivery`. Routes `/[locale]/delivery`, `/api/delivery/*`, i18n namespace `delivery`,
components `src/components/delivery/`, lib `src/lib/delivery/`.

### Data model

Every new table: `market_id NOT NULL`, RLS, no client-side UPDATE/DELETE policies.

**`customers`** — one row per normalized phone per market.
`id, market_id, phone_normalized (= normalize_phone(customer_phone)), phones text[], name,
last_address, last_city, last_city_id, last_darb_destination_id, orders_count, delivered_count,
returned_count, rejected_count, cancelled_count, risk_class CHECK IN ('none','repeat','risk'),
first_order_at, last_order_at, created_at, updated_at`, `UNIQUE (market_id, phone_normalized)`.
RLS select = super_admin, or same market for market_manager / agent / warehouse_agent. Writes only
through SECURITY DEFINER functions.

- `orders.customer_id uuid REFERENCES customers(id) ON DELETE SET NULL` + index. Functional index
  `(market_id, normalize_phone(customer_phone))` on orders (`normalize_phone` is IMMUTABLE, from
  `supabase/migrations/20260611000001_repeat_buyer_rpc.sql`).
- **BEFORE INSERT OR UPDATE OF customer_phone, customer_phone_2** trigger on orders sets
  `NEW.customer_id` (upserting the customer). No second UPDATE on orders, so neither the lock guard
  nor the broadcast trigger re-fires.
- **AFTER INSERT OR UPDATE OF status, customer_address, customer_city** trigger calls
  `refresh_customer_stats(customer_id)` (recount from orders via the `customer_id` index, set
  `risk_class = customer_risk_class(...)`). Column lists deliberately omit `carrier_status_*`,
  `updated_at`, `tracking_number` so the Darb sweep pays nothing.
- `customer_risk_class(orders_count, delivered, returned, rejected)`: `risk` when
  `orders_count >= 2 AND (returned + rejected) / NULLIF(delivered + returned + rejected, 0) >= 0.5`;
  `repeat` when `orders_count >= 1`; else `none`. This adds returns to the rejection-only rule in
  `src/lib/customer-history/classify.ts`; that TS rule is aligned in the same phase so
  `RepeatBuyerBadge` and the table agree (some badges will flip from repeat to risk; announce it).
- Backfill migration in one transaction: insert distinct `(market_id, normalize_phone(phone))` from
  orders, set `orders.customer_id`, refresh all stats.

**`delivery_actions`** — append-only ledger.
`id, market_id, order_id (FK, ON DELETE CASCADE), customer_id, actor_id, actor_type CHECK IN
('agent','manager','system'), action_type CHECK IN ('call_customer','call_courier','call_branch',
'whatsapp_customer','note','proactive_call_task'), channel CHECK IN ('phone','whatsapp','none'),
outcome CHECK IN ('reached_will_receive','reached_reschedule','reached_wants_cancel',
'reached_address_fix','no_answer','wrong_number','phone_off','reattempt_promised',
'courier_no_answer','parcel_located','return_confirmed','info_passed','sent','pending','expired',
'none'), note text (≤ 500), template_key, next_action_at, status_at_action order_status,
carrier_slug_at_action, remark_class_at_action, created_at`.
Indexes: `(order_id, created_at DESC)`, `(market_id, actor_id, created_at DESC)`, partial
`(market_id, next_action_at) WHERE next_action_at IS NOT NULL`. Append-only via the existing
`public.ledger_append_only()` trigger function (`20260922000001_scan_rpc_hardening.sql`). RLS select
= super_admin / same market for managers / for agents rows on orders they own. No INSERT policy:
inserts go through `record_delivery_action` only. The `*_at_action` snapshots make "deliveries
saved" computable without replaying history. No new columns on `orders`.

**Remark classification** on `darb_shipments`: `remark_class CHECK IN ('no_answer',
'customer_cancelled','not_needed','coordinated','out_of_coverage','office_pickup','not_serious',
'rescheduled','other','none') DEFAULT 'none'`, `remark_class_source` (`latest_remark |
latest_comment | cancellation_cause`), `remark_classified_at`, partial index on actionable classes.
Computed in TypeScript on every sync and written by the existing upsert.

**`delivery_zone_stats`** `(market_id, zone_key, zone_label, delivered_count, returned_count,
sample, delivery_rate, window_days, computed_at, PK (market_id, zone_key))`. `zone_key` =
`darb:<darb_destination_id>` (Libya), `city:<city_id>` (Tunisia), fallback `name:<lower city>`.
Refreshed by `refresh_delivery_zone_stats()` over orders with `terminal_at >= now() - 90 days` and
status delivered/returned, pg_cron `delivery-zone-stats-nightly` at `17 2 * * *`. RLS read = same
market.

**Settings** — new `MarketSettings` keys in `src/types/settings.ts` (keys list, validator, defaults,
and the Paramètres › Général form): `high_value_threshold` (0 = off), `zone_low_delivery_rate_pct`
(default 60), `zone_min_sample` (20), `risk_min_prior_failures` (1), `proactive_call_window_hours`
(4), `delivery_done_window_hours` (24). Existing `carrier_stall_days` (5) and `unverified_after_days`
(5) finally get read. SQL reads through a helper `delivery_setting_int(p_market_id, p_key,
p_default)` following the idiom in `015_session9_no_response_rpc.sql`.

**Dropped** (drop, not rename: the rows drove no decision and the FK without ON DELETE would keep
blocking `manual_delete_orders`): tables `order_follow_ups`, `order_follow_up_entries`; enum
`follow_up_status`; view `follow_up_campaigns`; functions `create_order_follow_up`,
`transition_follow_up_status`, `rpc_transition_follow_up_status`, `follow_ups_status_counts`,
`follow_ups_overdue_by_agent`, `bulk_create_campaign_follow_ups`; trigger
`trg_sync_follow_up_status` + `sync_follow_up_status_columns()`; `orders.needs_carrier_followup` +
its index; `status_configs` rows with `scope = 'follow_up'` and the CHECK narrowed to `('prospect')`;
`order_follow_ups` removed from the realtime publication.

### Server logic

- **`record_delivery_action(p_order_id, p_action_type, p_channel, p_outcome, p_note,
  p_next_action_at, p_template_key, p_actor_id, p_actor_type) RETURNS delivery_actions`** —
  SECURITY DEFINER. Order must be in flight (`uploaded` onward, plus `received`) or terminal within
  `delivery_done_window_hours`; agent caller must be `assigned_to`; manager same market; NULL actor
  only for `system`. Snapshots status, carrier slug, remark class. Marks open delivery-kind
  `agent_notifications` for the order as read. Never writes `orders` (agents are RLS-blocked on
  orders past `uploaded`, which is why this function exists).
- **`evaluate_delivery_risk(p_order_id) RETURNS jsonb {risky, reasons[]}`** — STABLE. Reasons:
  `repeat_risk` (customer `returned_count + rejected_count >= risk_min_prior_failures`),
  `high_value` (`total_price >= high_value_threshold > 0`), `low_zone` (zone row with
  `sample >= zone_min_sample AND delivery_rate * 100 < zone_low_delivery_rate_pct`).
- **Proactive task** — trigger on `order_history AFTER INSERT WHEN status_to = 'out_for_delivery'`
  → `create_proactive_call_task()`: if risky and no open task, insert a system
  `proactive_call_task / pending` action with `next_action_at = now()` and an
  `agent_notifications(kind = 'proactive_call_due')`. Hooking `order_history` keeps
  `promote_darb_status` untouched. Expired by `run_notifications_check()` after
  `proactive_call_window_hours` by inserting a system row with `outcome = 'expired'`.
- **Remark classifier** — `src/lib/carriers/darb-remark-classifier.ts`:
  `classifyRemark({latestRemark, latestComment, cancellationCause}) → {class, source}`, ordered
  regex tables in AR / EN / FR built from the production corpus ("3 days no response", "لا يرد",
  "Cancelled by the customer", "No longer needed", "تم التنسيق", "يستلم اليوم/غدا", "استلام
  فالمكتب", "خارج التغطية", "غير جاد"). Called from `shipmentRow()` in
  `src/lib/carriers/darb-sync-cycle.ts`. Corpus fixture under `src/lib/carriers/__tests__/`.
- **`get_delivery_worklist(p_market_id, p_agent_id DEFAULT NULL)`** — SECURITY INVOKER (RLS is the
  isolation), one query: orders in scope, `LEFT JOIN darb_shipments ON order_id`, customers, lateral
  last agent action, lateral open task, zone stats, settings read once in a CTE. Returns
  order/customer/courier/last-action columns plus `bucket`, `reason_codes[]`, `hours_on_status`,
  `is_risky`, `risk_reasons`. Bucket, first match wins:
  1. `done`: terminal and `terminal_at >= now() - done_window`.
  2. `returning`: status in (`returning`, `to_be_returned`, `received`) or Darb slug `returning`.
  3. `act_now`: actionable remark class newer than the last agent action; or status
     `delivery_delayed` / `unverified` with no agent action since the carrier event; or an open
     proactive task; or `next_action_at <= now()`; or stalled (`latest_event_at`, else
     `carrier_status_synced_at`, else `updated_at`, older than `carrier_stall_days`).
  4. `waiting_customer`: `next_action_at > now()`.
  5. `waiting_carrier`: everything else; `uploaded` / `scanned` shown as "à l'entrepôt" inside it.
- **`get_delivery_agent_scorecard(p_agent_id, p_market_id)`** — `delivery_rate_30d =
  delivered / (delivered + returned)` on orders with `assigned_to = agent` and `terminal_at` in the
  window (ownership attribution, per decision 1; the commissions "last confirmed transition" rule
  stays the stricter variant for pay), `in_flight_now`, `saved_30d` = delivered orders with at least
  one agent action whose snapshot was `returning` / `delivery_delayed` or remark class `no_answer`.
- **`get_delivery_courier_scorecard(p_market_id, p_days DEFAULT 30)`** — per `handler_phone` over
  `darb_shipments JOIN carriers ON carrier_id` scoped by `carriers.market_id`: name, held now,
  delivered in window, returning now, no-answer remarks now.
- **`get_delivery_carrier_rates(p_market_id)`** — 30-day delivered / returned per carrier from
  `order_history`, ported from the in-delivery summary route.
- Overdue-by-agent is derived in the board route from worklist rows (`act_now` grouped by agent).
- **Realtime**: trigger `delivery_broadcast_change()` (SECURITY DEFINER, same shape as
  `orders_broadcast_change`) on `darb_shipments AFTER UPDATE` when status_slug, latest_remark_at,
  handler_phone, remark_class or delayed_until change, and on `delivery_actions AFTER INSERT`,
  sending `{op, order_id, market_id, assigned_to, remark_class, next_action_at}` on topic
  `delivery:market:<uuid>`. Never the `orders:market:` prefix (its read policy uses LIKE). Policy
  `delivery_broadcast_read` on `realtime.messages` mirrors `orders_broadcast_read`.
- **Notifications**: widen `agent_notifications_kind_check` (currently callback_due, attempt_due,
  dispatch_due) with `proactive_call_due`, `delivery_action_due`, `parcel_returning`,
  `courier_remark`. `run_notifications_check()` inserts `delivery_action_due` when the latest
  action's `next_action_at <= now()` and expires proactive tasks; `resolve_stale_notifications()`
  resolves when a later agent action exists or the order is terminal. `parcel_returning` comes from
  the `order_history` trigger on `status_to = 'returning'`; `courier_remark` from the
  `darb_shipments` trigger when `remark_class` enters an actionable class.

### API routes and hooks

Identity via `getActor` (`src/lib/auth/actor.ts`); RLS client everywhere.

| Route | Roles | Returns / body | Hook |
|---|---|---|---|
| `GET /api/delivery/worklist?agent_id&market_id` | agent (own id forced), market_manager (own market, optional agent), super_admin | `{rows, counts, settings, generated_at}` | `useDeliveryWorklist` (SWR; 60 s poll only while `useBroadcastConnected()` is false) |
| `GET /api/delivery/orders/[id]` | agent (owner), managers | `{order, customer, shipment, timeline (order_history + darb_timeline_events + darb_conversation + delivery_actions merged), actions, risk}` | `useDeliveryOrder` |
| `POST /api/delivery/orders/[id]/actions` | agent (owner), managers | `{action_type, channel, outcome, note?, next_action_at?, template_key?}` → 201 row; 409 when out of scope | `useDeliveryAction` (mutation, pattern of `useOrderMutation`; optimistic bucket move, then revalidate) |
| `GET /api/delivery/scorecard` | agent | scorecard jsonb | `useDeliveryScorecard` |
| `GET /api/delivery/board?market_id` | managers | `{overdue_by_agent, courier_scorecard, carrier_rates}` | `useDeliveryBoard` |
| `GET /api/darb/control-room` | unchanged | | `useDarbControlRoom` (kept) |

`useDeliveryRealtime({marketId, agentId, mutateKeys})` subscribes to `ordersTopic(marketId)`
(`src/hooks/useOrdersRealtime.ts`) for status / assignment moves and to `delivery:market:<id>`;
coalesced mutate as in `src/hooks/useAgentQueueRealtime.ts`.

WhatsApp templates are static: `src/lib/delivery/whatsapp-templates.ts` with
`buildWaLink(phone, templateKey, vars, locale)` → `https://wa.me/<E.164>?text=…`, phone through
`normalizePhone` (`src/lib/leads/phone.ts`) plus the market prefix (`src/lib/markets.ts`). Texts under
`delivery.templates.*` in FR and AR. Keys: `before_delivery`, `courier_no_answer`,
`delayed_confirm_time`, `returning_last_chance`, `address_check`. Each send is logged as
`whatsapp_customer / sent` with the template key.

### UI

**Design phase first, no React before approval.** Deliverables: `docs/design/agent/README.md`
(tokens, type scale, bucket and reason hue vocabulary, row anatomy, RTL rules, motion),
`prototypes/suivi-livraison-v1.html` (self-contained, FR/AR toggle, phone and desktop widths, all
five buckets, drawer, action sheet, template picker, empty / loading / error states),
`plans/suivi-livraison-ux-critique.md` (critique of the current agent chrome + decisions table, same
shape as `plans/warehouse-agent-ux-critique.md`). New tokens land as `--ag2-*` under an
`.agent-theme-v2` scope that remaps the shared semantic tokens like `.agent-theme` does in
`globals.css`; queue and leads keep `.agent-theme` until their restyle, when `.agent-theme` is
redefined to the v2 values and the suffix goes.

**Agent page** — `src/app/[locale]/(dashboard)/delivery/page.tsx` (server role gate →
`DeliveryWorklistClient` for agents, `DeliveryBoardClient` for managers, warehouse → `/warehouse`).
`AgentTabsContainer` gains a `delivery` tab (rendered through `children` like `commissions`);
`AgentNavTabs` swaps the follow-ups entry for `/delivery` with a Truck icon and prefetch of the
worklist; `AgentDashboardShell.onQueueTab` excludes `/delivery`.

Components in `src/components/delivery/`: `DeliveryWorklistClient`, `DeliveryScorecardStrip` (rate
30 d, in flight, saved), `DeliveryBucketStrip` (five chips, act-now emphasized, waiting-carrier
collapsed by default), `DeliveryBucketSection`, `DeliveryOrderRow` (name, city/area, product × qty,
total to collect, status pill, `DeliveryReasonChip`, courier name, hours on status, next action,
`RepeatBuyerBadge`, risk mark), `DeliveryOrderDrawer` with `CourierBlock` (handler + `tel:` links in
the RTL isolates used by `DarbControlRoom`, remark + class, `delayed_until`, `resend_count`, branch
group), `CustomerBlock` (phones, WhatsApp button, address, customer counts), `DeliveryTimeline`
(merged; reuses `displayTimeline` / `eventHue` from `src/lib/carriers/darb-shipment-display.ts` and
`formatTime` from `lib/format`), `DeliveryActionsList`, `DeliveryActionSheet` (step 1 action type;
step 2 outcomes per type, exactly the CHECK list: customer → reached_will_receive,
reached_reschedule, reached_wants_cancel, reached_address_fix, no_answer, wrong_number, phone_off;
courier / branch → reattempt_promised, courier_no_answer, parcel_located, return_confirmed,
info_passed; step 3 note + next-action quick picks +2 h / tomorrow 10:00 / custom),
`WhatsAppTemplatePicker` (situation-filtered, opens `wa.me`, then logs the send).

States: skeleton rows per bucket; per-bucket empty line; route error banner with retry; "hors ligne"
pill when broadcast is disconnected (poll active). RTL: full mirror, phone digits isolated,
`text-end` on numerics, drawer from the inline-end side.

**Manager page** — same route, `DeliveryBoardClient` on the existing light console
(`docs/design-system.md`): market scope from `useMarketScope`; `DeliveryAgentFilter`; the same bucket
sections cross-agent with an agent chip per row; `DeliveryOverdueByAgentTable`;
`CourierScorecardTable`; `CarrierRateCards` (port of `CarrierSplitCards`); `DarbControlRoom` moved to
`src/components/delivery/`. Sidebar: `livraison` group = `carrierTracking` + `deliveryBoard`
(`href: "delivery"`); `clients` group keeps `activeProspects` only.

### Deletion list

Files: `src/app/[locale]/(dashboard)/follow-ups/**`, `src/app/[locale]/(dashboard)/in-delivery/**`,
`src/app/api/follow-ups/**`, `src/app/api/in-delivery/**`, `src/app/api/orders/[id]/escalate-carrier/**`,
`src/app/api/customers/search/route.ts`, `src/components/follow-ups/**`, `src/components/in-delivery/**`
except `OrderTimeline.tsx` + test (moved to `src/components/orders/`, `TrackingSection.tsx` import
updated) and `DarbControlRoom.tsx` (moved to `delivery/`), hooks `useFollowUps`, `useFollowUpDetail`,
`useFollowUpsColumn`, `useFollowUpsRealtime`, `useFollowUpsSummary`, `useFollowUpsTimeline`,
`useOverdueByAgent`, `useInDeliverySummary`, `useCustomerSearch`, `src/lib/follow-ups/**`,
`src/lib/follow-up-permissions.ts` + test, `src/types/follow-up.ts` + test. Strip
`needs_carrier_followup` from `src/app/api/orders/[id]/timeline/route.ts` + test.

i18n: remove `crm.followUps`, `inDelivery`, `nav.followUps`, `nav.inDeliveryBoard` in `fr.json` and
`ar.json`; add `nav.delivery`, `nav.deliveryBoard`, namespace `delivery`. Nav: `AgentNavTabs`
follow-ups entry, `AgentTabsContainer` follow-ups branch, Sidebar `followUps` + `inDeliveryBoard`, the
comment in `src/middleware.ts` near line 290. `src/lib/role-permissions.ts`: add `/delivery` for
agent, market_manager, super_admin. DB: the "Dropped" list above. Redirects in `next.config`:
`/:locale/follow-ups/:path*` and `/:locale/in-delivery/:path*` → `/:locale/delivery`
(non-permanent; remove after a year).

## Phases (execution order, one exit criterion each)

0. Save this plan as `plans/suivi-livraison.md`. Exit: committed.
1. **Design.** Tokens doc, prototype, critique plan. Exit: owner approves the prototype in FR and AR
   at phone and desktop widths. No React written.
2. **Data foundation.** Migrations in order: `customers` + backfill + link triggers;
   `delivery_actions` + `record_delivery_action` + append-only; `darb_shipments.remark_class` + TS
   classifier wired into the sync; `delivery_zone_stats` + cron; settings keys (types, validator,
   form); `evaluate_delivery_risk` + proactive-task trigger; worklist / scorecard / courier / carrier
   RPCs; broadcast topic + policy; notification kinds + cron functions. Exit: the worklist returns
   the expected bucket for each seeded scenario; RLS and append-only SQL checks pass;
   `darb_sync_runs` durations unchanged.
3. **Agent page.** Routes, hooks, components, tabs, bell. Exit: `agent1.ly` sees the buckets, records
   each action type, opens a WhatsApp link, sees a row move on a simulated carrier event without
   reload.
4. **Manager page.** Board route, components, sidebar. Exit: `manager.ly` filters by agent, sees
   overdue-by-agent, courier scorecard, rate cards, control room; `manager.tn` sees the Tunisia list
   with status and timing only.
5. **Deletion + redirects.** The deletion list and the drop migration. Exit: `npm run typecheck`,
   `npm run lint`, `npm run test:run`, `npm run build` clean; old URLs redirect; no `*follow*` tables.
6. **Docs.** `docs/delivery-worklist.md` (model, buckets, settings, classifier, how to re-check),
   one CLAUDE.md line under References, and an amendment to the design rule pointing at
   `docs/design/agent/README.md`. Exit: reviewed.

TDD applies to every phase (`.claude/skills/test-driven-development/SKILL.md`): failing test first.

## Tests (write first)

- Phase 2, SQL in `supabase/tests/` (existing pattern, e.g. `scan_order_out.atomicity.test.sql`)
  and Vitest with `src/test/helpers/`: customers backfill (one row per phone per market, `customer_id`
  set, counts equal a recount); customers RLS (LY agent cannot read a TN customer); delivery_actions
  append-only (UPDATE / DELETE raise, even as service role); `record_delivery_action` (non-owner
  agent forbidden, out-of-scope status errors, snapshots populated); remark classifier (every corpus
  line → expected class, unknown → other, empty → none); risk evaluation (first-time customer never
  risky, each reason in isolation, thresholds read from settings not defaults); proactive task
  (risky out-for-delivery inserts task + notification, non-risky nothing, second promotion
  idempotent); worklist (one fixture per bucket rule, precedence done > returning > act_now >
  waiting_customer > waiting_carrier, stall reads `carrier_stall_days`, agent param ignored for the
  agent role, a Tunisia order with no Darb row lands in waiting_carrier without error); scorecard
  (rate excludes cancelled; saved counts only qualifying snapshots); courier scorecard (market
  isolation through `carriers.market_id`); notifications check (new kinds inserted, resolved,
  expired); broadcast (payload shape; topic never `orders:market:`).
- Phase 3: whatsapp templates (E.164 for TN / LY, encoded text, AR / FR); bucket strip (counts,
  collapsed default); order row (reason chip labels, RTL phone isolates); action sheet (outcome set
  per action type, note limit, next-action picks, submit payload); worklist hook (poll only when
  disconnected); realtime hook (coalesced mutate, ignores other agents' rows for the agent role);
  agent tabs (delivery present, follow-ups absent); route tests for the four handlers (role gates,
  agent id forcing, 409 out of scope).
- Phase 4: board client (agent filter narrows rows), overdue table, courier table, board route.
- Phase 5: role permissions for `/delivery`, redirects, a grep-guard test asserting no import of
  `follow-ups` or `in-delivery` paths remains.

## Verification

Browser, with the accounts in CLAUDE.md: `agent1.ly` on `/ar/delivery` sees five buckets in RTL,
opens a `delivery_delayed` order, records call_courier / reattempt_promised with +2 h and the row
moves to waiting on customer; opens a WhatsApp template and gets a `wa.me` link with Arabic text; the
bell shows `delivery_action_due` after the cron minute. `manager.ly` sees the cross-agent list,
filters by `agent1.ly`, sees courier scorecard rows and the control room; recording an action on an
order the agent has open in another tab succeeds (actions are additive, not order writes).
`agent1.tn` sees the Tunisia list with status and timing only and no courier block. `admin@oms.local`
switches markets. Old URLs redirect.

SQL: no order whose `customer_id` points to a customer of another market; as an LY agent JWT,
`customers` filtered to TN returns 0 rows; an UPDATE on `delivery_actions` raises the ledger error;
both cron jobs present in `cron.job`; the last five `darb_sync_runs` durations unchanged after deploy;
`delivery_broadcast_read` present in `pg_policies`.

Darb sandbox (`docs/warehouse-e2e-fixture.md`): extend `scripts/wh-test-scenarios.mjs` with a
shipment carrying an Arabic no-answer remark and status `delayed`; run the market sync against the
sandbox carrier and confirm `remark_class = 'no_answer'` and the row in act_now; promote a `[TEST]`
order whose customer has a prior return to `out_for_delivery` and confirm task + notification;
promote to `returning` and confirm `parcel_returning` and the returning bucket; teardown as
documented.

## Risks and assumptions

- CLAUDE.md says "follow design-system.md for all interface design"; decision 12 scopes a new
  language to the agent shell. Resolved by the phase 6 amendment. Agents still never set fulfilment
  statuses; actions never write `orders`. Every threshold goes through `settings` and its form.
- Ownership holds post-upload: `assigned_to` is only nulled by `unassign_order` /
  `return_order_to_pool`, both gated to pre-fulfilment statuses.
- `darb_shipments` has no `market_id`; scoping goes through `carriers.market_id`. Both Darb accounts
  belong to Libya today; a Darb account on another market would need a column.
- Remark classes are heuristic; `other` will be common at first. The manager board lists the top
  unclassified remarks so the regex tables can grow.
- The first sync after deploy fires one broadcast per changed shipment; deploy outside shift hours.
- The worklist RPC is INVOKER and relies on `darb_shipments_read USING (true)`; market isolation is
  on the orders join, consistent with the existing mirror decision.
- Timezones: "done today" and "tomorrow 10:00" use `marketTimezone` (`src/lib/markets.ts`) client
  side and `warehouse_market_tz` in SQL.
- Proactive tasks exist only for `out_for_delivery`, which Navex never emits. Tunisia gets none by
  construction.

## Leads: decisions recorded, plan deferred

Detailed plan after this rebuild ships. Decisions of 2026-09-12:

- Sources, all real: FB / IG ad comments and DMs, WhatsApp to the ad number, phone calls to the ad
  number, past customers to re-contact. Intake stays manual + CSV + system-generated re-contact
  lists. No Meta or WhatsApp automation.
- Production: about 1 960 campaign leads never touched, 9 manual leads in five months. Causes: no
  distribution, a painful page, campaigns were a test. Auto-distribution is mandatory.
- Prospect campaigns stay and improve: richer audiences (product, days since delivery, city, value,
  order count, never contacted), an offer + script per campaign, automatic distribution to agents,
  real results per campaign (calls, reached, converted, delivered revenue).
- Leads are worked by the same confirmation agents in between orders; the page shows how many are
  hot right now; manager needs a priority rule.
- Conversion: the order carries `origin = 'lead'` + `lead_id`, gets its own "Convertis" bucket in
  the queue (never inside "Confirmé"), and KPIs / commissions / dashboards segment on it. Status
  pipeline untouched; the order uploads or schedules like a confirmed one.
- The agent's delivery follow-up ends at delivered or returned; re-selling a returned order is a
  lead, which replaces the old "Commandes retournées" campaign audience.
- Biggest pains to fix: capture too slow while on the phone (phone-first form, live customer
  history from `customers`); managers cannot tell whether leads produce revenue (conversion to
  delivered, revenue per source and per campaign).
- Known rot to delete with the old page: `is_hot` / `has_duplicate` columns that do not exist in the
  DB but are typed, filtered and rendered; blank campaign attribution; two-write callback
  scheduling; raw-string CSV dedup; conversion borrowing an arbitrary storefront; the transition
  graph in three places; status stored twice; `lead_status` capped at `attempt_3`.

## Not in this plan

- WhatsApp Business API, inbound messages, any customer-facing bot (phase 3 at the earliest; this
  plan lays its substrate).
- Team control room doctrine change to delivery (separate small plan after phase 6).
- Warehouse carrier-tracking page.
- Tunisia-specific design; Navex enrichment.
- The leads rebuild itself.

### Leads round 2 (2026-09-13, before the leads prototype)

30. Lifecycle simplified: `new → contacted (attempt n) → callback → converted | lost`. Assignment is
    ownership, not a status. No `qualified`, no `assigned`, no `archived` state (archive = manager
    soft-close on a lost lead).
31. Hot inbound interrupts the queue: the queue tab shows a live banner + count "N prospects à
    appeler maintenant". Hot = inbound source, first contact not yet made, younger than a market
    setting (`lead_hot_window_minutes`, default 60).
32. Win-back is automatic: when an order hits `returned`, a lead is created for the confirming agent
    with the return reason attached. Market setting to disable or delay.
33. Campaign distribution default: the agent who confirmed the customer's last order, else
    round-robin among the agents the manager ticked, with a daily cap per agent.
Decided by me for the prototype, to confirm at review: capture form is phone-first with a live
customer/open-lead match, and offers "Enregistrer et commander" for callers who order on the spot;
manager side is a table plus campaign builder and results, no kanban (drag-drop was never used).

### Prototypes delivered (phase 1 artefacts)

- `prototypes/suivi-livraison-v1.html` — agent delivery worklist (2026-09-12).
- `prototypes/prospects-v1.html` — leads rebuild, agent tab + manager console in one file
  (2026-09-13). URL presets: `?role=agent|manager&lang=fr|ar&width=desktop|phone&screen=queue
  &sheet=capture|convert|outcome|wa&tab=pipeline|campaigns|sources&build=1`.
Both verified with headless Chrome in FR and AR. Awaiting the owner's review before the plan review.

### Prototype v2 of the delivery worklist (2026-09-13)

`prototypes/suivi-livraison-v1.html` was regenerated from visual references the owner supplied.
Changes from v1: mobile-first (phone list + phone detail + bottom tab bar, desktop drawer dropped);
price is the hero on every card; one recommended action per card as a circular tap target instead of
a text label; the detail opens with "Raison du retour" chips that qualify the failure in one tap;
carrier / customer / address / customer history became icon rows with their own affordances; the
action sheet collapsed from three steps to one screen (what you did · result split Joint / Pas joint
· note with counter · next step); the WhatsApp sheet gained a language toggle preset to the
customer's language, variable highlighting and a character counter; a states row covers loading,
empty, offline with pending-sync count, error and the pulse popover.
URL presets: `?lang=fr|ar&view=phones|sheets|states&bucket=<key>`.
Also fixed in passing: `prototypes/manager-console-v1.html` declared a function named `top`, which
collides with `window.top` and broke every screen; renamed to `setTop`.

### Delivery prototype: v1 behaviour restored under the v2 look (2026-09-13)

`prototypes/suivi-livraison-v1.html` now carries everything v1 had, in the new visual language:
16 parcels built from the production Darb remark corpus; the computed bucket engine (returning >
act now > waiting customer > waiting carrier > done) with the same precedence rules as the plan's
`get_delivery_worklist`; reason chips and the next-move sentence derived from remark class, task,
stall and next-action time; the customer risk classifier; all 12 call outcomes grouped by
Joint / Pas joint / Livreur; all 5 WhatsApp templates with a language toggle, variable highlighting
and a live character count; a merged timeline with three filters (all / mine / carrier); recording
an action or sending a message actually moves the row between buckets and raises an undo toast;
bucket filter pills, collapsible groups, and loading / empty / offline states inside the phone.

### Delivery prototype v3: the owner's reference screenshots (2026-09-13)

`prototypes/suivi-livraison-v1.html` was rebuilt to match four reference screenshots the owner
supplied (desktop FR, desktop AR, mobile FR, mobile AR) "almost identically". What changed from v2:
- Desktop is now a first-class view: a flat parcel table (client / situation / action / amount, a
  coloured edge per bucket) with a detail panel. The panel holds the recommended action, then
  Client + Transporteur cards, then Colis, then Historique with three filters.
- Group headers and collapsible buckets are gone. Filtering is by pills with a coloured dot and a
  count, plus search. The list order still follows decision 7 (returning first), so it does not
  copy the screenshot order.
- Mobile is four screens: list, detail, the "Enregistrer une action" sheet, and the WhatsApp sheet.
  The action sheet has 4 tiles, outcome pills, a one-line note and three reminder presets.
- Undo is back and stays honest with the append-only ledger: the toast holds the write for 5 s.
  "Annuler" discards the action before anything reaches `delivery_actions`. The React build must
  implement it the same way (delayed POST), never as a reversal row.
- The "Raison du retour" chips are dropped: no column would store them.
- Fonts moved to Inter + Noto Sans Arabic, the faces the app already loads.
URL presets: `?lang=fr|ar&view=desktop|mobile&state=normal|loading|empty|offline&open=<id>&bucket=<key>&sheet=action|wa`.

### Manager / super admin prototype v1 (2026-09-15)

`prototypes/suivi-livraison-manager-v1.html` — phase 4 design, before any React. Same visual
language as the agent screen that shipped (rows, situation chip, one move per row, detail panel),
so a manager who helped an agent yesterday recognises the screen today. What is added for the
manager role: the console sidebar (docs/design-system.md §5, no topbar), the market switcher in
the header for super admin only, an **agents strip** under the bucket strip (count of parcels to
treat per agent, red prefix for returns to save, an amber ring on an agent whose act-now parcel
has waited more than 24 h without an action), and a right panel that is the market **cockpit**
until a parcel is opened: Équipe (per-agent act-now / returns / waiting / 30-day rate, click
filters the list), Livreurs (Darb handler scorecard from the current holder of each parcel),
Transporteurs (30-day rate cards — Dexpress flagged as a dead account with 323 parcels still
"en cours" —, low-rate zones from `delivery_zone_stats`, the unclassified remarks the classifier
should learn). Opening a parcel replaces the cockpit with the agent's detail panel plus an
"Agent responsable" row; the quick outcomes record `delivery_actions` with `actor_type = manager`.
Fixtures are the live Libyan worklist of 2026-09-15; "actions today" per agent is illustrative.
Tunisia renders status + timing only (Navex gives no courier, no remark) — decision 5 holds.
URL presets: `?role=admin|manager &lang=fr|ar &market=ly|tn &open=<id> &bucket=<key>
&agent=<name> &tab=team|couriers|carriers`. Verified with headless Chrome in FR and AR.

### Manager round 2 — KPIs, reassignment, write-off (decided 2026-09-15)

34. **KPIs live on /delivery, read daily by the manager.** Équipe → Performance is untouched for
    now (the control-room doctrine change stays a separate plan). Per agent, today + 7-day trend.
35. **What "doing well" means, in this order: speed, outcomes, reachability.** Coverage was not
    picked as a KPI; it stays a visual signal (the amber ring) rather than a number.
    - Speed = median time to first *human* action after a reason appears (courier remark,
      delay, callback due, proactive task), counted on shift hours only (`shift_config`).
      Target = `delivery_first_action_hours` market setting, default 4 (same as the
      proactive-call window).
    - Outcomes = deliveries saved and 30-day delivery rate (already in the scorecard).
    - Reachability = reached / (reached + no answer) on customer calls, and WhatsApp used
      when the phone fails.
    - "Actions per day" is shown only as context next to outcomes, never ranked.
36. **Reassignment after upload is allowed** for two cases: an absent agent (move the whole
    live list in one action) and workload balancing (multi-select rows, move to one agent).
    The existing `/api/orders/bulk-reassign` route is the base; it must accept in-flight
    statuses for manager / super_admin, write an `order_history` row per parcel, and never
    touch the carrier. Ownership until terminal (decision 1) now reads "the current owner".
37. **The delivery commission follows the new owner.** The ledger rule changes from "the agent
    of the last `confirmed` transition" to "`assigned_to` at the `delivered` event". Every
    reassignment is therefore a pay event: the reassign sheet says so, and the commission doc
    and `agent_commission_ledger` RPC change in the same phase. Reassigning to oneself as a
    manager earns nothing (managers have no commission rule).
38. **Abandoned parcels are written off with a new terminal status `lost`.** Stock is not
    restored (the goods never came back), revenue is not realised, the carrier fee is counted.
    Manager / super_admin only, with a reason and a note; writes `order_history`; the parcel
    leaves every delivery denominator. Applies to the 68 stalled and, after review, the 391
    dead uploads. Needs: enum value, `order_status_rank`, `TERMINAL_STATUSES`, the dashboards
    that enumerate terminal statuses, the P&L cost stack.
39. **Manager interventions that cost nothing new:** record an action as manager, create a
    task for the agent (a `proactive_call_task` row with a manager note, lands in act-now),
    call the branch.
40. **KPIs reframed as verdicts (2026-09-15, after the owner rejected the metric table).** No
    median, no percentages, no ranking. Each agent is judged against the target and gets one of
    three verdicts — *En retard* (a parcel has waited past `delivery_first_action_hours` with no
    action since the reason appeared), *Inactif aujourd'hui* (parcels to treat, no action today),
    *À jour* — with the one reason in a sentence. The panel speaks in three frames: now (parcels
    waiting, the oldest), today (actions, customers reached, WhatsApp), this week (saved, lost).
    "Tous les agents" shows a one-line market verdict, then agents grouped by verdict (alphabetical
    inside a group, never a leaderboard), each with a sentence and a load bar by bucket. Selecting
    an agent opens their page: verdict, the three frames, a 7-day activity strip, the three worst
    parcels (clickable), and the "absent → move their list" action. Money at stake was offered
    and not chosen. Prototype: Équipe tab of `prototypes/suivi-livraison-manager-v1.html`.

## Phase 4 shipped — the manager board (2026-09-15)

`/delivery` now branches by role: agents keep `DeliveryWorklistClient`, managers and
super_admin get `DeliveryBoardClient`. Built from `prototypes/suivi-livraison-manager-v1.html`.

**What landed**

- `public.get_delivery_board(market_id)` (migration `20260929000001`) — per-agent activity
  from `delivery_actions` on the market clock (actions today, customers reached, WhatsApp,
  saved / lost this week, a 7-day strip), plus the market roster and the target. SECURITY
  INVOKER; verified under the LY manager, the TN manager (0 Libyan agents) and an agent JWT.
- `GET /api/delivery/board` — managers and super_admin only; agents get 403.
- `src/lib/delivery/board.ts` — the verdict rule and the arithmetic of decision 40, pure and
  covered by 24 tests. A parcel is late when it has waited past the target AND no action has
  been taken since its reason appeared (`latest_event_at`, else `created_at`). Long-dead
  stalls are excluded through `partitionStalled`, so a June backlog cannot mark every agent late.
- `DeliveryBoardView` + `DeliveryCockpit` + `DeliveryAgentsStrip` + `ReassignSheet` — the
  screen: bucket strip with amounts, agents strip, the list (the agent's own rows, chips and
  detail panel unchanged), and the cockpit (Équipe / Livreurs / Transporteurs) until a parcel
  is opened. 14 component tests.
- Reassignment, both ways in (decision 37): multi-select in the list, or "agent absent → move
  their N parcels" on the agent page. Goes through the existing `/api/orders/bulk-reassign`,
  which writes the history rows. The sheet carries the commission warning (decision 38).
- New market setting `delivery_first_action_hours` (default 4, 1–72), in
  Paramètres › Général › Livraison. Nothing hardcodes the target.

**Deliberately NOT built here** — each is a data or payroll change, not a screen:

- Decision 38, the commission rule itself. The board warns that the commission follows the new
  owner, but `agent_commission_ledger` still attributes on "the agent of the last confirmed
  transition". Until that RPC changes, the warning describes the intended rule, not the live one.
  This is the one place where the UI is ahead of the data.
- Decision 38's write-off (`lost`): no enum value, no `order_status_rank` entry, no
  `TERMINAL_STATUSES` change, so no "déclarer perdu" button. The long-dead stalls are still
  collapsed behind the existing group.
- Decision 39's manager task (`proactive_call_task` with a manager note).

**Verified** — LY manager and super_admin on the live Libyan market (108 parcels, 6 agents):
the market summary reads "3 en retard · 1 inactif · 2 à jour"; `liveWork` reduces 59 act-now
parcels to the 33 that are genuinely workable; the agent page, the three frames, the blocking
parcels and the reassign sheet all render in FR and with Arabic data. The reassign endpoint was
exercised for its guards only (cross-market target refused, empty list refused) — no production
parcel was moved.
