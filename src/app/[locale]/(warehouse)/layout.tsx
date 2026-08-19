"use client";

import { usePathname } from "next/navigation";
import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Package, PackageCheck, PackageOpen, History, Menu } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { WarehouseTabBar, type WarehouseTab } from "@/components/warehouse/shell/WarehouseTabBar";
import { useAuth } from "@/context/auth";

function useWarehouseTabs(locale: string): WarehouseTab[] {
  const t = useTranslations("warehouse");
  return [
    {
      href: `/${locale}/warehouse/preparation`,
      label: t("nav.preparation"),
      icon: Package,
      prefetchKey: "/api/warehouse/to-label",
    },
    {
      href: `/${locale}/warehouse/dispatch`,
      label: t("nav.dispatch"),
      icon: PackageCheck,
    },
    {
      href: `/${locale}/warehouse/returns`,
      label: t("nav.returns"),
      icon: PackageOpen,
      prefetchKey: "/api/warehouse/returns",
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
    <div className="border-b border-wh-border bg-wh-surface px-4 sm:px-6 lg:px-8">
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

  if (isAgent) {
    // Warehouse agents use Topbar without a sidebar drawer (no nav menu).
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
      <WarehouseTabsBand locale={user.locale} direction={direction} />
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
        className="flex-1 md:ms-[240px] min-h-screen bg-wh-bg pt-14 md:pt-0"
        style={{ minWidth: 0 }}
      >
        {children}
      </main>
    </div>
  );
}
