"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { ChevronDown, Menu, PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";
import { useOrphanUnreadCount } from "@/hooks/useOrphanConversations";
import { useMediaQuery, PHONE_QUERY } from "@/hooks/useMediaQuery";
import { fetcher } from "@/lib/swr-config";
import { useMarketScope } from "@/context/market-scope";
import { AlertsBell } from "@/components/alerts/AlertsBell";
import {
  BADGE_TONE,
  findActiveGroupId,
  flattenNav,
  groupBadgeSource,
  isNavItemActive,
  visibleNav,
  type BadgeCounts,
  type BadgeSource,
  type NavGroupDef,
  type NavGroupId,
  type NavItemDef,
} from "@/lib/navigation/sidebar-nav";
import { readCollapsedGroups, writeCollapsedGroups } from "@/lib/navigation/sidebar-prefs";
import type { MarketScope } from "@/lib/markets";
import type { AuthUser } from "@/types";
import { prefetchForRoute } from "./prefetch";
import { NavBadge } from "./sidebar/NavBadge";
import { MarketFlag } from "./sidebar/MarketFlag";
import { MarketSwitcher } from "./sidebar/MarketSwitcher";
import { GoToPalette, type PaletteEntry } from "./sidebar/GoToPalette";
import { SidebarUserMenu } from "./sidebar/SidebarUserMenu";

/*
 * The manager / super_admin sidebar (prototypes/sidebar-v2.html).
 *
 * Head and foot are pinned; only the list scrolls — the old bar scrolled as one
 * block, so the market, the bell and the profile left the screen. Dashboard
 * stands alone; group labels are quiet, fold, and stay folded per person; the
 * group of the current page always opens. Three widths: 240 px, a 64 px rail
 * the person chooses (DashboardFrame defaults it below 1280 px), and a drawer
 * behind a top bar on phones.
 */

interface SidebarProps {
  user: AuthUser;
  /** Optional override; normally resolved from usePathname() */
  currentPath?: string;
  unassignedCount?: number;
  /** Desktop 64 px rail. Ignored on a phone, where the drawer is always full. */
  rail?: boolean;
  onToggleRail?: () => void;
  /** Phone drawer state, owned by the frame. */
  mobileOpen?: boolean;
  onMobileOpen?: () => void;
  onMobileClose?: () => void;
}

const MARKETS: readonly MarketScope[] = ["tn", "ly", "all"];

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")
  );
}

export function Sidebar({
  user,
  currentPath,
  unassignedCount,
  rail = false,
  onToggleRail,
  mobileOpen = false,
  onMobileOpen,
  onMobileClose,
}: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("nav");
  const searchString = searchParams?.toString() ?? "";
  const activePath = currentPath ?? pathname ?? "";
  const activeSearch = searchString ? `?${searchString}` : "";
  const locale = user.locale;
  const isAdmin = user.role === "super_admin";
  const isPhone = useMediaQuery(PHONE_QUERY);
  const railActive = rail && !isPhone;

  const nav = useMemo(() => visibleNav(user.role), [user.role]);
  const hasSidebar = nav.groups.length > 0 || nav.top.length > 0;
  const activeGroupId = findActiveGroupId(nav, locale, activePath, activeSearch);

  // ── live counts ────────────────────────────────────────────────────────
  const { marketId: scopeMarketId, scope, setScope } = useMarketScope();
  const countMarketId = isAdmin ? scopeMarketId : user.market_id;
  const { data: countData } = useSWR<{ count: number }>(
    hasSidebar && unassignedCount === undefined
      ? `/api/orders/unassigned/count${countMarketId ? `?market_id=${countMarketId}` : ""}`
      : null,
    fetcher,
    { refreshInterval: 60000, revalidateOnFocus: false },
  );
  const whatsapp = useOrphanUnreadCount(countMarketId, hasSidebar);
  const { data: journalCounts } = useSWR<{ open: number; critical: number }>(
    isAdmin ? "/api/admin/journal/counts" : null,
    fetcher,
    { refreshInterval: 60000, revalidateOnFocus: false },
  );
  const counts: BadgeCounts = {
    unassigned: unassignedCount ?? countData?.count ?? 0,
    whatsapp,
    journal: journalCounts?.open ?? 0,
  };

  // ── folding, remembered per browser ───────────────────────────────────
  const [collapsed, setCollapsed] = useState<ReadonlySet<NavGroupId>>(() => new Set());
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    setCollapsed(new Set(readCollapsedGroups()));
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored || !activeGroupId || !collapsed.has(activeGroupId)) return;
    const next = new Set(collapsed);
    next.delete(activeGroupId);
    writeCollapsedGroups([...next]);
    setCollapsed(next);
  }, [restored, activeGroupId, collapsed]);
  const toggleGroup = (id: NavGroupId) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    writeCollapsedGroups([...next]);
    setCollapsed(next);
  };

  // ── « Aller à… » ──────────────────────────────────────────────────────
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);

  const closeDrawer = useCallback(() => {
    if (isPhone && mobileOpen) onMobileClose?.();
  }, [isPhone, mobileOpen, onMobileClose]);

  const paletteEntries = useMemo<PaletteEntry[]>(() => {
    const pages = flattenNav(nav).map(({ item, groupId }) => {
      const Icon = item.icon;
      return {
        id: item.key,
        label: t(`items.${item.key}`),
        group: groupId ? t(`sections.${groupId}`) : undefined,
        icon: <Icon size={16} strokeWidth={1.75} aria-hidden="true" />,
        onSelect: () => {
          closeDrawer();
          router.push(`/${locale}/${item.href}`);
        },
      };
    });
    if (!isAdmin) return pages;
    const markets = MARKETS.filter((m) => m !== scope).map((m) => ({
      id: `mk:${m}`,
      label: t("switchTo", { market: t(`markets.${m}`) }),
      group: t("markets.label"),
      icon: <MarketFlag scope={m} size={16} radius={4} />,
      onSelect: () => setScope(m),
    }));
    return [...pages, ...markets];
  }, [nav, t, locale, router, isAdmin, scope, setScope, closeDrawer]);

  // ── rail fly-outs and tips ────────────────────────────────────────────
  const [fly, setFly] = useState<{ id: NavGroupId; top: number; pinned: boolean } | null>(null);
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flyRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setFly((f) => (f?.pinned ? f : null)), 160);
  };
  const openFly = (id: NavGroupId, el: HTMLElement, pinned: boolean) => {
    cancelClose();
    setTip(null);
    const r = el.getBoundingClientRect();
    setFly({ id, top: Math.max(8, r.top - 6), pinned });
  };
  const showTip = (label: string) => (e: { currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2 });
  };
  const hideTip = () => setTip(null);
  useEffect(() => () => cancelClose(), []);
  useEffect(() => {
    if (!railActive) setFly(null);
  }, [railActive]);
  useEffect(() => {
    if (!fly) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (flyRef.current?.contains(target) || navRef.current?.contains(target)) return;
      setFly(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [fly]);

  // ── keyboard ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!hasSidebar) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        if (fly) {
          const trigger = navRef.current?.querySelector<HTMLElement>(`[data-group-trigger="${fly.id}"]`);
          setFly(null);
          trigger?.focus();
        } else if (isPhone && mobileOpen) {
          onMobileClose?.();
        }
        return;
      }
      if (e.key === "[" && !e.metaKey && !e.ctrlKey && !e.altKey && !isPhone && !isTyping(e.target)) {
        onToggleRail?.();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hasSidebar, fly, isPhone, mobileOpen, onMobileClose, onToggleRail]);

  const [scrolled, setScrolled] = useState(false);

  if (!hasSidebar) return null;

  const isRtl = user.direction === "rtl";
  const dir = isRtl ? "rtl" : "ltr";
  const badge = (src: BadgeSource | undefined) =>
    src ? <NavBadge count={counts[src]} tone={BADGE_TONE[src]} label={t(`counts.${src}`)} /> : null;
  const itemActive = (item: NavItemDef) => isNavItemActive(item, locale, activePath, activeSearch);

  const link = (item: NavItemDef) => (
    <li key={item.key}>
      <NavLink
        href={`/${locale}/${item.href}`}
        item={item}
        user={user}
        active={itemActive(item)}
        label={t(`items.${item.key}`)}
        badge={badge(item.badge)}
        onNavigate={() => {
          setFly(null);
          closeDrawer();
        }}
      />
    </li>
  );

  const group = (g: NavGroupDef) => {
    const open = !collapsed.has(g.id);
    const lifted = open ? null : groupBadgeSource(g, counts);
    return (
      <div key={g.id} className="sb-group">
        {g.admin && <div className="sb-divider" role="separator" />}
        <button
          type="button"
          className="sb-glabel"
          aria-expanded={open}
          aria-controls={`sb-g-${g.id}`}
          onClick={() => toggleGroup(g.id)}
        >
          <span className="sb-glabel-text">{t(`sections.${g.id}`)}</span>
          {lifted && badge(lifted)}
          <ChevronDown size={14} strokeWidth={2} aria-hidden="true" className="sb-chev" />
        </button>
        {open && <ul id={`sb-g-${g.id}`}>{g.items.map(link)}</ul>}
      </div>
    );
  };

  const kbd = <kbd className="sb-kbd">{isMac ? "⌘K" : "Ctrl K"}</kbd>;

  const fullContent = (
    <>
      <div className="sb-head">
        <div className="sb-row1">
          <span className="sb-word">{t("brand")}</span>
          <span className="sb-grow" />
          {isPhone ? (
            <button type="button" className="sb-ib" aria-label={t("closeMenu")} onClick={() => onMobileClose?.()}>
              <X size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
          ) : (
            <AlertsBell user={user} />
          )}
        </div>
        <MarketSwitcher user={user} variant="card" />
        <button type="button" className="sb-search" onClick={() => setPaletteOpen(true)}>
          <Search size={15} strokeWidth={1.75} aria-hidden="true" />
          <span className="sb-grow">{t("goTo")}</span>
          {kbd}
        </button>
      </div>
      <div
        className="sb-scroll"
        data-scrolled={scrolled ? "true" : undefined}
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 2)}
      >
        <ul>{nav.top.map(link)}</ul>
        {nav.groups.map(group)}
      </div>
      <div className="sb-foot">
        <SidebarUserMenu user={user} variant="full" />
        {!isPhone && (
          <button type="button" className="sb-ib" aria-label={t("collapse")} title={`${t("collapse")}  [`} onClick={() => onToggleRail?.()}>
            <PanelLeftClose size={17} strokeWidth={1.75} aria-hidden="true" className="sb-flip" />
          </button>
        )}
      </div>
    </>
  );

  const flyGroup = fly ? nav.groups.find((g) => g.id === fly.id) : undefined;

  const railContent = (
    <>
      <div className="sb-rail-head">
        <MarketSwitcher user={user} variant="rail" />
        <button type="button" className="sb-rbtn" aria-label={t("goTo")} onClick={() => setPaletteOpen(true)}
          onMouseEnter={showTip(t("goTo"))} onMouseLeave={hideTip} onFocus={showTip(t("goTo"))} onBlur={hideTip}>
          <Search size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <AlertsBell user={user} variant="rail" />
      </div>
      <div className="sb-rail-sep" role="separator" />
      <div className="sb-rail-nav">
        {nav.top.map((item) => {
          const Icon = item.icon;
          const label = t(`items.${item.key}`);
          const active = itemActive(item);
          return (
            <Link key={item.key} href={`/${locale}/${item.href}`} className="sb-rbtn" aria-label={label}
              aria-current={active ? "page" : undefined} data-current={active ? "true" : undefined}
              onMouseEnter={showTip(label)} onMouseLeave={hideTip} onFocus={showTip(label)} onBlur={hideTip}>
              <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          );
        })}
        {nav.groups.map((g) => {
          const Icon = g.icon;
          const src = groupBadgeSource(g, counts);
          const current = g.items.some(itemActive);
          return (
            <div key={g.id} className="sb-rail-item">
              {g.admin && <div className="sb-rail-sep" role="separator" />}
              <button
                type="button"
                className="sb-rbtn"
                data-group-trigger={g.id}
                data-current={current ? "true" : undefined}
                data-hot={fly?.id === g.id ? "true" : undefined}
                aria-label={t(`sections.${g.id}`)}
                aria-haspopup="true"
                aria-expanded={fly?.id === g.id}
                onMouseEnter={(e) => openFly(g.id, e.currentTarget, false)}
                onMouseLeave={scheduleClose}
                onClick={(e) => {
                  if (fly?.id === g.id && fly.pinned) setFly(null);
                  else openFly(g.id, e.currentTarget, true);
                }}
              >
                <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                {src && <span className={`sb-rdot sb-rdot-${BADGE_TONE[src]}`} aria-hidden="true" />}
              </button>
            </div>
          );
        })}
      </div>
      <div className="sb-rail-foot">
        <SidebarUserMenu user={user} variant="rail" />
        <button type="button" className="sb-rbtn" aria-label={t("expand")} onClick={() => onToggleRail?.()}
          onMouseEnter={showTip(`${t("expand")}  [`)} onMouseLeave={hideTip}>
          <PanelLeftOpen size={18} strokeWidth={1.75} aria-hidden="true" className="sb-flip" />
        </button>
      </div>
      {flyGroup && fly && (
        <div ref={flyRef} className="sb-menu sb-fly" style={{ top: fly.top }} role="group"
          aria-label={t(`sections.${flyGroup.id}`)} onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>
          <div className="sb-menu-title">{t(`sections.${flyGroup.id}`)}</div>
          <ul>{flyGroup.items.map(link)}</ul>
        </div>
      )}
      {tip && !fly && (
        <div className="sb-tip" role="tooltip" style={{ top: tip.top }}>
          {tip.label}
        </div>
      )}
    </>
  );

  return (
    <>
      {isPhone && (
        <header className="sb-phonebar" dir={dir}>
          <button type="button" className="sb-ib sb-burger" aria-label={t("openMenu")} aria-expanded={mobileOpen}
            onClick={() => onMobileOpen?.()}>
            <Menu size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <span className="sb-word">{t("brand")}</span>
          <span className="sb-grow" />
          <MarketSwitcher user={user} variant="chip" />
          <AlertsBell user={user} />
        </header>
      )}
      {isPhone && mobileOpen && <div className="sb-backdrop" aria-hidden="true" onClick={() => onMobileClose?.()} />}
      <nav
        ref={navRef}
        className="sb-nav"
        dir={dir}
        aria-label={t("label")}
        data-rail={railActive ? "true" : undefined}
        data-mobile-open={mobileOpen ? "true" : "false"}
      >
        {railActive ? railContent : fullContent}
      </nav>
      <GoToPalette open={paletteOpen} entries={paletteEntries} onClose={() => setPaletteOpen(false)} />
    </>
  );
}

function NavLink({
  href,
  item,
  user,
  active,
  label,
  badge,
  onNavigate,
}: {
  href: string;
  item: NavItemDef;
  user: AuthUser;
  active: boolean;
  label: string;
  badge: React.ReactNode;
  onNavigate: () => void;
}) {
  const router = useRouter();
  const prefetched = useRef(false);
  const warm = () => {
    if (prefetched.current) return;
    prefetched.current = true;
    router.prefetch(href);
    if (item.prefetchRoute) prefetchForRoute(item.prefetchRoute, user);
  };
  const Icon = item.icon;
  return (
    <Link
      href={href}
      className="sb-item"
      aria-current={active ? "page" : undefined}
      onMouseEnter={warm}
      onFocus={warm}
      onClick={onNavigate}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
      <span className="sb-item-label">{label}</span>
      {badge}
    </Link>
  );
}
