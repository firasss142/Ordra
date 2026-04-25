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
    <div className="bg-surface-card border border-line-subtle rounded-card p-5 flex flex-col gap-4 shadow-panel">
      <header className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold text-ink-primary m-0">
            {t("heading")}
          </h2>
          <p className="text-[13px] text-ink-primary mt-1.5 mb-0">
            <strong>{order.customer_name ?? "—"}</strong>
            {order.customer_city ? ` · ${order.customer_city}` : ""}
          </p>
          <p className="text-[12px] text-ink-secondary mt-0.5 mb-0">
            {order.product_name ?? "—"} · ×{order.quantity} · #{order.id.slice(0, 8)}
          </p>
        </div>
        <div
          className={`text-end text-[12px] font-medium tabular-nums ${rateHigh ? "text-status-critical" : "text-ink-secondary"}`}
        >
          {rateLabel}
          {rateHigh ? (
            <div className="mt-0.5 text-[11px]">{t("returnRateHigh")}</div>
          ) : null}
        </div>
      </header>

      {/* Segmented Restock vs Damage */}
      <div role="radiogroup" aria-label={t("heading")} className="grid grid-cols-2 gap-2.5">
        {[
          {
            damaged: false,
            Icon: PackageCheck,
            label: t("restock"),
            hint: t("restockHint", { qty: order.quantity }),
            tone: "success" as const,
          },
          {
            damaged: true,
            Icon: PackageX,
            label: t("damage"),
            hint: t("damageHint", { qty: order.quantity }),
            tone: "critical" as const,
          },
        ].map(({ damaged, Icon, label, hint, tone }) => {
          const active = damaged === isDamaged;
          const activeBorder =
            tone === "success" ? "border-status-success" : "border-status-critical";
          const activeText =
            tone === "success" ? "text-status-success" : "text-status-critical";
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
              className={[
                "p-3.5 rounded-card flex items-center gap-3 text-start",
                "border transition-colors duration-fast cursor-pointer",
                active
                  ? `bg-surface-hover ${activeBorder}`
                  : "bg-surface-card border-line-subtle hover:bg-surface-hover",
              ].join(" ")}
            >
              <Icon
                size={22}
                strokeWidth={1.5}
                aria-hidden="true"
                className={active ? activeText : "text-ink-secondary"}
              />
              <span className="flex-1">
                <span
                  className={`block text-[14px] font-semibold ${active ? activeText : "text-ink-primary"}`}
                >
                  {label}
                </span>
                <span className="block text-[12px] text-ink-secondary mt-0.5">
                  {hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {isDamaged ? (
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-[11px] font-semibold text-ink-secondary uppercase tracking-[0.05em] mb-1.5">
              {t("reasonTitle")}
            </div>
            <div role="radiogroup" aria-label={t("reasonTitle")} className="flex flex-wrap gap-1.5">
              {REASON_OPTIONS.map(({ key, labelKey }) => {
                const active = reason === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setReason(key)}
                    className={[
                      "px-3 py-1.5 rounded-pill text-[13px] font-medium border transition-colors duration-fast cursor-pointer",
                      active
                        ? "bg-ink-primary text-white border-ink-primary"
                        : "bg-surface-card text-ink-primary border-line-subtle hover:bg-surface-hover",
                    ].join(" ")}
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
              className="px-3 py-2.5 text-[14px] border border-line-subtle rounded-md bg-surface-card text-ink-primary"
            />
          ) : null}

          <div>
            <div className="text-[11px] font-semibold text-ink-secondary uppercase tracking-[0.05em] mb-1.5">
              {t("photoTitle")}
              <span className="font-normal normal-case tracking-normal ms-1.5">
                · {t("photoHint")}
              </span>
            </div>
            {photoPath ? (
              <div className="flex items-center gap-2.5 px-3 py-2 border border-line-subtle rounded-md">
                <ImageIcon size={16} strokeWidth={1.5} aria-hidden="true" />
                <span className="flex-1 text-[12px] text-ink-secondary font-mono overflow-hidden text-ellipsis whitespace-nowrap">
                  {photoPath}
                </span>
                <button
                  type="button"
                  onClick={() => setPhotoPath(null)}
                  aria-label={t("photoRemove")}
                  className="p-1 text-ink-secondary hover:text-ink-primary transition-colors duration-fast"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <label
                className={[
                  "inline-flex items-center gap-2 px-3.5 py-2 border border-dashed border-line-strong rounded-md text-[13px] text-ink-primary",
                  uploading ? "cursor-wait bg-surface-hover" : "cursor-pointer bg-surface-card hover:bg-surface-hover",
                  "transition-colors duration-fast",
                ].join(" ")}
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
                  className="absolute w-px h-px overflow-hidden"
                  style={{ clipPath: "inset(50%)" }}
                />
              </label>
            )}
            {uploadError ? (
              <p className="mt-1.5 mb-0 text-[12px] text-status-critical">
                {uploadError}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="px-4 py-2.5 rounded-md text-[14px] font-medium text-ink-primary border border-line-subtle bg-surface-card hover:bg-surface-hover disabled:cursor-not-allowed transition-colors duration-fast"
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          disabled={!valid || submitting}
          onClick={() => onAddToBatch(payload())}
          className={[
            "px-4 py-2.5 rounded-md text-[14px] font-semibold border bg-surface-card",
            "transition-colors duration-fast",
            !valid || submitting
              ? "text-ink-secondary border-line-subtle cursor-not-allowed"
              : "text-ink-primary border-ink-primary hover:bg-surface-hover cursor-pointer",
          ].join(" ")}
        >
          {t("addToBatch")}
        </button>
        <button
          type="button"
          disabled={!valid || submitting}
          onClick={() => onCommitNow(payload())}
          className={[
            "px-4.5 py-2.5 rounded-md text-[14px] font-semibold text-white",
            "transition-colors duration-fast",
            !valid || submitting
              ? "bg-line-strong cursor-not-allowed"
              : "bg-ink-primary hover:bg-[#2A2A2A] cursor-pointer",
          ].join(" ")}
        >
          {t("commitNow")}
        </button>
      </div>
    </div>
  );
}
