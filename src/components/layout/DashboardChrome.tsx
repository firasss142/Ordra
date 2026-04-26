"use client";

import { useState, useCallback } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import type { AuthUser } from "@/types";

interface Props {
  user: AuthUser;
  children: React.ReactNode;
  /** Override pathname for Sidebar (server pages can pass it). */
  currentPath?: string;
}

export function DashboardChrome({ user, children, currentPath }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const isRtl = user.direction === "rtl";

  const handleMobileClose = useCallback(() => setMobileOpen(false), []);
  const handleMenuClick = useCallback(() => setMobileOpen(true), []);

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        backgroundColor: "var(--bg-page)",
        direction: isRtl ? "rtl" : "ltr",
      }}
    >
      <Sidebar
        user={user}
        currentPath={currentPath}
        mobileOpen={mobileOpen}
        onMobileClose={handleMobileClose}
      />
      <button
        type="button"
        onClick={handleMenuClick}
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
        className="md:ms-[240px] pt-14 md:pt-0"
        style={{
          flex: 1,
          minHeight: "100vh",
          backgroundColor: "var(--bg-page)",
          minWidth: 0,
        }}
      >
        {children}
      </main>
    </div>
  );
}
