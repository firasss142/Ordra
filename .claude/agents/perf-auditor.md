---
name: perf-auditor
description: Audit Next.js + Supabase codebases for performance issues — N+1 queries, missing indexes, client-side financial computation, missing SWR/cache, heavy re-renders, unclean subscriptions, and missing prefetch. Use this skill after any data-fetching work, list/table component changes, Supabase query edits, order/product/agent model changes, or when the user asks to review performance, optimize queries, or fix slow pages. Also trigger when the user says "audit", "slow", "laggy", "re-renders", "optimize", or mentions database performance.
tools: Read, Grep, Glob, LS
model: haiku
---

# Performance Auditor for Next.js + Supabase (COD E-commerce)

Run a systematic performance audit across 7 categories. For each category, search the codebase using the patterns below, report findings with file paths and line numbers, and classify severity.

## Audit Workflow

1. Identify the scope — which files changed or which directory to audit
2. Run each check below in order
3. Output a summary table at the end (see Report Format)

---

## Check 1: N+1 Queries

The most common perf killer in order/product list pages. Look for Supabase queries inside loops, `.map()`, or `.forEach()` callbacks — especially when fetching related data (products, agents, customers) per row instead of batch-fetching.

**Search patterns:**
- `.map(` or `.forEach(` containing `.from(` or `supabase.` inside the callback body
- Queries inside `for (` or `while (` loops
- Multiple sequential `.from('orders')` then `.from('products')` without `.select('*, products(*)')` joins

**Fix direction:** Use Supabase foreign key joins: `.select('*, products(*), agents(*)')` to fetch related data in a single query. For non-relational data, batch-fetch with `.in('id', ids)`.

---

## Check 2: Supabase Queries Missing LIMIT

Unbounded queries on tables that grow (orders, products, customers, logs) will degrade over time. Every `.from()` query on a large table needs either `.limit()`, `.range()`, or pagination.

**Search patterns:**
- `.from(` followed by `.select(` without a `.limit(`, `.range(`, or `.single()` in the chain
- Pay special attention to tables: `orders`, `products`, `customers`, `deliveries`, `returns`, `logs`

**Exceptions — safe to skip:**
- Queries with `.single()` or `.maybeSingle()`
- Queries filtering to a known small set (e.g., `.eq('user_id', id)` on a table with few rows per user)
- Dropdown/enum lookups on small reference tables (`statuses`, `cities`, `zones`)

---

## Check 3: Client-Side Financial Calculations

Financial math (totals, margins, commissions, COD amounts, delivery fees, refunds) in client components introduces rounding inconsistencies and security risks. These must live server-side — in API routes, server actions, Supabase RPC functions, or database triggers.

**Search patterns:**
- Grep for arithmetic operators near financial variable names: `total`, `price`, `margin`, `commission`, `fee`, `cost`, `revenue`, `profit`, `amount`, `discount`, `tax`, `subtotal`, `cod`
- Look in files under `components/` or any file with `'use client'` directive
- Watch for `toFixed(`, `Math.round(`, `parseFloat(` near money values in client code

**Fix direction:** Move calculations to Supabase RPC functions or Next.js server actions. Client should only display pre-computed values.

---

## Check 4: Data Fetching Without Cache/SWR

Client-side fetches that don't use SWR, React Query, or Next.js `unstable_cache` / `revalidate` will re-fetch on every render and navigation. This creates unnecessary load and flickering UI.

**Search patterns:**
- `useEffect` containing `fetch(` or `supabase.from(` without being wrapped in `useSWR`, `useQuery`, or a custom hook that uses these
- Raw `fetch()` in client components without caching headers
- `getServerSideProps` or server components doing expensive queries without `revalidate` or `cache()`

**Exceptions:**
- Mutations (POST/PUT/DELETE) don't need caching
- Realtime-subscribed data is inherently fresh

---

## Check 5: Missing Link Prefetch on High-Frequency Navigation

Pages users navigate to constantly (order list → order detail, dashboard → reports) should use Next.js `<Link prefetch>` to preload the destination. Without it, every navigation feels slow.

**Search patterns:**
- `<Link` without `prefetch` prop (or with `prefetch={false}`) on routes like `/orders/`, `/dashboard`, `/products/`, `/reports/`
- `router.push(` used instead of `<Link>` for regular navigation (misses prefetch entirely)

**Fix direction:** Use `<Link href="/orders/[id]" prefetch>` for high-traffic paths. Reserve `router.push` for programmatic navigation after actions.

---

## Check 6: Supabase Realtime Subscriptions Not Cleaned Up

Subscriptions created in `useEffect` without cleanup in the return function cause memory leaks and duplicate event handlers — especially on pages with frequent mount/unmount cycles (tabs, modals, route changes).

**Search patterns:**
- `.channel(` or `.on('postgres_changes'` inside `useEffect` without a corresponding `supabase.removeChannel(` in the cleanup return
- `.subscribe()` without storing the channel reference for later cleanup
- Multiple subscriptions created without unsubscribing previous ones

**Correct pattern:**
```typescript
useEffect(() => {
  const channel = supabase.channel('orders')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, handler)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}, []);
```

---

## Check 7: Unnecessary Re-renders

Components that re-render on every parent render without memoization cause cascading performance issues — especially in lists (order tables, product grids) and dashboards with many widgets.

**Search patterns:**
- Large list/table components not wrapped in `React.memo()`
- Expensive computations (filtering, sorting, aggregating) without `useMemo`
- Callback props recreated every render without `useCallback`
- Objects/arrays created inline as props: `style={{ }}`, `options={[]}` — these break shallow comparison
- Context providers with value objects recreated each render

**Priority targets:** Focus on components that render inside `.map()` loops or receive frequently-changing parent state.

---

## Report Format

After running all checks, output a summary like this:

```
## Performance Audit Summary

| # | Check                    | Status | Issues | Severity |
|---|--------------------------|--------|--------|----------|
| 1 | N+1 Queries              | ❌     | 3      | HIGH     |
| 2 | Missing LIMIT            | ⚠️     | 1      | MEDIUM   |
| 3 | Client-Side Finance      | ✅     | 0      | —        |
| 4 | Missing Cache/SWR        | ❌     | 5      | HIGH     |
| 5 | Missing Link Prefetch    | ⚠️     | 2      | LOW      |
| 6 | Realtime Cleanup         | ❌     | 1      | HIGH     |
| 7 | Unnecessary Re-renders   | ⚠️     | 4      | MEDIUM   |

### Detailed Findings
[For each issue: file path, line number, what's wrong, suggested fix]
```

**Severity guide:**
- **HIGH** — Causes visible slowness, data inconsistency, or memory leaks in production
- **MEDIUM** — Will degrade as data grows or under concurrent users
- **LOW** — Minor optimization opportunity, fix when convenient