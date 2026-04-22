# UI Components — Rules

## Design system
- Read docs/design-system.md before building any component
- System font stack, 14px base, black/white only, functional color on badges only
- Zero gradients, zero shadows at rest, zero decoration

## Patterns
- Use Tailwind utility classes, not custom CSS
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