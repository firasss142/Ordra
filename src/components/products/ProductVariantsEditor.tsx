"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { CONTROL, cx } from "./form-chrome";

/**
 * Authoring for the two variant axes.
 *
 * WHY THIS SCREEN EXISTS. `product_variants` has been in the schema since the
 * first migration and has had working POST/PATCH routes for months — that no UI
 * ever called. With no way to create a size, the catalogue grew three separate
 * products for one boxing dummy (صغير / متوسط / كبير at three costs and three
 * prices), and `carrier-warehouse.ts` already carries a warning that carrier
 * matching must never go by name because of it.
 *
 * THE TWO AXES STAY APART, visually and in the payload:
 *   · attribute — a different object on the shelf. Carries its own stock, cost
 *     and SKU. Adding a fourth size adds one row.
 *   · pack      — a way of selling the same object. Carries no stock; it
 *     consumes `quantity` units of the size chosen. Adding a tier adds one row.
 * Mixing them in one list is what made sizes look like products in the first
 * place, so they are rendered under separate headings with their own add
 * buttons and their own fields.
 *
 * STOCK IS READ-ONLY HERE, deliberately. It has exactly five entry points and
 * every one writes an `inventory_log` row; an editable field on this form would
 * be a sixth, leaving a balance with nothing to explain it in a ledger that is
 * append-only by trigger. The number is shown because it is the thing you want
 * to see before retiring a size — and the caption says where to change it.
 */

export type VariantKind = "attribute" | "pack";

export interface EditorVariant {
  id: string;
  kind: VariantKind;
  label: string;
  sku: string | null;
  quantity: number;
  unit_cogs: number;
  display_price: number;
  current_stock: number;
  damaged_return_count: number;
  is_active: boolean;
}

interface Props {
  productId: string;
  variants: EditorVariant[];
  /** markets.currency symbol. Absent → amounts render bare. */
  currencySymbol?: string;
  /** Called after any successful write so the page can refetch. */
  onChanged: () => void;
}

type Draft = {
  kind: VariantKind;
  label: string;
  sku: string;
  quantity: string;
  unit_cogs: string;
  display_price: string;
};

function emptyDraft(kind: VariantKind): Draft {
  return {
    kind,
    label: "",
    sku: "",
    quantity: kind === "pack" ? "2" : "1",
    unit_cogs: "",
    display_price: "",
  };
}

function toNumber(raw: string): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

const LABEL_CLS = "text-[11.5px] font-medium text-ink-secondary";
const ROW_CLS =
  "flex flex-col gap-3 rounded-xl border border-line-subtle bg-surface-card p-3 " +
  "sm:flex-row sm:items-end sm:gap-2";

export function ProductVariantsEditor({
  productId,
  variants,
  currencySymbol,
  onChanged,
}: Props) {
  void currencySymbol; // rendered by the parent's money chrome, not here
  const t = useTranslations("products.editV2.variantsEditor");

  const [draft, setDraft] = useState<Draft | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<EditorVariant>>>({});
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const attributes = variants.filter((v) => v.kind === "attribute");
  const packs = variants.filter((v) => v.kind === "pack");

  /**
   * One place for every write. The server's own message is surfaced verbatim
   * when it sends one — "SKU already in use" tells the author what to do;
   * a generic failure notice does not, and this form's most likely error is
   * exactly that shared SKU namespace.
   */
  async function send(url: string, init: RequestInit): Promise<unknown | null> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...init,
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!res.ok) {
        setError(body?.error ?? t("errors.generic"));
        return null;
      }
      onChanged();
      return body;
    } catch {
      setError(t("errors.generic"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createVariant() {
    if (!draft) return;
    if (draft.label.trim() === "") {
      setError(t("errors.labelRequired"));
      return;
    }
    const price = toNumber(draft.display_price);
    if (price <= 0) {
      setError(t("errors.priceRequired"));
      return;
    }
    const payload: Record<string, unknown> = {
      kind: draft.kind,
      label: draft.label.trim(),
      sku: draft.sku.trim() === "" ? null : draft.sku.trim(),
      display_price: price,
      unit_cogs: toNumber(draft.unit_cogs),
    };
    // A size is one unit by definition; only a tier carries a multiplier.
    if (draft.kind === "pack") payload.quantity = Math.max(1, toNumber(draft.quantity));

    const ok = await send(`/api/products/${productId}/variants`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (ok) setDraft(null);
  }

  async function saveVariant(v: EditorVariant) {
    const patch = edits[v.id];
    if (!patch || Object.keys(patch).length === 0) return;
    const ok = await send(`/api/products/${productId}/variants/${v.id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    if (ok) setEdits((prev) => ({ ...prev, [v.id]: {} }));
  }

  async function deleteVariant(v: EditorVariant) {
    const body = (await send(`/api/products/${productId}/variants/${v.id}`, {
      method: "DELETE",
    })) as { deleted?: boolean; retired?: boolean } | null;
    setPendingDelete(null);
    if (!body) return;
    // Retired is not deleted. Saying "deleted" and then rendering the row again,
    // greyed out, is how an author concludes the screen is broken.
    setNotice(body.retired ? t("retired.done") : t("deleted"));
  }

  function field(v: EditorVariant, key: keyof EditorVariant): string | number {
    const patched = edits[v.id]?.[key];
    if (patched !== undefined) return patched as string | number;
    const value = v[key];
    return value === null ? "" : (value as string | number);
  }

  function setField(id: string, key: keyof EditorVariant, value: string | number) {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
  }

  function renderRow(v: EditorVariant) {
    const dirty = Object.keys(edits[v.id] ?? {}).length > 0;
    return (
      <div
        key={v.id}
        role="group"
        // Named by the variant itself, so a screen reader (and a test) can tell
        // "Grand" apart from "Petit" without counting rows.
        aria-label={v.label}
        className={cx(ROW_CLS, !v.is_active && "opacity-60")}
      >
        <div className="flex-1">
          <label className={LABEL_CLS} htmlFor={`v-label-${v.id}`}>
            {t("fields.label")}
          </label>
          <input
            id={`v-label-${v.id}`}
            dir="auto"
            className={cx(CONTROL, "mt-1 text-start")}
            value={String(field(v, "label"))}
            onChange={(e) => setField(v.id, "label", e.target.value)}
          />
        </div>

        {v.kind === "attribute" && (
          <div className="w-full sm:w-[136px]">
            <label className={LABEL_CLS} htmlFor={`v-sku-${v.id}`}>
              {t("fields.sku")}
            </label>
            <input
              id={`v-sku-${v.id}`}
                dir="auto"
              className={cx(CONTROL, "mt-1 text-start")}
              value={String(field(v, "sku"))}
              onChange={(e) => setField(v.id, "sku", e.target.value)}
            />
          </div>
        )}

        {v.kind === "pack" && (
          <div className="w-full sm:w-[104px]">
            <label className={LABEL_CLS} htmlFor={`v-qty-${v.id}`}>
              {t("fields.quantity")}
            </label>
            <input
              id={`v-qty-${v.id}`}
                type="number"
              min={1}
              className={cx(CONTROL, "mt-1")}
              value={String(field(v, "quantity"))}
              onChange={(e) => setField(v.id, "quantity", toNumber(e.target.value))}
            />
          </div>
        )}

        {v.kind === "attribute" && (
          <div className="w-full sm:w-[112px]">
            <label className={LABEL_CLS} htmlFor={`v-cogs-${v.id}`}>
              {t("fields.unitCogs")}
            </label>
            <input
              id={`v-cogs-${v.id}`}
                type="number"
              min={0}
              step="0.001"
              className={cx(CONTROL, "mt-1")}
              value={String(field(v, "unit_cogs"))}
              onChange={(e) => setField(v.id, "unit_cogs", toNumber(e.target.value))}
            />
          </div>
        )}

        <div className="w-full sm:w-[112px]">
          <label className={LABEL_CLS} htmlFor={`v-price-${v.id}`}>
            {t("fields.displayPrice")}
          </label>
          <input
            id={`v-price-${v.id}`}
            type="number"
            min={0}
            step="0.001"
            className={cx(CONTROL, "mt-1")}
            value={String(field(v, "display_price"))}
            onChange={(e) => setField(v.id, "display_price", toNumber(e.target.value))}
          />
        </div>

        {/* Read-only on purpose — see the file header. */}
        {v.kind === "attribute" && (
          <div className="w-full sm:w-[88px]">
            <span className={LABEL_CLS}>{t("fields.stock")}</span>
            <p
              className="mt-1 rounded-xl border border-line-subtle bg-surface-sunken px-3.5 py-2.5
                         text-[13.5px] font-semibold tabular-nums text-ink-primary"
            >
              {v.current_stock}
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 pb-0.5">
          {!v.is_active && (
            <span className="rounded-md bg-surface-sunken px-2 py-1 text-[11px] text-ink-muted">
              {t("retired.badge")}
            </span>
          )}
          <button
            type="button"
            disabled={!dirty || busy}
            onClick={() => void saveVariant(v)}
            className="rounded-lg bg-prod-brand px-3 py-2 text-[12.5px] font-semibold text-white
                       disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("actions.save")}
          </button>
          {pendingDelete === v.id ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void deleteVariant(v)}
              className="rounded-lg bg-status-critical px-3 py-2 text-[12.5px] font-semibold text-white"
            >
              {t("actions.confirmDelete")}
            </button>
          ) : (
            <button
              type="button"
              data-action="delete"
              disabled={busy}
              onClick={() => setPendingDelete(v.id)}
              className="rounded-lg border border-line px-3 py-2 text-[12.5px] text-ink-secondary"
            >
              {t("actions.delete")}
            </button>
          )}
        </div>
      </div>
    );
  }

  function renderDraft() {
    if (!draft) return null;
    const isPack = draft.kind === "pack";
    return (
      <div
        role="group"
        aria-label={isPack ? t("addPack") : t("addAttribute")}
        className={cx(ROW_CLS, "border-prod-brand/40 bg-prod-brand-soft/30")}
      >
        <div className="flex-1">
          <label className={LABEL_CLS} htmlFor="v-new-label">
            {t("fields.label")}
          </label>
          <input
            id="v-new-label"
            dir="auto"
            placeholder={t("fields.labelPlaceholder")}
            className={cx(CONTROL, "mt-1 text-start")}
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          />
        </div>

        {!isPack && (
          <div className="w-full sm:w-[136px]">
            <label className={LABEL_CLS} htmlFor="v-new-sku">
              {t("fields.sku")}
            </label>
            <input
              id="v-new-sku"
              dir="auto"
              placeholder={t("fields.skuPlaceholder")}
              className={cx(CONTROL, "mt-1 text-start")}
              value={draft.sku}
              onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
            />
          </div>
        )}

        {isPack && (
          <div className="w-full sm:w-[104px]">
            <label className={LABEL_CLS} htmlFor="v-new-qty">
              {t("fields.quantity")}
            </label>
            <input
              id="v-new-qty"
              type="number"
              min={1}
              className={cx(CONTROL, "mt-1")}
              value={draft.quantity}
              onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
            />
          </div>
        )}

        {!isPack && (
          <div className="w-full sm:w-[112px]">
            <label className={LABEL_CLS} htmlFor="v-new-cogs">
              {t("fields.unitCogs")}
            </label>
            <input
              id="v-new-cogs"
              type="number"
              min={0}
              step="0.001"
              className={cx(CONTROL, "mt-1")}
              value={draft.unit_cogs}
              onChange={(e) => setDraft({ ...draft, unit_cogs: e.target.value })}
            />
          </div>
        )}

        <div className="w-full sm:w-[112px]">
          <label className={LABEL_CLS} htmlFor="v-new-price">
            {t("fields.displayPrice")}
          </label>
          <input
            id="v-new-price"
            type="number"
            min={0}
            step="0.001"
            className={cx(CONTROL, "mt-1")}
            value={draft.display_price}
            onChange={(e) => setDraft({ ...draft, display_price: e.target.value })}
          />
        </div>

        <div className="flex items-center gap-2 pb-0.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => void createVariant()}
            className="rounded-lg bg-prod-brand px-3 py-2 text-[12.5px] font-semibold text-white
                       disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("actions.save")}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(null);
              setError(null);
            }}
            className="rounded-lg border border-line px-3 py-2 text-[12.5px] text-ink-secondary"
          >
            {t("actions.cancel")}
          </button>
        </div>
      </div>
    );
  }

  const addButton = (kind: VariantKind) => (
    <button
      type="button"
      onClick={() => {
        setDraft(emptyDraft(kind));
        setError(null);
        setNotice(null);
      }}
      className="self-start rounded-lg border border-dashed border-line-strong px-3 py-2
                 text-[12.5px] font-medium text-ink-secondary hover:border-prod-brand
                 hover:text-prod-brand"
    >
      {kind === "attribute" ? t("addAttribute") : t("addPack")}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11.5px] leading-normal text-ink-muted">{t("hint")}</p>

      {variants.length === 0 && !draft && (
        <p className="text-[12.5px] text-ink-muted">{t("empty")}</p>
      )}

      <section className="flex flex-col gap-2">
        <div>
          <p className="text-[12.5px] font-semibold text-ink-primary">
            {t("axis.attribute")}
          </p>
          <p className="text-[11.5px] text-ink-muted">{t("axis.attributeHint")}</p>
        </div>
        {attributes.map(renderRow)}
        {draft?.kind === "attribute" ? renderDraft() : addButton("attribute")}
        <p className="text-[11px] leading-normal text-ink-muted">{t("stockReadOnly")}</p>
      </section>

      <section className="flex flex-col gap-2">
        <div>
          <p className="text-[12.5px] font-semibold text-ink-primary">{t("axis.pack")}</p>
          <p className="text-[11.5px] text-ink-muted">{t("axis.packHint")}</p>
        </div>
        {packs.map(renderRow)}
        {draft?.kind === "pack" ? renderDraft() : addButton("pack")}
      </section>

      {error && (
        <p role="alert" className="text-[12.5px] text-status-critical">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-[12.5px] text-ink-secondary">
          {notice}
        </p>
      )}
    </div>
  );
}
