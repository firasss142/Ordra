-- ============================================================
-- 20260906000001_ad_spend_meta_sync.sql
-- Teach ad_spend where a number came from, and give the Meta sync the tables
-- it needs to put numbers there unattended.
--
-- WHY: ad_spend was built for a human typing a figure into a form once a week.
-- Every column reflects that — `created_by` is NOT NULL against users(id),
-- `amount` is the only money, and nothing records which platform the money was
-- spent on. Profitability therefore reports whatever somebody remembered to
-- enter, and the gap between the Meta Ads Manager number and the OMS number is
-- discovered at month end, by hand, if at all.
--
-- Pulling the number straight from the Graph API removes the transcription, but
-- a machine writer breaks three assumptions the table still holds. It has no
-- human creator, so the NOT NULL on created_by rejects it outright (23502). It
-- re-reads the same day repeatedly as Meta restates attribution, so it needs an
-- upsert key rather than an insert. And it reports in the ad account's billing
-- currency, which is not the market's currency, so the converted figure and the
-- original have to live side by side or the conversion becomes unauditable.
--
-- WHAT: additive columns on ad_spend covering provenance, the pre-conversion
-- amount and its rate, and the delivery metrics that make a spend figure
-- interpretable; a non-partial idempotency key the sync upserts on; the two
-- configuration tables the sync reads (which accounts to poll, and which
-- campaign belongs to which product); and a run log modelled on sheet_sync_runs,
-- because a sync nobody can see failing is a sync that fails silently for days.
--
-- NON-GOALS: no existing row changes value and no existing column changes type.
-- The manual entry path keeps working exactly as it did — its rows simply carry
-- source = 'manual' and NULL in every new column. Currency conversion policy,
-- the attribution model, and the P&L formulas themselves live in application
-- code under src/lib/ad-spend/, not here. No credential is written by this
-- migration; meta_ad_accounts ships empty.
-- ============================================================

-- ---- ad_spend: provenance and delivery metrics ---------------------------

ALTER TABLE ad_spend
  -- Which system put this row here. Defaulting to 'manual' is what makes the
  -- change additive: the nine rows already in production are, in fact, manual.
  ADD COLUMN IF NOT EXISTS source               TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS ad_account_id        TEXT,
  ADD COLUMN IF NOT EXISTS external_campaign_id TEXT,
  ADD COLUMN IF NOT EXISTS campaign_name        TEXT,
  ADD COLUMN IF NOT EXISTS campaign_status      TEXT,
  -- The figure exactly as the platform reported it, before any conversion, and
  -- the rate used to reach `amount`. Keeping all three lets an auditor redo the
  -- arithmetic; keeping only `amount` makes a wrong rate undetectable after the
  -- fact. Wider and finer than `amount` on purpose — a rate is not money and
  -- rounding it to three decimals at rest would bake in the error we are trying
  -- to expose.
  ADD COLUMN IF NOT EXISTS amount_original      NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS currency_original    TEXT,
  ADD COLUMN IF NOT EXISTS fx_rate              NUMERIC(12,6),
  ADD COLUMN IF NOT EXISTS impressions          BIGINT,
  ADD COLUMN IF NOT EXISTS reach                BIGINT,
  ADD COLUMN IF NOT EXISTS clicks               BIGINT,
  ADD COLUMN IF NOT EXISTS frequency            NUMERIC(8,4),
  -- The platform's own conversion count for the campaign objective. Kept beside
  -- our order count rather than instead of it: the two disagree routinely, and
  -- the disagreement is itself the signal worth reading.
  ADD COLUMN IF NOT EXISTS platform_results     INTEGER,
  ADD COLUMN IF NOT EXISTS synced_at            TIMESTAMPTZ;

COMMENT ON COLUMN ad_spend.source IS
  'Which system wrote this row: manual | meta | tiktok | google | csv. Manual rows '
  'leave every sync column NULL.';

COMMENT ON COLUMN ad_spend.external_campaign_id IS
  'The platform''s campaign id, kept as TEXT. Meta ids are 17-18 digits, past '
  'Number.MAX_SAFE_INTEGER, so any numeric type would silently round them and '
  'collapse two campaigns into one.';

COMMENT ON COLUMN ad_spend.amount_original IS
  'Spend in currency_original, exactly as the platform reported it. amount is '
  'this figure multiplied by fx_rate and rounded to the market currency.';

COMMENT ON COLUMN ad_spend.reach IS
  'DAILY ONLY. Never SUM() or AVG() this across rows. Reach is people, not '
  'events: Meta attributes each person to exactly one day within the requested '
  'window, so summing daily rows counts the same person once per day they were '
  'reached and inflates the total without bound. A multi-day reach figure has to '
  'be requested from Meta for that exact window; it cannot be reconstructed here.';

COMMENT ON COLUMN ad_spend.frequency IS
  'DAILY ONLY. Never SUM() or AVG() this across rows. Frequency is impressions '
  'divided by reach, and averaging a ratio across days weights each day equally '
  'regardless of size. It is also derived from reach, which is itself not '
  'summable, so no correct multi-day frequency can be computed from these rows.';

COMMENT ON COLUMN ad_spend.synced_at IS
  'When the sync last wrote this row. Meta restates recent days as attribution '
  'settles, so a row being re-written is normal and this is how we tell how '
  'settled the figure is.';

-- ---- ad_spend: created_by must admit a machine ---------------------------

-- A cron run has no human creator, and every column here is filled by the sync.
-- With created_by NOT NULL every machine INSERT fails 23502 before any of the
-- rest of this migration matters.
--
-- Seeding a "system user" to own these rows was considered and rejected. It is
-- not possible without weakening two other constraints: public.users.id is a FK
-- to auth.users(id), so a system row demands a real auth identity — a login that
-- exists solely to be never used — and public.users.role is NOT NULL with no
-- 'system' member in its allowed set, so the fake user would have to masquerade
-- as an admin or an agent and would then appear in every role-filtered list and
-- assignment dropdown in the product. A nullable created_by says the true thing
-- instead: nobody created this row, a machine did, and `source` records which.
ALTER TABLE ad_spend ALTER COLUMN created_by DROP NOT NULL;

COMMENT ON COLUMN ad_spend.created_by IS
  'The user who entered this row by hand, or NULL when a sync wrote it. Read '
  'source to tell which — NULL here is machine provenance, not missing data.';

-- ---- ad_spend: the idempotency key --------------------------------------

-- The sync re-reads a trailing window every run and upserts, because Meta
-- restates yesterday's spend for days afterwards. This index is the conflict
-- arbiter for that upsert.
--
-- It is deliberately NOT partial, despite every row it targets having source =
-- 'meta'. PostgREST's `on_conflict=` emits bare column names and cannot emit an
-- index predicate, and Postgres refuses to match a partial index unless the
-- statement repeats the predicate verbatim. The result is 42P10, "there is no
-- unique or exclusion constraint matching the ON CONFLICT specification". This
-- repository has already paid for that lesson once — see
-- 20260812141346_sheet_sync_failed_rows_upsertable_key.sql, where a partial
-- unique index shipped and had to be replaced hours later.
--
-- Manual rows do not collide with each other under this key even though they
-- share period_start, because they carry NULL in ad_account_id and
-- external_campaign_id and PG 17.6 indexes NULLs as distinct by default: any
-- two rows with a NULL in a key column are never equal, so the uniqueness check
-- never fires for them. NULLS NOT DISTINCT was considered and rejected for
-- exactly that reason — production already holds four manual rows sharing
-- period_start = 2026-07-01, and that option would reject three of them.
CREATE UNIQUE INDEX IF NOT EXISTS ad_spend_synced_key
  ON ad_spend (source, ad_account_id, external_campaign_id, period_start);

-- Product-scoped profitability reads range on BOTH period columns at once —
-- "what did we spend on this product between these dates" — and every one of
-- them excludes soft-deleted rows, so the predicate belongs in the index rather
-- than in the filter. The existing idx_ad_spend_market_period covers the
-- market-wide question and is left alone.
CREATE INDEX IF NOT EXISTS ad_spend_product_idx
  ON ad_spend (product_id, period_start, period_end)
  WHERE is_active;

-- ---- ad_spend: constraints the table never had --------------------------

-- Neither invariant was ever enforced, which was survivable while a human typed
-- every row and unsurvivable once a parser writes them: Meta returns spend as a
-- numeric STRING, and a failed parse that lands as a negative or a reversed
-- window would quietly subtract from profit. Both were checked against
-- production before shipping — all 9 rows satisfy both — so validation cannot
-- fail here. They are still added NOT VALID and validated in a second statement,
-- which takes only SHARE UPDATE EXCLUSIVE and so does not block concurrent
-- readers and writers the way a single validating ADD CONSTRAINT would.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'ad_spend'::regclass
      AND conname = 'ad_spend_amount_non_negative'
  ) THEN
    ALTER TABLE ad_spend
      ADD CONSTRAINT ad_spend_amount_non_negative CHECK (amount >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'ad_spend'::regclass
      AND conname = 'ad_spend_period_ordered'
  ) THEN
    ALTER TABLE ad_spend
      ADD CONSTRAINT ad_spend_period_ordered CHECK (period_start <= period_end) NOT VALID;
  END IF;
END $$;

-- Re-running these is a no-op once the constraint is marked validated.
ALTER TABLE ad_spend VALIDATE CONSTRAINT ad_spend_amount_non_negative;
ALTER TABLE ad_spend VALIDATE CONSTRAINT ad_spend_period_ordered;

-- ---- meta_ad_accounts ----------------------------------------------------

-- Which Meta ad accounts to poll, and the credential to poll them with. Modelled
-- on dexpress_sessions: this table holds a bearer token, so it is service-role
-- only and no end-user role can reach it at all.
CREATE TABLE IF NOT EXISTS meta_ad_accounts (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  market_id        UUID        NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  -- Meta's act_ id without the prefix. UNIQUE because the sync's concurrency
  -- lock and ad_spend's upsert key both address an account by this value.
  ad_account_id    TEXT        NOT NULL UNIQUE,
  business_id      TEXT,
  account_name     TEXT,
  -- The account's billing currency, which is frequently not the market's. Spend
  -- arrives denominated in this and is converted on the way into ad_spend.amount.
  account_currency TEXT        NOT NULL DEFAULT 'USD',
  -- Meta cuts its reporting days in the AD ACCOUNT's timezone, not UTC and not
  -- the market's. Requesting a window without accounting for it silently shifts
  -- every daily figure by one boundary, which shows up as a phantom spike on the
  -- first day and a phantom hole on the last.
  account_timezone TEXT,
  -- Pinned per account rather than global so a single account can be moved to a
  -- newer Graph version and observed before the rest follow. v26.0 released
  -- 29 Jul 2026; v24.0 is the oldest still supported.
  graph_version    TEXT        NOT NULL DEFAULT 'v26.0',
  -- Ciphertext. Never write a plaintext token here — this column is the reason
  -- the table has no RLS policies and no grants.
  access_token     TEXT        NOT NULL,
  -- NULL means a non-expiring system user token, which is the intended setup for
  -- an unattended cron. A non-NULL value is a user token on a countdown and the
  -- sync warns before it lapses.
  token_expires_at TIMESTAMPTZ,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  last_synced_at   TIMESTAMPTZ,
  -- The last failure in human-readable form, kept on the account rather than
  -- only in the run log so "this account is broken right now" is one read.
  last_sync_error  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE meta_ad_accounts ENABLE ROW LEVEL SECURITY;

-- No policies → only service_role, which bypasses RLS, can see this table. The
-- access token is a credential with spending authority on someone's ad account;
-- treat it exactly like the Dexpress session cookie. RLS alone is not enough,
-- because a table with RLS on and grants intact still leaks its shape and its
-- error messages, so the grants go too.
REVOKE ALL ON meta_ad_accounts FROM authenticated;
REVOKE ALL ON meta_ad_accounts FROM anon;

DROP TRIGGER IF EXISTS trg_meta_ad_accounts_updated_at ON meta_ad_accounts;
CREATE TRIGGER trg_meta_ad_accounts_updated_at
  BEFORE UPDATE ON meta_ad_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---- meta_campaign_mappings ---------------------------------------------

-- Which OMS product a Meta campaign is selling. Modelled on
-- storefront_product_mappings: an explicit table rather than string-matching
-- campaign names, because campaign names are marketing copy — they get renamed
-- mid-flight, they carry emoji and A/B suffixes, and matching on them attributes
-- money to the wrong product without ever raising an error.
CREATE TABLE IF NOT EXISTS meta_campaign_mappings (
  id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  ad_account_id        TEXT        NOT NULL,
  external_campaign_id TEXT        NOT NULL,
  -- The name as last seen, for the operator picking from a list. Descriptive
  -- only; nothing resolves on it.
  campaign_name        TEXT,
  market_id            UUID        NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  -- NULL is a deliberate statement, not an unfinished mapping: this campaign is
  -- brand or market-level spend that belongs to no single product. RESTRICT
  -- rather than CASCADE because deleting a product must not silently orphan the
  -- spend attributed to it.
  product_id           UUID        REFERENCES products(id) ON DELETE RESTRICT,
  mapped_by            UUID        REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One decision per campaign. The account scopes it so two accounts can never
  -- fight over a campaign id.
  UNIQUE (ad_account_id, external_campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_campaign_mappings_product
  ON meta_campaign_mappings (product_id);

ALTER TABLE meta_campaign_mappings ENABLE ROW LEVEL SECURITY;

-- Super admin only, read and write. This table decides which product's P&L
-- absorbs which slice of ad spend, so editing it silently moves money between
-- products' reported margins — a cross-market decision by nature, and not one a
-- single market's manager should be able to make alone.
DROP POLICY IF EXISTS "meta_campaign_mappings_select" ON meta_campaign_mappings;
CREATE POLICY "meta_campaign_mappings_select"
  ON meta_campaign_mappings FOR SELECT
  TO authenticated
  USING (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "meta_campaign_mappings_insert" ON meta_campaign_mappings;
CREATE POLICY "meta_campaign_mappings_insert"
  ON meta_campaign_mappings FOR INSERT
  TO authenticated
  WITH CHECK (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "meta_campaign_mappings_update" ON meta_campaign_mappings;
CREATE POLICY "meta_campaign_mappings_update"
  ON meta_campaign_mappings FOR UPDATE
  TO authenticated
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "meta_campaign_mappings_delete" ON meta_campaign_mappings;
CREATE POLICY "meta_campaign_mappings_delete"
  ON meta_campaign_mappings FOR DELETE
  TO authenticated
  USING (get_user_role() = 'super_admin');

DROP TRIGGER IF EXISTS trg_meta_campaign_mappings_updated_at ON meta_campaign_mappings;
CREATE TRIGGER trg_meta_campaign_mappings_updated_at
  BEFORE UPDATE ON meta_campaign_mappings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---- ad_sync_runs --------------------------------------------------------

-- One row per sync attempt, on the same terms as sheet_sync_runs. The lesson
-- that table was built to learn applies here verbatim: pg_cron reporting
-- "succeeded" only means Postgres handed the request off, so without a run log
-- an ad sync can fail every hour for a week and the first person to notice is
-- whoever asks why profit looks wrong.
CREATE TABLE IF NOT EXISTS ad_sync_runs (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  market_id     UUID        NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  ad_account_id TEXT        NOT NULL,
  -- Who asked. A manual run failing while somebody watches is a different
  -- conversation from the cron failing unattended.
  trigger       TEXT        NOT NULL CHECK (trigger IN ('cron', 'manual')),
  status        TEXT        NOT NULL CHECK (
                  status IN ('running', 'succeeded', 'partial', 'failed', 'skipped_locked')
                ),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  -- The reporting window actually requested, which is a trailing range rather
  -- than a single day because Meta restates recent figures. Recording it makes
  -- "was this day ever covered" answerable.
  window_start  DATE,
  window_end    DATE,
  rows_fetched  INTEGER     NOT NULL DEFAULT 0,
  rows_upserted INTEGER     NOT NULL DEFAULT 0,
  rows_errored  INTEGER     NOT NULL DEFAULT 0,
  -- acc_id_util_pct from the x-fb-ads-insights-throttle response header — the
  -- header Meta actually uses for the Insights endpoint. Trending upward across
  -- runs is the warning that precedes error code 4, and it is only visible if
  -- somebody writes it down each run.
  acc_util_pct  NUMERIC(5,2),
  error         TEXT
);

-- At most one live run per ad account. This index IS legitimately partial, and
-- the distinction from ad_spend_synced_key above is the whole point: this one is
-- never named in an ON CONFLICT clause. It is a mutex enforced by a plain
-- INSERT, and the caller learns it lost the race by catching 23505 and recording
-- the attempt as `skipped_locked`. Nothing has to infer the predicate, so
-- nothing can fail to. An arbiter index must be total; a lock index need not be.
CREATE UNIQUE INDEX IF NOT EXISTS ad_sync_runs_one_in_flight
  ON ad_sync_runs (ad_account_id)
  WHERE status = 'running';

-- The observability page asks one question: what happened last, for this market.
CREATE INDEX IF NOT EXISTS idx_ad_sync_runs_market_started
  ON ad_sync_runs (market_id, started_at DESC);

ALTER TABLE ad_sync_runs ENABLE ROW LEVEL SECURITY;

-- Writes come from the sync itself on the service role, which bypasses RLS.
-- Authenticated users only read, and only their own market — the same rule
-- sheet_sync_runs carries. The run log holds no credential, so unlike
-- meta_ad_accounts it is safe to expose in read-only form.
DROP POLICY IF EXISTS "ad_sync_runs_select" ON ad_sync_runs;
CREATE POLICY "ad_sync_runs_select"
  ON ad_sync_runs FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'market_manager' AND market_id = get_user_market_id())
  );
