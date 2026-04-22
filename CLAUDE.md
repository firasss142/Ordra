# OMS — Order Management System

## WHY
Internal OMS for multi-market COD e-commerce (Tunisia + Libya).
Webhook intake → agent phone confirmation → carrier dispatch → performance tracking.
Two fully isolated markets under one system. Desktop-first.

## WHAT
- Next.js 14 App Router + TypeScript + Tailwind
- Supabase (database + auth + RLS + Realtime)
- Vitest + Testing Library (TDD — test first, always)
- SWR for client-side data fetching (instant navigation)
- Deployed on Vercel
- Two markets: Tunisia (French, LTR) + Libya (Arabic, RTL)
- Three roles: super_admin (cross-market), market_manager (own market), agent (own queue)

## Stack layout
src/
  app/[locale]/              → locale-routed pages (fr | ar)
  app/[locale]/(dashboard)/  → manager + super_admin views
  app/[locale]/(agent)/      → agent confirmation queue (no sidebar)
  app/api/webhooks/          → storefront webhook endpoints
  components/ui/             → Button, Input, Card, Badge, Modal, Toast
  components/layout/         → Sidebar, Topbar, NavItem
  lib/supabase/              → browser + server clients
  lib/calculations/          → financial logic (SERVER-SIDE ONLY — never client)
  lib/carriers/              → CarrierAdapter interface + implementations
  lib/storefronts/           → StorefrontAdapter interface + implementations
  types/                     → TypeScript types + order status definitions
  hooks/                     → SWR data hooks
  messages/                  → i18n translations (fr.json, ar.json)
  test/                      → test setup + shared helpers (NOT production code)

## Commands
- npm run dev — local dev server
- npm test — run tests (TDD: run constantly)
- npm run test:run — single test pass
- npm run typecheck — after every file change
- npm run lint — before every commit
- npm run build — verify production build

## TDD — NON-NEGOTIABLE
- Read .claude/skills/test-driven-development/SKILL.md
- Write failing test FIRST → watch it fail → minimal code to pass → refactor
- No production code without a failing test
- Test utilities in src/test/helpers/ — NEVER add test-only methods to production code
- Read .claude/skills/test-driven-development/testing-anti-patterns.md before adding mocks

## Critical rules
- **UI/UX & Design**: Follow design-system.md for all interface design, styling, and layout — Shopify-inspired dark sidebar, light content, zero decoration
- Market isolation enforced via RLS at data layer — never rely on UI filtering alone
- Save every Claude-created plan under `/Users/firaskarchoud/Documents/ORDER MANAGMENT SYSTEM/oms/plans`
- Revenue = orders.total_price ONLY — never other price fields
- All cost variables from DB settings table — NEVER hardcode fees or rates
- Financial calculations → lib/calculations/ server-side only — never in client components
- Order history (order_history table) is APPEND-ONLY — never update or delete rows
- Inventory log (inventory_log table) is APPEND-ONLY — never update or delete rows
- Carrier dispatch is synchronous — immediate success/failure feedback to agent
- Adapter pattern for storefronts and carriers — new integrations = new adapter, zero core changes
- Supabase service role → server only (webhooks, admin user creation) — never in browser client

## OMS status model — two phases

### Phase 1: Confirmation (agent workflow)
new → assigned → attempt_1/2/3 → callback_scheduled → confirmed → dispatched (exits queue)
                                                                 → rejected (TERMINAL)
cancelled (TERMINAL — manager/system, any pre-dispatch status)

### Phase 2: Fulfillment (carrier lifecycle, post-dispatch)
dispatched → deposit → in_transit → delivered (TERMINAL)
                                  → returned (TERMINAL)

## Key boundaries
- dispatched = order exits agent queue, enters fulfillment tracking
- scanned = STOCK BOUNDARY: warehouse scan-out deducts stock −qty (confirmed → scanned)
- deposit = COST BOUNDARY: carrier fees begin here (stock already deducted at scanned)
- delivered = revenue realized
- returned = stock +qty (unless damaged, which increments damaged_return_count)

## Stock integrity model
Stock (products.current_stock and damaged_return_count) changes via EXACTLY three paths — anything else is a bug:
1. super_admin sets initial_stock on product creation (one inventory_log row, reason='initial_stock')
2. super_admin calls adjust_product_stock RPC for manual corrections (reason='manual_adjustment' or 'damaged_writeoff')
3. warehouse_agent / market_manager / super_admin call scan_order_out (−qty) or scan_return_in (+qty or damaged)
Market managers and agents NEVER mutate stock. Market managers and warehouse_agents CAN toggle products.is_active via toggle_product_active RPC — that is the ONLY product field they can change.

## Terminal statuses: delivered, returned, rejected, cancelled
## Fulfillment statuses set by: system (carrier webhook/polling) or manager (manual update)
## Agents NEVER set: dispatched, deposit, in_transit, delivered, returned

## Status transition rules
- Agents set: attempt_*, callback_scheduled, confirmed, rejected
- System sets: new, dispatched, deposit, in_transit, delivered, returned
- Managers can force: cancelled (any pre-dispatch status)
- Terminal = no further transitions: delivered, returned, rejected, cancelled
- Max attempts: configurable per market via settings table (default 3)

## Rejection reasons (required when status = rejected)
refus_client | faux_numero | doublon | injoignable | prix | non_serieux | autre (+ free text for autre)

## Agent queue sort order
1. callback_scheduled where callback_time ≤ now
2. attempt_* sorted oldest created_at first
3. assigned (new, untouched) sorted oldest created_at first

## Design system
- Shopify-inspired: dark sidebar (#1A1A1A), light content (#F6F6F7), white cards
- System fonts, 14px base, black text on white — maximum contrast
- Zero gradients, zero shadows at rest, zero decoration
- Functional color ONLY on status badges — everything else black/white/gray
- RTL: full layout mirror for Arabic market
- See docs/design-system.md for full tokens and rules

## References (load on demand — do NOT @-include these)
- Full OMS specification: docs/oms-spec.md
- Database schema reference: docs/database-schema.md
- Order status pipeline: docs/order-pipeline.md
- Design system tokens + rules: docs/design-system.md
- Business profitability logic: docs/business-logic.md (created in Session 12)
- Claude Code mastery patterns: docs/mastery-guide.md


- super_admin: admin@oms.local / testpass123
- tn_manager: [manager.tn](http://manager.tn/)@oms.local / testpass123
- ly_manager: [manager.ly](http://manager.ly/)@oms.local / testpass123
- tn_agent_1: [agent1.tn](http://agent1.tn/)@oms.local / testpass123
- tn_agent_2: [agent2.tn](http://agent2.tn/)@oms.local / testpass123
- ly_agent_1: [agent1.ly](http://agent1.ly/)@oms.local / testpass123
- tn_warehouse: warehouse.tn@oms.local / testpass123
- ly_warehouse: warehouse.ly@oms.local / testpass123