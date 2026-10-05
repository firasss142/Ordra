# Photos and logos — people, shops, carriers

Since 2026-10-05 every Ordra user has a photo that can be set, and every
storefront and carrier account can have its own uploaded logo.

## Where it is changed

| What | Who | Where | API |
|---|---|---|---|
| Anyone's photo | super_admin (anyone), market_manager (own market) | Accès → open the person → the photo in the header | `PATCH /api/agents/[id]` `{action:"update_avatar", avatar}` |
| My own photo — staff | every dashboard role | Mon profil (`/profile`, sidebar → name → Mon profil) | `PUT /api/me/avatar` `{avatar}` |
| My own photo — agent | agent | Topbar menu → Changer la photo (as before), and `/profile` | same |
| My own photo — warehouse | warehouse_agent | Entrepôt phone → Réglages → tap the avatar | same |
| My own photo — investor | investor | Portal → Compte | same |
| A shop's logo | super_admin | Réglages › Boutiques → open the shop → Logo | `PUT /api/storefronts/[id]/logo` `{logo}` |
| A carrier account's logo | super_admin | Réglages › Livraison → open the carrier → Logo | `PUT /api/carriers/[id]/logo` `{logo}` |

`avatar` / `logo` is a data URL, or `null` to remove. The browser downscales to
512 px (`decodeImageFile`) before sending; the server caps at 2 MB and accepts
JPEG, PNG, WebP. A logo body without the `logo` key is a 400, never a removal.

One UI piece does all of it: `components/ui/PhotoPicker.tsx` wraps whatever
visual the screen already shows (avatar, platform mark, carrier mark), makes it
the button, and adds Ajouter/Changer · Retirer and the error line. `compact`
(phone) drops the text links; `readOnly` shows the visual only — a
market_manager sees the shop/carrier logo but cannot change it.

`useMyPhoto()` is the self-service save: PUT, then `patchUser()` on the auth
context (it keeps its own copy of the user, so `router.refresh()` alone left
`/profile` stale) and `router.refresh()` for the server-built sidebar/shells.

## Storage

- People: bucket `avatars` (since 2026-04), `users.avatar_url`, path `<user>/avatar.<ext>`.
- Shops and carriers: bucket `logos`, `storefronts.logo_url` / `carriers.logo_url`,
  path `storefronts/<id>/logo.<ext>` / `carriers/<id>/logo.<ext>`
  (migration `20261005140000_storefront_carrier_logos.sql`).
- Both buckets: public read, writes by the service role only — our routes decide
  who may write, then write with the service client.
- Paths are fixed per row and overwritten; the stored URL carries `?v=<ms>` so a
  replaced image is not served from cache.

## Where a logo shows

- Shop: Réglages › Boutiques row and drawer. Falls back to the platform's two letters.
  Not yet on Accueil's store cards or the orders list (those read the platform only).
- Carrier: Réglages › Livraison row and drawer, Transporteurs (overview, carrier
  page, compare), the agent queue card. `getCarrierLogo(code, uploaded)` — the
  upload wins, then the brand file by `code`, then the truck / initial.
  This is how Darb Tripoli and Darb Benghazi, one code, can finally look different.
- The scorecard RPC is untouched: `/api/carriers/scorecard` merges `logo_url` from
  one `carriers` read, and a failed read only costs the uploads.

## Deploy order

`QUEUE_ROW_SELECT`, `GET /api/storefronts` and `GET /api/carriers` select
`logo_url`. Deployed before the migration, PostgREST rejects the unknown column
and the agent queue and both Réglages lists fail. **Paste the migration first.**
