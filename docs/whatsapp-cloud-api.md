# WhatsApp Business Cloud API — how Ordra sends and receives

Built 2026-09-25 from the approved plan (`plans/whatsapp-cloud-api.md`) and the two
prototypes (`prototypes/whatsapp-agent-v1.html`, `prototypes/whatsapp-manager-v1.html`).
This page is the operating contract: what exists, what each part may do, and how to
tell when it is broken. Design decisions and their reasons stay in the plan.

## What it does

| Use | Where | How |
|---|---|---|
| Automatic lifecycle notices | trigger on `orders.status` → `whatsapp_outbox` → pg_cron drain | per-market toggles, default OFF |
| Agent 1:1 from the business number | order panel « Messages » tab, `/delivery` sheet, prospects row, product sheet | synchronous `POST /api/whatsapp/send` |
| Two-way inbox | replies land on the order (bell « a répondu sur WhatsApp »); unmatched ones at Clients › Messages | webhook attribution + `whatsapp_claim_conversation` |
| Campaigns from the business number | `wa_sender = 'api'` in the campaign sheet | template submitted to Meta → approval → launch → paced outbox |

**A market that is not connected shows WhatsApp disabled, not hidden** (owner decision,
2026-09-25, reversing the prototype's `noconfig` state). The hero button and the Messages
tab are there, muted; the tab, the /delivery sheet, the prospects sheet and the product
sheet say « WhatsApp n'est pas connecté pour ce marché » and offer today's wa.me link;
no automation runs. The switch is `useWhatsAppAvailability(market).known`: false only
while the first answer is pending — a failed check counts as known and not connected,
so an environment where the check errors never hides the surfaces again.

## Tables (all `market_id`-scoped, RLS on)

| Table | Row | Who reads | Who writes |
|---|---|---|---|
| `whatsapp_configs` | one per market: WABA, phone number id, app id, three ciphertext secrets, quality, tier, `status active|paused|auth_failed`, and the last staged test (`last_test_at`, `last_test_ok`, `last_test_stages` — built from Graph answers, never a secret) | service role only (no policies, grants revoked) | `/api/whatsapp/config*` (super_admin) |
| `whatsapp_templates` | one per (market, name, language); `event_key` maps a lifecycle event; `variables[]` names `{{1}}..{{n}}`; `catalogue_key`; `source catalogue|campaign|synced` | own market (any role), super_admin | routes on the admin client |
| `whatsapp_conversations` | one per (market, phone): `last_inbound_at` (24 h window), `opted_out_at`, `undeliverable_at`, `current_order_id` / `current_lead_id`, `unread_count` | super_admin; manager own market; agent when anchored on their order/lead | webhook, send, RPCs |
| `whatsapp_messages` | the log; `wamid` unique; content immutable, status forward-only or `failed` (`whatsapp_messages_guard`) | same rule via the row's `order_id` / `lead_id` | webhook, send, drain |
| `whatsapp_outbox` | queued sends: `dedupe_key` `lifecycle:<order>:<event>` or `campaign:<campaign>:<lead>`, `not_before` pacing, `attempts` | super_admin, manager own market | trigger, `whatsapp_enqueue_campaign`, drain |
| `whatsapp_outbox_runs` | one per drain run, `status running|succeeded|partial|failed|skipped_locked`, one in flight | managers, super_admin | drain |

`customers` gained `whatsapp_language`, `whatsapp_opted_out_at`, `whatsapp_undeliverable_at`,
`whatsapp_last_inbound_at`, `whatsapp_last_outbound_at`. `prospect_campaigns` gained
`wa_template_id`, `wa_language`, `wa_image_url`, `wa_launch_status`, `launched_at`, and
`wa_launch_status_at` (stamped by `trg_prospect_campaigns_launch_status_at` whenever the
launch status changes; drives « soumis / approuvé il y a N min »).
`agent_notifications.kind` accepts `whatsapp_inbound`.

## Functions

| Function | Mode | Who may call | Purpose |
|---|---|---|---|
| `whatsapp_e164(phone, market_code)` | IMMUTABLE | anyone | SQL mirror of `toWhatsAppE164()` — 216 + 8 digits, 218 + 9 digits starting with 9 |
| `set_customer_whatsapp_language(customer, lang)` | DEFINER | super_admin, market manager, the assigned agent | the only write path for the language |
| `whatsapp_mark_conversation_read(conversation)` | DEFINER | same three | clears `unread_count` and the bell row |
| `whatsapp_claim_conversation(conversation, order?, lead?)` | DEFINER | super_admin, market manager | « Rattacher à »: anchors + back-fills unanchored messages + notifies the owner |
| `whatsapp_orphan_unread_count(market?)` | DEFINER | managers, super_admin | the sidebar badge |
| `whatsapp_enqueue_lifecycle()` | trigger, DEFINER, exception-safe | — | `AFTER UPDATE OF status ON orders`; enqueues, never sends |
| `whatsapp_next_send_slot(market, at)` | STABLE | — | defers outside the market's `whatsapp_send_window` |
| `whatsapp_outbox_claim(run, limit)` | DEFINER | service_role | `FOR UPDATE SKIP LOCKED` batch claim |
| `whatsapp_campaign_slot(window, rate, i, tz, from)` | IMMUTABLE | — | row *i* leaves at window start + i/rate hours, rolling days |
| `whatsapp_enqueue_campaign(campaign)` | DEFINER | service_role | one paced row per prospect, brakes applied |
| `invoke_whatsapp_outbox()` | DEFINER | service_role (pg_cron) | pg_net → `/api/cron/whatsapp-outbox`, only when a row is due or stuck |
| `whatsapp_outbox_cron_status()` | DEFINER | service_role | is the job scheduled |
| `get_prospect_console(...)` | SECURITY INVOKER, one round trip | authenticated | campaigns carry a `whatsapp` object: template state, launch status and its time, the funnel, marketing-cap skips |

## Event catalogue and the trigger

| `event_key` | Tunisia fires on | Libya fires on | Template variables |
|---|---|---|---|
| `could_not_reach` | `attempt_1/2/3` (once per order) | same | name, order_ref |
| `shipped` | `dispatched` | `scanned`, `at_carrier` (first wins) | name, carrier, tracking, amount |
| `out_for_delivery` | `out_for_delivery` | `out_for_delivery` | name, amount |
| `last_chance` | `returning` | `delivery_delayed`, `returning` | name |
| `delivered` | `delivered` | `delivered` | name |

Guards, cheapest first: active config → `whatsapp_lifecycle_enabled` → event mapping →
`whatsapp_event_<key>` → customer not opted out / undeliverable → valid number →
language (customer's, else `whatsapp_default_language`, else the market's) →
`INSERT … ON CONFLICT (dedupe_key) DO NOTHING` with `not_before = whatsapp_next_send_slot()`.
The body is wrapped in `BEGIN … EXCEPTION … RAISE WARNING`, so it can never fail an order
write. Template resolution happens in the drain: an event enqueued before its template is
approved waits (`template_pending`, retried every 30 min); an event with no mapping at all
is `skipped/no_template`.

The catalogue (`src/lib/whatsapp/catalogue.ts`) is the customer-facing text: five
lifecycle templates, five agent templates (the old wa.me texts), `product_share`
(IMAGE header) and `prospect_follow_up` (MARKETING, STOP footer). « Créer les modèles
Ordra » on the Modèles page submits it in both languages and maps the events.

## Send paths and the gate

Every send passes `assertSendAllowed()` (`src/lib/whatsapp/gate.ts`) immediately before
the Graph call, in this order: `config_inactive` → `invalid_phone` → `opted_out` →
`undeliverable` → `window_closed` (free text / image only) → `deferred`. Nothing outside
`src/lib/whatsapp/**` imports the Graph client except the config test route.

- **Agent** (`POST /api/whatsapp/send`): authorisation with the USER client (RLS; agents
  must be `assigned_to`), variables rendered server-side from the order/lead, message row
  `sent` with the wamid or `failed` with Meta's code, optional `record_delivery_action`
  through the existing RPC. Image mode is free-form inside the 24 h window and the
  approved `product_share` template outside it.
- **Drain** (`/api/cron/whatsapp-outbox`, `src/lib/whatsapp/outbox.ts`): one run at a
  time; reaper (stale `sending` > 5 min → queued; `attempts ≥ max_attempts` → failed);
  claim 120; markets in parallel, rows spaced by `send_rate_per_sec`; stop 3 s before the
  45 s deadline and release the rest.

Error classes (`src/lib/whatsapp/errors.ts`):

| Meta | Class | Outbox |
|---|---|---|
| 4, 17, 613, 80007, 130429, 131056, 131016, HTTP 429 | throttle | retry, backoff 30 s · 2ⁿ ≤ 30 min |
| 5xx, timeout, 131000 | transient | retry (131000 capped at 3) |
| 190, 10, 200–299 | auth | config → `auth_failed`, market deferred 1 h, rows requeued |
| 131047 | window_closed | fail (text only) |
| 131026 | undeliverable | skip; conversation + customer flagged |
| 131049 | marketing_cap | skip |
| 132000–132069 | template | fail |
| 100, 131008, 131009, 131021, 131051 | invalid_request | fail |
| 131048 | spam_pause | market deferred 2 h |
| 131031, 131042, 131037 | account_paused | config → `paused` |

## Webhook — `/api/webhooks/whatsapp`

One URL for both Meta apps. GET answers `hub.challenge` when `hub.verify_token` matches
any market's decrypted token (403 otherwise). POST reads the raw body once, picks the
markets named by `phone_number_id` / WABA id, checks `X-Hub-Signature-256` against each
one's app secret — **401 on no match** (Meta retries; a mis-typed secret loses nothing),
200 for everything else. Then per event, each in its own try/catch:

- `statuses[]` → `UPDATE whatsapp_messages … WHERE wamid`; the DB guard keeps it
  forward-only; unknown wamid retried once after 500 ms; 131026 flags the number.
- `messages[]` → market must match the number's dial code; conversation upserted;
  attribution: anchored order if live (or terminal < 7 days) → customer's most recent live
  order → anchored/open lead → orphan; row `received`; `unread_count` +1; STOP-family text
  (`isOptOutText`) sets the opt-out on conversation + customer and skips queued outbox
  rows; owning agent gets one unread `whatsapp_inbound` notification.
- `message_template_status_update` → template status (+ reason); a campaign template flips
  its campaign `pending_template → ready | rejected`.
- `phone_number_quality_update` → tier; FLAGGED noted, never auto-paused.
- `account_update` DISABLED/RESTRICTION/VIOLATION → config `paused`.

Every delivery writes one `webhook_delivery_log` row, `source = 'whatsapp'`.

## Who may change what (managers read, super_admin decides)

| Thing | super_admin | market_manager (own market) | Enforced in |
|---|---|---|---|
| Credentials, test, pause | write | read the card (no form, no System User chip) | `/api/whatsapp/config*` |
| Verify token « Afficher » | reveal (`GET /api/whatsapp/config/[marketId]/verify-token`, `no-store`, the only credential that ever returns to a browser) | — | the route (403) |
| Paramètres › WhatsApp (`whatsapp_*` keys) | write | read-only | `PATCH /api/settings/[marketId]`: a manager's unchanged `whatsapp_*` values are dropped from the write, a changed one is `403 whatsapp_settings_super_admin_only` |
| Modèles: event mapping | write | read-only | `PATCH /api/whatsapp/templates/[id]` is super_admin only |
| Modèles: sync, « Créer les modèles Ordra » | yes | yes (the prototype shows them) | routes |
| Messages inbox, « Rattacher à », campaigns | yes | yes | routes + RLS |

Managers reach Connexions and Paramètres through a Système section that shows only those
two entries plus « Lecture seule — … modifiés par un super_admin ». The manager screens
(Connexions card, Modèles, Paramètres › WhatsApp, Messages) are translated under the
`whatsappAdmin` namespace; the pages around them (Connexions tabs, the settings header)
are still French, like the rest of the manager console.

## Values in the template's language

Resolvers are language-blind (`resolveOrderVariables` & co.: « 249 LYD », « Darb
Assabil »); `localizeVariables(values, template.language)` rewrites them for an Arabic
template (« 249 د.ل », « درب السبيل ») and is applied in `send.ts`, in the drain and in the
composer preview, so the preview is what is sent. The greeting is always the first name
(« مرحباً محمود »), as in the prototype.

## Settings keys (per market, `settings`)

`whatsapp_lifecycle_enabled` (master), `whatsapp_event_could_not_reach`,
`whatsapp_event_shipped`, `whatsapp_event_out_for_delivery`, `whatsapp_event_last_chance`,
`whatsapp_event_delivered` (all bool, default false), `whatsapp_default_language`
(`ar|fr`, unset = market language), `whatsapp_send_window` (`"HH-HH"`, empty = always).
Edited at Réglages › WhatsApp (since 2026-10-02; see docs/reglages.md).

## Surfaces

| Surface | File | Notes |
|---|---|---|
| Réglages › WhatsApp (number) | `src/components/reglages/topics/WhatsAppTopic.tsx` + `whatsapp/WhatsAppConnectDrawer.tsx` | per-market card, verify-before-store (save toast), staged test kept after reload (filled-circle stages, « dernière passe » as a clock time), verify token « Afficher / Masquer » and one row per market in the webhook block (super_admin) |
| Modèles | `/messages/templates` (switch « Conversations · Modèles » in `messages/MessagesHeader.tsx`), `src/components/whatsapp/TemplatesTable.tsx` | market pills with counts, sync/create in the top bar with the prototype's toasts, « Campagne · {nom} », 520 px drawer: phone preview, coloured JSON, « Corriger et resoumettre (v2) », « Supprimer »; not connected: the table stays with an explanation |
| Réglages › WhatsApp (automatic messages) | `src/components/reglages/topics/WhatsAppTopic.tsx` | master + 5 events with template state per language, default language, send window |
| Order panel Messages tab | `OrderDetailPanel/{index,CustomerHero}.tsx`, `components/whatsapp/{MessageThread,WhatsAppComposer}.tsx` | hero button in three states (active with the unread count on its corner, muted when not connected, inert when opted out); tab always present; thread opens on the newest message, signs agents' messages, keeps the new-reply ring after mark-read, « Réessayer » resends a failed one; « Fenêtre ouverte jusqu'à demain 10:12 »; the bell's `?openOrderId=&tab=messages` applies to that order only |
| Queue rows | `OrderCard.tsx`; `/api/agent/queue` stamps `wa_conversation`, `wa_unread` | « WhatsApp · produit », « a répondu · produit » while a reply is unread |
| Bell | `NotificationBell.tsx`; `/api/notifications` attaches `excerpt` | green tile, « {client} a répondu sur WhatsApp », the customer's words, « il y a 2 min »; a WhatsApp reply turns the badge green |
| `/delivery` sheet | `components/delivery/WhatsAppLiveSheet.tsx` (composer `variant="sheet"`) | real send, `alreadyRecorded` so the ledger row is written once; the sheet stays open on « Envoyé » + « Consigné dans la fiche · statut mis à jour en direct » + « Fermer »; not connected: grey banner + white outline « Ouvrir WhatsApp » (wa.me, still logged) |
| `/delivery` row, timeline, detail | `DeliveryRow.tsx` (`/api/delivery/worklist` attaches `wa_last`), `DeliveryTimeline.tsx` (`template_key`), `DeliveryMessages.tsx` | « WhatsApp · Avant livraison · 10:31 ✓✓ » when the business number wrote since the parcel last moved; « WhatsApp · {modèle} » in the timeline; Messages section on worklist and board |
| Prospects | `ProspectRow.tsx` (square + « a répondu » chip + « {campagne} · envoyé hier ✓✓ »), `ProspectWhatsAppSheet.tsx`; `/api/prospects/worklist` adds `wa_sent_status` | the reply quoted at the top of the sheet, campaign chip named after the campaign, free text after a reply |
| Product sheet | `ProductSheetDrawer.tsx` | black « Envoyer sur WhatsApp »; sent card with the caption and how it left (image in the window, `product_share` outside); opted out disables it; not connected keeps the wa.me link under the banner |
| Clients › Messages | `/messages`, `components/whatsapp/{ConversationsList,ConversationDrawer,ClaimSearch}.tsx` | counts on both tabs, the reply opens on free text (« Répondre au client… ») while the window is open, « Rattacher à » lists recent orders (status in words) and prospects (campaign name) before anything is typed; green sidebar badge, also on the collapsed Clients header, scoped to the selected market for a super_admin |
| Campaigns | `console/CampaignSheet.tsx` (api mode), `CampaignCard.tsx` | body editor with `{nom} {produit} {ville} {remise}`, first/last-token rule, preview with footer, submit → pending → launch |

## Runbook

```sql
-- is the drain alive?
SELECT * FROM whatsapp_outbox_runs ORDER BY started_at DESC LIMIT 5;
SELECT id, status_code, error_msg FROM net._http_response ORDER BY created DESC LIMIT 5;
SELECT * FROM cron.job WHERE jobname = 'whatsapp-outbox-1min';

-- what is waiting, and why did a row not go out
SELECT status, skip_reason, last_error_code, count(*) FROM whatsapp_outbox GROUP BY 1,2,3 ORDER BY 4 DESC;
SELECT * FROM whatsapp_outbox WHERE order_id = '<uuid>';

-- did Meta call us
SELECT created_at, event, status, error_message FROM webhook_delivery_log WHERE source = 'whatsapp' ORDER BY created_at DESC LIMIT 20;

-- a market's health
SELECT market_id, status, status_reason, quality_rating, messaging_limit_tier, last_webhook_at FROM whatsapp_configs;
```

Local webhook proof (dev server + a config row with the same app secret):

```bash
BODY='{"object":"whatsapp_business_account","entry":[{"id":"<WABA_ID>","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"21612345678","phone_number_id":"<PHONE_NUMBER_ID>"},"contacts":[{"profile":{"name":"Test"},"wa_id":"21698765432"}],"messages":[{"from":"21698765432","id":"wamid.TEST1","timestamp":"1758700000","type":"text","text":{"body":"STOP"}}]}}]}]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$APP_SECRET" | sed 's/^.* //')
curl -i -X POST http://localhost:3000/api/webhooks/whatsapp -H 'Content-Type: application/json' -H "X-Hub-Signature-256: sha256=$SIG" --data-binary "$BODY"
curl -i "http://localhost:3000/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=$VERIFY_TOKEN&hub.challenge=12345"
```

Tests: `npx vitest run src/lib/whatsapp src/app/api/whatsapp src/app/api/webhooks/whatsapp src/components/whatsapp`
and `supabase/tests/run.sh whatsapp_core_test.sql whatsapp_lifecycle_trigger_test.sql whatsapp_inbox_test.sql`.
The trigger test saves the market's real config and `whatsapp_%` settings before
replacing them with fakes, and restores them at the end.

## Meta checklist (per market, twice) and warm-up

1. Business Portfolio → business verification (day 1; gates the 1K tier).
2. Meta App (Business) with the WhatsApp product; note App ID + App secret.
3. WhatsApp Manager → add the number (never used on a WhatsApp app), display name, profile, two-step PIN.
4. Payment method on the WABA.
5. System User → assign app + WABA → permanent token with `whatsapp_business_messaging` + `whatsapp_business_management`; note WABA ID, Phone number ID.
6. App → WhatsApp → Configuration → callback `https://<app>/api/webhooks/whatsapp`, verify token from the Connexions card; subscribe `messages`, `message_template_status_update`, `phone_number_quality_update`, `account_update`. The staged test subscribes the app to the WABA itself.
7. Ordra: enter credentials → Tester → « Créer les modèles Ordra » → wait for approvals → Paramètres: default language, enable ONE event.

Warm-up on the 250/day unverified cap: week 1 one market, `shipped` only; week 2
`out_for_delivery`, then `could_not_reach`; week 3 `last_chance`, `delivered`, agent 1:1
on /delivery; campaigns only after verification (tier ≥ 1K) and a GREEN week, first one
≤ 200 recipients at ≤ 60/h inside 10–20 local.

## Not done (Phase 7)

`toE164` and `toWhatsappNumber` are one-line wrappers over `toWhatsAppE164` and still
serve the wa.me fallback for a market without a config; they go once both markets are
connected. `supabase/tests/whatsapp_rls_test.sql` across all six tables under real JWTs
is not written (the core, trigger and inbox tests cover the RPC guards and the SELECT
policies on conversations/messages). No ESLint `no-restricted-imports` rule: the repo has
no ESLint configuration.
