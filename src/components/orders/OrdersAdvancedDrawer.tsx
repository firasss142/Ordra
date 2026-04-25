"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { OrderListFilters } from "@/lib/orders/list-filters";
import { ORDER_STATUSES, REJECTION_REASONS, type OrderStatus, type RejectionReason } from "@/types/order-status";

interface Product {
  id: string;
  name: string;
}
interface Carrier {
  id: string;
  name: string;
}
interface Agent {
  id: string;
  full_name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  filters: OrderListFilters;
  onApply: (patch: Partial<OrderListFilters>) => void;
  products: Product[];
  carriers: Carrier[];
  agents: Agent[];
}

export function OrdersAdvancedDrawer({
  open,
  onClose,
  filters,
  onApply,
  products,
  carriers,
  agents,
}: Props) {
  const t = useTranslations("orders.advanced");
  const tStatus = useTranslations("orders.statuses");
  const tReason = useTranslations("orders.rejectionReasons");

  const [local, setLocal] = useState<OrderListFilters>(filters);

  useEffect(() => {
    if (open) setLocal(filters);
  }, [open, filters]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Scrim */}
      <div
        aria-hidden
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(26,26,26,0.3)",
          zIndex: 40,
        }}
      />
      {/* Drawer */}
      <aside
        role="dialog"
        aria-label={t("title")}
        style={{
          position: "fixed",
          insetBlockStart: 0,
          insetInlineEnd: 0,
          height: "100vh",
          width: 360,
          maxWidth: "90vw",
          background: "#FFFFFF",
          borderInlineStart: "1px solid #E1E3E5",
          boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          zIndex: 50,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid #E1E3E5",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#1A1A1A" }}>
            {t("title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            style={{
              background: "none",
              border: "none",
              color: "#6D7175",
              fontSize: 18,
              cursor: "pointer",
              padding: 4,
            }}
          >
            ×
          </button>
        </header>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: 18,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {/* Status multi-select */}
          <Field label={t("status")}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {(ORDER_STATUSES as readonly OrderStatus[]).map((s) => {
                const checked = local.statuses.includes(s);
                return (
                  <label
                    key={s}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "5px 8px",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 13,
                      color: "#1A1A1A",
                      background: checked ? "#F2F2F2" : "transparent",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = checked
                          ? local.statuses.filter((x) => x !== s)
                          : [...local.statuses, s];
                        setLocal({ ...local, statuses: next });
                      }}
                      style={{ cursor: "pointer" }}
                    />
                    {tStatus(s)}
                  </label>
                );
              })}
            </div>
          </Field>

          {/* Agent */}
          <Field label={t("agent")}>
            <select
              value={local.agentId ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setLocal({
                  ...local,
                  agentId: v === "" ? null : (v as string | "unassigned"),
                });
              }}
              style={select}
            >
              <option value="">{t("allAgents")}</option>
              <option value="unassigned">{t("unassigned")}</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.full_name}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("product")}>
            <select
              value={local.productId ?? ""}
              onChange={(e) => setLocal({ ...local, productId: e.target.value || null })}
              style={select}
            >
              <option value="">{t("allProducts")}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("city")}>
            <input
              type="text"
              value={local.city}
              onChange={(e) => setLocal({ ...local, city: e.target.value })}
              style={textInput}
              placeholder={t("cityPlaceholder")}
            />
          </Field>

          <Field label={t("totalRange")}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="number"
                inputMode="decimal"
                placeholder={t("min")}
                value={local.totalMin ?? ""}
                onChange={(e) =>
                  setLocal({ ...local, totalMin: e.target.value === "" ? null : Number(e.target.value) })
                }
                style={{ ...textInput, flex: 1 }}
              />
              <input
                type="number"
                inputMode="decimal"
                placeholder={t("max")}
                value={local.totalMax ?? ""}
                onChange={(e) =>
                  setLocal({ ...local, totalMax: e.target.value === "" ? null : Number(e.target.value) })
                }
                style={{ ...textInput, flex: 1 }}
              />
            </div>
          </Field>

          <Field label={t("rejectionReason")}>
            <select
              value={local.rejectionReason ?? ""}
              onChange={(e) =>
                setLocal({
                  ...local,
                  rejectionReason: (e.target.value || null) as RejectionReason | null,
                })
              }
              style={select}
            >
              <option value="">{t("anyReason")}</option>
              {REJECTION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {tReason(r)}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("carrier")}>
            <select
              value={local.carrierId ?? ""}
              onChange={(e) => setLocal({ ...local, carrierId: e.target.value || null })}
              style={select}
            >
              <option value="">{t("anyCarrier")}</option>
              {carriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <footer
          style={{
            padding: 14,
            borderTop: "1px solid #E1E3E5",
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={() =>
              setLocal({
                ...local,
                statuses: [],
                agentId: null,
                productId: null,
                city: "",
                totalMin: null,
                totalMax: null,
                rejectionReason: null,
                carrierId: null,
              })
            }
            style={secondaryBtn}
          >
            {t("reset")}
          </button>
          <button
            type="button"
            onClick={() => {
              onApply({
                statuses: local.statuses,
                agentId: local.agentId,
                productId: local.productId,
                city: local.city,
                totalMin: local.totalMin,
                totalMax: local.totalMax,
                rejectionReason: local.rejectionReason,
                carrierId: local.carrierId,
              });
              onClose();
            }}
            style={primaryBtn}
          >
            {t("apply")}
          </button>
        </footer>
      </aside>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: "#6D7175" }}>{label}</span>
      {children}
    </div>
  );
}

const select: React.CSSProperties = {
  height: 34,
  padding: "0 10px",
  fontSize: 13,
  border: "1px solid #E1E3E5",
  borderRadius: 6,
  background: "#FFFFFF",
  color: "#1A1A1A",
};

const textInput: React.CSSProperties = {
  height: 34,
  padding: "0 10px",
  fontSize: 13,
  border: "1px solid #E1E3E5",
  borderRadius: 6,
  background: "#FFFFFF",
  color: "#1A1A1A",
};

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
};

const secondaryBtn: React.CSSProperties = {
  height: 34,
  padding: "0 14px",
  fontSize: 13,
  fontWeight: 500,
  background: "#FFFFFF",
  color: "#1A1A1A",
  border: "1px solid #E1E3E5",
  borderRadius: 6,
  cursor: "pointer",
};
