"use client";

// /products/[id]/edit — the prototype's edit screen (prototypes/products-v6.html:
// editScreen, panelHTML, railHTML, saveBarHTML), approved by the owner on
// 2026-10-03. TABS, one section at a time (his call), and ONE save for the whole
// product: a tab with unsaved changes carries an amber dot, a tab with an error
// a red one, and Save jumps to it — the reason the old form refused tabs (a
// required field hiding behind one) is answered by the dot, not by a long scroll.
//
// Writes go where they always went: PATCH /api/products/[id] (super admin
// fields), PUT …/image, PUT …/agent-content (the only write a market manager
// may make). Variants keep their own per-row save inside their tab: each size
// is a record with its own stock.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Coins,
  Eye,
  FileText,
  Image as ImageIcon,
  Info,
  Layers,
  Plus,
  ScanLine,
  Tag,
  TriangleAlert,
  Truck,
  Wallet,
} from "lucide-react";
import type { Role } from "@/types";
import { useToast } from "@/components/ui/Toast";
import { decodeImageFile, type AvatarDecodeError } from "@/lib/client/image";
import { marketTimezone } from "@/lib/markets";
import { presetPeriod } from "@/lib/products/period";
import { groupDigits, instantDayLabel, moneyText, numText } from "@/lib/products/format";
import { useProductSheetOverview } from "@/hooks/useProductsOverview";
import { ProductVariantsEditor, type EditorVariant, type VariantKind } from "@/components/products/ProductVariantsEditor";
import { Amount, Num, SHARE_CLASS, Thumb, useUiLocale } from "./atoms";
import { previewDelivery } from "./delivery-preview";
import { useProductActions } from "./useProductActions";
import "./products-v6.css";

export interface EditableProductV6 {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  image_url: string | null;
  agent_brief: string | null;
  agent_brief_tone: string;
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
  current_stock: number;
  damaged_return_count: number;
  /** For the market id (timezone), when known. */
  market_id?: string;
}

type TabKey = "general" | "prix" | "var" | "stock" | "fiche";
const ALL_TABS: TabKey[] = ["general", "prix", "var", "stock", "fiche"];

type Ed = {
  name: string;
  sku: string;
  active: boolean;
  price: string;
  floor: string;
  cogs: string;
  pack: string;
  proc: string;
  thr: string;
  brief: string;
  tone: string;
  cross: string;
  desc: string;
  comp: string;
  usage: string;
  contra: string;
  notes: string;
};

const FIELD_TAB: Record<keyof Ed, TabKey> = {
  name: "general",
  sku: "general",
  active: "general",
  price: "prix",
  floor: "prix",
  cogs: "prix",
  pack: "prix",
  proc: "prix",
  thr: "stock",
  brief: "fiche",
  tone: "fiche",
  cross: "fiche",
  desc: "fiche",
  comp: "fiche",
  usage: "fiche",
  contra: "fiche",
  notes: "fiche",
};

const SA_FIELDS: (keyof Ed)[] = ["name", "sku", "active", "price", "floor", "cogs", "pack", "proc", "thr"];
const BRIEF_MAX = 280;

const TAB_ICON: Record<TabKey, typeof Tag> = { general: Tag, prix: Coins, var: Layers, stock: Box, fiche: FileText };
const TAB_LABEL: Record<TabKey, string> = { general: "tab_general", prix: "tab_prix", var: "tab_var", stock: "tab_stock", fiche: "tab_fiche" };

const IMAGE_ERROR: Record<AvatarDecodeError, string> = {
  "not-image": "errors.notImage",
  "too-large": "errors.tooLarge",
  "decode-failed": "errors.decodeFailed",
};

function str(v: number | null | undefined): string {
  return v === null || v === undefined ? "" : String(v);
}

function fromProduct(p: EditableProductV6): Ed {
  return {
    name: p.name,
    sku: p.sku ?? "",
    active: p.is_active,
    price: str(p.default_price),
    floor: str(p.floor_price),
    cogs: str(p.unit_cogs),
    pack: str(p.packing_cost),
    proc: str(p.confirmation_processing_cost ?? 0),
    thr: str(p.low_stock_threshold),
    brief: p.agent_brief ?? "",
    tone: p.agent_brief_tone || "info",
    cross: p.cross_sell_product_id ?? "",
    desc: p.description ?? "",
    comp: p.agent_composition ?? "",
    usage: p.agent_usage ?? "",
    contra: p.agent_contraindications ?? "",
    notes: p.agent_notes ?? "",
  };
}

function num(v: string): number {
  const x = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : 0;
}

/** A non-negative decimal, or empty when allowed. */
function validAmount(v: string, allowEmpty: boolean): boolean {
  if (v.trim() === "") return allowEmpty;
  const x = Number(v.replace(",", "."));
  return Number.isFinite(x) && x >= 0;
}

export function ProductEditV6({
  locale,
  role,
  currency,
  product,
  variants,
  variantNotes = [],
  crossSellOptions,
  initialTab,
}: {
  locale: string;
  role: Role;
  currency: string;
  product: EditableProductV6;
  variants: EditorVariant[];
  variantNotes?: { id: string; label: string; agent_note: string | null }[];
  crossSellOptions: { id: string; name: string }[];
  initialTab?: TabKey;
}) {
  const t = useTranslations("products.v6");
  const tImage = useTranslations("products.image");
  const tVariants = useTranslations("products.editV2.variants");
  const router = useRouter();
  const toast = useToast();
  const ui = useUiLocale();
  const isSa = role === "super_admin";
  const tabs: TabKey[] = isSa ? ALL_TABS : ["fiche"];
  const invoiced = currency === "LYD";
  const tz = marketTimezone(product.market_id ?? null);

  const [orig, setOrig] = useState<Ed>(() => fromProduct(product));
  const [ed, setEd] = useState<Ed>(orig);
  const [tab, setTab] = useState<TabKey>(() => (initialTab && tabs.includes(initialTab) ? initialTab : tabs[0]));
  const [errors, setErrors] = useState<Partial<Record<keyof Ed, string>>>({});
  const [discarding, setDiscarding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [image, setImage] = useState<string | null>(product.image_url);
  const [origImage, setOrigImage] = useState<string | null>(product.image_url);
  const [newImage, setNewImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [vNotes, setVNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(variantNotes.map((v) => [v.id, v.agent_note ?? ""])),
  );
  const [origVNotes, setOrigVNotes] = useState(vNotes);
  const [variantDraft, setVariantDraft] = useState<VariantKind | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // The rail's averages and the stock facts: the last 30 days of this product.
  const last30 = useMemo(() => presetPeriod("30d", tz), [tz]);
  const { data: o, mutate: mutateOverview } = useProductSheetOverview(product.id, last30, isSa);
  const actions = useProductActions(async () => {
    await mutateOverview();
    router.refresh();
  });

  const dirty = (Object.keys(ed) as (keyof Ed)[]).filter((k) => String(ed[k]) !== String(orig[k]));
  const imageDirty = image !== origImage;
  const notesDirty = Object.keys(vNotes).filter((k) => vNotes[k] !== origVNotes[k]);
  const dirtyCount = dirty.length + (imageDirty ? 1 : 0) + notesDirty.length;

  useEffect(() => {
    if (dirtyCount === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyCount]);

  const set = <K extends keyof Ed>(k: K, v: Ed[K]) => {
    setEd((prev) => ({ ...prev, [k]: v }));
    if (errors[k]) setErrors((prev) => ({ ...prev, [k]: undefined }));
    setDiscarding(false);
  };

  const tabHasError = (k: TabKey) => (Object.keys(errors) as (keyof Ed)[]).some((f) => errors[f] && FIELD_TAB[f] === k);
  const tabIsDirty = (k: TabKey) =>
    dirty.some((f) => FIELD_TAB[f] === k) || (k === "general" && imageDirty) || (k === "fiche" && notesDirty.length > 0);

  function validate(): Partial<Record<keyof Ed, string>> {
    if (!isSa) return {};
    const e: Partial<Record<keyof Ed, string>> = {};
    if (!ed.name.trim()) e.name = t("t_name");
    if (!validAmount(ed.cogs, false)) e.cogs = t("e_cogs");
    if (!validAmount(ed.price, true)) e.price = t("e_price");
    if (!validAmount(ed.floor, true)) e.floor = t("e_floor");
    if (!validAmount(ed.pack, true)) e.pack = t("e_cogs");
    if (!validAmount(ed.proc, true)) e.proc = t("e_cogs");
    if (!/^\d+$/.test(ed.thr.trim())) e.thr = t("e_thr");
    return e;
  }

  function jumpTo(field: keyof Ed) {
    setTab(FIELD_TAB[field]);
    window.setTimeout(() => document.getElementById(`f-${field}`)?.focus(), 0);
  }

  async function save() {
    const e = validate();
    const first = (Object.keys(e) as (keyof Ed)[])[0];
    if (first) {
      setErrors(e);
      jumpTo(first);
      toast.show({ tone: "critical", message: e[first] as string });
      return;
    }
    setSaving(true);
    try {
      if (isSa && (dirty.some((k) => SA_FIELDS.includes(k)) || (imageDirty && image === null))) {
        const body: Record<string, unknown> = {
          name: ed.name.trim(),
          sku: ed.sku.trim(),
          is_active: ed.active,
          default_price: ed.price.trim() === "" ? null : num(ed.price),
          floor_price: ed.floor.trim() === "" ? null : num(ed.floor),
          unit_cogs: num(ed.cogs),
          packing_cost: num(ed.pack),
          confirmation_processing_cost: num(ed.proc),
          low_stock_threshold: parseInt(ed.thr, 10),
        };
        // The upload route never clears; an explicit removal goes through PATCH.
        if (imageDirty && image === null) body.image_url = "";
        const res = await fetch(`/api/products/${product.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          if (res.status === 409) {
            setErrors({ sku: t("e_sku") });
            jumpTo("sku");
            toast.show({ tone: "critical", message: t("e_sku") });
            return;
          }
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          toast.show({ tone: "critical", message: t("t_failed", { msg: json.error ?? String(res.status) }) });
          return;
        }
      }
      if (isSa && newImage) {
        const res = await fetch(`/api/products/${product.id}/image`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data_url: newImage }),
        });
        if (!res.ok) {
          setImageError(tImage("uploadFailed"));
          setTab("general");
          toast.show({ tone: "critical", message: tImage("uploadFailed") });
          return;
        }
      }
      if (dirty.some((k) => FIELD_TAB[k] === "fiche") || notesDirty.length > 0) {
        const res = await fetch(`/api/products/${product.id}/agent-content`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: ed.desc.trim(),
            agent_brief: ed.brief.trim(),
            agent_brief_tone: ed.tone,
            agent_notes: ed.notes.trim(),
            agent_composition: ed.comp.trim(),
            agent_contraindications: ed.contra.trim(),
            agent_usage: ed.usage.trim(),
            cross_sell_product_id: ed.cross || null,
            variant_notes: Object.entries(vNotes).map(([id, agent_note]) => ({ id, agent_note })),
          }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          setTab("fiche");
          toast.show({ tone: "critical", message: t("t_failed", { msg: json.error ?? String(res.status) }) });
          return;
        }
      }
      setOrig(ed);
      setOrigImage(image);
      setNewImage(null);
      setOrigVNotes(vNotes);
      setErrors({});
      setDiscarding(false);
      toast.show({ message: t("t_saved") });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setEd(orig);
    setImage(origImage);
    setNewImage(null);
    setVNotes(origVNotes);
    setErrors({});
    setDiscarding(false);
  }

  async function pickImage(file: File) {
    setImageError(null);
    const result = await decodeImageFile(file, 768);
    if (!result.ok) {
      setImageError(tImage(IMAGE_ERROR[result.error]));
      return;
    }
    setImage(result.dataUrl);
    setNewImage(result.dataUrl);
  }

  // ── fields (the prototype's field()) ─────────────────────────────────────
  function field(
    k: keyof Ed,
    label: string,
    o: {
      required?: boolean;
      hint?: string;
      area?: boolean;
      rows?: number;
      num?: boolean;
      unit?: string;
      max?: number;
      after?: ReactNode;
      select?: [string, string][];
    } = {},
  ) {
    const id = `f-${k}`;
    const err = errors[k];
    const value = String(ed[k]);
    let control: ReactNode;
    if (o.area) {
      control = (
        <textarea
          className={`inp${err ? " err" : ""}`}
          id={id}
          dir="auto"
          rows={o.rows ?? 3}
          value={value}
          onChange={(e) => set(k, e.target.value as Ed[typeof k])}
        />
      );
    } else if (o.select) {
      control = (
        <div className="selwrap">
          <select className="inp" id={id} value={value} onChange={(e) => set(k, e.target.value as Ed[typeof k])}>
            {o.select.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <ChevronDown className="ic" aria-hidden />
        </div>
      );
    } else {
      const input = (
        <input
          className={`inp${err ? " err" : ""}${o.num ? " num" : ""}`}
          id={id}
          inputMode={o.num ? "decimal" : undefined}
          dir={o.num ? undefined : "auto"}
          value={value}
          maxLength={o.max}
          aria-invalid={err ? true : undefined}
          onChange={(e) => set(k, e.target.value as Ed[typeof k])}
        />
      );
      control = o.unit ? (
        <div className="unit">
          {input}
          <span className="u">{o.unit}</span>
        </div>
      ) : (
        input
      );
    }
    return (
      <div className="field">
        <label htmlFor={id}>
          {label}
          {o.required ? <span className="req"> *</span> : null}
        </label>
        {control}
        {err ? <div className="errmsg">{err}</div> : null}
        {o.after}
        {o.hint ? <div className="hint">{o.hint}</div> : null}
      </div>
    );
  }

  const group = (title: string, sub: string | null, body: ReactNode) => (
    <div className="fg">
      <div>
        <div className="gt">{title}</div>
        {sub ? <div className="gs">{sub}</div> : null}
      </div>
      {body}
    </div>
  );

  const unit = currency === "LYD" ? "د.ل" : "DT";
  const counted = o?.stock.counted_at ?? null;

  // ── panels (the prototype's panelHTML) ───────────────────────────────────
  let panel: ReactNode = null;
  if (tab === "general") {
    panel = (
      <>
        {group(
          t("g_identity"),
          t("g_identity_s"),
          <>
            <div className="field">
              <label>{t("f_photo")}</label>
              <div className="photo">
                <Thumb src={image} name={ed.name || product.name} size={72} radius={14} />
                <div className="acts">
                  <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>
                    <ImageIcon className="ic" aria-hidden />
                    {t("f_replace")}
                  </button>
                  {image ? (
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => {
                        setImage(null);
                        setNewImage(null);
                      }}
                    >
                      {t("f_remove")}
                    </button>
                  ) : null}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void pickImage(f);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
              {imageError ? <div className="errmsg">{imageError}</div> : null}
              <div className="hint">{t("f_photo_h")}</div>
            </div>
            <div className="frow">
              {field("name", t("f_name"), { required: true, hint: t("f_name_h") })}
              {field("sku", t("f_sku"), { hint: t("f_sku_h") })}
            </div>
          </>,
        )}
        {group(
          t("g_status"),
          null,
          <button type="button" className="switch" role="switch" aria-checked={ed.active} onClick={() => set("active", !ed.active)}>
            <span className="swt" />
            <span>
              <b>{t("f_active_sw")}</b>
              <small>{t("f_active_h")}</small>
            </span>
          </button>,
        )}
      </>
    );
  } else if (tab === "prix") {
    const avg = o?.avg_delivery_cost ?? null;
    panel = (
      <>
        {group(
          t("g_sell"),
          t("g_sell_s"),
          <div className="frow">
            {field("price", t("f_price"), { num: true, unit })}
            {field("floor", t("f_floor"), { num: true, unit, hint: t("f_floor_h") })}
          </div>,
        )}
        {group(
          t("g_cost"),
          t("g_cost_s"),
          <>
            <div className="frow three">
              {field("cogs", t("f_cogs"), { num: true, unit, required: true, hint: t("f_cogs_h") })}
              {field("pack", t("f_pack"), { num: true, unit, hint: t("f_pack_h") })}
              {field("proc", t("f_proc"), { num: true, unit, hint: t("f_proc_h") })}
            </div>
            {avg !== null ? (
              <div className="infobox">
                <Truck className="ic" aria-hidden />
                <span>
                  {invoiced
                    ? t("darb_info", { a: moneyText(avg, currency, { decimals: 1 }) })
                    : t("carrier_info", { a: moneyText(avg, currency, { decimals: 1 }) })}
                </span>
              </div>
            ) : null}
          </>,
        )}
      </>
    );
  } else if (tab === "var") {
    panel =
      variants.length === 0 && variantDraft === null ? (
        <div className="empty" style={{ margin: 0 }}>
          <span className="ih t-slate">
            <Layers className="ic" aria-hidden />
          </span>
          <b>{t("v_emptyT")}</b>
          <p>{t("v_emptyB")}</p>
          <div className="axes">
            <div>
              <b>{t("v_ax1")}</b>
              <span>{t("v_ax1_s")}</span>
            </div>
            <div>
              <b>{t("v_ax2")}</b>
              <span>{t("v_ax2_s")}</span>
            </div>
          </div>
          <div className="acts" style={{ justifyContent: "center" }}>
            <button type="button" className="btn sm" onClick={() => setVariantDraft("attribute")}>
              <Plus className="ic" aria-hidden />
              {t("v_size")}
            </button>
            <button type="button" className="btn sm" onClick={() => setVariantDraft("pack")}>
              <Plus className="ic" aria-hidden />
              {t("v_pack")}
            </button>
          </div>
        </div>
      ) : (
        <ProductVariantsEditor
          productId={product.id}
          variants={variants}
          currencySymbol={unit}
          initialDraftKind={variantDraft ?? undefined}
          onChanged={() => router.refresh()}
        />
      );
  } else if (tab === "stock") {
    panel = (
      <>
        {group(t("g_alert"), null, <div className="frow">{field("thr", t("f_thr"), { num: true, hint: t("f_thr_h") })}</div>)}
        {group(
          t("g_current"),
          t("f_current_h"),
          <>
            <div className="stockhead" style={{ margin: 0 }}>
              <span className="big xl">
                <Num value={product.current_stock} />
              </span>
              {counted ? (
                <span className="pill ok">
                  <Check className="ic" aria-hidden />
                  {t("st_counted", { d: instantDayLabel(counted, tz, ui) })}
                </span>
              ) : (
                <span className="pill call">
                  <TriangleAlert className="ic" aria-hidden />
                  {t("st_never")}
                </span>
              )}
            </div>
            <div className="acts">
              <Link className="btn sm" href={`/${locale}/warehouse/count?product=${product.id}`}>
                <ScanLine className="ic" aria-hidden />
                {t("b_count")}
              </Link>
              <button type="button" className="btn sm" onClick={() => actions.openStock(product.id, product.name)}>
                {t("b_adjust")}
              </button>
            </div>
            <div className="stats" style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))", maxWidth: 360, margin: 0 }}>
              <div className="stat">
                <span>{t("st_damaged")}</span>
                <b>
                  <Num value={product.damaged_return_count} />
                </b>
              </div>
              <div className="stat">
                <span>{t("st_value")}</span>
                <b>
                  <Amount value={product.current_stock * num(ed.cogs)} currency={currency} />
                </b>
              </div>
            </div>
          </>,
        )}
      </>
    );
  } else {
    const tones: [string, string, string][] = [
      ["info", "tone_info", "var(--info)"],
      ["warning", "tone_warn", "var(--call)"],
      ["critical", "tone_crit", "var(--bad)"],
    ];
    panel = (
      <>
        {group(
          t("g_screen"),
          t("g_screen_s"),
          <>
            {field("brief", t("f_brief"), {
              max: BRIEF_MAX,
              hint: t("f_brief_h"),
              after: (
                <div className="count" id="briefCount">
                  {t("f_chars", { n: BRIEF_MAX - ed.brief.length })}
                </div>
              ),
            })}
            <div className="frow">
              <div className="field">
                <label>{t("f_tone")}</label>
                <div className="tones" role="group">
                  {tones.map(([key, label, color]) => (
                    <button
                      key={key}
                      type="button"
                      className={key}
                      aria-pressed={ed.tone === key}
                      onClick={() => set("tone", key)}
                    >
                      <span className="dot" style={{ background: color }} />
                      {t(label)}
                    </button>
                  ))}
                </div>
              </div>
              {field("cross", t("f_cross"), {
                select: [["", t("f_cross_none")], ...crossSellOptions.map((c) => [c.id, c.name] as [string, string])],
                hint: t("f_cross_h"),
              })}
            </div>
          </>,
        )}
        {group(
          t("g_questions"),
          t("g_questions_s"),
          <>
            {field("comp", t("f_comp"), { area: true, rows: 2, hint: t("f_comp_h") })}
            <div className="frow">
              {field("usage", t("f_usage"), { area: true, rows: 2, hint: t("f_usage_h") })}
              {field("contra", t("f_contra"), { area: true, rows: 2, hint: t("f_contra_h") })}
            </div>
          </>,
        )}
        {group(
          t("g_team"),
          null,
          <>
            {field("desc", t("f_desc"), { area: true, rows: 3 })}
            {field("notes", t("f_notes"), { area: true, rows: 4, hint: t("f_notes_h") })}
          </>,
        )}
        {variantNotes.length > 0
          ? group(
              tVariants("title"),
              tVariants("hint"),
              <>
                {variantNotes.map((v) => (
                  <div className="field" key={v.id}>
                    <label htmlFor={`vn-${v.id}`}>{v.label}</label>
                    <input
                      className="inp"
                      id={`vn-${v.id}`}
                      dir="auto"
                      value={vNotes[v.id] ?? ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        setVNotes((prev) => ({ ...prev, [v.id]: value }));
                      }}
                    />
                  </div>
                ))}
              </>,
            )
          : null}
      </>
    );
  }

  // ── rail (the prototype's railHTML) ──────────────────────────────────────
  let rail: ReactNode;
  if (tab === "fiche") {
    const has = ed.brief.trim() || ed.comp.trim() || ed.usage.trim() || ed.contra.trim();
    const line = (label: string, v: string, cls = "") => (
      <div className={`pvl${cls ? ` ${cls}` : ""}`} dir="auto">
        <b>{label}</b>
        {v}
      </div>
    );
    rail = (
      <div className="card rcard">
        <div className="rh">
          <Eye className="ic" aria-hidden />
          {t("pv_title")}
        </div>
        <div className="pv">
          <div className="pvn">
            <bdi>{ed.name || product.name}</bdi>
          </div>
          <div className="pvl">
            <Amount value={num(ed.price)} currency={currency} />
          </div>
          {ed.brief.trim() ? (
            <div className={`pvb ${ed.tone}`} dir="auto">
              {ed.tone === "info" ? <Info className="ic" aria-hidden /> : <TriangleAlert className="ic" aria-hidden />}
              <span>{ed.brief}</span>
            </div>
          ) : null}
          {ed.comp.trim() ? line(t("f_comp"), ed.comp) : null}
          {ed.usage.trim() ? line(t("f_usage"), ed.usage) : null}
          {ed.contra.trim() ? line(t("f_contra"), ed.contra, "crit") : null}
          {!has ? <p className="pvempty">{t("pv_empty")}</p> : null}
        </div>
      </div>
    );
  } else {
    const m = o?.money;
    let calc: ReactNode;
    if (!m || m.deliveries === 0) {
      calc = <p className="rnote">{o ? t("r_nodata") : t("loading")}</p>;
    } else {
      const d = m.deliveries;
      const p = previewDelivery(
        { price: num(ed.price), cogs: num(ed.cogs), packing: num(ed.pack), processing: num(ed.proc) },
        { carrier: m.carrier / d, units: m.units / d, parcels: m.parcels / d, confirmed: m.confirmed / d, ads: m.ads / d },
      );
      const r = (sw: string, label: string, sub: string, v: number, sum = false) => (
        <div className={`crow${sum ? " sum" : ""}`} key={label}>
          <span>
            {sw ? <span className={`sw ${sw}`} /> : null}
            {label}
            {sub ? <small>{sub}</small> : null}
          </span>
          <b className={sum ? (v < 0 ? "neg" : "pos") : undefined}>
            <Amount value={v} currency={currency} d={1} signed={sum || v < 0} />
          </b>
        </div>
      );
      calc = (
        <>
          <div className="calc">
            {r("", t("r_price"), "", p.price)}
            {r("s-darb", invoiced ? t("r_darb") : t("r_carrier"), "", -p.carrier)}
            {r("s-cogs", t("r_cogs"), "", -p.cogs)}
            {num(ed.pack) > 0
              ? r("s-pack", t("r_pack"), t("r_pack_d", { c: groupDigits(num(ed.pack), 1), k: groupDigits(p.parcels, 1) }), -p.packing)
              : null}
            {num(ed.proc) > 0 ? r("s-proc", t("m_proc"), "", -p.processing) : null}
            {r("", t("r_before"), "", p.before, true)}
            {r("s-ads", t("r_ads"), "", -p.ads)}
            {r("", t("r_net"), "", p.net, true)}
          </div>
          <div className="stack" style={{ maxWidth: "none", height: 9, marginTop: 12 }}>
            {p.shares
              .filter((s) => s.share > 0)
              .map((s) => (
                <i key={s.key} className={SHARE_CLASS[s.key as keyof typeof SHARE_CLASS]} style={{ flex: Math.round(s.share * 1000) }} />
              ))}
          </div>
          <p className="rnote">
            {t("r_be", {
              b: moneyText(p.before, currency, { decimals: 1 }),
              a: moneyText(p.ads, currency, { decimals: 1 }),
            })}
          </p>
          <p className="rnote">{t("r_basis", { n: numText(d) })}</p>
        </>
      );
    }
    const inFlight = o?.counts.in_flight ?? 0;
    rail = (
      <>
        <div className="card rcard">
          <div className="rh">
            <Wallet className="ic" aria-hidden />
            {t("r_title")}
          </div>
          {calc}
        </div>
        <div className="card rcard">
          <div className="rh">
            <TriangleAlert className="ic" aria-hidden />
            {t("i_title")}
          </div>
          <div className="impact">
            {inFlight > 0 ? (
              <div>
                <Truck className="ic" aria-hidden />
                <span>{invoiced ? t("i_fly", { n: numText(inFlight) }) : t("i_fly_c", { n: numText(inFlight) })}</span>
              </div>
            ) : null}
            <div>
              <Coins className="ic" aria-hidden />
              <span>{t("i_cogs")}</span>
            </div>
          </div>
        </div>
      </>
    );
  }

  const saveLabel = t("sb_save");
  return (
    <div className="pv6 page">
      {actions.modals}
      <nav className="crumb" aria-label="breadcrumb">
        <Link href={`/${locale}/products`}>{t("crumb_products")}</Link>
        <ChevronRight className="ic chev" aria-hidden />
        <Link href={`/${locale}/products/${product.id}`} dir="auto">
          {product.name}
        </Link>
        <ChevronRight className="ic chev" aria-hidden />
        <span>{t("b_edit")}</span>
      </nav>

      <div className="ehead">
        <Thumb src={image} name={ed.name || product.name} size={52} radius={12} />
        <div className="grow">
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-.02em" }}>{t("e_title")}</h1>
          <div className="nm">
            <bdi>{ed.name || product.name}</bdi>
          </div>
        </div>
        <div className="acts">
          <Link className="btn" href={`/${locale}/products/${product.id}`}>
            <Eye className="ic" aria-hidden />
            {t("e_view")}
          </Link>
          <button type="button" className="btn pri" disabled={dirtyCount === 0 || saving} onClick={() => void save()}>
            <Check className="ic" aria-hidden />
            {saveLabel}
          </button>
        </div>
      </div>

      <div className="acts">
        <div className="tabs" role="tablist">
          {tabs.map((k) => {
            const Icon = TAB_ICON[k];
            const err = tabHasError(k);
            return (
              <button
                key={k}
                type="button"
                className="tab"
                role="tab"
                aria-selected={tab === k}
                onClick={() => {
                  setTab(k);
                  setDiscarding(false);
                }}
              >
                <Icon className="ic" aria-hidden />
                {t(TAB_LABEL[k])}
                {err ? <span className="dd err" aria-label="!" /> : tabIsDirty(k) ? <span className="dd" aria-label="•" /> : null}
              </button>
            );
          })}
        </div>
        {!isSa ? (
          <span className="rolenote">
            <Info className="ic" aria-hidden />
            {t("role_note")}
          </span>
        ) : null}
      </div>

      <div className="egrid">
        <div className="panel" role="tabpanel">
          {panel}
        </div>
        <aside className="rail">{rail}</aside>
      </div>

      {dirtyCount > 0 ? (
        discarding ? (
          <div className="savebar" role="region" aria-label="save">
            <span>{t("sb_discardQ", { n: dirtyCount })}</span>
            <button type="button" className="btn ghost" onClick={() => setDiscarding(false)}>
              {t("sb_keep")}
            </button>
            <button type="button" className="btn danger" onClick={discard}>
              {t("sb_discard")}
            </button>
          </div>
        ) : (
          <div className="savebar" role="region" aria-label="save">
            <span>{t("sb_changes", { n: dirtyCount })}</span>
            <button type="button" className="btn ghost" onClick={() => setDiscarding(true)}>
              {t("sb_cancel")}
            </button>
            <button type="button" className="btn pri" disabled={saving} onClick={() => void save()}>
              <Check className="ic" aria-hidden />
              {saveLabel}
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}
