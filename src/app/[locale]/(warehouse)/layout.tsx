"use client";

import { usePathname } from "next/navigation";
import { SidebarFrame } from "@/components/layout/SidebarFrame";
import { WarehouseMobileShell } from "@/components/warehouse/shell/WarehouseMobileShell";
import { useAuth } from "@/context/auth";
import { AlertsPanelProvider } from "@/context/alerts-panel";

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
   * A warehouse agent has no sidebar — Sidebar returns null for the role — and
   * does not work at a desk: they are standing, holding a parcel, one hand on
   * the phone. Their shell is the mobile one, navigated from the bottom.
   *
   * Everyone else already has the ENTREPÔT group in the sidebar, listing the
   * same screens. The top band repeated it one row below, which was the old
   * structure showing through: two navigations for one section.
   */
  if (isAgent) {
    return (
      <WarehouseMobileShell user={user} direction={direction}>
        {children}
      </WarehouseMobileShell>
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
  children,
}: {
  user: ReturnType<typeof useAuth>["user"];
  pathname: string;
  direction: "ltr" | "rtl";
  children: React.ReactNode;
}) {
  if (!user) return null;
  return (
    // The sidebar's alerts bell opens this provider's panel. Without it the bell
    // fell back to an empty default and did nothing on every Entrepôt page.
    // The tab band used to give the page title its breathing room; the frame's
    // --sb-main-pt carries that space now on desktop.
    <AlertsPanelProvider user={user}>
      <SidebarFrame
        user={user}
        currentPath={pathname}
        className="wh-console bg-wh-bg"
        mainClassName="bg-wh-bg"
        style={{ "--sb-main-pt": "12px" } as React.CSSProperties}
      >
        {children}
      </SidebarFrame>
    </AlertsPanelProvider>
  );
}
