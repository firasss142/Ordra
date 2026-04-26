"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Plus,
  Filter,
  Globe,
  ChevronDown,
  LayoutGrid,
  ListChecks,
} from "lucide-react";
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

const CARD_BG = "#FFFFFF";
const SOFT_BG = "#FFFFFF";
const BORDER = "#E1E3E5";
const SUBTLE_BG = "#F6F6F7";
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

  const statusOptions: { value: string; label: string }[] = [
    { value: "", label: t("allStatuses") },
    ...FOLLOW_UP_STATUSES.map((s) => ({ value: s, label: tStatuses(s) })),
  ];

  const showSecondRow = viewMode === "kanban";

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
      {/* Top row: market + view toggle + actions */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 10,
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

          {!hideViewToggle && (
            <>
              <Divider />
              <ViewToggle
                view={viewMode}
                onViewChange={onViewModeChange}
                timelineLabel={t("viewTimeline")}
                kanbanLabel={t("viewKanban")}
              />
            </>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={onNewFollowUp}
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
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <Plus size={14} strokeWidth={2} />
            {t("newFollowUp")}
          </button>
        </div>
      </div>

      {/* Second row: inline filter chips (only when kanban is active) */}
      {showSecondRow && (
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
            {t("filters") /* falls back to key if missing — provide via i18n */}
          </span>

          <SelectChip
            icon={<ListChecks size={13} strokeWidth={1.75} />}
            label={t("statusLabel")}
            value={statusFilter === "all" ? null : statusFilter}
            valueLabel={statusFilter === "all" ? null : tStatuses(statusFilter)}
            options={statusOptions}
            onChange={(v) => onStatusChange((v as StatusFilter) || "all")}
            onClear={() => onStatusChange("all")}
          />

          {hasActiveFilters && (
            <button
              type="button"
              onClick={onReset}
              style={{
                marginInlineStart: "auto",
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
              {t("reset")}
            </button>
          )}
        </div>
      )}
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

function ViewToggle({
  view,
  onViewChange,
  timelineLabel,
  kanbanLabel,
}: {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  timelineLabel: string;
  kanbanLabel: string;
}) {
  const items: { key: ViewMode; label: string; icon: React.ReactNode }[] = [
    { key: "timeline", label: timelineLabel, icon: <ListChecks size={13} strokeWidth={1.75} /> },
    { key: "kanban", label: kanbanLabel, icon: <LayoutGrid size={13} strokeWidth={1.75} /> },
  ];
  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        background: SUBTLE_BG,
        borderRadius: 8,
        padding: 2,
        gap: 2,
        border: `1px solid ${BORDER}`,
      }}
    >
      {items.map((it) => {
        const isActive = view === it.key;
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onViewChange(it.key)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 10px",
              border: "none",
              borderRadius: 6,
              background: isActive ? "#FFFFFF" : "transparent",
              color: TEXT,
              fontSize: 12,
              fontWeight: isActive ? 600 : 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
              boxShadow: isActive ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
              fontFamily: "inherit",
            }}
          >
            {it.icon}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

function SelectChip({
  icon,
  label,
  value,
  valueLabel,
  options,
  onChange,
  onClear,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  valueLabel: string | null;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const isActive = value !== null && value !== "";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div
        style={{
          display: "inline-flex",
          alignItems: "stretch",
          height: 28,
          borderRadius: 6,
          border: `1px solid ${isActive ? TEXT : BORDER}`,
          background: isActive ? TEXT : SOFT_BG,
          color: isActive ? "#FFFFFF" : TEXT,
          overflow: "hidden",
        }}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "0 10px",
            border: "none",
            background: "transparent",
            color: "inherit",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {icon}
          <span style={{ opacity: isActive ? 0.8 : 1 }}>{label}</span>
          {isActive && valueLabel ? (
            <>
              <span aria-hidden style={{ opacity: 0.5 }}>·</span>
              <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {valueLabel}
              </span>
            </>
          ) : (
            <ChevronDown size={11} strokeWidth={2} />
          )}
        </button>
        {isActive && (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Clear ${label}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 6px",
              border: "none",
              borderInlineStart: `1px solid rgba(255,255,255,0.2)`,
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            <span aria-hidden style={{ fontSize: 11, fontWeight: 600 }}>×</span>
          </button>
        )}
      </div>

      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            insetInlineStart: 0,
            top: "calc(100% + 4px)",
            background: CARD_BG,
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
            minWidth: "min(200px, calc(100vw - 24px))",
            maxHeight: 280,
            overflowY: "auto",
            zIndex: 30,
            padding: 4,
          }}
        >
          {options.map((o) => {
            const selected = (value ?? "") === o.value;
            return (
              <Option
                key={o.value || "_none"}
                label={o.label}
                selected={selected}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              />
            );
          })}
        </div>
      )}
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (locked) {
    return (
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
        {lockedLabel}
      </span>
    );
  }

  const selectedLabel =
    selected === "all"
      ? allLabel
      : markets.find((m) => m.id === selected)?.name ?? allLabel;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 30,
          padding: "0 12px",
          borderRadius: 8,
          border: `1px solid ${BORDER}`,
          background: SOFT_BG,
          color: TEXT,
          fontSize: 13,
          fontWeight: 500,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <Globe size={13} strokeWidth={1.75} />
        {selectedLabel}
        <ChevronDown size={11} strokeWidth={2} />
      </button>
      {open ? (
        <div
          role="listbox"
          style={{
            position: "absolute",
            insetInlineStart: 0,
            top: "calc(100% + 4px)",
            background: SOFT_BG,
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
            minWidth: "min(200px, calc(100vw - 24px))",
            zIndex: 20,
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
        fontWeight: selected ? 600 : 500,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );
}
