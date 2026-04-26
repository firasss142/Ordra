"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Filter, Sparkles } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { AssignmentAlgorithm } from "@/types/settings";
import { AssignmentAlgorithm as ALGO } from "@/types/settings";

const ALGO_OPTIONS: AssignmentAlgorithm[] = [
  ALGO.manual,
  ALGO.round_robin,
  ALGO.workload,
  ALGO.product_based,
  ALGO.region_based,
];

interface Props {
  selectedCount: number;
  totalCount: number;
  onAutoAssign: () => void;
  algorithm: AssignmentAlgorithm;
  onAlgorithmChange: (next: AssignmentAlgorithm) => void;
  isActive: boolean;
  onIsActiveChange: (next: boolean) => void;
  autoBusy?: boolean;
  onClearSelection: () => void;
  onSelectAll: () => void;
}

const CARD_BG = "#FFFFFF";
const SOFT_BG = "#FFFFFF";
const BORDER = "#E1E3E5";
const SUBTLE_BG = "#F6F6F7";
const TEXT = "#1A1A1A";
const MUTED = "#6D7175";

export function AutoAssignBar({
  selectedCount,
  totalCount,
  onAutoAssign,
  algorithm,
  onAlgorithmChange,
  isActive,
  onIsActiveChange,
  autoBusy = false,
  onClearSelection,
  onSelectAll,
}: Props) {
  const t = useTranslations("assign");
  const isMobile = useIsMobile();
  const canAuto = algorithm !== "manual" && isActive;
  const autoDisabled = selectedCount === 0 || !canAuto || autoBusy;
  const allSelected = totalCount > 0 && selectedCount === totalCount;

  const disabledReason = (() => {
    if (autoBusy) return t("autoAssign.busy");
    if (selectedCount === 0) return t("autoAssign.noSelection");
    if (algorithm === "manual") return t("autoAssign.pickAlgorithm");
    if (!isActive) return t("autoAssign.activateFirst");
    return "";
  })();

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
      {/* Top row: selection cluster + algorithm/auto-assign cluster */}
      <div
        style={{
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          flexWrap: isMobile ? undefined : "wrap",
          alignItems: isMobile ? "stretch" : "center",
          gap: 10,
          justifyContent: isMobile ? undefined : "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 30,
              padding: "0 12px",
              borderRadius: 8,
              border: `1px solid ${BORDER}`,
              background: SUBTLE_BG,
              fontSize: 13,
              color: TEXT,
              fontWeight: 500,
              cursor: totalCount === 0 ? "not-allowed" : "pointer",
              fontFamily: "inherit",
            }}
          >
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = selectedCount > 0 && !allSelected;
              }}
              disabled={totalCount === 0}
              onChange={(e) => (e.target.checked ? onSelectAll() : onClearSelection())}
              aria-label={t("selectAll")}
              style={{ cursor: totalCount === 0 ? "not-allowed" : "pointer" }}
            />
            {t("selectAll")}
          </label>

          <Divider />

          <span
            style={{
              fontSize: 13,
              color: TEXT,
              fontWeight: 500,
              fontFamily: "inherit",
            }}
          >
            {t("selection", { count: selectedCount })}
          </span>

          {selectedCount > 0 ? (
            <button
              type="button"
              onClick={onClearSelection}
              style={{
                height: 28,
                padding: "0 10px",
                fontSize: 12,
                fontWeight: 500,
                color: MUTED,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                textDecoration: "underline",
                textUnderlineOffset: 2,
              }}
            >
              {t("clearSelection")}
            </button>
          ) : null}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={onAutoAssign}
            disabled={autoDisabled}
            title={autoDisabled ? disabledReason : undefined}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              height: 34,
              padding: "0 14px",
              width: isMobile ? "100%" : undefined,
              fontSize: 13,
              fontWeight: 500,
              border: `1px solid ${autoDisabled ? BORDER : TEXT}`,
              borderRadius: 8,
              background: autoDisabled ? "#F2F2F2" : TEXT,
              color: autoDisabled ? MUTED : "#FFFFFF",
              cursor: autoDisabled ? "not-allowed" : "pointer",
              fontFamily: "inherit",
            }}
          >
            <Sparkles size={14} strokeWidth={2} />
            {autoBusy ? t("autoAssign.running") : t("autoAssign.button")}
          </button>
        </div>
      </div>

      {/* Second row: algorithm config */}
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
          {t("algorithm.label")}
        </span>

        <select
          value={algorithm}
          onChange={(e) => onAlgorithmChange(e.target.value as AssignmentAlgorithm)}
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
          {ALGO_OPTIONS.map((a) => (
            <option key={a} value={a}>
              {t(`algorithm.${a}`)}
            </option>
          ))}
        </select>

        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 28,
            padding: "0 10px",
            borderRadius: 6,
            border: `1px solid ${isActive ? TEXT : BORDER}`,
            background: isActive ? TEXT : SOFT_BG,
            color: isActive ? "#FFFFFF" : TEXT,
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => onIsActiveChange(e.target.checked)}
            style={{ accentColor: TEXT }}
          />
          {t("algorithm.active")}
        </label>
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
