"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  PackageX,
  Archive,
  Flame,
  ShieldAlert,
  ArrowRight,
  Pencil,
  X,
} from "lucide-react";
import { Panel, EmptyState } from "@/components/dashboard/Panel";
import { useInventorySummary } from "@/hooks/useInventorySummary";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import type { AuthUser } from "@/types";
import type { InventorySummary } from "@/app/api/inventory/summary/route";
import { LOW_DAYS_OF_SUPPLY, type HealthClass } from "@/lib/calculations/inventory-intelligence";

type Product = InventorySummary["products"][number];
type Movement = InventorySummary["recent_movements"][number];
type Reorder = InventorySummary["reorder_suggestions"][number];
type DayBucket = InventorySummary["movements_by_day"][number];
type I18n = ReturnType<typeof useTranslations<"inventory">>;

export function InventoryClient({ user }: { user: AuthUser }) {
  const t = useTranslations("inventory");
  const { inventory, isLoading, error, mutate } = useInventorySummary({
    marketId: user.role === "super_admin" ? undefined : user.market_id ?? undefined,
  });

  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);
  const totals = inventory?.totals;
  const canAdjust = user.role === "super_admin";
  const market = user.locale === "ar" ? "LY" : "TN";

  return (
    <div style={{ backgroundColor: "#F6F6F7", minHeight: "100vh" }} className="px-4 py-6 pb-16 sm:px-6 md:px-8">
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: "#1A1A1A", margin: 0 }}>
          {t("title")}
        </h1>
        <p style={{ fontSize: 13, color: "#6D7175", margin: "4px 0 0" }}>{t("subtitle")}</p>
      </header>

      {error && (
        <div
          role="alert"
          style={{
            padding: "12px 14px",
            backgroundColor: "#FFF4F4",
            color: "#D72C0D",
            borderRadius: 6,
            fontSize: 13,
            marginBlockEnd: 16,
          }}
        >
          {t("loadError")}
        </div>
      )}

      <HeroStrip totals={totals} loading={isLoading} market={market} t={t} />

      <div className="grid grid-cols-1 gap-4 mt-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title={t("reorder.title")} minHeight={240}>
          {!inventory && isLoading ? (
            <EmptyState label={t("loading")} />
          ) : !inventory?.reorder_suggestions.length ? (
            <EmptyState label={t("reorder.empty")} />
          ) : (
            <ReorderList rows={inventory.reorder_suggestions} locale={user.locale} t={t} />
          )}
        </Panel>

        <Panel title={t("movementsTimeline.title")} minHeight={240}>
          {!inventory && isLoading ? (
            <EmptyState label={t("loading")} />
          ) : !inventory?.movements_by_day.length ? (
            <EmptyState label={t("movementsTimeline.empty")} />
          ) : (
            <MovementsDailyList rows={inventory.movements_by_day} locale={user.locale} t={t} />
          )}
        </Panel>
      </div>

      <div style={{ marginBlockStart: 16 }}>
        <Panel title={t("products.title")} minHeight={320}>
          {!inventory && isLoading ? (
            <EmptyState label={t("loading")} />
          ) : !inventory || inventory.products.length === 0 ? (
            <EmptyState label={t("products.empty")} />
          ) : (
            <ProductsTable
              rows={inventory.products}
              locale={user.locale}
              market={market}
              canAdjust={canAdjust}
              onAdjust={setAdjustTarget}
              t={t}
            />
          )}
        </Panel>
      </div>

      <div style={{ marginBlockStart: 16 }}>
        <Panel title={t("movements.title")} minHeight={280}>
          {!inventory && isLoading ? (
            <EmptyState label={t("loading")} />
          ) : !inventory || inventory.recent_movements.length === 0 ? (
            <EmptyState label={t("movements.empty")} />
          ) : (
            <MovementsList rows={inventory.recent_movements} locale={user.locale} t={t} />
          )}
        </Panel>
      </div>

      {adjustTarget && (
        <AdjustStockModal
          product={adjustTarget}
          onClose={() => setAdjustTarget(null)}
          onSaved={() => {
            setAdjustTarget(null);
            mutate();
          }}
          t={t}
        />
      )}
    </div>
  );
}

function HeroStrip({
  totals,
  loading,
  market,
  t,
}: {
  totals: InventorySummary["totals"] | undefined;
  loading: boolean;
  market: string;
  t: I18n;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,2.6fr)]">
      <StockValueCard totals={totals} loading={loading} market={market} t={t} />
      <HealthBreakdown totals={totals} t={t} />
    </div>
  );
}

function StockValueCard({
  totals,
  loading,
  market,
  t,
}: {
  totals: InventorySummary["totals"] | undefined;
  loading: boolean;
  market: string;
  t: I18n;
}) {
  return (
    <div
      style={{
        background: "#1A1A1A",
        color: "#FFFFFF",
        borderRadius: 8,
        padding: "20px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minHeight: 132,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "#8C9196",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {t("totals.stockValue")}
      </div>
      <div
        style={{
          fontSize: 32,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.1,
        }}
      >
        {totals ? formatCurrency(totals.stock_value, market) : loading ? "—" : "—"}
      </div>
      <div style={{ fontSize: 13, color: "#E3E5E7" }}>
        {totals ? t("totals.productsTracked", { count: totals.products_tracked }) : ""}
      </div>
      {totals && totals.scan_out_qty_30d > 0 && (
        <div style={{ fontSize: 12, color: "#8C9196", marginBlockStart: "auto" }}>
          {t("totals.scannedOut30d", { count: totals.scan_out_qty_30d })}
        </div>
      )}
    </div>
  );
}

function HealthBreakdown({
  totals,
  t,
}: {
  totals: InventorySummary["totals"] | undefined;
  t: I18n;
}) {
  const items: Array<{ icon: typeof CheckCircle2; key: string; value: number; tone: HealthClass | "reorder" }> = [
    { icon: CheckCircle2, key: "healthy", value: totals?.healthy_count ?? 0, tone: "healthy" },
    { icon: Flame, key: "reorder", value: totals?.reorder_count ?? 0, tone: "reorder" },
    { icon: AlertTriangle, key: "low", value: totals?.low_stock_count ?? 0, tone: "low" },
    { icon: PackageX, key: "out", value: totals?.out_of_stock_count ?? 0, tone: "out" },
    { icon: Archive, key: "overstocked", value: totals?.overstocked_count ?? 0, tone: "overstocked" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {items.map(({ icon: Icon, key, value, tone }) => {
        const palette = HEALTH_PALETTE[tone];
        return (
          <div
            key={key}
            style={{
              background: "#FFFFFF",
              border: "1px solid #E1E3E5",
              borderRadius: 8,
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              minHeight: 132,
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                fontWeight: 500,
                color: "#6D7175",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              <Icon size={14} strokeWidth={2} color={palette.fg} aria-hidden="true" />
              {t(`healthBreakdown.${key}`)}
            </div>
            <div
              style={{
                fontSize: 26,
                fontWeight: 700,
                color: "#1A1A1A",
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1.1,
              }}
            >
              {value}
            </div>
            <div style={{ fontSize: 12, color: "#6D7175", marginBlockStart: "auto" }}>
              {t(`healthBreakdown.${key}_hint`)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReorderList({
  rows,
  locale,
  t,
}: {
  rows: Reorder[];
  locale: string;
  t: I18n;
}) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((r) => {
        const urgency = r.days_of_supply <= 3 ? "critical" : r.days_of_supply <= 7 ? "warning" : "neutral";
        const bg =
          urgency === "critical" ? "#FFF4F4" : urgency === "warning" ? "#FFF8E6" : "#FFFFFF";
        const fg =
          urgency === "critical" ? "#D72C0D" : urgency === "warning" ? "#B98900" : "#1A1A1A";
        return (
          <li key={r.id}>
            <Link
              href={`/${locale}/products/${r.id}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                background: bg,
                border: "1px solid #E1E3E5",
                borderRadius: 6,
                textDecoration: "none",
                color: "#1A1A1A",
              }}
            >
              <AlertOctagon size={16} strokeWidth={2} color={fg} aria-hidden="true" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {r.name}
                </div>
                <div style={{ fontSize: 12, color: "#6D7175" }}>
                  {t("reorder.stockOut", {
                    days: r.days_of_supply,
                    rate: formatRate(r.avg_daily_sales),
                  })}
                </div>
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: fg,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {t("reorder.daysShort", { days: r.days_of_supply })}
              </div>
              <ArrowRight size={14} strokeWidth={2} color="#6D7175" aria-hidden="true" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function MovementsDailyList({ rows, locale, t }: { rows: DayBucket[]; locale: string; t: I18n }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.net_change)));
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
      {rows.map((r) => {
        const widthPct = Math.max(4, Math.round((Math.abs(r.net_change) / max) * 100));
        const positive = r.net_change >= 0;
        const barColor = positive ? "#008060" : "#D72C0D";
        return (
          <li
            key={r.day}
            className="grid items-center gap-2 px-1 py-1.5 text-[13px]"
            style={{ gridTemplateColumns: "minmax(64px,90px) 1fr minmax(40px,56px) minmax(32px,48px)" }}
          >
            <div style={{ color: "#6D7175", fontVariantNumeric: "tabular-nums" }}>
              {formatDate(r.day, locale)}
            </div>
            <div
              style={{
                height: 8,
                background: "#F1F2F4",
                borderRadius: 4,
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${widthPct}%`,
                  background: barColor,
                  borderRadius: 4,
                }}
              />
            </div>
            <div
              style={{
                fontWeight: 600,
                color: positive ? "#008060" : "#D72C0D",
                fontVariantNumeric: "tabular-nums",
                textAlign: "end",
              }}
            >
              {positive ? "+" : ""}
              {r.net_change}
            </div>
            <div style={{ color: "#6D7175", fontSize: 12, textAlign: "end" }}>
              {t("movementsTimeline.countShort", { count: r.movement_count })}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ProductsTable({
  rows,
  locale,
  market,
  canAdjust,
  onAdjust,
  t,
}: {
  rows: Product[];
  locale: string;
  market: string;
  canAdjust: boolean;
  onAdjust: (p: Product) => void;
  t: I18n;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ color: "#6D7175" }}>
            <th style={thStyle}>{t("products.cols.name")}</th>
            <th style={thStyle}>{t("products.cols.health")}</th>
            <th style={{ ...thStyle, textAlign: "end" }}>{t("products.cols.stock")}</th>
            <th style={{ ...thStyle, textAlign: "end" }}>{t("products.cols.daysOfSupply")}</th>
            <th style={{ ...thStyle, textAlign: "end" }}>{t("products.cols.turnover")}</th>
            <th style={{ ...thStyle, textAlign: "end" }}>{t("products.cols.value")}</th>
            <th style={{ ...thStyle, textAlign: "end" }}>{t("products.cols.damaged")}</th>
            {canAdjust && <th style={thStyle} aria-label="actions" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} style={{ borderBlockStart: "1px solid #F1F2F4" }}>
              <td style={tdStyle}>
                <Link
                  href={`/${locale}/products/${p.id}`}
                  style={{ color: "#1A1A1A", textDecoration: "none", fontWeight: 500 }}
                >
                  {p.name}
                </Link>
              </td>
              <td style={tdStyle}>
                <HealthPill health={p.health} t={t} />
              </td>
              <td style={{ ...tdStyle, textAlign: "end", fontVariantNumeric: "tabular-nums" }}>
                {p.current_stock}
                <span style={{ color: "#6D7175", marginInlineStart: 4 }}>
                  {t("products.thresholdShort", { threshold: p.low_stock_threshold })}
                </span>
              </td>
              <td style={{ ...tdStyle, textAlign: "end", fontVariantNumeric: "tabular-nums" }}>
                {p.days_of_supply === null ? (
                  <span style={{ color: "#6D7175" }}>—</span>
                ) : (
                  <span style={{ color: p.days_of_supply < LOW_DAYS_OF_SUPPLY ? "#D72C0D" : "#1A1A1A", fontWeight: 500 }}>
                    {t("products.daysShort", { days: p.days_of_supply })}
                  </span>
                )}
              </td>
              <td style={{ ...tdStyle, textAlign: "end", fontVariantNumeric: "tabular-nums" }}>
                {p.turnover_30d > 0 ? (
                  <span>{p.turnover_30d.toFixed(1)}×</span>
                ) : (
                  <span style={{ color: "#6D7175" }}>—</span>
                )}
              </td>
              <td style={{ ...tdStyle, textAlign: "end", fontVariantNumeric: "tabular-nums" }}>
                {formatCurrency(p.stock_value, market)}
              </td>
              <td style={{ ...tdStyle, textAlign: "end", fontVariantNumeric: "tabular-nums" }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    color: p.is_damaged_outlier ? "#D72C0D" : "#1A1A1A",
                    fontWeight: p.is_damaged_outlier ? 600 : 400,
                  }}
                >
                  {p.is_damaged_outlier && <ShieldAlert size={14} strokeWidth={2} aria-hidden="true" />}
                  {p.damaged_return_count}
                  {p.damaged_rate > 0 && (
                    <span style={{ color: "#6D7175", fontWeight: 400 }}>
                      ({Math.round(p.damaged_rate * 100)}%)
                    </span>
                  )}
                </span>
              </td>
              {canAdjust && (
                <td style={{ ...tdStyle, textAlign: "end" }}>
                  <button
                    type="button"
                    onClick={() => onAdjust(p)}
                    aria-label={t("adjust.openLabel", { name: p.name })}
                    style={{
                      background: "#FFFFFF",
                      border: "1px solid #D1D5DB",
                      borderRadius: 4,
                      padding: "4px 10px",
                      fontSize: 12,
                      color: "#1A1A1A",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Pencil size={12} strokeWidth={2} aria-hidden="true" />
                    {t("adjust.button")}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MovementsList({
  rows,
  locale,
  t,
}: {
  rows: Movement[];
  locale: string;
  t: I18n;
}) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((m) => {
        const sign = m.change > 0 ? "+" : "";
        const color = m.change > 0 ? "#008060" : m.change < 0 ? "#D72C0D" : "#6D7175";
        const href = m.order_id
          ? `/${locale}/orders/${m.order_id}`
          : `/${locale}/products/${m.product_id}`;
        return (
          <li key={m.id}>
            <Link
              href={href}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto auto",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                border: "1px solid #E1E3E5",
                borderRadius: 6,
                textDecoration: "none",
                color: "#1A1A1A",
              }}
            >
              <span style={{ minWidth: 0, overflow: "hidden" }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {m.product_name}
                </div>
                <div style={{ fontSize: 12, color: "#6D7175" }}>
                  {reasonLabel(m.reason, t)} · {formatDateTime(m.created_at, locale)}
                  {m.order_id ? ` · ${t("movements.hasOrder")}` : ""}
                </div>
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  color,
                  whiteSpace: "nowrap",
                }}
              >
                {sign}
                {m.change}
              </span>
              <span style={{ fontSize: 12, color: "#6D7175", fontVariantNumeric: "tabular-nums" }}>
                {t("movements.balanceShort", { balance: m.balance_after })}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function AdjustStockModal({
  product,
  onClose,
  onSaved,
  t,
}: {
  product: Product;
  onClose: () => void;
  onSaved: () => void;
  t: I18n;
}) {
  const [change, setChange] = useState<string>("");
  const [reason, setReason] = useState<"manual_adjustment" | "damaged_writeoff">("manual_adjustment");
  const [note, setNote] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = Number(change);
  const valid =
    Number.isInteger(parsed) &&
    parsed !== 0 &&
    note.trim().length > 0 &&
    (reason !== "damaged_writeoff" || parsed < 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${product.id}/stock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ change: parsed, reason, note: note.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "" }));
        setError(body.error || t("adjust.errorGeneric"));
        setSubmitting(false);
        return;
      }
      onSaved();
    } catch {
      setError(t("adjust.errorGeneric"));
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="adjust-stock-title"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(26, 26, 26, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: "16px",
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{
          background: "#FFFFFF",
          borderRadius: 8,
          width: "100%",
          maxWidth: 480,
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBlockEnd: "1px solid #E5E7EB",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h2 id="adjust-stock-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            {t("adjust.title", { name: product.name })}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("adjust.close")}
            style={{
              background: "transparent",
              border: 0,
              padding: 4,
              cursor: "pointer",
              color: "#6D7175",
            }}
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 13, color: "#6D7175" }}>
            {t("adjust.currentStock", { value: product.current_stock })}
          </div>

          <Field label={t("adjust.reasonLabel")}>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as "manual_adjustment" | "damaged_writeoff")}
              style={selectStyle}
            >
              <option value="manual_adjustment">{t("adjust.reasons.manual_adjustment")}</option>
              <option value="damaged_writeoff">{t("adjust.reasons.damaged_writeoff")}</option>
            </select>
          </Field>

          <Field
            label={t("adjust.changeLabel")}
            hint={reason === "damaged_writeoff" ? t("adjust.changeHintDamaged") : t("adjust.changeHint")}
          >
            <input
              type="number"
              step="1"
              value={change}
              onChange={(e) => setChange(e.target.value)}
              placeholder={reason === "damaged_writeoff" ? "-1" : "+5"}
              style={inputStyle}
              required
            />
          </Field>

          <Field label={t("adjust.noteLabel")} hint={t("adjust.noteHint")}>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: "vertical", paddingBlock: 8 }}
              required
            />
          </Field>

          {error && (
            <div
              role="alert"
              style={{
                fontSize: 13,
                color: "#D72C0D",
                background: "#FFF4F4",
                padding: "8px 10px",
                borderRadius: 4,
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div
          style={{
            padding: "12px 20px",
            borderBlockStart: "1px solid #E5E7EB",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "#FFFFFF",
              border: "1px solid #D1D5DB",
              borderRadius: 4,
              padding: "8px 14px",
              fontSize: 13,
              color: "#1A1A1A",
              cursor: "pointer",
            }}
          >
            {t("adjust.cancel")}
          </button>
          <button
            type="submit"
            disabled={!valid || submitting}
            style={{
              background: valid && !submitting ? "#1A1A1A" : "#F3F4F6",
              color: valid && !submitting ? "#FFFFFF" : "#9CA3AF",
              border: 0,
              borderRadius: 4,
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 500,
              cursor: valid && !submitting ? "pointer" : "not-allowed",
            }}
          >
            {submitting ? t("adjust.saving") : t("adjust.save")}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: "#6D7175" }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 12, color: "#6D7175" }}>{hint}</span>}
    </label>
  );
}

function HealthPill({ health, t }: { health: HealthClass; t: I18n }) {
  const palette = HEALTH_PALETTE[health];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: palette.bg,
        color: palette.fg,
        padding: "2px 8px",
        borderRadius: 9999,
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      {t(`healthPill.${health}`)}
    </span>
  );
}

const HEALTH_PALETTE: Record<
  HealthClass | "reorder",
  { bg: string; fg: string }
> = {
  healthy: { bg: "#F1F8F5", fg: "#008060" },
  low: { bg: "#FFF8E6", fg: "#B98900" },
  out: { bg: "#FFF4F4", fg: "#D72C0D" },
  overstocked: { bg: "#F6F6F7", fg: "#6D7175" },
  reorder: { bg: "#FFF4F4", fg: "#D72C0D" },
};

const KNOWN_REASONS = new Set([
  "deposit",
  "returned",
  "damaged_return",
  "manual_adjustment",
  "damaged_writeoff",
  "manual_restock",
  "initial_stock",
]);

type KnownReason = typeof KNOWN_REASONS extends Set<infer T> ? T : never;

function reasonLabel(reason: string, t: I18n): string {
  if (KNOWN_REASONS.has(reason as KnownReason)) {
    return t(`movements.reasons.${reason as KnownReason}`);
  }
  return reason;
}

function formatRate(value: number): string {
  if (value === 0) return "0";
  if (value < 1) return value.toFixed(1);
  return Math.round(value).toString();
}

const thStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 11,
  fontWeight: 500,
  color: "#6D7175",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  textAlign: "start",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 13,
  color: "#1A1A1A",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#FFFFFF",
  border: "1px solid #D1D5DB",
  borderRadius: 6,
  padding: "0 10px",
  height: 36,
  fontSize: 14,
  color: "#1A1A1A",
  fontFamily: "inherit",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: "none",
};
