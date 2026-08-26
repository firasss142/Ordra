"use client";

import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ProductImagePicker } from "./ProductImagePicker";
import {
  AsideCard,
  CONTROL,
  cx,
  FieldShell,
  FormSection,
  ICONS,
  ICON_TONE,
  SELECT,
  SelectShell,
  UnitShell,
} from "./form-chrome";
import type { Permission, Tone } from "./form-chrome";
import type { Role } from "@/types";

interface Market {
  id: string;
  name: string;
}

interface ProductCreateFormProps {
  role: Role;
  markets: Market[];
  defaultMarketId: string;
  locale: string;
  lockedMarketId?: string | null;
  /**
   * Currency symbol of the market being created into (markets.currency).
   * Absent → amounts render bare. Never guessed from the locale: a super
   * admin authors the Libyan catalogue in French, so locale ≠ market.
   */
  currencySymbol?: string;
}

const SECTION_IDS = {
  identity: "product-create-identity",
  costModel: "product-create-cost-model",
  inventory: "product-create-inventory",
} as const;

/* ── bidi ────────────────────────────────────────────────────────────────
   A strong-RTL currency symbol glued to Latin digits reorders its
   neighbours. Isolate the amount and recompose it "digits NBSP symbol" so
   the sign never migrates. Same treatment as ProductEditForm. */
const LRI = "⁦";
const PDI = "⁩";
const NBSP = " ";
const MINUS = "−";

function toNumber(raw: string): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

export function ProductCreateForm({
  markets,
  defaultMarketId,
  locale,
  lockedMarketId,
  currencySymbol,
}: ProductCreateFormProps) {
  const t = useTranslations("products");
  const router = useRouter();

  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [marketId, setMarketId] = useState(lockedMarketId ?? defaultMarketId);
  const [unitCogs, setUnitCogs] = useState("");
  const [packingCost, setPackingCost] = useState("");
  const [processingCost, setProcessingCost] = useState("");
  const [initialStock, setInitialStock] = useState("0");
  const [threshold, setThreshold] = useState("5");
  const [defaultPrice, setDefaultPrice] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roleLabel: Record<Permission, string> = {
    superAdmin: t("editV2.permission.superAdmin"),
    marketManager: t("editV2.permission.marketManager"),
  };

  function money(n: number): string {
    const abs = Math.abs(n).toLocaleString(locale === "ar" ? "ar-LY" : "fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const sign = n < 0 ? MINUS : "";
    const body = currencySymbol
      ? `${LRI}${sign}${abs}${PDI}${NBSP}${currencySymbol}`
      : `${sign}${abs}`;
    return body;
  }

  /* Live unit margin. Delivery is deliberately absent: a product that does
     not exist yet has no deliveries, so there is no observed carrier fee to
     average. Showing a plausible-but-invented one would be worse than
     showing none — the edit form fills it in once real deliveries exist. */
  const margin = useMemo(() => {
    const price = parseFloat(defaultPrice);
    const cogs = parseFloat(unitCogs);
    if (!Number.isFinite(price) || !Number.isFinite(cogs)) return null;
    const packing = toNumber(packingCost);
    const processing = toNumber(processingCost);
    return {
      price,
      cogs,
      packing,
      processing,
      total: price - cogs - packing - processing,
    };
  }, [defaultPrice, unitCogs, packingCost, processingCost]);

  const complete = name.trim() !== "" && Number.isFinite(parseFloat(unitCogs));

  async function handleSubmit() {
    setError(null);
    if (!name.trim()) {
      setError(t("editForm.errors.nameRequired"));
      return;
    }
    const unitCogsNum = parseFloat(unitCogs);
    if (isNaN(unitCogsNum) || unitCogsNum < 0) {
      setError(t("editForm.errors.unitCogsInvalid"));
      return;
    }

    setLoading(true);
    const body: Record<string, unknown> = {
      name: name.trim(),
      unit_cogs: unitCogsNum,
      packing_cost: parseFloat(packingCost) || 0,
      confirmation_processing_cost: parseFloat(processingCost) || 0,
      low_stock_threshold: parseInt(threshold, 10) || 5,
      initial_stock: parseInt(initialStock, 10) || 0,
      market_id: marketId,
    };
    const trimmedSku = sku.trim();
    if (trimmedSku !== "") body.sku = trimmedSku;
    if (defaultPrice.trim() !== "") {
      const dp = parseFloat(defaultPrice);
      if (!isNaN(dp) && dp >= 0) body.default_price = dp;
    }

    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      const msg =
        res.status === 409
          ? t("create.errors.skuConflict")
          : (json.error ?? `Erreur ${res.status}`);
      setError(msg);
      setLoading(false);
      return;
    }

    const json = await res.json();
    const newId = json?.data?.id;

    // Upload the picked image now that the product (and its ID) exists.
    if (newId && image) {
      const imgRes = await fetch(`/api/products/${newId}/image`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data_url: image }),
      });
      if (!imgRes.ok) {
        // Product was created; only the image failed. Surface it but still
        // land on the detail page so the user can retry from the edit form.
        setError(t("image.uploadFailed"));
        router.push(`/${locale}/products/${newId}`);
        return;
      }
    }

    if (newId) {
      router.push(`/${locale}/products/${newId}`);
    } else {
      router.push(`/${locale}/products`);
    }
  }

  const sections: {
    id: string;
    navLabel: string;
    title: string;
    icon: (s: number) => React.ReactNode;
    tone: Tone;
    permission: Permission;
    hint: string;
    body: React.ReactNode;
  }[] = [
    {
      id: SECTION_IDS.identity,
      navLabel: t("create.sections.identity"),
      title: t("create.sections.identity"),
      icon: ICONS.identity,
      tone: "brand",
      permission: "superAdmin",
      hint: t("createV2.hints.identity"),
      body: (
        <>
          <FieldShell id="product-name" label={t("editForm.fields.name")} required>
            {(a) => (
              <input
                {...a}
                aria-label={t("editForm.fields.name")}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("createV2.namePlaceholder")}
                className={CONTROL}
              />
            )}
          </FieldShell>

          <FieldShell
            id="product-sku"
            label={t("create.fields.sku")}
            hint={t("create.hints.sku")}
          >
            {(a) => (
              <input
                {...a}
                aria-label={t("create.fields.sku")}
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="bv-01"
                className={CONTROL}
              />
            )}
          </FieldShell>

          <ProductImagePicker value={image} onChange={setImage} />

          {markets.length > 1 && !lockedMarketId && (
            <FieldShell
              id="market-select"
              label={t("createV2.fields.market")}
              hint={t("createV2.hintsField.market")}
            >
              {(a) => (
                <SelectShell>
                  <select
                    {...a}
                    value={marketId}
                    onChange={(e) => setMarketId(e.target.value)}
                    className={SELECT}
                  >
                    {markets.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </SelectShell>
              )}
            </FieldShell>
          )}
        </>
      ),
    },
    {
      id: SECTION_IDS.costModel,
      navLabel: t("create.sections.costModel"),
      title: t("create.sections.costModel"),
      icon: ICONS.cost,
      tone: "warn",
      permission: "superAdmin",
      hint: t("createV2.hints.costModel"),
      body: (
        <>
          <FieldShell
            id="unit-cogs"
            label={t("editForm.fields.unitCogs")}
            hint={t("create.hints.unitCogs")}
            required
          >
            {(a) => (
              <UnitShell suffix={currencySymbol}>
                <input
                  {...a}
                  aria-label={t("editForm.fields.unitCogs")}
                  type="number"
                  min="0"
                  step="0.001"
                  value={unitCogs}
                  onChange={(e) => setUnitCogs(e.target.value)}
                  placeholder="0.000"
                  className={CONTROL}
                />
              </UnitShell>
            )}
          </FieldShell>

          <FieldShell
            id="packing-cost"
            label={t("editForm.fields.packingCost")}
            hint={t("create.hints.packingCost")}
          >
            {(a) => (
              <UnitShell suffix={currencySymbol}>
                <input
                  {...a}
                  type="number"
                  min="0"
                  step="0.001"
                  value={packingCost}
                  onChange={(e) => setPackingCost(e.target.value)}
                  placeholder="0.000"
                  className={CONTROL}
                />
              </UnitShell>
            )}
          </FieldShell>

          <FieldShell
            id="processing-cost"
            label={t("editForm.fields.processingCost")}
            hint={t("create.hints.processingCost")}
          >
            {(a) => (
              <UnitShell suffix={currencySymbol}>
                <input
                  {...a}
                  type="number"
                  min="0"
                  step="0.001"
                  value={processingCost}
                  onChange={(e) => setProcessingCost(e.target.value)}
                  placeholder="0.000"
                  className={CONTROL}
                />
              </UnitShell>
            )}
          </FieldShell>

          <FieldShell id="default-price" label={t("editForm.fields.defaultPrice")}>
            {(a) => (
              <UnitShell suffix={currencySymbol}>
                <input
                  {...a}
                  type="number"
                  min="0"
                  step="0.001"
                  value={defaultPrice}
                  onChange={(e) => setDefaultPrice(e.target.value)}
                  placeholder="0.000"
                  className={CONTROL}
                />
              </UnitShell>
            )}
          </FieldShell>
        </>
      ),
    },
    {
      id: SECTION_IDS.inventory,
      navLabel: t("create.sections.inventory"),
      title: t("create.sections.inventory"),
      icon: ICONS.stock,
      tone: "info",
      permission: "superAdmin",
      hint: t("createV2.hints.inventory"),
      body: (
        <>
          <FieldShell
            id="initial-stock"
            label={t("createV2.fields.initialStock")}
            hint={t("createV2.hintsField.initialStock")}
          >
            {(a) => (
              <input
                {...a}
                type="number"
                min="0"
                value={initialStock}
                onChange={(e) => setInitialStock(e.target.value)}
                className={CONTROL}
              />
            )}
          </FieldShell>

          <FieldShell
            id="threshold"
            label={t("editForm.fields.threshold")}
            hint={t("create.hints.threshold")}
          >
            {(a) => (
              <input
                {...a}
                type="number"
                min="0"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className={CONTROL}
              />
            )}
          </FieldShell>
        </>
      ),
    },
  ];

  return (
    <div className="pb-24">
      <header className="mb-[18px]">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.03em] text-ink-primary">
          {t("create.title")}
        </h1>
        <p className="mt-1.5 text-[13.5px] text-ink-secondary">{t("createV2.intro")}</p>
      </header>

      <div className="grid items-start gap-[22px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="overflow-hidden rounded-card border border-line-subtle bg-surface-card shadow-hover-row">
          <nav
            aria-label={t("createV2.nav.label")}
            className="flex gap-0.5 overflow-x-auto border-b border-line-subtle px-2 pt-1.5"
          >
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="-mb-px inline-flex flex-none items-center gap-2.5 whitespace-nowrap rounded-t-lg border-b-2 border-transparent px-4 py-3 text-[13.5px] font-medium text-ink-secondary transition-colors duration-fast hover:bg-surface-sunken hover:text-ink-primary"
              >
                <span
                  className={cx(
                    "grid h-[25px] w-[25px] flex-none place-items-center rounded-lg",
                    ICON_TONE.neutral,
                  )}
                >
                  {s.icon(13)}
                </span>
                {s.navLabel}
              </a>
            ))}
          </nav>

          {sections.map((s) => (
            <FormSection
              key={s.id}
              id={s.id}
              title={s.title}
              icon={s.icon(15)}
              tone={s.tone}
              permission={s.permission}
              permissionLabel={roleLabel[s.permission]}
              permissionTitle={t("editV2.permission.requiredRole", {
                role: roleLabel[s.permission],
              })}
              hint={s.hint}
            >
              {s.body}
            </FormSection>
          ))}
        </div>

        <aside
          aria-label={t("createV2.asideLabel")}
          className="flex flex-col gap-3.5 xl:sticky xl:top-[74px]"
        >
          <AsideCard
            label={t("editV2.margin.title")}
            icon={ICONS.margin(13)}
            tone="brand"
          >
            {margin ? (
              <div className="mt-4 flex flex-col gap-[11px]">
                {[
                  { label: t("editV2.margin.price"), value: margin.price },
                  { label: t("editV2.margin.cogs"), value: -margin.cogs },
                  { label: t("editV2.margin.packing"), value: -margin.packing },
                  { label: t("editV2.margin.processing"), value: -margin.processing },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex items-baseline gap-2.5 text-[12.5px] text-ink-secondary"
                  >
                    <span>{row.label}</span>
                    <span
                      aria-hidden="true"
                      className="min-w-3 flex-1 -translate-y-[3px] border-b border-dotted border-line-strong"
                    />
                    <span className="font-semibold tabular-nums text-ink-primary">
                      {money(row.value)}
                    </span>
                  </div>
                ))}
                <div className="mt-1 flex items-baseline gap-2.5 border-t border-line-subtle pt-3 text-[13px]">
                  <span className="font-semibold text-ink-primary">
                    {t("editV2.margin.total")}
                  </span>
                  <span
                    aria-hidden="true"
                    className="min-w-3 flex-1 -translate-y-[3px] border-b border-dotted border-line-strong"
                  />
                  <span
                    className={cx(
                      "text-[15px] font-bold tabular-nums",
                      margin.total >= 0 ? "text-prod-brand" : "text-status-critical",
                    )}
                  >
                    {money(margin.total)}
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] leading-normal text-ink-muted">
                  {t("editV2.margin.noDeliveryFee")}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-[12.5px] leading-relaxed text-ink-secondary">
                {t("createV2.margin.empty")}
              </p>
            )}
          </AsideCard>

          <AsideCard
            label={t("createV2.next.title")}
            icon={ICONS.agent(13)}
            tone="neutral"
          >
            <p className="mt-3 text-[12.5px] leading-relaxed text-ink-secondary">
              {t("createV2.next.body")}
            </p>
          </AsideCard>
        </aside>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-[13px] text-status-critical">
          {error}
        </p>
      )}

      <div
        role="group"
        aria-label={t("createV2.savebar.label")}
        className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t border-line bg-surface-card/95 px-6 py-3 shadow-panel backdrop-blur"
      >
        <span
          className={cx(
            "me-auto flex items-center gap-2 text-[12.5px]",
            complete ? "font-semibold text-prod-brand" : "text-ink-secondary",
          )}
        >
          {complete ? ICONS.info(14) : ICONS.warning(14)}
          {complete ? t("createV2.savebar.ready") : t("createV2.savebar.incomplete")}
        </span>
        <button
          type="button"
          onClick={() => router.push(`/${locale}/products`)}
          disabled={loading}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-line bg-surface-card px-4 text-[13.5px] font-medium text-ink-primary transition-colors duration-fast hover:border-line-strong hover:bg-surface-sunken disabled:cursor-not-allowed disabled:text-ink-muted"
        >
          {t("create.cancel")}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-prod-brand bg-prod-brand px-4 text-[13.5px] font-semibold text-white shadow-hover-row transition-colors duration-fast hover:border-prod-brand-hover hover:bg-prod-brand-hover disabled:cursor-not-allowed disabled:border-line-subtle disabled:bg-surface-sunken disabled:text-ink-muted disabled:shadow-none"
        >
          {ICONS.save(14)}
          {loading ? t("createV2.creating") : t("create.submit")}
        </button>
      </div>
    </div>
  );
}
