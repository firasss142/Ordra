"use client";

import { SidebarFrame } from "@/components/layout/SidebarFrame";
import { AlertsPanelProvider } from "@/context/alerts-panel";
import type { AuthUser } from "@/types";

interface Props {
  user: AuthUser;
  children: React.ReactNode;
  /** Override pathname for Sidebar (server pages can pass it). */
  currentPath?: string;
}

export function DashboardChrome({ user, children, currentPath }: Props) {
  return (
    <AlertsPanelProvider user={user}>
      <SidebarFrame user={user} currentPath={currentPath} style={{ backgroundColor: "var(--bg-page)" }}>
        {children}
      </SidebarFrame>
    </AlertsPanelProvider>
  );
}
