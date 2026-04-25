"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { OrderListFilters } from "@/lib/orders/list-filters";
import { useDebounce } from "@/hooks/useDebounce";

interface Market {
  id: string;
  name: string;
}

interface Props {
  filters: OrderListFilters;
  onChange: (patch: Partial<OrderListFilters>) => void;
  onOpenAdvanced: () => void;
  onNewOrder: () => void;
  onExport: () => void;
  isSuperAdmin: boolean;
  markets: Market[];
  lockedMarketLabel: string;
}

export function OrdersFilterBar({
  filters,
  onChange,
  onOpenAdvanced,
  onNewOrder,
  onExport,
  isSuperAdmin,
  markets,
  lockedMarketLabel,
}: Props) {
  const t = useTranslations("orders");

  // Local search state + 250ms debounce → onChange patch
  const [localQ, setLocalQ] = useState(filters.q);
  const debouncedQ = useDebounce(localQ, 250);
  const lastSentQ = useRef(filters.q);

  useEffect(() => {
    if (debouncedQ === lastSentQ.current) return;
    lastSentQ.current = debouncedQ;
    onChange({ q: debouncedQ });
  }, [debouncedQ, onChange]);

  // Sync local search when URL changes externally (back/forward)
  useEffect(() => {
    if (filters.q !== lastSentQ.current) {
      setLocalQ(filters.q);
      lastSentQ.current = filters.q;
    }
  }, [filters.q]);

  // Keyboard shortcut: `/` focuses search
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {/* Market scope: dropdown for super_admin, read-only pill for managers */}
      {isSuperAdmin ? (
        <MarketSelect
          markets={markets}
          value={filters.marketId}
          onChange={(id) => onChange({ marketId: id })}
          allLabel={t("filters.allMarkets")}
        />
      ) : (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid #E1E3E5",
            background: "#F6F6F7",
            color: "#6D7175",
            fontSize: 13,
            fontWeight: 500,
            whiteSpace: "nowrap",
          }}
        >
          {lockedMarketLabel}
        </span>
      )}

      {/* Search — grows to fill available space */}
      <div style={{ position: "relative", flex: "1 1 220px", minWidth: 160 }}>
        <span
          aria-hidden
          style={{
            position: "absolute",
            insetInlineStart: 10,
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: 13,
            color: "#9CA3AF",
            pointerEvents: "none",
          }}
        >
          ⌕
        </span>
        <input
          ref={searchRef}
          type="text"
          value={localQ}
          onChange={(e) => setLocalQ(e.target.value)}
          placeholder={t("filters.searchPlaceholder")}
          aria-label={t("filters.searchAria")}
          style={{
            height: 34,
            width: "100%",
            paddingInlineStart: 30,
            paddingInlineEnd: 10,
            fontSize: 13,
            border: "1px solid #E1E3E5",
            borderRadius: 6,
            background: "#FAFAFA",
            color: "#1A1A1A",
            outline: "none",
          }}
        />
      </div>

      {/* Date quick-select */}
      <DateQuickSelect
        from={filters.dateFrom}
        to={filters.dateTo}
        onChange={(dateFrom, dateTo) => onChange({ dateFrom, dateTo })}
        label={t("filters.date")}
      />

      {/* Advanced filters drawer trigger */}
      <button
        type="button"
        onClick={onOpenAdvanced}
        style={secondaryBtn}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#F7F7F7")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "#FFFFFF")}
      >
        {t("filters.advanced")}
      </button>

      {/* Right-aligned actions */}
      <div style={{ marginInlineStart: "auto", display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={onExport}
          style={secondaryBtn}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#F7F7F7")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "#FFFFFF")}
        >
          {t("exportCsv")}
        </button>
        <button type="button" onClick={onNewOrder} style={primaryBtn}>
          {t("create.newOrder")}
        </button>
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  height: 34,
  padding: "0 14px",
  fontSize: 13,
  fontWeight: 500,
  background: "#1A1A1A",
  color: "#FFFFFF",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  transition: "background-color 120ms ease",
};

const secondaryBtn: React.CSSProperties = {
  height: 34,
  padding: "0 12px",
  fontSize: 13,
  fontWeight: 500,
  background: "#FFFFFF",
  color: "#1A1A1A",
  border: "1px solid #E1E3E5",
  borderRadius: 6,
  cursor: "pointer",
  transition: "background-color 120ms ease",
};

// ---------- Sub-components ----------

function MarketSelect({
  markets,
  value,
  onChange,
  allLabel,
}: {
  markets: Market[];
  value: string | null;
  onChange: (id: string | null) => void;
  allLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const label = value ? markets.find((m) => m.id === value)?.name ?? "—" : allLabel;
  return (
    <div style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={secondaryBtn}>
        {label} ▾
      </button>
      {open ? (
        <DropdownPanel onClose={() => setOpen(false)}>
          <DropdownOption
            label={allLabel}
            selected={value === null}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          />
          {markets.map((m) => (
            <DropdownOption
              key={m.id}
              label={m.name}
              selected={value === m.id}
              onClick={() => {
                onChange(m.id);
                setOpen(false);
              }}
            />
          ))}
        </DropdownPanel>
      ) : null}
    </div>
  );
}

function DateQuickSelect({
  from,
  to,
  onChange,
  label,
}: {
  from: string | null;
  to: string | null;
  onChange: (from: string | null, to: string | null) => void;
  label: string;
}) {
  const t = useTranslations("orders.filters");
  const [open, setOpen] = useState(false);

  const today = () => new Date().toISOString().slice(0, 10);
  const daysAgo = (n: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };

  const summary = !from && !to ? label : `${from ?? "…"} → ${to ?? "…"}`;

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ ...secondaryBtn, ...(from || to ? { borderColor: "#1A1A1A" } : null) }}
      >
        {summary} ▾
      </button>
      {open ? (
        <DropdownPanel onClose={() => setOpen(false)} width={240}>
          <DropdownOption
            label={t("today")}
            selected={from === today() && to === today()}
            onClick={() => {
              onChange(today(), today());
              setOpen(false);
            }}
          />
          <DropdownOption
            label={t("last7d")}
            selected={from === daysAgo(7) && to === today()}
            onClick={() => {
              onChange(daysAgo(7), today());
              setOpen(false);
            }}
          />
          <DropdownOption
            label={t("last30d")}
            selected={from === daysAgo(30) && to === today()}
            onClick={() => {
              onChange(daysAgo(30), today());
              setOpen(false);
            }}
          />
          <div style={{ borderTop: "1px solid #E1E3E5", margin: "4px 0" }} />
          <div style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, color: "#6D7175" }}>{t("from")}</label>
            <input
              type="date"
              value={from ?? ""}
              onChange={(e) => onChange(e.target.value || null, to)}
              style={dateInput}
            />
            <label style={{ fontSize: 12, color: "#6D7175" }}>{t("to")}</label>
            <input
              type="date"
              value={to ?? ""}
              onChange={(e) => onChange(from, e.target.value || null)}
              style={dateInput}
            />
          </div>
          {from || to ? (
            <div style={{ padding: "4px 10px 8px" }}>
              <button
                type="button"
                onClick={() => {
                  onChange(null, null);
                  setOpen(false);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "#6D7175",
                  fontSize: 12,
                  cursor: "pointer",
                  padding: 0,
                  textDecoration: "underline",
                }}
              >
                {t("clear")}
              </button>
            </div>
          ) : null}
        </DropdownPanel>
      ) : null}
    </div>
  );
}

function DropdownPanel({
  children,
  onClose,
  width = 180,
}: {
  children: React.ReactNode;
  onClose: () => void;
  width?: number;
}) {
  return (
    <>
      {/* click-outside scrim */}
      <div
        aria-hidden
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 9 }}
      />
      <div
        role="listbox"
        style={{
          position: "absolute",
          insetInlineStart: 0,
          top: "calc(100% + 6px)",
          background: "#FFFFFF",
          border: "1px solid #E1E3E5",
          borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
          minWidth: width,
          maxHeight: 320,
          overflowY: "auto",
          zIndex: 10,
          padding: 4,
        }}
      >
        {children}
      </div>
    </>
  );
}

function DropdownOption({
  label,
  selected,
  onClick,
  multi = false,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  multi?: boolean;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        textAlign: "start",
        padding: "8px 10px",
        border: "none",
        borderRadius: 6,
        background: selected && !multi ? "#F2F2F2" : "transparent",
        color: "#1A1A1A",
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        if (!(selected && !multi)) e.currentTarget.style.background = "#F7F7F7";
      }}
      onMouseLeave={(e) => {
        if (!(selected && !multi)) e.currentTarget.style.background = "transparent";
      }}
    >
      {multi ? (
        <span
          aria-hidden
          style={{
            width: 14,
            height: 14,
            borderRadius: 3,
            border: "1px solid #C9CCCF",
            background: selected ? "#1A1A1A" : "#FFFFFF",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#FFFFFF",
            fontSize: 10,
            lineHeight: 1,
          }}
        >
          {selected ? "✓" : ""}
        </span>
      ) : null}
      <span style={{ flex: 1 }}>{label}</span>
    </button>
  );
}

const dateInput: React.CSSProperties = {
  height: 30,
  padding: "0 8px",
  fontSize: 13,
  border: "1px solid #E1E3E5",
  borderRadius: 6,
  background: "#FFFFFF",
  color: "#1A1A1A",
};
