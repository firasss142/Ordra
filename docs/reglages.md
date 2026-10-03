# Réglages and Journaux — the Système area

Rebuilt 2026-10-02 from `prototypes/reglages-v2.html`, following `plans/reglages-redesign.md`.
It replaces Système › Marchés, Connexions and Paramètres. Journaux moved to `/system/logs`.

## Shape

The sidebar section Système has two entries:

- **Réglages** at `/system/settings/[topic]`, for super_admin and market_manager.
- **Journaux** at `/system/logs`, for super_admin only.

Réglages is one page: a menu of topics on the start side and the topic on the other. There
are no tabs. The topics follow an order's journey (`src/lib/reglages/topics.ts`):

| Topic | super_admin | market_manager |
|---|---|---|
| Marchés: identity and label sender | edit | hidden |
| Boutiques: shops (dated from `orders`), add, secret | edit | read |
| Boutiques: products and cities to match | edit | **edit** |
| Commandes: calls, retry hours, target delay, duplicates, merge, archiving | edit | **edit** |
| Motifs de rejet: 5 fixed groups, sub-reasons CRUD with usage counts | edit | **edit** |
| Équipe: distribution, shares, goals | edit | **edit** |
| Équipe: commissions | edit | hidden |
| Entrepôts: sites, carriers per site, supplier lead time | edit | read |
| Livraison: carriers (add, panel, test, fees, modes, order options) | edit | read |
| Livraison: risky parcels, board | edit | **edit** |
| WhatsApp: number, automatic messages, templates link | edit | read |
| Publicité: Meta accounts, dollar rate | edit | hidden |

Old routes redirect to their topic:

- `/system/markets` → Marchés
- `/system/connections?tab=` → the topic that replaced the tab
- `/system/settings?tab=` and `/settings/general?tab=` → the topic that replaced the tab
- `/settings/carriers` → Livraison
- `/settings/storefronts` → Boutiques
- `/mappings` → Boutiques
- `/markets` → Marchés
- `/admin/logs` → `/system/logs`

## Rules that hold it together

- **One market at a time.**
  - The super_admin's market control writes the same global scope as the sidebar switcher.
  - With the scope set to « Tous les marchés », a market topic asks for a market instead of
    loading.
  - A manager's market is fixed.
- **One save model.**
  - Form cards register a saver with the page's save bar (`form-context.tsx`). The bar
    counts changes, checks every card first (a card can veto, e.g. agent shares that do not
    total 100 %), then saves in order (shares before the method that needs them).
  - Leaving a topic or switching market with unsaved changes asks first.
  - Lists (shops, carriers, sites, accounts) act immediately. Panels have their own
    Annuler / Enregistrer.
- **A setting has two storage shapes, and every reader accepts both.** The settings route
  stores a scalar wrapped (`{"value": 30}`); seeds and older writes are bare (`30`);
  `PUT /api/assignment-rules` writes `{ type }`. In TypeScript, `storedScalar` /
  `getMarketSetting` unwrap. In SQL, read a scalar with `public.setting_scalar(value)`, never
  `(value #>> '{}')::int` directly. That direct cast made `archive_finished_orders()` fail
  every night from 2026-08-22, the night after Tunisia saved its archive delay from the
  screen. The exception aborted both markets, and 918 Libyan orders went unarchived.
  `20261003120000_settings_scalar_readers.sql` patched the seven readers, and its last block
  fails if any settings reader casts a raw value again.
- **Partial settings save.** `PATCH /api/settings/[marketId]` takes only the changed keys and
  validates the object they produce.
  - Nothing is written for an unchanged value, including values stored in the old
    `{ type }` / `{ amount }` wrappers. This stops « manual → manual » history rows.
  - A market_manager may only change the keys in `MANAGER_EDITABLE_SETTING_KEYS`. Anything
    else returns 403 `setting_super_admin_only`, or `whatsapp_settings_super_admin_only` for
    WhatsApp keys.
  - The database holds the same list. Before `20261002150000_settings_manager_daily_rules.sql`
    the only write policy on `settings` was super_admin, so every manager save was a 500, in
    production too. Two policies now let a manager INSERT and UPDATE rows of their own market
    whose key is in the list, and nothing else (no DELETE, no moving a row to the other market,
    no renaming it into another key). A Vitest test in `src/lib/reglages/topics.test.ts` reads
    the migration and fails if its three lists and `MANAGER_EDITABLE_SETTING_KEYS` drift apart.
    `supabase/tests/settings_manager_write_test.sql` proves it under a real JWT.
- **Read-only is shown as values**, with « Modifiable par un administrateur », never as
  disabled inputs.
- **Help text restates the value** and updates while typing (« Au 8ᵉ appel sans réponse… »).
- **Sizes are in px.** The root font is 14px, so rem classes would render 12.5 % small.

## What is not shown, on purpose

- **24 settings no code reads**, listed in `plans/reglages-redesign.md`. Their values stay in
  the database. Before un-hiding one, check that its first reader exists with
  `grep -rl <key> src supabase/migrations`.
- **Alertes**: all its thresholds are dead except `carrier_stall_days`, which moved to
  Livraison as « Colis immobile ».
- **No monitoring lists in settings.** The owner rejected the v1 « À vérifier » list on
  2026-10-02.
- **No per-reason « Note obligatoire ».** `requires_note` is only read on the « Autre » group.
- **No « Archiver » on shops or carriers.** Archiving is the same as switching off.
- **Shop creation** offers the four platforms of the old wizard. Google Sheets, BuyBox and
  Converty need technical setup.
- **An existing carrier's site is shown, not edited.** A Darb account belongs to one building.

## Server pieces added for these screens

- `GET /api/markets?detail=1` (super_admin): every market, inactive ones included, with the
  label sender.
- `PATCH /api/markets/[id]` now also accepts `sender_name`, `sender_address`, `sender_phone`.
- `GET /api/storefronts/activity?market_id=`: orders over 30 days and the last order, read
  from `orders`. Webhook columns are not used: the Sheets shop has never received one.
- `GET /api/settings/rejection-reasons/usage?market_id=`: orders per sub-reason.
- `GET /api/carriers` returns `warehouse_id`. `POST /api/carriers` accepts `warehouse_id`,
  which must belong to the same market.
- `GET /api/admin/warehouse-sites` is readable by a market_manager for their own market.
  Soft-deleted users are no longer counted as agents.
- `GET /api/admin/logs/counts?market_id=`: Journaux badges over 24 hours, counted with HEAD
  requests. There are about 20 000 carrier events a day, past the 1 000-row page.
- `?market_id` on `/api/admin/webhook-logs` (filtered by shop) and
  `/api/admin/carrier-events` (filtered by carrier code). `/api/admin/audit` returns the
  market of each change.

## Code

- `src/components/reglages/`:
  - `ReglagesShell` for the menu and header
  - `TopicBody`
  - `topics/*Topic.tsx`
  - `kit/` for the shared pieces: setting row, number field, switch, option cards, save bar,
    history clock, drawer
  - `form-context.tsx` and `useMarketSettingsForm.ts`
- `src/components/journaux/JournauxWorkspace.tsx`
- Translation namespaces `reglages` and `journaux` in `src/messages/{fr,ar}.json`, guarded by
  `reglages-parity` and `journaux-parity`.
- `/settings/integrations` (Meta, duplicated by Publicité) and `/settings/statuses` (Kanban
  columns) are still live and unlinked. Deleting them is the owner's call.
