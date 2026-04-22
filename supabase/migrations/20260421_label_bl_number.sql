-- ============================================================
-- 20260421_label_bl_number.sql
-- Warehouse — Bon de Livraison (BL) number on label prints + market sender fields
--
-- Adds:
--   * label_prints.bl_number TEXT UNIQUE — stable 12-digit BL number per print
--   * markets.sender_name / sender_address / sender_phone — fixed sender block
--     printed on every label for that market
-- ============================================================

-- ------------------------------------------------------------
-- 1. label_prints.bl_number
-- ------------------------------------------------------------
ALTER TABLE label_prints
  ADD COLUMN IF NOT EXISTS bl_number TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_label_prints_bl_number
  ON label_prints (bl_number)
  WHERE bl_number IS NOT NULL;

-- ------------------------------------------------------------
-- 2. markets sender block (Nom / Adresse / Téléphone)
-- ------------------------------------------------------------
ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS sender_name    TEXT,
  ADD COLUMN IF NOT EXISTS sender_address TEXT,
  ADD COLUMN IF NOT EXISTS sender_phone   TEXT;

-- Seed placeholder values (safe to overwrite from Settings UI later).
-- Use the market name as the sender name when unset, so labels always render.
UPDATE markets
SET sender_name = COALESCE(sender_name, name)
WHERE sender_name IS NULL;
