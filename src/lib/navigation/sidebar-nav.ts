import {
  Activity,
  Archive,
  BarChart3,
  Boxes,
  Repeat,
  Filter,
  HandCoins,
  Headset,
  Inbox,
  LayoutDashboard,
  Layers,
  Megaphone,
  MessageCircle,
  MessageSquareQuote,
  PackageCheck,
  PackageOpen,
  PackagePlus,
  PackageSearch,
  Percent,
  PhoneCall,
  ReceiptText,
  Route,
  ScrollText,
  Settings,
  ShoppingBag,
  SlidersHorizontal,
  Sun,
  Target,
  TrendingUp,
  Truck,
  UserCog,
  Users,
  Wallet,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { getPermissionsForRole } from "@/lib/user-permissions";
import type { Role } from "@/types";

/*
 * The manager / super_admin sidebar as data (prototypes/sidebar-v2.html).
 *
 * Dashboard stands alone above the groups: « Accueil » was a foldable group
 * holding one link. Every icon is used once — a truck, a gauge and a box each
 * meant two things before, and the P&L of a business that counts in TND and
 * LYD was a dollar sign. Group icons only show in the 64 px rail; the full bar
 * labels its groups with text alone.
 */

export type NavGroupId =
  | "commandes"
  | "logistique"
  | "livraison"
  | "performance"
  | "finances"
  | "clients"
  | "equipe"
  | "systeme";

/** A live count a link can carry. */
export type BadgeSource = "unassigned" | "whatsapp" | "journal";
export type BadgeTone = "warning" | "success" | "critical";
export const BADGE_TONE: Record<BadgeSource, BadgeTone> = {
  unassigned: "warning",
  whatsapp: "success",
  journal: "critical",
};
export type BadgeCounts = Record<BadgeSource, number>;

export interface NavItemDef {
  /** i18n key under `nav.items.*` */
  key: string;
  /** Relative to `/{locale}/`, may include a query string */
  href: string;
  icon: LucideIcon;
  /** Prefetch hint — usually the base route segment */
  prefetchRoute?: string;
  badge?: BadgeSource;
  /** Visible only to super_admin, even when its group is shown to others. */
  superAdminOnly?: boolean;
  /** Sub-pages that keep this item highlighted (relative to `/{locale}/`). */
  activeOn?: string[];
  /** Hidden when the role lacks the permission, though its group stays. */
  requiresPermission?: "canViewFinances";
}

export interface NavGroupDef {
  id: NavGroupId;
  /** Shown in the rail only. */
  icon: LucideIcon;
  items: NavItemDef[];
  requiresPermission?: "canViewFinances";
  /** The admin block: a hairline before it. */
  admin?: boolean;
}

export const TOP_ITEMS: readonly NavItemDef[] = [
  { key: "pulse", href: "dashboard", icon: LayoutDashboard, prefetchRoute: "dashboard" },
];

export const NAV_GROUPS: readonly NavGroupDef[] = [
  {
    id: "commandes",
    icon: ShoppingBag,
    items: [
      { key: "orders", href: "orders", icon: Inbox, prefetchRoute: "orders", badge: "unassigned" },
      { key: "archived", href: "orders/archive", icon: Archive, prefetchRoute: "orders" },
      { key: "duplicates", href: "orders/duplicates", icon: Repeat, prefetchRoute: "orders" },
    ],
  },
  {
    // The warehouse day (plans/entrepot-aurore-redesign.md): Aujourd'hui is the
    // four jobs; Sortir, Rentrer and Recevoir are worked from; Compter and the
    // Journal live in Stock. Recevoir was a tab hidden in Stock until 2026-10-05 —
    // and no reception had ever been settled.
    id: "logistique",
    icon: Warehouse,
    items: [
      { key: "warehouseToday", href: "warehouse", icon: Sun, prefetchRoute: "warehouse" },
      { key: "warehouseOut", href: "warehouse/out", icon: PackageSearch, prefetchRoute: "warehouse", activeOn: ["warehouse/scan"] },
      { key: "warehouseReturns", href: "warehouse/returns", icon: PackageOpen, prefetchRoute: "warehouse" },
      { key: "warehouseReceive", href: "warehouse/receive", icon: PackagePlus, prefetchRoute: "warehouse" },
      { key: "warehouseStock", href: "warehouse/stock", icon: Boxes, prefetchRoute: "warehouse", activeOn: ["warehouse/stock", "warehouse/count"] },
    ],
  },
  {
    // After the parcel leaves: the worklist (which parcel to act on now).
    // Suivi transporteur and Tableau livraison were retired 2026-10-03
    // (docs/carrier-scorecard.md); Transporteurs moved to Performance.
    id: "livraison",
    icon: Truck,
    items: [{ key: "deliveryWorklist", href: "delivery", icon: PackageCheck, prefetchRoute: "delivery" }],
  },
  {
    // One section for judging a period, by question (owner, 2026-10-04 —
    // plans/performance-commandes.md): where orders are lost, how the team
    // does, how delivery does. The pages to act on today stay in their groups.
    id: "performance",
    icon: Activity,
    items: [
      { key: "perfOrders", href: "performance/orders", icon: Filter, prefetchRoute: "performance" },
      { key: "perfTeam", href: "team/performance", icon: BarChart3, prefetchRoute: "team" },
      { key: "perfDelivery", href: "carriers", icon: Route, activeOn: ["carriers"] },
    ],
  },
  {
    id: "finances",
    icon: Wallet,
    requiresPermission: "canViewFinances",
    items: [
      { key: "pnl", href: "dashboard/pnl", icon: TrendingUp, prefetchRoute: "dashboard" },
      { key: "productsMargins", href: "products", icon: Percent, prefetchRoute: "products" },
      { key: "stockInventory", href: "dashboard/stock", icon: Layers, prefetchRoute: "dashboard" },
      { key: "purchases", href: "finance/purchases", icon: ReceiptText },
      { key: "adSpend", href: "finance/ad-spend", icon: Megaphone },
      { key: "investors", href: "finance/investors", icon: HandCoins },
    ],
  },
  {
    id: "clients",
    icon: Users,
    items: [
      { key: "activeProspects", href: "leads", icon: Target, prefetchRoute: "leads" },
      { key: "customerVoice", href: "feedback", icon: MessageSquareQuote, prefetchRoute: "feedback" },
      // WhatsApp replies nobody has claimed yet; its Modèles page keeps it lit.
      { key: "messages", href: "messages", icon: MessageCircle, badge: "whatsapp", activeOn: ["messages/templates"] },
    ],
  },
  {
    id: "equipe",
    icon: Headset,
    items: [
      { key: "controlRoom", href: "team", icon: PhoneCall, prefetchRoute: "team" },
      { key: "access", href: "users", icon: UserCog, prefetchRoute: "users" },
    ],
  },
  {
    // Réglages is one page by topic (plans/reglages-redesign.md); Journaux stays super_admin.
    id: "systeme",
    icon: Settings,
    admin: true,
    items: [
      { key: "reglages", href: "system/settings", icon: SlidersHorizontal, prefetchRoute: "settings", activeOn: ["system/settings"] },
      { key: "logs", href: "system/logs", icon: ScrollText, prefetchRoute: "admin", superAdminOnly: true, badge: "journal" },
    ],
  },
];

/** Roles with their own shell (agent, entrepôt, investor) get no sidebar. */
const SIDEBAR_ROLES: readonly Role[] = ["super_admin", "market_manager"];

export interface VisibleNav {
  top: readonly NavItemDef[];
  groups: readonly NavGroupDef[];
}

export function visibleNav(role: Role): VisibleNav {
  if (!SIDEBAR_ROLES.includes(role)) return { top: [], groups: [] };
  const perms = new Map(getPermissionsForRole(role).map((p) => [p.key, p.allowed]));
  const allowed = (i: NavItemDef) =>
    (!i.requiresPermission || perms.get(i.requiresPermission)) &&
    (!i.superAdminOnly || role === "super_admin");
  const groups = NAV_GROUPS.filter((g) => !g.requiresPermission || perms.get(g.requiresPermission))
    .map((g) => {
      const items = g.items.filter(allowed);
      return items.length === g.items.length ? g : { ...g, items };
    })
    .filter((g) => g.items.length > 0);
  return { top: TOP_ITEMS.filter(allowed), groups };
}

/** Every visible link with its group — the « Aller à… » list. */
export function flattenNav(nav: VisibleNav): { item: NavItemDef; groupId: NavGroupId | null }[] {
  return [
    ...nav.top.map((item) => ({ item, groupId: null })),
    ...nav.groups.flatMap((g) => g.items.map((item) => ({ item, groupId: g.id }))),
  ];
}

function splitHref(href: string): { path: string; search: string } {
  const [path, search = ""] = href.split("?");
  return { path, search };
}

/**
 * Active when the URL's path equals the item's AND every query param the item
 * declares is present (extra filters in the URL keep it active), or when the
 * URL is one of the item's declared sub-pages.
 */
export function isNavItemActive(item: NavItemDef, locale: string, activePath: string, activeSearch: string): boolean {
  const { path, search } = splitHref(`/${locale}/${item.href}`);
  if (activePath === path) {
    if (!search) return true;
    const want = new URLSearchParams(search);
    const have = new URLSearchParams(activeSearch);
    let all = true;
    want.forEach((value, key) => {
      if (have.get(key) !== value) all = false;
    });
    if (all) return true;
  }
  return (item.activeOn ?? []).some((p) => {
    const sub = `/${locale}/${p}`;
    return activePath === sub || activePath.startsWith(`${sub}/`);
  });
}

/**
 * The group holding the current page, or null (Dashboard, or no match). An
 * exact match anywhere wins over a prefix, so /dashboard/pnl lands in Finances
 * rather than under Dashboard's /dashboard.
 */
export function findActiveGroupId(nav: VisibleNav, locale: string, activePath: string, activeSearch: string): NavGroupId | null {
  const entries = flattenNav(nav);
  const exact = entries.find((e) => isNavItemActive(e.item, locale, activePath, activeSearch));
  if (exact) return exact.groupId;
  let best: NavGroupId | null = null;
  let bestLen = -1;
  for (const e of entries) {
    const { path } = splitHref(`/${locale}/${e.item.href}`);
    if (activePath.startsWith(`${path}/`) && path.length > bestLen) {
      bestLen = path.length;
      best = e.groupId;
    }
  }
  return best;
}

/** The count a folded group shows on its label — same precedence as before. */
export function groupBadgeSource(group: NavGroupDef, counts: BadgeCounts): BadgeSource | null {
  for (const src of ["unassigned", "whatsapp", "journal"] as const) {
    if (group.items.some((i) => i.badge === src) && counts[src] > 0) return src;
  }
  return null;
}
