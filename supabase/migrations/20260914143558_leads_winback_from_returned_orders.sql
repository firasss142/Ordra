-- Prospects rebuild (2026-09-14), part 2b.
-- When a parcel is marked returned, a prospect is created for the agent who
-- owned the order, carrying the reason it came back. The agent then works it
-- like any other prospect: call, offer the re-send, convert.
-- Decision: plans/suivi-livraison.md §32.

-- Why the parcel came back, in the carrier's own words. Free text on purpose:
-- Darb writes remarks in Arabic, one per parcel, from no fixed vocabulary.
alter table public.leads
  add column if not exists return_reason text;

comment on column public.leads.return_reason is
  'Why the source order came back, as the carrier wrote it. Set by leads_create_winback(); null on every other kind of lead.';

comment on column public.leads.source_order_id is
  'The returned order this prospect was born from. Written only by leads_create_winback().';
