"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import type { Role } from "@/types";
import type FocusTrapType from "focus-trap-react";

const FocusTrap = dynamic(() => import("focus-trap-react"), { ssr: false }) as typeof FocusTrapType;
import { canManageProducts } from "@/lib/role-permissions";
import { canToggleProductActive } from "@/lib/product-permissions";
import { ProductListItem } from "./ProductListItem";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ProductRow {
  id: string;
  market_id: string;
  name: string;
  unit_cogs: number;
  packing_cost: number;
  cpl: number;
  confirmation_processing_cost?: number;
  low_stock_threshold: number;
  current_stock: number;
  system_inventory?: number;
  real_inventory?: number;
  damaged_return_count: number;
  is_active: boolean;
  variant_count: number;
  created_at: string;
  updated_at: string;
}

interface Market {
  id: string;
  name: string;
  code: string;
}

interface ProductListProps {
  role: Role;
  marketId: string;
}

const thStyle: React.CSSProperties = {
  padding: "12px 16px",
  textAlign: "start",
  fontSize: 13,
  fontWeight: 500,
  color: "#6D7175",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: "1px solid #E1E3E5",
};

interface StockAdjustState {
  productId: string;
  productName: string;
  change: string;
  reason: "manual_adjustment" | "damaged_writeoff";
  note: string;
  loading: boolean;
  error: string | null;
}

interface AddProductState {
  name: string;
  default_price: string;
  unit_cogs: string;
  packing_cost: string;
  cpl: string;
  low_stock_threshold: string;
  initial_stock: string;
  loading: boolean;
  error: string | null;
}

const EMPTY_ADD: AddProductState = {
  name: "",
  default_price: "",
  unit_cogs: "",
  packing_cost: "",
  cpl: "",
  low_stock_threshold: "5",
  initial_stock: "0",
  loading: false,
  error: null,
};

const PAGE_SIZE = 50;

export function ProductList({ role, marketId }: ProductListProps) {
  const canManage = canManageProducts(role);
  const canToggleActive = canToggleProductActive(role);
  const [selectedMarketId, setSelectedMarketId] = useState(marketId);
  const [page, setPage] = useState(1);
  const [stockModal, setStockModal] = useState<StockAdjustState | null>(null);
  const [addModal, setAddModal] = useState<AddProductState | null>(null);
  const stockModalRef = useRef<HTMLDivElement>(null);
  const addModalRef = useRef<HTMLDivElement>(null);
  const t = useTranslations("products");

  const closeStockModal = useCallback(() => {
    setStockModal((s) => (s && !s.loading ? null : s));
  }, []);

  const closeAddModal = useCallback(() => {
    setAddModal((s) => (s && !s.loading ? null : s));
  }, []);

  useEffect(() => {
    if (!stockModal) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") closeStockModal(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [stockModal, closeStockModal]);

  useEffect(() => {
    if (!addModal) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") closeAddModal(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [addModal, closeAddModal]);

  async function handleAddProduct() {
    if (!addModal) return;
    const { name, default_price, unit_cogs, packing_cost, cpl, low_stock_threshold, initial_stock } = addModal;
    if (!name.trim()) {
      setAddModal((s) => s && ({ ...s, error: "Le nom est obligatoire." }));
      return;
    }
    const unitCogsNum = parseFloat(unit_cogs);
    const packingNum = parseFloat(packing_cost);
    const defaultPriceNum = default_price.trim() === "" ? null : parseFloat(default_price);
    if (defaultPriceNum !== null && (isNaN(defaultPriceNum) || defaultPriceNum < 0)) {
      setAddModal((s) => s && ({ ...s, error: "Prix de vente invalide." }));
      return;
    }
    if (isNaN(unitCogsNum) || unitCogsNum < 0) {
      setAddModal((s) => s && ({ ...s, error: "COGS unitaire invalide." }));
      return;
    }
    if (isNaN(packingNum) || packingNum < 0) {
      setAddModal((s) => s && ({ ...s, error: "Coût d'emballage invalide." }));
      return;
    }
    setAddModal((s) => s && ({ ...s, loading: true, error: null }));
    const body: Record<string, unknown> = {
      name: name.trim(),
      unit_cogs: unitCogsNum,
      packing_cost: packingNum,
      cpl: parseFloat(cpl) || 0,
      low_stock_threshold: parseInt(low_stock_threshold, 10) || 5,
      initial_stock: parseInt(initial_stock, 10) || 0,
      market_id: selectedMarketId,
    };
    if (defaultPriceNum !== null) body.default_price = defaultPriceNum;
    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setAddModal((s) => s && ({ ...s, loading: false, error: json.error ?? `Erreur ${res.status}` }));
      return;
    }
    setAddModal(null);
    mutate();
  }

  if (role === "agent") return null;

  const productKey = selectedMarketId
    ? `/api/products?market_id=${selectedMarketId}&page=${page}&limit=${PAGE_SIZE}`
    : null;
  const { data: productsData, mutate } = useSWR<{
    data: ProductRow[];
    pagination?: { total: number; page: number; limit: number; totalPages: number };
  }>(productKey, fetcher);
  const { data: marketsData } = useSWR<{ data: Market[] }>(
    role === "super_admin" ? "/api/markets" : null,
    fetcher
  );

  const products = productsData?.data ?? [];
  const markets = marketsData?.data ?? [];
  const totalPages = productsData?.pagination?.totalPages ?? 1;

  useEffect(() => {
    if (!selectedMarketId && markets.length > 0) {
      setSelectedMarketId(markets[0].id);
    }
  }, [selectedMarketId, markets]);

  // Reset to first page when switching market
  useEffect(() => {
    setPage(1);
  }, [selectedMarketId]);

  // Determine currency from market code
  const currentMarket = markets.find((m) => m.id === selectedMarketId);
  const currency =
    currentMarket?.code === "ly"
      ? "LYD"
      : "TND";

  const handleToggleActive = useCallback(
    async (productId: string) => {
      const product = products.find((p) => p.id === productId);
      if (!product) return;
      await fetch(`/api/products/${productId}/active`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !product.is_active }),
      });
      mutate();
    },
    [products, mutate],
  );

  const openStockModal = useCallback(
    (productId: string, productName: string) => {
      setStockModal({
        productId,
        productName,
        change: "",
        reason: "manual_adjustment",
        note: "",
        loading: false,
        error: null,
      });
    },
    [],
  );

  async function handleStockSubmit() {
    if (!stockModal) return;
    const changeNum = parseInt(stockModal.change, 10);
    if (!Number.isInteger(changeNum) || changeNum === 0) {
      setStockModal((s) => s && ({ ...s, error: "La quantité doit être un entier non nul." }));
      return;
    }
    if (!stockModal.note.trim()) {
      setStockModal((s) => s && ({ ...s, error: "La note est obligatoire." }));
      return;
    }
    setStockModal((s) => s && ({ ...s, loading: true, error: null }));
    const res = await fetch(`/api/products/${stockModal.productId}/stock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ change: changeNum, reason: stockModal.reason, note: stockModal.note.trim() }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setStockModal((s) => s && ({ ...s, loading: false, error: json.error ?? `Erreur ${res.status}` }));
      return;
    }
    setStockModal(null);
    mutate();
  }

  return (
    <>
      {/* Add product modal */}
      {addModal && (
        <>
          <div
            style={{ position: "fixed", inset: 0, backgroundColor: "rgba(26,26,26,0.4)", zIndex: 40 }}
            onClick={closeAddModal}
          />
          <FocusTrap focusTrapOptions={{ allowOutsideClick: true, fallbackFocus: () => addModalRef.current ?? document.body }}>
          <div
            ref={addModalRef}
            tabIndex={-1}
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              backgroundColor: "#FFFFFF",
              border: "1px solid #E1E3E5",
              borderRadius: "0.5rem",
              padding: 24,
              zIndex: 50,
              width: 440,
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A" }}>
              {t("addButton")}
            </div>

            {[
              { label: "Nom du produit *", key: "name", placeholder: "Ex: Chaussures Sport" },
              { label: "Prix de vente (TND/LYD)", key: "default_price", placeholder: "0.000" },
              { label: "COGS unitaire (TND/LYD) *", key: "unit_cogs", placeholder: "0.000" },
              { label: "Coût d'emballage *", key: "packing_cost", placeholder: "0.000" },
              { label: "CPL (Coût par lead)", key: "cpl", placeholder: "0.000" },
              { label: "Seuil stock bas", key: "low_stock_threshold", placeholder: "5" },
              { label: "Stock initial", key: "initial_stock", placeholder: "0" },
            ].map(({ label, key, placeholder }) => (
              <div key={key}>
                <label style={{ fontSize: 13, color: "#6D7175", display: "block", marginBottom: 4 }}>{label}</label>
                <input
                  type={key === "name" ? "text" : "number"}
                  value={addModal[key as keyof AddProductState] as string}
                  onChange={(e) => setAddModal((s) => s && ({ ...s, [key]: e.target.value }))}
                  placeholder={placeholder}
                  style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid #E1E3E5", borderRadius: 4, boxSizing: "border-box" }}
                />
              </div>
            ))}

            {addModal.error && (
              <div style={{ fontSize: 12, color: "#DC2626" }}>{addModal.error}</div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setAddModal(null)}
                disabled={addModal.loading}
                style={{ padding: "8px 16px", fontSize: 13, border: "1px solid #E1E3E5", borderRadius: 4, background: "white", cursor: "pointer" }}
              >
                Annuler
              </button>
              <button
                onClick={handleAddProduct}
                disabled={addModal.loading}
                style={{ padding: "8px 16px", fontSize: 13, border: "none", borderRadius: 4, background: "#1A1A1A", color: "white", cursor: addModal.loading ? "not-allowed" : "pointer" }}
              >
                {addModal.loading ? "Enregistrement…" : "Créer le produit"}
              </button>
            </div>
          </div>
          </FocusTrap>
        </>
      )}

      {/* Stock adjustment modal */}
      {stockModal && (
        <>
          <div
            style={{ position: "fixed", inset: 0, backgroundColor: "rgba(26,26,26,0.4)", zIndex: 40 }}
            onClick={closeStockModal}
          />
          <FocusTrap focusTrapOptions={{ allowOutsideClick: true, fallbackFocus: () => stockModalRef.current ?? document.body }}>
          <div
            ref={stockModalRef}
            tabIndex={-1}
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              backgroundColor: "#FFFFFF",
              border: "1px solid #E1E3E5",
              borderRadius: "0.5rem",
              padding: 24,
              zIndex: 50,
              width: 400,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A", marginBottom: 4 }}>
              {t("stockModal.title", { name: stockModal.productName })}
            </div>
            <div>
              <label style={{ fontSize: 13, color: "#6D7175", display: "block", marginBottom: 4 }}>{t("stockModal.quantityLabel")}</label>
              <input
                type="number"
                value={stockModal.change}
                onChange={(e) => setStockModal((s) => s && ({ ...s, change: e.target.value }))}
                placeholder={t("stockModal.quantityPlaceholder")}
                style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid #E1E3E5", borderRadius: 4, boxSizing: "border-box" }}
              />
            </div>
            <div>
              <label style={{ fontSize: 13, color: "#6D7175", display: "block", marginBottom: 4 }}>{t("stockModal.reasonLabel")}</label>
              <select
                value={stockModal.reason}
                onChange={(e) => setStockModal((s) => s && ({ ...s, reason: e.target.value as "manual_adjustment" | "damaged_writeoff" }))}
                style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid #E1E3E5", borderRadius: 4 }}
              >
                <option value="manual_adjustment">{t("stockReasons.manual_adjustment")}</option>
                <option value="damaged_writeoff">{t("stockReasons.damaged_writeoff")}</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 13, color: "#6D7175", display: "block", marginBottom: 4 }}>{t("stockModal.noteLabel")}</label>
              <input
                type="text"
                value={stockModal.note}
                onChange={(e) => setStockModal((s) => s && ({ ...s, note: e.target.value }))}
                placeholder={t("stockModal.notePlaceholder")}
                style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid #E1E3E5", borderRadius: 4, boxSizing: "border-box" }}
              />
            </div>
            {stockModal.error && (
              <div style={{ fontSize: 12, color: "#DC2626" }}>{stockModal.error}</div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setStockModal(null)}
                disabled={stockModal.loading}
                style={{ padding: "8px 16px", fontSize: 13, border: "1px solid #E1E3E5", borderRadius: 4, background: "white", cursor: "pointer" }}
              >
                {t("stockModal.cancel")}
              </button>
              <button
                onClick={handleStockSubmit}
                disabled={stockModal.loading}
                style={{ padding: "8px 16px", fontSize: 13, border: "none", borderRadius: 4, background: "#1A1A1A", color: "white", cursor: stockModal.loading ? "not-allowed" : "pointer" }}
              >
                {stockModal.loading ? t("stockModal.saving") : t("stockModal.apply")}
              </button>
            </div>
          </div>
          </FocusTrap>
        </>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {role === "super_admin" && markets.length > 0 && (
            <select
              value={selectedMarketId}
              onChange={(e) => setSelectedMarketId(e.target.value)}
              style={{
                height: 32,
                padding: "0 8px",
                fontSize: 13,
                border: "1px solid #E1E3E5",
                borderRadius: "0.5rem",
                background: "white",
                cursor: "pointer",
              }}
            >
              {markets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {canManage && products.length > 0 && (
          <button
            onClick={() => setAddModal({ ...EMPTY_ADD })}
            style={{
              backgroundColor: "white",
              color: "#1A1A1A",
              border: "1px solid #E1E3E5",
              borderRadius: "0.5rem",
              padding: "8px 16px",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {t("addButton")}
          </button>
        )}
      </div>

      {products.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: 48,
            color: "#6D7175",
            fontSize: 14,
          }}
        >
          <p style={{ margin: "0 0 16px 0" }}>{t("emptyState")}</p>
          {canManage && (
            <button
              onClick={() => setAddModal({ ...EMPTY_ADD })}
              style={{
                backgroundColor: "white",
                color: "#1A1A1A",
                border: "1px solid #E1E3E5",
                borderRadius: "0.5rem",
                padding: "8px 16px",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {t("addButton")}
            </button>
          )}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("table.product")}</th>
                <th style={thStyle}>{t("table.variants")}</th>
                <th style={thStyle}>{t("table.stock")}</th>
                <th style={thStyle}>{t("table.systemInventory")}</th>
                <th style={thStyle}>{t("table.realInventory")}</th>
                <th style={thStyle}>{t("table.threshold")}</th>
                <th style={thStyle}>{t("table.unitCogs")}</th>
                <th style={thStyle}>{t("table.packing")}</th>
                <th style={thStyle}>{t("table.status")}</th>
                <th style={thStyle}>{t("table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <ProductListItem
                  key={product.id}
                  product={product}
                  locale={currentMarket?.code === "ly" ? "ar" : "fr"}
                  currency={currency}
                  onToggleActive={handleToggleActive}
                  onAdjustStock={canManage ? openStockModal : undefined}
                  canManage={canManage}
                  canToggleActive={canToggleActive}
                />
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 12,
                padding: "12px 16px",
                fontSize: 13,
                color: "#6D7175",
              }}
            >
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                style={{
                  padding: "4px 12px",
                  fontSize: 13,
                  backgroundColor: page <= 1 ? "#9CA3AF" : "#1A1A1A",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: "0.375rem",
                  cursor: page <= 1 ? "not-allowed" : "pointer",
                }}
              >
                {t("pagination.previous")}
              </button>
              <span>{t("pagination.pageOf", { page, total: totalPages })}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                style={{
                  padding: "4px 12px",
                  fontSize: 13,
                  backgroundColor: page >= totalPages ? "#9CA3AF" : "#1A1A1A",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: "0.375rem",
                  cursor: page >= totalPages ? "not-allowed" : "pointer",
                }}
              >
                {t("pagination.next")}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
