"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import {
  BarChart3,
  Boxes,
  ChevronRight,
  ChevronsUpDown,
  ClipboardList,
  DollarSign,
  FileClock,
  Gauge,
  Home,
  Key,
  LayoutDashboard,
  LineChart,
  Link2,
  Megaphone,
  HandCoins,
  PackageCheck,
  PackageOpen,
  PackageSearch,
  Percent,
  PhoneCall,
  Plug,
  Send,
  Server,
  Settings,
  ShoppingBag,
  Store,
  Target,
  Truck,
  UserPlus,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { prefetchForRoute } from "./prefetch";
import { Avatar } from "@/components/ui/Avatar";
import { AlertsBell } from "@/components/alerts/AlertsBell";
import { MarketScopeSwitcher } from "@/components/layout/MarketScopeSwitcher";
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
  | "finances"
  | "clients"
  | "equipe"
  | "systeme";

type BadgeTone = "neutral" | "warning" | "critical";

interface NavItemDef {
  /** i18n key under `nav.items.*` */
  key: string;
  /** Full href relative to `/{locale}/`, may include query string */
  href: string;
  icon: LucideIcon;
  /** Prefetch hint — usually matches the base route segment */
  prefetchRoute?: string;
  showBadge?: boolean;
}

interface NavSection {
  id: NavSectionId;
  icon: LucideIcon;
  items: NavItemDef[];
  /** Visible only to super_admin */
  superAdminOnly?: boolean;
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
    ],
  },
  {
    id: "logistique",
    icon: Warehouse,
    items: [
      { key: "preparation", href: "warehouse/preparation", icon: PackageSearch, prefetchRoute: "warehouse" },
      { key: "dispatch", href: "warehouse/dispatch", icon: PackageCheck, prefetchRoute: "warehouse" },
      { key: "returns", href: "warehouse/returns", icon: PackageOpen, prefetchRoute: "warehouse" },
      { key: "carrierTracking", href: "warehouse/carrier-tracking", icon: Truck, prefetchRoute: "warehouse" },
      { key: "inDeliveryBoard", href: "in-delivery", icon: Gauge, prefetchRoute: "in-delivery" },
      { key: "warehouseJournal", href: "warehouse/history", icon: FileClock, prefetchRoute: "warehouse" },
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
      { key: "adSpend", href: "finance/ad-spend", icon: Megaphone },
      { key: "investors", href: "finance/investors", icon: HandCoins },
    ],
  },
  {
    id: "clients",
    icon: Users,
    items: [
      { key: "activeProspects", href: "leads", icon: Target, prefetchRoute: "leads" },
      { key: "followUps", href: "follow-ups", icon: ClipboardList, prefetchRoute: "follow-ups" },
    ],
  },
  {
    id: "equipe",
    icon: Gauge,
    defaultExpanded: true,
    items: [
      {
        key: "inConfirmation",
        href: "confirmation-flow",
        icon: PhoneCall,
        prefetchRoute: "confirmation-flow",
      },
      { key: "performanceLive", href: "team", icon: BarChart3, prefetchRoute: "team" },
      { key: "access", href: "users", icon: UserPlus, prefetchRoute: "users" },
    ],
  },
  {
    id: "systeme",
    icon: Server,
    superAdminOnly: true,
    items: [
      { key: "marketsConfig", href: "markets", icon: Store, prefetchRoute: "markets" },
      { key: "storefrontsConfig", href: "settings/storefronts", icon: ShoppingBag, prefetchRoute: "settings" },
      { key: "mappings", href: "mappings", icon: Link2, prefetchRoute: "mappings" },
      { key: "carriersConfig", href: "settings/carriers", icon: Truck, prefetchRoute: "settings" },
      { key: "integrations", href: "settings/integrations", icon: Plug, prefetchRoute: "settings" },
      { key: "generalSettings", href: "settings/general", icon: Settings, prefetchRoute: "settings" },
      { key: "logs", href: "admin/logs", icon: Key, prefetchRoute: "admin" },
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
    if (
      section.items.some((item) =>
        isItemActive(`/${locale}/${item.href}`, activePath, activeSearch),
      )
    ) {
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
    });
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
          const showDividerBefore = section.superAdminOnly && idx > 0;
          const sectionUnassignedBadge =
            section.items.some((i) => i.showBadge) && liveCount !== undefined
              ? liveCount
              : 0;
          const sectionBadge = sectionUnassignedBadge > 0 ? sectionUnassignedBadge : undefined;
          const sectionBadgeTone: BadgeTone = sectionUnassignedBadge > 0 ? "warning" : "neutral";

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
                adminLabel={section.superAdminOnly ? t("adminOnly") : undefined}
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
                    const itemBadgeCount = item.showBadge ? liveCount : undefined;
                    const itemBadgeTone: BadgeTone = item.showBadge ? "warning" : "neutral";
                    return (
                      <li key={item.key}>
                        <SubNavItem
                          href={fullHref}
                          label={t(`items.${item.key}`)}
                          icon={item.icon}
                          isActive={isItemActive(fullHref, activePath, activeSearch)}
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
