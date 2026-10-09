# Voix du client — « صوت العميل »

What customers tell the confirmation and delivery agents (complaints, objections, suggestions),
linked to the order, customer and product. Plan and decisions: `plans/voix-du-client.md`.
The approved specs are `prototypes/voix-du-client-agent-v2.html` (the agent) and
`prototypes/voix-du-client-et-messages-v2.html` (the manager page, since 2026-10-06; plan
`plans/voix-du-client-et-messages-redesign.md`).

## Model (`20261002120000_customer_feedback.sql`, v2 `20261006150000_voix_du_client_v2.sql`)

- Three fixed **categories**, an enum: `reclamation` · `objection` · `suggestion`. Only a
  réclamation has a lifecycle (`open → in_progress → resolved`). The CHECK
  `customer_feedback_complaint_status` enforces it: a réclamation ALWAYS has a status (v2; it used
  to wait for a validation, and the 14 courier complaints never opened).
- **Topics** live in `feedback_topics`, per market, with 16 seed topics. There is no settings UI
  yet. `response` is « Notre réponse » — what the team does when a customer gives this reason,
  written by a manager through `set_feedback_topic_response` (500 chars, empty clears).
- **Moment** (`call · transit · door · after`) is never sent by a client. `create_customer_feedback`
  derives it from the order status through `feedback_moment_of(status, shipped)`.
  `src/lib/feedback/moment.ts` mirrors that function, and the two must stay in step.
  - « Annulée » counts as `door` only once the parcel has shipped.
- **No validation queue since v2.** Everything not discarded counts on arrival; on 2026-10-06 the
  « à valider » queue hid 184 of 196 rows and nobody had ever opened it. `needs_review` is
  still a column, read by nothing — drop it in a later migration. A row with no topic (outside
  complaints) is « à vérifier ».
- **Writes** go through RPCs only, and the actor is always `auth.uid()`:
  - `create_customer_feedback` — sources `agent`, `rejection`, `delivery`, and `whatsapp`
    (« Garder dans Voix du client » from Messages, managers only);
  - `discard_customer_feedback` / `restore_customer_feedback` — « Écarter » and its
    « Annuler »; restore only brings back a row whose LAST event is `discarded`, never an
    agent's own undo;
  - `set_customer_feedback_topic` — « Changer la raison », one row or many; objection or
    suggestion topics only, the category follows the topic, complaints are left alone;
  - `set_feedback_complaint_status`;
  - `delete_customer_feedback`, which is the author's undo within 10 min.
- `customer_feedback_events` is append-only, enforced by `ledger_append_only`.
- **Reads** run under RLS. The whole market reads the market's feedback; warehouse and investors
  read none.
- `feedback_cube` (SECURITY INVOKER) returns counts by day × category × topic × product × author.
  `src/lib/feedback/voice.ts` (`computeVoice`) computes every number on the manager page from it.

## Automatic feeds

| Feed | Migration | Rule |
|---|---|---|
| Darb courier remarks | `…120100_customer_feedback_courier.sql` (v2 rewrites it) | `remark_class` ∈ wrong_item / payment_method / no_cash / refused, on an order with a product. One row per shipment; a wrong_item opens a réclamation. The trigger can never fail the sync. |
| Old « Autre » notes | `…120200_customer_feedback_import.sql` | Ran once (stopped 10-01); v2 drops the function. The rows stay, source `import`. |
| WhatsApp | `POST /api/feedback` `source: "whatsapp"` | « Garder dans Voix du client » in the Messages « Qui est-ce ? » panel: the customer's last message, category suggestion, no topic (« à vérifier »). |
| Reject « Autre » | `POST /api/orders/[id]/reject` `feedback` | The note becomes the words, `source = rejection`. A failure never undoes the rejection. |
| Livraison « Veut annuler » / « Retour confirmé » | `POST /api/delivery/orders/[id]/actions` `feedback` | The note becomes the words, `source = delivery`. |

Prod dry run on 2026-10-02:
- 149 « Autre » notes would be imported, 37 of them dated 19 Sept or later;
- 34 courier suggestions: wrong_item 14, no_cash 8, payment_method 8, refused 4.

## Surfaces

- **The F key.** `FeedbackCaptureProvider` is mounted in both shells.
  - It matches `e.code === "KeyF"`, so it also works on the Arabic layout.
  - It fires outside text fields and never on top of another dialog.
  - The order panel and the selected Livraison parcel register as its context. With no context
    it opens the callback search (`/api/feedback/lookup`), which reads the whole market through
    the service role, like `/api/agent/search`.
- **Agent:** `/feedback` shows « Voix du client » in the agent shell (`components/agent/voc/VocPage`, prototype agent-shell-v2 §6; cards on a phone). The capture (`CaptureDialog`) is drawn in the shell language too, in a `.agt` portal layer.
- **Order panel:** a « Voix du client » button carrying the count of the customer's open
  complaints, and « F » in the hint line.
- **Queue rows:** « n réclamation ouverte », from `/api/feedback/open-complaints`, keyed on the
  normalised phone.
- **Manager / super_admin:** `/feedback` shows `components/feedback/voice/VoiceWorkspace`
  (styles `voice.css`, scoped `.vdc`), with Clients › Voix du client in the sidebar.
  - **Feuille** first: four minis (objections, suggestions, open complaints, « à vérifier »), the
    saved views, « Grouper par » raison / produit / rien, select → « Écarter » or « Changer la
    raison », a 6 s « Annuler » toast, and the drawer. The page loads the whole period
    (`/api/feedback/rows`, up to 1 000) and cuts views and groups itself.
  - **Raisons**: one sentence, the to-do line (open complaints → the drawer or the
    Réclamations view; « à vérifier » → that view), then one ranked list for objections and one
    for suggestions; a reason opens on click to show three quotes, « Surtout sur » and « Notre
    réponse ». A reason given in the previous period and not this one is « Plus mentionné ».
  - Products fold sizes into families (`src/lib/feedback/product-family.ts`): products whose
    names match once « حجم … » and a bracketed price are removed.
  - The period is compared with the period of the same length that ends the day before.
  - Category colours are the calm steps rec `#E46A7B` · obj `#E9A23B` · sug `#4DAE7E`, in the
    agent capture too (`CATEGORY_TONE`).
