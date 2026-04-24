"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { PackageCheck, PackageX, Image as ImageIcon, X } from "lucide-react";
import type { ReturnReason } from "@/lib/warehouse/returns-validation";

export interface DecisionOrder {
  id: string;
  customer_name: string | null;
  customer_city?: string | null;
  product_id: string | null;
  product_name: string | null;
  quantity: number;
}

export interface ReturnRate {
  returned: number;
  damaged: number;
  total: number;
  return_rate_percent: number;
}

export interface DecisionPayload {
  order_id: string;
  is_damaged: boolean;
  return_reason: ReturnReason | null;
  return_reason_note: string | null;
  return_photo_url: string | null;
  customer_name: string | null;
  quantity: number;
}

interface Props {
  order: DecisionOrder;
  rate: ReturnRate | null;
  onAddToBatch: (payload: DecisionPayload) => void;
  onCommitNow: (payload: DecisionPayload) => void;
  onCancel: () => void;
  submitting?: boolean;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(file);
  });
}

const REASON_OPTIONS: Array<{ key: ReturnReason; labelKey: string }> = [
  { key: "packaging", labelKey: "reasonPackaging" },
  { key: "product_defect", labelKey: "reasonProductDefect" },
  { key: "customer_damage", labelKey: "reasonCustomerDamage" },
  { key: "carrier_damage", labelKey: "reasonCarrierDamage" },
  { key: "other", labelKey: "reasonOther" },
];

export function ReturnsDecisionCard({
  order,
  rate,
  onAddToBatch,
  onCommitNow,
  onCancel,
  submitting,
}: Props) {
  const t = useTranslations("warehouse.returns.decision");
  const tErr = useTranslations("warehouse.returns.errors");
  const [isDamaged, setIsDamaged] = useState<boolean | null>(null);
  const [reason, setReason] = useState<ReturnReason | null>(null);
  const [note, setNote] = useState("");
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const trimmedNote = note.trim();
  const valid =
    isDamaged !== null &&
    (isDamaged
      ? Boolean(reason) && (reason !== "other" || Boolean(trimmedNote))
      : true);

  const payload = (): DecisionPayload => ({
    order_id: order.id,
    is_damaged: Boolean(isDamaged),
    return_reason: isDamaged ? reason : null,
    return_reason_note: isDamaged && reason === "other" ? trimmedNote : null,
    return_photo_url: isDamaged ? photoPath : null,
    customer_name: order.customer_name,
    quantity: order.quantity,
  });

  const rateLabel =
    !rate || rate.total === 0
      ? t("returnRateZero")
      : t("returnRate", {
          percent: rate.return_rate_percent,
          returned: rate.returned + rate.damaged,
          total: rate.total,
        });

  const rateHigh = rate && rate.total >= 10 && rate.return_rate_percent >= 15;

  const handlePhotoChange = async (
    ev: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setUploadError(tErr("photoType"));
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setUploadError(tErr("photoTooLarge"));
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const res = await fetch("/api/warehouse/returns/photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: order.id, data_url: dataUrl }),
      });
      if (!res.ok) {
        setUploadError(tErr("photoUploadFailed"));
        return;
      }
      const json = await res.json();
      setPhotoPath(json.path ?? null);
    } catch {
      setUploadError(tErr("photoUploadFailed"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div
      style={{
        backgroundColor: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A", margin: 0 }}>
            {t("heading")}
          </h2>
          <p style={{ fontSize: 13, color: "#1A1A1A", margin: "6px 0 0" }}>
            <strong>{order.customer_name ?? "—"}</strong>
            {order.customer_city ? ` · ${order.customer_city}` : ""}
          </p>
          <p style={{ fontSize: 12, color: "#6D7175", margin: "2px 0 0" }}>
            {order.product_name ?? "—"} · ×{order.quantity} · #{order.id.slice(0, 8)}
          </p>
        </div>
        <div
          style={{
            textAlign: "end",
            fontSize: 12,
            fontWeight: 500,
            color: rateHigh ? "#D72C0D" : "#6D7175",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {rateLabel}
          {rateHigh ? (
            <div style={{ marginTop: 2, fontSize: 11 }}>{t("returnRateHigh")}</div>
          ) : null}
        </div>
      </header>

      <div
        role="radiogroup"
        aria-label={t("heading")}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
        }}
      >
        {[
          {
            damaged: false,
            Icon: PackageCheck,
            label: t("restock"),
            hint: t("restockHint", { qty: order.quantity }),
            accent: "#008060",
          },
          {
            damaged: true,
            Icon: PackageX,
            label: t("damage"),
            hint: t("damageHint", { qty: order.quantity }),
            accent: "#D72C0D",
          },
        ].map(({ damaged, Icon, label, hint, accent }) => {
          const active = damaged === isDamaged;
          return (
            <button
              key={String(damaged)}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => {
                setIsDamaged(damaged);
                if (!damaged) {
                  setReason(null);
                  setNote("");
                  setPhotoPath(null);
                }
              }}
              style={{
                all: "unset",
                cursor: "pointer",
                padding: "14px 16px",
                borderRadius: 8,
                backgroundColor: active ? "#F7F7F7" : "#FFFFFF",
                border: `1px solid ${active ? accent : "#E1E3E5"}`,
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <Icon size={22} strokeWidth={1.5} color={active ? accent : "#6D7175"} aria-hidden="true" />
              <span style={{ flex: 1 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: active ? accent : "#1A1A1A" }}>
                  {label}
                </span>
                <span style={{ display: "block", fontSize: 12, color: "#6D7175", marginTop: 2 }}>
                  {hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {isDamaged ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#6D7175",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: 6,
              }}
            >
              {t("reasonTitle")}
            </div>
            <div
              role="radiogroup"
              aria-label={t("reasonTitle")}
              style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
            >
              {REASON_OPTIONS.map(({ key, labelKey }) => {
                const active = reason === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setReason(key)}
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      padding: "6px 12px",
                      borderRadius: 999,
                      fontSize: 13,
                      fontWeight: 500,
                      border: `1px solid ${active ? "#1A1A1A" : "#E1E3E5"}`,
                      backgroundColor: active ? "#1A1A1A" : "#FFFFFF",
                      color: active ? "#FFFFFF" : "#1A1A1A",
                    }}
                  >
                    {t(labelKey)}
                  </button>
                );
              })}
            </div>
          </div>

          {reason === "other" ? (
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("reasonNotePlaceholder")}
              style={{
                padding: "10px 12px",
                fontSize: 14,
                border: "1px solid #E1E3E5",
                borderRadius: 8,
                backgroundColor: "#FFFFFF",
                color: "#1A1A1A",
              }}
            />
          ) : null}

          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#6D7175",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: 6,
              }}
            >
              {t("photoTitle")}
              <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, marginInlineStart: 6 }}>
                · {t("photoHint")}
              </span>
            </div>
            {photoPath ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 12px",
                  border: "1px solid #E1E3E5",
                  borderRadius: 8,
                }}
              >
                <ImageIcon size={16} strokeWidth={1.5} aria-hidden="true" />
                <span
                  style={{
                    flex: 1,
                    fontSize: 12,
                    color: "#6D7175",
                    fontFamily: "ui-monospace, SFMono-Regular, monospace",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {photoPath}
                </span>
                <button
                  type="button"
                  onClick={() => setPhotoPath(null)}
                  aria-label={t("photoRemove")}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    padding: 4,
                    color: "#6D7175",
                  }}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 14px",
                  border: "1px dashed #C9CCCF",
                  borderRadius: 8,
                  fontSize: 13,
                  color: "#1A1A1A",
                  cursor: uploading ? "wait" : "pointer",
                  backgroundColor: uploading ? "#F7F7F7" : "#FFFFFF",
                }}
              >
                <ImageIcon size={16} strokeWidth={1.5} aria-hidden="true" />
                {uploading ? t("photoUploading") : t("photoAdd")}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handlePhotoChange}
                  disabled={uploading}
                  aria-label={t("photoAdd")}
                  style={{
                    position: "absolute",
                    width: 1,
                    height: 1,
                    overflow: "hidden",
                    clipPath: "inset(50%)",
                  }}
                />
              </label>
            )}
            {uploadError ? (
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "#D72C0D" }}>
                {uploadError}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          style={{
            all: "unset",
            cursor: submitting ? "not-allowed" : "pointer",
            padding: "10px 16px",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 500,
            color: "#1A1A1A",
            border: "1px solid #E1E3E5",
          }}
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          disabled={!valid || submitting}
          onClick={() => onAddToBatch(payload())}
          style={{
            all: "unset",
            cursor: !valid || submitting ? "not-allowed" : "pointer",
            padding: "10px 16px",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            color: !valid ? "#6D7175" : "#1A1A1A",
            border: `1px solid ${!valid ? "#E1E3E5" : "#1A1A1A"}`,
            backgroundColor: "#FFFFFF",
          }}
        >
          {t("addToBatch")}
        </button>
        <button
          type="button"
          disabled={!valid || submitting}
          onClick={() => onCommitNow(payload())}
          style={{
            all: "unset",
            cursor: !valid || submitting ? "not-allowed" : "pointer",
            padding: "10px 18px",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            color: "#FFFFFF",
            backgroundColor: !valid ? "#C9CCCF" : "#1A1A1A",
          }}
        >
          {t("commitNow")}
        </button>
      </div>
    </div>
  );
}
