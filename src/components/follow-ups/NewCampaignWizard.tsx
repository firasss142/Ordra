"use client";

import React, { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import type { CampaignFilterJson, CampaignPreviewSample } from "@/types/follow-up";

interface Props {
  open: boolean;
  onClose: () => void;
  marketId: string | null;
  onCreated?: (campaignId: string, createdCount: number) => void;
}

type Step = 1 | 2 | 3;
type AssignMode = "round_robin" | "none";

interface PreviewResult {
  matched_count: number;
  skipped_active_followup: number;
  sample: CampaignPreviewSample[];
}

interface CityOption { id: string; name: string }
interface ProductOption { id: string; name: string }
interface MarketOption { id: string; name: string; code: string }

// Status badge color tokens — same palette used by StatusBadge
const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  new:        { bg: "#F6F6F7", color: "#6D7175" },
  confirmed:  { bg: "#F1F8F5", color: "#008060" },
  dispatched: { bg: "#EBF3FB", color: "#2C6ECB" },
  delivered:  { bg: "#F1F8F5", color: "#008060" },
  returned:   { bg: "#FFF4F4", color: "#D72C0D" },
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: "#6D7175",
  display: "block",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 10px",
  fontSize: 14,
  border: "1px solid #E1E3E5",
  borderRadius: 6,
  background: "white",
  color: "#1A1A1A",
  outline: "none",
  boxSizing: "border-box",
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function NewCampaignWizard({ open, onClose, marketId, onCreated }: Props) {
  const t = useTranslations("crm.followUps.campaigns");
  const tStatuses = useTranslations("orders.statuses");

  const [step, setStep] = useState<Step>(1);
  const [filter, setFilter] = useState<CampaignFilterJson>({
    statuses: ["delivered"],
    date_from: daysAgo(21),
    date_to: daysAgo(14),
  });
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [name, setName] = useState("");
  const [assignMode, setAssignMode] = useState<AssignMode>("round_robin");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // For super_admin (marketId is null): pick a market first
  const [markets, setMarkets] = useState<MarketOption[]>([]);
  const [selectedMarketId, setSelectedMarketId] = useState<string>("");
  const effectiveMarketId = (marketId ?? selectedMarketId) || null;

  const [products, setProducts] = useState<ProductOption[]>([]);

  // City combobox — loaded upfront, filtered client-side
  const [allCities, setAllCities] = useState<CityOption[]>([]);
  const [cityQuery, setCityQuery] = useState("");
  const [cityOpen, setCityOpen] = useState(false);
  const cityContainerRef = useRef<HTMLDivElement>(null);

  const filteredCities = cityQuery.trim()
    ? allCities.filter((c) => c.name.toLowerCase().includes(cityQuery.toLowerCase()))
    : allCities;

  // Fetch markets list for super_admin on open
  useEffect(() => {
    if (!open || marketId !== null) return;
    fetch("/api/markets").then((r) => r.json()).then((j) => {
      setMarkets((j?.data ?? []) as MarketOption[]);
    }).catch(console.error);
  }, [open, marketId]);

  // Fetch cities + products whenever the effective market changes
  useEffect(() => {
    if (!open || !effectiveMarketId) return;
    const productUrl = `/api/products?market_id=${effectiveMarketId}`;
    fetch(productUrl).then((r) => r.json()).then((j) => {
      if (j?.data) setProducts((j.data as Array<{ id: string; name: string }>).map((p) => ({ id: p.id, name: p.name })));
    }).catch(console.error);
    const cityUrl = `/api/cities?market_id=${effectiveMarketId}&limit=200`;
    fetch(cityUrl).then((r) => r.json()).then((j) => {
      setAllCities((j?.data ?? []) as CityOption[]);
    }).catch(console.error);
  }, [open, effectiveMarketId]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cityContainerRef.current && !cityContainerRef.current.contains(e.target as Node)) {
        setCityOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!open) return null;

  const reset = () => {
    setStep(1);
    setFilter({ statuses: ["delivered"], date_from: daysAgo(21), date_to: daysAgo(14) });
    setPreview(null);
    setName("");
    setAssignMode("round_robin");
    setErr(null);
    setCityQuery("");
    setCityOpen(false);
    setSelectedMarketId("");
    setProducts([]);
    setAllCities([]);
  };

  const handleClose = () => { reset(); onClose(); };

  const fetchPreview = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/follow-up-campaigns/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market_id: effectiveMarketId, filter_json: filter }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "error");
      setPreview(json.data);
      setStep(2);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) { setErr(t("nameRequired")); return; }
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/follow-up-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market_id: effectiveMarketId, name: name.trim(), filter_json: filter, assign_mode: assignMode }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "error");
      const { campaign_id, created_count } = json.data;
      onCreated?.(campaign_id, created_count);
      reset();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const updateFilter = (patch: Partial<CampaignFilterJson>) => setFilter((f) => ({ ...f, ...patch }));

  const toggleStatus = (s: string) => {
    const current = filter.statuses ?? [];
    updateFilter({ statuses: current.includes(s) ? current.filter((x) => x !== s) : [...current, s] });
  };

  const pickCity = (city: CityOption) => { updateFilter({ city: city.name }); setCityQuery(city.name); setCityOpen(false); };
  const clearCity = () => { updateFilter({ city: undefined }); setCityQuery(""); setCityOpen(false); };

  const STATUSES = ["new", "confirmed", "dispatched", "delivered", "returned"] as const;

  // Step labels for the breadcrumb
  const STEP_LABELS = [t("stepFilter"), t("stepPreview"), t("stepConfirm")];

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(26,26,26,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        style={{
          width: 580,
          maxWidth: "94vw",
          maxHeight: "92vh",
          overflowY: "auto",
          background: "white",
          borderRadius: 8,
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* ── Header ── */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: "1px solid #E1E3E5",
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A" }}>{t("title")}</div>
            <div style={{ fontSize: 12, color: "#6D7175", marginTop: 2 }}>
              {STEP_LABELS.map((label, i) => (
                <span key={i}>
                  <span style={{
                    color: step === i + 1 ? "#1A1A1A" : step > i + 1 ? "#008060" : "#C9CCCF",
                    fontWeight: step === i + 1 ? 500 : 400,
                  }}>
                    {step > i + 1 ? "✓ " : ""}{label}
                  </span>
                  {i < 2 && <span style={{ margin: "0 6px", color: "#C9CCCF" }}>›</span>}
                </span>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t("close")}
            style={{
              width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
              background: "transparent", border: "1px solid #E1E3E5", borderRadius: 6,
              fontSize: 16, cursor: "pointer", color: "#6D7175", flexShrink: 0,
              transition: "background-color 120ms ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#F6F6F7")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            ×
          </button>
        </div>

        {/* ── Progress bar ── */}
        <div style={{ display: "flex", height: 3, flexShrink: 0 }}>
          {([1, 2, 3] as Step[]).map((s) => (
            <div key={s} style={{
              flex: 1,
              background: step >= s ? "#1A1A1A" : "#E1E3E5",
              transition: "background 200ms ease",
            }} />
          ))}
        </div>

        {/* ── Body ── */}
        <div style={{ padding: "20px 20px 16px", flex: 1 }}>

          {/* ─── Step 1: Filters ─── */}
          {step === 1 && (
            <div>
              {/* Market selector — only for super_admin */}
              {marketId === null && (
                <div style={{ marginBottom: 20 }}>
                  <label htmlFor="campaign-market" style={labelStyle}>{t("filter.market")}</label>
                  <div style={{ position: "relative" }}>
                    <select
                      id="campaign-market"
                      value={selectedMarketId}
                      onChange={(e) => {
                        setSelectedMarketId(e.target.value);
                        // Reset city/product when market changes
                        setCityQuery("");
                        updateFilter({ city: undefined, product_id: undefined });
                        setProducts([]);
                        setAllCities([]);
                      }}
                      style={{ ...inputStyle, appearance: "none", paddingInlineEnd: 28, cursor: "pointer" }}
                    >
                      <option value="">—</option>
                      {markets.map((m) => (
                        <option key={m.id} value={m.id}>{m.name ?? m.code}</option>
                      ))}
                    </select>
                    <span style={{
                      position: "absolute", insetInlineEnd: 10, top: "50%", transform: "translateY(-50%)",
                      pointerEvents: "none", color: "#6D7175", fontSize: 10,
                    }}>▾</span>
                  </div>
                </div>
              )}

              {/* Order status — chip toggles */}
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>{t("filter.status")}</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {STATUSES.map((s) => {
                    const selected = (filter.statuses ?? []).includes(s);
                    const colors = STATUS_COLORS[s];
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => toggleStatus(s)}
                        style={{
                          height: 32,
                          padding: "0 12px",
                          borderRadius: 9999,
                          fontSize: 13,
                          fontWeight: 500,
                          cursor: "pointer",
                          transition: "background-color 120ms ease, border-color 120ms ease",
                          border: selected ? "1.5px solid transparent" : "1.5px solid #E1E3E5",
                          background: selected ? colors.bg : "white",
                          color: selected ? colors.color : "#6D7175",
                        }}
                      >
                        {tStatuses(s as Parameters<typeof tStatuses>[0])}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Date range */}
              <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
                <div style={{ flex: 1 }}>
                  <label htmlFor="campaign-date-from" style={labelStyle}>{t("filter.dateFrom")}</label>
                  <input
                    id="campaign-date-from"
                    type="date"
                    value={filter.date_from ?? ""}
                    max={today()}
                    onChange={(e) => updateFilter({ date_from: e.target.value })}
                    style={inputStyle}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label htmlFor="campaign-date-to" style={labelStyle}>{t("filter.dateTo")}</label>
                  <input
                    id="campaign-date-to"
                    type="date"
                    value={filter.date_to ?? ""}
                    max={today()}
                    onChange={(e) => updateFilter({ date_to: e.target.value })}
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* City + Product row */}
              <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
                {/* City searchable combobox */}
                <div style={{ flex: 1, position: "relative" }} ref={cityContainerRef}>
                  <label htmlFor="campaign-city" style={labelStyle}>{t("filter.city")}</label>
                  <div style={{ position: "relative" }}>
                    <input
                      id="campaign-city"
                      type="text"
                      value={cityQuery}
                      onChange={(e) => { setCityQuery(e.target.value); setCityOpen(true); if (!e.target.value) updateFilter({ city: undefined }); }}
                      onClick={() => setCityOpen(true)}
                      onFocus={() => setCityOpen(true)}
                      placeholder="—"
                      style={{ ...inputStyle, paddingInlineEnd: filter.city ? 28 : 10 }}
                      autoComplete="off"
                    />
                    {filter.city ? (
                      <button
                        type="button"
                        onClick={clearCity}
                        style={{
                          position: "absolute", insetInlineEnd: 8, top: "50%", transform: "translateY(-50%)",
                          background: "none", border: "none", cursor: "pointer", color: "#6D7175",
                          fontSize: 14, lineHeight: 1, padding: 0,
                        }}
                      >×</button>
                    ) : (
                      <span style={{
                        position: "absolute", insetInlineEnd: 10, top: "50%", transform: "translateY(-50%)",
                        pointerEvents: "none", color: "#6D7175", fontSize: 10,
                      }}>▾</span>
                    )}
                  </div>
                  {cityOpen && filteredCities.length > 0 && (
                    <div style={{
                      position: "absolute", top: "100%", insetInlineStart: 0, insetInlineEnd: 0,
                      zIndex: 100, background: "white", border: "1px solid #E1E3E5", borderRadius: 6,
                      marginTop: 2, maxHeight: 180, overflowY: "auto",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                    }}>
                      {filteredCities.map((city) => (
                        <button
                          key={city.id}
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); pickCity(city); }}
                          style={{
                            display: "block", width: "100%", padding: "8px 12px", textAlign: "left",
                            background: "none", border: "none", fontSize: 13, color: "#1A1A1A",
                            cursor: "pointer", borderBottom: "1px solid #F6F6F7",
                            transition: "background-color 120ms ease",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "#F6F6F7")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                        >
                          {city.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Product dropdown */}
                <div style={{ flex: 1 }}>
                  <label htmlFor="campaign-product" style={labelStyle}>{t("filter.product")}</label>
                  <div style={{ position: "relative" }}>
                    <select
                      id="campaign-product"
                      value={filter.product_id ?? ""}
                      onChange={(e) => updateFilter({ product_id: e.target.value || undefined })}
                      style={{ ...inputStyle, appearance: "none", paddingInlineEnd: 28, cursor: "pointer" }}
                    >
                      <option value="">—</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <span style={{
                      position: "absolute", insetInlineEnd: 10, top: "50%", transform: "translateY(-50%)",
                      pointerEvents: "none", color: "#6D7175", fontSize: 10,
                    }}>▾</span>
                  </div>
                </div>
              </div>

              {err && (
                <div style={{ fontSize: 13, color: "#D72C0D", marginBottom: 12, padding: "8px 12px", background: "#FFF4F4", borderRadius: 6, border: "1px solid #FECACA" }}>
                  {err}
                </div>
              )}
            </div>
          )}

          {/* ─── Step 2: Preview ─── */}
          {step === 2 && preview && (
            <div>
              {/* KPI row */}
              <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
                <div style={{
                  flex: 1, border: "1px solid #E1E3E5", borderRadius: 8, padding: "14px 16px",
                  borderTop: "3px solid #1A1A1A",
                }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: "#1A1A1A", fontVariantNumeric: "tabular-nums" }}>
                    {preview.matched_count}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#6D7175", marginTop: 4 }}>
                    {t("previewStats.matched")}
                  </div>
                </div>
                <div style={{
                  flex: 1, border: "1px solid #E1E3E5", borderRadius: 8, padding: "14px 16px",
                  borderTop: "3px solid #B98900",
                }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: "#B98900", fontVariantNumeric: "tabular-nums" }}>
                    {preview.skipped_active_followup}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#6D7175", marginTop: 4 }}>
                    {t("previewStats.skipped")}
                  </div>
                </div>
              </div>

              {/* Sample table */}
              {preview.sample.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#6D7175", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {t("previewStats.sampleOf", { count: preview.sample.length })}
                  </div>
                  <div style={{ border: "1px solid #E1E3E5", borderRadius: 6, overflow: "hidden" }}>
                    <div style={{
                      display: "grid", gridTemplateColumns: "1fr auto",
                      padding: "6px 12px", background: "#F6F6F7",
                      borderBottom: "1px solid #E1E3E5",
                      fontSize: 11, fontWeight: 500, color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.05em",
                    }}>
                      <span>Client</span>
                      <span>Ville</span>
                    </div>
                    {preview.sample.slice(0, 8).map((row, i) => (
                      <div
                        key={row.order_id}
                        style={{
                          display: "grid", gridTemplateColumns: "1fr auto",
                          padding: "9px 12px",
                          borderBottom: i < Math.min(preview.sample.length, 8) - 1 ? "1px solid #F6F6F7" : "none",
                          fontSize: 13,
                        }}
                      >
                        <span style={{ fontWeight: 500, color: "#1A1A1A" }}>{row.customer_name}</span>
                        <span style={{ color: "#6D7175" }}>{row.city ?? "—"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {err && (
                <div style={{ fontSize: 13, color: "#D72C0D", marginBottom: 12, padding: "8px 12px", background: "#FFF4F4", borderRadius: 6, border: "1px solid #FECACA" }}>
                  {err}
                </div>
              )}
            </div>
          )}

          {/* ─── Step 3: Name & confirm ─── */}
          {step === 3 && (
            <div>
              <div style={{ marginBottom: 20 }}>
                <label htmlFor="campaign-name" style={labelStyle}>{t("name")}</label>
                <input
                  id="campaign-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("nameExample")}
                  style={inputStyle}
                  autoFocus
                />
              </div>

              {/* Assignment mode */}
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>{t("assignment.title")}</label>
                <div style={{ display: "flex", gap: 10 }}>
                  {(["round_robin", "none"] as AssignMode[]).map((mode) => {
                    const active = assignMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setAssignMode(mode)}
                        style={{
                          flex: 1, padding: "10px 12px", borderRadius: 6, cursor: "pointer", textAlign: "left",
                          border: active ? "1.5px solid #1A1A1A" : "1.5px solid #E1E3E5",
                          background: active ? "#1A1A1A" : "white",
                          transition: "background-color 120ms ease, border-color 120ms ease",
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 500, color: active ? "white" : "#1A1A1A" }}>
                          {mode === "round_robin" ? t("assignment.roundRobin") : t("assignment.none")}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Summary banner */}
              <div style={{
                fontSize: 13, color: "#6D7175", marginBottom: 16,
                padding: "10px 14px", background: "#F6F6F7", borderRadius: 6,
                borderInlineStart: "3px solid #1A1A1A",
              }}>
                {t("confirmSummary", { count: preview?.matched_count ?? 0, skipped: preview?.skipped_active_followup ?? 0 })}
              </div>

              {err && (
                <div style={{ fontSize: 13, color: "#D72C0D", marginBottom: 12, padding: "8px 12px", background: "#FFF4F4", borderRadius: 6, border: "1px solid #FECACA" }}>
                  {err}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{
          display: "flex", justifyContent: "flex-end", gap: 8,
          padding: "12px 20px", borderTop: "1px solid #E1E3E5", flexShrink: 0,
        }}>
          {step === 1 && (
            <>
              <button type="button" onClick={handleClose} style={secondaryBtn}>{t("cancel")}</button>
              <button type="button" disabled={loading || (filter.statuses ?? []).length === 0 || !effectiveMarketId} onClick={fetchPreview} style={primaryBtn(loading || (filter.statuses ?? []).length === 0 || !effectiveMarketId)}>
                {loading ? t("loading") : t("previewBtn")}
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button type="button" onClick={() => { setStep(1); setErr(null); }} style={secondaryBtn}>{t("back")}</button>
              <button type="button" onClick={() => { setStep(3); setErr(null); }} style={primaryBtn(false)}>{t("next")}</button>
            </>
          )}
          {step === 3 && (
            <>
              <button type="button" onClick={() => { setStep(2); setErr(null); }} style={secondaryBtn}>{t("back")}</button>
              <button type="button" disabled={loading || !name.trim()} onClick={handleCreate} style={primaryBtn(loading || !name.trim())}>
                {loading ? t("loading") : t("create")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const secondaryBtn: React.CSSProperties = {
  height: 36, padding: "0 16px", borderRadius: 6,
  border: "1px solid #E1E3E5", background: "white",
  fontSize: 13, fontWeight: 500, cursor: "pointer", color: "#1A1A1A",
};

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    height: 36, padding: "0 16px", borderRadius: 6, border: "none",
    background: disabled ? "#F3F4F6" : "#1A1A1A",
    color: disabled ? "#9CA3AF" : "white",
    fontSize: 13, fontWeight: 500,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "background-color 120ms ease",
  };
}
