"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * The agent shell's ONE search query (owner, 2026-10-05: « one unified search bar across all
 * the agent pages »): the band's field writes it, its drop answers it on every tab, and on
 * Commandes the list filters by it too. Both live under
 * AgentDashboardShell, so a small context avoids prop-drilling through the
 * shell → tabs container → page chain.
 */
interface QueueSearchContextValue {
  query: string;
  setQuery: (q: string) => void;
  /** Result count, published by QueuePage so the navbar bar can display it. */
  resultCount: number;
  setResultCount: (n: number) => void;
  /** Forwarded to the input so the "/" shortcut (handled in QueuePage) can focus it. */
  inputRef: React.RefObject<HTMLInputElement | null>;
}

const noop = () => {};

const QueueSearchContext = createContext<QueueSearchContextValue | null>(null);

export function QueueSearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  const [resultCount, setResultCount] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const value = useMemo<QueueSearchContextValue>(
    () => ({ query, setQuery, resultCount, setResultCount, inputRef }),
    [query, resultCount],
  );

  return (
    <QueueSearchContext.Provider value={value}>
      {children}
    </QueueSearchContext.Provider>
  );
}

/**
 * Returns the queue-search context. Falls back to an inert local state when no
 * provider is present, so components that use it stay safe to render in
 * isolation (e.g. tests, storybook).
 */
export function useQueueSearch(): QueueSearchContextValue {
  const ctx = useContext(QueueSearchContext);
  const fallbackRef = useRef<HTMLInputElement | null>(null);
  // Without a provider the field still types (its own local query); hooks run unconditionally.
  const [fallbackQuery, setFallbackQuery] = useState("");
  const fallback = useMemo<QueueSearchContextValue>(
    () => ({
      query: fallbackQuery,
      setQuery: setFallbackQuery,
      resultCount: 0,
      setResultCount: noop,
      inputRef: fallbackRef,
    }),
    [fallbackQuery],
  );
  return ctx ?? fallback;
}
