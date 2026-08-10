"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  Plus,
  Globe,
  ChevronDown,
  Search,
  Calendar,
  SlidersHorizontal,
  Download,
} from "lucide-react";
import type { OrderListFilters } from "@/lib/orders/list-filters";
import { useDebounce } from "@/hooks/useDebounce";

interface Props {
  filters: OrderListFilters;
  onChange: (patch: Partial<OrderListFilters>) => void;
  onOpenAdvanced: () => void;
  onNewOrder: () => void;
  onExport: () => void;
  marketLabel: string;
}

const CARD_BG = "var(--oms-surface)";
const SOFT_BG = "var(--oms-surface)";
const BORDER = "var(--oms-border)";
const SUBTLE_BG = "#F6F6F7";
const TEXT = "var(--oms-ink-1)";
const MUTED = "var(--oms-ink-3)";

export function OrdersFilterBar({
  filters,
  onChange,
  onOpenAdvanced,
  onNewOrder,
  onExport,
  marketLabel,
}: Props) {
  const t = useTranslations("orders");
  const isMobile = useIsMobile();

  const [localQ, setLocalQ] = useState(filters.q);
  const debouncedQ = useDebounce(localQ, 250);
  const lastSentQ = useRef(filters.q);

  useEffect(() => {
    if (debouncedQ === lastSentQ.current) return;
    lastSentQ.current = debouncedQ;
    onChange({ q: debouncedQ });
  }, [debouncedQ, onChange]);

  useEffect(() => {
    if (filters.q !== lastSentQ.current) {
      setLocalQ(filters.q);
      lastSentQ.current = filters.q;
    }
  }, [filters.q]);

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

  const dateActive = !!(filters.dateFrom || filters.dateTo);

  /** How many of the panel-only filters are set — the bar could not previously
   *  tell you anything was applied without opening the panel to look. */
  const advancedCount = [
    filters.city !== "",
    filters.productId !== null,
    filters.carrierId !== null,
    filters.rejectionReason !== null,
    filters.totalMin !== null || filters.totalMax !== null,
  ].filter(Boolean).length;

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      {/* Top row: market + search + actions */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {/* Row 1: market chip + search */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* Search — grows to fill available space */}
          <div style={{ position: "relative", flex: 1, minWidth: 100 }}>
            <Search
              size={13}
              strokeWidth={1.75}
              aria-hidden
              style={{
                position: "absolute",
                insetInlineStart: 10,
                top: "50%",
                transform: "translateY(-50%)",
                color: MUTED,
                pointerEvents: "none",
              }}
            />
            <input
              ref={searchRef}
              type="text"
              value={localQ}
              onChange={(e) => setLocalQ(e.target.value)}
              placeholder={t("filters.searchPlaceholder")}
              aria-label={t("filters.searchAria")}
              style={{
                height: 38,
                width: "100%",
                paddingInlineStart: 30,
                paddingInlineEnd: 10,
                fontSize: 13,
                border: `1px solid ${BORDER}`,
                borderRadius: 8,
                background: SOFT_BG,
                color: TEXT,
                outline: "none",
                fontFamily: "inherit",
              }}
            />
            {!isMobile && (
              <kbd
                aria-hidden
                style={{
                  position: "absolute",
                  insetInlineEnd: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontFamily: "inherit",
                  fontSize: 10.5,
                  color: "var(--oms-ink-3)",
                  border: "1px solid var(--oms-border)",
                  borderRadius: 4,
                  padding: "1px 4px",
                  background: "var(--oms-surface-sunken)",
                }}
              >
                /
              </kbd>
            )}
          </div>
        </div>

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

function DateChip({
  from,
  to,
  onChange,
  label,
  active,
}: {
  from: string | null;
  to: string | null;
  onChange: (from: string | null, to: string | null) => void;
  label: string;
  active: boolean;
}) {
  const t = useTranslations("orders.filters");
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

  const today = () => new Date().toISOString().slice(0, 10);
  const daysAgo = (n: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };

  const summary = active ? `${from ?? "…"} → ${to ?? "…"}` : null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div
        style={{
          display: "inline-flex",
          alignItems: "stretch",
          height: 28,
          borderRadius: 6,
          border: `1px solid ${active ? TEXT : BORDER}`,
          background: active ? TEXT : SOFT_BG,
          color: active ? "#FFFFFF" : TEXT,
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
          <Calendar size={13} strokeWidth={1.75} />
          <span style={{ opacity: active ? 0.8 : 1 }}>{label}</span>
          {summary ? (
            <>
              <span aria-hidden style={{ opacity: 0.5 }}>·</span>
              <span style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {summary}
              </span>
            </>
          ) : (
            <ChevronDown size={11} strokeWidth={2} />
          )}
        </button>
        {active && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null, null);
            }}
            aria-label={t("clear")}
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
          <div style={{ borderTop: `1px solid ${BORDER}`, margin: "4px 0" }} />
          <div style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, color: MUTED }}>{t("from")}</label>
            <input
              type="date"
              value={from ?? ""}
              onChange={(e) => onChange(e.target.value || null, to)}
              style={dateInput}
            />
            <label style={{ fontSize: 12, color: MUTED }}>{t("to")}</label>
            <input
              type="date"
              value={to ?? ""}
              onChange={(e) => onChange(from, e.target.value || null)}
              style={dateInput}
            />
          </div>
        </DropdownPanel>
      ) : null}
    </div>
  );
}

function DropdownPanel({
  children,
  onClose,
  width = 200,
}: {
  children: React.ReactNode;
  onClose: () => void;
  width?: number;
}) {
  return (
    <>
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
          top: "calc(100% + 4px)",
          background: CARD_BG,
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
          minWidth: width,
          maxHeight: 320,
          overflowY: "auto",
          zIndex: 30,
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

const dateInput: React.CSSProperties = {
  height: 30,
  padding: "0 8px",
  fontSize: 13,
  border: `1px solid ${BORDER}`,
  borderRadius: 6,
  background: SOFT_BG,
  color: TEXT,
  outline: "none",
};
