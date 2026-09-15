-- Prospects rebuild (2026-09-14), part 1.
-- A campaign told the agent nothing but its name. The offer is what they are
-- allowed to promise on the phone and the script is how the call opens, so
-- both belong to the campaign, not to a note somebody keeps elsewhere.
-- Design: prototypes/prospects-v3.html. Decision: plans/suivi-livraison.md §33.
alter table public.prospect_campaigns
  add column if not exists offer text,
  add column if not exists script_fr text,
  add column if not exists script_ar text;

comment on column public.prospect_campaigns.offer is
  'What the agent may offer on this campaign, in the market language. Shown on the prospect card and carried into the order when it converts.';
comment on column public.prospect_campaigns.script_fr is
  'How the call opens, French. {name} is replaced with the customer name at render time.';
comment on column public.prospect_campaigns.script_ar is
  'How the call opens, Arabic. {name} is replaced with the customer name at render time.';
