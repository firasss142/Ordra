---
name: dashboard-empty-metrics-seed-timeline
description: Why dashboard/P&L show empty or wrong data — seed-data timeline vs. "today"-anchored default periods, not a calc bug
metadata:
  type: project
---

Dashboard KPIs and P&L looked "incorrect / empty" in both markets. Root cause was NOT the calculation code (revenue/COGS/fees/status-gating in `src/lib/profitability/load-summary.ts` + `src/lib/calculations/` are all correct, and `fetchAllRows` paginates fine).

The real cause: **seed/demo data is timestamped in the past and the two markets occupy disjoint time ranges**, while the app anchors default views to *today* (2026-07-06 in that session):
- Tunisia orders + fulfillment events: **Feb–Apr 2026** (Converty historical import via `scripts/import-converty-orders.cjs`, which stamps each order's single `order_history` row at `created_at = o.updated_at`).
- Libya: **May–Jul 2026** (later seeding).
- Dashboard default period = `{today, today}` (`dashboard/page.tsx`); P&L default = `lastNDaysPeriod(30)` (`pnl/ProfitabilityClient.tsx`). Both land on empty ranges for TN and lopsided ones for LY.

Revenue/costs are read from `order_history` rows filtered by `status_to` and bucketed by `order_history.created_at` — so a period with no delivered/returned/confirmed *events* shows zeros even if `orders.status` says delivered.

Secondary minor gap: ~91 TN orders have `status='delivered'` but no `delivered` row in `order_history` (all `carrier_id IS NULL`, Mar–Apr, perf-seed artifact) → ~5,353 revenue invisible to P&L. There is NO Postgres trigger auto-writing `order_history`; every transition must call app code (`applyFulfillmentTransition` etc.), so seed data can have gaps.

**Fix chosen:** smarter default period — anchor default to the latest activity date per market (`min(today, max(order_history.created_at) for market)`) instead of always today. See [[fix-anchor-default-period-to-latest-activity]] if that memory exists. User confirmed this is a demo/dev DB (safe to modify) but chose the code fix over re-dating seed data.

**Why:** future "metrics are broken" reports here are almost always this — check the selected period against actual data dates before touching calc code.
**How to apply:** query `max(order_history.created_at)` joined to `orders.market_id` per market first; compare to the dashboard/P&L default window.
