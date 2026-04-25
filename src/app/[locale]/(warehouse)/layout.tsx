"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Package, PackageOpen, History } from "lucide-react";
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
    <div className="border-b border-line-subtle bg-surface-card px-8">
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
    return <div className="min-h-screen bg-surface-page" aria-hidden="true" />;
  }

  const direction: "ltr" | "rtl" = user.direction === "rtl" ? "rtl" : "ltr";
  const isAgent = user.role === "warehouse_agent";

  if (isAgent) {
    return (
      <div className="min-h-screen bg-surface-page" style={{ direction }}>
        <Topbar user={user} marketName="" />
        <WarehouseTabsBand locale={user.locale} direction={direction} />
        <main id="main-content">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-surface-page" style={{ direction }}>
      <Sidebar user={user} currentPath={pathname} />
      <main id="main-content" className="flex-1 ms-[240px] min-h-screen bg-surface-page">
        <WarehouseTabsBand locale={user.locale} direction={direction} />
        {children}
      </main>
    </div>
  );
}
