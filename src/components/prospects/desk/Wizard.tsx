"use client";

/**
 * « Nouvelle liste », guided in 3 steps (prototypes/prospects-manager-v5.html):
 *   1. Qui rappeler ?  — a starting point, then 2–3 plain questions; « Affiner » folded.
 *   2. Que leur propose-t-on ? — products (one or several) + an offer + a name.
 *   3. Comment ? — the agents call, or a WhatsApp message with a live phone preview.
 * The answers become audience conditions (lib/prospects/desk/wizard.ts), counted
 * by the same engine that creates the list, so the count is the list.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  BookOpen, Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, FileText, Filter, Gift, MessageCircle, Phone, PhoneOff,
  Repeat, SlidersHorizontal, Undo2, Upload, X,
} from "lucide-react";
import type { Condition } from "@/lib/prospects/audience";
import { canContinue, newDraft, presetRange, toConditions, type Draft, type Preset, type Range, type Start, type WaTemplate } from "@/lib/prospects/desk/wizard";
import { fillSample, messageErrors, templateText, VAR_TOKENS } from "@/lib/prospects/desk/templates";
import { parseLeadCsv } from "@/lib/leads/csv";
import { Avatar, Cover, type ProductOption } from "./parts";
import { ProductPicker } from "./ProductPicker";
import { fmtDay, fmtNum } from "./format";

export interface AudienceCount { net: number; excluded: number }

const PRESETS: Preset[] = ["7", "30", "90", "month", "last", "custom"];

function RangeField({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const t = useTranslations("prospects.desk.wizard");
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="range">
      <div className="pres">
        {PRESETS.map((p) => (
          <button key={p} type="button" className={`pchip${value.preset === p ? " on" : ""}`}
            onClick={() => onChange(p === "custom" ? { ...value, preset: "custom" } : presetRange(p))}>{t(`presets.${p}`)}</button>
        ))}
      </div>
      <div className="dates">
        <span>{t("from")}</span>
        <input type="date" className="inp d" value={value.from} max={today} aria-label={t("from")} onChange={(e) => onChange({ ...value, preset: "custom", from: e.target.value })} />
        <span>{t("to")}</span>
        <input type="date" className="inp d" value={value.to} max={today} aria-label={t("to")} onChange={(e) => onChange({ ...value, preset: "custom", to: e.target.value })} />
      </div>
    </div>
  );
}

const STARTS: { k: Start; icon: typeof Repeat }[] = [{ k: "old", icon: Repeat }, { k: "rej", icon: PhoneOff }, { k: "ret", icon: Undo2 }, { k: "csv", icon: FileText }];
const TPL_ICON: Record<WaTemplate, typeof Gift> = { new_book: BookOpen, changed: PhoneOff, returned: Undo2, free: Gift };

export function Wizard({
  open, onClose, products, locale, marketId, waLang, waActive, subreasons, cities, onPreview, onCreate,
}: {
  open: boolean; onClose: () => void; products: ProductOption[]; locale: string; marketId: string;
  waLang: "ar" | "fr"; waActive: boolean;
  subreasons: { key: string; label: string; count?: number }[];
  cities: string[];
  onPreview: (conditions: Condition[]) => Promise<AudienceCount>;
  onCreate: (d: Draft, conditions: Condition[], name: string) => Promise<string>;
}) {
  const t = useTranslations("prospects.desk.wizard");
  const tl = useTranslations("prospects.desk.list");
  const [d, setD] = useState<Draft>(() => newDraft("old", Date.now(), waLang));
  const [count, setCount] = useState<AudienceCount | null>(null);
  const [steps, setSteps] = useState<{ kind: string; n: number }[]>([]);
  const [counting, setCounting] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [waMore, setWaMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const msgRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (open) { setD(newDraft("old", Date.now(), waLang)); setError(null); setRefineOpen(false); setWaMore(false); } }, [open, waLang]);

  const conditions = useMemo(() => toConditions(d), [d]);
  const condKey = JSON.stringify(conditions);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // The count follows the conditions, and so does each step of the drill-down.
  useEffect(() => {
    if (!open) return;
    if (d.start === "csv") { setCount(d.csv ? { net: d.csv.rows.length, excluded: 0 } : { net: 0, excluded: 0 }); setSteps([]); return; }
    let live = true;
    setCounting(true);
    const id = setTimeout(async () => {
      try {
        // One count per prefix: the starting audience, then after each further condition.
        const cuts = [conditions.slice(0, 2), ...conditions.slice(2).map((_, i) => conditions.slice(0, i + 3))];
        const results = await Promise.all(cuts.map((c) => onPreview(c)));
        if (!live) return;
        const all = results[results.length - 1];
        setCount(all);
        setSteps(results.length > 1 ? results.map((r, i) => ({ kind: i === 0 ? "outcome" : conditions[i + 1].kind, n: i === 0 ? r.net + r.excluded : r.net })) : []);
      } catch { if (live) setCount(null); } finally { if (live) setCounting(false); }
    }, 350);
    return () => { live = false; clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, condKey, d.start, d.csv]);

  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const proposedNames = d.offerProductIds.map((id) => byId.get(id)?.name).filter((x): x is string => Boolean(x));
  const pickTemplate = (tpl: WaTemplate, lang = d.wa.lang) => set({ wa: { ...d.wa, tpl, lang, message: templateText(tpl, lang, proposedNames) } });
  const nameDefault = useMemo(() => {
    const month = new Date().toLocaleDateString(locale === "ar" ? "ar-LY" : "fr-FR", { month: "short" });
    const prods = d.products.map((p) => byId.get(p.id)?.name.split(" ").slice(0, 2).join(" ")).filter(Boolean);
    if (d.start === "csv") return d.csv?.fileName.replace(/\.csv$/i, "") ?? t("starts.csv");
    return [t(`starts.${d.start}`), prods.length ? prods.join(" + ") : null, month].filter(Boolean).join(" · ");
  }, [d.start, d.products, d.csv, byId, locale, t]);

  const sentence = () => {
    const b = (c: ReactNode) => <b>{c}</b>;
    if (d.start === "csv") return t("sentence.csv");
    const range = t("sentence.between", { from: fmtDay(d.range.from, locale), to: fmtDay(d.range.to, locale) });
    const nr = d.noReorder ? t("sentence.noReorder") : "";
    if (d.start === "old") {
      const names = d.products.map((p) => byId.get(p.id)?.name).filter(Boolean) as string[];
      return <>{t.rich("sentence.old", { products: names.length ? names.map((n) => `« ${n} »`).join(t("sentence.or")) : t("sentence.anyProduct"), range, noReorder: nr, b })}</>;
    }
    if (d.start === "rej") return t("sentence.rej", { reasons: d.subreasons.map((k) => subreasons.find((s) => s.key === k)?.label ?? k).join(", "), range });
    return t("sentence.ret", { range, noReorder: nr });
  };

  const waErrs = d.how === "wa" ? messageErrors(d.wa.message) : [];
  const ok = canContinue(d) && (d.step !== 3 || waErrs.length === 0) && (count?.net ?? 0) > 0;

  const step1 = () => {
    const q = (label: string, body: ReactNode, help?: string) => <div className="q"><div className="ql">{label}</div><div className="qb">{body}{help ? <p className="help">{help}</p> : null}</div></div>;
    const ownExtra = (id: string) => {
      const p = d.products.find((x) => x.id === id);
      if (!p) return null;
      return {
        button: <button type="button" className={`odates${p.own ? " on" : ""}`} onClick={() => set({ products: d.products.map((x) => x.id === id ? { ...x, own: x.own ? null : { ...d.range, preset: "custom" } } : x) })}>
          <Calendar className="ic" />{p.own ? `${fmtDay(p.own.from, locale)} → ${fmtDay(p.own.to, locale)}` : t("picker.ownDates")}
        </button>,
        panel: p.own ? <div className="bkr"><RangeField value={p.own} onChange={(r) => set({ products: d.products.map((x) => x.id === id ? { ...x, own: r } : x) })} /></div> : null,
      };
    };
    return (
      <>
        <h4 className="qh">{t("pickStart")}</h4>
        <div className="starts s4">
          {STARTS.map(({ k, icon: I }) => (
            <button key={k} type="button" className={d.start === k ? "on" : ""} aria-pressed={d.start === k}
              onClick={() => setD((x) => ({ ...newDraft(k, Date.now(), x.wa.lang), offerProductIds: x.offerProductIds, offer: x.offer, how: x.how, wa: x.wa }))}>
              <I className="ic" /><b>{t(`starts.${k}`)}</b><small>{t(`startsSub.${k}`)}</small>
            </button>
          ))}
        </div>
        {d.start === "csv" ? (
          <div className="qs">
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return;
              const text = await f.text();
              const rows = parseLeadCsv(text).rows.filter((r) => r.error === null).map((r) => ({ name: r.customer_name, phone: r.customer_phone, city: r.customer_city }));
              set({ csv: rows.length ? { fileName: f.name, rows, text } : null });
              setError(rows.length ? null : t("csvBad"));
            }} />
            {d.csv ? (
              <div className="csvok"><FileText className="ic" /><span><b>{t("csvLoaded", { file: d.csv.fileName, n: d.csv.rows.length })}</b><small>{t("csvHelp")}</small></span><button type="button" className="lnk" onClick={() => fileRef.current?.click()}>{t("csvChange")}</button></div>
            ) : (
              <button type="button" className="drop" onClick={() => fileRef.current?.click()}><Upload className="ic" /><b>{t("csvDrop")}</b><span>{t("csvOr")}</span><small>{t("csvHelp")}</small></button>
            )}
          </div>
        ) : (
          <div className="qs">
            {d.start === "old" ? q(t("qOldProd"), <ProductPicker products={products} value={d.products.map((p) => p.id)} locale={locale} marketId={marketId}
              onChange={(ids) => set({ products: ids.map((id) => d.products.find((p) => p.id === id) ?? { id, own: null }) })}
              renderExtra={ownExtra} emptyHelp={t("picker.allHelp")} />) : null}
            {d.start === "rej" ? q(t("qRejWhy"), <div className="chips">
              {subreasons.map((s) => {
                const on = d.subreasons.includes(s.key);
                return <button key={s.key} type="button" className={`mchip${on ? " on" : ""}`} aria-pressed={on} onClick={() => set({ subreasons: on ? d.subreasons.filter((k) => k !== s.key) : [...d.subreasons, s.key] })}>{on ? <Check className="ic" /> : null}{s.label}{s.count !== undefined ? <small className="num">{s.count}</small> : null}</button>;
              })}
            </div>) : null}
            {q(d.start === "old" ? t("qOldWhen") : d.start === "rej" ? t("qRejWhen") : t("qRetWhen"), <RangeField value={d.range} onChange={(r) => set({ range: r })} />)}
            {d.start !== "rej" ? (
              <div className="qtog" role="switch" aria-checked={d.noReorder} tabIndex={0} onClick={() => set({ noReorder: !d.noReorder })} onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); set({ noReorder: !d.noReorder }); } }}>
                <span className={`sw${d.noReorder ? " on" : ""}`} /><span><b>{t("noReorder")}</b><small>{t("noReorderSub")}</small></span>
              </div>
            ) : null}
            <div className="refine">
              {refineOpen || d.refine.cities || d.refine.orderCountMin || d.refine.basketMin ? (
                <>
                  <div className="rrow"><span className="ci"><Filter className="ic" /></span><b>{t("cities")}</b>
                    <div className="rb chips">{cities.slice(0, 12).map((c) => { const on = d.refine.cities?.includes(c) ?? false; return <button key={c} type="button" className={`mchip${on ? " on" : ""}`} onClick={() => { const cur = d.refine.cities ?? []; const next = on ? cur.filter((x) => x !== c) : [...cur, c]; set({ refine: { ...d.refine, cities: next.length ? next : null } }); }}>{on ? <Check className="ic" /> : null}<bdi>{c}</bdi></button>; })}</div><span /></div>
                  <div className="rrow"><span className="ci"><Repeat className="ic" /></span><b>{t("ordersMin")}</b>
                    <span className="n2"><input className="inp" type="number" min={1} value={d.refine.orderCountMin ?? ""} onChange={(e) => set({ refine: { ...d.refine, orderCountMin: Number(e.target.value) || null } })} /> {t("ordersUnit")}</span><span /></div>
                  <div className="rrow"><span className="ci"><Filter className="ic" /></span><b>{t("basketMin")}</b>
                    <span className="n2"><input className="inp" type="number" min={1} value={d.refine.basketMin ?? ""} onChange={(e) => set({ refine: { ...d.refine, basketMin: Number(e.target.value) || null } })} /></span><span /></div>
                </>
              ) : (
                <div className="addw"><button type="button" className="addc" onClick={() => setRefineOpen(true)}><SlidersHorizontal className="ic" />{t("refine")}<small>{t("refineSub")}</small></button></div>
              )}
            </div>
          </div>
        )}
      </>
    );
  };

  const step2 = () => (
    <>
      <div className="q"><div className="ql">{t("offerProducts")}</div><div className="qb">
        <ProductPicker products={products} value={d.offerProductIds} locale={locale} marketId={marketId} onChange={(ids) => set({ offerProductIds: ids })} emptyHelp={t("offerNone")} />
      </div></div>
      <div className="q" style={{ marginTop: 18 }}><div className="ql">{t("offer")}</div><div className="qb"><input className="inp" value={d.offer} placeholder={t("offerPh")} onChange={(e) => set({ offer: e.target.value })} /><p className="help">{t("offerHelp")}</p></div></div>
      <div className="q" style={{ marginTop: 18 }}><div className="ql">{t("name")}</div><div className="qb"><input className="inp" value={d.name || nameDefault} onChange={(e) => set({ name: e.target.value })} /></div></div>
    </>
  );

  const step3 = () => (
    <>
      <div className="hows">
        <button type="button" className={d.how === "call" ? "on" : ""} aria-pressed={d.how === "call"} onClick={() => set({ how: "call" })}><span className="hi"><Phone className="ic" /></span><b>{t("howCall")}</b><small>{t("howCallSub")}</small></button>
        <button type="button" className={d.how === "wa" ? "on" : ""} aria-pressed={d.how === "wa"} disabled={!waActive || d.start === "csv"}
          onClick={() => { set({ how: "wa" }); if (!d.wa.message) pickTemplate(d.start === "ret" ? "returned" : d.start === "rej" ? "changed" : "new_book"); }}>
          <span className="hi wa"><MessageCircle className="ic" /></span><b>{t("howWa")}</b><small>{waActive ? t("howWaSub") : t("howWaOff")}</small>
        </button>
      </div>
      {d.how === "wa" ? (
        <>
          <div className="q"><div className="ql">{t("tpl")}</div><div className="qb"><div className="tpls">
            {(Object.keys(TPL_ICON) as WaTemplate[]).map((k) => { const I = TPL_ICON[k]; return <button key={k} type="button" className={`tpl${d.wa.tpl === k ? " on" : ""}`} onClick={() => pickTemplate(k)}><I className="ic" /><span>{t(`tpls.${k}`)}</span></button>; })}
          </div></div></div>
          <div className="q" style={{ marginTop: 18 }}><div className="ql">{t("edit")}</div><div className="qb">
            <textarea ref={msgRef} className="inp msg" dir={d.wa.lang === "ar" ? "rtl" : "ltr"} value={d.wa.message} onChange={(e) => set({ wa: { ...d.wa, tpl: null, message: e.target.value } })} />
            <div className="vars"><span>{t("insert")}</span>
              {(Object.keys(VAR_TOKENS) as (keyof typeof VAR_TOKENS)[]).map((k) => (
                <button key={k} type="button" className="var" onClick={() => {
                  const ta = msgRef.current; const tok = VAR_TOKENS[k]; const pos = ta?.selectionStart ?? d.wa.message.length;
                  const msg = d.wa.message.slice(0, pos) + tok + d.wa.message.slice(ta?.selectionEnd ?? pos);
                  set({ wa: { ...d.wa, message: msg } });
                  requestAnimationFrame(() => { ta?.focus(); ta?.setSelectionRange(pos + tok.length, pos + tok.length); });
                }}>+ {t(`vars.${k}`)}</button>
              ))}
            </div>
            {waErrs.length ? <p className="help" style={{ color: "var(--bad)" }}>{waErrs.map((e) => t(`waErrors.${e}`)).join(" · ")}</p> : null}
          </div></div>
          <button type="button" className="advlink" aria-expanded={waMore} onClick={() => setWaMore((m) => !m)}><SlidersHorizontal className="ic" />{t("more")} <small>· {t("moreSub")}</small><ChevronDown className={`ic${waMore ? " rot" : ""}`} /></button>
          {waMore ? (
            <div className="wamore">
              <div className="fld" style={{ marginTop: 0 }}><span>{t("lang")}</span>
                <span className="segc xs"><button type="button" className={d.wa.lang === "ar" ? "on" : ""} onClick={() => (d.wa.tpl ? pickTemplate(d.wa.tpl, "ar") : set({ wa: { ...d.wa, lang: "ar" } }))}>العربية</button><button type="button" className={d.wa.lang === "fr" ? "on" : ""} onClick={() => (d.wa.tpl ? pickTemplate(d.wa.tpl, "fr") : set({ wa: { ...d.wa, lang: "fr" } }))}>Français</button></span>
              </div>
              <div className="toggle" style={{ marginTop: 12 }} role="switch" aria-checked={d.wa.image} tabIndex={0} onClick={() => set({ wa: { ...d.wa, image: !d.wa.image } })}><span className={`sw${d.wa.image ? " on" : ""}`} />{t("image")}</div>
              <p className="help">{t("waHelp")}</p>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );

  const previewProductId = d.offerProductIds[0] ?? d.products[0]?.id ?? null;
  const previewProduct = previewProductId ? byId.get(previewProductId) ?? null : null;
  const gotName = (d.products[0] && byId.get(d.products[0].id)?.name) ?? products[0]?.name ?? "—";
  const preview = d.step === 1 && d.start !== "csv" ? (
    steps.length ? (
      <div className="sumc"><span className="eyebrow">{t("drill")}</span>
        <div className="drill" style={{ border: 0, margin: "6px 0 0", padding: 0 }}>
          {steps.map((s, i) => <div key={i} className="dr"><span>{s.kind === "outcome" ? t(`starts.${d.start}`) : t(`drillKinds.${s.kind}`)}</span><b className="num">{fmtNum(s.n, locale)}</b><i style={{ width: `${steps[0].n ? Math.max(2, (s.n / steps[0].n) * 100) : 0}%` }} /></div>)}
        </div>
      </div>
    ) : null
  ) : d.how === "wa" && d.step === 3 ? (
    <div className="sumc"><span className="eyebrow">{t("previewWa")}</span>
      <div className="phone">
        <div className="ph-top"><span className="ph-av">O</span><div><b>{t("waBiz")}</b><small><Check className="ic" />{t("waVerified")}</small></div></div>
        <div className="ph-chat">
          <div className="bub" dir={d.wa.lang === "ar" ? "rtl" : "ltr"}>
            {d.wa.image && previewProduct ? <div className="photo">{previewProduct.image ? <img src={previewProduct.image} alt="" /> : <Cover product={previewProduct} w={74} />}</div> : null}
            <div className="bt" style={{ whiteSpace: "pre-line" }}>{fillSample(d.wa.message, { name: t("sample"), got: gotName, city: cities[0] ?? "", offer: d.offer })}</div>
            <div className="bf">{t("waFooter")}<span>10:24</span></div>
          </div>
          {(["yes", "call", "no"] as const).map((k) => <div key={k} className="bbtn" dir={d.wa.lang === "ar" ? "rtl" : "ltr"}><Undo2 className="ic" />{t(`btn.${k}`)}</div>)}
        </div>
      </div>
    </div>
  ) : (
    <div className="sumc"><span className="eyebrow">{t("previewCall")}</span>
      <div className="apv">
        <div className="apv-h"><Avatar id="sample" name={t("sample")} color="indigo" size={24} /><b>{t("sample")}</b><span className="state"><Phone className="ic" />{tl("status.to_call")}</span></div>
        <div className="apv-r"><small>{t("reasonLabel")}</small><span>{tl(`why.${d.start === "csv" ? "camp" : d.start}`)}</span></div>
        {proposedNames.length || d.offer ? (
          <div className="apv-o">{previewProduct && d.offerProductIds.length ? <Cover product={previewProduct} w={28} /> : null}<div><small>{t("offerLabel")}</small><b><bdi>{[proposedNames.join(t("sentence.or")), d.offer].filter(Boolean).join(" · ")}</bdi></b></div></div>
        ) : null}
      </div>
    </div>
  );

  const create = async () => {
    setBusy(true); setError(null);
    try {
      await onCreate(d, conditions, (d.name || nameDefault).trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.generic"));
    } finally { setBusy(false); }
  };

  if (!open) return <aside className="drawer wide" aria-hidden />;
  const summary = (s: 1 | 2 | 3) => s === 1 ? t(`starts.${d.start}`) : s === 2 ? ([proposedNames.join(t("sentence.or")), d.offer].filter(Boolean).join(" · ") || t("s2hint")) : d.how === "wa" ? t("howWa") : t("howCall");

  return (
    <aside className="drawer wide on" aria-label={t("title")}>
      <div className="dh"><div className="tt"><h3>{t("title")}</h3><p>{t("sub")}</p></div><button type="button" className="ib" onClick={onClose} aria-label={t("cancel")}><X className="ic" /></button></div>
      <div className="steps">
        {([1, 2, 3] as const).map((s, i) => (
          <span key={s} style={{ display: "contents" }}>
            {i ? <span className="stl" /> : null}
            <button type="button" className={`stp${d.step === s ? " on" : ""}${d.step > s ? " done" : ""}`} disabled={s > d.step && !ok} onClick={() => set({ step: s })}>
              <i>{d.step > s ? <Check className="ic" /> : s}</i><span><b>{t(`s${s}`)}</b><small><bdi>{summary(s)}</bdi></small></span>
            </button>
          </span>
        ))}
      </div>
      <div className="nlgrid">
        <div className="db"><section className="step">{d.step === 1 ? step1() : d.step === 2 ? step2() : step3()}</section></div>
        <aside className="nlsum">
          <div className="sumc hero2"><span className="eyebrow">{t("who")}</span>
            <div className="sumn"><b className="num">{count ? fmtNum(count.net, locale) : "—"}</b><span>{counting ? t("counting") : t("people", { n: count?.net ?? 0 })}</span></div>
            <p className="sent">{sentence()}</p>
            {count && count.excluded ? <p className="help">{t("removed", { n: count.excluded })}</p> : null}
          </div>
          {preview}
        </aside>
      </div>
      <div className="df">
        <span className="meta" style={error ? { color: "var(--bad)" } : undefined}>{error ?? (d.how === "wa" ? t("metaWa") : t("step", { n: d.step }))}</span>
        {d.step > 1 ? <button type="button" className="btn sec" onClick={() => set({ step: (d.step - 1) as 1 | 2 })}><ChevronLeft className="ic flip" />{t("back")}</button> : <button type="button" className="btn sec" onClick={onClose}>{t("cancel")}</button>}
        {d.step < 3
          ? <button type="button" className="btn pri" disabled={!ok} onClick={() => set({ step: (d.step + 1) as 2 | 3 })}>{t("next")}<ChevronRight className="ic flip" /></button>
          : <button type="button" className="btn pri" disabled={!ok || busy} onClick={create}>{d.how === "wa" ? t("submitWa", { n: fmtNum(count?.net ?? 0, locale) }) : t("create", { n: fmtNum(count?.net ?? 0, locale) })}</button>}
      </div>
    </aside>
  );
}

