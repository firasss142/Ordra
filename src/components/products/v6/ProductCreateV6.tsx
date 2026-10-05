"use client";

// /products/new — the edit page's design for a product that does not exist yet
// (owner, 2026-10-04: "follow the same design consistency as the products page").
// Same crumb, header, tabs with an amber dot for what was typed and a red one for
// what is wrong, same field groups, same rail, same floating save bar. Four tabs,
// not five: the agent sheet is written once the product exists (Modifier).
//
// ONE request creates the product and its sizes (POST /api/products — the body
// is the old form's, unchanged), then the photo is uploaded against the new id.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Box, Check, ChevronDown, ChevronRight, Coins, Info, Layers, Plus, Tag, Wallet, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { currencySymbol, numText } from "@/lib/products/format";
import { Amount, Thumb } from "./atoms";
import { Field, Group, PhotoField, SaveBar, Unit, num, validAmount, validCount } from "./form";
import "@/components/finance/kit/finance-kit.css";
import "./products-v6.css";

export interface CreateMarket {
  id: string;
  name: string;
  currency: string | null;
}

type TabKey = "general" | "prix" | "var" | "stock";
const TABS: TabKey[] = ["general", "prix", "var", "stock"];
const TAB_ICON: Record<TabKey, typeof Tag> = { general: Tag, prix: Coins, var: Layers, stock: Box };
const TAB_LABEL: Record<TabKey, string> = { general: "tab_general", prix: "tab_prix", var: "tab_var", stock: "tab_stock" };

type Draft = {
  name: string;
  sku: string;
  market: string;
  price: string;
  cogs: string;
  pack: string;
  proc: string;
  initial: string;
  thr: string;
};
type FieldKey = keyof Draft | "variants";

const FIELD_TAB: Record<FieldKey, TabKey> = {
  name: "general",
  sku: "general",
  market: "general",
  price: "prix",
  cogs: "prix",
  pack: "prix",
  proc: "prix",
  variants: "var",
  initial: "stock",
  thr: "stock",
};

interface Size {
  /** Stable across removals — React keys must not be the index. */
  key: string;
  label: string;
  sku: string;
  cogs: string;
  price: string;
  stock: string;
}

let sizeSeq = 0;
function emptySize(): Size {
  sizeSeq += 1;
  return { key: `s${sizeSeq}`, label: "", sku: "", cogs: "", price: "", stock: "0" };
}

export function ProductCreateV6({
  locale,
  markets,
  defaultMarketId,
  lockedMarketId,
}: {
  locale: string;
  markets: CreateMarket[];
  defaultMarketId: string;
  /** The market scope the super admin is working in; null = all, so they choose. */
  lockedMarketId: string | null;
}) {
  const t = useTranslations("products.v6");
  const tImage = useTranslations("products.image");
  const router = useRouter();
  const toast = useToast();

  const initial: Draft = useMemo(
    () => ({
      name: "",
      sku: "",
      market: lockedMarketId ?? defaultMarketId,
      price: "",
      cogs: "",
      pack: "",
      proc: "",
      initial: "0",
      thr: "5",
    }),
    [lockedMarketId, defaultMarketId],
  );
  const [d, setD] = useState<Draft>(initial);
  const [sizes, setSizes] = useState<Size[] | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("general");
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [badSizes, setBadSizes] = useState<Record<string, { label?: boolean; price?: boolean }>>({});
  const [leaving, setLeaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const done = useRef(false);

  const market = markets.find((m) => m.id === d.market);
  const currency = market?.currency ?? "";
  const unit = currency ? currencySymbol(currency) : undefined;
  const hasSizes = sizes !== null;

  const dirtyKeys = (Object.keys(d) as (keyof Draft)[]).filter((k) => d[k] !== initial[k]);
  const dirty = dirtyKeys.length > 0 || hasSizes || image !== null;
  const complete = d.name.trim() !== "" && (hasSizes || validAmount(d.cogs, false));

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (done.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = (k: keyof Draft, v: string) => {
    setD((prev) => ({ ...prev, [k]: v }));
    if (errors[k]) setErrors((prev) => ({ ...prev, [k]: undefined }));
    setLeaving(false);
  };

  const setSize = (key: string, k: keyof Omit<Size, "key">, v: string) => {
    setSizes((prev) => (prev ?? []).map((s) => (s.key === key ? { ...s, [k]: v } : s)));
    if (errors.variants) setErrors((prev) => ({ ...prev, variants: undefined }));
    if (badSizes[key]) setBadSizes((prev) => ({ ...prev, [key]: {} }));
    setLeaving(false);
  };

  const tabHasError = (k: TabKey) => (Object.keys(errors) as FieldKey[]).some((f) => errors[f] && FIELD_TAB[f] === k);
  const tabIsDirty = (k: TabKey) =>
    dirtyKeys.some((f) => FIELD_TAB[f] === k) || (k === "general" && image !== null) || (k === "var" && hasSizes);

  function validate() {
    const e: Partial<Record<FieldKey, string>> = {};
    const bad: Record<string, { label?: boolean; price?: boolean }> = {};
    if (!d.name.trim()) e.name = t("t_name");
    if (!hasSizes) {
      if (!validAmount(d.cogs, false)) e.cogs = t("e_cogs");
      if (!validAmount(d.price, true)) e.price = t("e_price");
      if (!validCount(d.initial)) e.initial = t("e_qty");
    }
    if (!validAmount(d.pack, true)) e.pack = t("e_amount");
    if (!validAmount(d.proc, true)) e.proc = t("e_amount");
    if (!validCount(d.thr)) e.thr = t("e_thr");
    if (sizes) {
      for (const s of sizes) {
        const label = s.label.trim() === "";
        const price = !(num(s.price) > 0);
        if (label || price) bad[s.key] = { label, price };
      }
      const all = Object.values(bad);
      if (all.some((b) => b.label)) e.variants = t("e_v_label");
      else if (all.some((b) => b.price)) e.variants = t("e_v_price");
    }
    return { e, bad };
  }

  function jumpTo(field: FieldKey) {
    setTab(FIELD_TAB[field]);
    window.setTimeout(() => document.getElementById(`f-${field}`)?.focus(), 0);
  }

  function open(id: string) {
    done.current = true;
    router.push(`/${locale}/products/${id}`);
  }

  async function create() {
    const { e, bad } = validate();
    setBadSizes(bad);
    const first = (Object.keys(e) as FieldKey[])[0];
    if (first) {
      setErrors(e);
      jumpTo(first);
      toast.show({ tone: "critical", message: e[first] as string });
      return;
    }
    setErrors({});

    const body: Record<string, unknown> = {
      name: d.name.trim(),
      market_id: d.market,
      unit_cogs: hasSizes ? 0 : num(d.cogs),
      packing_cost: num(d.pack),
      confirmation_processing_cost: num(d.proc),
      initial_stock: hasSizes ? 0 : parseInt(d.initial, 10),
      low_stock_threshold: parseInt(d.thr, 10),
    };
    if (sizes) {
      body.variants = sizes.map((s) => ({
        label: s.label.trim(),
        sku: s.sku.trim() === "" ? null : s.sku.trim(),
        unit_cogs: num(s.cogs),
        display_price: num(s.price),
        initial_stock: parseInt(s.stock, 10) || 0,
      }));
    } else {
      if (d.sku.trim()) body.sku = d.sku.trim();
      if (d.price.trim()) body.default_price = num(d.price);
    }

    setSaving(true);
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { data?: { id?: string }; error?: string };
      // 207: the product exists, a size did not, and nothing spans the two
      // writes — open the product WITH the message so it is finished by hand,
      // never re-created. Checked before res.ok, which is true for every 2xx:
      // the old form tested it inside !res.ok and so never showed the message.
      if (res.status === 207 && json.data?.id) {
        toast.show({ tone: "critical", message: json.error ?? String(res.status) });
        open(json.data.id);
        return;
      }
      if (!res.ok) {
        if (res.status === 409) {
          if (hasSizes) {
            setErrors({ variants: t("e_sku") });
            setTab("var");
          } else {
            setErrors({ sku: t("e_sku") });
            jumpTo("sku");
          }
          toast.show({ tone: "critical", message: t("e_sku") });
          return;
        }
        toast.show({ tone: "critical", message: t("t_failed", { msg: json.error ?? String(res.status) }) });
        return;
      }
      const id = json.data?.id;
      if (!id) {
        done.current = true;
        router.push(`/${locale}/products`);
        return;
      }
      if (image) {
        const img = await fetch(`/api/products/${id}/image`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data_url: image }),
        });
        // The product exists; only the photo failed. Say so, and open it — the
        // photo is retried from Modifier, not by creating the product again.
        if (!img.ok) {
          toast.show({ tone: "critical", message: tImage("uploadFailed") });
          open(id);
          return;
        }
      }
      toast.show({ message: t("n_created") });
      open(id);
    } finally {
      setSaving(false);
    }
  }

  // ── fields ───────────────────────────────────────────────────────────────
  function input(k: keyof Draft, label: string, o: { required?: boolean; hint?: string; amount?: boolean; count?: boolean } = {}) {
    const id = `f-${k}`;
    const err = errors[k];
    return (
      <Field id={id} label={label} required={o.required} error={err} hint={o.hint}>
        <Unit unit={o.amount ? unit : undefined}>
          <input
            className={`inp${err ? " err" : ""}${o.amount || o.count ? " num" : ""}`}
            id={id}
            inputMode={o.amount ? "decimal" : o.count ? "numeric" : undefined}
            dir={o.amount || o.count ? undefined : "auto"}
            value={d[k]}
            aria-invalid={err ? true : undefined}
            onChange={(e) => set(k, e.target.value)}
          />
        </Unit>
      </Field>
    );
  }

  const sizeTotal = (sizes ?? []).reduce((sum, s) => sum + (parseInt(s.stock, 10) || 0), 0);

  let panel: ReactNode;
  if (tab === "general") {
    panel = (
      <>
        <Group title={t("g_identity")} sub={t("g_identity_s")}>
          <PhotoField image={image} name={d.name} onChange={setImage} />
          <div className="frow">
            {input("name", t("f_name"), { required: true, hint: t("f_name_h") })}
            {hasSizes ? null : input("sku", t("f_sku"), { hint: t("f_sku_h") })}
          </div>
          {lockedMarketId === null && markets.length > 1 ? (
            <div className="frow">
              <Field id="f-market" label={t("n_market")} hint={t("n_market_h")}>
                <div className="selw">
                  <select className="inp" id="f-market" value={d.market} onChange={(e) => set("market", e.target.value)}>
                    {markets.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="ic" aria-hidden />
                </div>
              </Field>
            </div>
          ) : null}
        </Group>
      </>
    );
  } else if (tab === "prix") {
    panel = (
      <>
        {hasSizes ? (
          <div className="glass infob">
            <span className="tk k-neu">
              <Layers className="ic" aria-hidden />
            </span>
            <span>{t("n_var_moved")}</span>
          </div>
        ) : (
          <Group title={t("g_sell")} sub={t("g_sell_s")}>
            <div className="frow">{input("price", t("f_price"), { amount: true })}</div>
          </Group>
        )}
        <Group title={t("g_cost")} sub={t("g_cost_s")}>
          <div className={`frow${hasSizes ? "" : " three"}`}>
            {hasSizes ? null : input("cogs", t("f_cogs"), { amount: true, required: true, hint: t("f_cogs_h") })}
            {input("pack", t("f_pack"), { amount: true, hint: t("f_pack_h") })}
            {input("proc", t("f_proc"), { amount: true, hint: t("f_proc_h") })}
          </div>
        </Group>
      </>
    );
  } else if (tab === "var") {
    panel = !sizes ? (
      <div className="empty fe">
        <span className="tk k-neu">
          <Layers className="ic" aria-hidden />
        </span>
        <b>{t("v_emptyT")}</b>
        <p>{t("n_v_off")}</p>
        <div className="acts">
          <button type="button" className="btn2 sm" onClick={() => setSizes([emptySize()])}>
            <Plus className="ic" aria-hidden />
            {t("v_size")}
          </button>
        </div>
        <p style={{ margin: "14px auto 0" }}>{t("n_v_packs")}</p>
      </div>
    ) : (
      <Group title={t("n_v_title")} sub={t("n_v_sub")}>
        <div className="vrows">
          {sizes.map((s, i) => {
            const bad = badSizes[s.key] ?? {};
            const cell = (k: keyof Omit<Size, "key">, label: string, o: { amount?: boolean; count?: boolean; err?: boolean; required?: boolean } = {}) => {
              const id = `v-${s.key}-${k}`;
              return (
                <Field id={id} label={label} required={o.required}>
                  <Unit unit={o.amount ? unit : undefined}>
                    <input
                      className={`inp${o.err ? " err" : ""}${o.amount || o.count ? " num" : ""}`}
                      id={id}
                      inputMode={o.amount ? "decimal" : o.count ? "numeric" : undefined}
                      dir={o.amount || o.count ? undefined : "auto"}
                      value={s[k]}
                      aria-invalid={o.err ? true : undefined}
                      onChange={(e) => setSize(s.key, k, e.target.value)}
                    />
                  </Unit>
                </Field>
              );
            };
            return (
              <div className="vrow" key={s.key} id={i === 0 ? "f-variants" : undefined} tabIndex={i === 0 ? -1 : undefined}>
                {cell("label", t("n_v_label"), { required: true, err: bad.label })}
                {cell("sku", t("f_sku"))}
                {cell("cogs", t("n_v_cogs"), { amount: true })}
                {cell("price", t("n_v_price"), { amount: true, required: true, err: bad.price })}
                {cell("stock", t("n_v_stock"), { count: true })}
                <button
                  type="button"
                  className="mbtn"
                  aria-label={t("n_v_remove")}
                  title={t("n_v_remove")}
                  disabled={sizes.length === 1}
                  onClick={() => setSizes(sizes.filter((x) => x.key !== s.key))}
                >
                  <X className="ic" aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
        {errors.variants ? <div className="errmsg">{errors.variants}</div> : null}
        <div className="acts">
          <button type="button" className="btn2 sm" onClick={() => setSizes([...sizes, emptySize()])}>
            <Plus className="ic" aria-hidden />
            {t("v_size")}
          </button>
          <button
            type="button"
            className="btn2 sm"
            onClick={() => {
              setSizes(null);
              setBadSizes({});
              setErrors((prev) => ({ ...prev, variants: undefined }));
            }}
          >
            {t("n_v_simple")}
          </button>
          <span className="rolenote">{t("n_v_total", { n: numText(sizeTotal) })}</span>
        </div>
      </Group>
    );
  } else {
    panel = (
      <>
        <Group title={t("n_g_start")}>
          {hasSizes ? (
            <div className="glass infob">
              <span className="tk k-neu">
                <Layers className="ic" aria-hidden />
              </span>
              <span>{t("n_stock_var", { n: numText(sizeTotal) })}</span>
            </div>
          ) : (
            <div className="frow">{input("initial", t("n_initial"), { count: true, hint: t("n_initial_h") })}</div>
          )}
        </Group>
        <Group title={t("g_alert")}>
          <div className="frow">{input("thr", t("f_thr"), { count: true, hint: t("f_thr_h") })}</div>
        </Group>
      </>
    );
  }

  // ── rail: the margin per piece, then what happens next ──────────────────
  /** `result`: a margin, coloured and signed; `sum` adds the total's rule above it. */
  const row = (sw: string, label: string, v: number, o: { sum?: boolean; result?: boolean } = {}) => {
    const result = o.sum || o.result;
    return (
      <div className={`crow${o.sum ? " sum" : ""}`} key={label}>
        <span>
          {sw ? <i className={`sw ${sw}`} /> : null}
          {label}
        </span>
        <b className={result && v < 0 ? "neg" : undefined}>
          {currency ? <Amount value={v} currency={currency} d={1} signed={result || v < 0} /> : numText(v)}
        </b>
      </div>
    );
  };
  const pack = num(d.pack);
  const proc = num(d.proc);
  let margin: ReactNode;
  if (sizes) {
    const priced = sizes.filter((s) => num(s.price) > 0);
    margin =
      priced.length === 0 ? (
        <p className="rnote">{t("n_m_empty")}</p>
      ) : (
        <>
          <div className="calc">
            {priced.map((s) => row("", s.label.trim() || "—", num(s.price) - num(s.cogs) - pack - proc, { result: true }))}
          </div>
          <p className="rnote">{t("n_m_var")}</p>
        </>
      );
  } else if (d.price.trim() && validAmount(d.cogs, false)) {
    const price = num(d.price);
    const cogs = num(d.cogs);
    margin = (
      <>
        <div className="calc">
          {row("", t("r_price"), price)}
          {row("k-cogs", t("r_cogs"), -cogs)}
          {pack > 0 ? row("k-pack", t("r_pack"), -pack) : null}
          {proc > 0 ? row("k-proc", t("m_proc"), -proc) : null}
          {row("", t("n_m_before"), price - cogs - pack - proc, { sum: true })}
        </div>
        <p className="rnote">{t("n_m_note")}</p>
      </>
    );
  } else {
    margin = <p className="rnote">{t("n_m_empty")}</p>;
  }

  return (
    <div className="fin prd">
      <div className="page">
        <nav className="crumb rise" style={{ ["--d" as string]: 0 }} aria-label="breadcrumb">
          {t("crumb_fin")}
          <ChevronRight className="ic" aria-hidden />
          <Link href={`/${locale}/products`}>{t("crumb_products")}</Link>
          <ChevronRight className="ic" aria-hidden />
          <span>{t("n_title")}</span>
        </nav>

        <div className="ehead rise" style={{ ["--d" as string]: 0 }}>
          {image ? (
            <Thumb src={image} name={d.name || "?"} />
          ) : (
            <span className="pimg new" aria-hidden="true">
              <Plus className="ic" />
            </span>
          )}
          <div className="grow">
            <h1>{t("n_title")}</h1>
            <div className="nm">{d.name.trim() ? <bdi>{d.name}</bdi> : t("n_unnamed")}</div>
          </div>
          <div className="acts">
            <Link className="btn2" href={`/${locale}/products`}>
              {t("sb_cancel")}
            </Link>
            <button type="button" className="btn" disabled={saving} onClick={() => void create()}>
              <Check className="ic" aria-hidden />
              {saving ? t("n_creating") : t("n_create")}
            </button>
          </div>
        </div>

        <div className="tabsrow rise" style={{ ["--d" as string]: 1 }}>
          <div className="seg" role="tablist">
            {TABS.map((k) => {
              const Icon = TAB_ICON[k];
              const err = tabHasError(k);
              return (
                <button
                  key={k}
                  type="button"
                  className={tab === k ? "on" : undefined}
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => {
                    setTab(k);
                    setLeaving(false);
                  }}
                >
                  <Icon className="ic" aria-hidden />
                  {t(TAB_LABEL[k])}
                  {err ? <span className="dd err" aria-label="!" /> : tabIsDirty(k) ? <span className="dd" aria-label="•" /> : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="egrid rise" style={{ ["--d" as string]: 2 }}>
          <div className="card panel" role="tabpanel">
            {panel}
          </div>
          <aside className="rail">
            <div className="card rc">
              <div className="rh eyebrow">
                <Wallet className="ic" aria-hidden />
                {t("n_m_title")}
              </div>
              {margin}
            </div>
            <div className="card rc">
              <div className="rh eyebrow">
                <Info className="ic" aria-hidden />
                {t("n_next_t")}
              </div>
              <p className="rnote" style={{ margin: 0 }}>
                {t("n_next_b")}
              </p>
            </div>
          </aside>
        </div>

        {dirty ? (
          leaving ? (
            <SaveBar>
              <span>{t("n_leaveQ")}</span>
              <button type="button" className="btn2 sm" onClick={() => setLeaving(false)}>
                {t("sb_keep")}
              </button>
              <button
                type="button"
                className="btn sm dang"
                onClick={() => {
                  done.current = true;
                  router.push(`/${locale}/products`);
                }}
              >
                {t("sb_discard")}
              </button>
            </SaveBar>
          ) : (
            <SaveBar>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Info className="ic" aria-hidden />
                {complete ? t("n_ready") : t("n_incomplete")}
              </span>
              <button type="button" className="btn2 sm" onClick={() => setLeaving(true)}>
                {t("sb_cancel")}
              </button>
              <button type="button" className="btn sm" disabled={saving} onClick={() => void create()}>
                <Check className="ic" aria-hidden />
                {saving ? t("n_creating") : t("n_create")}
              </button>
            </SaveBar>
          )
        ) : null}
      </div>
    </div>
  );
}
