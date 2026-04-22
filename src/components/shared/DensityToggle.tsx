"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { KanbanDensity } from "./KanbanBoard";

interface Props {
  value: KanbanDensity;
  onChange: (value: KanbanDensity) => void;
}

/**
 * Segmented control for Kanban density. Matches the list/kanban view toggle
 * visually so the two controls feel like a pair.
 */
export function DensityToggle({ value, onChange }: Props) {
  const t = useTranslations("kanban.density");
  return (
    <div
      role="group"
      aria-label={t("label")}
      style={{
        display: "inline-flex",
        border: "1px solid #D1D5DB",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        aria-pressed={value === "comfortable"}
        onClick={() => onChange("comfortable")}
        style={{
          height: 32,
          padding: "0 10px",
          fontSize: 12,
          border: "none",
          cursor: "pointer",
          background: value === "comfortable" ? "#1A1A1A" : "white",
          color: value === "comfortable" ? "white" : "#1A1A1A",
        }}
      >
        {t("comfortable")}
      </button>
      <button
        type="button"
        aria-pressed={value === "compact"}
        onClick={() => onChange("compact")}
        style={{
          height: 32,
          padding: "0 10px",
          fontSize: 12,
          border: "none",
          cursor: "pointer",
          background: value === "compact" ? "#1A1A1A" : "white",
          color: value === "compact" ? "white" : "#1A1A1A",
        }}
      >
        {t("compact")}
      </button>
    </div>
  );
}
