-- ============================================================
-- 20260829000001_orders_phone_norm_indexes.sql
-- Indexes that make the agent-queue enrichment RPCs sargable.
--
-- WHY: get_customer_history_batch is the single largest consumer of database
-- time on this instance — 81,539 calls, 28,930 s total (11.8% of ALL database
-- time), mean 354.8 ms, max 7,791.6 ms. That max is not a slow query, it is the
-- role-level statement_timeout (authenticated = 8s) firing: the RPC never
-- returns, src/lib/customer-history/enrich.ts:73-79 catches the error and
-- renders every row with EMPTY repeat-buyer data. Agents wait 8 seconds to
-- receive nothing.
--
-- The cause is a non-sargable join. Both RPCs match customers with
--     normalize_phone(o.customer_phone) = <input>  OR  ... 3 more branches
-- Wrapping the column in a function makes every existing index unreachable, so
-- the planner has only a Nested Loop over the full cross product. Measured on
-- one real agent (270 active orders, 2,527 orders in market): 682,290 pair
-- evaluations to return 15 rows, 3,314 ms, plan cost 1,049,724. Cold/contended
-- the same plan measured 12,477 ms.
-- normalize_phone is plpgsql at 3.57 us/call (measured: 200,000 calls in
-- 714.3 ms); at ~4 calls per pair that IS the entire runtime.
--
-- These indexes make the expression itself the index key. Companion migration
-- 20260829000002 rewrites the join to `= ANY (i.phones)` so it can reach them.
-- The index alone does nothing without that rewrite, and vice versa — ship both.
--
-- Measured plan shape, proven pre-deploy by running the `= ANY` form against two
-- EXISTING indexes of the same shapes (one plain btree, one expression btree)
-- standing in for these:
--     Nested Loop (cost=6.14..5113.61)                      actual 12.2 ms
--       -> Bitmap Heap Scan on orders                       loops=270
--            BitmapOr
--              -> Bitmap Index Scan  Index Cond: (market_id = ... AND <expr> = ANY (i.phones))
--              -> Bitmap Index Scan  Index Cond: (market_id = ... AND <expr> = ANY (i.phones))
-- Cost 239,586 -> 5,573. Wall 3,314 ms -> 12.2 ms.
--
-- normalize_phone is provolatile='i' (IMMUTABLE), so it is legal as an index
-- key. It is also proparallel='u', which is a mis-marking rather than a
-- decision — it makes every query touching it parallel-unsafe. Corrected in
-- 20260829000002.
--
-- CONCURRENTLY cannot run inside a transaction block, and the CLI wraps each
-- migration file in one. Same reason 019_performance_indexes.sql,
-- 031_perf_indexes_batch_d.sql and 20260425_crm_redesign_indexes.sql are
-- index-only files: this file must contain index DDL and nothing else, with no
-- BEGIN;/COMMIT;. DROP INDEX CONCURRENTLY has the same restriction, so the
-- reclaims below belong here too rather than in the function migration.
--
-- NON-GOALS: no table, row, policy or function is touched here. No column is
-- added — a STORED generated column would need a full-table ACCESS EXCLUSIVE
-- rewrite on a table taking live webhook writes, and would ship two extra
-- fields on every select("*") in the agent queue, for no planner benefit over
-- an expression index (proven above). order_history and inventory_log remain
-- append-only and are not referenced.
-- ============================================================

-- Driving index for the phone match in both RPCs.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_market_phone_norm
  ON orders (market_id, normalize_phone(customer_phone));

-- Required even though only 2 of 7,035 rows currently have a customer_phone_2.
-- This is not about selectivity: if EITHER side of the OR lacks an index the
-- planner cannot form a BitmapOr at all and falls straight back to the 3,314 ms
-- Nested Loop. The near-empty key range costs ~200 kB and is never probed,
-- because `phones` has '' removed and so can never match it.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_market_phone2_norm
  ON orders (market_id, normalize_phone(customer_phone_2));

-- lead_phone_matches inside get_customer_history_batch. That leg already plans
-- as a Hash Join, but it seq-scans every lead in the market calling
-- normalize_phone on each: measured 105 ms for 151 inputs, of which 82 ms is the
-- Seq Scan over 1,700 leads. Its predicate is already a single equality and
-- needs no query rewrite — only this index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_market_phone_norm
  ON leads (market_id, normalize_phone(customer_phone));


-- ---- Reclaim: three indexes with 0 scans in 133 days ----
-- pg_stat_database.stats_reset is 133 days old and orders has taken 138.4 M
-- index scans in that window, so idx_scan = 0 is a real signal here, not a
-- freshly reset counter. Dropping 1,368 kB to add ~770 kB leaves the orders
-- index footprint smaller than it was.

-- (market_id, customer_phone), 432 kB, 0 scans. This is the index someone added
-- for this exact query, and it is unreachable for it by construction — the
-- predicate wraps the column in normalize_phone(). idx_orders_market_phone_norm
-- is what it was meant to be.
DROP INDEX CONCURRENTLY IF EXISTS idx_orders_market_phone;

-- (market_id, lower(customer_name), lower(customer_address)), 784 kB, 0 scans.
-- Dead on a trim() mismatch: order_identity_matches writes
-- lower(trim(o.customer_name)), the index key is lower(customer_name).
-- Verified: with trim -> cost 665.74 (Index Scan on idx_orders_market_status +
-- Filter); without trim -> cost 2.50 (Index Scan using idx_orders_market_identity).
-- Deliberately NOT replaced with a trim-aware version: that leg already plans as
-- a Hash Join at 16.6 ms and does not need an index, so the right move is to
-- reclaim the 784 kB.
DROP INDEX CONCURRENTLY IF EXISTS idx_orders_market_identity;

-- (customer_phone, market_id), 152 kB, 0 scans. Column-order duplicate of
-- idx_leads_market_phone (136 kB, 152 scans); both were created by
-- 20260425_crm_redesign_indexes.sql.
DROP INDEX CONCURRENTLY IF EXISTS idx_leads_phone_market;
