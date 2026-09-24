-- ============================================================
-- 20260625000001_seed_libya_cities_from_dexpress.sql
-- Backfill the Libya cities list from dexpress_states (the carrier's
-- destination catalogue, and the de-facto source of truth for where
-- orders can actually be delivered in Libya).
--
-- The cities table previously held only 15 Libya cities; Dexpress lists
-- 128 destinations. This inserts the genuine geographic places that are
-- missing — skipping the 15 already present (matched by name_ar) and
-- skipping operational / non-city Dexpress entries (offices, route
-- descriptions, a typo). Net effect: 104 new Libya cities.
--
-- name_ar is taken verbatim from Dexpress. The `name` (Latin) column is
-- set to the same Arabic string for the new rows — these destinations
-- have no established English name, and inventing transliterations would
-- be error-prone; the 15 pre-existing cities keep their English names.
--
-- Idempotent: NOT EXISTS guard + the UNIQUE(market_id, name) constraint
-- make a re-run a no-op.
-- ============================================================

INSERT INTO cities (market_id, name, name_ar, is_active)
SELECT
  m.id,
  ds.name,        -- Latin name column: Arabic name (no reliable transliteration)
  ds.name,        -- name_ar: same Arabic string
  true
FROM dexpress_states ds
CROSS JOIN markets m
WHERE m.name = 'Libya'
  -- skip operational / non-city Dexpress entries
  AND ds.name NOT IN (
    'المنطقة الوسطي \ تخفيض',  -- "central region / discount"
    'من بنغازي الي طرابلس',     -- "from Benghazi to Tripoli" (a route)
    'مكتب سبها',                 -- "Sabha office"
    'مكتب طرابلس',               -- "Tripoli office"
    'ضواحي طرابلس (15)',        -- "Tripoli suburbs (15)" (a zone grouping)
    'كوبري 27',                  -- "Bridge 27" (a landmark)
    'بن.....',                   -- typo / placeholder
    'بوستة',                     -- "Bosta/post" (operational, ambiguous)
    'الجبل الغربي'               -- "the Western Mountain" (a region; its towns are listed separately)
  )
  -- skip cities already present (the original 15, matched by Arabic name)
  AND NOT EXISTS (
    SELECT 1 FROM cities c
    WHERE c.market_id = m.id
      AND c.name_ar = ds.name
  )
ON CONFLICT (market_id, name) DO NOTHING;
