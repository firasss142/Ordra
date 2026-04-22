# Order Management System (OMS) — Product Specification
**Version 1.0 — April 2026**
*Single source of truth for product vision, business logic, roles, workflows, metrics, and inventory.*

---

## Table of Contents
1. [Product Overview](#1-product-overview)
2. [Market Architecture](#2-market-architecture)
3. [User Roles & Permissions](#3-user-roles--permissions)
4. [Storefront Integration Layer](#4-storefront-integration-layer)
5. [Internal Order Model](#5-internal-order-model)
6. [Order Status Model](#6-order-status-model)
7. [Assignment Engine](#7-assignment-engine)
8. [Confirmation Queue — Agent Workspace](#8-confirmation-queue--agent-workspace)
9. [Carrier Dispatch Layer](#9-carrier-dispatch-layer)
10. [Inventory Management](#10-inventory-management)
11. [Manager Dashboard](#11-manager-dashboard)
12. [Metrics & Performance Tracking](#12-metrics--performance-tracking)
13. [Multi-language Support](#13-multi-language-support)
14. [Technical Architecture Notes](#14-technical-architecture-notes)
15. [Out of Scope — v1](#15-out-of-scope--v1)

---

## 1. Product Overview

### 1.1 What it is
An internal Order Management System for a multi-market Cash on Delivery (COD) e-commerce operation running across Tunisia and Libya. The OMS:
- Receives orders from external storefronts via webhook
- Routes them to confirmation agents
- Manages the full phone confirmation workflow
- Dispatches confirmed orders to carrier APIs
- Tracks team performance, product profitability, and inventory

### 1.2 What it is NOT
- Not a storefront or product catalog builder
- Not a customer-facing interface
- Not a deep financial/investor reporting tool (that is a separate product)
- Not an automated dialer or communication platform

### 1.3 Product boundary

| Responsibility | Owner |
|---|---|
| Order creation | Easy Orders (storefront) |
| Everything after order creation | This OMS |
| Deep profitability & investor reporting | Separate profitability tool |
| Customer communication | Agent via phone (outside system) |

### 1.4 Storefront integrations

| Version | Storefront | Method |
|---|---|---|
| v1 | Easy Orders (`app.easy-orders.net`) | Webhook + REST API |
| Future | Shopify | Adapter (same interface) |
| Future | WooCommerce | Adapter (same interface) |

The integration layer is built as an **adapter pattern from day one** — new storefronts require only a new adapter, zero changes to OMS core logic.

### 1.5 Carrier integrations

| Market | Carrier | Method |
|---|---|---|
| Tunisia | Navex | REST API |
| Libya | Libyan carriers (TBD) | REST API |

---

## 2. Market Architecture

Two completely independent markets operate under one system. Data, agents, orders, products, carriers, and financial figures are **fully isolated per market**.

| Dimension | Tunisia | Libya |
|---|---|---|
| Language | French | Arabic (RTL) |
| Currency | TND | LYD |
| Carrier | Navex | Libyan carriers |
| Agent team | Local + remote mix | Local + remote mix |
| Data isolation | Complete | Complete |

### 2.1 Isolation rules
- An agent assigned to Tunisia **never sees** Libyan orders, and vice versa
- A Market Manager sees **only their market**
- Only the Super Admin has cross-market visibility
- All financial calculations are market-scoped
- Isolation is enforced at the **data layer** (row-level security), not just the UI

---

## 3. User Roles & Permissions

### 3.1 Role definitions

**Super Admin**
- Full access across all markets
- Configures markets, storefronts, carrier integrations, and assignment algorithms
- Creates Market Manager accounts
- Views cross-market performance dashboard
- Typically 1–2 accounts (owner level)

**Market Manager**
- Scoped to one market only
- Creates and manages agent accounts within their market
- Configures and switches the assignment algorithm
- Sees full order pool: unassigned + all agent queues
- Views team performance dashboard and product profitability
- Cannot access the other market

**Confirmation Agent**
- Sees only their personal assigned queue
- Executes the confirmation call workflow
- Logs call outcomes: confirmed, rejected, no answer, callback
- Selects carrier when confirming (triggers dispatch)
- Views their own daily performance stats only
- No access to financial data, other agents' queues, or settings

### 3.2 Permission matrix

| Action | Super Admin | Market Manager | Agent |
|---|---|---|---|
| Create/manage markets | ✅ | ❌ | ❌ |
| Create agent accounts | ✅ | ✅ own market | ❌ |
| Configure storefront webhooks | ✅ | ❌ | ❌ |
| Configure carriers | ✅ | ❌ | ❌ |
| Configure assignment algorithm | ✅ | ✅ own market | ❌ |
| View unassigned order pool | ✅ | ✅ own market | ❌ |
| Assign / reassign orders | ✅ | ✅ own market | ❌ |
| View all agents' queues | ✅ | ✅ own market | ❌ |
| Work confirmation queue | ❌ | ❌ | ✅ |
| View team performance metrics | ✅ | ✅ own market | Own stats only |
| View product profitability | ✅ | ✅ own market | ❌ |
| View business profitability | ✅ | ✅ own market | ❌ |
| Manage product catalog + costs | ✅ | ✅ own market | ❌ |
| Manage inventory stock levels | ✅ | ✅ own market | ❌ |

---

## 4. Storefront Integration Layer

### 4.1 Easy Orders webhook intake (v1)

Easy Orders pushes order events to the OMS in real time. On receipt, the OMS:
1. Validates the webhook signature
2. Maps Easy Orders fields → OMS internal order model
3. Tags the order with the correct `market` based on storefront configuration
4. Places the order in the **unassigned pool**
5. Triggers the assignment engine (if auto-assignment is configured)

**Webhook events handled:**

| Event | Action |
|---|---|
| `order.created` | Create order in OMS with status `new` |
| `order.updated` | Update relevant fields if order is still pre-dispatch |
| `order.cancelled` | Mark as `cancelled` if not yet dispatched |

### 4.2 Adapter pattern (extensibility)

```
StorefrontAdapter (interface)
  ├── EasyOrdersAdapter     ← v1
  ├── ShopifyAdapter        ← future
  └── WooCommerceAdapter    ← future
```

Each adapter is responsible for:
- Authenticating with the platform
- Receiving or polling for order events
- Mapping platform-specific fields → OMS internal order model
- Handling platform-specific edge cases

New platforms require **only a new adapter** — zero changes to OMS confirmation, dispatch, or metrics logic.

---

## 5. Internal Order Model

The OMS maintains a platform-agnostic order model. Storefront-specific fields are mapped on intake and the raw payload is stored for debugging only.

```
order
  id                    internal OMS UUID
  external_id           storefront order ID
  storefront            easy_orders | shopify | woocommerce
  market                tn | ly
  status                (see Section 6)

  customer
    name
    phone
    address
    city
    note                customer note from checkout

  product
    id                  OMS product ID
    name
    variant             selected variant label
    quantity            number of units in selected variant
    unit_price
    total_price         SOURCE OF TRUTH for revenue

  assigned_to           agent_id | null
  carrier               carrier_id | null
  tracking_number       assigned by carrier on dispatch

  created_at
  updated_at

  history[]
    status_from
    status_to
    actor_id            agent or system
    timestamp
    note                rejection reason, callback note, etc.
```

---

## 6. Order Status Model

The OMS uses its own internal status model, completely independent of any storefront. Storefront statuses are mapped on intake only.

### 6.1 Status pipeline

```
new
 └─→ assigned
      ├─→ attempt_1
      │    └─→ attempt_2
      │         └─→ attempt_3
      ├─→ callback_scheduled  (can repeat)
      ├─→ confirmed
      │    └─→ dispatched     (terminal)
      └─→ rejected            (terminal)

cancelled                     (terminal — manager or system)
```

### 6.2 Status definitions

| Status | Set by | Definition |
|---|---|---|
| `new` | System (webhook) | Order received, not yet assigned to an agent |
| `assigned` | System / Manager | Assigned to an agent, visible in their queue |
| `attempt_1` | Agent | Called customer, no answer — first attempt |
| `attempt_2` | Agent | Second call, no answer |
| `attempt_3` | Agent | Third call, no answer |
| `callback_scheduled` | Agent | Customer asked to be called back at a specific time |
| `confirmed` | Agent | Customer confirmed, carrier selected, pushing to carrier API |
| `dispatched` | System | Successfully pushed to carrier API — exits the queue |
| `rejected` | Agent | Customer refused, unreachable, duplicate, or wrong number |
| `cancelled` | System / Manager | Cancelled pre-dispatch via storefront or manager override |

### 6.3 Transition rules

- Only **agents** can set: `attempt_*`, `callback_scheduled`, `confirmed`, `rejected`
- Only the **system** sets: `new`, `dispatched`
- **Managers** can force `cancelled` at any pre-dispatch status
- `dispatched`, `rejected`, `cancelled` are **terminal** — no further transitions
- Max attempts before forced decision: **configurable per market** (default: 3)

### 6.4 History log (immutable)

Every status transition is recorded with:
- Previous status → new status
- Actor ID (agent or system)
- Timestamp
- Optional note (rejection reason, callback instructions, error message)

History is append-only. No edits or deletes.

---

## 7. Assignment Engine

### 7.1 Two operating modes

**Manual mode:** Manager assigns all orders from the unassigned pool individually or in bulk.

**Auto mode:** System assigns orders automatically on intake using the configured algorithm. Manager can still override at any time.

Mode is configurable per market in settings.

### 7.2 Assignment algorithms

| Algorithm | Logic |
|---|---|
| Round Robin | Distribute sequentially across all active agents in the market |
| Workload-based | Assign to the agent with the fewest open (non-terminal) orders |
| Product-based | Route specific products to designated agents or agent groups |
| Region-based | Route by customer city/region to agents familiar with that area |

- Active algorithm is set by the Market Manager in settings
- Switching algorithms applies to **new assignments only** — existing assignments unaffected
- Only **active agents** receive auto-assignments (configurable activity threshold)

### 7.3 Manual override (always available)

Regardless of algorithm, the manager can always:
- Manually assign any unassigned order to a specific agent
- Reassign any order from one agent to another (e.g. agent absence)
- Bulk-assign a filtered set of orders (by product, region, status, or time range)
- Return assigned orders to the unassigned pool

---

## 8. Confirmation Queue — Agent Workspace

### 8.1 Interface overview

The agent's primary and only workspace. **Desktop-first**. Shows only the orders assigned to that agent. Fully isolated — no visibility into other agents' work or any financial data.

### 8.2 Queue sorting (priority order)

1. `callback_scheduled` orders where the callback time has arrived
2. `attempt_*` orders sorted oldest first
3. `assigned` (new, not yet attempted) sorted oldest first

### 8.3 Queue header

- Agent name
- Today's stats: Assigned | Actioned | Confirmation rate %
- Status bucket badges: Nouveau | Tentative 1 | Tentative 2 | Tentative 3 | Rappel prévu | Confirmé (non expédié)

### 8.4 Order card (list view)

Each card displays:
- Customer name
- Phone number (click-to-call)
- City / region
- Product name + selected variant
- Total price
- Time elapsed since order creation
- Attempt count
- Scheduled callback time (if applicable)
- Customer checkout note (truncated with expand)

### 8.5 Post-call action sheet

After clicking **"Appel terminé"**, a modal presents 4 outcome options. This is the highest-frequency interaction in the system — optimized for speed and zero accidental taps.

---

**Option 1 — Pas de réponse**
- Logs attempt (increments status: `attempt_1` → `attempt_2` → `attempt_3`)
- Prompts for next callback time (default: +2h, adjustable)
- Order returns to queue sorted by callback time

**Option 2 — Confirmé**
- Agent selects carrier from configured list for this market
- One-click confirm → system pushes to carrier API immediately
- On success: status = `dispatched`, tracking number stored, order exits queue
- On failure: error displayed, order stays `confirmed`, retry available

**Option 3 — Rejeté**
- Agent selects rejection reason (required):
  - Refus client
  - Faux numéro
  - Doublon
  - Injoignable (max tentatives atteintes)
  - Autre (free text)
- One tap to confirm → order exits queue immediately
- Minimum friction — agents reject many orders daily

**Option 4 — Rappel demandé**
- Customer asked to be called back later
- Agent selects specific date + time
- Status = `callback_scheduled`
- Order disappears from active queue and resurfaces automatically at scheduled time

---

### 8.6 Order detail view

Clicking any order opens full detail:
- Complete customer information
- Full product + variant breakdown with pricing
- Full status history timeline (who did what, when, with notes)
- All previous call attempt notes

---

## 9. Carrier Dispatch Layer

### 9.1 Dispatch flow

When agent confirms + selects carrier:
1. OMS formats order payload per carrier API specification
2. OMS pushes to carrier API **synchronously**
3. **On success:** status → `dispatched`, tracking number stored, order exits queue
4. **On failure:** error message shown to agent, order stays `confirmed`, retry button available

### 9.2 Carrier configuration (per market)

Each market has one or more configured carriers. Each carrier config stores:

| Field | Description |
|---|---|
| Name | Display name shown to agent |
| API endpoint | Carrier REST API URL |
| API credentials | Stored encrypted |
| Delivery fee | Per delivered order (used in profitability calculation) |
| Return fee | Per returned order (used in profitability calculation) |
| Active | Toggle on/off without deleting config |

### 9.3 Adapter pattern (extensibility)

```
CarrierAdapter (interface)
  ├── NavexAdapter          ← Tunisia
  ├── LibyanCarrier1Adapter ← Libya
  └── [future carriers]
```

New carriers require only a new adapter — zero changes to confirmation or metrics logic.

---

## 10. Inventory Management

### 10.1 Principles

- Initial stock is **manually set** when creating a product in the OMS
- Stock is only affected by **physical fulfillment events** — not by confirmations, rejections, or cancellations before physical pickup
- Every stock movement is recorded in an immutable log

### 10.2 Stock movement rules

| Event | Stock change | When it triggers |
|---|---|---|
| Product created in OMS | Set to initial value | Manual input |
| Order reaches `deposit` status | **−1** | Carrier physically picks up the package |
| Order reaches `returned` or `to_be_returned` | **+1** | Package physically back at warehouse |
| Order `delivered` | No change | Already decremented at deposit |
| Order `rejected` before deposit | No change | Never left warehouse |
| Order `cancelled` before deposit | No change | Never left warehouse |
| Order `abandoned` / `pending` | No change | Never left warehouse |

> **Critical rule:** Stock is only touched at `deposit` (physical pickup) and `returned` (physical return). Everything before deposit — including agent confirmation and carrier upload — has zero stock impact.

### 10.3 Damaged returns

When a returned package contains a **damaged product**:
- Manager marks the return event as damaged (toggle)
- Stock is **NOT incremented** — damaged item is not resellable
- Damaged return count tracked per product as a separate counter (not per-order flag)
- Visible on the product page as: Total returned | Damaged (not restocked) | Net restocked

### 10.4 Stock visibility

- Current stock count shown on each product card
- Low stock alert threshold: configurable per product
- Stock movement log per product: date, order reference, change (+1 / −1), new balance
- Manager can manually adjust stock with a mandatory note (e.g. restock, damaged write-off)

---

## 11. Manager Dashboard

### 11.1 Navigation structure

```
Dashboard (overview KPIs)
├── Unassigned Pool        ← always-visible badge with count
├── Team View              ← all agents + live queue status
├── Orders                 ← full order list with filters
├── Products               ← catalog + profitability + inventory
├── Carriers               ← carrier config per market
└── Settings               ← market config, algorithm, agent accounts
```

### 11.2 Unassigned pool

- All `new` orders not yet assigned to an agent
- **Badge count always visible in nav** — impossible to miss
- Filterable by: product, city/region, time received
- Bulk actions: assign to agent, assign by algorithm
- Individual assign: select agent from dropdown

### 11.3 Team view

Live table of all agents in the market:

| Agent | Queue size | Actioned today | Confirmed | Rejected | Confirmation rate | Avg attempts |
|---|---|---|---|---|---|---|

- Click any agent row → drill into their full queue and order history
- Status indicator: active (actioned an order today) vs idle

### 11.4 Reassignment

- Select one or multiple orders from any agent's queue
- Reassign to another agent or return to unassigned pool
- Primary use case: agent absence, workload rebalancing

### 11.5 Order list (full view)

Complete order history with filters: status, product, agent, city, date range. Export to CSV.

### 11.6 Agent management

- Create agent: name, phone, market, login credentials
- Deactivate agent: open orders automatically return to unassigned pool
- Reset password

---

## 12. Metrics & Performance Tracking

### 12.1 Team metrics (per agent, per period)

| Metric | Formula |
|---|---|
| Orders assigned | Count assigned in period |
| Orders actioned | Orders reaching `confirmed`, `dispatched`, or `rejected` |
| Confirmation rate | (Confirmed + Dispatched) ÷ Actioned × 100 |
| Rejection rate | Rejected ÷ Actioned × 100 |
| Avg attempts per confirmed | Sum of attempts on confirmed orders ÷ confirmed count |
| Open / pending | Orders still in non-terminal status |

**Rejection reason breakdown (per agent, per period):**

| Reason | Count | % of rejections |
|---|---|---|
| Refus client | | |
| Faux numéro | | |
| Doublon | | |
| Injoignable | | |
| Autre | | |

> **Diagnostic value:**
> High "refus client" → product / pricing / targeting problem
> High "faux numéro" → lead quality problem
> High "injoignable" → timing or region problem
> One agent high vs team average → individual performance issue

**Team leaderboard:** agents ranked by confirmation rate for the selected period.

### 12.2 Business profitability (market level, per period)

| Metric | Source |
|---|---|
| Total orders received | Webhook intake count |
| Total confirmed / dispatched | Status count |
| Total rejected | Status count |
| Confirmation rate | Confirmed ÷ Total received |
| Gross revenue | Sum of `total_price` on delivered orders |
| Total delivery costs | Delivered × carrier delivery fee |
| Total return costs | Returned × carrier return fee |
| Total COGS | Sum of (unit_cost × quantity) on delivered orders |
| Total packing cost | Confirmed × packing cost per order |
| Total ad spend | Manually entered per period |
| **Simplified net profit** | Revenue − COGS − delivery − returns − packing − ad spend |

### 12.3 Product profitability (per product, per period)

**Manually configured per product:**

| Variable | Input type |
|---|---|
| Coût du produit (COGS) | Per unit, manual |
| Coût de livraison | From carrier config (auto) |
| Coût de retour | From carrier config (auto) |
| Coût de traitement par confirmation | Flat per confirmed order, manual (optional) |
| Coût du lead (CPL) | Per period, manual |
| Packing cost | Per package, manual |
| Prix de vente total | From order data (auto) |

**Computed from real order data:**

| Metric | Formula |
|---|---|
| Total leads | All orders for this product in period |
| Taux de confirmation | Confirmed ÷ Total leads |
| Taux de livraison | Delivered ÷ Dispatched |
| Taux de retour | Returned ÷ Dispatched |
| Revenue | Sum of `total_price` on delivered orders |
| Total COGS | Delivered × unit COGS |
| Total delivery cost | Delivered × delivery fee |
| Total return cost | Returned × return fee |
| Total packing cost | Confirmed × packing cost |
| Total ad spend | CPL × total leads |
| Total confirmation processing cost | Confirmed × processing cost per confirmation |
| **Simplified net profit** | Revenue − COGS − delivery − returns − packing − ad spend − processing cost |
| Cost per delivered order | Total costs ÷ delivered count |

**Product performance summary card:**
- Current stock level + low stock alert
- Confirmation rate %
- Delivery rate %
- Return rate %
- Revenue (period)
- Simplified net profit (period)
- Cost per delivered order

---

## 13. Multi-language Support

| Market | Language | Layout direction |
|---|---|---|
| Tunisia | French | LTR |
| Libya | Arabic | RTL (full right-to-left) |

- Language is determined automatically by market assignment — no manual toggle needed
- Arabic interface requires **complete RTL layout**, not just translated labels
- All status labels, action buttons, rejection reasons, and notifications are localized per market
- Date, time, and number formats respect locale conventions
- Currency shown with market symbol (TND / LYD)

---

## 14. Technical Architecture Notes

### 14.1 Core design principles

- OMS is the **system of record** post-intake — external platforms are read-only intake sources
- **Adapter pattern** for both storefronts and carriers — pluggable from day one
- All configurable variables (carrier fees, packing cost, assignment algorithm) stored in **database settings table** — never hardcoded
- Order history is **append-only and immutable** — no edits, no deletes ever
- Market isolation enforced at the **data layer** (row-level security), not just UI
- Carrier dispatch is **synchronous** with immediate success/failure feedback to agent
- Financial calculations are **server-side only** — never computed on the client

### 14.2 Key data entities

| Entity | Purpose |
|---|---|
| `markets` | Market config, language, currency, active storefront, active carriers |
| `users` | All users with role + market assignment |
| `orders` | Internal platform-agnostic order model |
| `order_history` | Immutable event log per order |
| `products` | Product catalog with COGS, packing cost, CPL, stock levels |
| `inventory_log` | Immutable stock movement log per product |
| `carriers` | Carrier config per market with fee structure |
| `storefronts` | Storefront config per market with webhook credentials |
| `settings` | Market-level configurable variables |
| `assignment_rules` | Algorithm config and agent group rules per market |

### 14.3 Integration event flow

| Event | Trigger | OMS Action |
|---|---|---|
| Webhook received | Easy Orders pushes order | Intake → unassigned pool → assignment engine |
| Order confirmed | Agent confirms + selects carrier | Push to carrier API synchronously |
| Deposit status received | Carrier webhook / manual update | Decrement inventory −1 |
| Return status received | Carrier webhook / manual update | Increment inventory +1 (unless damaged) |

> **Note on carrier status sync in v1:** Deposit and return status updates may need to be entered manually or via a polling mechanism until carrier webhook integration is complete. Inventory rules apply identically regardless of how the status update arrives.

---

## 15. Out of Scope — v1

| Feature | Notes |
|---|---|
| Mobile interface | Desktop-first for all users in v1 |
| Customer-facing order tracking page | Future |
| SMS / WhatsApp notifications to customers | Future |
| Automated dialer or call recording | Future |
| Meta / TikTok ad spend API integration | Manual entry in v1 |
| Deep financial reporting and investor settlements | Separate profitability tool |
| Carrier status webhook (delivered / returned) | Manual or polling in v1, full webhook future |
| Multi-currency conversion | Each market uses its own currency independently |
| Product bundle / variant COGS complexity | Simple unit × quantity in v1 |

---

*End of OMS Specification v1.0*

**Recommended next steps:**
1. Database schema design
2. Tech stack decision + project scaffolding
3. Session-by-session implementation plan