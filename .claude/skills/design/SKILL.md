---
name: design
description: >
  Ordra's product UI design skill — the « Aurore » language (soft pastel aurora ground, frosted-glass
  cards, colour that always means one thing, and since 2026-10-05 the calm register — thin marks,
  700-weight counts first, one bar per outcome, thin rings, no waffles/halos/entrance motion — the
  dark sidebar and brand green #15803D unchanged). Use it for ANY screen, page, component, drawer,
  modal, table, dashboard, chart, KPI tile, prototype or redesign inside Ordra (everything under
  src/ — orders, agent queue, delivery, warehouse/Entrepôt, finances, products, team, Accès,
  settings, investor portal), and before writing a prototypes/*.html mockup. Triggers: "design",
  "redesign", "prototype", "mockup", "make it look", "UI", "UX", "screen", "page", "layout",
  "colours", "modern", "card", "chart", "dashboard". Not for landing pages or public marketing
  sites — that is the marketing-design skill.
---

# Ordra design — « Aurore »

Since 2026-10-04 every Ordra screen speaks one language, « Aurore ». The full reference — tokens,
components, type ladder, scoped extensions — is **`docs/design-system.md`**. This skill is the
*working method*: how to design a screen here so the owner says yes on the first round.

**Reference implementation:** Salle de contrôle (`/team`, `src/components/team/room/`, the `.r6`
block in `src/app/globals.css`), built line for line from `prototypes/team-v6.html` (untracked —
real names, public repo). When in doubt about how something should look, look at `/team`.

**State of the code:** the doctrine is adopted, the app is **not migrated** — only `/team` is in
Aurore. `docs/design-system.md` §10 lists what the code still says. Do not restyle existing
screens, tokens, `globals.css` or `tailwind.config.ts` unless the owner explicitly asks for that
migration. New prototypes and new screens are designed in Aurore.

---

## 1. The method — five steps, in order

1. **Ask the one question.** What single question does this page answer, who reads it, how often,
   on what device? (One or two AskUserQuestion rounds, ≤ 4 questions, recommended option first —
   the owner usually takes the recommendation.) The answer decides the hero number.
2. **Read the data before drawing.** Real figures, from the live DB read-only when reachable. A
   design on invented numbers hides the empty states, the zeros and the outliers that decide it.
   Mask customer data — the repo is public.
3. **Prototype in HTML first** — `prototypes/<screen>-v1.html`, one self-contained file, no React.
   Real data, FR desktop first, then Arabic (RTL) and phone (390 px) once the owner likes it. For a
   *visual* decision, render 3–4 looks of the same content in one file (switch with keys 1–4) —
   the owner picks from what he sees, not from descriptions.
4. **Get a yes, then build.** The approved prototype is the spec: copy it exactly (px values —
   the root font is 14 px, so Tailwind rem classes render 12.5 % small). For a pixel-faithful
   page, port the prototype's CSS verbatim under a page prefix, as `/team` did with `.r6` (§7 of
   the doc).
5. **Self-review with §4 below**, then screenshot prototype and app side by side.

After a vague complaint ("I don't like it", "not modern"), rebuild **one** screen and show it
before touching the rest.

---

## 2. The ten principles (doc §1)

1. **One question, one huge number** (34–46 px / 800, tracking −0.045em). Under every number a
   2–4-word status with a coloured dot or tag — never a sentence.
2. **Colour means exactly one thing.** Four vocabularies that never borrow from each other:
   **chrome** (brand green `#15803D` — where you are, what you press) · **status / outcome** ·
   **identity** (an agent's own colour, a role, a carrier account) · **severity**
   (good / warn / bad). Never colour alone: the word or figure is always written beside it.
3. **Colourful, not loud (« Aurore calme », 2026-10-05).** Colour only on thin *marks* (10px
   bars, 9px rings, 8px dots, avatars) in the VALIDATED calm steps of design-system §2.4; white
   surfaces, no halos, near-black text that never wears a data colour. Counts first, share
   small, never « /100 »; each figure written once.
4. **Light, living ground; the sidebar is the only dark surface.** The aurora is painted once by
   the shell; cards float on it as frosted glass.
5. **One entity, one card.** Overview (3–6 numbers) → one card per agent / carrier / product →
   drawer for detail → a table to compare. Never mix entities in one chart.
6. **Every chart answers a named question** — one bar per outcome, `OutcomeRows` (what did
   they become / what is today made of), thin ring (how far is she), pill bar (where did they
   go), soft heat tile (which is weak). The waffle is retired. Tooltip on every mark; hovering a
   row highlights it and dims the rest. Run `validate_palette.js` on any new palette.
7. **Hierarchy by weight and size, never by greying below AA.** Lightest *text* grey `#667085`
   (5.0:1); `#8A94A6` is for icons, axes, disabled only.
8. **Calm motion** — no entrance choreography (no rising cards, popping squares, sweeping
   rings); hover changes a border or a wash, never lifts; drawers slide; the live dot is the
   only loop.
9. **Two densities** (§1.1): *showcase* pages (monitoring, analytics, finance, products, team) use
   the full scale; *workbench* pages (orders, agent queue, delivery, warehouse bench, settings
   forms) keep ground, glass, type, radii and colours but put **no glass and no entrance motion on
   list rows**. The phone warehouse shell keeps an opaque ground (sunlight).
10. **Everything mirrors** — logical properties only; Arabic is a first-class reading.

---

## 3. The kit at a glance

| Thing | Aurore |
|---|---|
| Ground | `#F6F7FB` + five pastel radials (indigo top-start, pink top-end, mint bottom-end, amber bottom-start, lavender centre), fixed |
| Card | white .62, 1px white .9 edge, **24 px** radius, `0 10px 36px rgba(42,52,110,.07)`, `blur(20px) saturate(170%)` |
| Inner tile / drawer section | white .66, 16 px radius, no shadow |
| Drawer | floating, 12 px from the edges, 26 px radius, white-blue .84 glass, a halo of the entity's colour |
| Ink | `#0F1728` / `#475467` / `#667085`; zero values faint `#C9CED7` |
| Type | Plus Jakarta Sans · H1 32/800 · section 22/800 · card title 17–19/800 · eyebrow 10.5/800 caps +0.1em |
| Pills | chips, tags, trend pills (↑ 4 on green tint), medals for rank 1–3 |
| Avatar | circle in the person's colour gradient, glow in her hue, live dot (pulsing green / amber / grey) |
| Outcomes | uploaded `#0E9384` · rejected `#E8385A` · delivered `#079455` · en route `#38C0AE` · returned `#F79009` · not yet `#E1E6EE` · overdue = hatching |
| Agent colours | indigo `#444CE7` · pink `#DD2590` · cyan `#088AB2` · gold `#CA8504` · lime `#4CA30D` · orange `#E04F16` (ramps -0…-9, `users.color`) |
| Problems | rose gradient wash + a filled red icon holder; healthy = calm, a green check |
| Empty | dashed 1.5 px box that says what is empty and why |

Exact values, components and the scoped palettes (orders §4.17, finance §4.21, roles §4.23,
journals §4.24, delivery §4.22, warehouse §4.20): `docs/design-system.md`.

---

## 4. Self-review before showing anything

- [ ] I can say the page's one question, and the biggest number on screen answers it.
- [ ] Every number has a short status under it; no paragraph explains a number.
- [ ] Each hue on the page belongs to exactly one vocabulary; no agent colour on a status, no status hue on a person, no green that isn't chrome.
- [ ] Every coloured mark has its figure or word written next to it.
- [ ] All text ≥ 4.5:1 (no `#8A94A6` text); every new palette passed `validate_palette.js` (dataviz skill).
- [ ] One entity per card / per chart; detail lives in the drawer.
- [ ] Every chart mark has a tooltip; legends highlight.
- [ ] Cards are glass on the aurora; nothing paints an opaque page background; no black shadows; no sharp corners.
- [ ] Workbench lists: no glass and no entrance animation on rows.
- [ ] Motion stops under `prefers-reduced-motion`.
- [ ] Logical properties only; checked in Arabic (`56%` with no space; eyebrows without caps in RTL) and at 390 px.
- [ ] All strings through next-intl; sizes in px.
- [ ] Empty, zero, loading (page-shaped skeleton) and error states are designed, not left to chance.

---

## 5. Never

- Apply the marketing-design skill (dark void, neon, 96 px display) to anything under `src/`.
- Restyle the live app, tokens or primitives without the owner asking for the migration.
- Ship React before the owner approved the HTML prototype.
- Invent a number the data has not earned (a goal nobody set, a rate nobody measured).
- Use a gradient that carries no meaning — the aurora ground, glass, avatar, medal and alert wash are the only gradients.
