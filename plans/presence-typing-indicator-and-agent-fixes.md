# Typing indicator + the agent-side flakiness

## Context

Two asks, one of which is a real bug the user noticed in use:

1. **"When someone starts typing, it should pop up just like Messenger."** Today
   `mode` flips to `editing` and the ring changes colour — a silent, static
   change that is easy to miss on a dense row. The user wants the head itself to
   *announce* it.
2. **"The head icon behaves inconsistently on the confirmation agent side —
   sometimes they appear and sometimes not."** This is real, and there are two
   independent causes, both found by reading the code.

---

## The two bugs behind the flakiness

### Bug A — the broadcast wipes the name, and a nameless head is invisible

`useOrderLocks.ts:129` stores the realtime payload **verbatim** over the row it
already had:

```ts
else rowsRef.current.set(k, payload);
```

But the broadcast payload (`20260925000001_order_presence.sql:111-118`) carries
only `op, order_id, user_id, market_id, role, mode, opened_at, expires_at`. It
has **no `full_name` / `avatar_url`** — those come from `list_order_presence`,
the SECURITY DEFINER reader, and exist only on rows fetched over HTTP.

`PresencePayload extends PresenceRow` makes this type-check cleanly while being
false at runtime: TypeScript believes the fields are there because `PresenceRow`
declares them optional.

Consequence, exactly matching the report:
- Agent loads the queue → HTTP fetch → rows **have** names → head appears.
- A manager opens/heartbeats/closes anything → broadcast → the row is replaced
  by a nameless copy → `ManagerPresenceMark` falls to `row.full_name ?? "??"`.
- Any later refetch restores the name.

So the head flickers between named, `??`, and — because a heartbeat fires every
25 s — it degrades within seconds of appearing.

### Bug B — the expiry tick never starts for the first arrival

`useOrderLocks.ts:140`:

```ts
useEffect(() => {
  if (!enabled || rowsRef.current.size === 0) return;   // ← reads a REF
  ...
}, [enabled, signature, publish]);
```

`rowsRef` is a ref, so it is **not** a dependency. On first paint the map is
empty, the effect bails, and it only re-runs when `signature` changes. That
works by luck when rows arrive (signature changes → effect re-runs → map is now
non-empty). But when the last row expires, `signature` goes to `""`, the effect
re-runs, sees a non-empty map (the expired row is still in it), and keeps
ticking forever — a timer that never stops on a queue that is never busy.

More importantly it makes appearance order-dependent, which is the other half of
"sometimes yes, sometimes no".

### Not a bug (checked)
- The trigger **does** route to `order_presence:agent:<assignee>` on INSERT,
  UPDATE and DELETE — the agent topic is fine.
- There is only one `OrderCard` render path, so it is not a missed list.
- RLS and `list_order_presence` resolve correctly for the assignee (verified in
  production last session).

---

## Plan

### 1. Fix Bug A — merge, never replace (the important one)

`useOrderLocks.ts` broadcast handler: preserve identity across a broadcast.

```ts
else {
  const prev = rowsRef.current.get(k);
  // The broadcast payload carries no full_name/avatar_url — only
  // list_order_presence does. Replacing wholesale is what made the head
  // flicker to "??" 25s after it appeared.
  rowsRef.current.set(k, {
    ...payload,
    full_name: payload.full_name ?? prev?.full_name ?? null,
    avatar_url: payload.avatar_url ?? prev?.avatar_url ?? null,
  });
  // A row we have never seen over HTTP has no identity at all: fetch once,
  // coalesced, rather than drawing an anonymous head.
  if (!prev) scheduleIdentityRefetch();
}
```

Plus: stop `PresencePayload` lying. Declare it as the fields the trigger
actually sends, with identity explicitly `never`-ish:

```ts
type PresencePayload = Omit<PresenceRow, "full_name" | "avatar_url"> & {
  op: "INSERT" | "UPDATE" | "DELETE";
};
```

`scheduleIdentityRefetch` = a 300 ms-coalesced `mutate()`, mirroring the
`COALESCE_MS` pattern `useOrdersRealtime` already uses, so a burst of arrivals
costs one fetch.

### 2. Fix Bug B — drive the tick off state, not a ref

Track live-row count in state (it already changes exactly when `signature`
does), and gate the interval on that:

```ts
const hasLive = signature.length > 0;
useEffect(() => {
  if (!enabled || !hasLive) return;
  ...
}, [enabled, hasLive, publish]);
```

This also stops the forever-timer: when the last row expires the signature
empties, `hasLive` goes false, the interval clears.

### 3. The Messenger-style typing indicator

**Where:** on the head itself, in both existing components —
`PresenceIndicator` (manager's orders list) and `ManagerPresenceMark` (agent's
queue card + panel header). One shared sub-component,
`src/components/shared/TypingDots.tsx`, so the two cannot drift.

**What it looks like:** a small bubble pinned to the avatar's bottom-end corner
— the same anchor the live dot already uses — containing three dots that rise
and fall in sequence. It *replaces* the static live dot while `mode === "editing"`
rather than sitting beside it, so the corner never holds two marks.

**Motion, and the design-system question.** §7 says "No entrance animations,
page transitions, or transforms" and allows only two 120 ms colour transitions.
This is a deliberate, argued exception, and the plan states it plainly rather
than pretending the rule does not apply:

- The rule exists to stop *decorative* motion. This is not decoration — it is
  the only honest way to render a live, ongoing action, and the product already
  makes exactly this exception seven times (`menuDrop`, `slideInEnd`,
  `scanPop`, `fadeInUp`, …) for states that are genuinely transient.
- It is confined to a 14×8px bubble that exists **only** while someone is
  actively typing, and disappears the moment they stop.
- It respects `prefers-reduced-motion`: under that media query the dots stop
  animating and the bubble stays solid. The meaning survives without the motion.

New keyframe in `globals.css` beside the existing seven:

```css
@keyframes typingDot {
  0%, 60%, 100% { opacity: .35; transform: translateY(0); }
  30%           { opacity: 1;   transform: translateY(-2px); }
}
@media (prefers-reduced-motion: reduce) {
  .typing-dot { animation: none; opacity: .8; }
}
```

**Accessibility:** the aria-label already says "modifie cette commande" — that
stays and remains the source of truth (§4.17 D: colour and motion are never the
only carrier). The bubble is `aria-hidden`; nothing is announced twice.

### 4. Make `mode` honest — release the latch

`OrderDetailPanel/index.tsx:663` sets `setPresenceMode("editing")` on commit and
**never sets it back**. So once anyone edits a single field they show as typing
for the rest of the session — which would make a Messenger-style indicator
actively lie, and is the one change that matters most for this feature to be
believable.

Fix: `editing` becomes a short-lived state driven by actual activity —
set on field focus/change, cleared on a ~4 s idle timer and on blur. The
heartbeat already carries `mode` every 25 s, so the server converges without any
new endpoint.

---

## Files

| File | Change |
|---|---|
| `src/hooks/useOrderLocks.ts` | merge-not-replace, honest `PresencePayload`, coalesced identity refetch, tick driven by state |
| `src/components/shared/TypingDots.tsx` | **new** — the shared bubble |
| `src/components/orders/PresenceIndicator.tsx` | swap the live dot for `TypingDots` while editing |
| `src/components/queue/ManagerPresenceMark.tsx` | same, on the agent side |
| `src/components/queue/OrderDetailPanel/index.tsx` | idle-release the `editing` latch |
| `src/app/globals.css` | `@keyframes typingDot` + reduced-motion guard |

## Tests (first, per CLAUDE.md)

- `useOrderLocks`: a broadcast after an HTTP fetch **keeps** the name; a
  broadcast for an unseen row triggers exactly one coalesced refetch; the tick
  starts when the first row arrives and **stops** when the last one expires.
- `TypingDots`: renders nothing unless editing; `aria-hidden`; one bubble only.
- `PresenceIndicator` / `ManagerPresenceMark`: editing → dots, viewing → static
  dot, never both.
- `OrderDetailPanel`: `mode` returns to `viewing` after the idle timeout.

## Verification

Typecheck, the affected suites, production build, then a two-account HTTP run
against the live app (a **disposable** order this time — last session's probe
left permanent rows in a real order's append-only `order_history`).
