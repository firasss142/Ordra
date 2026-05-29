"use client";

import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type React from "react";
import { useTranslations } from "next-intl";

interface PaginationProps {
  currentPage: number;
  pageSize: number;
  pageSizeOptions?: number[];
  hasNext: boolean;
  hasPrev: boolean;
  totalItems?: number;
  rangeFrom?: number;
  rangeTo?: number;
  onNext: () => void;
  onPrev: () => void;
  onPageSizeChange: (size: number) => void;
  isLoading?: boolean;
}

const DEFAULT_OPTIONS = [10, 25, 50, 100];

export function Pagination({
  currentPage,
  pageSize,
  pageSizeOptions = DEFAULT_OPTIONS,
  hasNext,
  hasPrev,
  totalItems,
  rangeFrom,
  rangeTo,
  onNext,
  onPrev,
  onPageSizeChange,
  isLoading = false,
}: PaginationProps) {
  const t = useTranslations("pagination");

  const totalPages =
    typeof totalItems === "number" && totalItems >= 0
      ? Math.max(1, Math.ceil(totalItems / pageSize))
      : null;

  const pageLabel =
    totalPages !== null
      ? t("pageOf", { page: currentPage, total: totalPages })
      : t("page", { page: currentPage });

  const rangeLabel =
    typeof rangeFrom === "number" && typeof rangeTo === "number" && rangeTo >= rangeFrom
      ? t("pageRange", { from: rangeFrom, to: rangeTo })
      : null;

  const showDropdown = pageSizeOptions.length > 0;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 16px",
        borderTop: "1px solid #E1E3E5",
        background: "#FAFAFA",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <button
        type="button"
        onClick={onPrev}
        disabled={!hasPrev || isLoading}
        aria-label={t("previous")}
        style={{
          ...btn,
          opacity: hasPrev && !isLoading ? 1 : 0.35,
          cursor: hasPrev && !isLoading ? "pointer" : "default",
        }}
      >
        <ChevronLeft size={14} strokeWidth={2.5} aria-hidden />
        {t("previous")}
      </button>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
          flex: 1,
          minWidth: 120,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "#1A1A1A",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {isLoading ? (
            <Loader2 size={14} className="animate-spin" aria-hidden style={{ display: "inline" }} />
          ) : (
            pageLabel
          )}
        </span>
        {rangeLabel ? (
          <span
            style={{
              fontSize: 11,
              color: "#9CA3AF",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {rangeLabel}
          </span>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onNext}
        disabled={!hasNext || isLoading}
        aria-label={t("next")}
        style={{
          ...btn,
          opacity: hasNext && !isLoading ? 1 : 0.35,
          cursor: hasNext && !isLoading ? "pointer" : "default",
        }}
      >
        {t("next")}
        <ChevronRight size={14} strokeWidth={2.5} aria-hidden />
      </button>

      {showDropdown ? (
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          aria-label={t("rowsPerPage")}
          style={{
            padding: "6px 10px",
            backgroundColor: "#FFFFFF",
            border: "1px solid #C9CCCF",
            borderRadius: 6,
            color: "#1A1A1A",
            fontSize: 13,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {pageSizeOptions.map((n) => (
            <option key={n} value={n}>
              {t("perPage", { n })}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

const btn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "6px 12px",
  fontSize: 13,
  fontWeight: 500,
  color: "#1A1A1A",
  background: "#FFFFFF",
  border: "1px solid #D1D5DB",
  borderRadius: 6,
  fontFamily: "inherit",
};
