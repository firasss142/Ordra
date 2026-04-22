---
name: shopify-design-system
description: >
  A complete dark-first, cinematic design system inspired by Shopify — covering colors, typography, components, spacing, depth, motion, iconography, and accessibility. ALWAYS use this skill before writing ANY UI, frontend, or design-related code — no exceptions. This skill MUST trigger whenever the user mentions, implies, or touches anything related to: building a UI, designing an interface, writing CSS, creating a component, making a page, styling anything, building a website, landing page, dashboard, app screen, hero section, navbar, card, button, form, modal, sidebar, footer, pricing page, feature section, portfolio, SaaS product page, marketing site, admin panel, mobile screen, or any visual/interactive element. Also trigger on words like: "make it look good", "design", "style", "theme", "layout", "frontend", "HTML", "React component", "Tailwind", "CSS", "UI", "UX", "user interface", "user experience", "visual", "aesthetic", "polished", "beautiful", "modern", "clean", "redesign", "improve the design", "make it prettier", "color scheme", "typography", "font", "spacing", "responsive", "mobile-friendly", "motion", "animation", "transition", "accessibility", "a11y", "focus state", "figma", "wireframe", "prototype", "component library", "design system". If the user is building ANYTHING a human will look at, read this skill first. When in doubt, trigger. Missing this skill means shipping ugly, generic UI — that is not acceptable.
---

# Shopify-Inspired Design System (Refined)

Dark-first, cinematic design for premium digital experiences. Read fully before writing any UI code.

---

## 0. Three Governing Principles

1. **Restraint is the loudest voice.** Every element earns its place. Remove first; add only if removal hurts clarity.
2. **Darkness is a stage, not a style.** The near-black canvas exists to spotlight one idea per section — not to look moody.
3. **Type carries the brand.** Color, shadow, and motion support typography — never compete with it.

---

## 1. Color Palette

### Surfaces (Void → Forest, barely perceptible steps)
| Name | Hex | Use |
|---|---|---|
| Void | `#000000` | Root page background |
| Deep Teal | `#02090A` | Card surfaces, content containers |
| Dark Forest | `#061A1C` | Section backgrounds |
| Forest | `#102620` | Elevated surfaces, sticky nav on scroll |

### Text
| Name | Hex | Use |
|---|---|---|
| White | `#FFFFFF` | Primary text, headings, buttons |
| Muted | `#A1A1AA` | Secondary text, descriptions |
| Shade-50 | `#71717A` | Tertiary text, placeholders |
| Shade-60 | `#52525B` | Disabled |
| Shade-70 | `#3F3F46` | Dividers, input borders |

### Accent (precious — use sparingly)
| Name | Hex | Use |
|---|---|---|
| Neon Green | `#36F4A4` | Focus rings, active indicators, critical accent ONLY |
| Neon Green Glow | `rgba(54,244,164,0.15)` | Focus ring outer halo |
| Aloe | `#C1FBD4` | Rare decorative green wash |
| Pistachio | `#D4F9E0` | Subtle surface tints |

### Semantic (desaturated — never neon, never warm-brand)
| Name | Hex | Use |
|---|---|---|
| Success | `#36F4A4` | Confirmations (reuses Neon Green) |
| Warning | `#F5C563` | Muted amber |
| Danger | `#F47272` | Muted coral |
| Info | `#7FB8F5` | Cool azure |

Each pairs with a 10% alpha background (e.g. `rgba(244,114,114,0.1)`).

### Borders
- Dark surfaces: `#1E2C31`
- Light surfaces (rare): `#E4E4E7`

---

## 2. Typography

### Fonts
- **Display/Headings**: `NeueHaasGrotesk` → fallback Helvetica, Arial
  - Always: `font-feature-settings: 'ss03'`
  - Weights: 330–750 (use 330–400 almost always)
- **Body/UI**: `Inter Variable` → fallback Helvetica, Arial
  - Always: `font-feature-settings: 'ss03', 'cv11'`
  - Weights: 400–550 (prefer 420/550 on dark — optical correction)
- **Code**: `ui-monospace`, SFMono-Regular, Menlo, Monaco

### Scale (desktop — use `clamp()` for fluid sizing)
| Role | Size | Min | Weight | Font | Notes |
|---|---|---|---|---|---|
| Display XL | 96px | 48px | 400 | NHG | Hero headlines |
| Display Light | 96px | 44px | 330 | NHG | Ethereal — the signature |
| H1 | 70px | 40px | 330 | NHG | Section titles |
| H2 | 55px | 34px | 330 | NHG | Subsections |
| H3 | 48px | 30px | 330 | NHG | Feature titles |
| H4 | 32px | 24px | 360 | NHG | Card headings |
| H5 | 28px | 22px | 500 | NHG | Small headings |
| Body Large | 20px | 18px | 500 | NHG/Inter | Lead paragraphs |
| Body | 18px | 16px | 400 | Inter | Standard body |
| Body Medium | 18px | 16px | 550 | Inter | Emphasized |
| Body Small | 16px | 14px | 400 | Inter | Compact |
| Button | 16px | 16px | 400 | NHG | CTA text |
| Nav Link | 18px | 16px | 500 | NHG | tracking `0.4px` (modern), not 0.72px |
| Caption | 14px | 13px | 500 | NHG/Inter | Metadata |
| Label | 12px | 11px | 400 | Inter | Uppercase, tracking 0.72px |

### Rules
- **Featherweight is signature.** Headings at 330–400. Never above 500 for display body copy.
- **Optical correction on dark.** Use Inter 420 where you'd use 500 on light, 550 where you'd use 600.
- **Tabular figures** (`font-variant-numeric: tabular-nums`) for all numeric data, prices, timestamps.
- **Measure**: 45–75 chars per line for body copy.
- `ss03` is non-negotiable.

---

## 3. Components

### Buttons

**Primary (White Pill)**
```css
background: #FFFFFF;
color: #000000;
border: 2px solid transparent;
border-radius: 9999px;
padding: 12px 26px 12px 16px;
font-size: 16px;
transition: transform 200ms cubic-bezier(0.2,0,0,1), background 150ms linear;
}
:hover { transform: translateY(-1px); background: #F4F4F5; }
:active { transform: translateY(0); background: #E4E4E7; }
:focus-visible { outline: 2px solid #36F4A4; outline-offset: 2px; }
:disabled { opacity: 0.4; cursor: not-allowed; }
```

**Secondary (Ghost)**
```css
background: transparent;
color: #FFFFFF;
border: 2px solid #FFFFFF;
border-radius: 9999px;
padding: 12px 26px 12px 16px;
/* Hover: softer fill, not full white */
:hover { background: rgba(255,255,255,0.08); }
:active { background: rgba(255,255,255,0.16); }
```

**Tertiary (Text)**
```css
background: transparent;
color: #FFFFFF;
padding: 8px 0;
text-decoration: underline;
text-underline-offset: 4px;
text-decoration-color: rgba(255,255,255,0.3);
:hover { text-decoration-color: #FFFFFF; }
```

**Icon Button**
```css
width: 40px; height: 40px;
background: rgba(255,255,255,0.06);
border: 1px solid rgba(255,255,255,0.1);
border-radius: 9999px;
:hover { background: rgba(255,255,255,0.12); }
```

**Badge / Tag (Frosted Glass)**
```css
background: rgba(255,255,255,0.08);
border: 1px solid rgba(255,255,255,0.1);
backdrop-filter: blur(12px);
border-radius: 6px;
padding: 6px 12px;
font-size: 13px;
font-weight: 500;
color: #FFFFFF;
```

### Cards

```css
background: #02090A;
border: 1px solid #1E2C31;
border-radius: 12px; /* default — softer than 8px */
box-shadow:
  0 0 0 1px rgba(0,0,0,0.1),
  0 2px 2px rgba(0,0,0,0.1),
  0 4px 4px rgba(0,0,0,0.1),
  0 8px 8px rgba(0,0,0,0.1),
  inset 0 1px 0 rgba(255,255,255,0.03);
transition: box-shadow 400ms ease, border-color 300ms ease;
:hover { border-color: #2A3A41; /* shadow grows */ }
```

> Multi-layer shadow is mandatory. Single `box-shadow` values look flat. Inset white glow simulates top-lit glass.

### Inputs

```css
background: rgba(255,255,255,0.03); /* subtle fill, not transparent */
color: #FFFFFF;
border: 1px solid #3F3F46;
border-radius: 8px;
padding: 12px 16px;
transition: border-color 200ms ease, box-shadow 200ms ease;
::placeholder { color: #71717A; }
:hover { border-color: #52525B; }
:focus {
  border-color: #36F4A4;
  box-shadow: 0 0 0 3px rgba(54,244,164,0.15);
  outline: none;
}
:disabled { opacity: 0.5; background: rgba(255,255,255,0.02); }
/* Error state: */
.error { border-color: #F47272; background: rgba(244,114,114,0.05); }
```

Labels: above input, 13px/500, `#A1A1AA`, `margin-bottom: 8px`.
Helper text: below, 13px/400, `#71717A`, `margin-top: 6px`.

### Navigation

```css
/* Default */
background: transparent;
height: 72px; /* up from 64 — more breathing room */

/* On scroll — frosted glass */
background: rgba(16, 38, 32, 0.8);
backdrop-filter: blur(20px);
border-bottom: 1px solid rgba(255,255,255,0.06);
transition: background 400ms ease, backdrop-filter 400ms ease;

/* Nav links */
font-size: 16px;
font-weight: 500;
letter-spacing: 0.4px; /* tightened for modern feel */
color: #FFFFFF;
:hover { color: #A1A1AA; transition: color 150ms ease; }
```

---

## 4. Spacing (8px base)

| Token | Value |
|---|---|
| space-1 | 4px |
| space-2 | 8px |
| space-3 | 12px |
| space-4 | 16px |
| space-5 | 24px |
| space-6 | 32px |
| space-7 | 48px |
| space-8 | 64px |
| space-9 | 96px |
| space-10 | 128px |

**Section separation**: 96–128px of void between major sections. This theatrical breathing room is the cinematic pacing. Never compress it.

Container max-width: **1280px** centered. Horizontal padding: 64px → 40px → 16px.

---

## 5. Border Radius

| Value | Use |
|---|---|
| 6px | Badges, tags, small controls |
| 8px | Inputs, small cards |
| 12px | Standard cards (default) |
| 16px | Featured cards, image containers |
| 20px | Modal headers, top-rounded |
| 9999px | Pill buttons (non-negotiable for CTAs) |

Sharp 0px corners are forbidden on interactive elements.

---

## 6. Depth & Elevation

Shadows on dark act as **ambient occlusion** — cards settle into the surface, not float above.

| Level | Use | CSS |
|---|---|---|
| L0 | Page bg | none |
| L1 | Resting cards | `0 0 0 1px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.03)` |
| L2 | Hovered/featured cards | Full multi-layer stack (see Cards) |
| L3 | Dropdowns, popovers | L2 + `0 24px 48px -12px rgba(0,0,0,0.4)` |
| L4 | Modals, overlays | L3 + `0 48px 80px -20px rgba(0,0,0,0.6)` |
| Focus | Keyboard focus | `0 0 0 2px #36F4A4, 0 0 0 6px rgba(54,244,164,0.15)` |

Hierarchy: Void → Deep Teal → Dark Forest → Forest. Adjacent steps should be barely perceptible.

Add a 3% SVG noise overlay to large dark expanses to prevent OLED banding. Never on text.

---

## 7. Motion

Slow, soft, deliberate. No bounce. No spring. No elastic.

### Durations
| Token | Value | Use |
|---|---|---|
| instant | 50ms | Button press feedback |
| fast | 150ms | Hover color shifts |
| base | 250ms | Standard fades |
| slow | 400ms | Card shadows, large surfaces |
| slower | 600ms | Nav scroll transition |
| theatrical | 1200ms | Hero reveals |

### Easings
| Token | Curve | Use |
|---|---|---|
| standard | `cubic-bezier(0.2, 0, 0, 1)` | Default |
| entrance | `cubic-bezier(0.16, 1, 0.3, 1)` | Entering viewport |
| exit | `cubic-bezier(0.7, 0, 0.84, 0)` | Leaving viewport |
| emphasis | `cubic-bezier(0.4, 0, 0.2, 1)` | Card hovers |

### Rules
- One or two properties per element — never three+ animating at once.
- Stagger lists by 30–60ms per item, never more.
- Always respect `prefers-reduced-motion` — collapse durations to 0.01ms.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 8. Iconography

Icons used **sparingly** — only when a word is slower or redundant.

- **Library**: Lucide or Phosphor (Thin/Light variant only)
- **Stroke**: 1.5px (matches ethereal type weight)
- **Sizes**: 14, 16, 20, 24px — no others
- **Color**: always `currentColor`, never hardcoded
- Decorative icons are forbidden. Never mix weights or styles.
- Icon-only buttons require `aria-label`.

---

## 9. Accessibility (Non-Negotiable)

- **Contrast**: body text ≥ 4.5:1, display text ≥ 3:1 (WCAG AA minimum)
- **Focus**: every interactive element has a visible `:focus-visible` with the doubled Neon Green ring
- **Touch targets**: minimum 44×44px
- **Color independence**: status dots pair with text labels; error borders pair with error text
- **Semantic HTML**: `<button>`, `<nav>`, `<main>` — never `<div onClick>`
- **Reduced motion**: honored at stylesheet level
- **Escape closes modals**. Focus is trapped while open.

---

## 10. Responsive

| Breakpoint | Width | Display | Padding |
|---|---|---|---|
| Mobile | <640px | 48px | 16px |
| Tablet | 640–1024px | 70px | 40px |
| Desktop | 1024–1440px | 96px | 64px |
| Large | >1440px | 96px + centered max-width | 64px+ |

- Nav collapses to hamburger below 1024px
- 2-col feature layouts stack below 768px
- Stats row stacks vertically on mobile
- Section padding scales: 128px → 96px → 64px → 40px

---

## 11. Do's and Don'ts

### Do
- Dark surfaces hierarchy: Void → Deep Teal → Dark Forest → Forest
- Display type at weight 330–400
- Neon Green reserved for focus + critical accent
- 9999px radius on all primary CTAs
- Multi-layer shadow stack always
- `ss03` on all text
- Inter 420/550 on dark for optical correction
- Tabular figures for numeric data
- Section separation 96–128px
- Frosted glass on sticky navs (`backdrop-filter: blur`)
- Pair color with text/shape — never color alone
- Respect `prefers-reduced-motion`

### Don't
- No warm brand colors (orange/red/yellow outside desaturated semantic)
- No weights above 500 for NHG body copy
- No Neon Green on large surfaces — point accent only
- No sharp 0px corners on interactive elements
- No single-layer `box-shadow` on cards
- No bright backgrounds — dark-first always
- No negative letter-spacing on headings
- No bounce/spring/elastic motion curves
- No decorative icons
- No three+ properties animating simultaneously
- No `<form>` submission handlers when inline buttons work — avoid accidental submits

---

## 12. Design Tokens (Copy-Paste CSS)

```css
:root {
  /* Surfaces */
  --color-void: #000000;
  --color-deep-teal: #02090A;
  --color-dark-forest: #061A1C;
  --color-forest: #102620;
  --color-dark-card-border: #1E2C31;

  /* Text */
  --color-white: #FFFFFF;
  --color-muted: #A1A1AA;
  --color-shade-50: #71717A;
  --color-shade-60: #52525B;
  --color-shade-70: #3F3F46;

  /* Accent */
  --color-neon-green: #36F4A4;
  --color-neon-green-glow: rgba(54,244,164,0.15);

  /* Semantic */
  --color-success: #36F4A4;
  --color-warning: #F5C563;
  --color-danger:  #F47272;
  --color-info:    #7FB8F5;

  /* Radius */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-2xl: 20px;
  --radius-pill: 9999px;

  /* Shadows */
  --shadow-l1: 0 0 0 1px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.03);
  --shadow-l2: 0 0 0 1px rgba(0,0,0,0.1), 0 2px 2px rgba(0,0,0,0.1),
               0 4px 4px rgba(0,0,0,0.1), 0 8px 8px rgba(0,0,0,0.1),
               inset 0 1px 0 rgba(255,255,255,0.04);
  --shadow-l3: var(--shadow-l2), 0 24px 48px -12px rgba(0,0,0,0.4);
  --shadow-l4: var(--shadow-l3), 0 48px 80px -20px rgba(0,0,0,0.6);
  --shadow-focus: 0 0 0 2px #36F4A4, 0 0 0 6px rgba(54,244,164,0.15);

  /* Motion */
  --duration-instant: 50ms;
  --duration-fast: 150ms;
  --duration-base: 250ms;
  --duration-slow: 400ms;
  --duration-slower: 600ms;
  --duration-theatrical: 1200ms;

  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-entrance: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-exit:     cubic-bezier(0.7, 0, 0.84, 0);
  --ease-emphasis: cubic-bezier(0.4, 0, 0.2, 1);

  /* Spacing (8px base) */
  --space-1: 4px;   --space-2: 8px;   --space-3: 12px; --space-4: 16px;
  --space-5: 24px;  --space-6: 32px;  --space-7: 48px; --space-8: 64px;
  --space-9: 96px;  --space-10: 128px;
}
```

---

## 13. Quick-Reference Prompts

- **Hero**: Void bg, 96px/330 NHG headline white, 20px/500 subtitle `#A1A1AA`, white pill + ghost pill. Optional green atmospheric halo behind primary CTA.
- **Feature Card**: Deep Teal bg, 1px `#1E2C31` border, 12px radius, L1 shadow → L2 on hover over 400ms, 32px/360 white heading, 18px/420 `#A1A1AA` body.
- **Stats**: Dark Forest bg, 90.74px/750 white numbers with tabular figures, 14px/500 `#A1A1AA` labels, 64px gap, optional 1px `rgba(255,255,255,0.06)` dividers on desktop.
- **Sticky Nav**: transparent → `rgba(16,38,32,0.8)` + `backdrop-filter: blur(20px)` on scroll, 16px/500 white links tracked 0.4px, white pill CTA, 72px height.
- **Input**: `rgba(255,255,255,0.03)` fill, 1px `#3F3F46` border, 8px radius, Neon Green focus with 3px glow halo, 13px/500 `#A1A1AA` label above.
- **Badge**: `rgba(255,255,255,0.08)` + `blur(12px)` frost, 1px `rgba(255,255,255,0.1)` border, 6px radius, 13px/500 white text.