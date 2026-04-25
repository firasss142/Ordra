-- Settings change history (append-only)
-- Tracks every change to a market's settings for audit + UI "last changed by".

create table if not exists settings_history (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references markets(id) on delete cascade,
  key text not null,
  old_value jsonb,
  new_value jsonb not null,
  changed_by uuid not null references users(id),
  changed_at timestamptz not null default now()
);

create index if not exists settings_history_lookup
  on settings_history (market_id, key, changed_at desc);

alter table settings_history enable row level security;

-- Read: super_admin any market; market_manager own market only.
create policy settings_history_select on settings_history
  for select
  using (
    exists (
      select 1 from users u
      where u.id = auth.uid()
        and (
          u.role = 'super_admin'
          or (u.role = 'market_manager' and u.market_id = settings_history.market_id)
        )
    )
  );

-- Insert only via server-side upsert path (service role bypasses RLS).
-- No anonymous writes.
create policy settings_history_insert on settings_history
  for insert
  with check (
    exists (
      select 1 from users u
      where u.id = auth.uid()
        and u.role in ('super_admin', 'market_manager')
    )
  );

-- Append-only: no update, no delete.
