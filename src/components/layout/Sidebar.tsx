"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import { useOrphanUnreadCount } from "@/hooks/useOrphanConversations";
import {
  MessageCircle,
  BarChart3,
  Boxes,
  ChevronRight,
  ChevronsUpDown,
  CopyCheck,
  DollarSign,
  FileClock,
  Gauge,
  Home,
  LayoutDashboard,
  LineChart,
  Megaphone,
  HandCoins,
  ReceiptText,
  PackageCheck,
  PackageOpen,
  PackageSearch,
  Percent,
  PhoneCall,
  Send,
  Server,
  Settings,
  ScrollText,
  ShoppingBag,
  Sun,
  Target,
  Truck,
  UserPlus,
  Users,
  Warehouse,
  type LucideIcon,
  MessageSquareQuote,
} from "lucide-react";
import { prefetchForRoute } from "./prefetch";
import { Avatar } from "@/components/ui/Avatar";
import { AlertsBell } from "@/components/alerts/AlertsBell";
import { MarketScopeSwitcher } from "@/components/layout/MarketScopeSwitcher";
import { useMarketScope } from "@/context/market-scope";
import { getPermissionsForRole } from "@/lib/user-permissions";
import { marketFlag } from "@/lib/markets";
import type { AuthUser } from "@/types";

interface SidebarProps {
  user: AuthUser;
  /** Optional override; normally resolved from usePathname() */
  currentPath?: string;
  unassignedCount?: number;
  /** When true on mobile (<768px), the drawer is open; otherwise it slides off-canvas. Desktop ignores this. */
  mobileOpen?: boolean;
  /** Called when user dismisses the drawer (backdrop click, Escape, or nav click on mobile). */
  onMobileClose?: () => void;
}

type NavSectionId =
  | "accueil"
  | "commandes"
  | "logistique"
  | "livraison"
  | "finances"
  | "clients"
  | "equipe"
  | "systeme";

type BadgeTone = "neutral" | "warning" | "critical" | "success";

interface NavItemDef {
  /** i18n key under `nav.items.*` */
  key: string;
  /** Full href relative to `/{locale}/`, may include query string */
  href: string;
  icon: LucideIcon;
  /** Prefetch hint — usually matches the base route segment */
  prefetchRoute?: string;
  showBadge?: boolean;
  /**
   * A second live count: unread orphan WhatsApp conversations (green), or the
   * Journaux problems still open (red, super_admin only).
   */
  badgeSource?: "whatsapp" | "journal";
  /** Visible only to super_admin, even when its section is shown to others. */
  superAdminOnly?: boolean;
  /**
   * Sub-pages that keep this item highlighted (relative to `/{locale}/`):
   * Clients › Messages stays active on its Modèles page.
   */
  activeOn?: string[];
  /**
   * Permission key from user-permissions; the ITEM is hidden when the role
   * lacks it, even though its section stays visible. Needed since Stock &
   * inventaire moved into Entrepôt: the group is open to every role, but the
   * page behind this one link is still super-admin only, and a link that
   * bounces you back to the dashboard is worse than no link.
   */
  requiresPermission?: "canViewFinances";
}

interface NavSection {
  id: NavSectionId;
  icon: LucideIcon;
  items: NavItemDef[];
  /** Visible only to super_admin */
  superAdminOnly?: boolean;
  /**
   * The admin block (Système): a divider before it and the « Admin » chip for
   * super_admin; any other role that sees it reads it — the section carries
   * the read-only note under its items.
   */
  admin?: boolean;
  /** Expanded by default on first mount */
  defaultExpanded?: boolean;
  /** Permission key from user-permissions; section hidden when role lacks it */
  requiresPermission?: "canViewFinances";
}

const NAV_SECTIONS: readonly NavSection[] = [
  {
    id: "accueil",
    icon: Home,
    defaultExpanded: true,
    items: [
      { key: "pulse", href: "dashboard", icon: LayoutDashboard, prefetchRoute: "dashboard" },
    ],
  },
  {
    id: "commandes",
    icon: ShoppingBag,
    items: [
      {
        key: "orders",
        href: "orders",
        icon: Send,
        prefetchRoute: "orders",
        showBadge: true,
      },
      {
        key: "archived",
        href: "orders/archive",
        icon: FileClock,
        prefetchRoute: "orders",
      },
      {
        key: "duplicates",
        href: "orders/duplicates",
        icon: CopyCheck,
        prefetchRoute: "orders",
      },
    ],
  },
  {
    /*
     * The warehouse day (2026-10-02, plans/entrepot-day-loop-redesign.md).
     *
     * Aujourd'hui is the four jobs — Sortir, Rentrer, Recevoir, Compter — each
     * a link carrying its backlog. It is not the « Aujourd'hui » removed on
     * 2026-09-08, which repeated other screens' figures and could not be
     * clicked. Sortir and Rentrer are where the floor works; Recevoir and
     * Compter live in Stock, which also holds the Journal.
     */
    id: "logistique",
    icon: Warehouse,
    items: [
      { key: "warehouseToday", href: "warehouse", icon: Sun, prefetchRoute: "warehouse" },
      { key: "warehouseOut", href: "warehouse/out", icon: PackageSearch, prefetchRoute: "warehouse", activeOn: ["warehouse/scan"] },
      { key: "warehouseReturns", href: "warehouse/returns", icon: PackageOpen, prefetchRoute: "warehouse" },
      {
        key: "warehouseStock",
        href: "warehouse/stock",
        icon: Boxes,
        prefetchRoute: "warehouse",
        activeOn: ["warehouse/stock", "warehouse/count"],
      },
    ],
  },
  {
    /*
     * Post-handover tracking. Split out of Entrepôt because the warehouse can
     * take no action on a parcel that has already left the building — keeping
     * these two here made the section list eight items across three different
     * audiences, and nothing in it read as primary.
     */
    id: "livraison",
    icon: Truck,
    items: [
      { key: "deliveryWorklist", href: "delivery", icon: PackageCheck, prefetchRoute: "delivery" },
      { key: "carrierTracking", href: "warehouse/carrier-tracking", icon: Truck, prefetchRoute: "warehouse" },
      { key: "inDeliveryBoard", href: "in-delivery", icon: Gauge, prefetchRoute: "in-delivery" },
    ],
  },
  {
    id: "finances",
    icon: LineChart,
    defaultExpanded: true,
    requiresPermission: "canViewFinances",
    items: [
      { key: "pnl", href: "dashboard/pnl", icon: DollarSign, prefetchRoute: "dashboard" },
      { key: "productsMargins", href: "products", icon: Percent, prefetchRoute: "products" },
      { key: "stockInventory", href: "dashboard/stock", icon: Boxes, prefetchRoute: "dashboard" },
      // Achats — ce qu'on doit aux fournisseurs et à qui on peut se fier.
      // Juste après le stock : c'est l'autre bout du même mouvement.
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
      // « Voix du client » — complaints, objections, suggestions (plans/voix-du-client.md).
      { key: "customerVoice", href: "feedback", icon: MessageSquareQuote, prefetchRoute: "feedback" },
      // WhatsApp replies nobody has claimed yet (managers + super_admin).
      // Its Modèles page lives under it and keeps it highlighted.
      { key: "messages", href: "messages", icon: MessageCircle, badgeSource: "whatsapp", activeOn: ["messages/templates"] },
    ],
  },
  {
    id: "equipe",
    icon: Gauge,
    defaultExpanded: true,
    items: [
      {
        key: "controlRoom",
        href: "team",
        icon: PhoneCall,
        prefetchRoute: "team",
      },
      { key: "performanceLive", href: "team/performance", icon: BarChart3, prefetchRoute: "team" },
      { key: "access", href: "users", icon: UserPlus, prefetchRoute: "users" },
    ],
  },
  {
    id: "systeme",
    icon: Server,
    admin: true,
    // Two entries (plans/reglages-redesign.md, 2026-10-02). Réglages is one
    // page organised by topic — Marchés, Boutiques, Commandes, Motifs de rejet,
    // Équipe, Entrepôts, Livraison, WhatsApp, Publicité — with its own menu; a
    // market_manager edits the day-to-day rules of their market there. The old
    // Marchés / Connexions / Paramètres routes redirect to their topic.
    // Journaux stays super_admin only.
    items: [
      { key: "reglages", href: "system/settings", icon: Settings, prefetchRoute: "settings", activeOn: ["system/settings"] },
      { key: "logs", href: "system/logs", icon: ScrollText, prefetchRoute: "admin", superAdminOnly: true, badgeSource: "journal" },
    ],
  },
];

const LY_MARKET_ID = "00000000-0000-0000-0000-000000000002";

function resolveMarketKey(marketId: string | null): "tn" | "ly" | "all" {
  if (marketId === LY_MARKET_ID) return "ly";
  if (marketId) return "tn";
  return "all";
}

function splitHref(href: string): { path: string; search: string } {
  const [path, search = ""] = href.split("?");
  return { path, search };
}

/**
 * A sub-tab is active when the URL's path matches the item's path AND every
 * query param the item declares is present (subset match). Extra filters in
 * the URL (e.g. ?q=text on top of ?preset=unassigned) leave the tab active.
 * A plain-path item (no query) matches on exact path regardless of query, so
 * /orders?preset=unassigned or /orders?open=<id> keep Commandes active.
 * Path-distinct siblings (/dashboard vs /dashboard/alerts) never double-activate.
 */
/** Exact item match, or one of its declared sub-pages (`activeOn`). */
function isNavItemActive(item: NavItemDef, locale: string, activePath: string, activeSearch: string): boolean {
  if (isItemActive(`/${locale}/${item.href}`, activePath, activeSearch)) return true;
  return (item.activeOn ?? []).some((p) => {
    const path = `/${locale}/${p}`;
    return activePath === path || activePath.startsWith(`${path}/`);
  });
}

function isItemActive(itemHref: string, activePath: string, activeSearch: string): boolean {
  const { path: itemPath, search: itemSearch } = splitHref(itemHref);
  if (activePath !== itemPath) return false;
  if (!itemSearch) return true;
  const itemParams = new URLSearchParams(itemSearch);
  const activeParams = new URLSearchParams(activeSearch);
  for (const [key, value] of itemParams.entries()) {
    if (activeParams.get(key) !== value) return false;
  }
  return true;
}

/**
 * Identify the one section that should be considered "primarily active" for the
 * current URL. Prefer an exact item match (including query subset match); only
 * fall back to the longest-prefix item path when no section has a direct match.
 * This prevents /dashboard/pnl from auto-expanding ACCUEIL (whose Dashboard item is
 * /dashboard) when FINANCES has a more specific item at /dashboard/pnl.
 */
function findActiveSectionId(
  sections: readonly NavSection[],
  activePath: string,
  activeSearch: string,
  locale: string,
): NavSectionId | null {
  for (const section of sections) {
    if (section.items.some((item) => isNavItemActive(item, locale, activePath, activeSearch))) {
      return section.id;
    }
  }
  let bestId: NavSectionId | null = null;
  let bestLen = -1;
  for (const section of sections) {
    for (const item of section.items) {
      const { path: itemPath } = splitHref(`/${locale}/${item.href}`);
      if (activePath === itemPath || activePath.startsWith(itemPath + "/")) {
        if (itemPath.length > bestLen) {
          bestLen = itemPath.length;
          bestId = section.id;
        }
      }
    }
  }
  return bestId;
}

export function Sidebar({ user, currentPath, unassignedCount, mobileOpen = false, onMobileClose }: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const rawSearchParams = useSearchParams();
  const searchString = rawSearchParams?.toString() ?? "";
  const activePath = currentPath ?? pathname ?? "";
  const activeSearch = searchString ? `?${searchString}` : "";
  const t = useTranslations("nav");
  const [menuOpen, setMenuOpen] = useState(false);
  const [userHovered, setUserHovered] = useState(false);
  const [logoutHovered, setLogoutHovered] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const visibleSections = useMemo(() => {
    const perms = new Map(getPermissionsForRole(user.role).map((p) => [p.key, p.allowed]));
    return NAV_SECTIONS.filter((s) => {
      if (s.superAdminOnly && user.role !== "super_admin") return false;
      if (s.requiresPermission && !perms.get(s.requiresPermission)) return false;
      return true;
    })
      .map((s) => {
        const items = s.items.filter(
          (i) =>
            (!i.requiresPermission || perms.get(i.requiresPermission)) &&
            (!i.superAdminOnly || user.role === "super_admin"),
        );
        return items.length === s.items.length ? s : { ...s, items };
      })
      .filter((s) => s.items.length > 0);
  }, [user.role]);

  const activeSectionId = useMemo(
    () => findActiveSectionId(visibleSections, activePath, activeSearch, user.locale),
    [visibleSections, activePath, activeSearch, user.locale],
  );

  const [expandedSections, setExpandedSections] = useState<Set<NavSectionId>>(() => {
    const initial = new Set<NavSectionId>();
    for (const section of NAV_SECTIONS) {
      if (section.defaultExpanded) initial.add(section.id);
    }
    if (activeSectionId) initial.add(activeSectionId);
    return initial;
  });

  useEffect(() => {
    if (!activeSectionId) return;
    setExpandedSections((prev) => {
      if (prev.has(activeSectionId)) return prev;
      const next = new Set(prev);
      next.add(activeSectionId);
      return next;
    });
  }, [activeSectionId]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!mobileOpen || !onMobileClose) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onMobileClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [mobileOpen, onMobileClose]);

  const isRtl = user.direction === "rtl";
  const marketParam = user.market_id ? `?market_id=${user.market_id}` : "";

  // SWR hooks MUST be called unconditionally before any early return
  const shouldFetch = unassignedCount === undefined;
  const countKey = shouldFetch ? `/api/orders/unassigned/count${marketParam}` : null;
  const { data: countData } = useSWR<{ count: number }>(countKey, {
    refreshInterval: 60000,
    revalidateOnFocus: false,
  });
  // The WhatsApp badge follows the market chosen in the switcher for a
  // super_admin (null = every market), and the manager's own market otherwise.
  const { marketId: scopeMarketId } = useMarketScope();
  const whatsappUnread = useOrphanUnreadCount(
    user.role === "super_admin" ? scopeMarketId : user.market_id,
    user.role === "super_admin" || user.role === "market_manager",
  );
  // Open Journaux problems — the only alert the journal raises (plan §7, decision 4).
  const { data: journalCounts } = useSWR<{ open: number; critical: number }>(
    user.role === "super_admin" ? "/api/admin/journal/counts" : null,
    fetcher,
    { refreshInterval: 60000, revalidateOnFocus: false },
  );
  const journalOpen = journalCounts?.open ?? 0;

  if (user.role === "agent" || user.role === "warehouse_agent") {
    return null;
  }

  const liveCount = unassignedCount !== undefined ? unassignedCount : countData?.count;

  const marketKey = resolveMarketKey(user.market_id);
  const marketName = t(`markets.${marketKey}`);
  const roleLabel = t(`roles.${user.role}`);

  const handleLogout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // network failure — still attempt to redirect to clear stale UI
    }
    router.replace(`/${user.locale}/login`);
  };

  const toggleSection = (id: NavSectionId) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      {mobileOpen && (
        <div
          className="sidebar-mobile-backdrop"
          aria-hidden="true"
          onClick={onMobileClose}
        />
      )}
      <nav
      className="sidebar-scroll sidebar-mobile-drawer"
      data-mobile-open={mobileOpen ? "true" : "false"}
      style={{
        width: "240px",
        minWidth: "240px",
        height: "100vh",
        backgroundColor: "var(--sidebar-bg)",
        display: "flex",
        flexDirection: "column",
        position: "fixed",
        top: 0,
        ...(isRtl ? { right: 0 } : { left: 0 }),
        overflowY: "auto",
        direction: isRtl ? "rtl" : "ltr",
        borderInlineEnd: "1px solid var(--sidebar-border)",
        fontFamily:
          "var(--font-sans), var(--font-sans-arabic), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* Brand area */}
      <div
        style={{
          height: "60px",
          display: "flex",
          alignItems: "center",
          // 10 again: dropping the 28px monogram gave the rail back the room it
          // needed for the market control and the bell.
          gap: "10px",
          paddingInline: "14px",
          borderBlockEnd: "1px solid var(--sidebar-border-strong)",
          flexShrink: 0,
        }}
      >
        {/* Wordmark only. The monogram said the same word in one letter, and on
            a 240px rail that also carries the market control and the bell it was
            the least informative thing competing for the width. */}
        <span
          role="presentation"
          style={{
            fontSize: "16px",
            fontWeight: 600,
            color: "var(--sidebar-text-strong)",
            letterSpacing: "-0.01em",
            lineHeight: "20px",
          }}
        >
          {t("brand")}
        </span>
        {user.role === "super_admin" ? (
          <MarketScopeSwitcher user={user} />
        ) : (
          <span
            data-testid="sidebar-market-pill"
            aria-label={t("markets.ariaLabel", { market: marketName })}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "12px",
              fontWeight: 500,
              color: "var(--sidebar-text-secondary)",
              paddingBlock: "3px",
              paddingInline: "8px",
              borderRadius: "9999px",
              border: "1px solid var(--sidebar-border-strong)",
              backgroundColor: "var(--sidebar-bg-elevated)",
              lineHeight: 1,
              whiteSpace: "nowrap",
            }}
          >
            {/* The flag, not a colour: the super_admin switcher two pixels away
                already named these same markets that way, and a dot in an
                unlearned colour named nothing. */}
            <span
              aria-hidden="true"
              style={{
                fontSize: "13px",
                lineHeight: 1,
                flexShrink: 0,
                fontFamily:
                  '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
              }}
            >
              {marketFlag(marketKey)}
            </span>
            {marketName}
          </span>
        )}
        <span style={{ marginInlineStart: "auto", display: "inline-flex" }}>
          <AlertsBell user={user} />
        </span>
      </div>

      {/* Nav sections */}
      <div style={{ flex: 1, paddingBlock: "10px", paddingInline: "8px" }}>
        {visibleSections.map((section, idx) => {
          const expanded = expandedSections.has(section.id);
          const active = activeSectionId === section.id;
          const showDividerBefore = (section.superAdminOnly || section.admin) && idx > 0;
          const sectionUnassignedBadge =
            section.items.some((i) => i.showBadge) && liveCount !== undefined
              ? liveCount
              : 0;
          const sectionWhatsAppBadge = section.items.some((i) => i.badgeSource === "whatsapp") ? whatsappUnread : 0;
          const sectionJournalBadge = section.items.some((i) => i.badgeSource === "journal") ? journalOpen : 0;
          const sectionBadge =
            sectionUnassignedBadge > 0
              ? sectionUnassignedBadge
              : sectionWhatsAppBadge > 0
                ? sectionWhatsAppBadge
                : sectionJournalBadge > 0
                  ? sectionJournalBadge
                  : undefined;
          const sectionBadgeTone: BadgeTone =
            sectionUnassignedBadge > 0
              ? "warning"
              : sectionWhatsAppBadge > 0
                ? "success"
                : sectionJournalBadge > 0
                  ? "critical"
                  : "neutral";

          return (
            <div key={section.id}>
              {showDividerBefore && (
                <div
                  aria-hidden="true"
                  style={{
                    height: "1px",
                    backgroundColor: "var(--sidebar-border-strong)",
                    marginBlock: "12px",
                    marginInline: "6px",
                  }}
                />
              )}
              <SectionHeader
                section={section}
                label={t(`sections.${section.id}`)}
                expanded={expanded}
                active={active}
                isRtl={isRtl}
                badge={sectionBadge}
                badgeTone={sectionBadgeTone}
                adminLabel={
                  section.superAdminOnly || (section.admin && user.role === "super_admin")
                    ? t("adminOnly")
                    : undefined
                }
                ariaLabel={
                  expanded
                    ? t("a11y.collapseSection", { section: t(`sections.${section.id}`) })
                    : t("a11y.expandSection", { section: t(`sections.${section.id}`) })
                }
                onToggle={() => toggleSection(section.id)}
              />
              {expanded && (
                <ul
                  role="list"
                  style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    paddingBlockStart: "2px",
                    paddingBlockEnd: "8px",
                  }}
                >
                  {section.items.map((item) => {
                    const fullHref = `/${user.locale}/${item.href}`;
                    const itemBadgeCount = item.showBadge
                      ? liveCount
                      : item.badgeSource === "whatsapp" && whatsappUnread > 0
                        ? whatsappUnread
                        : item.badgeSource === "journal" && journalOpen > 0
                          ? journalOpen
                          : undefined;
                    const itemBadgeTone: BadgeTone = item.showBadge
                      ? "warning"
                      : item.badgeSource === "whatsapp"
                        ? "success"
                        : item.badgeSource === "journal"
                          ? "critical"
                          : "neutral";
                    return (
                      <li key={item.key}>
                        <SubNavItem
                          href={fullHref}
                          label={t(`items.${item.key}`)}
                          icon={item.icon}
                          isActive={isNavItemActive(item, user.locale, activePath, activeSearch)}
                          badge={itemBadgeCount}
                          badgeTone={itemBadgeTone}
                          onPrefetch={() =>
                            item.prefetchRoute
                              ? prefetchForRoute(item.prefetchRoute, user)
                              : undefined
                          }
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {/* User block */}
      <div
        ref={menuRef}
        style={{
          padding: "10px 12px",
          borderBlockStart: "1px solid var(--sidebar-border-strong)",
          position: "relative",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          onMouseEnter={() => setUserHovered(true)}
          onMouseLeave={() => setUserHovered(false)}
          onFocus={() => setUserHovered(true)}
          onBlur={() => setUserHovered(false)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          style={{
            all: "unset",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            width: "100%",
            padding: "8px 10px",
            borderRadius: "8px",
            cursor: "pointer",
            textAlign: isRtl ? "right" : "left",
            backgroundColor: userHovered || menuOpen ? "var(--sidebar-hover)" : "transparent",
            transition: "background-color 160ms ease",
            boxSizing: "border-box",
          }}
        >
          <Avatar user={user} size={34} />
          <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
            <span
              style={{
                fontSize: "14px",
                fontWeight: 500,
                color: "var(--sidebar-text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                lineHeight: "18px",
              }}
            >
              {user.full_name}
            </span>
            <span
              style={{
                fontSize: "12px",
                fontWeight: 500,
                color: "var(--sidebar-text-secondary)",
                letterSpacing: "0.02em",
                textTransform: "capitalize",
                marginBlockStart: "2px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                lineHeight: "15px",
              }}
            >
              {roleLabel}
            </span>
          </span>
          <ChevronsUpDown
            size={15}
            strokeWidth={1.75}
            aria-hidden="true"
            style={{
              color: "var(--sidebar-text-muted)",
              flexShrink: 0,
              opacity: userHovered || menuOpen ? 1 : 0,
              transition: "opacity 160ms ease",
            }}
          />
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="sidebar-menu-enter"
            style={{
              position: "absolute",
              bottom: "calc(100% + 6px)",
              insetInlineStart: "12px",
              insetInlineEnd: "12px",
              backgroundColor: "var(--sidebar-bg-elevated)",
              border: "1px solid var(--sidebar-border-strong)",
              borderRadius: "8px",
              padding: "6px 0",
              zIndex: 10,
              boxShadow: "0 6px 24px rgba(0, 0, 0, 0.4)",
            }}
          >
            <div
              style={{
                padding: "6px 12px 8px",
                color: "var(--sidebar-text-muted)",
                fontSize: "13px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {user.email}
            </div>
            <div
              aria-hidden="true"
              style={{
                height: "1px",
                backgroundColor: "var(--sidebar-border-strong)",
                margin: "2px 0",
              }}
            />
            <button
              type="button"
              role="menuitem"
              onClick={handleLogout}
              onMouseEnter={() => setLogoutHovered(true)}
              onMouseLeave={() => setLogoutHovered(false)}
              disabled={signingOut}
              style={{
                all: "unset",
                display: "block",
                width: "100%",
                padding: "8px 12px",
                cursor: signingOut ? "not-allowed" : "pointer",
                color: "var(--sidebar-text)",
                fontSize: "14px",
                fontWeight: 500,
                boxSizing: "border-box",
                textAlign: isRtl ? "right" : "left",
                backgroundColor: logoutHovered ? "var(--sidebar-hover-strong)" : "transparent",
                transition: "background-color 160ms ease",
              }}
            >
              {t("logout")}
            </button>
          </div>
        )}
      </div>
    </nav>
    </>
  );
}

function badgeColors(tone: BadgeTone): { bg: string; fg: string } {
  if (tone === "critical") return { bg: "var(--badge-critical-bg)", fg: "var(--badge-critical-fg)" };
  if (tone === "success") return { bg: "var(--badge-success-bg)", fg: "var(--badge-success-fg)" };
  if (tone === "warning") return { bg: "var(--badge-warning-bg)", fg: "var(--badge-warning-fg)" };
  return { bg: "var(--badge-neutral-bg)", fg: "var(--badge-neutral-fg)" };
}

function BadgePill({ count, tone = "neutral" }: { count: number; tone?: BadgeTone }) {
  const { bg, fg } = badgeColors(tone);
  return (
    <span
      style={{
        backgroundColor: bg,
        color: fg,
        fontSize: "12px",
        fontWeight: 500,
        padding: "1px 7px",
        borderRadius: "9999px",
        minWidth: "20px",
        textAlign: "center",
        flexShrink: 0,
        fontVariantNumeric: "tabular-nums",
        lineHeight: "18px",
      }}
    >
      {count}
    </span>
  );
}

interface SectionHeaderProps {
  section: NavSection;
  label: string;
  expanded: boolean;
  active: boolean;
  isRtl: boolean;
  badge?: number;
  badgeTone?: BadgeTone;
  adminLabel?: string;
  ariaLabel: string;
  onToggle: () => void;
}

function SectionHeader({
  section,
  label,
  expanded,
  active,
  badge,
  badgeTone,
  adminLabel,
  ariaLabel,
  onToggle,
}: SectionHeaderProps) {
  const [hovered, setHovered] = useState(false);
  const Icon = section.icon;
  const textColor =
    active || hovered ? "var(--sidebar-text-strong)" : "var(--sidebar-text)";
  const iconColor = active
    ? "var(--sidebar-active-icon)"
    : hovered
      ? "var(--sidebar-text)"
      : "var(--sidebar-text-muted)";
  const chevronColor = hovered
    ? "var(--sidebar-text)"
    : "var(--sidebar-text-muted)";
  const background = hovered ? "var(--sidebar-hover-strong)" : "transparent";

  return (
    <button
      type="button"
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-expanded={expanded}
      aria-label={ariaLabel}
      data-section-id={section.id}
      style={{
        all: "unset",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        width: "100%",
        height: "36px",
        paddingInlineStart: "10px",
        paddingInlineEnd: "10px",
        fontSize: "12px",
        fontWeight: 600,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: textColor,
        backgroundColor: background,
        cursor: "pointer",
        borderRadius: "6px",
        transition: "background-color 160ms ease, color 160ms ease",
      }}
    >
      <Icon
        size={17}
        strokeWidth={1.75}
        aria-hidden="true"
        style={{ color: iconColor, flexShrink: 0, transition: "color 160ms ease" }}
      />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      {adminLabel && (
        <span
          style={{
            fontSize: "10px",
            fontWeight: 500,
            letterSpacing: "0.08em",
            color: "var(--sidebar-text-secondary)",
            padding: "1px 6px",
            border: "1px solid var(--sidebar-border-strong)",
            borderRadius: "4px",
            backgroundColor: "var(--sidebar-bg-elevated)",
          }}
        >
          {adminLabel}
        </span>
      )}
      {!expanded && badge !== undefined && <BadgePill count={badge} tone={badgeTone} />}
      <ChevronRight
        size={15}
        strokeWidth={2}
        aria-hidden="true"
        className="sidebar-chevron"
        data-expanded={expanded ? "true" : "false"}
        style={{ color: chevronColor, flexShrink: 0 }}
      />
    </button>
  );
}

interface SubNavItemProps {
  href: string;
  label: string;
  icon: LucideIcon;
  isActive: boolean;
  badge?: number;
  badgeTone?: BadgeTone;
  onPrefetch?: () => void;
}

function SubNavItem({
  href,
  label,
  icon: Icon,
  isActive,
  badge,
  badgeTone,
  onPrefetch,
}: SubNavItemProps) {
  const [hovered, setHovered] = useState(false);
  const router = useRouter();
  const prefetchedRef = useRef(false);

  const handleMouseEnter = () => {
    setHovered(true);
    if (!prefetchedRef.current) {
      prefetchedRef.current = true;
      router.prefetch(href);
      onPrefetch?.();
    }
  };

  // The active item is a filled brand pill, not a 10% wash behind a 2px bar.
  // The wash sat only ~1.2:1 above the sidebar ground, so at a glance the bar
  // was doing all the work and the row itself read as inactive. A filled pill
  // states it once, loudly, and puts the label at 5.0:1 on --brand.
  // On the fill, not on the ground — so the icon takes the same white as the
  // label. --sidebar-active-icon stays green for section headers, which never fill.
  const iconColor = isActive
    ? "var(--sidebar-active-text)"
    : hovered
      ? "var(--brand-on-dark)"
      : "var(--sidebar-text-muted)";
  const background = isActive
    ? "var(--sidebar-active-fill)"
    : hovered
      ? "var(--sidebar-hover)"
      : "transparent";
  const textColor = isActive
    ? "var(--sidebar-active-text)"
    : "var(--sidebar-text)";

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setHovered(false)}
      onFocus={handleMouseEnter}
      className="sidebar-subitem"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        height: "34px",
        paddingInlineStart: "30px",
        paddingInlineEnd: "12px",
        marginInline: "2px",
        marginBlock: "1px",
        fontSize: "14px",
        fontWeight: isActive ? 600 : 400,
        color: textColor,
        textDecoration: "none",
        backgroundColor: background,
        borderRadius: "8px",
        transition: "background-color 160ms ease, color 160ms ease",
      }}
    >
      <Icon
        size={15}
        strokeWidth={1.75}
        aria-hidden="true"
        className="sidebar-subitem-icon"
        style={{ color: iconColor, flexShrink: 0 }}
      />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      {badge !== undefined && <BadgePill count={badge} tone={badgeTone} />}
    </Link>
  );
}
