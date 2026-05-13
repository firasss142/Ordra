# Libya Agent Arabic UI Audit

Date: 2026-05-13

## Scope

This audit covers the Libya agent interface only:

- Agent shell tabs: Orders, Leads, Follow-ups.
- Active agent-rendered components:
  - `src/components/layout/AgentDashboardShell.tsx`
  - `src/components/layout/AgentNavTabs.tsx`
  - `src/components/layout/AgentTabsContainer.tsx`
  - `src/components/queue/**`
  - `src/components/orders/CreateOrderModal.tsx`
  - `src/components/crm/AgentLeadsQueue.tsx`
  - Agent-visible CRM modals used from `AgentLeadsQueue`
  - `src/app/[locale]/(dashboard)/follow-ups/FollowUpsPageClient.tsx`
  - `src/components/follow-ups/AgentFollowUpsView.tsx`

Excluded:

- Tunisia/French UI.
- Manager, super-admin, warehouse-only screens.
- Tests and comments, unless a comment identified the visible runtime code path.

## Summary

The Libya agent interface is mostly wired to Arabic translations through `next-intl`, but several agent-visible paths still render hardcoded French or raw database keys.

Severity legend:
- **P0** — visible non-Arabic text in a high-frequency agent flow.
- **P1** — visible non-Arabic text in lower-frequency/error paths, or raw DB keys leaking to the UI.
- **P2** — accessibility-only (aria-label) leaks.

Highest-impact French leaks are in the Orders queue (all P0):

- The callback date picker is entirely hardcoded in French.
- The rejection reason selector is hardcoded in French.
- The auto-rejection banner is hardcoded in French.
- A scheduled-dispatch cancellation history note is saved in French and later shown in the order timeline.
- The create-order modal has a French error fallback.

Additional non-Arabic leaks were found in the agent Leads and Follow-ups tabs (P1/P2):

- Some status values render raw database keys such as `open`, `pending`, or `callback_scheduled`.
- Some modal buttons or accessibility labels still use hardcoded English/French fallbacks.
- Libya city options in one lead modal show Latin names beside Arabic names.

## Findings

### 1. [P0] Orders Queue — Auto-Rejection Banner Is French

File: [src/components/queue/QueuePage.tsx:467](src/components/queue/QueuePage.tsx#L467)

Visible text:

```tsx
Une commande a été rejetée automatiquement (injoignable).
```

Where it appears:

- Agent Orders tab.
- After an order is auto-rejected because max call attempts were reached.

Impact:

- Libya agents will see a French sentence in an otherwise Arabic queue.

Suggested fix:

- Replace the hardcoded string with an Arabic-aware `queue` translation.
- Existing Arabic key `queue.autoRejectedMessage` is close, but the current banner is shorter and may deserve a dedicated key.

Related non-Arabic accessibility label (P2):

- [src/components/queue/QueuePage.tsx:472](src/components/queue/QueuePage.tsx#L472) uses `aria-label="Dismiss"`.

### 2. [P0] Orders Queue — Callback Picker Is Hardcoded in French

File: [src/components/queue/CallbackPicker.tsx](src/components/queue/CallbackPicker.tsx)

Visible text and labels:

- [CallbackPicker.tsx:73](src/components/queue/CallbackPicker.tsx#L73): `L'heure doit être dans le futur`
- [CallbackPicker.tsx:97](src/components/queue/CallbackPicker.tsx#L97): `Programmer un rappel`
- [CallbackPicker.tsx:118](src/components/queue/CallbackPicker.tsx#L118): `Date`
- [CallbackPicker.tsx:133](src/components/queue/CallbackPicker.tsx#L133): `Heure`

Accessibility labels (P2):

- [CallbackPicker.tsx:122](src/components/queue/CallbackPicker.tsx#L122): `aria-label="Date du rappel"`
- [CallbackPicker.tsx:137](src/components/queue/CallbackPicker.tsx#L137): `aria-label="Heure du rappel"`

Where it appears:

- Agent Orders tab.
- Post-call action sheet.
- When the agent chooses callback / reminder flow.

Impact:

- This is a high-visibility French leak in a common agent workflow.

Suggested fix:

- Make `CallbackPicker` use `useTranslations("queue")` or accept translated labels from `PostCallActionSheet`.
- Existing Arabic queue keys already cover part of this:
  - `queue.scheduleCallback`
  - `queue.scheduleDate`
  - `queue.scheduleTime`
  - `queue.scheduleMustBeFuture`

### 3. [P0] Orders Queue — Rejection Reasons Are Hardcoded in French

File: [src/components/queue/RejectionReasonSelect.tsx](src/components/queue/RejectionReasonSelect.tsx)

Visible labels:

- [RejectionReasonSelect.tsx:7](src/components/queue/RejectionReasonSelect.tsx#L7): `Refus client`
- [RejectionReasonSelect.tsx:8](src/components/queue/RejectionReasonSelect.tsx#L8): `Faux numéro`
- [RejectionReasonSelect.tsx:9](src/components/queue/RejectionReasonSelect.tsx#L9): `Doublon`
- [RejectionReasonSelect.tsx:10](src/components/queue/RejectionReasonSelect.tsx#L10): `Injoignable`
- [RejectionReasonSelect.tsx:11](src/components/queue/RejectionReasonSelect.tsx#L11): `Prix`
- [RejectionReasonSelect.tsx:12](src/components/queue/RejectionReasonSelect.tsx#L12): `Non sérieux`
- [RejectionReasonSelect.tsx:13](src/components/queue/RejectionReasonSelect.tsx#L13): `Autre`
- [RejectionReasonSelect.tsx:74](src/components/queue/RejectionReasonSelect.tsx#L74): `Précisez…`

Where it appears:

- Agent Orders tab.
- Post-call action sheet.
- When the agent chooses rejection flow.

Impact:

- This is a high-visibility French leak in the order rejection workflow.

Suggested fix:

- Replace the local `LABELS` map with translations.
- Existing Arabic translations are already present at `orders.rejectionReasons`:
  - `orders.rejectionReasons.refus_client`
  - `orders.rejectionReasons.faux_numero`
  - `orders.rejectionReasons.doublon`
  - `orders.rejectionReasons.injoignable`
  - `orders.rejectionReasons.prix`
  - `orders.rejectionReasons.non_serieux`
  - `orders.rejectionReasons.autre`
- Add or reuse an Arabic placeholder for the custom reason input.

### 4. [P0] Orders Queue — Scheduled Dispatch Cancellation Note Is Saved in French

File: [src/components/queue/OrderDetailPanel.tsx:667](src/components/queue/OrderDetailPanel.tsx#L667)

Saved note:

```tsx
Livraison planifiée annulée
```

Where it appears:

- Agent Orders detail panel.
- When an agent cancels a scheduled dispatch.
- The note is written into order history and later rendered in the same panel timeline via `translateHistoryNote(...)`.

Why it leaks:

- `translateHistoryNote` maps a few exact English system notes, but it does not map `Livraison planifiée annulée`.
- Therefore the French note falls through and displays as-is.

Impact:

- Libya agents may see this French history note after canceling scheduled delivery.

Suggested fix:

- Save a stable machine/system note key instead of French prose, or add this note to `translateHistoryNote`.
- Prefer a key such as `scheduledDispatchCancelled` in `orders.history`.

### 5. [P0] Orders Queue — Create Order Modal Has French Error Fallback

File: [src/components/orders/CreateOrderModal.tsx:413](src/components/orders/CreateOrderModal.tsx#L413)

Visible fallback:

```tsx
Erreur ${res.status}
```

Where it appears:

- Agent Orders tab.
- New Order modal.
- When `/api/orders` fails without a translated API error body.

Impact:

- Libya agents can see French error text during order creation failures.

Suggested fix:

- Replace with a translated fallback such as `orders.create.errors.generic`.
- If the HTTP status is useful, interpolate it through an Arabic translation key.

### 6. [P1] Leads Tab — Libya City Options Show Latin Names

File: [src/components/crm/NewLeadModal.tsx:113-116](src/components/crm/NewLeadModal.tsx#L113-L116)

Current Libya options:

```tsx
id: g.fr,
label: `${g.fr} — ${g.ar}`,
```

Data source: [src/lib/carriers/governorates.ts:29-51](src/lib/carriers/governorates.ts#L29-L51)

Examples:

- `Tripoli — طرابلس`
- `Benghazi — بنغازي`
- `Misrata — مصراتة`

Where it appears:

- Agent Leads tab.
- New Lead modal.
- Libya market, city selector.

Impact:

- The field is not fully Arabic. The selected value is also stored from `g.fr`, so Latin city names can continue appearing later in agent cards.

Suggested fix:

- For `locale === "ar"` or `marketCode === "ly"`, display only `g.ar`.
- Consider storing an internal id separately from the display label so the saved city does not become the Latin value.

### 7. [P0] Leads Kanban — Reassign Modal Cancel Button Is a Broken No-Op Ternary

File: [src/components/crm/ReassignLeadModal.tsx:152](src/components/crm/ReassignLeadModal.tsx#L152)

Current code:

```tsx
{t("errors.generic").includes("annuler") ? "Annuler" : "Annuler"}
```

This is a no-op ternary: both branches return the literal French string `"Annuler"`. Someone started localizing the button and gave up — there is no translation key being used at all.

Where it appears:

- Agent Leads tab.
- Kanban view.
- Reassign lead modal, if the reassign action is available to the agent.

Impact:

- Libya agents always see a French cancel button in this modal, regardless of locale.

Suggested fix:

- Drop the ternary entirely and use a translation key. Either add `crm.leads.reassignModal.cancel` (already a namespace this component uses via `useTranslations("crm.leads.reassignModal")`) or use a shared `common.cancel`.
- Also confirm whether agents should see the reassign action at all — the test file exists but agent reachability is unverified.

### 8. [P1] Follow-Ups — Raw Follow-Up Status Is Rendered in English

File: [src/components/follow-ups/AgentFollowUpsView.tsx:474](src/components/follow-ups/AgentFollowUpsView.tsx#L474)

Current rendering:

```tsx
{fu.status}
```

Where it appears:

- Agent Follow-ups tab.
- Each follow-up row status pill.

Examples likely shown:

- `open`
- `in_progress`
- `resolved`
- `escalated`

Impact:

- Not French, but still violates the Libya "all Arabic" expectation.

Suggested fix:

- Replace raw `fu.status` with `tStatuses(fu.status)`.
- The Arabic translations already exist in `crm.followUps.statuses`.

### 9. [P1] Follow-Ups — Raw Order Status Is Rendered in Follow-Up Cards

File: [src/components/follow-ups/FollowUpCard.tsx:112](src/components/follow-ups/FollowUpCard.tsx#L112)

Current rendering:

```tsx
{order.status}
```

Reachability: `FollowUpCard` is imported by `FollowUpsBoard`, `FollowUpsKanban`, and `FollowUpsTimeline`. Those three are used in `FollowUpsPageClient.tsx` for the manager/admin timeline view, **not** in `AgentFollowUpsView.tsx`. So this is currently a manager-side leak, not an agent-side leak — Libya market managers using Arabic would still see it.

Examples likely shown:

- `pending`
- `confirmed`
- `dispatch_scheduled`
- `delivered`

Impact:

- Non-Arabic raw database values can leak into Arabic UI for Libya managers (and any future agent surface that adopts this component).

Suggested fix:

- Use `orders.statuses` translations with `useTranslations("orders.statuses")`.

### 10. [P1] Follow-Up Creation — Raw Order Status Is Rendered in Search/Pick Summary

Files:

- [src/components/follow-ups/CustomerPhoneSearch.tsx:100](src/components/follow-ups/CustomerPhoneSearch.tsx#L100)
- [src/components/follow-ups/NewFollowUpModal.tsx:187](src/components/follow-ups/NewFollowUpModal.tsx#L187)

Current rendering:

```tsx
<span>{r.status}</span>
{picked.status}
```

Where it appears:

- Agent Follow-ups tab.
- New Follow-up modal.
- Customer/order search result and selected customer summary.

Impact:

- Raw order status values can appear in Libya Arabic UI.

Suggested fix:

- Translate through `orders.statuses`.
- Pass locale/translation into these components or call `useTranslations("orders.statuses")` directly.

### 11. [P2] Agent Lead Cards — English Accessibility Label for Attempt Dots

File: [src/components/crm/LeadCard.tsx:209](src/components/crm/LeadCard.tsx#L209)

Current label:

```tsx
aria-label={`attempts ${used}/3`}
```

Where it appears:

- Agent Leads tab.
- Lead cards with attempts.

Impact:

- Not visible text, but Arabic screen-reader users will hear English.

Suggested fix:

- Add an Arabic translation key for attempt count, or reuse an existing queue/CRM attempt label.

### 12. [P2] Agent Kanban — Error Dismiss Label Is English

File: [src/components/crm/LeadsKanban.tsx:229](src/components/crm/LeadsKanban.tsx#L229)

Current label:

```tsx
aria-label="Dismiss"
```

Where it appears:

- Agent Leads tab.
- Kanban view.
- Move-error alert close button.

Impact:

- Accessibility-only English leak.

Suggested fix:

- Use a translated `dismiss` / `close` label.

### 13. [P2] Agent Follow-Up / CRM — Error Fallbacks Are English

Files:

- [src/components/crm/ScheduleCallbackModal.tsx:82](src/components/crm/ScheduleCallbackModal.tsx#L82)
- [src/components/crm/ScheduleCallbackModal.tsx:88](src/components/crm/ScheduleCallbackModal.tsx#L88)
- [src/components/crm/MarkLostModal.tsx:71](src/components/crm/MarkLostModal.tsx#L71)
- [src/components/crm/MarkLostModal.tsx:77](src/components/crm/MarkLostModal.tsx#L77)
- [src/components/follow-ups/AgentFollowUpsView.tsx:522](src/components/follow-ups/AgentFollowUpsView.tsx#L522)
- [src/components/follow-ups/NewFollowUpModal.tsx:88](src/components/follow-ups/NewFollowUpModal.tsx#L88)
- [src/app/[locale]/(dashboard)/follow-ups/FollowUpsPageClient.tsx:224](src/app/[locale]/(dashboard)/follow-ups/FollowUpsPageClient.tsx#L224)
- [src/app/[locale]/(dashboard)/follow-ups/FollowUpsPageClient.tsx:437](src/app/[locale]/(dashboard)/follow-ups/FollowUpsPageClient.tsx#L437)

Examples:

```tsx
"Error"
"error"
"Transition failed"
```

Where it appears:

- Agent Leads modals.
- Agent Follow-ups tab.
- Follow-up action/log-attempt flows.

Impact:

- Not French, but still non-Arabic. These appear only on API or network failure paths.

Suggested fix:

- Replace generic thrown strings with localized fallback keys.
- Avoid displaying raw API errors unless the API returns localized messages.

### 14. [P2] Orders Detail — Agent-Visible Error Fallbacks Are English

File: [src/components/queue/OrderDetailPanel.tsx](src/components/queue/OrderDetailPanel.tsx)

Potential visible fallbacks:

- [OrderDetailPanel.tsx:591](src/components/queue/OrderDetailPanel.tsx#L591): `HTTP ${res.status}`
- [OrderDetailPanel.tsx:604](src/components/queue/OrderDetailPanel.tsx#L604): `Network error`
- [OrderDetailPanel.tsx:640](src/components/queue/OrderDetailPanel.tsx#L640): `HTTP ${res.status}`
- [OrderDetailPanel.tsx:653](src/components/queue/OrderDetailPanel.tsx#L653): `Network error`
- [OrderDetailPanel.tsx:1205](src/components/queue/OrderDetailPanel.tsx#L1205): `Failed to add product`

Where it appears:

- Agent Orders detail panel.
- Carrier upload/delete failures.
- Inline product edit failure.

Impact:

- Not French, but non-Arabic errors can leak to Libya agents.

Suggested fix:

- Use existing Arabic detail/error keys where possible.
- Add specific translated fallback keys for carrier upload, carrier delete, and product edit failures.

## Translation Coverage Notes

Arabic translations already exist for many of the affected concepts:

- `orders.statuses.*`
- `orders.rejectionReasons.*`
- `queue.scheduleCallback`
- `queue.scheduleDate`
- `queue.scheduleTime`
- `queue.scheduleMustBeFuture`
- `queue.autoRejectedMessage`
- `crm.followUps.statuses.*`
- `crm.leads.statuses.*`
- `crm.leads.sources.*`

The main issue is not missing Arabic content in `src/messages/ar.json`; it is that several agent-facing components bypass the translation layer or render raw database/status values.

## Out of Scope (Recommend Separate Sweep)

- Date / number / currency formatting. RTL Arabic agent screens may render dates via `toLocaleString()` with no locale arg — silent French-locale leaks that would not show as hardcoded strings and were not audited here.

## Recommended Fix Order

1. Replace `CallbackPicker` hardcoded French with translation keys.
2. Replace `RejectionReasonSelect` hardcoded French labels with `orders.rejectionReasons`.
3. Localize the `QueuePage` auto-rejection banner and dismiss label.
4. Fix the broken `ReassignLeadModal` cancel button ternary.
5. Change scheduled-dispatch cancellation notes to translatable history keys.
6. Localize the `CreateOrderModal` French error fallback.
7. Translate raw status renderings in follow-up cards/search summaries.
8. Localize the remaining error fallbacks and accessibility labels.
9. Review the Libya lead city selector so Arabic-only labels are shown for Libya agents.

## Verification Checklist

After fixes, verify with a Libya agent account such as `agent1.ly@oms.local`:

- `/ar/queue`
  - Main tabs.
  - Post-call sheet.
  - Callback flow.
  - Reject flow.
  - Auto-reject banner.
  - New order modal.
  - Order detail history after canceling scheduled dispatch.
- `/ar/leads`
  - List and Kanban views.
  - New Lead modal.
  - Schedule callback modal.
  - Mark lost modal.
  - Reassign modal, if still available to agents.
- `/ar/follow-ups`
  - Agent follow-up list.
  - New follow-up modal.
  - Customer search results.
  - Log attempt modal.
