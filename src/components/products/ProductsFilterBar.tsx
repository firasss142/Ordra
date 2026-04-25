"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Role } from "@/types";

export type ProductFilterMode = "catalogue" | "performance";
export type ProductFilterStatus = "all" | "active" | "lowStock" | "losingMoney";

interface Market {
  id: string;
  name: string;
}

interface ProductsFilterBarProps {
  role: Role;
  markets: Market[];
  selectedMarketId: string;
  onMarketChange: (id: string) => void;
  mode: ProductFilterMode;
  onModeChange: (m: ProductFilterMode) => void;
  status: ProductFilterStatus;
  onStatusChange: (s: ProductFilterStatus) => void;
  search: string;
  onSearchChange: (v: string) => void;
  selectedCount: number;
  onBulkActivate: () => void;
  onBulkDeactivate: () => void;
  onBulkClear: () => void;
  canManage: boolean;
  canViewPerformance: boolean;
  locale?: string;
}

const TEXT = "#1A1A1A";
const MUTED = "#6D7175";
const BORDER = "#E1E3E5";
const BG = "#FFFFFF";

const STATUS_VALUES: ProductFilterStatus[] = ["all", "active", "lowStock", "losingMoney"];

export function ProductsFilterBar({
  role,
  markets,
  selectedMarketId,
  onMarketChange,
  mode,
  onModeChange,
  status,
  onStatusChange,
  search,
  onSearchChange,
  selectedCount,
  onBulkActivate,
  onBulkDeactivate,
  onBulkClear,
  canManage,
  canViewPerformance,
  locale = "fr",
}: ProductsFilterBarProps) {
  const t = useTranslations("products");
  const lockedMarket = role !== "super_admin";
  const selectedMarketName = markets.find((m) => m.id === selectedMarketId)?.name ?? "";

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        justifyContent: "space-between",
      }}
    >
      {/* Left cluster */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {/* Market chip */}
        <MarketChip
          markets={markets}
          selected={selectedMarketId}
          locked={lockedMarket}
          lockedLabel={selectedMarketName}
          onChange={onMarketChange}
        />

        {/* Mode segmented (only when canViewPerformance) */}
        {canViewPerformance && (
          <ModeSegmented
            mode={mode}
            onModeChange={onModeChange}
            catalogueLabel={t("modes.catalogue")}
            performanceLabel={t("modes.performance")}
          />
        )}

        {/* Status pills */}
        <div style={{ display: "flex", gap: 4 }}>
          {STATUS_VALUES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onStatusChange(s)}
              style={{
                padding: "6px 12px",
                border: `1px solid ${status === s ? TEXT : BORDER}`,
                borderRadius: 9999,
                background: status === s ? TEXT : BG,
                color: status === s ? "#FFFFFF" : TEXT,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {t(`filters.status.${s}`)}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("filters.search.placeholder")}
          style={{
            height: 32,
            padding: "0 10px",
            fontSize: 13,
            border: `1px solid ${BORDER}`,
            borderRadius: 9999,
            background: BG,
            color: TEXT,
            outline: "none",
            minWidth: 180,
          }}
        />
      </div>

      {/* Right cluster */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* Bulk actions — visible only when rows selected */}
        {selectedCount > 0 && (
          <>
            <span style={{ fontSize: 13, color: MUTED, whiteSpace: "nowrap" }}>
              {t("bulk.selectedCount", { count: selectedCount })}
            </span>
            <button
              type="button"
              onClick={onBulkActivate}
              style={pillBtnStyle}
            >
              {t("bulk.activate")}
            </button>
            <button
              type="button"
              onClick={onBulkDeactivate}
              style={pillBtnStyle}
            >
              {t("bulk.deactivate")}
            </button>
            <button
              type="button"
              onClick={onBulkClear}
              style={{ ...pillBtnStyle, borderColor: BORDER, background: BG, color: MUTED }}
            >
              {t("bulk.clear")}
            </button>
          </>
        )}

        {/* New product link — super_admin only */}
        {canManage && (
          <Link
            href={`/${locale}/products/new`}
            style={{
              height: 34,
              padding: "0 14px",
              fontSize: 13,
              fontWeight: 500,
              border: `1px solid ${TEXT}`,
              borderRadius: 9999,
              background: TEXT,
              color: "#FFFFFF",
              cursor: "pointer",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              whiteSpace: "nowrap",
            }}
          >
            + {t("addButton")}
          </Link>
        )}
      </div>
    </div>
  );
}

const pillBtnStyle: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: 13,
  fontWeight: 500,
  border: `1px solid ${TEXT}`,
  borderRadius: 9999,
  background: TEXT,
  color: "#FFFFFF",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

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
        border: `1px solid ${BORDER}`,
        borderRadius: 9999,
        background: BG,
        padding: 2,
        gap: 2,
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
              padding: "6px 14px",
              border: "none",
              borderRadius: 9999,
              background: isActive ? TEXT : "transparent",
              color: isActive ? "#FFFFFF" : TEXT,
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

function MarketChip({
  markets,
  selected,
  locked,
  lockedLabel,
  onChange,
}: {
  markets: Market[];
  selected: string;
  locked: boolean;
  lockedLabel: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabel = markets.find((m) => m.id === selected)?.name ?? lockedLabel;

  if (locked) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          borderRadius: 9999,
          border: `1px solid ${BORDER}`,
          background: "#F2F2F2",
          color: MUTED,
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        {lockedLabel}
      </span>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          borderRadius: 9999,
          border: `1px solid ${BORDER}`,
          background: BG,
          color: TEXT,
          fontSize: 13,
          fontWeight: 500,
          cursor: "pointer",
        }}
      >
        {selectedLabel}
        <span aria-hidden style={{ fontSize: 10 }}>▾</span>
      </button>
      {open && (
        <div
          role="listbox"
          onMouseLeave={() => setOpen(false)}
          style={{
            position: "absolute",
            insetInlineStart: 0,
            top: "calc(100% + 6px)",
            background: BG,
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
            minWidth: 180,
            zIndex: 10,
            padding: 4,
          }}
        >
          {markets.map((m) => (
            <button
              key={m.id}
              type="button"
              role="option"
              aria-selected={m.id === selected}
              onClick={() => { onChange(m.id); setOpen(false); }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "start",
                padding: "8px 10px",
                border: "none",
                borderRadius: 6,
                background: m.id === selected ? "#F2F2F2" : "transparent",
                color: TEXT,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
