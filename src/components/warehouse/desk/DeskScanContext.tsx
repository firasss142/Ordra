"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { PrepRow } from "@/components/warehouse/console/PrepCard";

/**
 * The parcel in hand, shared by the desk top bar and Sortir.
 *
 * « Prendre » on a Sortir row puts the parcel in hand; the permanent scan field
 * in the top bar then binds the next sticker to it. The two live in different
 * parts of the tree (the shell owns the bar, the page owns the table), so the
 * hand sits in the warehouse manager shell.
 *
 * Sortir also registers its queue and market: Tunisia's label QR IS the order
 * id and resolves against that queue without a hand. On any other page nothing
 * is registered and the field can only look a code up — it never binds.
 */

export type DeskRow = PrepRow;

export interface DeskQueue {
  market: "ly" | "tn";
  orders: DeskRow[];
}

export interface DeskScanValue {
  hand: DeskRow | null;
  take: (row: DeskRow | null) => void;
  queue: DeskQueue | null;
  setQueue: (queue: DeskQueue | null) => void;
}

const NONE: DeskScanValue = {
  hand: null,
  take: () => {},
  queue: null,
  setQueue: () => {},
};

const DeskScanContext = createContext<DeskScanValue>(NONE);

export function DeskScanProvider({ children }: { children: ReactNode }) {
  const [hand, take] = useState<DeskRow | null>(null);
  const [queue, setQueue] = useState<DeskQueue | null>(null);
  const value = useMemo(() => ({ hand, take, queue, setQueue }), [hand, queue]);
  return <DeskScanContext.Provider value={value}>{children}</DeskScanContext.Provider>;
}

/** Outside the manager shell this is inert: nothing in hand, nothing to register. */
export function useDeskScan(): DeskScanValue {
  return useContext(DeskScanContext);
}
