# WhatsApp Business Cloud API in Ordra

> Durable copy of the plan approved 2026-09-25. Scratch copy lived at ~/.claude/plans/. Companion doc to write in Phase 7: `docs/whatsapp-cloud-api.md`.

## Context

Today WhatsApp in Ordra is manual: agents click prefilled `wa.me` links from `/delivery`, the prospects worklist and the product sheet, and the message leaves from the agent's own phone. There is no delivery status, no reply capture, no automation, and the business number is whatever phone the agent holds. The Connexions screen already shows a placeholder "WhatsApp Business — Non connecté" card, `prospect_campaigns.wa_sender` already has an `api` value documented as "not connected", and `docs/oms-spec.md` lists customer notifications as Future.

Goal: connect Meta's WhatsApp Business Cloud API so that Ordra (1) sends automatic lifecycle notifications on configurable order events, (2) lets agents send 1:1 from the business number with real delivery status, (3) receives customer replies on the order, and (4) runs prospect campaigns whose marketing template is composed in Ordra, approved by Meta, then sent paced. The standalone campaign platform's sending logic (pasted reference) is reused in approach, not code: Ordra has its own credential store, Graph client pattern, webhook pattern and cron pattern to mirror.

## Decisions made with the owner (closed)

| Topic | Decision |
|---|---|
| Uses | All four: lifecycle notifications, agent 1:1, two-way inbox, campaigns with composed templates |
| Meta side | Starts from zero. **Two Business Portfolios, one per market**, each its own WABA + one new number (no migration) |
| Volume | 100–500 orders/day combined → business verification required, warm-up planned |
| Lifecycle trigger | Automatic on status change, each event **toggleable per market, default OFF** |
| Events | `could_not_reach` (attempt_N), `shipped`, `out_for_delivery`, `last_chance` (delayed/returning), `delivered`. **Not** on intake or confirm |
| Language | Per customer: agent picks ar/fr on first send, stored on `customers.whatsapp_language`; per-market default fallback |
| Consent | No consent capture. STOP-style replies still set an opt-out flag (Meta requirement, protects quality rating) |
| Surfaces | Order panel (queue), `/delivery` sheet, prospects row, product sheet share |
| Campaign text | Manager composes body + variables + optional image in Ordra; Ordra submits the MARKETING template to Meta; launch blocked until APPROVED |
| Market not connected (2026-09-25, after the build) | WhatsApp is **shown disabled, not hidden**: button and Messages tab muted, sheets explain « non connecté » and keep the wa.me link. Reverses the prototype's `noconfig` state |

## Decisions I made as the expert (push back if wrong)

1. **Inbox = thread on the order + a small per-market orphan list.** Replies attach to the customer's live order and notify the owning agent; conversations with no matching order or prospect appear at `Clients → Messages` for managers to claim.
2. **`could_not_reach` fires once per order** (first unanswered attempt), not after each of the three attempts. One dedupe key per (order, event).
3. **Webhook returns 401 on a bad signature**, 200 for everything else. Meta retries non-200, so a mis-entered app secret loses no events once corrected; a forged request is never acknowledged.
4. **Agent sends are synchronous** (immediate success/failure, like carrier upload). Automatic and campaign sends go through an **outbox** drained by pg_cron every minute.
5. **Messages log is not append-only.** A message's status advances sent → delivered → read out of order; the row is the current state with monotone `*_at` columns, protected by a forward-only BEFORE UPDATE guard. Content columns are immutable.
6. **Customer-facing template text lives in a TS catalogue, not next-intl** (same reasoning as `whatsapp-templates.ts`: the customer's language, not the agent's).
7. **Free-form text only inside Meta's 24h window** after the customer's last inbound; outside it the composer offers templates only. This is Meta's rule, not a choice.
8. **Lifecycle sends respect a per-market send window** (`"10-20"` like `wa_window`), deferred not dropped, so a night-time Darb sync cannot message a customer at 03:00.

## Architecture

```
orders.status changes ──trigger──▶ whatsapp_outbox ──pg_cron 1/min──▶ /api/cron/whatsapp-outbox ──▶ Graph API
agent clicks send ──────────────▶ /api/whatsapp/send (sync) ─────────────────────────────────────▶ Graph API
campaign launch ────────RPC─────▶ whatsapp_outbox (paced not_before) ─────────────────────────────▶ Graph API
Meta ──POST /api/webhooks/whatsapp──▶ statuses by WAMID · inbound → conversation/thread · opt-out · template approvals · quality
```

Everything server-side lives in `src/lib/whatsapp/`. The single send choke point is `gate.ts` (§ Choke point). Credentials follow the `meta_ad_accounts` pattern: encrypted with `src/lib/crypto.ts`, table with RLS on and zero policies, grants revoked, read only via `createAdminClient()`.

## Data model (Phase 1 unless noted)

All tables have `market_id → markets`, `created_at/updated_at`. RLS helper calls wrapped `(SELECT get_user_role())`.

**`whatsapp_configs`** — one row per market. `waba_id`, `phone_number_id UNIQUE` (webhook routing key), `app_id`, `graph_version DEFAULT 'v26.0'`, `access_token` / `app_secret` / `verify_token` (all ciphertext), `display_phone`, `verified_name`, `quality_rating`, `messaging_limit_tier`, `status CHECK IN ('active','paused','auth_failed')`, `status_reason`, `send_rate_per_sec DEFAULT 3`, `last_webhook_at`, `last_checked_at`, `last_error`. RLS on, no policies, `REVOKE ALL FROM authenticated, anon`.

**`whatsapp_templates`** — registry + event mapping + variable contract. `meta_template_id`, `name`, `language CHECK ('ar','fr')`, `category CHECK ('UTILITY','MARKETING','AUTHENTICATION')`, `status CHECK ('DRAFT','PENDING','APPROVED','REJECTED','PAUSED','DISABLED','DELETED','UNKNOWN')`, `rejected_reason`, `components jsonb` (exactly what Meta holds), `body_text`, `header_format`, `variables text[]` (ordered names bound to `{{1}}..{{n}}`), `event_key` (NULL for campaign templates), `source CHECK ('catalogue','campaign','synced')`, `campaign_id`, `synced_at`. `UNIQUE (market_id, name, language)`; partial unique `(market_id, event_key, language) WHERE event_key IS NOT NULL`. SELECT policy: super_admin or own market. No write policies (routes write via admin client after a role check).

**`whatsapp_conversations`** — one per (market, phone). `phone_e164` (no `+`), `customer_id`, `current_order_id`, `current_lead_id`, `last_inbound_at` (24h window = this + 24h), `last_outbound_at`, `unread_count`, `opted_out_at`, `opt_out_text`, `undeliverable_at` (Graph 131026), `claimed_by`, `claimed_at`, `profile_name`. `UNIQUE (market_id, phone_e164)`; partial index on orphans `(market_id, last_inbound_at DESC) WHERE current_order_id IS NULL AND current_lead_id IS NULL`. SELECT: super_admin; manager own market; agent when `assigned_to` on the anchored order/lead. Chosen over deriving the window from messages because claim and orphan listing need an entity.

**`whatsapp_messages`** — the log. `conversation_id`, `direction CHECK ('in','out')`, `wamid` (partial UNIQUE where not null: webhook idempotency + status lookup), `phone_e164`, `customer_id`, `order_id`, `lead_id`, `campaign_id`, `template_id`, `outbox_id`, `event_key`, `kind` (template/text/image/…/unsupported), `body` (rendered snapshot or inbound text), `variables jsonb`, `media_id/link/mime/caption`, `context_wamid`, `status CHECK ('received','queued','sent','delivered','read','failed')`, `sent_at/delivered_at/read_at/failed_at`, `error_code/title/detail`, `pricing_category`, `pricing_billable`, `pricing_model`, `conversation_meta_id/origin/expires_at`, `sent_by`, `actor_type CHECK ('agent','manager','system','campaign','customer')`. Indexes on `(order_id, created_at DESC)`, `(lead_id, …)`, `(conversation_id, …)`, `(market_id, …)`, `(campaign_id, status)`. `whatsapp_status_rank()` + BEFORE UPDATE guard `whatsapp_messages_guard()`: content columns immutable (raise 42501), status only forward or to `failed`. SELECT: same three-way rule via the row's order/lead. No write policies.

**`customers` additions**: `whatsapp_language CHECK ('ar','fr')`, `whatsapp_opted_out_at`, `whatsapp_last_inbound_at`, `whatsapp_last_outbound_at`, `whatsapp_undeliverable_at`. Writer: SECURITY DEFINER `set_customer_whatsapp_language(p_customer_id, p_lang)` (manager/super_admin of the market, or the agent assigned to one of the customer's orders). `REVOKE FROM PUBLIC; GRANT authenticated`.

**`whatsapp_outbox`** (Phase 4): `kind CHECK ('lifecycle','campaign')`, `dedupe_key UNIQUE` (`lifecycle:<order_id>:<event_key>` | `campaign:<campaign_id>:<lead_id>`), `payload jsonb`, `status CHECK ('queued','sending','sent','failed','skipped')`, `attempts`, `max_attempts DEFAULT 6`, `next_attempt_at`, `not_before` (window/pacing), `locked_at`, `run_id`, `last_error_code`, `last_error`, `skip_reason`, `message_id`. Drain index `(next_attempt_at, created_at) WHERE status='queued'`; stale index `(locked_at) WHERE status='sending'`; expression index on `(payload->>'campaign_id')`. RPC `whatsapp_outbox_claim(p_run_id, p_limit)` = `UPDATE … FOR UPDATE SKIP LOCKED`, service_role only.

**`whatsapp_outbox_runs`** (Phase 4): `trigger`, `status CHECK ('running','succeeded','partial','failed','skipped_locked')`, counts, `error`; partial unique "one in flight" like `ad_sync_runs`.

**Settings keys** (Phase 4, `src/types/settings.ts` MARKET_SETTINGS_KEYS + `isValidMarketSettings`): `whatsapp_lifecycle_enabled` (master), `whatsapp_event_could_not_reach`, `whatsapp_event_shipped`, `whatsapp_event_out_for_delivery`, `whatsapp_event_last_chance`, `whatsapp_event_delivered` (all bool, default OFF), `whatsapp_default_language` (default = `markets.language`), `whatsapp_send_window` (`"HH-HH"`, optional).

**Other schema touches**: `agent_notifications.kind` CHECK gains `'whatsapp_inbound'` and `resolve_stale_notifications()` leaves that kind alone (Phase 3); `ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_messages, whatsapp_conversations` (Phase 3, idempotent block as `20260529155948_realtime_publication.sql`); `prospect_campaigns` gains `wa_template_id`, `wa_language`, `wa_image_url`, `wa_launch_status CHECK ('draft','pending_template','ready','launched','rejected') DEFAULT 'launched'` (so every existing row and every `agent`/`call` campaign keeps today's semantics), `launched_at` (Phase 6); SQL `whatsapp_e164(p_phone, p_market_code)` IMMUTABLE mirror of the TS builder (Phase 1).

## Event catalogue and the trigger (Phase 4)

| `event_key` | TN fires on `NEW.status` | LY fires on `NEW.status` | Category | Body variables |
|---|---|---|---|---|
| `could_not_reach` | `attempt_1/2/3` (once per order) | same | UTILITY | `name, order_ref` |
| `shipped` | `dispatched` | `scanned`, `at_carrier` (first wins) | UTILITY | `name, carrier, tracking, amount` |
| `out_for_delivery` | `out_for_delivery` | `out_for_delivery` | UTILITY | `name, amount` |
| `last_chance` | `returning` | `delivery_delayed`, `returning` | UTILITY | `name` |
| `delivered` | `delivered` | `delivered` | UTILITY | `name` |

Agent-only catalogue templates (no trigger): the five existing texts from `src/lib/delivery/whatsapp-templates.ts` become UTILITY templates (`before_delivery`, `courier_no_answer`, `delayed_confirm_time`, `returning_last_chance`, `address_check`; `courier` and `address` become variables), plus `product_share` (MARKETING, IMAGE header, `name, product, amount`) and `prospect_follow_up` (MARKETING, `name, product, discount`). Marketing bodies carry an opt-out FOOTER in both languages. Names `ordra_<key>_v1`. `TemplateVariable` is a closed union: `name | order_ref | carrier | tracking | amount | product | city | address | discount | agent`.

**Trigger `whatsapp_enqueue_lifecycle()`** — `AFTER UPDATE OF status ON orders FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)`, SECURITY DEFINER, `search_path=''`, body wrapped in `BEGIN … EXCEPTION WHEN OTHERS THEN RAISE WARNING` exactly like `orders_broadcast_change()` in `supabase/migrations/20260909223808_orders_broadcast.sql`, so it can never fail an order write and costs the Darb sweep nothing (`UPDATE OF status`). Steps, cheapest guard first: active config exists for market → master toggle (inline `settings` read, idiom of `leads_create_winback()` in `20260914143715_…`) → map (market code, NEW.status) → event → per-event toggle → `customers` row exists, not opted out, not undeliverable → `whatsapp_e164(customer_phone, code)` not null → language = customer's, else market default setting, else `markets.language` → `INSERT INTO whatsapp_outbox … ON CONFLICT (dedupe_key) DO NOTHING` with `not_before = whatsapp_next_send_slot(market, now())`. Template resolution and variable rendering happen in the drain, not the trigger: an event enqueued before its template is approved sends once it is; a missing mapping yields `skipped/no_template`, never a lost event. `REVOKE … FROM PUBLIC, anon, authenticated` on the function.

## The client module — `src/lib/whatsapp/` (Phase 1, extended later)

Server-only, same header rule as `src/lib/meta-ads/client.ts`, which it mirrors (pinned version, Bearer header, 15 s `requestSignal()`, body read once as text, `redact()`, classified error class). Do not modify the ads client; copy the two small helpers into `http.ts`.

| File | Exports |
|---|---|
| `http.ts` | `graphBase`, `requestSignal`, `redact`, `postJson`, `getJson`, `postBinary` (resumable upload). `WHATSAPP_GRAPH_BASE_URL` env override for local stubs only |
| `config.ts` | `loadConfigForMarket`, `loadConfigByPhoneNumberId`, `loadConfigByWabaId`, `loadActiveConfigs`, `markConfigStatus` — decrypt via `src/lib/crypto.ts` |
| `client.ts` | `createWhatsAppClient(cfg)` → `sendTemplate`, `sendText`, `sendImage`, `markRead`, `getPhoneStatus`, `listTemplates`, `createTemplate`, `deleteTemplate`, `createUploadSession`, `uploadChunk`, `subscribeApp`; `WhatsAppApiError` |
| `errors.ts` | `classifyGraphError(err)` → `{ kind, retryable, pauseMarket?, backoffMs? }` (table below) |
| `phone.ts` | `toWhatsAppE164(phone, marketCode)`, `fromWaId(waId)` — built on `normalizePhone` from `src/lib/leads/phone.ts` + `MARKET_DIAL_CODE`/`MARKET_NATIONAL_LENGTH` added to `src/lib/markets.ts` (the only place 216/218 live). LY national must match `^9\d{8}$`, TN `^\d{8}$` |
| `optout.ts` | `isOptOutText(text)` — normalise (trim, lowercase, strip punctuation/diacritics/tatweel, Arabic-Indic digits) then **exact** match against `stop, arret, arrêt, unsubscribe, desabonner, désabonner, désinscrire, non, توقف, ايقاف, إيقاف, الغاء, إلغاء, وقف` |
| `window.ts` | `isServiceWindowOpen(lastInboundAt, now)`, `windowClosesAt()` |
| `gate.ts` | `assertSendAllowed(input): GateResult` — the choke point |
| `render.ts` | `resolveOrderVariables`, `resolveLeadVariables`, `resolveProductVariables`, `toBodyParameters`, `previewParts` (keeps the `{text, variable}` shape `WhatsAppSheet` already highlights) |
| `catalogue.ts` | `CATALOGUE: CatalogueTemplate[]` — customer-facing text |
| `templates.ts` | `syncTemplatesFromMeta`, `createMissingCatalogueTemplates`, `submitTemplate`, `toMetaComponents`, `fromMetaTemplate` (Phase 2) |
| `send.ts` | `sendMessage(admin, userClient, actor, request)` (Phase 3) |
| `outbox.ts`, `backoff.ts` | `drainOutbox`, `nextAttemptAt` (Phase 4) |
| `webhook/{parse,verify,handle}.ts` | pure parser, HMAC check, handler (Phase 2) |
| `campaign-template.ts` | body → components, variable numbering, validation (Phase 6) |

Error classification:

| Graph code / condition | kind | outbox action |
|---|---|---|
| HTTP 429, 4, 17, 613, 80007, 130429, 131056, 131016, timeout, 5xx | throttle / transient | retry with backoff |
| 131000 | transient | retry, max 3 |
| 190, 10, 200–299 | auth | fail row; `markConfigStatus('auth_failed')`; defer market +1 h |
| 131047 | window_closed | fail (text only; templates never get this) |
| 131026 | undeliverable | skip; set `undeliverable_at` on conversation + customer |
| 131049 | marketing_cap | skip, `skip_reason='marketing_cap'` |
| 132000–132069 | template | fail; mark template PAUSED/UNKNOWN, trigger sync |
| 100, 131008, 131009, 131021, 131051 | invalid_request | fail, no retry |
| 131048 | spam_pause | defer market +2 h |
| 131031, 131042, 131037 | account_paused | `markConfigStatus('paused')`; rows stay queued |

## Webhook — `src/app/api/webhooks/whatsapp/route.ts` (Phase 2)

Mirrors `src/lib/orders/webhook-handler.ts`. `dynamic = "force-dynamic"`. One route serves both Meta apps.

- **GET**: `hub.mode === 'subscribe'` and `hub.verify_token` matches the decrypted `verify_token` of any active config (constant time) → `200 text/plain hub.challenge`; else 403. Logged to `webhook_delivery_log(source='whatsapp', event='verify')`.
- **POST**: `rawBody = await request.text()`. Bad JSON → log error, 200. Resolve configs from `entry[].id` (WABA id, the only key on template/quality events) and `changes[].value.metadata.phone_number_id`; none → log `ignored/unknown_source`, 200. Verify `X-Hub-Signature-256` (`sha256=<hex>`) against the raw body with each resolved config's `app_secret` via `verifyHmacSignature` in `src/lib/webhook-validation.ts`; no match → log `error/bad_signature`, **401**. After this, always 200; each event processed in its own try/catch.
- **statuses[]**: `UPDATE whatsapp_messages SET status, <stage>_at, pricing_*, conversation_*, error_* WHERE wamid = $1`; guard makes it forward-only, `failed` always applies. Unknown wamid → retry once after 500 ms (race with an in-flight send), then `ignored/unknown_wamid`. 131026/131049 on a failed status apply the same side effects as the send path. Stamp `whatsapp_configs.last_webhook_at`.
- **messages[]**: `fromWaId(from)` → market must equal the config's market. Upsert conversation; link `customer_id` by `customers.phone_normalized = normalize_phone(waId)`. Attribution: `current_order_id` if set and not terminal older than 7 days → else the customer's most recent live order (or terminal within 7 days) → else `current_lead_id` / the phone's open lead → else orphan. `INSERT whatsapp_messages … ON CONFLICT (wamid) DO NOTHING`. Bump `last_inbound_at`, `unread_count`, `profile_name`; mirror to customers. `isOptOutText` → set `opted_out_at`/`opt_out_text`, mirror to customer, and `skipped/opted_out` every queued outbox row for that phone. Attributed order with `assigned_to` → `INSERT agent_notifications (kind='whatsapp_inbound') ON CONFLICT DO NOTHING`. Media: store `media_id` + mime, no download in this plan.
- **message_template_status_update**: match by `meta_template_id`, else `(market from WABA, name, language)`; set status + `rejected_reason`; flip a `pending_template` campaign to `ready` / `rejected`.
- **phone_number_quality_update**: `quality_rating`, `messaging_limit_tier`; RED → `status_reason` note, no auto-pause.
- One `webhook_delivery_log` row per delivery.

## Outbox drain — `/api/cron/whatsapp-outbox` (Phase 4)

- Migration: `invoke_whatsapp_outbox()` copied from `supabase/migrations/20260814231049_pg_cron_meta_ads_sync.sql` (vault `app_url` + `cron_secret`, `net.http_post`, 55 s), `cron.schedule('whatsapp-outbox-1min', '* * * * *')`. Add the route to `vercel.json` `functions` with `maxDuration: 60` (never the `crons` key). Document as the 14th job in `docs/notifications-cron.md`.
- Route: `isAuthorized()` extracted from `src/app/api/cron/meta-ads-sync/route.ts` into `src/lib/cron/auth.ts` (old routes untouched), `deadlineAt = now + 45 s`, GET and POST.
- `drainOutbox`: insert run row (23505 → `skipped_locked`) → reaper resets `sending` rows locked > 5 min to `queued`, and marks rows past `max_attempts` `failed/poison` → skip markets whose config is `auth_failed`/`paused` (rows stay queued, counted `deferred`) → `whatsapp_outbox_claim(run_id, 120)` → markets concurrently, rows within a market sequentially spaced `1000 / send_rate_per_sec` ms → stop claiming at `deadline − 3 s`, release unsent claimed rows → per row: `assertSendAllowed` → resolve APPROVED template for `(event_key, language)`, fall back to market default language, else `skipped/no_template` → load order/lead fresh (cancelled/deleted for `could_not_reach` → `skipped/stale`) → render → `sendTemplate` → insert `whatsapp_messages(status='sent', wamid, outbox_id, actor_type)` → outbox `sent` + `message_id`; errors via the classification table, retry `next_attempt_at = min(30 s · 2^attempts, 30 min) + jitter` → finish run row (`partial` if any failed).
- Duplicate-send exposure: only when Graph succeeded and the write after it died; bounded by `attempts`. Accepted.
- Observability: `whatsapp_outbox_runs` + `whatsapp_outbox_cron_status()` (copy of `meta_ads_cron_status`) for the Connexions card.

## Agent surfaces (Phase 3, Phase 5)

**`POST /api/whatsapp/send`** body `{ target: {order_id}|{lead_id}|{conversation_id}, language, mode: 'template'|'text'|'image', template_id?, text?, image_url?, caption?, log_delivery_action? }`. Steps: authorize with the **user** client (RLS proves visibility; agents must be `assigned_to`; managers any in market) → `toWhatsAppE164(customer_phone ?? customer_phone_2)` → load config + upsert conversation → `assertSendAllowed` → 409 `{ error: 'opted_out'|'window_closed'|'undeliverable'|'config_inactive'|'invalid_phone' }` → persist language via `set_customer_whatsapp_language` if changed → render server-side (client never supplies variable values; image mode = free-form `type:image` inside the window, else the `product_share` template with header link) → Graph → insert message row `sent` + wamid, anchor `current_order_id`/`current_lead_id`, mirror `whatsapp_last_outbound_at`; on Graph error insert `failed` row and respond 502 `{ error:'graph_failed', code, kind }` → if `log_delivery_action` and target is an order, call `record_delivery_action('whatsapp_customer','whatsapp','sent', template_key)` with the user client (existing RPC, untouched; a failure here is logged, never undoes the send). 201 `{ data: message }`.

**Shared components `src/components/whatsapp/`**: `WhatsAppComposer` (the exact language segmented toggle from `WhatsAppSheet`, template chips filtered APPROVED + language + agent set, `previewParts` preview, free-text textarea enabled only while the window is open with a « Fenêtre ouverte jusqu'à HH:MM » chip, disabled states explaining opted_out/config_inactive, inline 409/502 errors), `MessageThread` (in/out bubbles, status glyphs ✓ / ✓✓ / read accent / failed critical with code, day separators, `dir` from message language; design per `docs/design-system.md`, status tones only), `StatusGlyph`. Hooks `useWhatsAppThread(orderId|leadId)` (SWR + `useRealtimeSubscribe({table:'whatsapp_messages', marketId, extraFilter:'order_id=eq.<id>'})` from `src/lib/realtime/bus.ts`, marks read via `POST /api/whatsapp/conversations/[id]/read`), `useWhatsAppTemplates(marketId)`, `useWhatsAppAvailability(marketId)`.

| Surface | Change |
|---|---|
| `OrderDetailPanel/CustomerHero.tsx` | Optional `onWhatsApp` + `whatsappState`; secondary outline WhatsApp button beside the `tel:` CTA; hidden when the market has no active config |
| `OrderDetailPanel/PanelTabs.tsx` + `index.tsx` | `PanelTab` gains `"messages"` with unread count; panel = `MessageThread` + `WhatsAppComposer` |
| `components/delivery/Sheets.tsx` `WhatsAppSheet` | Same frame; registry templates replace `TEMPLATE_KEYS`; the `<a href=wa.me>` becomes a send with `log_delivery_action: true`; `onSent` still fires for the optimistic UI, but `QueuedBody` gains `alreadyRecorded: true` so `useDeliveryActionQueue` does not POST the ledger row twice (undo becomes close). **No config → today's wa.me path, untouched** |
| `components/delivery/DeliveryDetail.tsx` | « Messages » section under the timeline (Phase 5) |
| `components/prospects/ProspectsView.tsx:104`, `ProspectDetail.tsx` | Composer with `{lead_id}` (templates `prospect_follow_up` + the campaign's; free text if a reply exists); « a répondu » chip from new row fields `wa_sent_at`/`wa_replied_at`; no config → wa.me |
| `components/queue/ProductSheetDrawer.tsx` | « Envoyer sur WhatsApp » → `mode:'image'` send with the cover URL |
| `useAgentNotifications` + bell row | kind `whatsapp_inbound` → « <client> a répondu sur WhatsApp », opens the panel on Messages |
| `/[locale]/(dashboard)/messages` (Phase 5) | Orphan conversations for the scope market: profile name, phone, last message, age, unread; drawer with thread + composer + « Rattacher à une commande / un prospect » (`whatsapp_claim_conversation` RPC back-fills `order_id`/`lead_id` on unattributed messages). Sidebar `Clients → Messages` with unread badge (managers + super_admin) |

i18n: new namespace `whatsapp` in `src/messages/fr.json` + `ar.json`, plus `orders.detail.tabMessages`, `nav.items.messages`, `settings.whatsapp.*`. Template TEXT stays in `catalogue.ts`.

## Settings UI

**Connexions › Services › WhatsApp** (Phase 1) — replace the placeholder card in `src/components/connections/ServicesPanel.tsx` with `WhatsAppSection.tsx`, one card per market like `MetaAdsSection`: status badge (Connecté / Non connecté / Jeton invalide / En pause), `verified_name · display_phone`, quality dot + tier, template counts, `last_webhook_at`, cron health. Form (super_admin; `readOnly` for managers): WABA ID, Phone number ID, App ID, App secret, Access token, Verify token (« Générer »), Graph version. Save → `POST /api/whatsapp/config` verifies with `getPhoneStatus()` **before** encrypting (pattern of `src/app/api/meta/accounts/route.ts`). « Tester » → staged `POST /api/whatsapp/config/[marketId]/test`: credentials → phone → waba (list templates) → app subscription (`subscribeApp`, auto-fix) → webhook (`last_webhook_at` within 7 days). Read-only block: callback URL, verify token (reveal on click), fields to subscribe. `OverviewPanel.tsx:181` reads real status.

**Modèles** — `/[locale]/(dashboard)/messages/templates` (managers + super_admin; Phase 2): table per market (name, language, category, status, event mapping select, variables, last sync); « Synchroniser depuis Meta »; « Créer les modèles Ordra » (`POST /api/whatsapp/templates/catalogue` creates every missing catalogue template in both languages, uploads the sample header image for `product_share` via the resumable upload API from `public/whatsapp/product-sample.jpg`, maps `event_key` immediately); row drawer with components JSON + rejection reason; `PATCH /api/whatsapp/templates/[id] { event_key }` (409 on the unique index).

**Paramètres › WhatsApp** (Phase 4) — new group in `src/components/settings/GeneralSettingsGroups.tsx`, `settings/general/WhatsAppSection.tsx`: master toggle, five event toggles with one-line descriptions, `OptionCards` default language, send window (same `"10-20"` validator as `wa_window`). Banners when the market has no active config and when a toggled event has no APPROVED template in a language.

## Campaigns with the `api` sender (Phase 6)

Verified: create and run are one act today — `POST /api/prospects/campaigns` inserts then immediately calls `rpc_run_prospect_campaign`, which spawns `leads` rows (`campaign_id`, `source_order_id`, idempotent). Membership = `leads.campaign_id`; composer = `src/components/prospects/console/CampaignSheet.tsx`.

1. **Composer** (only when `waSender === 'api'`): `wa_message` becomes a template body editor with variable chips `{name} {product} {city} {discount}`, warning when the body starts/ends with a variable, language ar|fr (one per campaign), optional header image (product image or public https URL), preview with the opt-out footer appended. `wa_rate` = messages per hour for the whole campaign.
2. **Create**: validate (≥ 1 non-variable token, ≤ 1 024 chars, ≤ 10 variables) → insert with `wa_launch_status='pending_template'` → `submitTemplate()` builds `ordra_camp_<slug>_<yymmdd>` MARKETING with HEADER IMAGE example handle, BODY with `example.body_text`, FOOTER opt-out → `whatsapp_templates(source='campaign', status='PENDING')`. **Does not call `rpc_run_prospect_campaign`.** Audience preview path unchanged.
3. **Approval**: webhook flips template + campaign to `ready`/`rejected`; « Modifier et resoumettre » creates `_v2`; « Vérifier le statut » syncs as fallback.
4. **Launch** `POST /api/prospects/campaigns/[id]/launch`: requires `ready` + APPROVED (409 otherwise) → `rpc_run_prospect_campaign` (as today) → `whatsapp_enqueue_campaign(p_campaign_id)`: per lead without an outbox row, `whatsapp_e164` null → `skipped/invalid_phone`; opted-out/undeliverable phone → `skipped/opted_out`; else `queued` with `not_before = whatsapp_campaign_slot(window, rate, i)` (row i at `window_start + i/rate` hours, rolling to the next day's window). Sets `launched`. Returns `{ inserted, queued, skipped_by_reason }`.
5. **Drain** renders from lead + campaign `offer` (`discount`), header `link = wa_image_url`; on sent writes one `lead_history` row (`actor_type='system'`, `note='whatsapp_campaign_sent'`) so `last_touch_at` moves; bucket stays `campaign`. 131049 → `skipped`, shown as « non livrable aujourd'hui ».
6. **Replies**: attribution prefers the campaign's open lead when the phone has no live order; `wa_call` follow-up « à appeler » when `wa_sent_at + wa_follow_up_hours < now` and no reply, implemented in `presentation.ts` as a situation label (`bucketOf` untouched, per `docs/prospects-worklist.md` §7).
7. **Console**: `CampaignCard` shows template status + queued/sent/delivered/read/replied/failed (one lateral aggregate added to `get_prospect_console`).

## Choke point and phone canonicalization

- `src/lib/markets.ts`: `MARKET_DIAL_CODE = { tn:'216', ly:'218' }`, `MARKET_NATIONAL_LENGTH = { tn:8, ly:9 }`.
- `toWhatsAppE164()` is the ONE builder. Phase 3 makes `toE164` (`src/lib/delivery/whatsapp-templates.ts`) and `toWhatsappNumber` (`src/lib/products/whatsapp.ts`) one-line wrappers (their tests prove equivalence); Phase 7 deletes them. `toLibyanE164` in `src/lib/carriers/phone.ts` stays: it is a Darb contract with a `+`.
- `gate.ts` order: `config_inactive` → `invalid_phone` → `opted_out` (conversation ?? customer) → `undeliverable` → `window_closed` (non-template only) → `deferred` (`not_before > now`). Both `send.ts` and `outbox.ts` call it immediately before any `client.send*`. Make it structural: `no-restricted-imports` on `@/lib/whatsapp/client` outside `src/lib/whatsapp/**` and the config test route (note: `npm run lint` currently lints nothing; add the rule anyway and rely on review until ESLint is configured).
- SQL side: the trigger checks opt-out on `customers`; `whatsapp_enqueue_campaign` checks conversations by phone; the drain re-checks in TS, so an opt-out arriving between enqueue and send is honoured.

## Meta-side checklist for the owner (per market, twice)

1. Business Portfolio → **business verification** (start day 1; gates the 1K tier).
2. Meta App (Business type) with the WhatsApp product. One app can serve both portfolios; two apps only if administratively required. Note App ID + App secret.
3. WhatsApp Manager → add the new number (must not be on any WhatsApp app), display name (reviewed), profile.
4. **Payment method** on the WABA.
5. Admin **System User** → assign app + WABA → permanent token with `whatsapp_business_messaging` + `whatsapp_business_management`. Note WABA ID, Phone number ID.
6. App → WhatsApp → Configuration → webhook callback `https://<app>/api/webhooks/whatsapp`, verify token from the Connexions card, subscribe `messages`, `message_template_status_update`, `phone_number_quality_update`, `account_update`. The Connexions test subscribes the app to the WABA.
7. Two-step verification PIN on the number (the test reports `not_registered`).
8. Ordra: enter credentials → test → « Créer les modèles Ordra » → wait for approvals → Paramètres: default language, enable ONE event.

**Warm-up** (unverified cap 250 unique recipients / 24 h per portfolio): week 1 one market, `shipped` only; week 2 add `out_for_delivery`, then `could_not_reach` (highest block risk: wrong numbers); week 3 `last_chance`, `delivered`, agent 1:1 on /delivery; campaigns only after verification (tier ≥ 1K) and a GREEN week, first campaign ≤ 200 recipients, `wa_rate` ≤ 60/h inside 10–20 local. The card shows `messaging_limit_tier` moving.

## Phase 0 — HTML prototypes, before any code (owner's gate)

> **Status 2026-09-25 (evening): Phases 1–6 are implemented** from the two prototypes
> (`prototypes/whatsapp-agent-v1.html`, `prototypes/whatsapp-manager-v1.html`), with
> failing-first tests at every layer and six migrations applied to the LOCAL database
> only. Nothing is committed and nothing is pushed to the Supabase project or Vercel.
> Phase 7 (deleting the wa.me helpers, the RLS test under real JWTs on all tables) waits
> for the rollout; the reference doc is `docs/whatsapp-cloud-api.md`.
>
> | Phase | Landed | Proof |
> |---|---|---|
> | 1 Foundations | `20260925100000_whatsapp_core.sql`, `src/lib/whatsapp/*`, `/api/whatsapp/config*`, Connexions card | `supabase/tests/whatsapp_core_test.sql`, 183 vitest |
> | 2 Webhook + Modèles | `/api/webhooks/whatsapp`, `webhook/{parse,verify,handle}`, `templates.ts`, `/messages/templates` | handle/parse/route tests, `TemplatesTable.test` |
> | 3 Agent sends | `send.ts`, `gate.ts`, composer + thread, panel Messages tab, /delivery live sheet, product share, prospect sheet, bell kind | `gate/send` tests, component tests |
> | 4 Lifecycle | `20260925130000_whatsapp_outbox.sql` (trigger, outbox, cron `whatsapp-outbox-1min`), `outbox.ts`, Paramètres › WhatsApp | `whatsapp_lifecycle_trigger_test.sql`, `outbox.test` |
> | 5 Inbox | `20260925140000_whatsapp_inbox.sql`, `/messages`, sidebar badge, /delivery Messages section | `whatsapp_inbox_test.sql`, drawer/list tests |
> | 6 Campaigns | `20260925150000_whatsapp_campaigns.sql`, api-sender branch, launch/resubmit/status routes, card funnel, « a répondu » | route + card + sheet tests |

Nothing under `src/` or `supabase/` changes until the owner has reviewed both prototypes and the decisions they surface are written into this plan. Static files, no build, in the repo's prototype convention (`prototypes/suivi-livraison-v4.html`, `prototypes/manager-console-v1.html`, `prototypes/agent-shell-v1.html`): a header comment stating what is shown and why, a studio bar with segmented controls, URL presets, tokens copied from `docs/design-system.md` and the live components (never invented), fake data inline, the studio LTR and only the stage mirrored for Arabic (RTL screenshot trap: headless Chrome clamps to ~500 px, keep the page LTR).

### `prototypes/whatsapp-agent-v1.html` — what an agent sees

Built inside the agent shell of `agent-shell-v1.html` (same tokens, same 14 tones, same font pair Inter/Cairo). The order panel is **not redesigned** (2026-09-18 decision); the Messages tab and the WhatsApp button are additions to the existing composition. Atoms copied from: `OrderDetailPanel/CustomerHero.tsx` (name 22 px, phone 15 px tabular, brand call CTA 40 px), `PanelTabs.tsx` (42 px underline tabs with count pill), `delivery/Sheets.tsx` `WhatsAppSheet` (language pill toggle, template chips, highlighted variables, 52 px send button), `delivery/ui.tsx` tones, `ProspectRow.tsx`, `ProductSheetDrawer.tsx`.

Screens (`?screen=`):
1. `panel` — queue with the order panel open on the **Messages** tab: thread (in/out bubbles, day separators, status ticks ✓ ✓✓ read-accent, a failed row with its code), the composer below with language toggle, template chips filtered to the agent set, rendered preview with highlighted variables, free-text area with the « Fenêtre ouverte jusqu'à HH:MM » chip. The hero shows the new outline WhatsApp button beside « Appeler ».
2. `panel-closed` — same panel, window closed: textarea disabled with the reason, templates only.
3. `delivery` — `/delivery` with the WhatsApp sheet open, sending for real: template picked by `suggestTemplate`, send button with spinner → « Envoyé ✓ », then the action row in the timeline carrying the delivery status.
4. `prospects` — the prospects worklist: the row's WhatsApp slot opens the composer with `prospect_follow_up` + the campaign template; a row with the « a répondu » chip.
5. `product` — the product sheet drawer with « Envoyer sur WhatsApp » as a real send (image + caption preview).

States (`?state=`): `normal`, `optedout` (composer disabled with « Ce client a demandé à ne plus recevoir de messages »), `noconfig` (market not connected: button hidden in the hero, `/delivery` sheet falls back to today's wa.me link, stated in the header), `failed` (502 inline error with Graph code), `unread` (bell with « <client> a répondu sur WhatsApp », tab count pill). Also `?lang=fr|ar`, `?view=desktop|mobile`, `?open=<id>`.

### `prototypes/whatsapp-manager-v1.html` — what a manager or super_admin sees

Built on the light console of `manager-console-v1.html` (dark sidebar, 1360×900 frame, `.card`, `.tabs`, `table.t`, `.btn`). Atoms copied from `connections/ServicesPanel.tsx` and `settings/MetaAdsSection.tsx` (per-market cards, masked credentials, staged test), `settings/GeneralSettingsGroups.tsx` (`SettingToggle`, `OptionCards`), `prospects/console/CampaignSheet.tsx` (the three steps audience · channel · dist, the `wa_sender` radio, window and rate fields).

Screens (`?screen=`):
1. `connexions` — Système › Connexions › Services with the WhatsApp card per market: status badge, verified name · number, quality dot + tier, template counts, last webhook, cron health; the credential form (super_admin) and the read-only callback URL / verify token / fields-to-subscribe block; the staged « Tester » result (credentials → numéro → WABA → abonnement → webhook) with one stage in warning.
2. `modeles` — Modèles: table per market (name, language, category, status badge, event mapping select, variables, last sync), « Synchroniser depuis Meta », « Créer les modèles Ordra », a row drawer with the components JSON and a rejection reason.
3. `parametres` — Paramètres › WhatsApp: master toggle, the five event toggles with one-line descriptions, default language option cards, send window, and the two banners (no config / toggled event without approved template).
4. `messages` — Clients › Messages: orphan conversations list (profile name, phone, last message, age, unread), the drawer with thread + composer + « Rattacher à une commande / un prospect » search.
5. `campagne` — the campaign sheet in `api` mode: body editor with variable chips `{nom} {produit} {ville} {remise}`, the first/last-token warning, language, header image picker, the preview with the opt-out footer, the submit → « En attente d'approbation Meta » state, the `CampaignCard` with template status and queued/sent/delivered/read/replied/failed counts, and the « Lancer » button enabled only on APPROVED.

States: `?lang=fr|ar`, `?role=super_admin|manager` (manager sees Connexions read-only, no credential form), `?tstatus=pending|approved|rejected` on `campagne`.

### Review gate

The owner opens both files, and each remark becomes either a change to the prototype (new `-v2` file, never overwrite) or a line in « Decisions I made as the expert » above. The prototype of a screen is the source of truth for its React phase: Phase 3 builds from `whatsapp-agent`, Phases 1/2/4/5/6 from `whatsapp-manager`. Prototype paths are recorded in `docs/whatsapp-cloud-api.md` when it is written.

## Phases (each shippable, TDD: failing tests first)

Migration timestamps are placeholders in the repo's format.

**Phase 1 — Foundations: schema, credentials, client, Connexions card.** Owner can connect each market and test it; nothing is sent.
Files: `supabase/migrations/…_whatsapp_core.sql` (configs, templates, conversations, messages, customers columns, `whatsapp_e164`, `whatsapp_setting_bool/text`, `set_customer_whatsapp_language`, guard, RLS); `src/lib/markets.ts`; `src/lib/whatsapp/{http,config,client,errors,phone,optout,window,render,catalogue}.ts`; `src/app/api/whatsapp/config/{route,[marketId]/route,[marketId]/test/route}.ts`; `src/components/connections/WhatsAppSection.tsx`; edits `ServicesPanel.tsx`, `OverviewPanel.tsx`, `/api/connections/overview`.
Failing tests: `phone.test.ts` (TN/LY, `+`, `00`, trunk zero, short reject, LY non-9 reject); `optout.test.ts` (each keyword, diacritics, "stop it please" is NOT opt-out); `errors.test.ts`; `client.test.ts` (fetch mocked: Bearer header, no token in URL, template payload incl. header image, redaction, 15 s abort, two-step upload); `render.test.ts`; `config.test.ts`; three config route tests (agent/manager POST 403, verify-before-store, mask on GET, staged test) with `makeGetActor()` from `src/test/helpers/actorMock.ts`; `WhatsAppSection.test.tsx`; SQL `supabase/tests/whatsapp_core_test.sql` (guard forward-only, `whatsapp_e164`, RPC grants).

**Phase 2 — Webhook + Modèles.** Meta can verify and deliver; statuses, inbound, opt-outs and template statuses land; owner creates the catalogue and maps events.
Files: `src/lib/whatsapp/webhook/{parse,verify,handle}.ts`, `templates.ts`; `src/app/api/webhooks/whatsapp/route.ts`; `src/app/api/whatsapp/templates/{route,sync/route,catalogue/route,[id]/route}.ts`; `/[locale]/(dashboard)/messages/templates/page.tsx`, `src/components/whatsapp/TemplatesTable.tsx`.
Failing tests: `parse.test.ts` (fixtures for every event type, mixed entries, unknown field); `verify.test.ts`; `handle.test.ts` with an in-memory admin double in `src/test/helpers/whatsappDb.ts` (out-of-order statuses, failed after read, duplicate wamid, conversation + customer link, attribution order/lead/orphan, opt-out sets both columns and skips queued rows, notification only when assigned, template status flips campaign, unknown wamid single retry); `route.test.ts` (GET 200/403, POST 401 bad signature, 200 unknown source, 200 on handler throw, log rows); `templates.test.ts`; templates route tests; `TemplatesTable.test.tsx`.

**Phase 3 — Agent 1:1 sends + Messages tab.** `/delivery` and the order panel send real messages; language stored; inbound appears live; bell rings.
Files: migration (publication add, `agent_notifications` kind, `resolve_stale_notifications` skip, `whatsapp_mark_conversation_read`); `src/lib/whatsapp/{gate,send}.ts`; `src/app/api/whatsapp/{send,threads/order/[orderId],threads/lead/[leadId],conversations/[id]/read}/route.ts`; `src/components/whatsapp/{WhatsAppComposer,MessageThread,StatusGlyph}.tsx`; hooks; edits to `CustomerHero.tsx`, `PanelTabs.tsx`, `OrderDetailPanel/index.tsx`, `delivery/Sheets.tsx`, `useDeliveryActionQueue.ts`, `ProductSheetDrawer.tsx`, `ProspectsView.tsx`, `ProspectDetail.tsx`, `useAgentNotifications.ts`, wrappers in `whatsapp-templates.ts` / `products/whatsapp.ts`, i18n.
Failing tests: `gate.test.ts` (refusal priority; template allowed with closed window; text refused); `send.test.ts` (non-owner agent 403 before any Graph call; language persisted only when changed; Graph failure → `failed` row + 502; `log_delivery_action` calls `record_delivery_action` with the right args; image mode picks free-form vs template by window); route tests; `WhatsAppComposer.test.tsx`; `MessageThread.test.tsx`; `useWhatsAppThread.test.tsx`; updated `CustomerHero.test.tsx`, `OrderDetailPanel` tests, `Sheets` tests (send instead of anchor, wa.me fallback without config), `useDeliveryActionQueue.test.tsx` (`alreadyRecorded` never POSTs).

**Phase 4 — Lifecycle automation: outbox, trigger, drain, Paramètres.**
Files: migration (outbox, runs, `whatsapp_outbox_claim`, `whatsapp_next_send_slot`, trigger, `invoke_whatsapp_outbox`, cron schedule, `whatsapp_outbox_cron_status`); `src/lib/whatsapp/{outbox,backoff}.ts`; `src/lib/cron/auth.ts`; `src/app/api/cron/whatsapp-outbox/route.ts`; `vercel.json` functions entry; `src/types/settings.ts`; `settings/general/WhatsAppSection.tsx`; `GeneralSettingsGroups.tsx`; Connexions card health line; `docs/notifications-cron.md`.
Failing tests: `backoff.test.ts`; `outbox.test.ts` (lock lost, reaper, pacing, deadline release, each classification outcome, auth failure pauses market, no template → skipped, stale order → skipped, language fallback, `message_id` link); cron route (401/200); settings validation; `WhatsAppSection.test.tsx` banners. SQL `whatsapp_lifecycle_trigger_test.sql`: no config → no row; master off; each (status × market) → expected event; toggle off; opted-out; invalid phone; same event twice → one row; helper failure → order update still succeeds with WARNING; Darb-style `carrier_status_slug` update → trigger not fired.

**Phase 5 — Orphan inbox and /delivery thread.**
Files: migration (`whatsapp_claim_conversation`, unread count RPC); `/[locale]/(dashboard)/messages/page.tsx`; `src/components/whatsapp/{ConversationsList,ConversationDrawer,ClaimSearch}.tsx`; `src/app/api/whatsapp/conversations/{route,[id]/claim/route}.ts`; `useOrphanConversations`; `Sidebar.tsx` entry + badge; `DeliveryDetail.tsx` section.
Failing tests: list scoping (manager own market, super_admin needs `market_id`, agent 403); claim (409 when anchored, back-fill count); components; Sidebar badge; SQL role guard.

**Phase 6 — Campaigns with the API sender.**
Files: migration (`prospect_campaigns` columns, `whatsapp_enqueue_campaign`, `whatsapp_campaign_slot`, console aggregates, worklist `wa_sent_at`/`wa_replied_at`); `src/lib/whatsapp/campaign-template.ts`; `templates.ts` `submitTemplate`; `outbox.ts` campaign branch; `src/app/api/prospects/campaigns/route.ts` (branch on `wa_sender='api'`), `[id]/launch/route.ts`, `[id]/resubmit/route.ts`; `CampaignSheet.tsx`, `CampaignCard.tsx`, `ConsoleClient.tsx`; `presentation.ts`.
Failing tests: `campaign-template.test.ts` (variable numbering by first appearance, first/last-token rule, footer, image example, caps); campaigns route (api sender does NOT run the campaign; agent/call senders unchanged — existing tests keep passing); launch route (409 unless APPROVED; counts); outbox campaign cases (slot pacing across days, marketing cap skip, history touch); webhook attribution to lead; console/worklist fields; `CampaignSheet.test.tsx`.

**Phase 7 — Consolidation and rollout.** Delete `buildWaLink`/`toE164`, `buildWhatsappUrl`/`toWhatsappNumber`, the `ProspectsView` wa.me, and the five texts in `whatsapp-templates.ts` (keep `suggestTemplate`, mapped to event keys). Write `docs/whatsapp-cloud-api.md` (contract, tables, error table, runbook), update `docs/notifications-cron.md`, `docs/database-schema.md`, `docs/delivery-worklist.md`, CLAUDE.md reference line. `supabase/tests/whatsapp_rls_test.sql` proving agent/manager isolation on all five tables under real JWTs (pattern of `stock_actor_and_rls_test.sql`). Execute the warm-up.

## Verification

- **Unit**: every `src/lib/whatsapp/*.ts` has a sibling test; Graph calls only through `vi.stubGlobal('fetch', …)`; DB behaviour through the in-memory double in `src/test/helpers/whatsappDb.ts` (helpers never in production code). `npm run test:run` and `npm run typecheck` after each phase.
- **Routes**: one `route.test.ts` per route mocking `@/lib/supabase/server` and `@/lib/auth/actor`; webhook tests compute the signature with `createHmac` in the test.
- **Webhook locally** (dev server, config row for the market with the same app secret):
  ```bash
  BODY='{"object":"whatsapp_business_account","entry":[{"id":"<WABA_ID>","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"21612345678","phone_number_id":"<PHONE_NUMBER_ID>"},"contacts":[{"profile":{"name":"Test"},"wa_id":"21698765432"}],"messages":[{"from":"21698765432","id":"wamid.TEST1","timestamp":"1758700000","type":"text","text":{"body":"STOP"}}]}}]}]}'
  SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$APP_SECRET" | sed 's/^.* //')
  curl -i -X POST http://localhost:3000/api/webhooks/whatsapp -H 'Content-Type: application/json' -H "X-Hub-Signature-256: sha256=$SIG" --data-binary "$BODY"
  curl -i "http://localhost:3000/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=$VERIFY_TOKEN&hub.challenge=12345"
  ```
  Expect 200, a conversation with `opted_out_at`, a message row, a `webhook_delivery_log` row `source='whatsapp'`. Then post a `statuses` payload for an inserted wamid and watch `delivered_at` fill and a later `sent` be ignored.
- **Trigger on a Supabase branch** (branches do not rebuild from migrations; hand-apply Phase 1 + 4 SQL): insert a dummy config for LY, set `whatsapp_lifecycle_enabled` + `whatsapp_event_shipped` to `{"value": true}`, `UPDATE orders SET status='at_carrier'` on a scanned LY order → one `lifecycle:<id>:shipped` outbox row; repeat → still one; update only `carrier_status_slug` → no row. Same assertions in `supabase/tests/whatsapp_lifecycle_trigger_test.sql` via `supabase/tests/run.sh`.
- **Drain**: `curl -X POST localhost:3000/api/cron/whatsapp-outbox -H "x-cron-secret: $CRON_SECRET"` with `WHATSAPP_GRAPH_BASE_URL` pointed at a local stub returning 200, then 429, then 190; assert row states and config status. In production: `SELECT * FROM whatsapp_outbox_runs ORDER BY started_at DESC LIMIT 5`, then `net._http_response` as `docs/notifications-cron.md` prescribes.
- **RLS**: run `whatsapp_rls_test.sql` under real JWTs (agent sees only assigned threads; manager only own market; credentials unreadable by any authenticated role).
- **Rollout**: Phase 0 prototypes reviewed by the owner → Phase 1 → Meta checklist 1–7 → Phase 2 → catalogue creation → Phase 3 to the TN team on /delivery for a week → Phase 4 `shipped` only on TN → LY → remaining events per warm-up → Phase 5 → Phase 6 after verification / tier 1K → Phase 7.

## Critical files to read before each phase

- `src/lib/meta-ads/client.ts` — Graph transport, error class, redaction to mirror
- `src/app/api/meta/accounts/route.ts` + `[id]/test/route.ts` — verify-before-store, mask, staged test
- `supabase/migrations/20260909223808_orders_broadcast.sql` — exception-safe SECURITY DEFINER order trigger
- `supabase/migrations/20260914143715_leads_winback_read_courier_remark.sql` — order trigger reading a settings toggle
- `supabase/migrations/20260913152417_customers.sql` — customers table, write model, RLS
- `supabase/migrations/20260814231049_pg_cron_meta_ads_sync.sql` + `src/app/api/cron/meta-ads-sync/route.ts` — cron invocation and route auth
- `src/lib/orders/webhook-handler.ts` + `src/lib/webhook-validation.ts` — inbound webhook pattern, HMAC helper
- `src/components/delivery/Sheets.tsx` (WhatsAppSheet) + `src/hooks/useDeliveryActionQueue.ts` — first surface swapped, ledger contract
- `src/components/queue/OrderDetailPanel/{CustomerHero,PanelTabs,index}.tsx` — panel integration points
- `src/app/api/prospects/campaigns/route.ts` + `src/components/prospects/console/CampaignSheet.tsx` — where create+run split for the api sender
- `src/lib/realtime/bus.ts` — subscription pattern for the thread
- `src/types/settings.ts`, `src/components/settings/GeneralSettingsGroups.tsx` — settings keys and UI groups
