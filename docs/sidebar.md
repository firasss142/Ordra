# Sidebar (manager + super_admin)

Built 2026-10-03 from `prototypes/sidebar-v2.html` (v1 = the audit of the old bar). Agents,
warehouse agents and investors have their own shells and no sidebar.

## Where things live
- `src/lib/navigation/sidebar-nav.ts` — the nav as data: `TOP_ITEMS` (Dashboard),
  `NAV_GROUPS`, `visibleNav(role)`, `isNavItemActive`, `findActiveGroupId`, `groupBadgeSource`.
  Every icon is used once (a test enforces it).
- `src/lib/navigation/sidebar-prefs.ts` — localStorage: folded groups
  (`ordra.sidebar.collapsed`) and the rail choice (`ordra.sidebar.rail`). Every read tolerates
  blocked storage.
- `src/components/layout/SidebarFrame.tsx` — used by `DashboardChrome` and the Entrepôt manager
  shell. Owns the rail choice (person's, else rail below 1280 px) and the phone drawer; sets
  `--sidebar-w` for the page margin.
- `src/components/layout/Sidebar.tsx` — full bar, rail with fly-outs, phone top bar, ⌘K.
- `src/components/layout/sidebar/` — `MarketSwitcher` (card / rail / phone chip + sheet),
  `MarketFlag` (SVG), `NavBadge`, `GoToPalette`, `SidebarUserMenu`.
- Styles: `.sb-*` block in `globals.css` (px values: the root font is 14px).

## Rules
- Head and foot never scroll; the list does.
- A folded group lifts its count onto its label; the group of the current page always opens
  (and stays open in the saved state).
- The Commandes count follows the super_admin's chosen market (it used to count all markets
  whatever the choice; the WhatsApp count already followed it).
- The market list shows unassigned orders per market (`/api/orders/unassigned/count?market_id=`),
  fetched only once the list has been opened. Keys 1 · 2 · 3 switch while it is open.
- « Aller à… » searches the bar's pages (accent-insensitive) and offers market switches to a
  super_admin. Finding an order is a different feature.
- `[` toggles the rail (not while typing, not on a phone).
- « Tableau livraison » (/in-delivery) left the bar: the /delivery board replaces it; the page
  stays reachable by URL until the suivi-livraison deletion phase.
