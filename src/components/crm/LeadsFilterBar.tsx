"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import {
  LEAD_SOURCES,
  type LeadSource,
  type LeadStatus,
} from "@/types/lead";

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

  onReset: () => void;
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
  onReset,
  hasActiveFilters,
  onOpenCampaigns,
  onOpenCsvImport,
  onNewLead,
}: Props) {
  const t = useTranslations("crm.leads");
  const tBuckets = useTranslations("crm.leads.buckets");
  const tSources = useTranslations("crm.leads.sources");

  const bucketOptions = BUCKETS.map((b) => ({ key: b, label: tBuckets(b) }));

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

        <SourceChip
          selected={source}
          onChange={onSourceChange}
          allLabel={t("allSourcesLabel")}
          labelFor={(s) => tSources(s)}
        />

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

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onOpenCampaigns}
          style={secondaryPill}
        >
          {t("campaigns")}
        </button>
        <button
          type="button"
          onClick={onOpenCsvImport}
          style={secondaryPill}
          aria-label={t("csvImport")}
        >
          {t("csvImport")}
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

const secondaryPill: React.CSSProperties = {
  height: 34,
  padding: "0 14px",
  fontSize: 13,
  fontWeight: 500,
  border: `1px solid ${BORDER}`,
  borderRadius: 9999,
  background: "#FFFFFF",
  color: TEXT,
  cursor: "pointer",
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

function SourceChip({
  selected,
  onChange,
  allLabel,
  labelFor,
}: {
  selected: LeadSource | null;
  onChange: (s: LeadSource | null) => void;
  allLabel: string;
  labelFor: (s: LeadSource) => string;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabel = selected ? labelFor(selected) : allLabel;

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
            minWidth: 200,
            zIndex: 10,
            padding: 4,
          }}
        >
          <Option
            label={allLabel}
            selected={selected === null}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          />
          {LEAD_SOURCES.map((s) => (
            <Option
              key={s}
              label={labelFor(s)}
              selected={selected === s}
              onClick={() => {
                onChange(s);
                setOpen(false);
              }}
            />
          ))}
        </div>
      ) : null}
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
