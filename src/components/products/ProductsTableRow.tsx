"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Copy, MoreHorizontal, Pause, Pencil, Play, PlusCircle } from "lucide-react";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import { ProductAvatar } from "@/components/orders/ProductAvatar";
import { isLowStock } from "@/lib/product-calculations";
import { formatCurrency } from "@/lib/format";
import type { ProductListRow } from "@/types/product-list";
import { MarginBar } from "./MarginBar";
import type { ProductColumn } from "./ProductsTable";

interface Props {
  row: ProductListRow;
  columns: ProductColumn[];
  isSelected: boolean;
  isOpen: boolean;
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onThresholdSave: (id: string, value: number) => void;
  onToggleActive: (id: string) => void;
  onAdjustStock: (id: string, name: string) => void;
  canManage: boolean;
  canToggleActive: boolean;
  locale: string;
  currency: string;
}

type StockState = "out" | "low" | "ok";

function stockState(row: ProductListRow): StockState {
  if (row.current_stock <= 0) return "out";
  if (isLowStock(row.current_stock, row.low_stock_threshold)) return "low";
  return "ok";
}

/** A missing metric renders an em dash — never 0, and never the string "NaN". */
const DASH = <span className="font-medium text-line-strong">—</span>;

export function ProductsTableRow({
  row,
  columns,
  isSelected,
  isOpen,
  onToggleSelect,
  onOpen,
  onThresholdSave,
  onToggleActive,
  onAdjustStock,
  canManage,
  canToggleActive,
  locale,
  currency,
}: Props) {
  const t = useTranslations("products");
  const [threshold, setThreshold] = useState(String(row.low_stock_threshold));

  // Keep the input honest when the row is refetched (bulk threshold edit,
  // another tab, SWR revalidation) — otherwise a stale local value lingers.
  useEffect(() => {
    setThreshold(String(row.low_stock_threshold));
  }, [row.low_stock_threshold]);

  const market = currency.toUpperCase() === "LYD" ? "LY" : "TN";
  const money = (n: number) => formatCurrency(n, market);
  const pct = (n: number) =>
    `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n)}%`;
  const num = (n: number) => new Intl.NumberFormat(locale).format(n);

  const m = row.metrics;
  const hasActivity = m !== null && m.total_leads > 0;
  const st = stockState(row);

  const menuItems: MenuItem[] = [
    {
      id: "edit",
      label: t("row.edit"),
      icon: Pencil,
      onSelect: () => {
        window.location.href = `/${locale}/products/${row.id}/edit`;
      },
    },
  ];
  if (canManage) {
    menuItems.push({
      id: "stock",
      label: t("row.adjustStock"),
      icon: PlusCircle,
      onSelect: () => onAdjustStock(row.id, row.name),
    });
    menuItems.push({
      id: "duplicate",
      label: t("row.duplicate"),
      icon: Copy,
      // Cloning across markets needs a new API route and a market picker; the
      // affordance is disabled rather than absent so the gap is visible.
      disabled: true,
      onSelect: () => {},
    });
  }
  if (canToggleActive) {
    menuItems.push({
      id: "toggle",
      label: row.is_active ? t("deactivate") : t("activate"),
      icon: row.is_active ? Pause : Play,
      destructive: row.is_active,
      onSelect: () => onToggleActive(row.id),
    });
  }

  function cell(col: ProductColumn): React.ReactNode {
    switch (col.key) {
      case "name": {
        const badges: React.ReactNode[] = [];
        if (row.sku) {
          badges.push(
            <span key="sku" className="flex-none text-[12.5px] font-normal text-ink-muted">
              {row.sku}
            </span>,
          );
        }
        if (row.variant_count > 0) {
          badges.push(
            <span
              key="var"
              className="inline-flex h-[22px] flex-none items-center rounded-[7px] bg-surface-sunken px-2.5 text-[12px] font-medium text-ink-secondary"
            >
              {t("row.variants", { count: row.variant_count })}
            </span>,
          );
        }
        if (st === "out") {
          badges.push(
            <span
              key="out"
              className="inline-flex h-[22px] flex-none items-center rounded-[7px] bg-status-criticalBg px-2.5 text-[12px] font-semibold text-status-critical"
            >
              {t("facets.outOfStock")}
            </span>,
          );
        } else if (st === "low") {
          badges.push(
            <span
              key="low"
              className="inline-flex h-[22px] flex-none items-center rounded-[7px] bg-status-warningBg px-2.5 text-[12px] font-semibold text-status-warning"
            >
              {t("facets.lowStock")}
            </span>,
          );
        }
        if (!row.is_active) {
          badges.push(
            <span
              key="off"
              className="inline-flex h-[22px] flex-none items-center rounded-[7px] bg-prod-neutral-bg px-2.5 text-[12px] font-semibold text-ink-secondary"
            >
              {t("inactive")}
            </span>,
          );
        }
        return (
          <div className="flex min-w-0 items-center gap-3.5">
            <ProductAvatar imageUrl={row.image_url} productName={row.name} size={42} />
            <span className="flex min-w-0 flex-col gap-1">
              {/* dir="auto" on the NAME NODE, never on a container: the chrome
                  stays LTR while an Arabic name resolves its own direction. A
                  container-level dir would flip the badge order too. */}
              <Link
                href={`/${locale}/products/${row.id}`}
                dir="auto"
                onClick={(e) => e.stopPropagation()}
                className="block truncate text-[14px] font-semibold tracking-[-0.006em] text-ink-primary no-underline hover:underline hover:underline-offset-2"
              >
                {row.name}
              </Link>
              {badges.length > 0 && (
                <span className="flex items-center gap-2 overflow-hidden whitespace-nowrap">
                  {badges}
                </span>
              )}
            </span>
          </div>
        );
      }

      case "stock":
        return (
          <span className="flex flex-col items-end gap-0.5 tabular-nums">
            <span
              className={`text-[15px] font-semibold leading-tight tracking-[-0.018em] ${
                st === "out"
                  ? "text-status-critical"
                  : st === "low"
                    ? "text-status-warning"
                    : "text-ink-primary"
              }`}
            >
              {num(row.current_stock)}
            </span>
            <span className="flex items-center gap-px text-[12.5px] text-ink-muted">
              /{" "}
              {canManage ? (
                <input
                  type="number"
                  min={0}
                  value={threshold}
                  aria-label={t("row.editThreshold")}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setThreshold(e.target.value)}
                  onBlur={() => {
                    const v = parseInt(threshold, 10);
                    if (!Number.isNaN(v) && v >= 0 && v !== row.low_stock_threshold) {
                      onThresholdSave(row.id, v);
                    } else if (Number.isNaN(v)) {
                      setThreshold(String(row.low_stock_threshold));
                    }
                  }}
                  className="w-9 rounded-[5px] border border-transparent bg-transparent px-1 text-end text-[12.5px] tabular-nums text-ink-secondary outline-none transition-colors duration-fast hover:border-line hover:bg-surface-card focus:border-prod-pos focus:bg-surface-card"
                />
              ) : (
                <span>{num(row.low_stock_threshold)}</span>
              )}
            </span>
          </span>
        );

      case "sku":
        return row.sku ? (
          <span className="text-[12.5px] text-ink-secondary">{row.sku}</span>
        ) : (
          DASH
        );

      case "unit_cogs":
        return <Money value={row.unit_cogs} fmt={money} />;
      case "packing_cost":
        return <Money value={row.packing_cost} fmt={money} />;
      case "default_price":
        return row.default_price === null ? DASH : <Money value={row.default_price} fmt={money} />;
      case "stock_value":
        return <Money value={row.current_stock * row.unit_cogs} fmt={money} />;

      case "revenue":
        return hasActivity ? <Money value={m!.revenue} fmt={money} /> : DASH;

      case "net_profit":
        return hasActivity ? <Money value={m!.net_profit} fmt={money} signed /> : DASH;

      case "margin_pct":
        return hasActivity ? <MarginBar marginPct={m!.margin_pct} format={pct} /> : DASH;

      case "confirmation_rate":
        return hasActivity ? <Rate value={m!.confirmation_rate} fmt={pct} /> : DASH;
      case "delivery_rate":
        return hasActivity ? <Rate value={m!.delivery_rate} fmt={pct} /> : DASH;
      case "return_rate":
        // The only rate with inverted thresholds — high is bad.
        return hasActivity ? (
          <Rate
            value={m!.return_rate}
            fmt={pct}
            tone={m!.return_rate >= 20 ? "bad" : m!.return_rate >= 13 ? "warn" : "good"}
          />
        ) : (
          DASH
        );

      case "total_leads":
        return hasActivity ? (
          <span className="text-[14px] tabular-nums text-ink-primary">{num(m!.total_leads)}</span>
        ) : (
          DASH
        );

      case "ad_spend":
        return m && m.ad_spend > 0 ? <Money value={m.ad_spend} fmt={money} /> : DASH;

      case "cost_per_delivered":
        return m && m.delivered_count > 0 ? (
          <Money value={m.cost_per_delivered} fmt={money} />
        ) : (
          DASH
        );

      case "damaged":
        return row.damaged_return_count > 0 ? (
          <span className="text-[14px] font-semibold tabular-nums text-status-warning">
            {num(row.damaged_return_count)}
          </span>
        ) : (
          DASH
        );

      case "is_active":
        return (
          <span
            className={`inline-flex h-[30px] items-center justify-center rounded-[9px] px-4 text-[13px] font-medium ${
              row.is_active
                ? "bg-prod-brand-soft text-prod-brand"
                : "bg-prod-neutral-bg text-ink-secondary"
            }`}
          >
            {row.is_active ? t("activeLabel") : t("inactive")}
          </span>
        );

      default:
        return null;
    }
  }

  return (
    <tr
      onClick={() => onOpen(row.id)}
      className={`cursor-pointer border-b border-line-subtle transition-colors duration-fast last:border-b-0 ${
        isSelected || isOpen ? "bg-prod-brand-tint" : "hover:bg-surface-hover"
      }`}
    >
      <td className="h-[70px] p-0 text-center align-middle">
        <input
          type="checkbox"
          checked={isSelected}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleSelect(row.id)}
          aria-label={t("table.selectRow", { name: row.name })}
          className="h-[17px] w-[17px] cursor-pointer accent-prod-brand"
        />
      </td>
      {columns.map((col) => (
        <td
          key={col.key}
          className={`h-[70px] px-[18px] align-middle text-[14px] ${
            col.align === "end"
              ? "text-end tabular-nums"
              : col.align === "center"
                ? "text-center tabular-nums"
                : ""
          }`}
        >
          {cell(col)}
        </td>
      ))}
      <td className="h-[70px] p-0 text-center align-middle">
        <span
          className="inline-grid place-items-center"
          onClick={(e) => e.stopPropagation()}
          role="presentation"
        >
          <Menu
            ariaLabel={t("table.actions")}
            items={menuItems}
            trigger={
              <button
                type="button"
                aria-label={t("table.actions")}
                className="grid h-8 w-8 place-items-center rounded-[9px] text-ink-muted transition-colors duration-fast hover:bg-surface-sunken hover:text-ink-primary"
              >
                <MoreHorizontal size={17} strokeWidth={2} />
              </button>
            }
          />
        </span>
      </td>
    </tr>
  );
}

function Money({
  value,
  fmt,
  signed,
}: {
  value: number;
  fmt: (n: number) => string;
  signed?: boolean;
}) {
  const cls = signed
    ? value > 0
      ? "text-prod-pos font-semibold"
      : value < 0
        ? "text-status-critical font-semibold"
        : "text-ink-primary"
    : "text-ink-primary";
  return (
    <span className={`whitespace-nowrap text-[14px] tabular-nums ${cls}`}>
      {signed && value > 0 ? "+" : ""}
      {fmt(value)}
    </span>
  );
}

function Rate({
  value,
  fmt,
  tone,
}: {
  value: number;
  fmt: (n: number) => string;
  tone?: "good" | "warn" | "bad";
}) {
  const cls =
    tone === "bad"
      ? "text-status-critical font-semibold"
      : tone === "warn"
        ? "text-status-warning font-semibold"
        : tone === "good"
          ? "text-prod-pos font-semibold"
          : "text-ink-primary";
  return <span className={`text-[14px] tabular-nums ${cls}`}>{fmt(value)}</span>;
}
