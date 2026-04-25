# Settings — General Redesign

## Goal
Replace the flat `GeneralSettingsForm` with grouped mental-model sections, progressive disclosure, per-setting change-history, preview semantics for `max_call_attempts`, reset-to-defaults per group, shift configuration for presence windows, and a WYSIWYG status-label editor that renders the actual runtime badge.

## Scope (mental-model groups)
1. **Operations** — max_call_attempts, attempt_retry_times, agent_inactivity_minutes (advanced)
2. **Finance** — delivery_fee, return_fee, packing_cost (super_admin + market_manager — gated via `canEditCosts`)
3. **Team** — assignment_algorithm, active_agents_only, shift_config (business hours)
4. **Labels** — WYSIWYG editor (link to `/settings/statuses` with inline preview of active statuses)

## Data additions
- New settings keys (no schema change, settings is JSONB-keyed):
  - `shift_config`: `{ start: "08:00", end: "18:00", days: [1..5], timezone: "Africa/Tunis" }`
  - `status_labels` already lives in `status_configs` — leave there; surface as WYSIWYG.
- New table `settings_history` (append-only)
  ```sql
  create table settings_history (
    id uuid primary key default gen_random_uuid(),
    market_id uuid not null references markets(id),
    key text not null,
    old_value jsonb,
    new_value jsonb not null,
    changed_by uuid not null references users(id),
    changed_at timestamptz not null default now()
  );
  create index on settings_history (market_id, key, changed_at desc);
  ```
  Populated inside `PATCH /api/settings/[marketId]` before upsert (read current value → insert history row → upsert).

## API
- `GET /api/settings/[marketId]/history?key=…` → last 10 changes with changer full_name + when (market-isolated by RLS).
- `GET /api/settings/[marketId]/preview?key=max_call_attempts&value=4` → `{ affected: number, sample: [...ids] }` — counts orders with current `attempt_count >= current_max && < new_max` that would gain/lose eligibility.

## Preview calculation (server-side lib)
`src/lib/calculations/settings-preview.ts`:
- `previewMaxAttemptsChange({ current, next, orders })` — returns `{ affectedCount, direction: "expand" | "shrink" }`.
  - `next > current`: orders currently rejected due to attempt exhaustion but with `attempt_count < next` become reachable (expand).
  - `next < current`: orders with `attempt_count >= next` would be auto-rejected (shrink). Warning banner.
- Pure function, unit-tested. Route calls it with `orders` sliced from DB.

## UI
- `SettingsClient` keeps existing nav but rewrites the `general` section into tabs: Operations | Finance | Team | Labels.
- New component `GeneralSettingsGroups.tsx` replaces `GeneralSettingsForm`.
- Reusable `SettingField.tsx` — wraps label + input + change-history popover trigger + reset-to-default.
- `ChangeHistoryPopover.tsx` — loads `settings_history?key=…` on open.
- `PreviewBanner.tsx` — shown inline under max_attempts when dirty & differs from saved.
- `ShiftConfigEditor.tsx` — start/end time pickers + weekday chips.
- `StatusLabelWysiwyg.tsx` — renders actual `<StatusBadge>` next to each editable label row; live-updates as user types.

## Tests
- `settings-preview.test.ts` — unit tests for preview calc (expand, shrink, no-op).
- `GeneralSettingsGroups.test.tsx` — groups render, advanced toggle hides `agent_inactivity_minutes`, save calls PATCH.
- `PreviewBanner.test.tsx` — renders affected count, hides when no change.
- `ShiftConfigEditor.test.tsx` — validates `end > start`, toggling days.

## Out of scope for this pass
- Status transitions graph viewer (already exists via `TransitionsModal`).
- Team presence based on shift_config — persistence only; wiring `shift_config` into presence calc is a follow-up.
- `market_manager` editing costs — respects existing `canEditCosts` gate.
