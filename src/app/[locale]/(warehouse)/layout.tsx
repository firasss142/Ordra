"use client";

import { usePathname } from "next/navigation";
import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Boxes, History, LayoutDashboard, Menu, Package, PackageOpen, ScanLine } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { WarehouseTabBar, type WarehouseTab } from "@/components/warehouse/shell/WarehouseTabBar";
import { useAuth } from "@/context/auth";

function useWarehouseTabs(locale: string): WarehouseTab[] {
  const t = useTranslations("warehouse");
  return [
    {
      href: `/${locale}/warehouse`,
      label: t("nav.today"),
      icon: LayoutDashboard,
      exact: true,
      prefetchKey: "/api/warehouse/summary",
    },
    {
      href: `/${locale}/warehouse/preparation`,
      label: t("nav.preparation"),
      icon: Package,
      prefetchKey: "/api/warehouse/to-label",
    },
    // Scan mode is the bench's own screen. It sits next to Préparation because
    // that is where an operator comes from: pick a row, then stand at the table.
    {
      href: `/${locale}/warehouse/scan`,
      label: t("nav.scan"),
      icon: ScanLine,
      prefetchKey: "/api/warehouse/to-label",
    },
    {
      href: `/${locale}/warehouse/returns`,
      label: t("nav.returns"),
      icon: PackageOpen,
      prefetchKey: "/api/warehouse/returns",
    },
    {
      href: `/${locale}/warehouse/stock`,
      label: t("nav.stock"),
      icon: Boxes,
      prefetchKey: "/api/warehouse/stock",
    },
    {
      href: `/${locale}/warehouse/history`,
      label: t("nav.history"),
      icon: History,
      prefetchKey: "/api/warehouse/history",
    },
  ];
}

function WarehouseTabsBand({
  locale,
  direction,
}: {
  locale: string;
  direction: "ltr" | "rtl";
}) {
  const tabs = useWarehouseTabs(locale);
  return (
    <div
      data-testid="wh-tabs"
      className="border-b border-wh-border bg-wh-surface px-4 sm:px-6 lg:px-8"
    >
      <WarehouseTabBar tabs={tabs} direction={direction} />
    </div>
  );
}

export default function WarehouseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const pathname = usePathname();

  if (loading || !user) {
    return <div className="wh-console min-h-screen bg-wh-bg" aria-hidden="true" />;
  }

  const direction: "ltr" | "rtl" = user.direction === "rtl" ? "rtl" : "ltr";
  const isAgent = user.role === "warehouse_agent";

  /*
   * Two shells, one navigation each.
   *
   * A warehouse agent has no sidebar — Sidebar returns null for the role — so
   * the tab band IS their navigation and stays.
   *
   * Everyone else already has the ENTREPÔT group in the sidebar, listing the
   * same five screens. The band repeated it one row below, which is the old
   * structure showing through: two navigations for one section.
   */
  if (isAgent) {
    return (
      <div className="wh-console min-h-screen bg-wh-bg" style={{ direction }}>
        <Topbar user={user} marketName="" />
        <WarehouseTabsBand locale={user.locale} direction={direction} />
        <main id="main-content">{children}</main>
      </div>
    );
  }

  return (
    <WarehouseManagerShell user={user} pathname={pathname} direction={direction}>
      {children}
    </WarehouseManagerShell>
  );
}

function WarehouseManagerShell({
  user,
  pathname,
  direction,
  children,
}: {
  user: ReturnType<typeof useAuth>["user"];
  pathname: string;
  direction: "ltr" | "rtl";
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const handleClose = useCallback(() => setMobileOpen(false), []);
  const handleOpen = useCallback(() => setMobileOpen(true), []);
  if (!user) return null;
  return (
    <div className="wh-console flex min-h-screen bg-wh-bg" style={{ direction }}>
      <Sidebar
        user={user}
        currentPath={pathname}
        mobileOpen={mobileOpen}
        onMobileClose={handleClose}
      />
      <button
        type="button"
        onClick={handleOpen}
        aria-label="Menu"
        className="inline-flex md:!hidden items-center justify-center"
        style={{
          position: "fixed",
          top: 12,
          insetInlineStart: 12,
          zIndex: 40,
          width: 40,
          height: 40,
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--bg-card)",
          color: "var(--text-primary)",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          cursor: "pointer",
        }}
      >
        <Menu size={20} aria-hidden="true" />
      </button>
      <main
        id="main-content"
        // The tab band used to sit above the page and gave the title its
        // breathing room. Without it the heading would start flush against
        // the viewport edge, so the shell carries that space now.
        className="flex-1 md:ms-[240px] min-h-screen bg-wh-bg pt-14 md:pt-3"
        style={{ minWidth: 0 }}
      >
        {children}
      </main>
    </div>
  );
}
