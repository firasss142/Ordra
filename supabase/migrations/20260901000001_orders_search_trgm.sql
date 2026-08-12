-- ============================================================
-- 20260901000001_orders_search_trgm.sql
-- Trigram indexes for every column the orders search box reads.
--
-- WHY: the box searches four columns and only three of them are indexed.
-- `product_name` has no trigram index, and one unindexed leg is enough to stop
-- the planner forming a BitmapOr at all — it falls back to scanning the table.
-- Measured on this instance (7,036 orders, searching '925782'):
--
--   with product_name    Seq Scan            39.1 ms   692 shared buffers
--   without product_name BitmapOr of 3 GINs   6.4 ms    32 shared buffers
--
-- Same rows, 6x the time and 20x the I/O, for one missing index. That cost is
-- paid twice per keystroke now: the list route takes an exact count in the
-- same round trip, so the scan happens for the rows and again for the count.
--
-- AFTER, measured on the same instance once these were built — the search now
-- covers seven columns instead of four and is still an order of magnitude
-- faster than the four-column version was:
--
--   7 columns, no indexes   Seq Scan             682 ms   692 buffers
--   7 columns, these        BitmapOr of 8 GINs   1.9 ms   (warm)
--   two terms ANDed         BitmapOr + filter    7.5 ms
--
-- WHAT: a gin_trgm_ops index for each remaining searchable column, so the
-- search can widen from four columns to seven — name, phone, second phone,
-- city, address, product and tracking number — and still plan as a BitmapOr.
-- `lib/orders/search-query.ts` FREE_COLUMNS is the list these mirror; adding a
-- column there without adding it here reintroduces the seq scan.
--
-- customer_phone_2 is indexed despite only 3 of 7,036 rows having one. This is
-- not about selectivity: an unindexed OR leg disables the BitmapOr for every
-- other leg too. The near-empty index costs a few hundred kB and buys the plan.
--
-- CONCURRENTLY, so no write on `orders` is blocked while these build. That
-- forbids a transaction, hence no BEGIN/COMMIT here — this file must not be
-- merged into a migration that opens one.
--
-- NON-GOALS: no column, table, policy or function is touched. Nothing is
-- dropped. order_history and inventory_log remain append-only and unreferenced.
-- ============================================================

-- pg_trgm is already installed by 20260424_orders_keyset_index.sql; repeated
-- for the benefit of a database restored from before it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The leg that was collapsing every search into a Seq Scan.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_product_name_trgm
  ON orders USING gin (product_name gin_trgm_ops);

-- Newly searchable: the dispatcher can see the city and the address on the row,
-- so the box has to be able to find them.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_customer_city_trgm
  ON orders USING gin (customer_city gin_trgm_ops)
  WHERE customer_city IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_customer_address_trgm
  ON orders USING gin (customer_address gin_trgm_ops)
  WHERE customer_address IS NOT NULL;

-- A carrier calling about a parcel gives a tracking number and nothing else.
-- idx_orders_tracking_number (btree) serves equality; it cannot serve the
-- '%…%' the box sends.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_tracking_number_trgm
  ON orders USING gin (tracking_number gin_trgm_ops)
  WHERE tracking_number IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_customer_phone_2_trgm
  ON orders USING gin (customer_phone_2 gin_trgm_ops)
  WHERE customer_phone_2 IS NOT NULL;
