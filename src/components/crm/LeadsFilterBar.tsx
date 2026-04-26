"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Upload,
  Plus,
  Flame,
  Filter,
  Globe,
  Megaphone,
  X,
  ChevronDown,
  LayoutGrid,
  Rows3,
  MapPin,
} from "lucide-react";
import {
  LEAD_SOURCES,
  type LeadSource,
  type LeadStatus,
} from "@/types/lead";
import type { ProspectCampaign } from "@/hooks/useProspectCampaigns";

interface Market {
  id: string;
  name: string;
}

export type LeadBucket = "all" | "new" | "active" | "qualified" | "closed";

export const BUCKET_STATUSES: Record<Exclude<LeadBucket, "all">, LeadStatus[]> = {
  new: ["new", "assigned"],
  active: ["attempt_1", "attempt_2", "attempt_3", "callback_scheduled"],
  qualified: ["qualified"],
  closed: ["won", "lost", "archived"],
};

interface Props {
  markets: Market[];
  selectedMarketId: string | "all" | null;
  onMarketChange: (id: string | "all") => void;
  lockMarket: boolean;
  lockedMarketLabel: string;

  bucket: LeadBucket;
  onBucketChange: (b: LeadBucket) => void;

  source: LeadSource | null;
  onSourceChange: (s: LeadSource | null) => void;

  campaigns: ProspectCampaign[];
  selectedCampaignId: string | null;
  onCampaignChange: (id: string | null) => void;

  filtersOpen?: boolean;
  onFiltersOpenChange?: (open: boolean) => void;

  hasActiveFilters?: boolean;

  view?: "kanban" | "table";
  onViewChange?: (v: "kanban" | "table") => void;
  hotOnly?: boolean;
  onHotOnlyChange?: (v: boolean) => void;

  onOpenCampaigns: () => void;
  onOpenCsvImport: () => void;
  onNewLead: () => void;
}

const CARD_BG = "#FFFFFF";
const SOFT_BG = "#FFFFFF";
const BORDER = "#E1E3E5";
const SUBTLE_BG = "#F6F6F7";
const TEXT = "#1A1A1A";
const MUTED = "#6D7175";
const HOT = "#D72C0D";
const HOT_BG = "#FFF4F4";

const BUCKETS: LeadBucket[] = ["all", "new", "active", "qualified", "closed"];

export function LeadsFilterBar({
  markets,
  selectedMarketId,
  onMarketChange,
  lockMarket,
  lockedMarketLabel,
  bucket,
  onBucketChange,
  source,
  onSourceChange,
  campaigns,
  selectedCampaignId,
  onCampaignChange,
  view,
  onViewChange,
  hotOnly,
  onHotOnlyChange,
  onOpenCampaigns,
  onOpenCsvImport,
  onNewLead,
}: Props) {
  const t = useTranslations("crm.leads");
  const tBuckets = useTranslations("crm.leads.buckets");
  const tSources = useTranslations("crm.leads.sources");
  const tViews = useTranslations("crm.leads.views");

  const bucketOptions = BUCKETS.map((b) => ({ key: b, label: tBuckets(b) }));

  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId) ?? null;

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
      {/* Top row: market + actions (always on one line) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <MarketChip
          markets={markets}
          selected={selectedMarketId}
          onChange={onMarketChange}
          locked={lockMarket}
          lockedLabel={lockedMarketLabel}
          allLabel={t("allMarkets")}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginInlineStart: "auto" }}>
          {view !== undefined && onViewChange && (
            <ViewToggle
              view={view}
              onViewChange={onViewChange}
              kanbanLabel={tViews("kanban")}
              tableLabel={tViews("table")}
              mapLabel={tViews("map")}
            />
          )}
          <IconButton
            onClick={onOpenCsvImport}
            label={t("csvImport")}
            icon={<Upload size={15} strokeWidth={1.75} />}
          />
          <button
            type="button"
            onClick={onNewLead}
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
              whiteSpace: "nowrap",
            }}
          >
            <Plus size={14} strokeWidth={2} />
            {t("newLead")}
          </button>
        </div>
      </div>

      {/* Bucket tabs row — scrollable on small screens */}
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <BucketSegmented
          options={bucketOptions}
          active={bucket}
          onSelect={onBucketChange}
        />
      </div>

      {/* Second row: inline filter chips */}
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
          {t("filters")}
        </span>

        <SelectChip
          icon={<Globe size={13} strokeWidth={1.75} />}
          label={t("sourceLabel")}
          value={source}
          valueLabel={source ? tSources(source) : null}
          options={[
            { value: "", label: t("allSourcesLabel") },
            ...LEAD_SOURCES.map((s) => ({ value: s, label: tSources(s) })),
          ]}
          onChange={(v) => onSourceChange((v as LeadSource) || null)}
          onClear={() => onSourceChange(null)}
        />

        {campaigns.length > 0 && (
          <SelectChip
            icon={<Megaphone size={13} strokeWidth={1.75} />}
            label={t("campaignLabel")}
            value={selectedCampaignId}
            valueLabel={selectedCampaign?.name ?? null}
            options={[
              { value: "", label: t("allCampaigns") },
              ...campaigns.map((c) => ({ value: c.id, label: c.name })),
            ]}
            onChange={(v) => onCampaignChange(v || null)}
            onClear={() => onCampaignChange(null)}
          />
        )}

        {onHotOnlyChange && (
          <ToggleChip
            icon={<Flame size={13} strokeWidth={1.75} />}
            label={t("hotLeads.filterToggle")}
            active={hotOnly ?? false}
            onToggle={() => onHotOnlyChange(!(hotOnly ?? false))}
            activeFg={HOT}
            activeBg={HOT_BG}
            activeBorder="#F0B6B4"
          />
        )}

        <button
          type="button"
          onClick={onOpenCampaigns}
          title={t("manageCampaigns")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 28,
            padding: "0 10px",
            fontSize: 12,
            fontWeight: 500,
            color: MUTED,
            background: "transparent",
            border: `1px dashed ${BORDER}`,
            borderRadius: 6,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          <Megaphone size={12} strokeWidth={1.75} />
          {t("manageCampaigns")}
        </button>

        {(source || selectedCampaignId || (hotOnly ?? false)) && (
          <button
            type="button"
            onClick={() => {
              onSourceChange(null);
              onCampaignChange(null);
              onHotOnlyChange?.(false);
            }}
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
            {t("clearAllFilters")}
          </button>
        )}
      </div>
    </div>
  );
}

function IconButton({
  onClick,
  label,
  icon,
}: {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 34,
        height: 34,
        borderRadius: 8,
        border: `1px solid ${BORDER}`,
        background: SOFT_BG,
        color: TEXT,
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      {icon}
    </button>
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
            <X size={11} strokeWidth={2} />
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
            minWidth: 200,
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

function ToggleChip({
  icon,
  label,
  active,
  onToggle,
  activeFg,
  activeBg,
  activeBorder,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onToggle: () => void;
  activeFg: string;
  activeBg: string;
  activeBorder: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 28,
        padding: "0 10px",
        borderRadius: 6,
        border: `1px solid ${active ? activeBorder : BORDER}`,
        background: active ? activeBg : SOFT_BG,
        color: active ? activeFg : TEXT,
        fontSize: 12,
        fontWeight: 500,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function BucketSegmented({
  options,
  active,
  onSelect,
}: {
  options: { key: LeadBucket; label: string }[];
  active: LeadBucket;
  onSelect: (k: LeadBucket) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="status-bucket"
      style={{
        display: "inline-flex",
        background: SUBTLE_BG,
        borderRadius: 8,
        padding: 2,
        gap: 2,
        border: `1px solid ${BORDER}`,
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
            minWidth: 200,
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

function ViewToggle({
  view,
  onViewChange,
  kanbanLabel,
  tableLabel,
  mapLabel,
}: {
  view: "kanban" | "table";
  onViewChange: (v: "kanban" | "table") => void;
  kanbanLabel: string;
  tableLabel: string;
  mapLabel: string;
}) {
  const items: {
    key: "kanban" | "table" | "map";
    label: string;
    icon: React.ReactNode;
    disabled?: boolean;
  }[] = [
    { key: "kanban", label: kanbanLabel, icon: <LayoutGrid size={13} strokeWidth={1.75} /> },
    { key: "table", label: tableLabel, icon: <Rows3 size={13} strokeWidth={1.75} /> },
    { key: "map", label: mapLabel, icon: <MapPin size={13} strokeWidth={1.75} />, disabled: true },
  ];
  return (
    <div
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
            aria-selected={isActive}
            disabled={it.disabled}
            onClick={() => !it.disabled && onViewChange(it.key as "kanban" | "table")}
            title={it.label}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 10px",
              border: "none",
              borderRadius: 6,
              background: isActive ? "#FFFFFF" : "transparent",
              color: it.disabled ? MUTED : TEXT,
              fontSize: 12,
              fontWeight: isActive ? 600 : 500,
              cursor: it.disabled ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
              boxShadow: isActive ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
              fontFamily: "inherit",
              opacity: it.disabled ? 0.6 : 1,
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
