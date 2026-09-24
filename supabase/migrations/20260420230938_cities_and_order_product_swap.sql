-- ============================================================
-- Cities table: canonical city list per market
-- ============================================================

CREATE TABLE cities (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id   UUID         NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  name        TEXT         NOT NULL,
  name_ar     TEXT,
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (market_id, name)
);

CREATE INDEX idx_cities_market_active ON cities(market_id, is_active);

ALTER TABLE cities ENABLE ROW LEVEL SECURITY;

-- super_admin: full access
CREATE POLICY "cities_super_admin" ON cities
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- market_manager: own market, full access
CREATE POLICY "cities_market_manager" ON cities
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role = 'market_manager' AND market_id = cities.market_id
    )
  );

-- agent: own market, read-only
CREATE POLICY "cities_agent_read" ON cities
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role = 'agent' AND market_id = cities.market_id
    )
  );

-- ============================================================
-- Add city_id reference to orders (nullable, additive)
-- ============================================================

ALTER TABLE orders ADD COLUMN city_id UUID REFERENCES cities(id) ON DELETE SET NULL;

-- ============================================================
-- Seed: Tunisia cities
-- ============================================================

INSERT INTO cities (market_id, name, name_ar)
SELECT m.id, c.name, c.name_ar
FROM markets m
CROSS JOIN (VALUES
  ('Tunis', 'تونس'),
  ('Sfax', 'صفاقس'),
  ('Sousse', 'سوسة'),
  ('Bizerte', 'بنزرت'),
  ('Kairouan', 'القيروان'),
  ('Nabeul', 'نابل'),
  ('Gabès', 'قابس'),
  ('Gafsa', 'قفصة'),
  ('Ariana', 'أريانة'),
  ('Ben Arous', 'بن عروس'),
  ('La Marsa', 'المرسى'),
  ('Monastir', 'المنستير'),
  ('Mahdia', 'المهدية'),
  ('Medenine', 'مدنين'),
  ('Tataouine', 'تطاوين'),
  ('Tozeur', 'توزر'),
  ('Kebili', 'قبلي'),
  ('Beja', 'باجة'),
  ('Jendouba', 'جندوبة'),
  ('Siliana', 'سليانة'),
  ('Le Kef', 'الكاف'),
  ('Kasserine', 'القصرين'),
  ('Sidi Bouzid', 'سيدي بوزيد'),
  ('Zaghouan', 'زغوان'),
  ('Manouba', 'منوبة')
) AS c(name, name_ar)
WHERE m.name = 'Tunisia'
ON CONFLICT (market_id, name) DO NOTHING;

-- ============================================================
-- Seed: Libya cities
-- ============================================================

INSERT INTO cities (market_id, name, name_ar)
SELECT m.id, c.name, c.name_ar
FROM markets m
CROSS JOIN (VALUES
  ('Tripoli', 'طرابلس'),
  ('Benghazi', 'بنغازي'),
  ('Misrata', 'مصراتة'),
  ('Zawiya', 'الزاوية'),
  ('Al Bayda', 'البيضاء'),
  ('Tobruk', 'طبرق'),
  ('Zliten', 'زليتن'),
  ('Sirte', 'سرت'),
  ('Derna', 'درنة'),
  ('Sabha', 'سبها'),
  ('Tarhuna', 'ترهونة'),
  ('Gharyan', 'غريان'),
  ('Al Khums', 'الخمس'),
  ('Zintan', 'الزنتان'),
  ('Yefren', 'يفرن')
) AS c(name, name_ar)
WHERE m.name = 'Libya'
ON CONFLICT (market_id, name) DO NOTHING;
