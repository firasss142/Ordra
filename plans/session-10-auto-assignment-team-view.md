# Session 10 — Auto-Assignment Engine + Enhanced Team View
**Date:** 2026-04-14  
**Branch:** session-03-products

---

## Context

Multi-part plan covering auto-assignment engine, algorithms, webhook integration, agent activity detection, enhanced team view, agent drill-down, reassignment flow, and assignment configuration UI.

**Critical finding: ~80% already exists.** This plan covers only the remaining gaps.

## What Already Exists (No Changes Needed)

| Component | File(s) | Status |
|-----------|---------|--------|
| Auto-assignment engine (4 algorithms) | `src/lib/orders/auto-assignment.ts` | Complete + tested |
| Orchestrator (settings → engine → RPC) | `src/lib/orders/auto-assignment-orchestrator.ts` | Complete + tested |
| Webhook integration | `src/lib/orders/webhook-handler.ts:177-186` | Complete |
| `assignment_rules` table + RLS + seed | `supabase/migrations/001-003` | Complete |
| Settings table + `assignment_algorithm` key | Settings API + seed data | Complete |
| Assignment operations (assign/reassign/unassign/returnToPool/bulkAssign) | `src/lib/orders/assignment.ts` | Complete |
| Team API (queue_size, actioned/confirmed/rejected_today) | `src/app/api/team/route.ts` | Complete |
| TeamTable with clickable rows + all metric columns | `src/components/team/TeamTable.tsx` | Complete |
| AgentDrilldown slide-in panel + checkboxes | `src/components/team/AgentDrilldown.tsx` | Complete |
| ReassignControls (reassign + return-to-pool) | `src/components/team/ReassignControls.tsx` | Complete |
| Reassign API | `src/app/api/orders/[id]/reassign/route.ts` | Complete |
| Agent queue API | `src/app/api/team/[agentId]/queue/route.ts` | Complete |
| Settings form with algorithm dropdown (5 options) | `src/components/settings/GeneralSettingsForm.tsx` | Complete |
| Unassigned pool UI + badge logic | `src/components/unassigned/UnassignedPool.tsx` | Complete |

## Gaps to Fill

### Gap 1: Settings value format inconsistency
Orchestrator reads `settingsRow?.value` as `{ type?: string }` but PATCH handler writes `{ value: X }`.

### Gap 2: No `active_agents_only` setting
No way to restrict auto-assignment to agents who have acted today.

### Gap 3: Agent queue sort order wrong
Drill-down sorts by `created_at ASC` only. Spec: callback_ready → attempt_* → assigned.

### Gap 4: No "active today" indicator in team view
TeamTable shows account `is_active` but not whether agent has worked today.

---

## Implementation Steps

### Step 1: Fix settings value format in orchestrator
- **File:** `src/lib/orders/auto-assignment-orchestrator.ts` (line 19)
- **Change:** Handle both `{ value: X }` and `{ type: X }` formats
- **Test first:** `auto-assignment-orchestrator.test.ts`

### Step 2: Add `active_agents_only` setting
- **File:** `src/types/settings.ts` — add field + validator
- **File:** `src/lib/orders/auto-assignment-orchestrator.ts` — read setting, filter agents, fallback to all
- **Test first:** `auto-assignment-orchestrator.test.ts`

### Step 3: Add `active_agents_only` to settings UI
- **File:** `src/components/settings/GeneralSettingsForm.tsx` — checkbox below algorithm dropdown
- **File:** `src/app/[locale]/(dashboard)/settings/page.tsx` — read + pass initial value
- **Test first:** GeneralSettingsForm test

### Step 4: Fix queue sort order
- **File:** `src/app/api/team/[agentId]/queue/route.ts` — application-level priority sort
- Priority: callback_scheduled (time ≤ now) → attempt_* → assigned → rest
- **Test first:** queue route test

### Step 5: Add "active today" indicator
- **File:** `src/app/api/team/route.ts` — derive `is_active_today` from `actioned_today > 0`
- **File:** `src/components/team/TeamTable.tsx` — three-state dot: green (active+worked), grey (active+idle), red-grey (disabled)
- **Test first:** TeamTable test

### Step 6: Seed migration
- **New file:** `supabase/migrations/016_active_agents_only_setting.sql`
- Insert `active_agents_only` = `{ "value": false }` per market

---

## New Files
| File | Purpose |
|------|---------|
| `supabase/migrations/016_active_agents_only_setting.sql` | Seed active_agents_only default |

## Modified Files
| File | Change |
|------|--------|
| `src/lib/orders/auto-assignment-orchestrator.ts` | Fix value format; add active filter |
| `src/lib/orders/auto-assignment-orchestrator.test.ts` | Tests for both changes |
| `src/types/settings.ts` | Add active_agents_only to type + validator |
| `src/components/settings/GeneralSettingsForm.tsx` | Add checkbox toggle |
| `src/app/[locale]/(dashboard)/settings/page.tsx` | Pass active_agents_only |
| `src/app/api/team/[agentId]/queue/route.ts` | Priority queue sort |
| `src/app/api/team/route.ts` | Add is_active_today |
| `src/components/team/TeamTable.tsx` | Three-state activity indicator |

## Verification
1. `npm test` — all tests pass
2. `npm run typecheck` — clean
3. Settings round-trip: change in UI → persists → orchestrator reads correctly
4. Auto-assign: set round_robin → webhook creates order → auto-assigned with system actor
5. Active toggle: enable → only today-active agents get orders → fallback when none active
6. Queue sort: drill-down shows callback_ready first, then attempts, then assigned
7. Activity dot: green for worked-today, grey for idle, disabled state distinct
