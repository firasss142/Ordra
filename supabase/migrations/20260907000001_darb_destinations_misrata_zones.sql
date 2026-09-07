-- ============================================================
-- 20260907000001_darb_destinations_misrata_zones.sql
-- Adds 26 مصراتة (Misrata) zones to the Darb Assabil destination catalogue,
-- carried live in the carrier's public branch directory but missing from our
-- table. Each pair was validated (not just listed) against
-- POST /api/local/shipments/calculate/shipping before being added here — see
-- scripts/refresh-darb-destinations.ts and docs/darb-destinations.md.
--
-- Idempotent: ON CONFLICT (city, area) reactivates a row rather than erroring
-- if this migration is re-applied.
-- ============================================================

INSERT INTO darb_destinations (city, area, is_active) VALUES
  ('مصراتة', 'الزوابي', true),
  ('مصراتة', 'اقزير', true),
  ('مصراتة', 'كرزاز', true),
  ('مصراتة', 'الثقيل', true),
  ('مصراتة', 'الجزيره', true),
  ('مصراتة', 'الشواهده', true),
  ('مصراتة', 'عباد', true),
  ('مصراتة', 'الشراكسه', true),
  ('مصراتة', 'الجهانات', true),
  ('مصراتة', 'النباك', true),
  ('مصراتة', 'الغيران', true),
  ('مصراتة', 'شارع بازينه', true),
  ('مصراتة', 'جنات', true),
  ('مصراتة', 'يدر', true),
  ('مصراتة', 'راس علي', true),
  ('مصراتة', 'راس التوته', true),
  ('مصراتة', 'رويسات', true),
  ('مصراتة', 'إقراره', true),
  ('مصراتة', 'الزروق', true),
  ('مصراتة', 'اسكيرات', true),
  ('مصراتة', 'الهباره', true),
  ('مصراتة', 'الرعيضات', true),
  ('مصراتة', 'السواطي', true),
  ('مصراتة', 'شارع بنغازي', true),
  ('مصراتة', 'المقاصبه', true),
  ('مصراتة', 'راس ابو عمار وسط المدينه', true)
ON CONFLICT (city, area) DO UPDATE SET is_active = true, updated_at = now();
