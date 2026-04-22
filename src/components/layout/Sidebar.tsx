"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import {
  BarChart3,
  ChevronsUpDown,
  ClipboardList,
  LayoutDashboard,
  Package,
  Settings,
  ShoppingBag,
  UserPlus,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { NavItem } from "./NavItem";
import { prefetchForRoute } from "./prefetch";
import { Avatar } from "@/components/ui/Avatar";
import type { AuthUser } from "@/types";

interface SidebarProps {
  user: AuthUser;
  /** Optional override; normally resolved from usePathname() */
  currentPath?: string;
  unassignedCount?: number;
}

type NavSectionId = "operations" | "crm" | "catalogue" | "admin";

interface NavItemDef {
  /** i18n key under `nav.*` (supports dot paths for markets.label) */
  key: string;
  /** Route segment after `/{locale}/` */
  route: string;
  icon: LucideIcon;
  showBadge?: boolean;
  superAdminOnly?: boolean;
}

interface NavSection {
  id: NavSectionId;
  items: NavItemDef[];
}

const NAV_SECTIONS: readonly NavSection[] = [
  {
    id: "operations",
    items: [
      { key: "dashboard", route: "dashboard", icon: LayoutDashboard },
      { key: "orders", route: "orders", icon: ShoppingBag, showBadge: true },
      { key: "warehouse", route: "warehouse", icon: Warehouse },
    ],
  },
  {
    id: "crm",
    items: [
      { key: "leads", route: "leads", icon: Users },
      { key: "followUps", route: "follow-ups", icon: ClipboardList },
    ],
  },
  {
    id: "catalogue",
    items: [{ key: "products", route: "products", icon: Package }],
  },
  {
    id: "admin",
    items: [
      { key: "performance", route: "team", icon: BarChart3 },
      { key: "users", route: "users", icon: UserPlus },
      { key: "settings", route: "settings", icon: Settings },
    ],
  },
];

const LY_MARKET_ID = "00000000-0000-0000-0000-000000000002";

function resolveMarketKey(marketId: string | null): "tn" | "ly" | "all" {
  if (marketId === LY_MARKET_ID) return "ly";
  if (marketId) return "tn";
  return "all";
}


export function Sidebar({ user, currentPath, unassignedCount }: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const activePath = currentPath ?? pathname ?? "";
  const t = useTranslations("nav");
  const [menuOpen, setMenuOpen] = useState(false);
  const [userHovered, setUserHovered] = useState(false);
  const [logoutHovered, setLogoutHovered] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // SWR hook MUST be called unconditionally before any early return
  const shouldFetch = unassignedCount === undefined;
  const countKey = shouldFetch
    ? `/api/orders/unassigned/count${marketParam}`
    : null;
  const { data: countData } = useSWR<{ count: number }>(countKey, {
    refreshInterval: 60000,
    revalidateOnFocus: false,
  });

  if (user.role === "agent" || user.role === "warehouse_agent") {
    return null;
  }

  const liveCount =
    unassignedCount !== undefined ? unassignedCount : countData?.count;

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
      <div style={{ flex: 1, paddingBlockEnd: "8px" }}>
        {NAV_SECTIONS.map((section, sectionIdx) => {
          const items = section.items.filter(
            (item) => !item.superAdminOnly || user.role === "super_admin",
          );
          if (items.length === 0) return null;

          return (
            <div key={section.id}>
              <div
                role="presentation"
                style={{
                  fontSize: "11px",
                  fontWeight: 500,
                  color: "var(--sidebar-text-muted)",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  paddingInline: "16px",
                  paddingBlockStart: sectionIdx === 0 ? "12px" : "16px",
                  paddingBlockEnd: "6px",
                }}
              >
                {t(`sections.${section.id}`)}
              </div>
              <ul
                role="list"
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                }}
              >
                {items.map((item) => {
                  const href = `/${user.locale}/${item.route}`;
                  return (
                    <li key={item.key}>
                      <NavItem
                        href={href}
                        label={t(item.key)}
                        icon={item.icon}
                        currentPath={activePath}
                        badge={item.showBadge ? liveCount : undefined}
                        onPrefetch={() =>
                          prefetchForRoute(item.route, user)
                        }
                      />
                    </li>
                  );
                })}
              </ul>
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
            backgroundColor: userHovered
              ? "var(--sidebar-hover)"
              : "transparent",
            transition: "background-color 120ms ease",
            boxSizing: "border-box",
          }}
        >
          <Avatar user={user} size={32} />

          <span
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minWidth: 0,
            }}
          >
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
            style={{
              color: "var(--sidebar-text-muted)",
              flexShrink: 0,
            }}
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
                backgroundColor: logoutHovered
                  ? "var(--sidebar-active)"
                  : "transparent",
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
