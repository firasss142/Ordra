"use client";

/**
 * « Convertir en commande » — the prospect becomes an order.
 *
 * This sheet handles money, so it is stricter than the modal it replaces.
 * That one prefilled 0 when the product carried no price and let the order
 * through anyway: four Tunisian orders were confirmed at 0.000 on 2026-05-05
 * and never appeared in a P&L, because revenue reads orders.total_price only.
 *
 * Here the total must be positive before the button will fire, and the price
 * is shown as what it is — the amount the customer hands over at the door.
 *
 * Design: prototypes/prospects-manager-v1.html.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, ShoppingCart } from "lucide-react";
import { moneyText } from "../ui";
import { DARK, Field, INPUT, OUTLINE, Sheet } from "../console/ui";

export interface ConvertProduct {
  id: string;
  name: string;
  default_price?: number | string | null;
}

export interface ConvertVariant {
  id: string;
  label: string;
  display_price?: number | string | null;
  quantity?: number | null;
}

export interface ConvertSheetProps {
  customerName: string;
  /** What the prospect said they wanted, when they said anything. */
  productNote: string | null;
  products: ConvertProduct[];
  variants: ConvertVariant[];
  productId: string;
  onProductId: (id: string) => void;
  variantId: string;
  onVariantId: (id: string) => void;
  busy: boolean;
  error: string | null;
  onConfirm: (input: { quantity: number; unitPrice: number; totalPrice: number }) => void;
  onClose: () => void;
  marketCode: "ly" | "tn";
  locale: string;
}

/** Postgres numerics arrive as strings over JSON. Treat them as numbers once. */
function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function ConvertSheet(props: ConvertSheetProps) {
  const {
    customerName, productNote, products, variants, productId, onProductId,
    variantId, onVariantId, busy, error, onConfirm, onClose, marketCode, locale,
  } = props;

  const t = useTranslations("prospects.console.cv");
  const tc = useTranslations("prospects.console");

  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState<number | null>(null);
  const [totalPrice, setTotalPrice] = useState<number | null>(null);
  const [totalTouched, setTotalTouched] = useState(false);

  const product = useMemo(() => products.find((p) => p.id === productId), [products, productId]);
  const variant = useMemo(() => variants.find((v) => v.id === variantId), [variants, variantId]);

  /**
   * The catalogue price for what is currently selected, or null when the
   * product genuinely has none. Null is not zero: one is "we do not know",
   * the other is "it is free", and conflating them is what shipped those
   * four orders.
   */
  const catalogue = useMemo(
    () => num(variant?.display_price) ?? num(product?.default_price),
    [variant, product],
  );

  // Follow the catalogue while the manager has not overridden the total.
  useEffect(() => {
    setUnitPrice(catalogue);
    if (!totalTouched) {
      setTotalPrice(catalogue === null ? null : round(catalogue * quantity));
    }
  }, [catalogue, quantity, totalTouched]);

  const missingPrice = catalogue === null;
  const total = totalPrice ?? 0;
  const canSubmit = Boolean(productId) && quantity > 0 && total > 0;

  return (
    <Sheet
      title={t("t")}
      sub={t("sub", { name: customerName })}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={`ms-auto h-11 px-4 text-[14px] ${OUTLINE}`}>
            {tc("panel.cancel")}
          </button>
          <button
            type="button"
            disabled={busy || !canSubmit}
            onClick={() => onConfirm({ quantity, unitPrice: unitPrice ?? 0, totalPrice: total })}
            className={`h-11 min-w-[180px] px-4 text-[14px] ${DARK}`}
          >
            <ShoppingCart size={16} aria-hidden />
            {t("go")}
          </button>
        </>
      }
    >
      {error ? (
        <p role="alert" className="m-0 rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2.5 text-[13.5px] text-[#B91C1C]">
          {error}
        </p>
      ) : null}

      {productNote ? (
        <p className="m-0 rounded-lg bg-[#F3F4F6] px-3 py-2.5 text-[13px] text-[#374151] [unicode-bidi:plaintext]">
          <span className="font-semibold">{tc("panel.origin")} · </span>
          {productNote}
        </p>
      ) : null}

      <Field label={t("product")}>
        <select
          value={productId}
          onChange={(e) => { onProductId(e.target.value); onVariantId(""); setTotalTouched(false); }}
          className={INPUT}
        >
          <option value="">—</option>
          {products.map((p) => {
            const price = num(p.default_price);
            return (
              <option key={p.id} value={p.id}>
                {p.name}{price !== null ? ` · ${moneyText(price, marketCode, locale)}` : ""}
              </option>
            );
          })}
        </select>
      </Field>

      {variants.length > 0 ? (
        <Field label={t("variant")}>
          <select
            value={variantId}
            onChange={(e) => { onVariantId(e.target.value); setTotalTouched(false); }}
            className={INPUT}
          >
            <option value="">—</option>
            {variants.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </Field>
      ) : null}

      {/* A product with no catalogue price is the case that caused the damage:
          the old modal silently used 0. Now it is said out loud. */}
      {productId && missingPrice ? (
        <p className="m-0 flex items-start gap-2 rounded-lg border border-[#FBBF24] bg-[#FFFBEB] px-3 py-2.5 text-[13px] text-[#92400E]">
          <AlertTriangle size={16} aria-hidden className="mt-px shrink-0" />
          {t("noPrice")}
        </p>
      ) : null}

      <div className="grid grid-cols-3 gap-3">
        <Field label={t("quantity")}>
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => { setQuantity(Math.max(1, Number(e.target.value) || 1)); setTotalTouched(false); }}
            className={INPUT}
          />
        </Field>
        <Field label={t("unitPrice")}>
          <input
            type="number"
            min={0}
            step="0.001"
            value={unitPrice ?? ""}
            onChange={(e) => {
              const v = e.target.value === "" ? null : Number(e.target.value);
              setUnitPrice(v);
              if (!totalTouched) setTotalPrice(v === null ? null : round(v * quantity));
            }}
            className={INPUT}
          />
        </Field>
        <Field label={t("totalPrice")}>
          <input
            type="number"
            min={0}
            step="0.001"
            value={totalPrice ?? ""}
            onChange={(e) => {
              setTotalTouched(true);
              setTotalPrice(e.target.value === "" ? null : Number(e.target.value));
            }}
            className={`${INPUT} ${total <= 0 ? "border-[#FCA5A5]" : ""}`}
          />
        </Field>
      </div>

      {/* What the customer actually pays at the door. */}
      <p className="m-0 flex items-baseline justify-between gap-2 rounded-lg bg-[#F9FAFB] px-3.5 py-3">
        <span className="text-[13px] text-[#6B7280]">{t("cod")}</span>
        <b className={`text-[20px] font-bold tabular-nums ${total > 0 ? "text-[#111827]" : "text-[#B91C1C]"}`}>
          {moneyText(total, marketCode, locale)}
        </b>
      </p>

      {total <= 0 ? (
        <p className="m-0 text-[12.5px] text-[#B91C1C]">{t("zero")}</p>
      ) : null}
    </Sheet>
  );
}

/** Three decimals, the precision `orders.total_price` stores. */
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
