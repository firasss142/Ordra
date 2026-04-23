"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Upload } from "lucide-react";
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

  filtersOpen: boolean;
  onFiltersOpenChange: (open: boolean) => void;

  hasActiveFilters: boolean;

  onOpenCampaigns: () => void;
  onOpenCsvImport: () => void;
  onNewLead: () => void;
}

const SOFT_BG = "#FFFFFF";
const BORDER = "#E1E3E5";
const TEXT = "#1A1A1A";
const MUTED = "#6D7175";

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
  filtersOpen,
  onFiltersOpenChange,
  onOpenCampaigns,
  onOpenCsvImport,
  onNewLead,
}: Props) {
  const t = useTranslations("crm.leads");
  const tBuckets = useTranslations("crm.leads.buckets");
  const tSources = useTranslations("crm.leads.sources");

  const bucketOptions = BUCKETS.map((b) => ({ key: b, label: tBuckets(b) }));
  const activeFilterCount =
    (source !== null ? 1 : 0) + (selectedCampaignId !== null ? 1 : 0);

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

        <BucketSegmented
          options={bucketOptions}
          active={bucket}
          onSelect={onBucketChange}
        />

        <FiltersPopover
          open={filtersOpen}
          onOpenChange={onFiltersOpenChange}
          activeCount={activeFilterCount}
          source={source}
          onSourceChange={onSourceChange}
          campaigns={campaigns}
          selectedCampaignId={selectedCampaignId}
          onCampaignChange={onCampaignChange}
          onOpenCampaigns={onOpenCampaigns}
          t={t}
          tSources={tSources}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          onClick={onOpenCsvImport}
          title={t("csvImport")}
          aria-label={t("csvImport")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 34,
            height: 34,
            borderRadius: 9999,
            border: `1px solid ${BORDER}`,
            background: SOFT_BG,
            color: TEXT,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <Upload size={16} strokeWidth={1.75} />
        </button>

        <button
          type="button"
          onClick={onNewLead}
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
          + {t("newLead")}
        </button>
      </div>
    </div>
  );
}

function FiltersPopover({
  open,
  onOpenChange,
  activeCount,
  source,
  onSourceChange,
  campaigns,
  selectedCampaignId,
  onCampaignChange,
  onOpenCampaigns,
  t,
  tSources,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  activeCount: number;
  source: LeadSource | null;
  onSourceChange: (s: LeadSource | null) => void;
  campaigns: ProspectCampaign[];
  selectedCampaignId: string | null;
  onCampaignChange: (id: string | null) => void;
  onOpenCampaigns: () => void;
  t: ReturnType<typeof useTranslations>;
  tSources: ReturnType<typeof useTranslations>;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onOpenChange]);

  const label =
    activeCount > 0
      ? `${t("filters")} · ${activeCount}`
      : t("filters");

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          borderRadius: 9999,
          border: activeCount > 0 ? `1px solid ${TEXT}` : `1px solid ${BORDER}`,
          background: activeCount > 0 ? TEXT : SOFT_BG,
          color: activeCount > 0 ? "#FFFFFF" : TEXT,
          fontSize: 13,
          fontWeight: 500,
          cursor: "pointer",
        }}
      >
        {label}
        <span aria-hidden style={{ fontSize: 10 }}>▾</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("filters")}
          onKeyDown={(e) => {
            if (e.key === "Escape") onOpenChange(false);
          }}
          style={{
            position: "absolute",
            insetInlineStart: 0,
            top: "calc(100% + 6px)",
            background: SOFT_BG,
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
            minWidth: 240,
            zIndex: 20,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {/* Source row */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: MUTED }}>
              {t("sourceLabel")}
            </label>
            <select
              value={source ?? ""}
              onChange={(e) =>
                onSourceChange((e.target.value as LeadSource) || null)
              }
              style={selectStyle}
            >
              <option value="">{t("allSourcesLabel")}</option>
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {tSources(s)}
                </option>
              ))}
            </select>
          </div>

          {/* Campaign row */}
          {campaigns.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: MUTED }}>
                {t("campaignLabel")}
              </label>
              <select
                value={selectedCampaignId ?? ""}
                onChange={(e) => onCampaignChange(e.target.value || null)}
                style={selectStyle}
              >
                <option value="">{t("allCampaigns")}</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div
            style={{
              borderTop: `1px solid ${BORDER}`,
              paddingTop: 8,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <button
              type="button"
              onClick={() => {
                onOpenCampaigns();
                onOpenChange(false);
              }}
              style={linkBtn}
            >
              {t("manageCampaigns")} →
            </button>

            {activeCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  onSourceChange(null);
                  onCampaignChange(null);
                  onOpenChange(false);
                }}
                style={linkBtn}
              >
                {t("clearAllFilters")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  border: `1px solid ${BORDER}`,
  borderRadius: 6,
  fontSize: 13,
  background: SOFT_BG,
  color: TEXT,
  padding: "4px 8px",
  width: "100%",
  cursor: "pointer",
};

const linkBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: "4px 0",
  fontSize: 13,
  color: MUTED,
  cursor: "pointer",
  textAlign: "start",
  fontWeight: 500,
};

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
