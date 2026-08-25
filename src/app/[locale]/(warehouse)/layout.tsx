"use client";

import { usePathname } from "next/navigation";
import { useState, useCallback } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { WarehouseMobileShell } from "@/components/warehouse/shell/WarehouseMobileShell";
import { useAuth } from "@/context/auth";

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
