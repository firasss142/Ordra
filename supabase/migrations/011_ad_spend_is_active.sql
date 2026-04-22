-- Add soft-delete support to ad_spend table
ALTER TABLE ad_spend ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;
