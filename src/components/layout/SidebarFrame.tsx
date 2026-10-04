"use client";

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { readRailPref, writeRailPref } from "@/lib/navigation/sidebar-prefs";
import type { AuthUser } from "@/types";

/** Below this the 64 px rail is the default: the orders table needs the width. */
const RAIL_DEFAULT_QUERY = "(max-width: 1279px)";

/**
 * Sidebar + page, for every shell that carries the manager sidebar (the
 * dashboard and the Entrepôt manager console). Owns the rail choice — the
 * person's, remembered, else the screen width's — and the phone drawer, and
 * gives the page exactly the room the bar leaves (`--sidebar-w`).
 */
export function SidebarFrame({
  user,
  currentPath,
  className = "",
  mainClassName = "",
  style,
  children,
}: {
  user: AuthUser;
  currentPath?: string;
  className?: string;
  mainClassName?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const narrow = useMediaQuery(RAIL_DEFAULT_QUERY);
  const [pref, setPref] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setPref(readRailPref());
    // Animate width changes only after the first settled paint.
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const rail = pref ?? narrow;
  const toggleRail = useCallback(() => {
    const next = !rail;
    setPref(next);
    writeRailPref(next);
  }, [rail]);
  const openDrawer = useCallback(() => setMobileOpen(true), []);
  const closeDrawer = useCallback(() => setMobileOpen(false), []);

  return (
    <div
      className={`sb-frame ${className}`}
      data-ready={ready ? "true" : undefined}
      style={{ ...style, direction: user.direction === "rtl" ? "rtl" : "ltr", "--sidebar-w": rail ? "64px" : "240px" } as CSSProperties}
    >
      <Sidebar
        user={user}
        currentPath={currentPath}
        rail={rail}
        onToggleRail={toggleRail}
        mobileOpen={mobileOpen}
        onMobileOpen={openDrawer}
        onMobileClose={closeDrawer}
      />
      <main id="main-content" className={`sb-main ${mainClassName}`}>
        {children}
      </main>
    </div>
  );
}
