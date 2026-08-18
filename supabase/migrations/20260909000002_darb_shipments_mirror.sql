-- ============================================================
-- 20260909000002_darb_shipments_mirror.sql
--
-- Mirror the Darb Assabil shipment record locally.
--
-- WHY: until now the OMS read exactly ONE field from a Darb shipment — `status`
-- — and discarded the other 47 top-level fields on every poll. The carrier
-- actually tells us who is holding the parcel and their phone number, what the
-- courier wrote about a failed attempt, what we were really billed, and when
-- the COD money settled. None of it was stored, and the timeline was re-fetched
-- from the carrier on every panel open and then thrown away.
--
-- Three tables:
--   darb_shipments       — current state, one row per carrier shipment (upsert)
--   darb_timeline_events — APPEND-ONLY event history (the audit trail)
--   darb_sync_runs       — one row per sweep, so "did the sync work?" is
--                          answerable without reading Vercel logs
--
-- darb_timeline_events follows the append-only doctrine already applied to
-- order_history and inventory_log (see CLAUDE.md → Critical rules): rows are
-- INSERTed and never updated or deleted. ON CONFLICT DO NOTHING makes re-sync
-- idempotent without mutating history.
--
-- Field names/nesting verified against live records 2026-08-17 —
-- see docs/darb-assabil-sync.md §2.
-- ============================================================

-- ── Current shipment state ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS darb_shipments (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vendor `_id`. The addressable key for status / modify / cancel, and the
  -- only identifier that survives the carrier re-referencing a shipment.
  darb_id                TEXT NOT NULL UNIQUE,

  -- Which of our two accounts owns it, and which order it belongs to.
  -- ON DELETE SET NULL: a mirrored shipment stays forensically useful even if
  -- the OMS order is hard-deleted.
  carrier_id             UUID REFERENCES carriers(id) ON DELETE SET NULL,
  order_id               UUID REFERENCES orders(id) ON DELETE SET NULL,

  -- Current human reference, plus the creation-time SH… value the carrier keeps
  -- as a #tag. `original_reference` is the link back to the tracking_number we
  -- stored at dispatch, and therefore the reconciliation key.
  reference              TEXT,
  original_reference     TEXT,

  status_slug            TEXT,
  raw_status             TEXT,

  -- Who is holding it, and who to call.
  handler_name           TEXT,
  handler_phone          TEXT,
  handler_account_name   TEXT,
  handler_account_phone  TEXT,

  -- Why it is where it is.
  latest_remark          TEXT,
  latest_remark_at       TIMESTAMPTZ,
  cancellation_cause     TEXT,
  delayed_until          TIMESTAMPTZ,
  cancel_count           INTEGER,
  resend_count           INTEGER,

  -- Money. billed_shipping_amount is what Darb ACTUALLY charged, which on a
  -- sampled live order was 35 LYD against the flat carriers.delivery_fee of 10.
  -- NULL means "not told", never "free" — do not COALESCE it to 0 in reporting.
  billed_shipping_amount NUMERIC,
  billed_currency        TEXT,
  shipping_breakdown     JSONB,
  cod_outstanding        NUMERIC,
  delivery_withdrawal_at TIMESTAMPTZ,
  sales_withdrawal_at    TIMESTAMPTZ,

  -- Destination + routing.
  to_city                TEXT,
  to_area                TEXT,
  to_address             TEXT,
  to_branch_group        TEXT,
  to_zone_code           TEXT,
  group_reference        TEXT,

  service_title          TEXT,
  priority               INTEGER,
  notes                  TEXT,
  attachments            JSONB NOT NULL DEFAULT '[]'::jsonb,

  completed_at           TIMESTAMPTZ,
  carrier_created_at     TIMESTAMPTZ,
  carrier_updated_at     TIMESTAMPTZ,
  latest_event_at        TIMESTAMPTZ,

  -- Full vendor payload. Always stored: the vendor adds fields without notice,
  -- and a projection gap must never be data loss.
  raw                    JSONB,

  first_seen_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_darb_shipments_order       ON darb_shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_darb_shipments_carrier     ON darb_shipments(carrier_id);
CREATE INDEX IF NOT EXISTS idx_darb_shipments_status      ON darb_shipments(status_slug);
CREATE INDEX IF NOT EXISTS idx_darb_shipments_reference   ON darb_shipments(reference);
CREATE INDEX IF NOT EXISTS idx_darb_shipments_original    ON darb_shipments(original_reference);
CREATE INDEX IF NOT EXISTS idx_darb_shipments_last_synced ON darb_shipments(last_synced_at);
-- Partial index for the alerting query "in-flight and going stale".
CREATE INDEX IF NOT EXISTS idx_darb_shipments_inflight
  ON darb_shipments(last_synced_at)
  WHERE status_slug IS NULL OR status_slug NOT IN ('completed', 'returned', 'cancelled');

DROP TRIGGER IF EXISTS trg_darb_shipments_updated_at ON darb_shipments;
CREATE TRIGGER trg_darb_shipments_updated_at
  BEFORE UPDATE ON darb_shipments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE darb_shipments IS
  'Local mirror of the Darb Assabil shipment record (one row per carrier shipment). '
  'Upserted on darb_id by the sync engine. Never the source of truth for orders.status — '
  'promote_darb_status owns that. See docs/darb-assabil-sync.md.';
COMMENT ON COLUMN darb_shipments.billed_shipping_amount IS
  'What Darb actually charged. NULL = not reported, NOT zero — never COALESCE to 0 in cost reporting.';
COMMENT ON COLUMN darb_shipments.original_reference IS
  'Creation-time SH… reference, recovered from the carrier''s #tags. Links back to '
  'orders.tracking_number as stored at dispatch.';

-- ── Append-only event history ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS darb_timeline_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  darb_id        TEXT NOT NULL,
  order_id       UUID REFERENCES orders(id) ON DELETE SET NULL,

  -- Vendor event _id, or a deterministic synthetic id. Uniqueness key: two
  -- events can share a timestamp AND a type, so the synthetic form includes the
  -- array index or one event would silently overwrite the other.
  event_id       TEXT NOT NULL,

  type           TEXT NOT NULL,
  description_ar TEXT,
  description_en TEXT,
  -- The courier's own note ("لايرد ودزيت رساله" — no answer, I sent a message).
  -- The single most useful operational field Darb emits, and the one the old
  -- display-only parser dropped.
  remarks        TEXT,
  actor_name     TEXT,
  actor_phone    TEXT,
  occurred_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT darb_timeline_events_unique UNIQUE (darb_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_darb_timeline_darb     ON darb_timeline_events(darb_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_darb_timeline_order    ON darb_timeline_events(order_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_darb_timeline_type     ON darb_timeline_events(type);
-- Courier performance / "who is sitting on parcels" questions.
CREATE INDEX IF NOT EXISTS idx_darb_timeline_actor    ON darb_timeline_events(actor_phone)
  WHERE actor_phone IS NOT NULL;

COMMENT ON TABLE darb_timeline_events IS
  'APPEND-ONLY Darb Assabil event history — never UPDATE or DELETE a row '
  '(same doctrine as order_history and inventory_log). Re-sync is idempotent via '
  'ON CONFLICT (darb_id, event_id) DO NOTHING.';

-- ── Sync run log ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS darb_sync_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  trigger           TEXT NOT NULL,
  carrier_id        UUID REFERENCES carriers(id) ON DELETE SET NULL,
  pages_fetched     INTEGER NOT NULL DEFAULT 0,
  shipments_seen    INTEGER NOT NULL DEFAULT 0,
  shipments_upserted INTEGER NOT NULL DEFAULT 0,
  events_inserted   INTEGER NOT NULL DEFAULT 0,
  orders_matched    INTEGER NOT NULL DEFAULT 0,
  orders_promoted   INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'running',
  error_message     TEXT,
  notes             JSONB,

  CONSTRAINT darb_sync_runs_status_check
    CHECK (status IN ('running', 'succeeded', 'failed', 'partial')),
  CONSTRAINT darb_sync_runs_trigger_check
    CHECK (trigger IN ('cron', 'manual', 'app_launch', 'reconcile'))
);

CREATE INDEX IF NOT EXISTS idx_darb_sync_runs_started ON darb_sync_runs(started_at DESC);

COMMENT ON TABLE darb_sync_runs IS
  'One row per Darb sync sweep. Exists so "is the sync alive?" is a SQL question — '
  'pg_cron reports success whenever pg_net delivers the request, even on an HTTP 500.';

-- ── RLS ─────────────────────────────────────────────────────────────
-- Reads are open to authenticated users (same as darb_shipping_rates): the data
-- is carrier operational detail, and order-level market isolation is enforced on
-- `orders` itself. Writes are service-role only — no INSERT/UPDATE/DELETE policy
-- exists, so PostgREST refuses them for anon/authenticated.
ALTER TABLE darb_shipments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE darb_timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE darb_sync_runs       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "darb_shipments_read" ON darb_shipments;
CREATE POLICY "darb_shipments_read"
  ON darb_shipments FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "darb_timeline_events_read" ON darb_timeline_events;
CREATE POLICY "darb_timeline_events_read"
  ON darb_timeline_events FOR SELECT
  TO authenticated
  USING (true);

-- darb_sync_runs is operational data — service role only, no policy.
