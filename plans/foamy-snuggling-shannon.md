# Session 9 — Frontend: Agent Queue UI Enhancements

## Context

Session 9 backend is complete (all APIs live). This session wires the new `/api/agent/queue` and `/api/agent/stats` endpoints into the existing queue UI and enhances OrderCard with callback indicators and attempt counters.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/queue/QueueHeader.tsx` | Redesign layout + accept pre-computed buckets prop |
| `src/components/queue/QueuePage.tsx` | Switch to `/api/agent/queue`, add `/api/agent/stats` SWR, remove client sort |
| `src/components/queue/OrderCard.tsx` | Add callback indicator + attempt counter display |
| `src/hooks/useAgentQueue.ts` | Switch URL to `/api/agent/queue`, expose `buckets` |

**No new files.** No changes to `src/types/queue.ts`, `src/app/[locale]/(agent)/queue/page.tsx`, or any API route.

---

## Styling Rules (light theme — existing queue pattern)

Follow existing queue components (NOT the dark Shopify system):
- Background: `#F6F6F7` (page), `#FFFFFF` (cards/header)
- Borders: `1px solid #E1E3E5` or `1px solid #D1D5DB`
- Primary text: `#1A1A1A` (700 bold for agent name)
- Secondary text: `#6B7280`
- Muted/separator: `#9CA3AF`
- Error/overdue: `#DC2626`
- Attempt warning: `#F97316` (orange)
- 14px base font size

---

## Step 1 — `src/hooks/useAgentQueue.ts`

Change SWR key from `/api/orders/queue` → `/api/agent/queue`.  
Update return shape to expose `buckets` from response:

```ts
return {
  orders: (data?.orders ?? []) as Record<string, unknown>[],
  buckets: data?.buckets ?? null,
  error, isLoading, mutate,
};
```

Note: `/api/agent/queue` returns `{ orders, buckets }` — not `{ data }`.

---

## Step 2 — `src/components/queue/QueueHeader.tsx`

**Redesign layout per spec:**

Props change:
```ts
interface QueueHeaderProps {
  agentName: string;
  stats: AgentStats;       // assigned_count, actioned_count, confirmation_rate (number)
  buckets: {               // pre-computed from /api/agent/queue response
    nouveau: number;
    tentative_1: number;
    tentative_2: number;
    tentative_3: number;
    rappel_prevu: number;
    confirme: number;
  } | null;
}
```

Remove `orders: QueueOrder[]` prop — buckets are now passed directly, no client-side computation.  
Remove `hasOverdueCallback` function (overdue logic no longer needed here).  
Remove `AgentStats.confirmation_rate` as string — change to `number`.

**Layout:**

Top row (flex, space-between):
- Left: agent name — `fontSize: 18, fontWeight: 700, color: "#1A1A1A"`
- Right: stats horizontal row:
  - "Assignées: X" | "Traitées: X" | "Taux de confirmation: X.X%"
  - Separator `|` in `#9CA3AF`, all 14px, values `fontWeight: 600`
  - `confirmation_rate` formatted as `X.X%` (1 decimal via `.toFixed(1)`)

Badges row (below, `marginTop: 12`):
- Horizontal `display: flex, gap: 16`
- 6 badges: Nouveau X | Tentative 1 X | Tentative 2 X | Tentative 3 X | Rappel prévu X | Confirmé X
- Each badge: **no background, no border, no shadow** — inline text only
  - Non-zero: `fontWeight: 600, color: "#1A1A1A"`
  - Zero: `fontWeight: 400, color: "#9CA3AF"`
  - Format: `"Nouveau 3"` (label + space + count)

Container: `backgroundColor: "#FFFFFF", borderBottom: "1px solid #D1D5DB", padding: "16px 24px"`

---

## Step 3 — `src/components/queue/QueuePage.tsx`

Changes:
1. Switch SWR from `/api/orders/queue` → use `useAgentQueue` hook (already uses `/api/agent/queue` after Step 1)
2. Add second SWR call for stats: `useSWR("/api/agent/stats", fetcher, { refreshInterval: 30000 })`
3. Remove `sortQueueByPriority` import and call — orders come pre-sorted from server
4. `toQueueOrder` still needed — maps raw server fields to `QueueOrder` type. The `/api/agent/queue` response returns full order rows with `callback_scheduled_at`, same as before.
5. Update `QueueHeader` props: pass `buckets` from queue response instead of `orders`, pass `confirmation_rate` as number
6. Update stats mapping:
   ```ts
   const stats = {
     assigned_count: statsData?.assigned_today ?? 0,
     actioned_count: statsData?.actioned_today ?? 0,
     confirmation_rate: statsData?.confirmation_rate ?? 0,
   };
   ```
7. Update `AgentStats` interface: rename `processed_count` → `actioned_count`, change `confirmation_rate` from `string` to `number`
8. Loading state: show `"Chargement..."` text — no spinner (per spec)
9. Error state: show `"Erreur de chargement. Nouvelle tentative..."` — no Actualiser button (per spec: no manual refresh)

The `mutate()` calls on `onSuccess` in `PostCallActionSheet` still trigger — keep that.

---

## Step 4 — `src/components/queue/OrderCard.tsx`

The `QueueOrder` type already has `callback_time` (mapped from `callback_scheduled_at`) and `attempt_count`.  
The spec requires `Tentative X/Y` where Y = max attempts from settings — but max attempts is not in `QueueOrder` and not returned by `/api/agent/queue`. **Solution**: hardcode Y as 3 (matches default in DB; the spec's "from settings" is aspirational — we don't have a settings endpoint exposed to client). Add a `maxAttempts?: number` prop defaulting to 3.

**Callback indicator** (only if `status === 'callback_scheduled'`):

Replace existing callback row logic with:
- Future (`callback_time > now`): `"Rappel prévu: DD/MM/YYYY à HH:mm"` — `fontSize: 13, color: "#6B7280"`
- Overdue (`callback_time <= now`): 
  - Line 1: `"RAPPEL EN RETARD"` — `fontSize: 13, color: "#DC2626", fontWeight: 700`
  - Line 2: `"Prévu: DD/MM/YYYY à HH:mm"` — `fontSize: 13, color: "#DC2626"`
- Date format: `DD/MM/YYYY à HH:mm` — use `toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })` + `toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })` concatenated with ` à `

**Attempt counter** (only if `status` starts with `attempt_`):

Replace existing `"Tentative {attempt_count}"` with:
- `"Tentative X/Y"` where X = `attempt_count` (or extracted from status), Y = `maxAttempts` (default 3)
- Non-max: `fontSize: 13, color: "#F97316"` (orange)
- At max (`X === Y`): `fontSize: 13, color: "#DC2626", fontWeight: 700`

Use `extractAttemptNumber` from `src/lib/attempt-logic.ts` to derive X from `order.status` (more reliable than `attempt_count` field).

---

## Step 5 — Typecheck

Run `npm run typecheck` — zero errors required before done.

---

## Verification

1. `npm run typecheck` — zero errors
2. Dev server: queue page loads, shows agent name + stats top-right, badge row below
3. Overdue callback order: red "RAPPEL EN RETARD" label on card
4. Future callback order: grey "Rappel prévu: ..." label  
5. Attempt order: orange "Tentative 2/3" or red "Tentative 3/3"
6. Stats refresh every 30s (visible in Network tab)
7. Queue refresh every 30s, orders in server-provided sort order
