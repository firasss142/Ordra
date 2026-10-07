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

## v2 (2026-10-06)

Plan: `plans/journal-detection-and-settings-v2.md`.

**The menu has four sections** (`MENU_GROUPS`):
- Ventes: Boutiques, Commandes, Motifs de rejet, Prospects, Équipe
- Expédition: Entrepôts, Livraison
- Clients et publicité: WhatsApp, Publicité
- Système: Marchés, Surveillance

The default topic is Boutiques, for every role. The market switch is hidden on topics that cover all markets.

**New topics and rows:**
- **Prospects** (a manager may edit):
  - `max_lead_attempts` (default 3)
  - `lead_hot_window_minutes` (default 60)

  Both were read by code and editable nowhere. They are added to the RLS whitelist in `20261006120200`, which the Vitest list test now reads.
- **Commandes › Paiement par carte** (super_admin only, it is money): `card_surcharge_pct` (default 10).
  - It replaces `* 1.1` in `computeOrderTotal` and in `merge_orders()`.
  - The server reads it through `getCardSurchargePct()`, which never throws.
- **Surveillance** (super_admin only): `journal_rule_settings`. See `docs/journal.md` §6.

**Found, not changed (owner's call):** the two item routes apply the card surcharge to Darb card orders, but the order route does not. See the plan.

## v3 — the house language of Commandes (2026-10-06)

Same structure, same behaviour, new skin. The page sits in `.cmd.cmd-page.rg`, imports Commandes'
stylesheet, and adds `src/components/reglages/reglages.css`:

- **Page header** as on Commandes: H1 « Réglages » 24/800 and, under it, who may change what (the old
  menu footer, now always visible).
- **Menu**: one glass card; section names as eyebrows; each topic has an icon square; the current
  topic is brand wash with a brand icon square. The market switch is Commandes' soft segmented pill.
- **Topic header** 22/800 with a crumb, the market chip floats as a glass pill.
- **Cards** (`SettingsCard` → `.rg-card`): 20px radius, glass edge, near-opaque body so forms stay crisp.
- **Atoms** redrawn in the kit: buttons (`.btn`/`.btn2` look, 11px radius, 700), badges (Commandes'
  tinted pill with hairline), inputs and number fields (11px radius, brand focus glow), option cards
  (14px, brand wash when chosen), drawers (20/800 title, eyebrow section heads), the save bar (floating,
  amber edge), the confirm dialog, the history popover, table heads (eyebrow style).
- **Token repoint, scoped:** inside `.rg`, the older Tailwind tokens the topic files still use
  (`text-ink-*`, `border-line-subtle`, `bg-surface-sunken`, `text-status-*`) resolve to the Aurore values.
  This is the migration design-system §2 plans for the whole app, applied to one page.

## v4 — one header, like Accueil and Commandes (2026-10-07)

v3 restyled the atoms but kept two stacked headers (H1 « Réglages », then a 22px topic title with a
crumb and a market chip) and a menu whose filled-green current topic copied the dark sidebar.

- **One page header.** The market sits on its right, as Accueil's dates do: Commandes' soft segmented
  tabs for the administrator (group « Marché réglé »), a two-line pill « Votre marché · Libye · LYD » for a
  manager. It shows only on market topics. The « Tous les marchés » hint is gone; the scope card already asks.
- **The topic is a section title** (18/800 and its subtitle) under the header: no crumb, no chip.
- **Menu**: the current topic is a raised white pill with a brand icon square, Commandes' tab idiom.
- **Cards are Commandes' table**: glass head (`var(--card)`), white body, the house 22px radius, footer sunken.
