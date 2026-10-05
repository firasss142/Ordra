# Voix du client — « صوت العميل »

What customers tell the confirmation and delivery agents (complaints, objections, suggestions),
linked to the order, customer and product. Plan and decisions: `plans/voix-du-client.md`.
The approved specs are `prototypes/voix-du-client-agent-v2.html` and
`prototypes/voix-du-client-manager-v6.html`.

## Model (`20261002120000_customer_feedback.sql`)

- Three fixed **categories**, an enum: `reclamation` · `objection` · `suggestion`. Only a
  réclamation has a lifecycle (`open → in_progress → resolved`). The CHECK
  `customer_feedback_complaint_status` enforces it.
- **Topics** live in `feedback_topics`, per market, with 16 seed topics. There is no settings UI
  yet; RLS lets managers write them.
- **Moment** (`call · transit · door · after`) is never sent by a client. `create_customer_feedback`
  derives it from the order status through `feedback_moment_of(status, shipped)`.
  `src/lib/feedback/moment.ts` mirrors that function, and the two must stay in step.
  - « Annulée » counts as `door` only once the parcel has shipped.
- **`needs_review`** marks a row that is waiting for a manager to Garder or Ignorer it. Courier
  remarks and imported notes arrive this way.
- **Writes** go through RPCs only, and the actor is always `auth.uid()`:
  - `create_customer_feedback`;
  - `keep_customer_feedback` and `ignore_customer_feedback`;
  - `set_feedback_complaint_status`;
  - `delete_customer_feedback`, which is the author's undo within 10 min.
- `customer_feedback_events` is append-only, enforced by `ledger_append_only`.
- **Reads** run under RLS. The whole market reads the market's feedback; warehouse and investors
  read none.
- `feedback_cube` (SECURITY INVOKER) returns counts by day × category × topic × product × author.
  `src/lib/feedback/overview.ts` computes every number on the manager page from it.

## Automatic feeds

| Feed | Migration | Rule |
|---|---|---|
| Darb courier remarks | `…120100_customer_feedback_courier.sql` | `remark_class` ∈ wrong_item / payment_method / no_cash / refused, on an order with a product. One suggestion per shipment. The trigger can never fail the sync. |
| Old « Autre » notes | `…120200_customer_feedback_import.sql` | The plan's keyword rules. The row is dated by the `order_history` rejection, never by `orders.updated_at`. One row per order. |
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
- **Manager / super_admin:** `/feedback` shows `FeedbackWorkspace`, with Clients › Voix du client
  in the sidebar.
  - The product tabs fold sizes into families (`src/lib/feedback/product-family.ts`): products
    whose names match once « حجم … » and a bracketed price are removed.
  - The period is compared with the period of the same length that ends the day before.
