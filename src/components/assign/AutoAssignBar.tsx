"use client";

import { useTranslations } from "next-intl";
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
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        background: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        flexWrap: "wrap",
      }}
    >
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          color: "#1A1A1A",
          fontWeight: 500,
          cursor: totalCount === 0 ? "not-allowed" : "pointer",
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
      <span style={{ fontSize: 13, color: "#1A1A1A", fontWeight: 500 }}>
        {t("selection", { count: selectedCount })}
      </span>
      {selectedCount > 0 ? (
        <button
          type="button"
          onClick={onClearSelection}
          style={{
            padding: "4px 8px",
            fontSize: 12,
            background: "transparent",
            border: "1px solid #E1E3E5",
            borderRadius: 6,
            color: "#6D7175",
            cursor: "pointer",
          }}
        >
          {t("clearSelection")}
        </button>
      ) : null}

      <div style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        <label style={{ fontSize: 12, color: "#6D7175" }}>
          {t("algorithm.label")}
        </label>
        <select
          value={algorithm}
          onChange={(e) => onAlgorithmChange(e.target.value as AssignmentAlgorithm)}
          style={{
            padding: "6px 8px",
            fontSize: 13,
            border: "1px solid #E1E3E5",
            borderRadius: 6,
            background: "#FFFFFF",
            color: "#1A1A1A",
            cursor: "pointer",
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
            fontSize: 12,
            color: "#6D7175",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => onIsActiveChange(e.target.checked)}
          />
          {t("algorithm.active")}
        </label>
        <button
          type="button"
          onClick={onAutoAssign}
          disabled={autoDisabled}
          title={autoDisabled ? disabledReason : undefined}
          style={{
            padding: "6px 12px",
            border: "1px solid #1A1A1A",
            borderRadius: 6,
            background: autoDisabled ? "#F2F2F2" : "#1A1A1A",
            color: autoDisabled ? "#6D7175" : "#FFFFFF",
            fontSize: 13,
            fontWeight: 600,
            cursor: autoDisabled ? "not-allowed" : "pointer",
          }}
        >
          {autoBusy ? t("autoAssign.running") : t("autoAssign.button")}
        </button>
      </div>
    </div>
  );
}
