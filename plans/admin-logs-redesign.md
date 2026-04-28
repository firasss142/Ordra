# admin/logs page — redesign + audit (2026-04-27)

Goal: bring `/admin/logs` to the same design consistency as the other "Système" sub-tabs (`markets`, `settings/general`, `settings/storefronts`, `settings/carriers`) and fix logic gaps surfaced during the audit.

## Audit findings

### Design / consistency
1. **Inline `style={{}}` everywhere with raw hex** — sibling system pages use Tailwind utility classes referencing semantic tokens (`bg-surface-page`, `border-line-subtle`, `bg-status-criticalBg`, `rounded-card`, etc.). Logs was the lone holdout still hardcoding `#F6F6F7`, `#FFFFFF`, `#E1E3E5`.
2. **No shared header** — every sibling system page renders `<SettingsPageHeader title=... description=... isRtl=... />`. Logs had a custom `<header>` block.
3. **Client-side auth gate** — `admin/logs/page.tsx` used `useAuth()` + client-side `router.replace()`, causing a flash of nothing on cold load and inconsistency with other system pages that use `getServerUser()` server-side.
4. **No focus trap on inspector drawer** — sibling drawers (CarriersSection, ConnectionWizard) wrap their dialog in `focus-trap-react`. Tab key could escape the logs inspector.
5. **No Esc-to-close** — a11y inconsistency.

### Logic / data
6. **Stats vs. list semantic mismatch** — `/api/admin/logs/summary` counted carrier `outcome IN ('error','ignored')` as failed, but the StatCard label is "Failed" (red) and elsewhere `ignored` is rendered as a separate warning-colored badge. The list endpoint had the same drift: `failures_only` filtered carrier rows on `('error','ignored')` while the same toggle on webhook tab only filtered `'error'`.
   - Fix: standardize "failed" to **strictly `error`** across both summary and list endpoints. Users still see ignored events in the table and badge, and can now filter to ignored explicitly via the new outcome dropdown.
7. **No outcome filter** — UI exposed only the binary "failures only" toggle, but the API already supported `?status=` / `?outcome=`. Added a small select dropdown so admins can isolate `processed` / `ignored` / `error` independently.
8. **Polling never paused** — `refreshInterval` stayed at 15s/30s even when the tab was hidden. Wrapped the SWR config with a `usePageVisible()` hook to drop interval to 0 when the document is hidden, then resume on visibilitychange.

### Not addressed (out of scope, flagged for future)
- No date-range picker on the list (only the summary uses a 60-min window).
- Order-id truncation to 10 chars may collide for UUIDs (cosmetic).
- Stats fixed to a 60-min window — could become a selector.

## Changes shipped

| File | Change |
|---|---|
| `src/app/[locale]/(dashboard)/admin/logs/page.tsx` | Server-side `getServerUser()` + redirect, matching `settings/general/page.tsx`. Removed client-side `useAuth` gate. |
| `src/components/admin/LogsWorkspace.tsx` | Full rewrite: Tailwind utility classes + semantic tokens, shared `SettingsPageHeader`, FocusTrap + Esc handler on the inspector drawer, new outcome filter dropdown, RTL-safe logical properties. |
| `src/hooks/useLogsWorkspace.ts` | Added `outcome` parameter, added `usePageVisible()` to pause polling when tab is hidden. |
| `src/app/api/admin/logs/summary/route.ts` | Carrier `failed` count = `outcome === 'error'` only (was `error` + `ignored`). |
| `src/app/api/admin/carrier-events/route.ts` | `failures_only=true` returns only `outcome='error'` (was `error` + `ignored`), aligning with webhook tab semantics. |
| `src/messages/{fr,ar}.json` | Added `logs.filters.all` for the new outcome dropdown's "All" option. |

## Migration impact

- Replay endpoint untouched — all 10 existing tests still pass.
- Legacy redirect pages (`admin/webhook-logs`, `admin/carrier-events`) still bounce to `/admin/logs`, no change.
- Sidebar nav and i18n keys unchanged.
- No schema changes; the underlying tables `webhook_delivery_log` and `carrier_event_log` are untouched.
