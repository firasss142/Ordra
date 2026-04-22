"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { LowStockProduct } from "@/lib/warehouse/summary";

interface LowStockBannerProps {
  items: LowStockProduct[];
  labels: {
    title: string;
    badge: string;
    critical: string;
    more: string; // "+{count} autres"
    tooltip: string; // "Stock : {current} / seuil {threshold}"
  };
  locale: string;
}

const VISIBLE_LIMIT = 5;

function formatLabel(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

export function LowStockBanner({ items, labels, locale }: LowStockBannerProps) {
  if (items.length === 0) return null;

  const visible = items.slice(0, VISIBLE_LIMIT);
  const overflow = items.length - visible.length;

  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
      role="region"
      aria-label={labels.title}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle
            size={16}
            strokeWidth={1.75}
            color="#B98900"
            aria-hidden="true"
          />
          <h2
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
              color: "#1A1A1A",
            }}
          >
            {labels.title}
          </h2>
        </div>
        {overflow > 0 ? (
          <Link
            href={`/${locale}/products?low_stock=1`}
            style={{
              fontSize: 13,
              color: "#2C6ECB",
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            {formatLabel(labels.more, { count: overflow })}
          </Link>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {visible.map((p) => {
          const isOut = p.current_stock <= 0;
          const ratio =
            p.low_stock_threshold > 0
              ? Math.min(1, Math.max(0, p.current_stock / p.low_stock_threshold))
              : 0;
          const fillColor = isOut ? "#D72C0D" : "#B98900";
          const badgeLabel = isOut ? labels.critical : labels.badge;
          return (
            <div
              key={p.id}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1.4fr) minmax(80px, 1fr) 120px",
                alignItems: "center",
                gap: 12,
                padding: "8px 10px",
                borderRadius: 6,
                background: "#F7F7F7",
              }}
              title={formatLabel(labels.tooltip, {
                current: p.current_stock,
                threshold: p.low_stock_threshold,
              })}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "#1A1A1A",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {p.name}
              </div>
              <div
                style={{
                  height: 6,
                  background: "#E1E3E5",
                  borderRadius: 9999,
                  overflow: "hidden",
                }}
                aria-hidden="true"
              >
                <div
                  style={{
                    width: `${ratio * 100}%`,
                    height: "100%",
                    background: fillColor,
                    transition: "width 200ms ease",
                  }}
                />
              </div>
              <div
                style={{
                  textAlign: "end",
                  fontSize: 12,
                  fontWeight: 500,
                  fontVariantNumeric: "tabular-nums",
                  color: fillColor,
                }}
              >
                {p.current_stock} / {p.low_stock_threshold}
                <span
                  style={{
                    marginInlineStart: 6,
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: fillColor,
                  }}
                >
                  · {badgeLabel}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
