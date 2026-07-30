"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Plus,
  Filter,
  Globe,
  Search,
  ArrowUpDown,
} from "lucide-react";
import type { ProductSortKey } from "@/lib/product-sort";

export type ProductFilterMode = "catalogue" | "performance";
export type ProductFilterStatus = "all" | "active" | "lowStock" | "losingMoney";

interface ProductsFilterBarProps {
  marketLabel: string;
  mode: ProductFilterMode;
  onModeChange: (m: ProductFilterMode) => void;
  status: ProductFilterStatus;
  onStatusChange: (s: ProductFilterStatus) => void;
  search: string;
  onSearchChange: (v: string) => void;
  canManage: boolean;
  canViewPerformance: boolean;
  locale?: string;
  sortKey?: ProductSortKey;
  onSortChange?: (k: ProductSortKey) => void;
}

const CARD_BG = "#FFFFFF";
const SOFT_BG = "#FFFFFF";
const BORDER = "#E1E3E5";
const SUBTLE_BG = "#F6F6F7";
const TEXT = "#1A1A1A";
const MUTED = "#6D7175";

const STATUS_VALUES: ProductFilterStatus[] = ["all", "active", "lowStock", "losingMoney"];

export function ProductsFilterBar({
  marketLabel,
  mode,
  onModeChange,
  status,
  onStatusChange,
  search,
  onSearchChange,
  canManage,
  canViewPerformance,
  locale = "fr",
  sortKey,
  onSortChange,
}: ProductsFilterBarProps) {
  const t = useTranslations("products");

  return (
    <div
      style={{
        background: CARD_BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {/* Top row: market + mode toggle + search + actions */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 10,
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flex: "1 1 auto" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 30,
              padding: "0 12px",
              borderRadius: 8,
              border: `1px solid ${BORDER}`,
              background: SUBTLE_BG,
              color: MUTED,
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            <Globe size={13} strokeWidth={1.75} />
            {marketLabel}
          </span>

          {canViewPerformance && (
            <>
              <Divider />
              <ModeSegmented
                mode={mode}
                onModeChange={onModeChange}
                catalogueLabel={t("modes.catalogue")}
                performanceLabel={t("modes.performance")}
              />
            </>
          )}

          <Divider />

          {/* Search */}
          <div style={{ position: "relative", flex: "1 1 200px", minWidth: 140, maxWidth: 320 }}>
            <Search
              size={13}
              strokeWidth={1.75}
              aria-hidden
              style={{
                position: "absolute",
                insetInlineStart: 10,
                top: "50%",
                transform: "translateY(-50%)",
                color: MUTED,
                pointerEvents: "none",
              }}
            />
            <input
              type="search"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t("filters.search.placeholder")}
              style={{
                height: 30,
                width: "100%",
                paddingInlineStart: 28,
                paddingInlineEnd: 10,
                fontSize: 13,
                border: `1px solid ${BORDER}`,
                borderRadius: 8,
                background: SOFT_BG,
                color: TEXT,
                outline: "none",
                fontFamily: "inherit",
              }}
            />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {canManage && (
            <Link
              href={`/${locale}/products/new`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 34,
                padding: "0 14px",
                fontSize: 13,
                fontWeight: 500,
                border: `1px solid ${TEXT}`,
                borderRadius: 8,
                background: TEXT,
                color: "#FFFFFF",
                textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              <Plus size={14} strokeWidth={2} />
              {t("addButton")}
            </Link>
          )}
        </div>
      </div>

      {/* Second row: status pills + sort */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          paddingTop: 8,
          borderTop: `1px solid ${BORDER}`,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            fontWeight: 500,
            color: MUTED,
            paddingInlineEnd: 4,
          }}
        >
          <Filter size={13} strokeWidth={1.75} />
          {t("filters.title")}
        </span>

        {/* Status pills — kept as role="button" for test compatibility */}
        {STATUS_VALUES.map((s) => {
          const isActive = status === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => onStatusChange(s)}
              style={{
                height: 28,
                padding: "0 12px",
                border: `1px solid ${isActive ? TEXT : BORDER}`,
                borderRadius: 6,
                background: isActive ? TEXT : SOFT_BG,
                color: isActive ? "#FFFFFF" : TEXT,
                fontSize: 12,
                fontWeight: isActive ? 600 : 500,
                cursor: "pointer",
                whiteSpace: "nowrap",
                fontFamily: "inherit",
              }}
            >
              {t(`filters.status.${s}`)}
            </button>
          );
        })}

        {sortKey != null && onSortChange != null && (
          <label
            style={{
              marginInlineStart: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: MUTED,
              fontFamily: "inherit",
            }}
          >
            <ArrowUpDown size={12} strokeWidth={1.75} />
            <span style={{ whiteSpace: "nowrap" }}>{t("sort.label")}</span>
            <select
              aria-label={t("sort.label")}
              value={sortKey}
              onChange={(e) => onSortChange(e.target.value as ProductSortKey)}
              style={{
                height: 28,
                padding: "0 8px",
                fontSize: 12,
                border: `1px solid ${BORDER}`,
                borderRadius: 6,
                background: SOFT_BG,
                color: TEXT,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <option value="default">{t("sort.default")}</option>
              <option value="revenueDesc">{t("sort.revenueDesc")}</option>
              <option value="marginAsc">{t("sort.marginAsc")}</option>
              <option value="stockAsc">{t("sort.stockAsc")}</option>
              <option value="name">{t("sort.name")}</option>
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

function Divider() {
  return (
    <span
      aria-hidden
      style={{
        width: 1,
        height: 20,
        background: BORDER,
        display: "inline-block",
        margin: "0 2px",
      }}
    />
  );
}

function ModeSegmented({
  mode,
  onModeChange,
  catalogueLabel,
  performanceLabel,
}: {
  mode: ProductFilterMode;
  onModeChange: (m: ProductFilterMode) => void;
  catalogueLabel: string;
  performanceLabel: string;
}) {
  const modes: { key: ProductFilterMode; label: string }[] = [
    { key: "catalogue", label: catalogueLabel },
    { key: "performance", label: performanceLabel },
  ];
  return (
    <div
      role="tablist"
      aria-label="product-mode"
      style={{
        display: "inline-flex",
        background: SUBTLE_BG,
        borderRadius: 8,
        padding: 2,
        gap: 2,
        border: `1px solid ${BORDER}`,
      }}
    >
      {modes.map((m) => {
        const isActive = mode === m.key;
        return (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onModeChange(m.key)}
            style={{
              padding: "5px 14px",
              border: "none",
              borderRadius: 6,
              background: isActive ? "#FFFFFF" : "transparent",
              color: TEXT,
              fontSize: 13,
              fontWeight: isActive ? 600 : 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
              boxShadow: isActive ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
              fontFamily: "inherit",
            }}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

