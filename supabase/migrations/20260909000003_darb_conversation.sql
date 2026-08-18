-- ============================================================
-- 20260909000003_darb_conversation.sql
--
-- The Darb Assabil carrier comment thread.
--
-- Split from the mirror migration because it is easy to conclude this field does
-- not exist: Darb populates `conversation` on only ~8% of shipments (64 of 828
-- live on 2026-08-17), so sampling one record shows nothing. It does exist, and
-- it carries the customer-contact notes an agent most wants before calling:
--   "مقفل اوخارج نطاق التغطية"        — phone off / out of coverage
--   "مردش"                            — no answer
--   "الزبون اجل الاستلام لي يوم الخميس" — customer postponed to Thursday
--
-- Distinct from darb_timeline_events.remarks, which is the courier's note
-- attached to a status change (1,644 of those across 649 shipments). Both are
-- worth keeping: remarks explain the status, conversation explains the customer.
--
-- APPEND-ONLY, same doctrine as order_history / inventory_log.
-- ============================================================

CREATE TABLE IF NOT EXISTS darb_conversation (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  darb_id      TEXT NOT NULL,
  order_id     UUID REFERENCES orders(id) ON DELETE SET NULL,

  -- Vendor message _id, or a deterministic synthetic id. Two messages can share
  -- a timestamp, so the synthetic form includes the array index.
  message_id   TEXT NOT NULL,

  message      TEXT NOT NULL,
  -- `createdBy` arrives as either a populated person or a bare ObjectId string;
  -- author_* is NULL in the latter case rather than holding a raw id.
  author_name  TEXT,
  author_phone TEXT,
  posted_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT darb_conversation_unique UNIQUE (darb_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_darb_conversation_darb  ON darb_conversation(darb_id, posted_at);
CREATE INDEX IF NOT EXISTS idx_darb_conversation_order ON darb_conversation(order_id, posted_at DESC);

COMMENT ON TABLE darb_conversation IS
  'APPEND-ONLY Darb Assabil carrier comment thread — never UPDATE or DELETE. '
  'Present on only ~8% of shipments; absence is normal, not a sync failure. '
  'See docs/darb-assabil-sync.md §2.';

-- Denormalized onto the mirror so a list view never needs this join.
ALTER TABLE darb_shipments
  ADD COLUMN IF NOT EXISTS latest_comment    TEXT,
  ADD COLUMN IF NOT EXISTS latest_comment_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS comment_count     INTEGER NOT NULL DEFAULT 0;

ALTER TABLE darb_conversation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "darb_conversation_read" ON darb_conversation;
CREATE POLICY "darb_conversation_read"
  ON darb_conversation FOR SELECT
  TO authenticated
  USING (true);
