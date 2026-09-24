-- Storefront webhook auth mode
-- 'hmac'      → server-to-server senders sign payloads with webhook_secret (default)
-- 'uuid_only' → browser-originated senders; the UUID in the URL is the only secret,
--               and the handler enforces a normalized payload shape instead of a signature.
ALTER TABLE storefronts
  ADD COLUMN IF NOT EXISTS auth_mode text NOT NULL DEFAULT 'hmac'
    CHECK (auth_mode IN ('hmac', 'uuid_only'));
