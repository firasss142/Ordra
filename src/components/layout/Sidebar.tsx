"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import {
  BarChart3,
  Bell,
  Boxes,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ClipboardList,
  DollarSign,
  FileClock,
  Gauge,
  Home,
  Inbox,
  Key,
  LayoutDashboard,
  LineChart,
  Megaphone,
  PackageCheck,
  PackageOpen,
  PackageSearch,
  Percent,
  PhoneCall,
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
import type { AuthUser } from "@/types";

interface SidebarProps {
  user: AuthUser;
  /** Optional override; normally resolved from usePathname() */
  currentPath?: string;
  unassignedCount?: number;
}

type NavSectionId =
  | "accueil"
  | "commandes"
  | "logistique"
  | "finances"
  | "clients"
  | "equipe"
  | "systeme";

interface NavItemDef {
  /** i18n key under `nav.items.*` */
  key: string;
  /** Full href relative to `/{locale}/`, may include query string */
  href: string;
  icon: LucideIcon;
  /** Prefetch hint — usually matches the base route segment */
  prefetchRoute?: string;
  showBadge?: boolean;
  /** Show the live alerts count badge for this item */
  showAlertsBadge?: boolean;
}

interface NavSection {
  id: NavSectionId;
  icon: LucideIcon;
  items: NavItemDef[];
  /** Visible only to super_admin */
  superAdminOnly?: boolean;
  /** Expanded by default on first mount */
  defaultExpanded?: boolean;
}

const NAV_SECTIONS: readonly NavSection[] = [
  {
    id: "accueil",
    icon: Home,
    defaultExpanded: true,
    items: [
      { key: "pulse", href: "dashboard", icon: LayoutDashboard, prefetchRoute: "dashboard" },
      { key: "alertes", href: "dashboard/alerts", icon: Bell, prefetchRoute: "dashboard", showAlertsBadge: true },
    ],
  },
  {
    id: "commandes",
    icon: ShoppingBag,
    items: [
      { key: "toAssign", href: "orders?preset=unassigned", icon: Inbox, prefetchRoute: "orders", showBadge: true },
      {
        key: "inConfirmation",
        href: "orders?status=assigned,attempt_1,attempt_2,attempt_3,callback_scheduled",
        icon: PhoneCall,
        prefetchRoute: "orders",
      },
      {
        key: "toShip",
        href: "orders?status=confirmed,dispatch_scheduled,scanned",
        icon: PackageCheck,
        prefetchRoute: "orders",
      },
      {
        key: "inDelivery",
        href: "orders?status=dispatching,dispatched,deposit,in_transit,to_be_returned",
        icon: Send,
        prefetchRoute: "orders",
      },
      {
        key: "archived",
        href: "orders?status=delivered,returned,rejected,cancelled",
        icon: FileClock,
        prefetchRoute: "orders",
      },
    ],
  },
  {
    id: "logistique",
    icon: Warehouse,
    items: [
      { key: "preparation", href: "warehouse/to-label", icon: PackageSearch, prefetchRoute: "warehouse" },
      { key: "returns", href: "warehouse/returns", icon: PackageOpen, prefetchRoute: "warehouse" },
      { key: "carrierTracking", href: "warehouse/carrier-tracking", icon: Truck, prefetchRoute: "warehouse" },
      { key: "warehouseJournal", href: "warehouse/history", icon: FileClock, prefetchRoute: "warehouse" },
    ],
  },
  {
    id: "finances",
    icon: LineChart,
    defaultExpanded: true,
    items: [
      { key: "pnl", href: "dashboard/pnl", icon: DollarSign, prefetchRoute: "dashboard" },
      { key: "productsMargins", href: "products", icon: Percent, prefetchRoute: "products" },
      { key: "stockInventory", href: "dashboard/stock", icon: Boxes, prefetchRoute: "dashboard" },
      { key: "adSpend", href: "settings/ad-spend", icon: Megaphone, prefetchRoute: "settings" },
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
      { key: "performanceLive", href: "team", icon: BarChart3, prefetchRoute: "team" },
      { key: "access", href: "users", icon: UserPlus, prefetchRoute: "users" },
    ],
  },
  {
    id: "systeme",
    icon: Server,
    superAdminOnly: true,
    items: [
      { key: "marketsConfig", href: "settings?section=markets", icon: Store, prefetchRoute: "settings" },
      { key: "carriersConfig", href: "settings?section=carriers", icon: Truck, prefetchRoute: "settings" },
      { key: "generalSettings", href: "settings?section=general", icon: Settings, prefetchRoute: "settings" },
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
 * A plain-path item (no query) matches only on exact path + no query, so
 * siblings like /dashboard and /dashboard/alerts don't double-activate.
 */
function isItemActive(itemHref: string, activePath: string, activeSearch: string): boolean {
  const { path: itemPath, search: itemSearch } = splitHref(itemHref);
  if (activePath !== itemPath) return false;
  if (!itemSearch) return activeSearch === "";
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
 * This prevents /dashboard/pnl from auto-expanding ACCUEIL (whose Pulse item is
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

export function Sidebar({ user, currentPath, unassignedCount }: SidebarProps) {
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

  const visibleSections = useMemo(
    () => NAV_SECTIONS.filter((s) => !s.superAdminOnly || user.role === "super_admin"),
    [user.role],
  );

  const activeSectionId = useMemo(
    () => findActiveSectionId(visibleSections, activePath, activeSearch, user.locale),
    [visibleSections, activePath, activeSearch, user.locale],
  );

  const [expandedSections, setExpandedSections] = useState<Set<NavSectionId>>(() => {
    const initial = new Set<NavSectionId>();
    for (const section of NAV_SECTIONS) {
      if (section.defaultExpanded) initial.add(section.id);
    }
    // Eagerly expand the section containing the current URL on first render.
    if (activeSectionId) initial.add(activeSectionId);
    return initial;
  });

  // Keep the active section expanded when navigating (SPA transitions)
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

  const isRtl = user.direction === "rtl";
  const marketParam = user.market_id ? `?market_id=${user.market_id}` : "";

  // SWR hooks MUST be called unconditionally before any early return
  const shouldFetch = unassignedCount === undefined;
  const countKey = shouldFetch ? `/api/orders/unassigned/count${marketParam}` : null;
  const { data: countData } = useSWR<{ count: number }>(countKey, {
    refreshInterval: 60000,
    revalidateOnFocus: false,
  });

  const alertsKey = `/api/alerts/summary${marketParam}`;
  const { data: alertsSummaryData } = useSWR<{ total: number }>(alertsKey, {
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
    <nav
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
      }}
    >
      {/* Brand area */}
      <div
        style={{
          height: "56px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          paddingInline: "16px",
          borderBlockEnd: "1px solid var(--sidebar-hover)",
          flexShrink: 0,
        }}
      >
        <div
          role="presentation"
          style={{
            fontSize: "16px",
            fontWeight: 600,
            color: "#FFFFFF",
            letterSpacing: "0.02em",
            lineHeight: "20px",
          }}
        >
          {t("brand")}
        </div>
        <span
          aria-label={t("markets.ariaLabel", { market: marketName })}
          style={{
            fontSize: "11px",
            fontWeight: 500,
            color: "var(--sidebar-text-muted)",
            letterSpacing: "0.04em",
            marginBlockStart: "2px",
          }}
        >
          · {marketName}
        </span>
      </div>

      {/* Nav sections */}
      <div style={{ flex: 1, paddingBlock: "8px" }}>
        {visibleSections.map((section, idx) => {
          const expanded = expandedSections.has(section.id);
          const active = activeSectionId === section.id;
          const showDividerBefore = section.superAdminOnly && idx > 0;
          const sectionUnassignedBadge =
            section.items.some((i) => i.showBadge) && liveCount !== undefined
              ? liveCount
              : 0;
          const sectionAlertsBadge =
            section.items.some((i) => i.showAlertsBadge) && alertsSummaryData?.total !== undefined
              ? alertsSummaryData.total
              : 0;
          const sectionBadge =
            sectionUnassignedBadge + sectionAlertsBadge > 0
              ? sectionUnassignedBadge + sectionAlertsBadge
              : undefined;

          return (
            <div key={section.id}>
              {showDividerBefore && (
                <div
                  aria-hidden="true"
                  style={{
                    height: "1px",
                    backgroundColor: "var(--sidebar-hover)",
                    margin: "8px 16px",
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
                    paddingBlockEnd: "4px",
                  }}
                >
                  {section.items.map((item) => {
                    const fullHref = `/${user.locale}/${item.href}`;
                    return (
                      <li key={item.key}>
                        <SubNavItem
                          href={fullHref}
                          label={t(`items.${item.key}`)}
                          icon={item.icon}
                          isActive={isItemActive(fullHref, activePath, activeSearch)}
                          badge={
                            item.showBadge
                              ? liveCount
                              : item.showAlertsBadge
                                ? alertsSummaryData?.total
                                : undefined
                          }
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
          padding: "12px 16px",
          borderBlockStart: "1px solid var(--sidebar-hover)",
          position: "relative",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          onMouseEnter={() => setUserHovered(true)}
          onMouseLeave={() => setUserHovered(false)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          style={{
            all: "unset",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            width: "100%",
            padding: "4px",
            borderRadius: "6px",
            cursor: "pointer",
            textAlign: isRtl ? "right" : "left",
            backgroundColor: userHovered ? "var(--sidebar-hover)" : "transparent",
            transition: "background-color 120ms ease",
            boxSizing: "border-box",
          }}
        >
          <Avatar user={user} size={32} />
          <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
            <span
              style={{
                fontSize: "13px",
                fontWeight: 500,
                color: "var(--sidebar-text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {user.full_name}
            </span>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 500,
                color: "var(--sidebar-text-muted)",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                marginBlockStart: "1px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {roleLabel}
            </span>
          </span>
          <ChevronsUpDown
            size={14}
            strokeWidth={1.5}
            aria-hidden="true"
            style={{ color: "var(--sidebar-text-muted)", flexShrink: 0 }}
          />
        </button>

        {menuOpen && (
          <div
            role="menu"
            style={{
              position: "absolute",
              bottom: "calc(100% + 4px)",
              left: "16px",
              right: "16px",
              backgroundColor: "var(--sidebar-hover)",
              border: "1px solid var(--sidebar-active)",
              borderRadius: "6px",
              padding: "8px 0",
              zIndex: 10,
            }}
          >
            <div
              style={{
                padding: "4px 12px 8px",
                color: "var(--sidebar-text-muted)",
                fontSize: "12px",
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
                backgroundColor: "var(--sidebar-active)",
                margin: "4px 0",
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
                fontSize: "13px",
                boxSizing: "border-box",
                textAlign: isRtl ? "right" : "left",
                backgroundColor: logoutHovered ? "var(--sidebar-active)" : "transparent",
                transition: "background-color 120ms ease",
              }}
            >
              {t("logout")}
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}

function BadgePill({ count }: { count: number }) {
  return (
    <span
      style={{
        backgroundColor: "var(--neutral-bg)",
        color: "var(--neutral)",
        fontSize: "0.7rem",
        fontWeight: 500,
        padding: "1px 7px",
        borderRadius: "9999px",
        minWidth: "18px",
        textAlign: "center",
        flexShrink: 0,
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
  adminLabel?: string;
  ariaLabel: string;
  onToggle: () => void;
}

function SectionHeader({
  section,
  label,
  expanded,
  active,
  isRtl,
  badge,
  adminLabel,
  ariaLabel,
  onToggle,
}: SectionHeaderProps) {
  const [hovered, setHovered] = useState(false);
  const Icon = section.icon;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const textColor = active ? "#FFFFFF" : "var(--sidebar-text)";
  const iconColor = active
    ? "#FFFFFF"
    : hovered
      ? "var(--sidebar-text)"
      : "var(--sidebar-text-muted)";
  const background = hovered ? "var(--sidebar-hover)" : "transparent";

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
        height: "32px",
        paddingInlineStart: "14px",
        paddingInlineEnd: "12px",
        fontSize: "11px",
        fontWeight: 600,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: textColor,
        backgroundColor: background,
        cursor: "pointer",
        transition: "background-color 120ms ease",
        textAlign: isRtl ? "right" : "left",
      }}
    >
      <Icon
        size={14}
        strokeWidth={1.5}
        aria-hidden="true"
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
      {adminLabel && (
        <span
          style={{
            fontSize: "9px",
            fontWeight: 500,
            letterSpacing: "0.08em",
            color: "var(--sidebar-text-muted)",
            padding: "1px 6px",
            border: "1px solid var(--sidebar-hover)",
            borderRadius: "4px",
          }}
        >
          {adminLabel}
        </span>
      )}
      {!expanded && badge !== undefined && <BadgePill count={badge} />}
      <Chevron
        size={14}
        strokeWidth={1.5}
        aria-hidden="true"
        style={{
          color: "var(--sidebar-text-muted)",
          flexShrink: 0,
          transform: expanded ? "none" : isRtl ? "rotate(180deg)" : "none",
        }}
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
  onPrefetch?: () => void;
}

function SubNavItem({ href, label, icon: Icon, isActive, badge, onPrefetch }: SubNavItemProps) {
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

  const iconColor = isActive
    ? "#FFFFFF"
    : hovered
      ? "var(--sidebar-text)"
      : "var(--sidebar-text-muted)";
  const background = isActive
    ? "var(--sidebar-active)"
    : hovered
      ? "var(--sidebar-hover)"
      : "transparent";

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setHovered(false)}
      onFocus={handleMouseEnter}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        height: "32px",
        paddingInlineStart: "32px",
        paddingInlineEnd: "16px",
        fontSize: "0.8125rem",
        fontWeight: isActive ? 500 : 400,
        color: "var(--sidebar-text)",
        textDecoration: "none",
        backgroundColor: background,
        borderInlineStart: isActive ? "2px solid #FFFFFF" : "2px solid transparent",
        transition: "background-color 120ms ease, color 120ms ease",
      }}
    >
      <Icon
        size={14}
        strokeWidth={1.5}
        aria-hidden="true"
        style={{ color: iconColor, flexShrink: 0, transition: "color 120ms ease" }}
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
      {badge !== undefined && <BadgePill count={badge} />}
    </Link>
  );
}
