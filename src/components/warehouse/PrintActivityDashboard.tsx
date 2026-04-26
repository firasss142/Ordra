"use client";

import { useMemo } from "react";
import { X, Printer } from "lucide-react";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";

const D = {
  cardBg: "#FFFFFF",
  sectionBg: "#F6F6F7",
  border: "#E1E3E5",
  textPrimary: "#1A1A1A",
  textSecondary: "#6D7175",
  accent: "#008060",
  warning: "#B98900",
  cardShadow:
    "0 0 0 1px #E1E3E5, 0 4px 12px rgba(0,0,0,0.1), 0 16px 40px rgba(0,0,0,0.08)",
};

export interface PrintSession {
  order_ids: string[];
  printed_at: number;
  order_map: Map<
    string,
    { customer_name: string; customer_city: string | null; product_name: string }
  >;
}

interface Props {
  session: PrintSession;
  liveOrders: WarehouseOrderRow[];
  onDismiss: () => void;
  locale: string;
}

function fmtTime(ts: number, locale: string) {
  return new Date(ts).toLocaleTimeString(locale === "ar" ? "ar" : locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PrintActivityDashboard({
  session,
  liveOrders,
  onDismiss,
  locale,
}: Props) {
  const { scannedIds, scannedCount, totalCount } = useMemo(() => {
    const liveIds = new Set(liveOrders.map((o) => o.id));
    const scanned = new Set(session.order_ids.filter((id) => !liveIds.has(id)));
    return {
      scannedIds: scanned,
      scannedCount: scanned.size,
      totalCount: session.order_ids.length,
    };
  }, [liveOrders, session.order_ids]);

  const progressPct =
    totalCount === 0 ? 100 : Math.round((scannedCount / totalCount) * 100);
  const allDone = scannedCount === totalCount;

  return (
    <div
      role="region"
      aria-label="Session d'impression"
      style={{
        position: "fixed",
        bottom: 24,
        insetInlineEnd: 24,
        width: "min(420px, calc(100vw - 24px))",
        zIndex: 50,
        backgroundColor: D.cardBg,
        border: `1px solid ${D.border}`,
        borderRadius: 12,
        boxShadow: D.cardShadow,
        overflow: "hidden",
        fontFamily: "inherit",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          borderBottom: `1px solid ${D.border}`,
          backgroundColor: D.sectionBg,
        }}
      >
        <Printer size={16} strokeWidth={1.75} color={D.textSecondary} aria-hidden />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: D.textPrimary }}>
            Session d&apos;impression
          </div>
          <div
            style={{
              fontSize: 11,
              color: D.textSecondary,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {fmtTime(session.printed_at, locale)} · {totalCount} étiquette
            {totalCount !== 1 ? "s" : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Fermer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 9999,
            border: `1px solid ${D.border}`,
            backgroundColor: "transparent",
            color: D.textSecondary,
            cursor: "pointer",
            fontFamily: "inherit",
            flexShrink: 0,
          }}
        >
          <X size={14} strokeWidth={2} aria-hidden />
        </button>
      </div>

      {/* Progress */}
      <div style={{ padding: "10px 16px 0" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <span style={{ fontSize: 12, color: D.textSecondary }}>
            <span
              style={{
                color: allDone ? D.accent : D.textPrimary,
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {scannedCount}
            </span>
            <span style={{ color: D.textSecondary }}>
              {" "}/ {totalCount} scannée{totalCount !== 1 ? "s" : ""}
            </span>
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: allDone ? D.accent : D.textSecondary,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {progressPct}%
          </span>
        </div>
        {/* Progress bar */}
        <div
          style={{
            height: 4,
            backgroundColor: D.border,
            borderRadius: 2,
            overflow: "hidden",
            marginBottom: 10,
          }}
        >
          <div
            style={{
              height: "100%",
              backgroundColor: allDone ? D.accent : D.warning,
              borderRadius: 2,
              width: `${progressPct}%`,
              transition: "width 400ms ease, background-color 300ms ease",
            }}
          />
        </div>
      </div>

      {/* Order rows */}
      <div
        style={{
          maxHeight: 300,
          overflowY: "auto",
          borderTop: `1px solid ${D.border}`,
        }}
      >
        {session.order_ids.map((id) => {
          const info = session.order_map.get(id);
          const isScanned = scannedIds.has(id);
          return (
            <div
              key={id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 16px",
                borderBottom: `1px solid ${D.border}`,
                fontSize: 12,
                minHeight: 40,
                backgroundColor: isScanned ? "#F1F8F5" : "transparent",
                transition: "background-color 400ms ease",
              }}
            >
              {/* Status indicator */}
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 9999,
                  flexShrink: 0,
                  backgroundColor: isScanned ? D.accent : D.warning,
                  boxShadow: "none",
                  transition: "background-color 400ms ease, box-shadow 400ms ease",
                }}
                aria-hidden
              />

              {/* Order ID */}
              <code
                style={{
                  fontSize: 11,
                  color: D.textSecondary,
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  flexShrink: 0,
                  minWidth: 72,
                }}
              >
                #{id.slice(0, 8)}
              </code>

              {/* Customer + city */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    color: D.textPrimary,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontWeight: 500,
                  }}
                >
                  {info?.customer_name ?? "—"}
                </div>
                {info?.customer_city && (
                  <div
                    style={{
                      color: D.textSecondary,
                      fontSize: 11,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {info.customer_city}
                  </div>
                )}
              </div>

              {/* Status pill */}
              <span
                style={{
                  flexShrink: 0,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  padding: "3px 8px",
                  borderRadius: 9999,
                  color: isScanned ? D.accent : D.warning,
                  backgroundColor: isScanned ? "#F1F8F5" : "#FFF8E6",
                  border: `1px solid ${isScanned ? "#A7F3D0" : "#FFD585"}`,
                  transition: "all 300ms ease",
                }}
              >
                {isScanned ? "Scanné" : "Imprimé"}
              </span>
            </div>
          );
        })}
      </div>

      {/* Done state footer */}
      {allDone && (
        <div
          style={{
            padding: "10px 16px",
            backgroundColor: "#F1F8F5",
            borderTop: `1px solid #A7F3D0`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 12, color: D.accent, fontWeight: 600 }}>
            ✓ Toutes les commandes scannées
          </span>
          <button
            type="button"
            onClick={onDismiss}
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: D.accent,
              border: `1px solid #A7F3D0`,
              backgroundColor: "transparent",
              borderRadius: 9999,
              padding: "4px 12px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Fermer
          </button>
        </div>
      )}
    </div>
  );
}
