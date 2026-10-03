# Voix du client — « صوت العميل »

Plan written 2026-09-30, corrected 2026-10-01: rejection dates now come from `order_history`.
Status: **built on 2026-10-02** in the worktree `feat/voix-du-client`. It follows the approved
agent-v2 and manager-v6 prototypes; reference: docs/customer-voice.md.
- Migrations are NOT applied to prod yet. Insights (phase 4) and the topics settings screen
  were left out because neither approved prototype shows them.
- Earlier status: **Phase 0.**
- On 2026-10-01 the agent prototype v1 was approved, then reopened the same day to cover
  every moment the customer's voice reaches us, with 3 categories.
- On 2026-10-02 manager v3 was rejected and redesigned from scratch as v4.
- **Agent v2** and **manager v4** are awaiting review.
- Manager v1 was rejected, v2 was superseded, and v3 was rejected.
No code yet.

## Context

The confirmation team hears complaints, product feedback, price objections and requests
on every call, and the plan was to track them in a separate Google Sheet. The owner wants
them in Ordra instead:
- a fast, modern sheet, linked to the product and the customer;
- a screen where a manager or super_admin reads the insights at a glance.

What the live DB showed (Libya, 2026-09-30; Tunisia has had no order since 2026-07-07,
so this is designed **Arabic / RTL first**):

- **Nothing exists yet.** There is no table, route, component or worktree for it.
- **Agents already capture customer voice, but in the wrong places.**
  - *In rejection notes filed under « Autre »:* 694 of all 2 584 Libyan rejections, from
    2026-05-20 to 2026-09-30. Most of them are not insights:

    | What the « Autre » note holds | Count | Share |
    |---|---|---|
    | A rejection that already has a sub-reason (« لم أطلب », wrong number, duplicate) | 326 | 47 % |
    | « الغي الطلب » with no reason given | 125 | 18 % |
    | Unclassifiable | 63 | 9 % |
    | « Will order later » / « just asking the price » | 32 | 5 % |
    | **Real insight** | **148** | **~21 %** |

    **The recent window is the same shape.** From 19 to 30 Sept, dated by the rejection's own
    `order_history` row: 456 rejections, 141 of them « Autre » (31 %), and 36 real insights.

    **Date every rejection by its `order_history` row (`status_to = 'rejected'`), never by
    `orders.updated_at`.** Every Libyan rejected order has `updated_at ≥ 2026-09-19` because of
    a bulk touch, so a filter on it silently returns all-time totals. This first draft of the
    plan made exactly that mistake; the manager prototype caught it. It matters for
    `get_feedback_insights` and for the import.

    The 148 real insights break down like this:
    - payment: 65 in total — 42 « لا يملك المبلغ الآن » (no money now / waiting for salary),
      23 « wants card / transfer / Mobi Cash »;
    - price: 48 in total — 26 « too expensive », 22 « bought elsewhere, cheaper »;
    - product fit: 27 — Hafs or Qalun edition, regular mushaf, medium size, with gloves,
      with the reading pen, thought it was electronic;
    - delivery: 8.
  - *In `orders.customer_note`:* « دفع نقدياً » ×341, « لا يرد » ×207, « مقفل » ×72. That field
    is sent to the carrier and printed on the parcel label.
  - *Confirmed orders have nowhere to put feedback at all.* The confirm, no-answer and
    callback outcomes take no free text.
- **Capture discipline varies wildly.** Of the 148 insight notes, tasnim wrote 105, hend 18,
  roqaya 15 and mouna 8. Salima — 1 919 actions in 30 days, the second-highest volume —
  wrote **0**.

## Decisions

Owner's decisions (2026-09-30):
1. **Complaints are tracked to resolution.** A réclamation moves Ouverte → En cours → Résolue
   and carries an owner and a resolution note. Every other type is log-only.
2. **Capture is a keyboard shortcut.**
   - Pressed with an order panel open, the entry auto-links that order, its customer and its
     product.
   - Pressed with no order open, the agent searches for a customer or order and a product,
     with suggestions as they type.
3. **Rejections are imported, not displayed** (revised 2026-10-01).
   - Old « Autre » notes that carry an insight are imported as feedback.
   - From now on, rejecting with « Autre » offers to save the note as feedback.
   - Structured rejection reasons are **not** shown on this page; they stay in the existing
     reports.
4. **AI is phase 2.** Tagging and a weekly digest come once real entries exist.

Owner's decisions on the manager side (2026-10-01). The v1 statistics dashboard was rejected:
« clear, not dense, well-structured, an organised sheet — mostly to take insights and
feedback; don't make it all about rejection ».
5. **A grouped sheet with saved views.**
   - One table, grouped by product by default (or type / topic / agent / none).
   - The customer's words are the main column.
   - Each group shows 5 rows, then « voir plus ».
6. **Insights are made from feedback.**
   - The manager selects feedback rows and creates an insight: a title, a note, a status
     (À étudier / En cours / Fait / Écarté) and an owner.
   - The linked rows are the insight's evidence.
   - New feedback on the same topic is offered as « nouveaux, non liés », to link in one
     click.
7. **Three plain numbers on top:** new this week, open complaints, and to read. No charts; the
   only visual summary is a thin type-mix bar in each group header.
8. **No rejection data on the page** (see 3).

Owner's decisions on when the voice reaches us (2026-10-01, round 3). This was brainstormed
on live Libya data from the last 90 days:
- 2 557 orders: 1 552 rejected at the call, 429 delivered, ~22 returned;
- 1 551 parcels carry Darb courier remarks, 35 of which hold a real opinion;
- nothing at all is recorded after delivery, and WhatsApp has 0 messages.

The decisions:
9. **Four moments**, all in scope: the confirmation call · waiting / on the road · at the door /
   return · after delivery.
10. **The moment is derived automatically** from the order's status at capture time; the agent
    never taps it.
    - pending → call;
    - confirmed … out_for_delivery / delivery_delayed → transit;
    - returning / returned / cancelled after shipping → door;
    - delivered → after.
11. **Customers only reach us by calling the agent back.** There is no page, no Messenger and no
    WhatsApp, and there is **no outreach after delivery**. « After delivery » is captured when
    the customer calls back: F, then search by the caller's phone, and picking the order sets
    the moment.
12. **The same confirmation agents follow delivery** in the Livraison tab.
13. **Three categories, by intent, each with a short descriptor shown under its chip:**
    - **Réclamation** · « un souci à régler » (something to fix);
    - **Objection** · « pourquoi il hésite ou refuse » (why they hesitate or refuse);
    - **Suggestion** · « ce qu'il aimerait ou apprécie » (what they'd like or enjoy).
    An **optional topic** sits under each category; the manager can edit topics.
14. **Courier remarks become suggestions that the MANAGER confirms.**
    - Only remarks that carry an opinion are suggested (classes `wrong_item`,
      `payment_method`, `no_cash`, `refused`).
    - Plain logistics remarks (« لا يرد », « غدا يستلم ») are never suggested.
15. **In the Livraison tab,** the outcomes « Veut annuler » and « Retour confirmé » offer to
    capture why. It is a toggle, on by default, using the approved « Autre » rejection pattern;
    the action's note becomes the customer's words.

Decisions I made as the expert (the prototype makes each of them reviewable):
- **Name.** « Voix du client » / « صوت العميل ». The route is `/feedback`; the tables are
  `customer_feedback` and `feedback_topics`.
- **The shortcut is F.**
  - It fires outside text fields only, like the panel's existing `p` and `e`.
  - It matches `e.code === "KeyF"`, not `e.key`, so it also works on the Arabic layout
    (where that key types « ب »). The existing `p` and `e` shortcuts check `e.key` and
    silently fail on an Arabic keyboard (side finding 3).
  - A visible button carries the same action for phones and mouse users.
- **Import only the 148 rows that carry an insight,** each with a suggested category and topic,
  into the manager's « À vérifier » view, next to the courier suggestions, for a manager to
  confirm in one tap. The view disappears from the rail once it is empty. Importing all 694
  would bury the insights under « لم أطلب ».
- **Two levels: 3 fixed CATEGORIES** (an enum that drives colour, the complaint lifecycle and
  grouping) and **TOPICS** under each, with full CRUD per market in Paramètres. The seed
  topics come from the real notes and courier remarks (below).
- **One shared « lu » (read) state per market.** When a manager opens a row, it is read for
  the whole team; « À lire » is the queue of what nobody has opened yet. Per-user read state
  would make two managers read everything twice.
- **Links, not copies, between insights and feedback** (many-to-many). A row can support more
  than one insight, and an insight's evidence count always stays true.
- **Everyone in the market can read the market's feedback.**
  - This lets the capture window show « 2 retours précédents · 1 réclamation ouverte » for the
    customer on the line.
  - The agent tab still defaults to « Mes retours ».
  - Warehouse agents and investors have no access.
- **The order panel is not redesigned.** It gains one hook call to register its order as
  context, one icon button in its header, and « F » in its footer hint line.

## Taxonomy (seed — managers edit topics in Système › Paramètres)

| Category (fixed) · descriptor | Hue | Lifecycle | Seed topics (key · fr / ar) |
|---|---|---|---|
| `reclamation` Réclamation · شكوى — « un souci à régler » · مشكلة نحلّها | red | **yes** | `nonconform` Non conforme à la commande / غير مطابق للطلب · `damaged` Abîmé ou incomplet / تالف أو ناقص · `never` Jamais reçu / لم يصل · `slow` Trop long / تأخر كثيراً · `calls` Appels répétés / إزعاج بالاتصال · `conduct` Mauvais accueil / سوء تعامل |
| `objection` Objection · اعتراض — « pourquoi il hésite ou refuse » · لماذا يتردد أو يرفض | amber | no | `expensive` Trop cher / السعر غالي · `nocash` Pas de cash maintenant / لا يملك المبلغ الآن · `card` Veut payer par carte ou virement / يريد الدفع بالبطاقة أو التحويل · `expect` Croyait autre chose / كان يظنه شيئاً آخر · `elsewhere` Acheté ailleurs / اشترى من مكان آخر · `delivery` Livraison (délai, ville) / التوصيل (المدة، المدينة) |
| `suggestion` Suggestion · اقتراح — « ce qu'il aimerait ou apprécie » · ما يتمنّاه أو يعجبه | green | no | `version` Autre version ou produit / نسخة أو منتج آخر · `likes_product` Aime le produit / أعجبه المنتج · `likes_service` Aime le service / أعجبته الخدمة · `again` Va racheter / سيطلب مجدداً |

**Moments** (derived, never typed): `call` Appel de confirmation · مكالمة التأكيد ·
`transit` En attente · en route · في الانتظار · في الطريق · `door` À la porte · retour · عند الباب · مرتجع ·
`after` Après livraison · بعد التسليم.

**How courier remark classes map to suggestions:**
- `wrong_item` → Réclamation · Non conforme;
- `payment_method` → Objection · Carte ou virement;
- `no_cash` → Objection · Pas de cash;
- `refused` → Objection, with topic « Croyait autre chose » when the remark says « لم تعجبه ».

## Phase 0 — prototypes (GATE: nothing under src/ or supabase/ until reviewed)

- `prototypes/voix-du-client-agent-v2.html` — **current, awaiting review.** Built 2026-10-01
  from the moments brainstorm:
  - `?screen=call` — F during the confirmation call: 3 category cards (keys 1–3) with their
    descriptors, an optional topic, and the moment chip (« Appel de confirmation · auto »).
  - `?screen=callback` — **the customer calls back**: F with no order open, then search by
    the caller's phone. Each order is listed with its moment, and picking a delivered order
    sets « Après livraison ».
  - `?screen=delivery` — the Livraison tab with each parcel's real Darb remark. Logging
    « Veut annuler » offers to capture why: the courier remark as context, a suggested
    category, the note becoming the customer's words, and the moment « En route ».
  - `?screen=reject` — « Autre » rejection with the 3 categories (« بطاقة » → Objection ·
    carte).
  - `?screen=mine` — « Mes retours », filtered by category and by moment.
  - `?view=mobile` — the category cards stack as a list in the bottom sheet.
- `prototypes/voix-du-client-agent-v1.html` — approved 2026-10-01, then superseded by v2:
  - `?screen=queue` — the queue with the EXISTING order panel. Pressing F opens the capture
    window: context chip (order · customer · product), the customer's previous entries,
    7 type chips (keys 1–7), topic chips, « Ce que le client a dit », and Ctrl/⌘+Enter to save.
  - `?screen=blank` — the capture window with no order open: search for a customer or order,
    then a product, with suggestions.
  - `?screen=mine` — the agent tab « صوت العميل », their own entries as a sheet.
  - `?screen=reject` — the reject flow with « Autre » and its offer to save as feedback.
  - `?view=mobile` — the capture window as a bottom sheet.
  **Approved 2026-10-01.**
- `prototypes/voix-du-client-manager-v1.html` — the statistics dashboard. **Rejected
  2026-10-01**; kept as history.
- `prototypes/voix-du-client-manager-v4.html` — **current, awaiting review.** A full
  redesign built 2026-10-02, after the owner rejected v3 as « pas clair, pas de mots qui
  expliquent, pas de structure claire ».
  - **One navigation system:** 5 tabs, each with a sentence saying what it is for.
    - Vue d'ensemble.
    - Tous les retours.
    - Réclamations.
    - Insights.
    - À vérifier — shown only while it has items.
    There is no views rail, no chips and no « Grouper ».
  - **Vue d'ensemble** reads top to bottom:
    - **À faire** — 3 cards, each a sentence and a button;
    - **Ce que disent les clients** — the 3 categories, each with its definition, its most
      frequent topics and a real quote;
    - **Où les clients nous parlent** — the 4 moments, each explained;
    - **Ce que nous en avons appris** — insights, with their evidence written out;
    - **Les derniers retours**.
    Every item drills into the filtered list.
  - **Rows read as sentences:** category, the customer's words, then « Pas de cash
    maintenant — dit à tasnim pendant l'appel de confirmation ». The list is grouped by
    date, and the secondary filters sit behind « Plus de filtres ».
  - **Réclamations** come in the order of the work: À traiter → En cours → Résolues. Each
    row says how long it has waited and who owns it.
  - **À vérifier** opens with a box explaining where the phrases come from. Each row offers
    Garder · Corriger · Ignorer.
  - The drawers use plain headings: « Ce que le client a dit », « Classement », « Contexte »,
    « Suivi de la réclamation », « Insights ».
  - It defaults to French, because super_admin always gets fr; the Libya manager sees
    Arabic.
- `prototypes/voix-du-client-manager-v3.html` — rejected 2026-10-02, kept as history. It was
  v2's workspace with:
  - the 3 categories (chips with descriptors, plus a « Catégories » block in the rail);
  - the moment on every row, as a filter and as « Grouper : Moment »;
  - courier entries badged « Livreur »;
  - « À vérifier » now holds the courier suggestions (35 real remarks) next to the import
    backlog, and the category can be changed in the panel before « Garder »;
  - insight cards that show which moments their evidence comes from;
  - a new insight built from real courier data: « Le sac de frappe ne ressemble pas à la pub »
    — 14 of the 16 « pas conforme » remarks are about the boxing bag.
- `prototypes/voix-du-client-manager-v2.html` — superseded by v3 (same structure), the
  feedback workspace:
  - `?view=all` — the grouped sheet:
    - the 3 numbers;
    - the views rail (Tous · À lire · Réclamations · Insights · Importés) and a Produits list;
    - search, topic / agent / period filters, type chips, and « Grouper » by product, type,
      topic, agent or none;
    - rows show a type tag, the customer's words over topic · customer, the agent and date,
      and the insight chip or complaint status;
    - the side panel (click or Enter; j/k step through rows without closing) holds the
      links, the complaint follow-up and « Lier à un insight ».
  - `?view=unread` — what nobody has opened yet; opening a row marks it read.
  - `?view=complaints` — the same sheet grouped by status. Age turns red after 3 days, and a
    resolution note is required to resolve.
  - `?view=insights` — insight cards grouped by status. Each card shows its evidence count,
    products and 2 quotes. The panel has status, owner, note, evidence, and the
    « nouveaux, non liés » feedback to link.
  - `?view=imports` — the import backlog grouped by suggested type: Confirmer / Ignorer per
    row, and « Tout confirmer » per group.
  - Multi-select (checkbox or x) opens a bulk bar: Créer un insight, Marquer lu.
- Both files take `?lang=ar|fr`. **The data is real:** real products, real verbatims, real
  counts, and the import dry run. Customer names and phones are fake.

## Phase 1 — database (worktree `feat/voix-du-client`, TDD, SQL tests under a real JWT)

Migration `supabase/migrations/<ts>_customer_feedback.sql`:

**The `feedback_category` enum** has three values: reclamation | objection | suggestion.
**The `feedback_moment` enum** has four values: call | transit | door | after.

**`feedback_topics`**
- Copies `rejection_reason_configs` (`20260919190827_rejection_reason_configs.sql`) exactly:
  `market_id`, `category`, `key`, `label_fr`, `label_ar`, `sort_order`, `is_active`, and
  `unique(market_id,key)`.
- RLS is the same: the market reads, and super_admin or that market's manager writes.
- It is seeded per market with `cross join`.

**`customer_feedback`**
- Columns:
  - `id`, `market_id`;
  - `category feedback_category NOT NULL`. Imports and courier rows arrive with a suggested
    category and `needs_review = true`;
  - `moment feedback_moment NOT NULL`. It is set by the create RPC from the linked order's
    status at insert time, and is `call` when there is no order. It is never sent by the
    client;
  - `topic_id → feedback_topics`;
  - `body text` — CHECK 1..2000;
  - `product_id`, `variant_id`, `order_id`, `customer_id` — all nullable;
  - `source` — `'agent' | 'rejection' | 'delivery' | 'courier' | 'import'`;
  - `courier_remark_id` — the `darb_shipments` row and remark it came from, when
    `source = 'courier'`;
  - `needs_review bool`;
  - `status` — `'open' | 'in_progress' | 'resolved'`, enforced by two CHECKs:
    - a réclamation that is not awaiting review must have a status;
    - every other row has none.
    In practice a confirmed réclamation opens as `open`.
  - `assigned_to`, `resolved_at`, `resolved_by`, `resolution_note`;
  - `reviewed_at`, `reviewed_by` — the shared « lu » state, set the first time a manager opens
    the row;
  - `created_by`, `created_at`, `updated_at`, `deleted_at`.
- Indexes: `(market_id, created_at desc)`, `(product_id)`, `(customer_id)`,
  `(market_id, status) where category = 'reclamation'`, `(market_id, moment)`, and two unique
  indexes so each feed is idempotent: `(order_id) where source = 'import'` and
  `(order_id, courier_remark_id) where source = 'courier'`.
- A trigger checks that the product, customer and order all belong to `market_id`.

**`customer_feedback_events`** is the complaint timeline and audit trail.
- It is append-only, enforced by the same trigger pattern as `order_history`.
- `kind` is created | status | assigned | retyped | edited | deleted | restored | linked |
  unlinked.

**`feedback_insights`**
- Columns: `id`, `market_id`, `title` (1..160), `note`, `status`, `owner_id`, `created_by`,
  `created_at`, `updated_at`.
- `status` is `'to_study' | 'in_progress' | 'done' | 'dismissed'`.
- **`feedback_insight_links`** has `insight_id`, `feedback_id`, `linked_by` and `linked_at`,
  with PK (`insight_id`, `feedback_id`). A trigger checks that both sides are in the same
  market.
- « Nouveaux, non liés » is not stored. It is computed as: unlinked feedback created after
  the insight, whose (category, topic) matches one already in the insight's evidence.

**Grants.** REVOKE INSERT, UPDATE and DELETE from authenticated on all five tables
(the whatsapp_core pattern). All writes go through RPCs.

**RPCs.** Each one is SECURITY DEFINER with `SET search_path = ''`, and REVOKEs from PUBLIC
**and** anon before granting to authenticated (see `20260924120000_revoke_anon_execute_security_definer.sql`).
- The actor is **always `auth.uid()`**, never a `p_actor_id` parameter
  (see the rpc-actor-id memory).
- The RPCs:
  - `create_customer_feedback(...)` — derives the market from the order, else from the
    caller; super_admin must pass it.
  - `update_customer_feedback(...)`:
    - the author may edit within 24 h;
    - a manager may edit anything in their market;
    - it also confirms an imported row (`needs_review = false`).
  - `set_feedback_complaint_status(id, status, note)` and `assign_feedback_complaint(id, user)`.
  - `delete_customer_feedback(id)` and `restore_customer_feedback(id)` — soft delete.
    The author gets a 5 s undo.
  - `mark_feedback_reviewed(ids uuid[])` — the « lu » state, in bulk.
  - `create_feedback_insight(title, note, status, owner, feedback_ids uuid[])`,
    `update_feedback_insight(...)`, `link_feedback_to_insight(insight, ids uuid[])` and
    `unlink_feedback_from_insight(insight, id)`.
  - `get_feedback_summary(p_market_id, p_tz) → jsonb`:
    - It is STABLE. Role and market are resolved inside it, as `get_team_commissions` does
      in `20260930192800_commission_statement.sql`.
    - It returns the 3 numbers (new this week in market time, open complaints with the
      oldest age, unread), the rail counts (per view, per category, per product, and « À
      vérifier »), and the category and moment counts for the chips.
  - `suggest_feedback_from_courier_remarks()` is called by the Darb sync after it updates
    remarks (`src/lib/carriers/darb*`).
    - It inserts `source = 'courier'`, `needs_review = true` rows for the 4 opinion classes,
      maps them to category and topic as in the table above, and sets the moment from the
      order's status.
    - It is idempotent through the unique index.
    - It is service_role only, like `get_product_agent_signals`.
  - The grouped sheet itself comes from `GET /api/feedback`, not an RPC.
    - The route takes the view and the filters, orders newest first, and returns rows plus
      `groups: [{ key, count, category_mix }]`. It pages at 5 rows per group, and « voir plus »
      loads the next 40 for that group.
    - Reads go through RLS; no SECURITY DEFINER is needed to read.

**Tests** in `supabase/tests/customer_feedback_test.sql`:
- anon cannot execute any of the RPCs;
- an agent cannot write to another market;
- an agent cannot edit someone else's entry after 24 h;
- the complaint CHECK holds;
- events are append-only;
- the import stays idempotent, and so does the courier suggestion job;
- the moment is derived server-side, so a client cannot send `moment`;
- an insight cannot link feedback from another market;
- an agent can read insights but cannot create or link them.

## Phase 2 — capture (the shortcut)

- `src/components/feedback/FeedbackCaptureProvider.tsx` is mounted once in
  `(dashboard)/layout.tsx`, for both the manager shell and `AgentDashboardShell`.
  - It holds the current order context and the open/closed state.
  - It owns the F listener and uses the existing `isEditableTarget` helper.
  - While it is open it tells the queue and panel handlers that a layer is on top — the same
    way `covered` works in `OrderDetailPanel/index.tsx` — so keys 1–3 never reach the
    post-call shortcuts in `QueuePage.tsx:666`.
- `OrderDetailPanel/index.tsx` gains three things:
  - `useRegisterFeedbackContext({ orderId, customerId, lines })`;
  - one icon button in the header;
  - « F » in the footer hint.
  Nothing else in the panel changes.
- `src/components/feedback/CaptureDialog.tsx` is built on `ui/Sheet.tsx` (center on desktop,
  end/bottom on phone).
  - Context chip.
  - The customer's history strip.
  - Three category cards, with keys 1–3, each showing its descriptor.
  - Topic chips, filtered by the chosen category and optional.
  - The moment chip: read-only, labelled « auto », showing which status it was derived from.
  - A product picker. It is preset from the order's lines; a multi-line order picks a line.
  - A verbatim textarea (`unicode-bidi: plaintext`).
  - Ctrl/⌘+Enter saves. Esc closes, and the draft is kept per order in sessionStorage.
  - After saving, a toast « Enregistré · Annuler ».
- Blank mode is **the inbound callback**: the only way customers reach us.
  - `GET /api/feedback/lookup?q=` returns customers (phone digits or name) and their orders
    in the actor's market, 6 + 6 results.
  - Each order carries its status and **derived moment**, so a delivered order shows « Après
    livraison » before the agent picks it.
  - Products come from the existing products hook.
- F also works in the **Livraison tab** (`/delivery`): the selected parcel becomes the
  context.
- `ShortcutsOverlay.tsx` lists F.

## Phase 3 — sheets and complaints

- Route `src/app/[locale]/(dashboard)/feedback/page.tsx`, a role branch:
  - an agent gets `AgentFeedbackSheet` (« Mes retours », the status of their complaints
    read-only, quick-add);
  - a manager or super_admin gets `FeedbackWorkspace`: underline tabs (`src/components/shared/PeriodSelector.tsx`-style
    tabs, design-system §4.11) and the per-tab views. **The manager v4 prototype is the
    source of truth**; the « grouped sheet + views rail » described below is superseded:
    - the overview sections;
    - the date-grouped sentence rows;
    - complaints by status;
    - the explained review queue.
- Wiring the route in:
  - add `/feedback` to agent `PERMISSIONS` in `src/lib/role-permissions.ts`;
  - add a tab to `AgentNavTabs.tsx`, wired the way commissions is in `AgentTabsContainer.tsx`;
  - add a sidebar item `customerVoice` under the `clients` section in `Sidebar.tsx`.
- The sheet is purpose-built, since the repo has no generic grid (like `ProductsTable.tsx`).
  - It is a grouped table. Group headers are collapsible, with a count, « n nouveaux », and a
    type-mix bar.
  - Columns: checkbox · category · what the customer said (over topic · moment · customer) ·
    entered by (agent, or « Livreur Darb ») · date · insight / status.
  - Filters: search, topic, agent, period (Depuis mai / 30 j / 7 j), category chips (with
    descriptors), moment chips, and category or product from the rail. Group by product,
    category, topic, moment, agent or none.
  - Keys: j/k and ↑↓ to move, Enter to open, x to select, `/` to search, Esc to close, F to
    add (the global capture).
  - CSV export through `/api/feedback/export.csv`.
- The side panel is built on `ui/Sheet.tsx` (placement end).
  - It shows the verbatim and the links: order (`/orders?open=`), customer
    (`CustomerHistoryModal`), and product (`/products/[id]`).
  - The moment is shown read-only, as derived.
  - Category and topic can be edited; a courier suggestion can be fixed before « Garder ».
  - For a complaint it adds status, owner, resolution note and the timeline.
  - It has « Lier à un insight » and « Créer un insight ».
  - Opening a row calls `mark_feedback_reviewed`.
- Bulk bar: Créer un insight, Marquer lu. In « À vérifier » it is Garder.
- « À vérifier » is grouped by origin: Darb courier remarks, then imported notes. Each row has
  Garder / Ignorer, each group has « Tout garder », and the view leaves the rail once empty.
- API routes follow `src/app/api/settings/rejection-reasons/*`: `getActor`, the user-scoped
  client, `{ data } | { error }`. SWR hooks follow `useRejectionReasons.ts`.

## Phase 4 — insights

- The insights board: cards grouped by status. Each card shows the title, note, evidence count,
  products, **the moments its evidence comes from** (e.g. call 14 · road 1 · door 5), 2
  quotes, the owner, and « +n nouveaux non liés ».
- The insight panel: status, owner and note; « nouveaux, non liés » with Lier / Tout lier; and
  the evidence list, where each row opens the feedback panel.
- The create modal opens from a selection. The title is prefilled from the most common
  topic, the evidence is listed, and Ctrl/⌘+Enter saves.
- Routes: `/api/feedback/insights` (GET list, POST create) and
  `/api/feedback/insights/[id]` (GET, PATCH, plus `links` POST/DELETE).
- `products/[id]/page.tsx` gains a « Voix du client » section: the latest feedback for the
  product and the insights it supports.

## Phase 5 — import, reject-flow offer, settings, docs

- Import migration:
  - It is idempotent (on `order_id`, `source = 'import'`) and inserts 0 rows on an empty DB,
    so rebuilding from migrations still works.
  - It applies the keyword rules that produced the 148, sets `needs_review = true`, and
    takes `created_by` and `created_at` from the `order_history` row with
    `status_to = 'rejected'`.
- `PostCallActionSheet.tsx` reject flow: when the group is `autre`, a toggle « Aussi un
  retour client », on by default, with the 3 category cards (one suggested from the note's
  words). `POST /api/orders/[id]/reject` accepts an optional
  `feedback: { category, topic_id }` and creates the row with `source = 'rejection'`.
- Livraison tab, `src/components/delivery/Sheets.tsx` (ActionSheet):
  - when the outcome is `reached_wants_cancel` or `return_confirmed`, the « Pourquoi ? »
    block appears: a toggle, on by default; the parcel's latest Darb remark as context; the
    3 category cards (one suggested from the remark's class); and the action note relabelled
    « Ses mots ».
  - `record_delivery_action` (its route) accepts the optional `feedback` and creates the row
    with `source = 'delivery'`.
- `src/components/settings/general/FeedbackTopicsSection.tsx`, modelled on
  `RejectionReasonsSection.tsx`, **with** i18n this time.
- i18n: a `feedback.*` namespace in `src/messages/{fr,ar}.json`, plus a parity test like
  `agent-commissions-parity.test.ts`.
- Docs: `docs/customer-voice.md`, and a one-line link in CLAUDE.md.

## Phase 6 — later (not in this build)

- AI: suggest the category and topic while the agent types, a weekly « what customers said
  about X » digest, and a summary of the unsorted imports.
- « Will order when the salary comes » entries (22 found) become a callback or prospect
  list.

## Side findings (flagged, not fixed — each is a decision)

1. **Agents file known rejections as « Autre ».** 326 of them since May, 47 % of « Autre ».
   « Autre » is still 31 % of rejections in the 19–30 Sept window.
   The sub-reasons exist; the picker is not steering agents to them.
2. **`customer_note` is used as an agent scratchpad and ends up on carrier labels.**
3. **The panel's `p` and `e` shortcuts use `e.key`,** so they fail on an Arabic keyboard layout.

## Verification

- `npm run test:run`, `npm run typecheck`, `npm run build`. Do not report lint: it is a no-op,
  since the repo has no ESLint config.
- `supabase/tests/run.sh` runs against the LOCAL db and covers grants, RLS and the
  lifecycle under a real JWT.
- Manual, with `npm run dev`, as agent1.ly and manager.ly:
  - F in the panel opens the capture window linked to the order;
  - F on the queue with no panel open gives blank mode, and search finds a customer by phone;
  - saving puts the entry in « Mes retours » and in the manager's Registre;
  - a complaint appears in Réclamations and can be moved to Résolue;
  - selecting 3 rows and creating an insight shows it with 3 evidence; a new entry on the
    same topic appears under « nouveaux, non liés »;
  - opening a row drops « À lire » by one for every manager of the market;
  - the 3 numbers match a hand `count(*)`;
  - `?lang=ar` mirrors correctly;
  - the reject « Autre » toggle creates a row;
  - in the Livraison tab, « Veut annuler » with the toggle on creates a `delivery` row whose
    moment is `transit`;
  - a callback on a delivered order sets the moment to `after`;
  - the courier job on a Libya prod snapshot suggests 35 rows (wrong_item 15, no_cash 9,
    payment_method 7, refused 4 — remarks on orders with a product) and none for « لا يرد »
    or « غدا يستلم ».
- The import dry run on prod returns 148 rows (2026-05-20 → 2026-09-30), `needs_review`,
  before it is applied.
- The imported rows keep the rejection's date from `order_history`: 36 of the 148 fall in
  19–30 Sept.
