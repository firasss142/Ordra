"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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
  /**
   * Average carrier fee actually observed on this product's deliveries.
   * MUST come from the server (lib/calculations) — it is the mean of the
   * carriers' own delivery_fee over the real deliveries, which no client can
   * derive. Absent → the delivery line of the live-margin card is hidden
   * rather than filled with a plausible-looking wrong number.
   */
  avgDeliveryFee?: number;
  /**
   * Currency symbol for this product's market (markets.currency). Absent →
   * amounts render bare. Never guessed from the locale: a super admin reads
   * the Libyan catalogue in French, so locale does not imply market.
   */
  currencySymbol?: string;
  /** Read-only current stock. Absent → the field is not rendered. */
  currentStock?: number;
  /** Orders still with the carrier. Absent → the Impact card omits the count. */
  inFlightCount?: number;
}

/* ── bidi ────────────────────────────────────────────────────────────────
   A strong-RTL currency symbol glued to Latin digits reorders its
   neighbours, and Intl emits RLM marks of its own. Isolate the amount and
   recompose it "digits NBSP symbol" so the sign never migrates. */
const LRI = "⁦";
const PDI = "⁩";
const NBSP = " ";
const MINUS = "−";
const BIDI_CTRL = /[‎‏؜]/g;

const SECTION_IDS = {
  identity: "product-edit-identity",
  agentSheet: "product-edit-agent-sheet",
  composition: "product-edit-composition",
  costModel: "product-edit-cost-model",
  stockStatus: "product-edit-stock-status",
} as const;

type Tone = "brand" | "info" | "warn" | "neutral";
type Permission = "superAdmin" | "marketManager";

const ICON_TONE: Record<Tone, string> = {
  brand: "bg-prod-brand-soft text-prod-brand",
  info: "bg-prod-info-bg text-status-action",
  warn: "bg-status-warningBg text-hue-amber-ink",
  neutral: "bg-prod-neutral-bg text-ink-secondary",
};

const CHIP_TONE: Record<Permission, string> = {
  superAdmin: "bg-status-warningBg text-hue-amber-ink",
  marketManager: "bg-prod-info-bg text-status-action",
};

const BRIEF_PREVIEW_TONE: Record<AgentBriefTone, string> = {
  info: "bg-prod-info-bg text-status-action",
  warning: "bg-status-warningBg text-hue-amber-ink",
  critical: "bg-status-criticalBg text-status-critical",
};

/* Field chrome — 12px radius, green focus ring, logical padding throughout. */
const CONTROL =
  "w-full rounded-xl border border-line bg-surface-card px-3.5 py-2.5 text-[13.5px] text-ink-primary " +
  "transition-colors duration-fast placeholder:text-ink-muted hover:border-line-strong " +
  "focus:border-prod-brand focus:outline-none focus:ring-[3px] focus:ring-prod-brand-soft " +
  "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-muted";
const TEXTAREA = `${CONTROL} min-h-[76px] resize-y leading-relaxed`;
const SELECT = `${CONTROL} appearance-none pe-9`;

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

function numberOrEmpty(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return String(n);
}

function toNumber(raw: string): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

/* ── icônes ─────────────────────────────────────────────────────────── */

function Svg({ size, children }: { size: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const ICONS = {
  identity: (s: number) => (
    <Svg size={s}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </Svg>
  ),
  sheet: (s: number) => (
    <Svg size={s}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
    </Svg>
  ),
  composition: (s: number) => (
    <Svg size={s}>
      <path d="M21 8v8l-9 5-9-5V8l9-5 9 5Z" />
      <path d="m3 8 9 5 9-5" />
    </Svg>
  ),
  cost: (s: number) => (
    <Svg size={s}>
      <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </Svg>
  ),
  stock: (s: number) => (
    <Svg size={s}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  ),
  margin: (s: number) => (
    <Svg size={s}>
      <path d="M3 3v18h18" />
      <path d="m7 15 4-4 3 3 5-6" />
    </Svg>
  ),
  agent: (s: number) => (
    <Svg size={s}>
      <circle cx="12" cy="8" r="4" />
      <path d="M18 20a6 6 0 0 0-12 0" />
    </Svg>
  ),
  warning: (s: number) => (
    <Svg size={s}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </Svg>
  ),
  info: (s: number) => (
    <Svg size={s}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-5M12 8h.01" />
    </Svg>
  ),
  save: (s: number) => (
    <Svg size={s}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8M7 3v5h8" />
    </Svg>
  ),
  chevron: (s: number) => (
    <Svg size={s}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  ),
};

/* ── primitives de formulaire ───────────────────────────────────────── */

function FieldShell({
  id,
  label,
  hint,
  required,
  footer,
  children,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  required?: boolean;
  footer?: React.ReactNode;
  children: (a: { id: string; "aria-describedby"?: string }) => React.ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-[7px]">
      <label htmlFor={id} className="text-[12.5px] font-semibold text-ink-primary">
        {label}
        {required && (
          <span aria-hidden="true" className="ms-1 text-status-critical">
            *
          </span>
        )}
      </label>
      {children({ id, "aria-describedby": hintId })}
      {footer}
      {hint && (
        <p id={hintId} className="text-[11.5px] leading-normal text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Native select with a token-coloured chevron instead of the OS triangle. */
function SelectShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-ink-secondary">
        {ICONS.chevron(16)}
      </span>
    </div>
  );
}

/** Number input carrying its currency on the inline-end edge. */
function UnitShell({
  suffix,
  children,
}: {
  suffix?: string;
  children: React.ReactNode;
}) {
  if (!suffix) return <>{children}</>;
  return (
    <div className="relative">
      {children}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 end-3.5 flex items-center text-xs font-medium text-ink-muted"
      >
        {suffix}
      </span>
    </div>
  );
}

function FormSection({
  id,
  title,
  icon,
  tone,
  permission,
  permissionLabel,
  permissionTitle,
  hint,
  children,
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
  tone: Tone;
  permission: Permission;
  permissionLabel: string;
  permissionTitle: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 border-b border-line-subtle px-6 py-[22px] last:border-b-0">
      <div className="flex items-center gap-3">
        <span
          className={cx(
            "grid h-[30px] w-[30px] flex-none place-items-center rounded-card",
            ICON_TONE[tone],
          )}
        >
          {icon}
        </span>
        <h3 className="text-[15.5px] font-semibold tracking-[-0.014em] text-ink-primary">
          {title}
        </h3>
        <span
          title={permissionTitle}
          className={cx(
            "ms-auto inline-flex h-6 flex-none items-center rounded-lg px-2.5 text-[11.5px] font-semibold",
            CHIP_TONE[permission],
          )}
        >
          {permissionLabel}
        </span>
      </div>
      <p className="mb-[17px] ms-[42px] mt-1 text-[12.5px] leading-relaxed text-ink-secondary">
        {hint}
      </p>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function AsideCard({
  label,
  icon,
  tone,
  className,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  tone: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx(
        "rounded-card border border-line-subtle bg-surface-card px-5 py-[17px] shadow-hover-row",
        className,
      )}
    >
      <h4 className="flex items-center gap-2.5 text-[11.5px] font-bold uppercase tracking-[0.09em] text-ink-secondary">
        <span
          className={cx(
            "grid h-[25px] w-[25px] flex-none place-items-center rounded-lg",
            ICON_TONE[tone],
          )}
        >
          {icon}
        </span>
        {label}
      </h4>
      {children}
    </div>
  );
}

/* ── formulaire ─────────────────────────────────────────────────────── */

export function ProductEditForm({
  product,
  locale,
  canManageCosts,
  variants,
  crossSellOptions,
  avgDeliveryFee,
  currencySymbol,
  currentStock,
  inFlightCount,
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
  const [processingCost, setProcessingCost] = useState(
    numberOrEmpty(product.confirmation_processing_cost),
  );
  const [defaultPrice, setDefaultPrice] = useState(numberOrEmpty(product.default_price));
  const [threshold, setThreshold] = useState(numberOrEmpty(product.low_stock_threshold));
  const [isActive, setIsActive] = useState(product.is_active);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ── état « modifié » ──────────────────────────────────────────────
     The save bar stays asleep until something actually changed, so a stray
     click cannot fire three writes that all set a column to its own value.
     The snapshot covers every field the two routes carry, image included. */
  const snapshot = JSON.stringify([
    name,
    sku,
    description,
    agentBrief,
    agentBriefTone,
    agentNotes,
    variants.map((v) => variantNotes[v.id] ?? ""),
    composition,
    contraindications,
    usage,
    crossSell,
    floorPrice,
    image,
    newImageDataUrl,
    unitCogs,
    packingCost,
    processingCost,
    defaultPrice,
    threshold,
    isActive,
  ]);
  const pristine = useRef<string | null>(null);
  if (pristine.current === null) pristine.current = snapshot;
  const dirty = snapshot !== pristine.current;

  /* ── formatage ─────────────────────────────────────────────────────
     Local and deliberately small: lib/format.ts owns the console-wide money
     spine and belongs to another lot. Only the numeral system follows the
     locale; the currency symbol is supplied by the caller, never derived. */
  const numFmt = useMemo(
    () =>
      new Intl.NumberFormat(locale === "ar" ? "ar-LY" : "fr-TN", {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      }),
    [locale],
  );
  const pctFmt = useMemo(
    () =>
      new Intl.NumberFormat(locale === "ar" ? "ar-LY" : "fr-TN", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    [locale],
  );
  function money(n: number): string {
    const digits = numFmt.format(Math.abs(n)).replace(BIDI_CTRL, "");
    const sign = n < 0 ? MINUS : "";
    const symbol = currencySymbol ? NBSP + currencySymbol : "";
    return `${LRI}${sign}${digits}${symbol}${PDI}`;
  }

  /* ── marge unitaire en direct ──────────────────────────────────────
     Arithmetic on what the user is typing, which no server round-trip can
     provide. The one figure a client cannot know — the real average carrier
     fee — arrives as a prop from lib/calculations and is simply subtracted. */
  const livePrice = toNumber(defaultPrice);
  const marginLines = [
    { key: "cogs", label: t("editV2.margin.cogs"), value: toNumber(unitCogs) },
    { key: "packing", label: t("editV2.margin.packing"), value: toNumber(packingCost) },
    { key: "processing", label: t("editV2.margin.processing"), value: toNumber(processingCost) },
    ...(avgDeliveryFee !== undefined
      ? [{ key: "delivery", label: t("editV2.margin.delivery"), value: avgDeliveryFee }]
      : []),
  ];
  const unitMargin = marginLines.reduce((acc, l) => acc - l.value, livePrice);
  const marginPct = livePrice > 0 ? (unitMargin / livePrice) * 100 : null;

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
        const msg =
          res.status === 409
            ? t("editForm.errors.skuConflict")
            : (json.error ?? `Erreur ${res.status}`);
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

  /* ── sections ──────────────────────────────────────────────────────
     Anchors with scroll-spy, never tabs: hiding half of a long form is how
     a required field goes unnoticed until the server rejects the save. */
  const roleLabel: Record<Permission, string> = {
    superAdmin: t("editV2.permission.superAdmin"),
    marketManager: t("editV2.permission.marketManager"),
  };

  type SectionDef = {
    id: string;
    navLabel: string;
    title: string;
    icon: (s: number) => React.ReactNode;
    tone: Tone;
    permission: Permission;
    hint: string;
    body: React.ReactNode;
  };

  const sections: SectionDef[] = [];

  if (canManageCosts) {
    sections.push({
      id: SECTION_IDS.identity,
      navLabel: t("create.sections.identity"),
      title: t("create.sections.identity"),
      icon: ICONS.identity,
      tone: "brand",
      permission: "superAdmin",
      hint: t("editV2.hints.identity"),
      body: (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldShell id="edit-name" label={t("editForm.fields.name")} required>
              {(a) => (
                <input
                  {...a}
                  type="text"
                  dir="auto"
                  className={cx(CONTROL, "text-start")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </FieldShell>
            <FieldShell
              id="edit-sku"
              label={t("editForm.fields.sku")}
              hint={t("editForm.hints.sku")}
            >
              {(a) => (
                <input
                  {...a}
                  type="text"
                  className={CONTROL}
                  placeholder="bv-01"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                />
              )}
            </FieldShell>
          </div>
          <ProductImagePicker
            value={image}
            onChange={(dataUrl) => {
              setImage(dataUrl);
              setNewImageDataUrl(dataUrl);
            }}
          />
        </>
      ),
    });
  }

  sections.push({
    id: SECTION_IDS.agentSheet,
    navLabel: t("editForm.agentContent.section"),
    title: t("editForm.agentContent.section"),
    icon: ICONS.sheet,
    tone: "info",
    permission: "marketManager",
    hint: t("editV2.hints.agentSheet"),
    body: (
      <>
        <FieldShell
          id="edit-agent-brief"
          label={t("editForm.agentContent.agentBrief")}
          hint={t("editForm.agentContent.agentBriefHint")}
          footer={
            <div className="flex justify-end text-[11.5px] text-ink-muted">
              <span aria-live="polite" className="tabular-nums">
                {t("editForm.agentContent.charsLeft", {
                  count: AGENT_BRIEF_MAX - agentBrief.length,
                })}
              </span>
            </div>
          }
        >
          {(a) => (
            <input
              {...a}
              type="text"
              dir="auto"
              className={cx(CONTROL, "text-start")}
              value={agentBrief}
              maxLength={AGENT_BRIEF_MAX}
              onChange={(e) => setAgentBrief(e.target.value)}
            />
          )}
        </FieldShell>

        <div className="grid gap-4 sm:grid-cols-2">
          <FieldShell
            id="edit-agent-brief-tone"
            label={t("editForm.agentContent.agentBriefTone")}
          >
            {(a) => (
              <SelectShell>
                <select
                  {...a}
                  className={SELECT}
                  value={agentBriefTone}
                  onChange={(e) => setAgentBriefTone(e.target.value as AgentBriefTone)}
                >
                  <option value="info">{t("editForm.agentContent.toneInfo")}</option>
                  <option value="warning">{t("editForm.agentContent.toneWarning")}</option>
                  <option value="critical">{t("editForm.agentContent.toneCritical")}</option>
                </select>
              </SelectShell>
            )}
          </FieldShell>

          <FieldShell
            id="edit-cross-sell"
            label={t("editForm.agentContent.crossSell")}
            hint={t("editForm.agentContent.crossSellHint")}
          >
            {(a) => (
              <SelectShell>
                <select
                  {...a}
                  className={SELECT}
                  value={crossSell}
                  onChange={(e) => setCrossSell(e.target.value)}
                >
                  <option value="">{t("editForm.agentContent.crossSellNone")}</option>
                  {crossSellOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </SelectShell>
            )}
          </FieldShell>
        </div>

        <FieldShell id="edit-description" label={t("editForm.fields.description")}>
          {(a) => (
            <textarea
              {...a}
              dir="auto"
              className={cx(TEXTAREA, "text-start")}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </FieldShell>

        <FieldShell
          id="edit-agent-notes"
          label={t("editForm.agentContent.agentNotes")}
          hint={t("editForm.agentContent.agentNotesHint")}
        >
          {(a) => (
            <textarea
              {...a}
              dir="auto"
              className={cx(TEXTAREA, "text-start")}
              rows={5}
              value={agentNotes}
              onChange={(e) => setAgentNotes(e.target.value)}
            />
          )}
        </FieldShell>

        {variants.length > 0 && (
          <div className="flex flex-col gap-3 rounded-xl border border-line-subtle bg-surface-sunken p-4">
            <div>
              <p className="text-[12.5px] font-semibold text-ink-primary">
                {t("editV2.variants.title")}
              </p>
              <p className="mt-1 text-[11.5px] leading-normal text-ink-muted">
                {t("editV2.variants.hint")}
              </p>
            </div>
            {variants.map((v) => (
              <FieldShell key={v.id} id={`edit-variant-note-${v.id}`} label={v.label}>
                {(a) => (
                  <input
                    {...a}
                    type="text"
                    dir="auto"
                    className={cx(CONTROL, "text-start")}
                    value={variantNotes[v.id] ?? ""}
                    maxLength={VARIANT_NOTE_MAX}
                    onChange={(e) =>
                      setVariantNotes((prev) => ({ ...prev, [v.id]: e.target.value }))
                    }
                  />
                )}
              </FieldShell>
            ))}
          </div>
        )}
      </>
    ),
  });

  sections.push({
    id: SECTION_IDS.composition,
    navLabel: t("editV2.sections.composition"),
    title: t("editV2.sections.composition"),
    icon: ICONS.composition,
    tone: "neutral",
    permission: "marketManager",
    hint: t("editV2.hints.composition"),
    body: (
      <>
        <FieldShell
          id="edit-composition"
          label={t("editForm.agentContent.composition")}
          hint={t("editForm.agentContent.compositionHint")}
        >
          {(a) => (
            <textarea
              {...a}
              dir="auto"
              className={cx(TEXTAREA, "text-start")}
              rows={2}
              value={composition}
              onChange={(e) => setComposition(e.target.value)}
            />
          )}
        </FieldShell>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldShell
            id="edit-usage"
            label={t("editForm.agentContent.usage")}
            hint={t("editForm.agentContent.usageHint")}
          >
            {(a) => (
              <textarea
                {...a}
                dir="auto"
                className={cx(TEXTAREA, "text-start")}
                rows={2}
                value={usage}
                onChange={(e) => setUsage(e.target.value)}
              />
            )}
          </FieldShell>
          <FieldShell
            id="edit-contraindications"
            label={t("editForm.agentContent.contraindications")}
            hint={t("editForm.agentContent.contraindicationsHint")}
          >
            {(a) => (
              <textarea
                {...a}
                dir="auto"
                className={cx(TEXTAREA, "text-start")}
                rows={2}
                value={contraindications}
                onChange={(e) => setContraindications(e.target.value)}
              />
            )}
          </FieldShell>
        </div>
      </>
    ),
  });

  if (canManageCosts) {
    sections.push({
      id: SECTION_IDS.costModel,
      navLabel: t("create.sections.costModel"),
      title: t("create.sections.costModel"),
      icon: ICONS.cost,
      tone: "warn",
      permission: "superAdmin",
      hint: t("editV2.hints.costModel"),
      body: (
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldShell
            id="edit-unit-cogs"
            label={t("editForm.fields.unitCogs")}
            hint={t("create.hints.unitCogs")}
            required
          >
            {(a) => (
              <UnitShell suffix={currencySymbol}>
                <input
                  {...a}
                  type="number"
                  min="0"
                  step="0.001"
                  className={cx(CONTROL, "tabular-nums", currencySymbol && "pe-14")}
                  value={unitCogs}
                  onChange={(e) => setUnitCogs(e.target.value)}
                />
              </UnitShell>
            )}
          </FieldShell>
          <FieldShell
            id="edit-packing-cost"
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
                  className={cx(CONTROL, "tabular-nums", currencySymbol && "pe-14")}
                  value={packingCost}
                  onChange={(e) => setPackingCost(e.target.value)}
                />
              </UnitShell>
            )}
          </FieldShell>
          <FieldShell
            id="edit-processing-cost"
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
                  className={cx(CONTROL, "tabular-nums", currencySymbol && "pe-14")}
                  value={processingCost}
                  onChange={(e) => setProcessingCost(e.target.value)}
                />
              </UnitShell>
            )}
          </FieldShell>
          <FieldShell id="edit-default-price" label={t("editForm.fields.defaultPrice")}>
            {(a) => (
              <UnitShell suffix={currencySymbol}>
                <input
                  {...a}
                  type="number"
                  min="0"
                  step="0.001"
                  className={cx(CONTROL, "tabular-nums", currencySymbol && "pe-14")}
                  value={defaultPrice}
                  onChange={(e) => setDefaultPrice(e.target.value)}
                />
              </UnitShell>
            )}
          </FieldShell>
          {/* Visually with the other prices; still on the super_admin PATCH. */}
          <FieldShell
            id="edit-floor-price"
            label={t("editForm.agentContent.floorPrice")}
            hint={t("editForm.agentContent.floorPriceHint")}
          >
            {(a) => (
              <UnitShell suffix={currencySymbol}>
                <input
                  {...a}
                  type="number"
                  min="0"
                  step="0.001"
                  className={cx(CONTROL, "tabular-nums", currencySymbol && "pe-14")}
                  value={floorPrice}
                  onChange={(e) => setFloorPrice(e.target.value)}
                />
              </UnitShell>
            )}
          </FieldShell>
        </div>
      ),
    });

    sections.push({
      id: SECTION_IDS.stockStatus,
      navLabel: t("editForm.sections.inventoryAndStatus"),
      title: t("editForm.sections.inventoryAndStatus"),
      icon: ICONS.stock,
      tone: "neutral",
      permission: "superAdmin",
      hint: t("editV2.hints.stockStatus"),
      body: (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldShell
              id="edit-threshold"
              label={t("editForm.fields.threshold")}
              hint={t("create.hints.threshold")}
            >
              {(a) => (
                <input
                  {...a}
                  type="number"
                  min="0"
                  className={cx(CONTROL, "tabular-nums")}
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                />
              )}
            </FieldShell>
            {currentStock !== undefined && (
              <FieldShell
                id="edit-current-stock"
                label={t("editV2.fields.currentStock")}
                hint={t("editV2.hints.currentStock")}
              >
                {(a) => (
                  <input
                    {...a}
                    type="text"
                    disabled
                    readOnly
                    className={cx(CONTROL, "tabular-nums")}
                    value={String(currentStock)}
                  />
                )}
              </FieldShell>
            )}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isActive}
            onClick={() => setIsActive((v) => !v)}
            className="flex w-full items-center gap-3 rounded-xl border border-line-subtle bg-surface-sunken p-4 text-start"
          >
            <span
              aria-hidden="true"
              className={cx(
                "relative h-[23px] w-10 flex-none rounded-pill transition-colors duration-base",
                isActive ? "bg-prod-brand" : "bg-line-strong",
              )}
            >
              <span
                className={cx(
                  "absolute top-[2.5px] h-[18px] w-[18px] rounded-full bg-surface-card shadow-hover-row transition-[inset-inline-start] duration-base",
                  isActive ? "start-[19px]" : "start-[2.5px]",
                )}
              />
            </span>
            <span className="text-[13px] font-semibold text-ink-primary">
              {t("editForm.fields.isActive")}
              <span className="mt-0.5 block text-[11.5px] font-normal text-ink-secondary">
                {t("editV2.hints.isActive")}
              </span>
            </span>
          </button>
        </>
      ),
    });
  }

  const sectionIds = sections.map((s) => s.id).join("|");
  const [activeId, setActiveId] = useState(sections[0].id);

  useEffect(() => {
    const ids = sectionIds.split("|");
    setActiveId(ids[0]);
    // jsdom has no IntersectionObserver; the nav still points at the first
    // section, which is exactly what a non-scrolled page should show.
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((e) => e.isIntersecting);
        if (visible) setActiveId(visible.target.id);
      },
      { rootMargin: "-80px 0px -65% 0px", threshold: 0 },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sectionIds]);

  return (
    <div className="pb-24">
      <header className="mb-[18px]">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.03em] text-ink-primary">
          {t("editForm.title")}
        </h1>
        <p className="mt-1.5 text-[13.5px] text-ink-secondary">{t("editV2.intro")}</p>
      </header>

      <div className="grid items-start gap-[22px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="overflow-hidden rounded-card border border-line-subtle bg-surface-card shadow-hover-row">
          <nav
            aria-label={t("editV2.nav.label")}
            className="flex gap-0.5 overflow-x-auto border-b border-line-subtle px-2 pt-1.5"
          >
            {sections.map((s) => {
              const current = s.id === activeId;
              return (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  aria-current={current ? "true" : undefined}
                  className={cx(
                    "-mb-px inline-flex flex-none items-center gap-2.5 whitespace-nowrap rounded-t-lg border-b-2 px-4 py-3 text-[13.5px] transition-colors duration-fast",
                    current
                      ? "border-prod-brand font-semibold text-prod-brand"
                      : "border-transparent font-medium text-ink-secondary hover:bg-surface-sunken hover:text-ink-primary",
                  )}
                >
                  <span
                    className={cx(
                      "grid h-[25px] w-[25px] flex-none place-items-center rounded-lg",
                      current ? "bg-prod-brand-soft text-prod-brand" : ICON_TONE.neutral,
                    )}
                  >
                    {s.icon(13)}
                  </span>
                  {s.navLabel}
                </a>
              );
            })}
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
          aria-label={t("editV2.asideLabel")}
          className="flex flex-col gap-3.5 xl:sticky xl:top-[74px]"
        >
          {canManageCosts && (
            <AsideCard
              label={t("editV2.margin.title")}
              icon={ICONS.margin(13)}
              tone="brand"
            >
              <div className="mt-4 flex flex-col gap-[11px]">
                <div className="flex items-baseline gap-2.5 text-[12.5px] text-ink-secondary">
                  <span>{t("editV2.margin.price")}</span>
                  <span
                    aria-hidden="true"
                    className="min-w-3 flex-1 -translate-y-[3px] border-b border-dotted border-line-strong"
                  />
                  <b dir="ltr" className="font-semibold tabular-nums text-ink-primary">
                    {money(livePrice)}
                  </b>
                </div>
                {marginLines.map((l) => (
                  <div
                    key={l.key}
                    className="flex items-baseline gap-2.5 text-[12.5px] text-ink-secondary"
                  >
                    <span>{l.label}</span>
                    <span
                      aria-hidden="true"
                      className="min-w-3 flex-1 -translate-y-[3px] border-b border-dotted border-line-strong"
                    />
                    <b dir="ltr" className="font-semibold tabular-nums text-ink-primary">
                      {money(l.value)}
                    </b>
                  </div>
                ))}
                <div className="mt-[3px] flex items-center gap-2.5 border-t border-line-subtle pt-[13px] text-[13.5px] font-semibold text-ink-primary">
                  <span>{t("editV2.margin.total")}</span>
                  <span
                    dir="ltr"
                    className={cx(
                      "ms-auto text-[17px] font-bold tabular-nums",
                      unitMargin < 0 ? "text-status-critical" : "text-prod-pos",
                    )}
                  >
                    {money(unitMargin)}
                  </span>
                  {marginPct !== null && (
                    <span
                      dir="ltr"
                      className={cx(
                        "rounded-lg px-2 py-[3px] text-xs font-bold tabular-nums",
                        unitMargin < 0
                          ? "bg-status-criticalBg text-status-critical"
                          : "bg-prod-brand-soft text-prod-brand",
                      )}
                    >
                      {pctFmt.format(marginPct)} %
                    </span>
                  )}
                </div>
              </div>
              <p className="mt-3.5 text-[11.5px] leading-relaxed text-ink-muted">
                {avgDeliveryFee === undefined
                  ? t("editV2.margin.noDeliveryFee")
                  : t("editV2.margin.note")}
              </p>
              {marginPct === null && (
                <p className="mt-2 text-[11.5px] leading-relaxed text-ink-muted">
                  {t("editV2.margin.noPrice")}
                </p>
              )}
            </AsideCard>
          )}

          <AsideCard label={t("editV2.preview.title")} icon={ICONS.agent(13)} tone="info">
            <div className="mt-3.5 overflow-hidden rounded-xl border border-line-subtle">
              <span
                data-testid="agent-brief-preview"
                data-tone={agentBriefTone}
                className={cx(
                  "flex items-center gap-2 px-3.5 py-2.5 text-[12.5px] font-semibold",
                  BRIEF_PREVIEW_TONE[agentBriefTone],
                  agentBrief.trim() ? "" : "opacity-60",
                )}
              >
                {ICONS.info(13)}
                <span dir="auto" className="text-start">
                  {agentBrief.trim() || t("editV2.preview.emptyBrief")}
                </span>
              </span>
              <p
                dir="auto"
                className="min-h-[76px] whitespace-pre-wrap px-3.5 py-3 text-start text-[12.5px] leading-relaxed text-ink-secondary"
              >
                {agentNotes.trim() || t("editV2.preview.emptyNotes")}
              </p>
            </div>
          </AsideCard>

          <AsideCard
            label={t("editV2.impact.title")}
            icon={ICONS.warning(13)}
            tone="warn"
            className="border-status-warning/30 bg-status-warningBg"
          >
            <p className="mt-3 text-[12.5px] leading-relaxed text-hue-amber-ink">
              {inFlightCount !== undefined && (
                <span className="block font-semibold">
                  {t("editV2.impact.inFlight", { count: inFlightCount })}
                </span>
              )}
              {t("editV2.impact.body")}
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
        aria-label={t("editV2.savebar.label")}
        className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t border-line bg-surface-card/95 px-6 py-3 shadow-panel backdrop-blur"
      >
        <span
          className={cx(
            "me-auto flex items-center gap-2 text-[12.5px]",
            dirty ? "font-semibold text-hue-amber-ink" : "text-ink-secondary",
          )}
        >
          {dirty ? ICONS.warning(14) : ICONS.info(14)}
          {dirty ? t("editV2.savebar.dirty") : t("editV2.savebar.clean")}
        </span>
        <button
          type="button"
          onClick={() => router.push(`/${locale}/products/${product.id}`)}
          disabled={loading}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-line bg-surface-card px-4 text-[13.5px] font-medium text-ink-primary transition-colors duration-fast hover:border-line-strong hover:bg-surface-sunken disabled:cursor-not-allowed disabled:text-ink-muted"
        >
          {t("create.cancel")}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || !dirty}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-prod-brand bg-prod-brand px-4 text-[13.5px] font-semibold text-white shadow-hover-row transition-colors duration-fast hover:border-prod-brand-hover hover:bg-prod-brand-hover disabled:cursor-not-allowed disabled:border-line-subtle disabled:bg-surface-sunken disabled:text-ink-muted disabled:shadow-none"
        >
          {ICONS.save(14)}
          {loading ? t("editForm.saving") : t("editForm.submit")}
        </button>
      </div>
    </div>
  );
}
