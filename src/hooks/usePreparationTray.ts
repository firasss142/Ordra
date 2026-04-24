"use client";

import { useCallback, useState } from "react";
import {
  createTrayRow,
  markPrinted,
  markScanned,
  markError,
  clearError,
  type TrayRow,
  type TrayRowInit,
  type ScanErrorCode,
} from "@/lib/preparation/tray-state";

export type { TrayRow, ScanErrorCode };

export interface PreparationTrayActions {
  rows: TrayRow[];
  add: (init: TrayRowInit) => void;
  remove: (id: string) => void;
  markAllPrinted: (ids: string[]) => void;
  onScanSuccess: (id: string, stockAfter: number) => void;
  onScanError: (id: string, reason: ScanErrorCode) => void;
  onRetry: (id: string) => void;
  clear: () => void;
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  toggleSelectAll: () => void;
  clearSelection: () => void;
}

const MAX_TRAY_SIZE = 100;

export function usePreparationTray(): PreparationTrayActions {
  const [rowMap, setRowMap] = useState<Map<string, TrayRow>>(new Map());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const rows: TrayRow[] = Array.from(rowMap.values());

  const add = useCallback((init: TrayRowInit) => {
    setRowMap((prev) => {
      if (prev.has(init.id)) return prev;
      if (prev.size >= MAX_TRAY_SIZE) return prev;
      const next = new Map(prev);
      next.set(init.id, createTrayRow(init));
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setRowMap((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const markAllPrinted = useCallback((ids: string[]) => {
    setRowMap((prev) => {
      const next = new Map(prev);
      for (const id of ids) {
        const row = next.get(id);
        if (row) next.set(id, markPrinted(row));
      }
      return next;
    });
  }, []);

  const onScanSuccess = useCallback((id: string, stockAfter: number) => {
    setRowMap((prev) => {
      const row = prev.get(id);
      if (!row) return prev;
      const next = new Map(prev);
      next.set(id, markScanned(row, stockAfter));
      return next;
    });
  }, []);

  const onScanError = useCallback((id: string, reason: ScanErrorCode) => {
    setRowMap((prev) => {
      const row = prev.get(id);
      if (!row) return prev;
      const next = new Map(prev);
      // INVALID_STATUS means already done elsewhere — treat as scanned
      if (reason === "INVALID_STATUS") {
        next.set(id, markScanned(row, row.stockLevel));
      } else {
        next.set(id, markError(row, reason));
      }
      return next;
    });
  }, []);

  const onRetry = useCallback((id: string) => {
    setRowMap((prev) => {
      const row = prev.get(id);
      if (!row) return prev;
      const next = new Map(prev);
      next.set(id, clearError(row));
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setRowMap(new Map());
    setSelectedIds(new Set());
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const printableIds = rows
        .filter((r) => r.state === "ready_to_print" || r.state === "error")
        .map((r) => r.id);
      const allSelected = printableIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        printableIds.forEach((id) => next.delete(id));
      } else {
        printableIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [rows]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  return {
    rows,
    add,
    remove,
    markAllPrinted,
    onScanSuccess,
    onScanError,
    onRetry,
    clear,
    selectedIds,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
  };
}
