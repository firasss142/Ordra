-- Browser-originated storefront submissions (quraan-buybox).
-- The storefront sends a flat payload with no upstream order system — it IS the
-- order origin. It is served by the new BuyboxAdapter (platform = 'buybox') and
-- authenticates via the UUID in the webhook URL (auth_mode = 'uuid_only').
--
-- Data fix: re-point the existing storefront from the Shopify adapter (which
-- expected a native Shopify payload and rejected the flat shape with
-- "Missing order id") to the buybox adapter.
UPDATE storefronts
SET platform = 'buybox', updated_at = now()
WHERE id = '3f23ba62-7f66-40d0-ba86-b3bc75f62d12'
  AND platform <> 'buybox';
