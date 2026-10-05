# UI Components — Rules

## Design system
- Read docs/design-system.md before building any component — it is « Aurore » since
  2026-10-04 (aurora ground, glass cards, four colour vocabularies) and « Aurore calme »
  since 2026-10-05. The old "black/white only, zero gradients, zero shadows" rules are
  superseded; the doc wins.

## Patterns
- Tailwind utilities for small pieces; a page-scoped stylesheet (e.g. `acces.css` under
  `.acx`) for a page's Aurore surfaces — design-system §7. Sizes in px (root font 14px)
- All text via next-intl useTranslations() — no hardcoded strings
- RTL support: use logical properties (ps/pe not pl/pr) or Tailwind RTL utilities
- Client Components for interactive elements (forms, queues, modals)
- Server Components for static layouts and initial data display

## Component structure
- ui/ → base components (Button, Input, Card, Badge, Modal, Toast, Select)
- layout/ → Sidebar, Topbar, NavItem
- shared/ → StatusBadge, DataTable, EmptyState, Pagination

## Testing
- Follow TDD: write component tests BEFORE building components
- Test real behavior, not mock existence (see testing-anti-patterns.md)
- Use @testing-library/react, query by role/text, not test IDs