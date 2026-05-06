# Assigned Status Normalization Handoff

## Purpose

This note documents an order-status issue observed in the agent queue UI after the app changed assignment behavior.

It is written for an AI coding agent such as Claude Code so it can quickly understand the current model, the legacy behavior, why some rows still show `Assigne`, and how to safely normalize old data.

## Current Intended Behavior

Assignment is no longer an order lifecycle status.

The current model is:

```sql
status = 'pending'
assigned_to = '<agent-user-id>'
```

That means:

- A newly created order starts as `pending`.
- If it is assigned to an agent, it still stays `pending`.
- Assignment is represented by `orders.assigned_to`, not by `orders.status = 'assigned'`.
- The `assigned` enum value still exists only for legacy compatibility and historical rows.

Relevant code:

- `src/app/api/orders/route.ts`
  - New orders use `const initialStatus = "pending"`.
  - Agent-created orders self-assign via `assigned_to: actor.id`, but still use `status: "pending"`.
- `supabase/migrations/20260505233818_pending_assignment_model.sql`
  - Updates the assignment model so `assign_order` normalizes old `new`/`assigned` rows to `pending`.
  - Contains a data cleanup intended to convert existing active `assigned` rows to `pending`.

## Observed Issue

In the agent interface, some orders in the `Nouveau` bucket still display the label `Assigne`.

Example symptoms:

- Some rows show `En attente`.
- Other rows in the same queue show `Assigne`.
- The visible examples looked like seeded/test rows, e.g. `Client Test 683`, `Client Test 628`.

## Root Cause

The row label in the agent queue is rendered from the raw `orders.status` value.

In `src/components/queue/OrderCard.tsx`, non-attempt rows render:

```tsx
<span>{ts(order.status as Parameters<typeof ts>[0])}</span>
```

In `src/messages/fr.json`, the translations are:

```json
{
  "pending": "En attente",
  "assigned": "Assigne"
}
```

Therefore, if the UI shows `Assigne`, that row almost certainly still has:

```sql
orders.status = 'assigned'
```

The agent queue API intentionally still includes `assigned` in active statuses for backward compatibility:

```ts
const ACTIVE_QUEUE_STATUSES = [
  "pending",
  "assigned",
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
  "confirmed",
  "dispatch_scheduled",
];
```

So legacy `assigned` rows do not disappear; they still show in the `Nouveau` bucket.

## Why Old Rows Exist

Before the refactor, assignment was represented as a status transition:

```sql
new -> assigned
```

Later, the app switched to:

```sql
pending + assigned_to
```

There is also seed/performance data in `supabase/migrations/020_perf_seed_data.sql` that explicitly inserted orders using status values including:

```sql
'new', 'assigned', 'attempt_1', ...
```

If that seed data was inserted before the normalization migration, or reinserted afterward, those rows can still exist with `status = 'assigned'`.

## Recommended Fix

Use a one-time data normalization:

```sql
UPDATE orders
SET status = 'pending'
WHERE status = 'assigned';
```

Do not clear or change `assigned_to`.

The desired result for old assigned rows is:

```sql
status = 'pending'
assigned_to = existing_agent_id
```

This matches the current app behavior.

## Preflight Inspection SQL

Run this before changing data:

```sql
SELECT
  status,
  count(*) AS total,
  count(assigned_to) AS with_agent
FROM orders
WHERE status IN ('assigned', 'pending')
GROUP BY status
ORDER BY status;
```

To inspect the exact legacy rows:

```sql
SELECT
  id,
  customer_name,
  status,
  assigned_to,
  created_at,
  updated_at
FROM orders
WHERE status = 'assigned'
ORDER BY created_at DESC
LIMIT 50;
```

If the results are mostly `Client Test ...`, this is likely seeded legacy data.

## Cleanup SQL

Recommended cleanup:

```sql
UPDATE orders
SET status = 'pending'
WHERE status = 'assigned';
```

If the agent wants to be extra cautious, run it in a transaction:

```sql
BEGIN;

UPDATE orders
SET status = 'pending'
WHERE status = 'assigned';

SELECT
  status,
  count(*) AS total
FROM orders
WHERE status IN ('assigned', 'pending')
GROUP BY status
ORDER BY status;

COMMIT;
```

If the verification looks wrong before committing, use:

```sql
ROLLBACK;
```

## Post-Cleanup Verification SQL

After cleanup, this should return zero rows:

```sql
SELECT count(*) AS remaining_assigned_orders
FROM orders
WHERE status = 'assigned';
```

And this should show assigned orders as `pending` with `assigned_to` populated:

```sql
SELECT
  id,
  customer_name,
  status,
  assigned_to,
  created_at
FROM orders
WHERE status = 'pending'
  AND assigned_to IS NOT NULL
ORDER BY created_at DESC
LIMIT 50;
```

## Should Order History Be Updated?

Usually, no.

Keep `order_history` as historical truth. If an order was assigned under the old model, it is acceptable for its history to contain `status_to = 'assigned'`.

Changing history would blur what actually happened at the time and may break metrics that intentionally understand legacy assignment events.

Only normalize the live `orders.status` value.

## Should The `assigned` Enum Be Removed?

No, not as part of this fix.

Keep `assigned` as a legacy enum/status value because:

- Existing history rows may contain `assigned`.
- Some transition code still accepts `assigned` as a legacy input so old rows can continue through the workflow.
- Removing enum values in Postgres is more invasive than normalizing active rows.

The safe approach is:

- New app behavior never writes `orders.status = 'assigned'`.
- Existing active rows are normalized to `pending`.
- Legacy support remains in code until the team chooses a deeper cleanup.

## Migration Recommendation

If this issue is present in a shared or production database, add a small follow-up migration so all environments converge.

Suggested migration content:

```sql
-- Normalize legacy assignment-as-status rows to the current model.
-- Assignment is represented by orders.assigned_to; active assigned rows
-- should remain owned by the same agent but use status='pending'.
UPDATE public.orders
SET status = 'pending'
WHERE status = 'assigned';
```

If creating a new Supabase migration, prefer using:

```bash
supabase migration new normalize_legacy_assigned_orders
```

Then place the SQL above in the generated file.

## Agent Summary

If an AI agent sees `Assigne` in the agent queue after the pending-assignment refactor, do not assume the frontend is deriving that label from `assigned_to`.

The frontend is rendering the raw `orders.status`.

The likely fix is to normalize active legacy rows:

```sql
UPDATE orders
SET status = 'pending'
WHERE status = 'assigned';
```

This is the intended app behavior and matches the migration `20260505233818_pending_assignment_model.sql`.
