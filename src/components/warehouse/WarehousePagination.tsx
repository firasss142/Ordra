"use client";

import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type React from "react";

const D = {
  sectionBg: "#F6F6F7",
  border: "#E1E3E5",
  textSecondary: "#6D7175",
  textPrimary: "#1A1A1A",
  inputBg: "#FFFFFF",
  inputBorder: "#C9CCCF",
};

const btnBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "0 16px",
  minHeight: 44,
  minWidth: 44,
  borderRadius: 9999,
  border: "none",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  backgroundColor: "#1A1A1A",
  color: "#FFFFFF",
  transition: "opacity 150ms ease",
  fontFamily: "inherit",
};

interface WarehousePaginationProps {
  page: number;
  pageSize: number;
  totalItems: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  onNext: () => void;
  onPrev: () => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
  loadingMore?: boolean;
  labelPrev?: string;
  labelNext?: string;
  labelPage?: string;
}

export function WarehousePagination({
  page,
  pageSize,
  totalItems,
  hasNextPage,
  hasPrevPage,
  onNext,
  onPrev,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  loadingMore = false,
  labelPrev = "Précédent",
  labelNext = "Suivant",
  labelPage,
}: WarehousePaginationProps) {
  const displayPage = page + 1;
  const totalPages =
    totalItems >= 0 ? Math.max(1, Math.ceil(totalItems / pageSize)) : null;

  const pageInfo =
    labelPage ??
    (totalPages !== null
      ? `Page ${displayPage} sur ${totalPages} · ${totalItems} entrées`
      : `Page ${displayPage}`);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 12,
        padding: "12px 16px",
        borderTop: `1px solid ${D.border}`,
        backgroundColor: D.sectionBg,
      }}
    >
      <button
        onClick={onPrev}
        disabled={!hasPrevPage}
        aria-label={labelPrev}
        style={{
          ...btnBase,
          opacity: hasPrevPage ? 1 : 0.3,
          cursor: hasPrevPage ? "pointer" : "not-allowed",
          pointerEvents: hasPrevPage ? "auto" : "none",
        }}
      >
        <ChevronLeft size={14} strokeWidth={2.5} aria-hidden />
        {labelPrev}
      </button>

      <span
        style={{
          flex: 1,
          textAlign: "center",
          fontSize: 13,
          color: D.textSecondary,
          fontVariantNumeric: "tabular-nums",
          minWidth: 120,
        }}
      >
        {loadingMore ? (
          <Loader2
            size={14}
            className="animate-spin"
            style={{ display: "inline" }}
            aria-hidden
          />
        ) : (
          pageInfo
        )}
      </span>

      <button
        onClick={onNext}
        disabled={!hasNextPage || loadingMore}
        aria-label={labelNext}
        style={{
          ...btnBase,
          opacity: hasNextPage && !loadingMore ? 1 : 0.3,
          cursor: hasNextPage && !loadingMore ? "pointer" : "not-allowed",
          pointerEvents: hasNextPage && !loadingMore ? "auto" : "none",
        }}
      >
        {loadingMore ? (
          <Loader2 size={14} className="animate-spin" aria-hidden />
        ) : null}
        {labelNext}
        <ChevronRight size={14} strokeWidth={2.5} aria-hidden />
      </button>

      {pageSizeOptions.length > 0 && (
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          aria-label="Lignes par page"
          style={{
            padding: "8px 10px",
            backgroundColor: D.inputBg,
            border: `1px solid ${D.inputBorder}`,
            borderRadius: 6,
            color: D.textPrimary,
            fontSize: 13,
            cursor: "pointer",
            fontFamily: "inherit",
            minHeight: 44,
          }}
        >
          {pageSizeOptions.map((n) => (
            <option key={n} value={n}>
              {n} par page
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
