"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

interface SidebarCollapseContextValue {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  toggle: () => void;
}

const STORAGE_KEY = "sidebar.collapsed";

const noop = () => {};

const SidebarCollapseContext = createContext<SidebarCollapseContextValue>({
  collapsed: false,
  setCollapsed: noop,
  toggle: noop,
});

export function SidebarCollapseProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false);

  // Hydrate from localStorage after mount (SSR-safe)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "true") setCollapsedState(true);
  }, []);

  // Persist on change
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  const setCollapsed = useCallback((v: boolean) => setCollapsedState(v), []);
  const toggle = useCallback(() => setCollapsedState((v) => !v), []);

  return (
    <SidebarCollapseContext.Provider value={{ collapsed, setCollapsed, toggle }}>
      {children}
    </SidebarCollapseContext.Provider>
  );
}

export function useSidebarCollapse(): SidebarCollapseContextValue {
  return useContext(SidebarCollapseContext);
}
