"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ProductImagePicker } from "./ProductImagePicker";

import type { AgentBriefTone } from "@/types/product";
import {
  AGENT_BRIEF_MAX,
  VARIANT_NOTE_MAX,
} from "@/lib/products/agent-content-limits";

interface EditableProduct {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  image_url: string | null;
  agent_brief: string | null;
  agent_brief_tone: AgentBriefTone;
  agent_notes: string | null;
  agent_composition: string | null;
  agent_contraindications: string | null;
  agent_usage: string | null;
  cross_sell_product_id: string | null;
  floor_price: number | null;
  unit_cogs: number;
  packing_cost: number;
  confirmation_processing_cost: number | null;
  default_price: number | null;
  low_stock_threshold: number;
  is_active: boolean;
}

interface EditableVariant {
  id: string;
  label: string;
  agent_note: string | null;
}

interface CrossSellOption {
  id: string;
  name: string;
}

interface Props {
  product: EditableProduct;
  locale: string;
  /**
   * Super admins only. Market managers reach this form to author the agent
   * sheet for their own market; costs, stock and identity stay locked to
   * super_admin per the stock-integrity model.
   */
  canManageCosts: boolean;
  variants: EditableVariant[];
  /** Active products in the same market, excluding this one. */
  crossSellOptions: CrossSellOption[];
}

const TEXT = "#1A1A1A";
const MUTED = "#6D7175";
const BORDER = "#E1E3E5";

const labelStyle: React.CSSProperties = { fontSize: 13, color: MUTED, display: "block", marginBottom: 4, fontWeight: 500 };
const inputStyle: React.CSSProperties = { width: "100%", padding: "8px 10px", fontSize: 13, border: `1px solid ${BORDER}`, borderRadius: 4, boxSizing: "border-box", color: TEXT };
const sectionStyle: React.CSSProperties = { borderBottom: `1px solid ${BORDER}`, paddingBottom: 20, marginBottom: 20 };
const sectionTitleStyle: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: TEXT, marginBottom: 14 };
const hintStyle: React.CSSProperties = { fontSize: 12, color: MUTED, marginTop: 3 };

function numberOrEmpty(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return String(n);
}

export function ProductEditForm({
  product,
  locale,
  canManageCosts,
  variants,
  crossSellOptions,
}: Props) {
  const t = useTranslations("products");
  const router = useRouter();

  const [name, setName] = useState(product.name);
  const [sku, setSku] = useState(product.sku ?? "");
  const [description, setDescription] = useState(product.description ?? "");
  const [agentBrief, setAgentBrief] = useState(product.agent_brief ?? "");
  const [agentBriefTone, setAgentBriefTone] = useState<AgentBriefTone>(
    product.agent_brief_tone,
  );
  const [agentNotes, setAgentNotes] = useState(product.agent_notes ?? "");
  const [variantNotes, setVariantNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(variants.map((v) => [v.id, v.agent_note ?? ""])),
  );
  const [composition, setComposition] = useState(product.agent_composition ?? "");
  const [contraindications, setContraindications] = useState(
    product.agent_contraindications ?? "",
  );
  const [usage, setUsage] = useState(product.agent_usage ?? "");
  const [crossSell, setCrossSell] = useState(product.cross_sell_product_id ?? "");
  const [floorPrice, setFloorPrice] = useState(numberOrEmpty(product.floor_price));
  // What the picker shows: the existing remote URL, a freshly-picked data URL, or null (cleared).
  const [image, setImage] = useState<string | null>(product.image_url ?? null);
  // Only set when the user picks a NEW file this session — drives the upload call.
  const [newImageDataUrl, setNewImageDataUrl] = useState<string | null>(null);
  const [unitCogs, setUnitCogs] = useState(numberOrEmpty(product.unit_cogs));
  const [packingCost, setPackingCost] = useState(numberOrEmpty(product.packing_cost));
  const [processingCost, setProcessingCost] = useState(numberOrEmpty(product.confirmation_processing_cost));
  const [defaultPrice, setDefaultPrice] = useState(numberOrEmpty(product.default_price));
  const [threshold, setThreshold] = useState(numberOrEmpty(product.low_stock_threshold));
  const [isActive, setIsActive] = useState(product.is_active);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);

    if (agentBrief.trim().length > AGENT_BRIEF_MAX) {
      setError(t("editForm.agentContent.agentBriefHint"));
      return;
    }

    if (canManageCosts) {
      const trimmedName = name.trim();
      if (!trimmedName) {
        setError(t("editForm.errors.nameRequired"));
        return;
      }

      const unitCogsNum = parseFloat(unitCogs);
      if (isNaN(unitCogsNum) || unitCogsNum < 0) {
        setError(t("editForm.errors.unitCogsInvalid"));
        return;
      }

      const thresholdNum = parseInt(threshold, 10);
      if (isNaN(thresholdNum) || thresholdNum < 0) {
        setError(t("editForm.errors.thresholdInvalid"));
        return;
      }

      setLoading(true);

      const body: Record<string, unknown> = {
        name: trimmedName,
        sku: sku.trim(),
        unit_cogs: unitCogsNum,
        packing_cost: parseFloat(packingCost) || 0,
        confirmation_processing_cost: parseFloat(processingCost) || 0,
        low_stock_threshold: thresholdNum,
        is_active: isActive,
      };

      // Image upload happens via a separate route after the PATCH. The only
      // image_url change we send through PATCH is an explicit clear (picker
      // emptied and no new file picked) — the upload route never clears.
      if (image === null && newImageDataUrl === null) {
        body.image_url = "";
      }

      if (defaultPrice.trim() !== "") {
        const dp = parseFloat(defaultPrice);
        if (!isNaN(dp) && dp >= 0) body.default_price = dp;
      } else {
        body.default_price = null;
      }

      // Floor price rides with default_price: both set revenue, both are
      // super_admin-only, so neither belongs on the content route.
      if (floorPrice.trim() !== "") {
        const fp = parseFloat(floorPrice);
        if (!isNaN(fp) && fp >= 0) body.floor_price = fp;
      } else {
        body.floor_price = null;
      }

      const res = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const msg = res.status === 409 ? t("editForm.errors.skuConflict") : (json.error ?? `Erreur ${res.status}`);
        setError(msg);
        setLoading(false);
        return;
      }

      // Upload a freshly-picked image, if any.
      if (newImageDataUrl) {
        const imgRes = await fetch(`/api/products/${product.id}/image`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data_url: newImageDataUrl }),
        });
        if (!imgRes.ok) {
          setError(t("image.uploadFailed"));
          setLoading(false);
          return;
        }
      }
    } else {
      setLoading(true);
    }

    // The agent sheet is a weaker permission than the rest of this form, so it
    // always goes through its own route — that is the only write a market
    // manager is allowed to make here.
    const contentRes = await fetch(`/api/products/${product.id}/agent-content`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: description.trim(),
        agent_brief: agentBrief.trim(),
        agent_brief_tone: agentBriefTone,
        agent_notes: agentNotes.trim(),
        agent_composition: composition.trim(),
        agent_contraindications: contraindications.trim(),
        agent_usage: usage.trim(),
        cross_sell_product_id: crossSell,
        variant_notes: variants.map((v) => ({
          id: v.id,
          agent_note: variantNotes[v.id] ?? "",
        })),
      }),
    });

    if (!contentRes.ok) {
      const json = await contentRes.json().catch(() => ({}));
      setError(json.error ?? `Erreur ${contentRes.status}`);
      setLoading(false);
      return;
    }

    router.push(`/${locale}/products/${product.id}`);
    router.refresh();
  }

  return (
    <div style={{ maxWidth: 600 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: TEXT, margin: "0 0 6px 0" }}>
        {t("editForm.title")}
      </h1>
      <p style={{ fontSize: 13, color: MUTED, margin: "0 0 24px 0" }}>{t("editForm.intro")}</p>

      {/* Identity — super_admin only */}
      {canManageCosts ? (
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>{t("create.sections.identity")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label htmlFor="edit-name" style={labelStyle}>{t("editForm.fields.name")} *</label>
              <input id="edit-name" type="text" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label htmlFor="edit-sku" style={labelStyle}>{t("editForm.fields.sku")}</label>
              <input
                id="edit-sku"
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="bv-01"
                style={inputStyle}
              />
              <p style={hintStyle}>{t("editForm.hints.sku")}</p>
            </div>
            <ProductImagePicker
              value={image}
              onChange={(dataUrl) => {
                setImage(dataUrl);
                setNewImageDataUrl(dataUrl);
              }}
            />
          </div>
        </div>
      ) : (
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>{product.name}</div>
        </div>
      )}

      {/* Fiche agent — what the confirmation agent reads during the call */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>{t("editForm.agentContent.section")}</div>
        <p style={{ ...hintStyle, marginTop: 0, marginBottom: 14 }}>
          {t("editForm.agentContent.sectionHint")}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label htmlFor="edit-agent-brief" style={labelStyle}>
              {t("editForm.agentContent.agentBrief")}
            </label>
            <input
              id="edit-agent-brief"
              type="text"
              value={agentBrief}
              maxLength={AGENT_BRIEF_MAX}
              onChange={(e) => setAgentBrief(e.target.value)}
              style={inputStyle}
            />
            <p style={hintStyle}>
              {t("editForm.agentContent.agentBriefHint")}{" "}
              {t("editForm.agentContent.charsLeft", {
                count: AGENT_BRIEF_MAX - agentBrief.length,
              })}
            </p>
          </div>
          <div>
            <label htmlFor="edit-agent-brief-tone" style={labelStyle}>
              {t("editForm.agentContent.agentBriefTone")}
            </label>
            <select
              id="edit-agent-brief-tone"
              value={agentBriefTone}
              onChange={(e) => setAgentBriefTone(e.target.value as AgentBriefTone)}
              style={inputStyle}
            >
              <option value="info">{t("editForm.agentContent.toneInfo")}</option>
              <option value="warning">{t("editForm.agentContent.toneWarning")}</option>
              <option value="critical">{t("editForm.agentContent.toneCritical")}</option>
            </select>
          </div>
          <div>
            <label htmlFor="edit-description" style={labelStyle}>{t("editForm.fields.description")}</label>
            <textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
            />
          </div>
          <div>
            <label htmlFor="edit-agent-notes" style={labelStyle}>
              {t("editForm.agentContent.agentNotes")}
            </label>
            <textarea
              id="edit-agent-notes"
              value={agentNotes}
              onChange={(e) => setAgentNotes(e.target.value)}
              rows={6}
              style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
            />
            <p style={hintStyle}>{t("editForm.agentContent.agentNotesHint")}</p>
          </div>

          <div>
            <label htmlFor="edit-composition" style={labelStyle}>
              {t("editForm.agentContent.composition")}
            </label>
            <textarea
              id="edit-composition"
              value={composition}
              onChange={(e) => setComposition(e.target.value)}
              rows={2}
              style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
            />
            <p style={hintStyle}>{t("editForm.agentContent.compositionHint")}</p>
          </div>

          <div>
            <label htmlFor="edit-usage" style={labelStyle}>
              {t("editForm.agentContent.usage")}
            </label>
            <textarea
              id="edit-usage"
              value={usage}
              onChange={(e) => setUsage(e.target.value)}
              rows={2}
              style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
            />
            <p style={hintStyle}>{t("editForm.agentContent.usageHint")}</p>
          </div>

          <div>
            <label htmlFor="edit-contraindications" style={labelStyle}>
              {t("editForm.agentContent.contraindications")}
            </label>
            <textarea
              id="edit-contraindications"
              value={contraindications}
              onChange={(e) => setContraindications(e.target.value)}
              rows={2}
              style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
            />
            <p style={hintStyle}>{t("editForm.agentContent.contraindicationsHint")}</p>
          </div>

          {canManageCosts && (
            <div>
              <label htmlFor="edit-floor-price" style={labelStyle}>
                {t("editForm.agentContent.floorPrice")}
              </label>
              <input
                id="edit-floor-price"
                type="number"
                min="0"
                step="0.001"
                value={floorPrice}
                onChange={(e) => setFloorPrice(e.target.value)}
                style={inputStyle}
              />
              <p style={hintStyle}>{t("editForm.agentContent.floorPriceHint")}</p>
            </div>
          )}

          <div>
            <label htmlFor="edit-cross-sell" style={labelStyle}>
              {t("editForm.agentContent.crossSell")}
            </label>
            <select
              id="edit-cross-sell"
              value={crossSell}
              onChange={(e) => setCrossSell(e.target.value)}
              style={inputStyle}
            >
              <option value="">{t("editForm.agentContent.crossSellNone")}</option>
              {crossSellOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <p style={hintStyle}>{t("editForm.agentContent.crossSellHint")}</p>
          </div>

          {variants.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {variants.map((v) => (
                <div key={v.id}>
                  <label htmlFor={`edit-variant-note-${v.id}`} style={labelStyle}>
                    {v.label}
                  </label>
                  <input
                    id={`edit-variant-note-${v.id}`}
                    type="text"
                    value={variantNotes[v.id] ?? ""}
                    maxLength={VARIANT_NOTE_MAX}
                    onChange={(e) =>
                      setVariantNotes((prev) => ({ ...prev, [v.id]: e.target.value }))
                    }
                    style={inputStyle}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cost model — super_admin only */}
      {canManageCosts && (
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>{t("create.sections.costModel")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label htmlFor="edit-unit-cogs" style={labelStyle}>{t("editForm.fields.unitCogs")} *</label>
            <input id="edit-unit-cogs" type="number" min="0" step="0.001" value={unitCogs} onChange={(e) => setUnitCogs(e.target.value)} style={inputStyle} />
            <p style={hintStyle}>{t("create.hints.unitCogs")}</p>
          </div>
          <div>
            <label htmlFor="edit-packing-cost" style={labelStyle}>{t("editForm.fields.packingCost")}</label>
            <input id="edit-packing-cost" type="number" min="0" step="0.001" value={packingCost} onChange={(e) => setPackingCost(e.target.value)} style={inputStyle} />
            <p style={hintStyle}>{t("create.hints.packingCost")}</p>
          </div>
          <div>
            <label htmlFor="edit-processing-cost" style={labelStyle}>{t("editForm.fields.processingCost")}</label>
            <input id="edit-processing-cost" type="number" min="0" step="0.001" value={processingCost} onChange={(e) => setProcessingCost(e.target.value)} style={inputStyle} />
            <p style={hintStyle}>{t("create.hints.processingCost")}</p>
          </div>
        </div>
      </div>
      )}

      {/* Inventory & status — super_admin only */}
      {canManageCosts && (
      <div style={{ ...sectionStyle, borderBottom: "none", marginBottom: 24 }}>
        <div style={sectionTitleStyle}>{t("editForm.sections.inventoryAndStatus")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label htmlFor="edit-threshold" style={labelStyle}>{t("editForm.fields.threshold")}</label>
            <input id="edit-threshold" type="number" min="0" value={threshold} onChange={(e) => setThreshold(e.target.value)} style={inputStyle} />
            <p style={hintStyle}>{t("create.hints.threshold")}</p>
          </div>
          <div>
            <label htmlFor="edit-default-price" style={labelStyle}>{t("editForm.fields.defaultPrice")}</label>
            <input id="edit-default-price" type="number" min="0" step="0.001" value={defaultPrice} onChange={(e) => setDefaultPrice(e.target.value)} style={inputStyle} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: TEXT, cursor: "pointer" }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            {t("editForm.fields.isActive")}
          </label>
        </div>
      </div>
      )}

      {error && (
        <div style={{ fontSize: 13, color: "#DC2626", marginBottom: 12 }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => router.push(`/${locale}/products/${product.id}`)}
          disabled={loading}
          style={{ padding: "8px 16px", fontSize: 13, border: `1px solid ${BORDER}`, borderRadius: 4, background: "white", cursor: "pointer" }}
        >
          {t("create.cancel")}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading}
          style={{
            padding: "8px 20px",
            fontSize: 13,
            fontWeight: 600,
            border: "none",
            borderRadius: 4,
            background: TEXT,
            color: "white",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? t("editForm.saving") : t("editForm.submit")}
        </button>
      </div>
    </div>
  );
}
