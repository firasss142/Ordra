"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { WarehouseNavTabs } from "@/components/layout/WarehouseNavTabs";
import { useAuth } from "@/context/auth";

export default function WarehouseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const pathname = usePathname();

  if (loading || !user) {
    return (
      <div
        style={{ minHeight: "100vh", backgroundColor: "var(--bg-page)" }}
        aria-hidden="true"
      />
    );
  }

  const isRtl = user.direction === "rtl";
  const isAgent = user.role === "warehouse_agent";

  if (isAgent) {
    return (
      <div
        style={{
          minHeight: "100vh",
          backgroundColor: "var(--bg-page)",
          direction: isRtl ? "rtl" : "ltr",
        }}
      >
        <Topbar user={user} marketName="" />
        <WarehouseNavTabs user={user} />
        <main id="main-content">{children}</main>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        backgroundColor: "var(--bg-page)",
        direction: isRtl ? "rtl" : "ltr",
      }}
    >
      <Sidebar user={user} currentPath={pathname} />
      <main
        id="main-content"
        style={{
          flex: 1,
          marginInlineStart: "240px",
          minHeight: "100vh",
          backgroundColor: "var(--bg-page)",
        }}
      >
        <WarehouseNavTabs user={user} />
        {children}
      </main>
    </div>
  );
}
