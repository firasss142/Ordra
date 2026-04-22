"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { FOLLOW_UP_STATUSES, type FollowUpStatus, type FollowUpCampaign } from "@/types/follow-up";

interface Market {
  id: string;
  name: string;
}

type StatusFilter = "all" | FollowUpStatus;

interface Props {
  markets: Market[];
  selectedMarketId: string | "all" | null;
  onMarketChange: (id: string | "all") => void;
  lockMarket: boolean;
  lockedMarketLabel: string;

  statusFilter: StatusFilter;
  onStatusChange: (s: StatusFilter) => void;

  campaignId: string | null;
  campaigns: FollowUpCampaign[];
  /** Called the first time the campaign chip opens — used to trigger lazy load. */
  onCampaignsOpen?: () => void;
  onCampaignChange: (id: string | null) => void;
  onOpenCampaignPanel?: () => void;

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
  campaignId,
  campaigns,
  onCampaignsOpen,
  onCampaignChange,
  onOpenCampaignPanel,
  onReset,
  onNewFollowUp,
  hasActiveFilters,
}: Props) {
  const t = useTranslations("crm.followUps");
  const tStatuses = useTranslations("crm.followUps.statuses");
  const tCampaigns = useTranslations("crm.followUps.campaigns");

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

        <StatusSegmented
          options={statusOptions}
          active={statusFilter}
          onSelect={onStatusChange}
        />

        <CampaignChip
          campaignId={campaignId}
          campaigns={campaigns}
          onOpen={onCampaignsOpen}
          onChange={onCampaignChange}
          onOpenPanel={onOpenCampaignPanel}
          allLabel={tCampaigns("allCampaigns")}
          placeholder={tCampaigns("allCampaigns")}
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

function CampaignChip({
  campaignId,
  campaigns,
  onOpen,
  onChange,
  onOpenPanel,
  allLabel,
  placeholder,
}: {
  campaignId: string | null;
  campaigns: FollowUpCampaign[];
  onOpen?: () => void;
  onChange: (id: string | null) => void;
  onOpenPanel?: () => void;
  allLabel: string;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const active = campaignId !== null;
  const label = active
    ? campaigns.find((c) => c.id === campaignId)?.name ?? placeholder
    : allLabel;

  const handleToggle = () => {
    setOpen((o) => {
      const next = !o;
      if (next && onOpen) onOpen();
      return next;
    });
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          borderRadius: 9999,
          border: `1px solid ${active ? TEXT : BORDER}`,
          background: SOFT_BG,
          color: TEXT,
          fontSize: 13,
          fontWeight: active ? 600 : 500,
          cursor: "pointer",
          maxWidth: 220,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
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
            minWidth: 220,
            maxHeight: 320,
            overflowY: "auto",
            zIndex: 10,
            padding: 4,
          }}
        >
          <Option
            label={allLabel}
            selected={campaignId === null}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          />
          {campaigns.map((c) => (
            <Option
              key={c.id}
              label={c.name}
              selected={campaignId === c.id}
              onClick={() => {
                onChange(c.id);
                setOpen(false);
              }}
            />
          ))}
          {onOpenPanel ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenPanel();
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "start",
                padding: "8px 10px",
                border: "none",
                borderTop: `1px solid ${BORDER}`,
                borderRadius: 0,
                background: "transparent",
                color: TEXT,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                marginTop: 4,
              }}
            >
              · · ·
            </button>
          ) : null}
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
