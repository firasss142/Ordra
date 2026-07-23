"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import type { AuthUser } from "@/types";
import type { AlertsPanelFilter } from "@/components/alerts/AlertsPanel";

const AlertsPanel = dynamic(
  () => import("@/components/alerts/AlertsPanel").then((m) => m.AlertsPanel),
  { ssr: false },
);

interface AlertsPanelContextValue {
  open: boolean;
  openPanel: (filter?: AlertsPanelFilter) => void;
  closePanel: () => void;
}

// Default no-op so components using the hook render safely outside the
// provider (e.g. in isolated tests).
const AlertsPanelContext = createContext<AlertsPanelContextValue>({
  open: false,
  openPanel: () => {},
  closePanel: () => {},
});

export function useAlertsPanel(): AlertsPanelContextValue {
  return useContext(AlertsPanelContext);
}

/**
 * Hosts the alerts slide-over for the manager/admin shell. Deep-linkable via
 * ?alerts=open (+ optional alert_type=<type>) — e.g. from the old
 * /dashboard/alerts bookmark redirect.
 */
export function AlertsPanelProvider({
  user,
  children,
}: {
  user: AuthUser;
  children: React.ReactNode;
}) {
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<AlertsPanelFilter | null>(null);

  // Deep-link: open on mount when ?alerts=open is present.
  useEffect(() => {
    if (searchParams?.get("alerts") === "open") {
      const type = searchParams.get("alert_type");
      setFilter(type ? ({ type } as AlertsPanelFilter) : null);
      setOpen(true);
    }
    // Run once on mount — later opens go through openPanel().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openPanel = useCallback((f?: AlertsPanelFilter) => {
    setFilter(f ?? null);
    setOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setOpen(false);
    setFilter(null);
    // Strip the deep-link params without triggering a navigation.
    const url = new URL(window.location.href);
    if (url.searchParams.has("alerts") || url.searchParams.has("alert_type")) {
      url.searchParams.delete("alerts");
      url.searchParams.delete("alert_type");
      window.history.replaceState(window.history.state, "", url.toString());
    }
  }, []);

  return (
    <AlertsPanelContext.Provider value={{ open, openPanel, closePanel }}>
      {children}
      {open ? <AlertsPanel user={user} initialFilter={filter} onClose={closePanel} /> : null}
    </AlertsPanelContext.Provider>
  );
}
