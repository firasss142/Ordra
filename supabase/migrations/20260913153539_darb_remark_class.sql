-- ============================================================
-- 20260926000003_darb_remark_class.sql
-- Give `darb_shipments` the structured reason the remark already contains.
--
-- WHY: `delivery_delayed` has never carried a reason. The courier writes one
-- every time — "الزبون لم يرد ع التلفون", "Cancelled by the customer" — into
-- latest_remark, and nothing reads it. An agent cannot sort "did not pick up"
-- (call the second number) from "cancelled" (it is over) from "we agreed on
-- tomorrow" (do nothing), and those need opposite actions.
--
-- WHAT: three columns written by the sync, from the TypeScript classifier in
-- src/lib/carriers/darb-remark-classifier.ts. Measured against the whole live
-- corpus (1 153 shipments, 879 carrying text): 93.4 % land in a real class,
-- 6.6 % in `other`. The rest are genuinely unclassifiable — street directions,
-- courier reassignments, one traffic accident.
--
-- The class list is intentionally wider than the original plan's nine. The
-- corpus forced four more: `refused` (turned away at the door — the parcel
-- physically arrived, unlike `not_needed`), `no_cash` (wants it, cannot pay
-- today — the one cancellation a phone call still recovers), `wrong_item` and
-- `payment_method` (both fixable by the agent), plus `store_cancelled` so our
-- own cancellations are never counted against the buyer's risk_class, and
-- `in_progress` so "on the way" never reads as a promise.
--
-- No enum: a CHECK is cheaper to widen, and these classes will grow as the
-- manager board surfaces what still falls into `other`.
-- ============================================================

ALTER TABLE public.darb_shipments
  ADD COLUMN IF NOT EXISTS remark_class text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS remark_class_source text,
  ADD COLUMN IF NOT EXISTS remark_classified_at timestamptz;

ALTER TABLE public.darb_shipments
  DROP CONSTRAINT IF EXISTS darb_shipments_remark_class_check;
ALTER TABLE public.darb_shipments
  ADD CONSTRAINT darb_shipments_remark_class_check CHECK (remark_class IN (
    'no_answer',
    'customer_cancelled',
    'store_cancelled',
    'not_needed',
    'refused',
    'not_serious',
    'no_cash',
    'wrong_item',
    'payment_method',
    'coordinated',
    'in_progress',
    'out_of_coverage',
    'office_pickup',
    'wrong_address',
    'duplicate',
    'other',
    'none'
  ));

ALTER TABLE public.darb_shipments
  DROP CONSTRAINT IF EXISTS darb_shipments_remark_class_source_check;
ALTER TABLE public.darb_shipments
  ADD CONSTRAINT darb_shipments_remark_class_source_check CHECK (
    remark_class_source IS NULL
    OR remark_class_source IN ('latest_remark', 'latest_comment', 'cancellation_cause', 'none')
  );

COMMENT ON COLUMN public.darb_shipments.remark_class IS
  'Structured reason parsed from the courier remark. Written by the sync from src/lib/carriers/darb-remark-classifier.ts.';
COMMENT ON COLUMN public.darb_shipments.remark_class_source IS
  'Which field the class came from: latest_remark > latest_comment > cancellation_cause.';

-- The worklist asks "which parcels need an agent now", so the index covers
-- exactly the actionable classes. Partial: two thirds of the table is
-- none/coordinated/in_progress and never matches this predicate.
CREATE INDEX IF NOT EXISTS idx_darb_shipments_actionable_remark
  ON public.darb_shipments (order_id, remark_class)
  WHERE remark_class IN (
    'no_answer', 'customer_cancelled', 'not_needed', 'refused', 'not_serious',
    'no_cash', 'wrong_item', 'payment_method', 'out_of_coverage', 'wrong_address'
  );
