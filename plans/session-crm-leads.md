# CRM Section — Lead Management (Pre-Order Funnel)

## Context

Today, orders enter the OMS only via storefront webhooks. But in reality, many customers call the ad phone number directly, comment on Facebook posts, or DM on WhatsApp **before** an order exists. None of that traffic is captured, triaged, or attributed — the agents handle it ad-hoc outside the system, and managers have no visibility into conversion rate by channel or lost inquiries.

This plan adds a **Lead Management** layer that sits **on top of the existing order pipeline**, not inside it. Leads are pre-order inquiries (call/FB/WhatsApp/manual) that can convert into orders. The design strictly inherits from what already works:

- Same **market isolation** via `market_id` + RLS (Tunisia / Libya never cross).
- Same **three roles** (super_admin / market_manager / agent) via existing `canAccess` + RLS.
- Same **assignee model** — `leads.assigned_to` → `users.id`, exactly like `orders.assigned_to`.
- Same **append-only history** pattern (`lead_history` mirrors `order_history`).
- Same **callback scheduling** mechanics (reuse `src/lib/callback-engine.ts`).
- Same **RPC-for-transitions** pattern (mirror `transition_order_status`).
- Same **adapter pattern** as storefronts/carriers — webhook sources are pluggable.

Nothing in the order pipeline changes. Leads are **additive**: a new table, a new sidebar entry, a new agent queue tab. Conversion produces a normal order via the same confirmation flow — no parallel order path.

---

## Design Decisions (locked with user)

1. **Lead = standalone pre-order entity.** Its own table, its own status enum, its own history. Can exist without ever becoming an order (lost inquiry).
2. **Separate `/leads` agent view** next to `/queue`. Leads do NOT dilute the order-queue counts or KPIs. Same UI shell, same callback engine.
3. **Intake channels:** manual entry (agent + manager) + CSV bulk import in v1. FB Meta webhook and WhatsApp webhook are **schema-ready** (enum values + adapter interface) but adapters are deferred.
4. **Hybrid assignment:** webhook-sourced leads go through existing `assignment_rules` (auto-assign). Agent-entered leads self-assign to the entering agent. Manager-entered leads wait for manual assignment.
5. **Conversion = pre-filled order form.** "Convert to order" opens the order intake modal pre-filled from the lead (name/phone/address/product_interest). Agent picks variant/quantity and submits. Resulting order: `status='confirmed'`, `assigned_to = same agent`, `source='lead_conversion'`. Lead gets `converted_order_id` set and `status='won'`.
6. **CRM KPIs in dashboard:** conversion rate by agent, conversion rate by source, lost-reason breakdown. (No time-to-conversion in v1.)

---

## Non-Goals

- Customer 360 (aggregating orders by phone into a unified contact). Future session — leads stay order-independent for now.
- FB/WhatsApp webhook adapters (schema allows them; implementation is a later plan).
- Lead scoring / probability. Server-side only if ever added.
- Outbound email/SMS. Not in scope.

---

## Inherited Invariants (from CLAUDE.md + docs/)

| Rule | Where it applies in CRM |
|---|---|
| Market isolation via RLS | Every `leads` query scoped by `market_id = get_user_market_id()` |
| Append-only history | `lead_history` — INSERT only, no UPDATE/DELETE, enforced by RLS |
| All config in `settings` table | `max_lead_attempts`, `lead_auto_assign_enabled` — never hardcoded |
| Text via `next-intl` | All copy under `crm.*` namespace in `fr.json` + `ar.json` |
| RLS + server-side for financial/sensitive logic | Conversion RPC runs server-side; profit metrics hidden from agents |
| RPC for state transitions | `transition_lead_status`, `assign_lead`, `convert_lead_to_order` |
| Adapter pattern | `src/lib/leads/adapters/` — `ManualAdapter` in v1, `MetaAdapter` / `WhatsAppAdapter` stubbed |
| RTL support | All new components use logical props (`ps/pe`), Arabic translations parallel |
| TDD | Failing test first, every file. See [`.claude/skills/test-driven-development/SKILL.md`](.claude/skills/test-driven-development/SKILL.md) |

---

## Data Model

### New enum: `lead_status`

```
new              → just captured, unassigned
assigned         → assigned to an agent (auto or manual)
attempt_1/2/3    → agent tried to contact
callback_scheduled → follow-up in future (reuses callback_scheduled_at)
qualified        → agent confirmed real interest, ready to convert
won              → TERMINAL — converted to order (converted_order_id set)
lost             → TERMINAL — requires lost_reason
archived         → TERMINAL — manager force-close (duplicate/spam)
```

### New enum: `lead_source`

```
manual_call | facebook_comment | facebook_dm | instagram_dm |
whatsapp | tiktok_comment | other
```

### New enum: `lead_lost_reason`

```
not_interested | price | unreachable | competitor | duplicate |
wrong_number | spam | autre   (+ free-text lost_note for 'autre')
```

Mirrors the existing `rejection_reason` pattern on orders.

### New table: `leads`

Columns (copy conventions from `orders`):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `market_id` | uuid FK → markets | NOT NULL — drives RLS |
| `source` | lead_source | NOT NULL |
| `source_external_id` | text | Nullable — FB comment ID etc. for dedup |
| `source_platform` | text | Adapter name, for future webhooks |
| `status` | lead_status | default `'new'` |
| `customer_name` | text | NOT NULL |
| `customer_phone` | text | NOT NULL |
| `customer_city` | text | nullable |
| `customer_address` | text | nullable |
| `product_interest_id` | uuid FK → products | nullable — may not know yet |
| `product_interest_note` | text | free-text when product_interest_id null |
| `notes` | text | agent notes, editable |
| `assigned_to` | uuid FK → users | mirrors `orders.assigned_to` |
| `callback_scheduled_at` | timestamptz | reuses existing callback engine |
| `lost_reason` | lead_lost_reason | required when `status='lost'` |
| `lost_note` | text | required when `lost_reason='autre'` |
| `converted_order_id` | uuid FK → orders | set when `status='won'` |
| `raw_payload` | jsonb | for future webhook debugging |
| `created_at` / `updated_at` | timestamptz | |

Indexes (copy `orders` pattern):
- `(market_id, status)` — dashboard / queue filtering
- `(assigned_to) WHERE assigned_to IS NOT NULL` — agent queue
- `(assigned_to, status, callback_scheduled_at, created_at)` — queue sort
- `UNIQUE (source_platform, source_external_id) WHERE source_external_id IS NOT NULL` — webhook idempotency

### New table: `lead_history`

Mirror of `order_history`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `lead_id` | uuid FK → leads | |
| `status_from` | lead_status | nullable on creation |
| `status_to` | lead_status | |
| `actor_id` | uuid FK → users | nullable for system |
| `actor_type` | text CHECK IN ('system','agent','manager') | |
| `note` | text | optional |
| `created_at` | timestamptz | |

Append-only: RLS blocks UPDATE/DELETE, enforced exactly like `order_history`.

### RPCs (new)

| RPC | Purpose | Mirrors |
|---|---|---|
| `transition_lead_status` | validate transition, insert history, update lead atomically | `transition_order_status` |
| `assign_lead` | assign/reassign, insert history | `assign_order` |
| `unassign_lead` | return to pool | `unassign_order` |
| `convert_lead_to_order` | create order from lead, set `converted_order_id`, transition lead to `won` (one transaction) | new — wraps `orders` INSERT + lead update |

All RPCs use `FOR UPDATE` row lock on the lead and check market + role permissions.

### Valid transitions (mirrors `order-pipeline.md`)

```
new → assigned → attempt_1 → attempt_2 → attempt_3
                              ↘ callback_scheduled ↗
assigned / attempt_* / callback_scheduled → qualified → won (via conversion RPC only)
                                                     ↘ lost (terminal)
any pre-terminal → archived (manager only)
```

Terminal: `won`, `lost`, `archived` — no transitions out.

---

## File Layout

### New files

| # | File | Purpose |
|---|---|---|
| 1 | `supabase/migrations/0XX_crm_leads.sql` | tables, enums, indexes, RLS policies, RPCs |
| 2 | `src/types/lead.ts` | `Lead`, `LeadStatus`, `LeadSource`, `LeadLostReason`, `LeadHistoryEntry` + transition map |
| 3 | `src/lib/leads/transition.ts` | `transitionLeadStatus()` wrapper around RPC |
| 4 | `src/lib/leads/assignment.ts` | `assignLead`, `reassignLead`, `unassignLead`, `tryAutoAssignLead` (reuses `assignment_rules`) |
| 5 | `src/lib/leads/conversion.ts` | `convertLeadToOrder()` — wraps RPC, returns `{ lead, order }` |
| 6 | `src/lib/leads/queue-sort.ts` | same bucket-priority algorithm as `src/lib/orders/queue-sort.ts` |
| 7 | `src/lib/leads/adapters/index.ts` | `LeadSourceAdapter` interface + registry |
| 8 | `src/lib/leads/adapters/manual-adapter.ts` | no-op adapter for manual entry (baseline) |
| 9 | `src/lib/leads/adapters/meta-adapter.ts` | **stub only** — schema shape + TODO, no network calls |
| 10 | `src/lib/leads/adapters/whatsapp-adapter.ts` | **stub only** |
| 11 | `src/lib/lead-permissions.ts` | `canViewLeads`, `canCreateLead`, `canAssignLeads`, `canConvertLead`, `canArchiveLead` |
| 12 | `src/hooks/useLeads.ts` | SWR hook for list/filter, mirrors `useOrders` |
| 13 | `src/hooks/useAgentLeadQueue.ts` | SWR hook, mirrors `useAgentQueue` |
| 14 | `src/hooks/useLeadDetail.ts` | SWR hook for single lead + history |
| 15 | `src/app/api/leads/route.ts` | GET list, POST create |
| 16 | `src/app/api/leads/[id]/route.ts` | GET, PATCH (edit fields), DELETE (archive) |
| 17 | `src/app/api/leads/[id]/attempt/route.ts` | POST attempt — mirrors orders attempt route |
| 18 | `src/app/api/leads/[id]/callback/route.ts` | POST schedule callback |
| 19 | `src/app/api/leads/[id]/convert/route.ts` | POST convert — returns created order |
| 20 | `src/app/api/leads/[id]/assign/route.ts` | POST manual assign |
| 21 | `src/app/api/agent/leads/queue/route.ts` | agent queue buckets |
| 22 | `src/app/api/webhooks/meta/[sourceId]/route.ts` | stub handler; schema wired but returns 501 |
| 23 | `src/app/[locale]/(dashboard)/leads/page.tsx` | manager/super_admin list view |
| 24 | `src/app/[locale]/(dashboard)/leads/[id]/page.tsx` | manager lead detail |
| 25 | `src/app/[locale]/(agent)/leads/page.tsx` | agent queue (no sidebar) |
| 26 | `src/app/[locale]/(agent)/leads/[id]/page.tsx` | agent working view |
| 27 | `src/components/crm/LeadList.tsx` | shared list/table |
| 28 | `src/components/crm/LeadDetailCard.tsx` | edit form + history |
| 29 | `src/components/crm/NewLeadModal.tsx` | manual entry form |
| 30 | `src/components/crm/ConvertLeadModal.tsx` | pre-filled order form |
| 31 | `src/components/crm/LeadStatusBadge.tsx` | status + functional color |
| 32 | `src/components/crm/CsvImportModal.tsx` | bulk import UI |
| 33 | `src/components/crm/KpiCards.tsx` | conversion-by-agent, by-source, lost-reason breakdown |
| 34 | Test files | colocated per TDD skill — one per public function/component |

### Modified files

| File | Change |
|---|---|
| [src/components/layout/Sidebar.tsx](src/components/layout/Sidebar.tsx#L15-L33) | add `/leads` nav item (both FR/AR arrays), manager + super_admin visible |
| [src/lib/role-permissions.ts](src/lib/role-permissions.ts#L3-L7) | add `/leads` to super_admin + market_manager; add `/leads` (agent) route |
| [src/middleware.ts](src/middleware.ts) | route gating for `/leads` (both shells) |
| [src/messages/fr.json](src/messages/fr.json) | new `crm.*` namespace (statuses, actions, lost reasons, KPIs) |
| [src/messages/ar.json](src/messages/ar.json) | parallel Arabic strings |
| [src/app/[locale]/(dashboard)/dashboard/page.tsx](src/app/[locale]/(dashboard)/dashboard/page.tsx) | add 3 CRM KPI cards (conv by agent, conv by source, lost reasons) — hidden for agents |
| `src/types/index.ts` | re-export new lead types |
| `src/lib/callback-engine.ts` | generalize OR add `isLeadCallbackReady` — reuse logic, do not duplicate |

### NOT modified (critical invariant)

- `orders` table schema — untouched.
- `order_history` — untouched.
- Webhook handler for storefronts — untouched.
- Agent queue for orders (`/queue`) — untouched.
- Carrier / dispatch / fulfillment code — untouched.

---

## Component Behavior (highlights)

### Agent experience
- Sidebar unchanged (agents have no sidebar). Top bar gets tabs: **Queue** (orders) | **Leads**.
- `/leads` shows the same bucket layout as `/queue`: callbacks-due, attempts (1/2/3), assigned, qualified.
- Lead card actions: `Mark attempt`, `Schedule callback`, `Mark qualified`, `Mark lost`, `Convert to order`.
- Attempt limit from `settings.max_lead_attempts` (separate from `max_call_attempts`). Auto-transition to `lost` with `lost_reason='unreachable'` on overflow — mirrors existing auto-rejection.

### Manager experience
- New `/leads` sidebar entry between "Commandes" and "Produits".
- Full list with filters: status, source, assigned agent, date range.
- Bulk actions: assign, archive, export.
- CSV import modal with column mapping (name, phone, city, product, source, note).
- Click-through to lead detail = full history + edit + reassign + archive.

### Super_admin experience
- Same as manager but cross-market (honours existing `market_id` query param pattern from [dashboard](src/app/[locale]/(dashboard)/dashboard/page.tsx)).
- Dashboard KPI cards visible with market selector.

### Conversion flow
1. Agent clicks "Convert to order" on a qualified lead.
2. `ConvertLeadModal` opens — existing order fields pre-filled from lead.
3. Agent picks product/variant/quantity (product_interest auto-selected if set).
4. Submit → POST `/api/leads/[id]/convert` → `convert_lead_to_order` RPC:
   - INSERT into `orders` (status=`confirmed`, assigned_to=same agent, source=`lead_conversion`)
   - UPDATE `leads` SET status=`won`, converted_order_id=<new id>
   - INSERT both `lead_history` and `order_history` rows
   - All in one transaction with row locks
5. Response: `{ order_id }` → redirect agent to new order detail.
6. Order enters normal pipeline at `confirmed` → dispatcher workflow unchanged.

---

## Tests (TDD — write first)

Mandatory failing tests before implementation (SKILL: [`.claude/skills/test-driven-development/SKILL.md`](.claude/skills/test-driven-development/SKILL.md)):

- `lead-status-transitions.test.ts` — valid/invalid transitions, terminal guards
- `lead-assignment.test.ts` — manual, auto (via existing rules), unassign
- `lead-conversion.test.ts` — creates order at `confirmed`, history on both tables, `converted_order_id` set, idempotent (second convert attempt fails cleanly)
- `lead-queue-sort.test.ts` — callback-due first, then attempts, then assigned
- `lead-rls.test.ts` — Tunisia agent cannot see Libya leads
- `lead-permissions.test.ts` — agent can't archive; agent can convert only own leads
- `csv-import.test.ts` — valid rows create leads, bad rows reported, dedup against existing phones in same market
- Component tests for `NewLeadModal`, `ConvertLeadModal`, `LeadList` — behaviour via Testing Library, no test IDs

---

## Verification Plan

**Automated**
1. `npm test` — all new tests pass; no existing test regresses.
2. `npm run typecheck` — clean.
3. `npm run lint` — clean.
4. `npm run build` — production build succeeds.
5. Run the `rls-reviewer` agent against the new migration — confirm market isolation.
6. Run the `i18n-reviewer` agent — confirm no hardcoded UI strings, RTL parity.

**Manual (end-to-end)**

As `tn_agent_1`:
- Open `/fr/leads` — see only Tunisia leads assigned to me.
- Create a manual lead (call from ad). Confirm it's auto-assigned to me (agent self-assign rule).
- Mark attempt 1. Verify history shows transition.
- Schedule callback for +5 minutes. Verify lead disappears from active bucket, reappears after 5 min.
- Click "Convert to order". Pre-filled modal appears. Pick product, submit.
- Verify: new order exists at status=`confirmed`, assigned to me; lead status=`won` with converted_order_id; both histories written; order appears in my `/queue`.

As `tn_manager`:
- `/fr/leads` shows all Tunisia leads across agents.
- Bulk-import CSV of 20 leads. Verify dedup by phone within market.
- Reassign a lead to another agent. Verify history actor is manager.
- Attempt to view Libya lead by URL — 403.

As `super_admin`:
- Dashboard shows CRM KPIs. Toggle market selector — data scopes correctly.
- Archive a lead — verify terminal state, no further transitions allowed.

As `ly_agent_1`:
- `/ar/leads` renders RTL. All copy Arabic. No FR leakage.
- Cannot see any Tunisia leads (RLS).

**Regression guards**
- Existing `/queue` (orders) for `tn_agent_1` shows exactly the same orders as before — no leads mixed in.
- Webhook order creation still works (`/api/webhooks/...`) — no lead-related side effects.
- Dispatcher workflow on a converted order (lead → order → dispatch → deposit → delivered) reaches `delivered` cleanly.

---

## Critical File References

| Purpose | Path |
|---|---|
| Order schema to mirror | [supabase/migrations/001_initial_schema.sql](supabase/migrations/001_initial_schema.sql) |
| RLS patterns | [supabase/migrations/002_rls_policies.sql](supabase/migrations/002_rls_policies.sql) |
| Order status types | [src/types/order-status.ts](src/types/order-status.ts) |
| Transition RPC pattern | [src/lib/orders/transition.ts](src/lib/orders/transition.ts) |
| Assignment pattern | [src/lib/orders/assignment.ts](src/lib/orders/assignment.ts) |
| Queue sort algorithm | [src/lib/orders/queue-sort.ts](src/lib/orders/queue-sort.ts) |
| Callback engine (reuse) | [src/lib/callback-engine.ts](src/lib/callback-engine.ts) |
| Adapter registry pattern | [src/lib/storefronts/adapter-registry.ts](src/lib/storefronts/adapter-registry.ts) |
| Webhook handler pattern | [src/lib/orders/webhook-handler.ts](src/lib/orders/webhook-handler.ts) |
| Sidebar nav | [src/components/layout/Sidebar.tsx](src/components/layout/Sidebar.tsx) |
| Role gating | [src/lib/role-permissions.ts](src/lib/role-permissions.ts) |
| Middleware route gates | [src/middleware.ts](src/middleware.ts) |
| i18n FR | [src/messages/fr.json](src/messages/fr.json) |
| i18n AR | [src/messages/ar.json](src/messages/ar.json) |
| Design tokens + rules | [docs/design-system.md](docs/design-system.md) |
| Status pipeline spec | [docs/order-pipeline.md](docs/order-pipeline.md) |
| Business rules | [docs/business-logic.md](docs/business-logic.md) |

---

## Open Decisions for a Later Session

- Customer 360 view (aggregate leads + orders by phone per market).
- Meta / WhatsApp adapter implementations (schema ready in this round).
- Lead scoring / probability (server-side calc).
- Automated outreach (SMS/email) — currently out of scope.
- Time-to-conversion KPI (data will accumulate from day one; add chart later).
