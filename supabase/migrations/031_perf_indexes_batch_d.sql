-- ============================================================
-- 031_perf_indexes_batch_d.sql
-- Additional indexes from Batch D performance optimization
-- ============================================================

-- (assigned_to, status) partial index — speeds agent queue query
-- (agent/queue/route.ts: .eq("assigned_to", id).in("status", ACTIVE_QUEUE_STATUSES))
-- and team route queue-size query
-- (team/route.ts: .in("assigned_to", agentIds).not("status", "in", TERMINAL_STATUSES))
-- Partial condition excludes terminal rows which never appear in these queries.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_assigned_status_partial
  ON orders (assigned_to, status)
  WHERE status NOT IN ('delivered', 'returned', 'rejected', 'cancelled');

-- (status, created_at DESC) — speeds admin order list filtered by status
-- (orders/route.ts: .eq("status", status).order("created_at", { ascending: false }))
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status_created
  ON orders (status, created_at DESC);
