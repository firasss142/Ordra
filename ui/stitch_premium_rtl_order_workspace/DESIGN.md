---
name: Emerald Minimalist RTL
colors:
  surface: '#f4fbf4'
  surface-dim: '#d4dcd5'
  surface-bright: '#f4fbf4'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eef6ee'
  surface-container: '#e8f0e9'
  surface-container-high: '#e3eae3'
  surface-container-highest: '#dde4dd'
  on-surface: '#161d19'
  on-surface-variant: '#3c4a42'
  inverse-surface: '#2b322d'
  inverse-on-surface: '#ebf3eb'
  outline: '#6c7a71'
  outline-variant: '#bbcabf'
  surface-tint: '#006c49'
  primary: '#006c49'
  on-primary: '#ffffff'
  primary-container: '#10b981'
  on-primary-container: '#00422b'
  inverse-primary: '#4edea3'
  secondary: '#5e5e5e'
  on-secondary: '#ffffff'
  secondary-container: '#e2e2e2'
  on-secondary-container: '#646464'
  tertiary: '#a43a3a'
  on-tertiary: '#ffffff'
  tertiary-container: '#fc7c78'
  on-tertiary-container: '#711419'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#6ffbbe'
  primary-fixed-dim: '#4edea3'
  on-primary-fixed: '#002113'
  on-primary-fixed-variant: '#005236'
  secondary-fixed: '#e2e2e2'
  secondary-fixed-dim: '#c6c6c6'
  on-secondary-fixed: '#1b1b1b'
  on-secondary-fixed-variant: '#474747'
  tertiary-fixed: '#ffdad7'
  tertiary-fixed-dim: '#ffb3af'
  on-tertiary-fixed: '#410005'
  on-tertiary-fixed-variant: '#842225'
  background: '#f4fbf4'
  on-background: '#161d19'
  surface-variant: '#dde4dd'
typography:
  display-lg:
    fontFamily: Cairo
    fontSize: 40px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Cairo
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  title-sm:
    fontFamily: Cairo
    fontSize: 18px
    fontWeight: '600'
    lineHeight: '1.4'
  body-base:
    fontFamily: Cairo
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body-sm:
    fontFamily: Cairo
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-caps:
    fontFamily: Cairo
    fontSize: 12px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: 0.05em
  headline-md-mobile:
    fontFamily: Cairo
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.3'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  container-margin: 32px
  gutter: 24px
  section-gap: 48px
  internal-padding: 16px
---

## Brand & Style
The design system is centered on high-efficiency productivity for the Middle Eastern market. It merges the technical precision of Linear with the sophisticated fluidity of Stripe, adapted specifically for Right-to-Left (RTL) workflows. 

The aesthetic is **Premium Minimalism**. It prioritizes extreme clarity, using "negative space" as a functional tool rather than just a visual choice. The emotional response is one of calm control and reliability. The interface feels lightweight and fast, utilizing glass-like surfaces to create a sense of digital airiness, while deep black structural elements provide the necessary grounding for an order management environment.

## Colors
The palette is intentionally restrained to maintain focus on data and actions.
- **Primary:** A premium Emerald Green (#10B981) used exclusively for success states, primary CTA buttons, and active navigational markers.
- **Neutral/Structural:** Deep Black (#000000) is used for headers, primary text, and high-contrast iconography to create a strong visual anchor.
- **Backgrounds:** Pure White (#FFFFFF) is the foundation, ensuring the interface feels clinical and modern.
- **Borders:** A consistent light grey (#F1F1F1) provides subtle containment without creating visual noise.
- **Translucency:** Glass-like surfaces use high-opacity white with a subtle backdrop blur (20px) to simulate depth in overlays and sidebars.

## Typography
Cairo is chosen for its exceptional RTL legibility and modern geometric construction. The typographic scale is "elegant," meaning we favor slightly larger line heights to accommodate Arabic script descenders and ascenders without crowding the lines.

For the dashboard, use **Bold** weights for numbers and order IDs to ensure they pop against the white background. Medium weights should be used for navigation labels, while Regular is reserved for long-form data and descriptions.

## Layout & Spacing
The layout follows a **Fixed-Fluid Hybrid** model. The sidebar is fixed (280px), while the main content area utilizes a fluid 12-column grid. 

**RTL Logic:** All horizontal alignments are reversed. The primary navigation resides on the right, and the content flows from right to left.
- **Margins:** 32px standard page margins to provide "breathing room" typical of premium SaaS.
- **Whitespace:** Use generous 48px gaps between major dashboard sections (e.g., between the "Quick Stats" and the "Order Table").
- **Table Density:** Order tables should use a "Spacious" vertical rhythm (16px padding per row) to prevent data fatigue.

## Elevation & Depth
This design system avoids heavy drop shadows in favor of **Layered Minimalism**.
- **Level 0 (Base):** Pure white background.
- **Level 1 (Cards/Containers):** Defined by a 1px #F1F1F1 border. No shadow.
- **Level 2 (Active/Floating):** Used for dropdowns and modals. Features a very soft, diffused shadow (`0 8px 30px rgba(0,0,0,0.04)`) and a glassmorphic backdrop blur of 20px.
- **Interaction Depth:** On hover, cards should subtly lift using a slightly more pronounced shadow rather than a border color change.

## Shapes
A consistent **16px (1rem) corner radius** is applied to all primary containers, buttons, and input fields. This high degree of roundedness softens the minimalist aesthetic, making the interface feel approachable and modern. 

- **Small Components:** Tags and chips use a "Pill" shape (full rounding) to contrast with the 16px structural containers.
- **Inner Padding:** Ensure internal element padding follows the 4px unit rule (usually 16px or 24px) to complement the rounded exterior.

## Components
- **Buttons:** Primary buttons are Emerald Green with white text. They feature a subtle inner-glow on hover. Secondary buttons use a black border (1px) with black text.
- **Input Fields:** Use a subtle grey background (#F9F9F9) that turns pure white with a 1px black border on focus. Labels are always right-aligned above the field.
- **Order Cards:** Feature a glass-like header with a thin bottom border. Status indicators (e.g., "Shipped") use the Emerald Green in a low-opacity ghost-tag format.
- **Data Tables:** No vertical lines. Only horizontal dividers (#F1F1F1). The header row uses the `label-caps` typography style in a muted grey.
- **Micro-interactions:** Transitions for sidebar collapses and modal entries should use a custom Cubic Bezier `(0.4, 0, 0.2, 1)` for a "slick" high-end feel.