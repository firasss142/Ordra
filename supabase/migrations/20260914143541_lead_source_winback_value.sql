-- Prospects rebuild (2026-09-14), part 2a.
-- A returned parcel is a prospect, not a dead order: the customer wanted the
-- product enough to order it once. Postgres will not let a new enum value be
-- used in the same transaction that adds it, so the value lands on its own and
-- the trigger that uses it follows in the next migration.
-- Decision: plans/suivi-livraison.md §32.
alter type public.lead_source add value if not exists 'winback';
