"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { FOLLOW_UP_STATUSES, type FollowUpStatus } from "@/types/follow-up";

interface Market {
  id: string;
  name: string;
}

type StatusFilter = "all" | FollowUpStatus;

export type ViewMode = "timeline" | "kanban";

interface Props {
  markets: Market[];
  selectedMarketId: string | "all" | null;
  onMarketChange: (id: string | "all") => void;
  lockMarket: boolean;
  lockedMarketLabel: string;

  statusFilter: StatusFilter;
  onStatusChange: (s: StatusFilter) => void;

  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
  /** Hide the timeline/kanban toggle (e.g. for agents who only get timeline). */
  hideViewToggle?: boolean;

  onReset: () => void;
  onNewFollowUp: () => void;

  hasActiveFilters: boolean;
}

const SOFT_BG = "#FFFFFF";
const BORDER = "#E1E3E5";
const TEXT = "#1A1A1A";
const MUTED = "#6D7175";

export function FollowUpsFilterBar({
  markets,
  selectedMarketId,
  onMarketChange,
  lockMarket,
  lockedMarketLabel,
  statusFilter,
  onStatusChange,
  viewMode,
  onViewModeChange,
  hideViewToggle = false,
  onReset,
  onNewFollowUp,
  hasActiveFilters,
}: Props) {
  const t = useTranslations("crm.followUps");
  const tStatuses = useTranslations("crm.followUps.statuses");

  const statusOptions: { key: StatusFilter; label: string }[] = [
    { key: "all", label: t("allStatuses") },
    ...FOLLOW_UP_STATUSES.map((s) => ({ key: s as StatusFilter, label: tStatuses(s) })),
  ];

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
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <MarketChip
          markets={markets}
          selected={selectedMarketId}
          onChange={onMarketChange}
          locked={lockMarket}
          lockedLabel={lockedMarketLabel}
          allLabel={t("allMarkets")}
        />

        {/* View mode toggle */}
        {!hideViewToggle && (
        <div
          role="tablist"
          style={{
            display: "inline-flex",
            border: `1px solid ${BORDER}`,
            borderRadius: 9999,
            background: SOFT_BG,
            padding: 2,
            gap: 2,
          }}
        >
          {(["timeline", "kanban"] as ViewMode[]).map((m) => {
            const isActive = viewMode === m;
            const label = m === "timeline" ? t("viewTimeline") : t("viewKanban");
            return (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onViewModeChange(m)}
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
                {label}
              </button>
            );
          })}
        </div>
        )}

        {viewMode === "kanban" && (
          <StatusSegmented
            options={statusOptions}
            active={statusFilter}
            onSelect={onStatusChange}
          />
        )}

        {hasActiveFilters ? (
          <button
            type="button"
            onClick={onReset}
            style={{
              padding: "6px 12px",
              borderRadius: 9999,
              border: `1px solid ${BORDER}`,
              background: "#FFFFFF",
              color: MUTED,
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {t("reset")}
          </button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onNewFollowUp}
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
        }}
      >
        + {t("newFollowUp")}
      </button>
    </div>
  );
}

function StatusSegmented({
  options,
  active,
  onSelect,
}: {
  options: { key: StatusFilter; label: string }[];
  active: StatusFilter;
  onSelect: (k: StatusFilter) => void;
}) {
  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        border: `1px solid ${BORDER}`,
        borderRadius: 9999,
        background: SOFT_BG,
        padding: 2,
        gap: 2,
      }}
    >
      {options.map((o) => {
        const isActive = active === o.key;
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(o.key)}
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
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function MarketChip({
  markets,
  selected,
  onChange,
  locked,
  lockedLabel,
  allLabel,
}: {
  markets: Market[];
  selected: string | "all" | null;
  onChange: (id: string | "all") => void;
  locked: boolean;
  lockedLabel: string;
  allLabel: string;
}) {
  const [open, setOpen] = useState(false);

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

  const selectedLabel =
    selected === "all"
      ? allLabel
      : markets.find((m) => m.id === selected)?.name ?? allLabel;

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
          background: SOFT_BG,
          color: TEXT,
          fontSize: 13,
          fontWeight: 500,
          cursor: "pointer",
        }}
      >
        {selectedLabel}
        <span aria-hidden style={{ fontSize: 10 }}>▾</span>
      </button>
      {open ? (
        <div
          role="listbox"
          onMouseLeave={() => setOpen(false)}
          style={{
            position: "absolute",
            insetInlineStart: 0,
            top: "calc(100% + 6px)",
            background: SOFT_BG,
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
            minWidth: 180,
            zIndex: 10,
            padding: 4,
          }}
        >
          <Option
            label={allLabel}
            selected={selected === "all"}
            onClick={() => {
              onChange("all");
              setOpen(false);
            }}
          />
          {markets.map((m) => (
            <Option
              key={m.id}
              label={m.name}
              selected={selected === m.id}
              onClick={() => {
                onChange(m.id);
                setOpen(false);
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Option({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "block",
        width: "100%",
        textAlign: "start",
        padding: "8px 10px",
        border: "none",
        borderRadius: 6,
        background: selected ? "#F2F2F2" : hover ? "#F7F7F7" : "transparent",
        color: TEXT,
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

