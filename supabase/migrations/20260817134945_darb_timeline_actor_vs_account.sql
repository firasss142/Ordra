-- ============================================================
-- 20260909000004_darb_timeline_actor_vs_account.sql
-- Separate the INDIVIDUAL who performed a timeline event from the BRANCH LINE
-- the event came from.
--
-- THE BUG: `timeline[].phone` was being stored as actor_phone. It is not a
-- person — it is the office/branch number, shared by everyone working there.
-- One value appeared on 10,702 of 19,407 live events. Any "which courier is
-- sitting on parcels" query would have credited a whole branch to one person.
--
-- Darb serves two payload depths, which is what makes this easy to get wrong:
--   GET /api/local/shipments      (list)   → createdBy is a bare ObjectId
--   GET /api/local/shipments/:id  (single) → createdBy is {_id, fname, lname, phone}
-- The bulk sweep uses the list endpoint, so actor_name/actor_phone are NULL
-- after a sweep and are filled in later, only for in-flight shipments, by
-- scripts/enrich-darb-timeline-actors.ts.
--
-- actor_id is always available from either shape and is the stable key for
-- grouping activity by individual.
-- ============================================================

ALTER TABLE darb_timeline_events
  ADD COLUMN IF NOT EXISTS actor_id      TEXT,
  ADD COLUMN IF NOT EXISTS account_phone TEXT;

UPDATE darb_timeline_events
SET account_phone = actor_phone
WHERE account_phone IS NULL AND actor_phone IS NOT NULL;

UPDATE darb_timeline_events
SET actor_phone = NULL
WHERE actor_phone IS NOT NULL;

DROP INDEX IF EXISTS idx_darb_timeline_actor;
CREATE INDEX IF NOT EXISTS idx_darb_timeline_actor_id ON darb_timeline_events(actor_id)
  WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_darb_timeline_account_phone ON darb_timeline_events(account_phone)
  WHERE account_phone IS NOT NULL;

COMMENT ON COLUMN darb_timeline_events.actor_phone IS
  'The individual who performed the event. Populated ONLY by the single-shipment GET — the LIST endpoint returns createdBy as a bare ObjectId, so bulk sweeps leave this NULL. Never backfill it from account_phone.';
COMMENT ON COLUMN darb_timeline_events.account_phone IS
  'Branch/office line the event was raised from (timeline[].phone). Shared by every member of that branch — NOT a person.';
COMMENT ON COLUMN darb_timeline_events.actor_id IS
  'Vendor user ObjectId from createdBy. Always present; stable key for grouping activity by individual even when the name is not expanded.';
