"use client";

/**
 * « Nouvelle campagne » — three steps: who, how, and who works it.
 *
 * The count under the audience is the one the database returns, not a
 * simulation. That matters more than it sounds: the rebuy template on the
 * Libyan market matches 294 customers, of whom 290 already have an open
 * prospect, leaving four. The prototype's simulated count claimed about four
 * hundred. So the exclusions are drawn and named — a manager who reads "4"
 * must be able to see why, or they will assume the tool is broken.
 *
 * Design: prototypes/prospects-manager-v1.html (campaignSheet).
 */
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Check, Image as ImageIcon, Info, Phone, Plus, ShieldCheck, X } from "lucide-react";
import {
  CONDITION_GROUP, FIXED_KINDS, conditionsOf, defaultCondition, periodDays,
  type AudiencePreview, type Condition, type ConditionError, type ConditionKind, type TemplateKey,
} from "@/lib/prospects/audience";
import { WhatsAppIcon } from "../ui";
import {
  Avatar, CARD, DARK, Field, fmt, Hint, INPUT, OUTLINE, PRIMARY, Sheet, Toggle,
} from "./ui";

export type Channel = "call" | "wa" | "wa_call";

export interface CampaignDraft {
  step: 1 | 2 | 3;
  template: TemplateKey;
  conditions: Condition[];
  name: string;
  offer: string;
  channel: Channel;
  waMessage: string;
  waImage: boolean;
  waSender: "agent" | "api";
  waWindow: string;
  waRate: number;
  waFollowUpHours: number;
  scriptFr: string;
  scriptAr: string;
  agentIds: string[];
  cap: number;
}

export interface CampaignSheetProps {
  draft: CampaignDraft;
  onDraft: (patch: Partial<CampaignDraft>) => void;
  preview: AudiencePreview | null;
  previewing: boolean;
  errors: ConditionError[];
  agents: { id: string; name: string; open_leads: number }[];
  products: { id: string; name: string }[];
  cities: string[];
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
  locale: string;
  now: number;
}

const TEMPLATE_KEYS: TemplateKey[] = ["rebuy", "winback", "vip", "lapsed", "custom"];
const WINDOWS = ["9-13", "10-20", "14-21"];
const EX_COLOURS: Record<string, string> = {
  openLead: "#FCA5A5", recentlyOrdered: "#FDE68A",
  recentCampaign: "#C4B5FD", lostNotInterested: "#9CA3AF",
};

export function CampaignSheet(props: CampaignSheetProps) {
  const {
    draft, onDraft, preview, previewing, errors, agents, products, cities,
    busy, error, onConfirm, onClose, locale, now,
  } = props;
  const t = useTranslations("prospects.console");

  const net = preview?.net ?? 0;
  const step = draft.step;

  const errorFor = (kind: ConditionKind) => errors.find((e) => e.kind === kind);

  const setCondition = (i: number, next: Condition) => {
    const conditions = [...draft.conditions];
    conditions[i] = next;
    // Any hand edit means this is no longer the template it started as.
    onDraft({ conditions, template: "custom" });
  };

  const addCondition = (kind: ConditionKind) =>
    onDraft({ conditions: [...draft.conditions, defaultCondition(kind, now)], template: "custom" });

  const removeCondition = (i: number) =>
    onDraft({ conditions: draft.conditions.filter((_, j) => j !== i), template: "custom" });

  const available = useMemo(() => {
    const used = new Set(draft.conditions.map((c) => c.kind));
    return (Object.keys(CONDITION_GROUP) as ConditionKind[]).filter((k) => !used.has(k));
  }, [draft.conditions]);

  const canNext = step === 1
    ? net > 0 && errors.length === 0
    : step === 2
      ? draft.name.trim() !== "" && (draft.channel === "call" || draft.waMessage.trim() !== "")
      : draft.agentIds.length > 0;

  return (
    <Sheet
      wide
      title={t("cb.t")}
      sub={
        <span className="inline-flex items-center gap-1.5 text-[13px]">
          {(["audience", "channel", "dist"] as const).map((k, i) => {
            const n = (i + 1) as 1 | 2 | 3;
            return (
              <span key={k} className="inline-flex items-center gap-1.5">
                {i > 0 ? <span className="text-[#D1D5DB]">›</span> : null}
                <span className={`inline-flex items-center gap-1.5 ${step === n ? "text-[#111827]" : "text-[#6B7280]"}`}>
                  <i className={`grid h-5 w-5 place-items-center rounded-full text-[11.5px] font-bold not-italic ${
                    step > n ? "bg-[#15803D] text-white" : step === n ? "bg-[#111111] text-white" : "bg-[#F3F4F6] text-[#6B7280]"
                  }`}>
                    {step > n ? <Check size={12} aria-hidden /> : n}
                  </i>
                  {t(`cb.steps.${k}`)}
                </span>
              </span>
            );
          })}
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <span className="text-[13px] text-[#6B7280]">
            <b className="font-semibold tabular-nums text-[#111827]">{fmt(net, locale)}</b> {t("cb.counter")}
          </span>
          {step > 1 ? (
            <button type="button" onClick={() => onDraft({ step: (step - 1) as 1 | 2 })}
              className={`ms-auto h-11 px-4 text-[14px] ${OUTLINE}`}>
              {t("cb.back")}
            </button>
          ) : (
            <button type="button" onClick={onClose} className={`ms-auto h-11 px-4 text-[14px] ${OUTLINE}`}>
              {t("panel.cancel")}
            </button>
          )}
          {step < 3 ? (
            <button type="button" disabled={!canNext} onClick={() => onDraft({ step: (step + 1) as 2 | 3 })}
              className={`h-11 min-w-[130px] px-4 text-[14px] ${PRIMARY}`}>
              {t("cb.next")}
            </button>
          ) : (
            <button type="button" disabled={busy || !canNext} onClick={onConfirm}
              className={`h-11 min-w-[190px] px-4 text-[14px] ${DARK}`}>
              {t("cb.go", { n: fmt(Math.min(net, draft.agentIds.length * draft.cap), locale) })}
            </button>
          )}
        </>
      }
    >
      {error ? (
        <p role="alert" className="m-0 rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2.5 text-[13.5px] text-[#B91C1C]">
          {error}
        </p>
      ) : null}

      {step === 1 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col gap-3">
            <Field label={t("cb.tmplT")}>
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATE_KEYS.map((k) => (
                  <Toggle
                    key={k}
                    on={draft.template === k}
                    onClick={() => onDraft({ template: k, conditions: conditionsOf(k, now) })}
                  >
                    {t(`cb.tmpl.${k}`)}
                  </Toggle>
                ))}
              </div>
            </Field>

            <div className="flex flex-col gap-2">
              {draft.conditions.map((c, i) => (
                <ConditionRow
                  key={`${c.kind}-${i}`}
                  condition={c}
                  error={errorFor(c.kind)}
                  products={products}
                  cities={cities}
                  agents={agents}
                  locale={locale}
                  onChange={(next) => setCondition(i, next)}
                  onRemove={FIXED_KINDS.includes(c.kind) ? undefined : () => removeCondition(i)}
                />
              ))}
            </div>

            {available.length > 0 ? (
              <details className="relative">
                <summary className={`inline-flex h-9 cursor-pointer list-none items-center gap-1.5 px-3 text-[13.5px] ${OUTLINE}`}>
                  <Plus size={15} aria-hidden />
                  {t("cb.add")}
                </summary>
                <div className="absolute z-10 mt-1.5 grid max-h-[320px] w-[340px] gap-0.5 overflow-y-auto rounded-xl border border-[#E5E7EB] bg-white p-2 shadow-[0_20px_50px_-20px_rgba(17,24,39,.35)]">
                  {(["orders", "customer", "guard", "size"] as const).map((g) => {
                    const inGroup = available.filter((k) => CONDITION_GROUP[k] === g);
                    if (inGroup.length === 0) return null;
                    return (
                      <div key={g}>
                        <p className="m-0 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6B7280]">
                          {t(`cb.grp.${g}`)}
                        </p>
                        {inGroup.map((k) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => addCondition(k)}
                            className="flex w-full flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-start hover:bg-[#F9FAFB]"
                          >
                            <span className="text-[13.5px] font-medium text-[#111827]">{t(`cb.c.${k}`)}</span>
                            <span className="text-[12px] text-[#6B7280]">{t(`cb.desc.${k}`)}</span>
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </details>
            ) : null}
          </div>

          {/* The count, and why it is that count. */}
          <div className="flex flex-col gap-2.5">
            <div className="rounded-xl bg-[#111111] px-3.5 py-3 text-white">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[24px] font-bold tabular-nums">
                  {previewing ? "…" : fmt(net, locale)}
                  <small className="ms-1.5 text-[12.5px] font-medium text-[#9CA3AF]">{t("cb.counter")}</small>
                </span>
                {preview ? (
                  <span className="text-end text-[12.5px] text-[#D1D5DB]">
                    {t("cb.match", { n: fmt(preview.matched, locale) })}
                  </span>
                ) : null}
              </div>
              {preview && preview.matched > 0 ? (
                <span aria-hidden className="mt-2.5 flex h-2 overflow-hidden rounded bg-white/15">
                  {Object.entries(preview.excluded).map(([k, n]) =>
                    n > 0 ? (
                      <b key={k} style={{ width: `${(n / preview.matched) * 100}%`, background: EX_COLOURS[k] }} className="block h-full" />
                    ) : null,
                  )}
                  <b className="block h-full flex-1 bg-[#22C55E]" />
                </span>
              ) : null}
            </div>

            {preview ? (
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px] text-[#374151]">
                {Object.entries(preview.excluded).filter(([, n]) => n > 0).map(([k, n]) => (
                  <li key={k} className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5">
                      <i aria-hidden style={{ background: EX_COLOURS[k] }} className="h-2 w-2 rounded-[2px]" />
                      {t(`cb.ex.${k}`)}
                    </span>
                    <b className="font-semibold tabular-nums">−{fmt(n, locale)}</b>
                  </li>
                ))}
              </ul>
            ) : null}

            <Field label={t("cb.sample")}>
              {preview && preview.sample.length > 0 ? (
                <div className="overflow-hidden rounded-lg border border-[#E5E7EB]">
                  {preview.sample.map((s, i) => (
                    <div key={`${s.phone}-${i}`} className={`grid grid-cols-[1fr_auto] gap-2 px-3 py-2 text-[13px] ${
                      i > 0 ? "border-t border-[#F3F4F6]" : ""
                    }`}>
                      <span className="min-w-0">
                        <b className="block truncate font-semibold text-[#111827] [unicode-bidi:plaintext]">{s.name}</b>
                        <small className="text-[12px] text-[#6B7280]" dir="ltr">{s.phone}</small>
                      </span>
                      <span className="text-end text-[12px] text-[#6B7280]">
                        {s.city ? <span className="block truncate [unicode-bidi:plaintext]">{s.city}</span> : null}
                        {t("cb.sampleLine", { days: s.lastOrderDays, n: s.delivered })}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="m-0 rounded-lg bg-[#F9FAFB] px-3 py-3 text-center text-[13px] text-[#6B7280]">
                  {t("cb.sampleNone")}
                </p>
              )}
            </Field>

            <Hint icon={ShieldCheck}>{t("cb.baseHint")}</Hint>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <ChannelStep draft={draft} onDraft={onDraft} preview={preview} agents={agents} locale={locale} />
      ) : null}

      {step === 3 ? (
        <DistributeStep draft={draft} onDraft={onDraft} net={net} agents={agents} locale={locale} />
      ) : null}
    </Sheet>
  );
}

/** One condition: its label, its editor, and a way to remove it. */
function ConditionRow({
  condition: c, error, products, cities, agents, locale, onChange, onRemove,
}: {
  condition: Condition;
  error?: ConditionError;
  products: { id: string; name: string }[];
  cities: string[];
  agents: { id: string; name: string }[];
  locale: string;
  onChange: (c: Condition) => void;
  onRemove?: () => void;
}) {
  const t = useTranslations("prospects.console");
  const group = CONDITION_GROUP[c.kind];

  return (
    <div className={`grid grid-cols-[130px_1fr_28px] items-start gap-2 rounded-lg border bg-white px-3 py-2.5 ${
      error ? "border-[#FCA5A5]" : "border-[#E5E7EB]"
    } ${group === "guard" ? "border-s-[3px] border-s-[#F59E0B]" : ""}`}>
      <span className="min-w-0">
        <small className="block text-[11px] uppercase tracking-[0.05em] text-[#6B7280]">{t(`cb.grp.${group}`)}</small>
        <b className="block text-[13.5px] font-semibold text-[#111827]">{t(`cb.c.${c.kind}`)}</b>
      </span>

      <span className="flex flex-wrap items-center gap-1.5">
        <ConditionEditor condition={c} products={products} cities={cities} agents={agents} locale={locale} onChange={onChange} />
        {error ? (
          <span role="alert" className="w-full text-[12px] text-[#B91C1C]">{t(`cb.errors.${error.code}`)}</span>
        ) : null}
      </span>

      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={t("sel.clear")}
          className="grid h-7 w-7 place-items-center rounded-lg text-[#9CA3AF] hover:bg-[#F3F4F6]">
          <X size={16} aria-hidden />
        </button>
      ) : (
        <ShieldCheck size={15} aria-hidden className="mt-1 text-[#9CA3AF]" />
      )}
    </div>
  );
}

function ConditionEditor({
  condition: c, products, cities, agents, locale, onChange,
}: {
  condition: Condition;
  products: { id: string; name: string }[];
  cities: string[];
  agents: { id: string; name: string }[];
  locale: string;
  onChange: (c: Condition) => void;
}) {
  const t = useTranslations("prospects.console");
  const num = "h-8 w-[86px] rounded-lg border border-[#D1D5DB] px-2 text-[13px] tabular-nums outline-none focus:border-[#15803D]";
  const sep = "text-[13px] text-[#6B7280]";

  switch (c.kind) {
    case "outcome":
      return (
        <>
          {(["delivered", "returned", "rejected"] as const).map((s) => (
            <Toggle key={s} on={c.statuses.includes(s)}
              onClick={() => onChange({
                ...c,
                statuses: c.statuses.includes(s) ? c.statuses.filter((x) => x !== s) : [...c.statuses, s],
              })}>
              {t(`cb.outcomes.${s}`)}
            </Toggle>
          ))}
        </>
      );

    case "period":
      return (
        <>
          {[30, 90, 180, 365].map((d) => (
            <Toggle key={d} on={c.mode === "preset" && c.days === d}
              onClick={() => onChange({
                ...c, mode: "preset", days: d,
                from: new Date(Date.now() - d * 86400000).toISOString().slice(0, 10),
                to: new Date().toISOString().slice(0, 10),
              })}>
              {t("cb.presets", { n: d })}
            </Toggle>
          ))}
          <Toggle on={c.mode === "custom"} onClick={() => onChange({ ...c, mode: "custom" })}>
            {t("cb.custom")}
          </Toggle>
          {c.mode === "custom" ? (
            <>
              <input type="date" value={c.from} onChange={(e) => onChange({ ...c, from: e.target.value })}
                className="h-8 rounded-lg border border-[#D1D5DB] px-2 text-[13px] outline-none focus:border-[#15803D]" />
              <span className={sep}>→</span>
              <input type="date" value={c.to} onChange={(e) => onChange({ ...c, to: e.target.value })}
                className="h-8 rounded-lg border border-[#D1D5DB] px-2 text-[13px] outline-none focus:border-[#15803D]" />
              <span className={sep}>{t("cb.days", { n: periodDays(c) })}</span>
            </>
          ) : null}
        </>
      );

    case "recency":
      return (
        <>
          <span className={sep}>{t("cb.between")}</span>
          <input type="number" min={0} value={c.from} className={num}
            onChange={(e) => onChange({ ...c, from: Number(e.target.value) || 0 })} />
          <span className={sep}>{t("cb.and")}</span>
          <input type="number" min={0} value={c.to} className={num}
            onChange={(e) => onChange({ ...c, to: Number(e.target.value) || 0 })} />
          <span className={sep}>{t("cb.daysUnit")}</span>
        </>
      );

    case "product":
      return (
        <>
          {products.map((p) => (
            <Toggle key={p.id} on={c.productIds.includes(p.id)}
              onClick={() => onChange({
                ...c,
                productIds: c.productIds.includes(p.id)
                  ? c.productIds.filter((x) => x !== p.id) : [...c.productIds, p.id],
              })}>
              {p.name}
            </Toggle>
          ))}
        </>
      );

    case "city":
      return (
        <>
          {cities.slice(0, 8).map((city) => (
            <Toggle key={city} on={c.cities.includes(city)}
              onClick={() => onChange({
                ...c,
                cities: c.cities.includes(city) ? c.cities.filter((x) => x !== city) : [...c.cities, city],
              })}>
              {city}
            </Toggle>
          ))}
        </>
      );

    case "basket":
      return (
        <>
          <span className={sep}>{t("cb.atLeast")}</span>
          <input type="number" min={0} value={c.min} className={num}
            onChange={(e) => onChange({ ...c, min: Number(e.target.value) || 0 })} />
        </>
      );

    case "orderCount":
      return (
        <>
          <select value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as typeof c.op })}
            className="h-8 rounded-lg border border-[#D1D5DB] px-2 text-[13px] outline-none focus:border-[#15803D]">
            {(["gte", "eq", "lte"] as const).map((o) => <option key={o} value={o}>{t(`cb.ops.${o}`)}</option>)}
          </select>
          <input type="number" min={1} value={c.n} className={num}
            onChange={(e) => onChange({ ...c, n: Number(e.target.value) || 1 })} />
        </>
      );

    case "returns":
      return (
        <>
          {(["none", "any", "rateAtMost"] as const).map((m) => (
            <Toggle key={m} on={c.mode === m} onClick={() => onChange({ ...c, mode: m })}>
              {t(`cb.ret.${m}`)}
            </Toggle>
          ))}
          {c.mode === "rateAtMost" ? (
            <>
              <input type="number" min={0} max={100} value={c.rate} className={num}
                onChange={(e) => onChange({ ...c, rate: Number(e.target.value) || 0 })} />
              <span className={sep}>%</span>
            </>
          ) : null}
        </>
      );

    case "reason":
      return (
        <>
          {(["refus_client", "injoignable", "prix", "faux_numero", "livraison_impossible", "non_serieux"] as const).map((r) => (
            <Toggle key={r} on={c.reasons.includes(r)}
              onClick={() => onChange({
                ...c,
                reasons: c.reasons.includes(r) ? c.reasons.filter((x) => x !== r) : [...c.reasons, r],
              })}>
              {r.replace(/_/g, " ")}
            </Toggle>
          ))}
        </>
      );

    case "agent":
      return (
        <>
          {agents.map((a) => (
            <Toggle key={a.id} on={c.agentIds.includes(a.id)}
              onClick={() => onChange({
                ...c,
                agentIds: c.agentIds.includes(a.id) ? c.agentIds.filter((x) => x !== a.id) : [...c.agentIds, a.id],
              })}>
              {a.name}
            </Toggle>
          ))}
        </>
      );

    case "notOrderedSince":
    case "notInCampaign":
      return (
        <>
          <input type="number" min={0} value={c.days} className={num}
            onChange={(e) => onChange({ ...c, days: Number(e.target.value) || 0 })} />
          <span className={sep}>{t("cb.daysUnit")}</span>
        </>
      );

    case "notLostNotInterested":
      return <span className={sep}>{t("cb.always")}</span>;

    case "limit":
      return (
        <>
          <select value={c.sort} onChange={(e) => onChange({ ...c, sort: e.target.value as typeof c.sort })}
            className="h-8 rounded-lg border border-[#D1D5DB] px-2 text-[13px] outline-none focus:border-[#15803D]">
            {(["oldest", "newest", "basket"] as const).map((s) => (
              <option key={s} value={s}>{t(`cb.sort.${s}`)}</option>
            ))}
          </select>
          <span className={sep}>{t("cb.limitTo")}</span>
          <input type="number" min={1} value={c.n} className={num}
            onChange={(e) => onChange({ ...c, n: Number(e.target.value) || 1 })} />
        </>
      );
  }
}

/** Step 2: how the prospects are contacted, and with what words. */
function ChannelStep({
  draft, onDraft, preview, agents, locale,
}: {
  draft: CampaignDraft;
  onDraft: (p: Partial<CampaignDraft>) => void;
  preview: AudiencePreview | null;
  agents: { id: string; name: string }[];
  locale: string;
}) {
  const t = useTranslations("prospects.console");
  const sender = agents.find((a) => a.id === draft.agentIds[0])?.name ?? agents[0]?.name ?? "—";
  const sample = preview?.sample[0];

  const rendered = draft.waMessage
    .replace(/\{name\}/g, sample?.name ?? "—")
    .replace(/\{agent\}/g, sender)
    .replace(/\{offer\}/g, draft.offer || "—");

  const insert = (token: string) => onDraft({ waMessage: `${draft.waMessage}${token}` });

  return (
    <div className="flex flex-col gap-3.5">
      <Field label={t("cb.chanT")}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(["call", "wa", "wa_call"] as const).map((k) => {
            const on = draft.channel === k;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => onDraft({ channel: k })}
                className={`flex flex-col items-start gap-1 rounded-lg border px-3.5 py-3 text-start transition-colors ${
                  on ? "border-[1.5px] border-[#15803D] bg-[#F1FAF4]" : "border-[#D1D5DB] bg-white hover:bg-[#F9FAFB]"
                }`}
              >
                <b className="flex items-center gap-2 text-[14px] font-bold text-[#111827]">
                  {k === "call"
                    ? <Phone size={18} aria-hidden className={on ? "text-[#15803D]" : "text-[#6B7280]"} />
                    : <WhatsAppIcon size={18} className={on ? "text-[#16A34A]" : "text-[#6B7280]"} />}
                  {t(`cb.chan.${k}`)}
                </b>
                <span className="text-[12.5px] leading-[1.35] text-[#6B7280]">{t(`cb.chanD.${k}`)}</span>
              </button>
            );
          })}
        </div>
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("cb.name")}>
          <input className={INPUT} value={draft.name} onChange={(e) => onDraft({ name: e.target.value })} />
        </Field>
        <Field label={t("cb.offer")}>
          <input className={INPUT} value={draft.offer} onChange={(e) => onDraft({ offer: e.target.value })} />
        </Field>
      </div>

      {draft.channel !== "call" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.15fr_1fr]">
          <div className="flex flex-col gap-3">
            <Field label={t("cb.waMsg")}>
              <textarea
                value={draft.waMessage}
                onChange={(e) => onDraft({ waMessage: e.target.value })}
                dir="auto"
                className={`${INPUT} h-auto min-h-[120px] py-2 [unicode-bidi:plaintext]`}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12.5px] text-[#6B7280]">{t("cb.waVars")}</span>
              {["{name}", "{agent}", "{offer}"].map((v) => (
                <button key={v} type="button" onClick={() => insert(v)}
                  className="h-[26px] rounded-full border border-[#E5E7EB] bg-[#F3F4F6] px-2.5 font-mono text-[12px] text-[#374151] hover:bg-[#E5E7EB]">
                  {v}
                </button>
              ))}
            </div>

            <label className="inline-flex cursor-pointer items-center gap-2 text-[13.5px] text-[#111827]">
              <input type="checkbox" checked={draft.waImage} onChange={(e) => onDraft({ waImage: e.target.checked })}
                className="h-4 w-4 accent-[#15803D]" />
              <ImageIcon size={15} aria-hidden className="text-[#6B7280]" />
              {t("cb.waImg")}
            </label>

            <Field label={t("cb.waWho")}>
              <div className="flex flex-col gap-1.5">
                {(["agent", "api"] as const).map((m) => {
                  const on = draft.waSender === m;
                  return (
                    <label key={m} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 ${
                      on ? "border-[#15803D] bg-[#F1FAF4]" : "border-[#D1D5DB] bg-white"
                    }`}>
                      <input type="radio" name="wa-sender" checked={on} onChange={() => onDraft({ waSender: m })}
                        className="mt-0.5 accent-[#15803D]" />
                      <span className="min-w-0">
                        <b className="flex items-center gap-2 text-[13.5px] font-semibold text-[#111827]">
                          {t(m === "agent" ? "cb.waAgent" : "cb.waApi")}
                          {m === "api" ? (
                            <span className="rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[11.5px] font-medium text-[#6B7280]">
                              {t("cb.waApiOff")}
                            </span>
                          ) : null}
                        </b>
                        <span className="text-[12.5px] text-[#374151]">
                          {t(m === "agent" ? "cb.waAgentD" : "cb.waApiD")}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label={t("cb.waWindow")}>
                <select value={draft.waWindow} onChange={(e) => onDraft({ waWindow: e.target.value })} className={INPUT}>
                  {WINDOWS.map((w) => <option key={w} value={w}>{w} h</option>)}
                </select>
              </Field>
              <Field label={t("cb.waRate")} hint={t("cb.waRateD", { n: draft.waRate })}>
                <input type="number" min={5} max={120} value={draft.waRate} className={INPUT}
                  onChange={(e) => onDraft({ waRate: Number(e.target.value) || 5 })} />
              </Field>
              {draft.channel === "wa_call" ? (
                <Field label={t("cb.waThen")} hint={t("cb.waThenD")}>
                  <input type="number" min={1} max={96} value={draft.waFollowUpHours} className={INPUT}
                    onChange={(e) => onDraft({ waFollowUpHours: Number(e.target.value) || 1 })} />
                </Field>
              ) : null}
            </div>
          </div>

          {/* What the customer will actually see. */}
          <Field label={t("cb.waPrev")}>
            <div className="flex min-h-[200px] flex-col gap-1.5 rounded-xl bg-[#E5DDD5] px-3 pb-3 pt-3.5">
              <div className="flex items-center gap-2 text-[12.5px] text-[#374151]">
                <Avatar name={sender} size="sm" />
                <b className="font-semibold">{sender}</b>
                <span className="ms-auto text-[11px] text-[#6B7280]">10:42</span>
              </div>
              {draft.waImage ? (
                <div aria-hidden className="aspect-[4/3] w-[70%] rounded-t-[10px] border border-b-0 border-[#CBEBC3] bg-white" />
              ) : null}
              <p className={`relative m-0 w-[70%] whitespace-pre-wrap border border-[#CBEBC3] bg-[#DCF8C6] px-2.5 pb-4 pt-2 text-[13.5px] leading-[1.5] [unicode-bidi:plaintext] ${
                draft.waImage ? "rounded-b-[10px]" : "rounded-e-[10px] rounded-bs-[10px] rounded-be-[10px]"
              }`}>
                {rendered || "…"}
                <span aria-hidden className="absolute bottom-1 end-2 text-[10.5px] text-[#5B7A57]">10:42 ✓✓</span>
              </p>
              <p className="m-0 self-end rounded-[10px] rounded-te-[2px] bg-white px-2.5 py-2 text-[13.5px] text-[#111827]">
                {t("cb.waReply")}
                <small className="mt-1 block text-[11px] text-[#6B7280]">{t("cb.waReplyCap")}</small>
              </p>
            </div>
          </Field>
        </div>
      ) : null}

      {draft.channel !== "wa" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={draft.channel === "wa_call" ? t("cb.scriptFollow") : t("cb.script")}>
            <textarea value={draft.scriptFr} onChange={(e) => onDraft({ scriptFr: e.target.value })}
              className={`${INPUT} h-auto min-h-[96px] py-2`} placeholder={t("cb.scriptFr")} />
          </Field>
          <Field label={t("cb.scriptAr")} hint={t("cb.scriptHint")}>
            <textarea value={draft.scriptAr} onChange={(e) => onDraft({ scriptAr: e.target.value })} dir="rtl"
              className={`${INPUT} h-auto min-h-[96px] py-2`} />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

/** Step 3: who works it, and the recap the manager signs off. */
function DistributeStep({
  draft, onDraft, net, agents, locale,
}: {
  draft: CampaignDraft;
  onDraft: (p: Partial<CampaignDraft>) => void;
  net: number;
  agents: { id: string; name: string; open_leads: number }[];
  locale: string;
}) {
  const t = useTranslations("prospects.console");
  const today = Math.min(net, draft.agentIds.length * draft.cap);
  const windowHours = draft.waWindow === "10-20" ? 10 : draft.waWindow === "9-13" ? 4 : 7;
  const messagesToday = Math.min(net, draft.agentIds.length * draft.waRate * windowHours);

  const toggle = (id: string) =>
    onDraft({
      agentIds: draft.agentIds.includes(id)
        ? draft.agentIds.filter((x) => x !== id)
        : [...draft.agentIds, id],
    });

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <tr className="border-b border-[#F3F4F6] last:border-b-0">
      <td className="px-3 py-2 text-[13px] text-[#6B7280]">{label}</td>
      <td className="px-3 py-2 text-[13px] text-[#111827]">{children}</td>
    </tr>
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.2fr]">
      <div className="flex flex-col gap-3.5">
        <Field label={t("d.agents")}>
          <div className="overflow-hidden rounded-lg border border-[#E5E7EB]">
            {agents.map((a, i) => {
              const on = draft.agentIds.includes(a.id);
              return (
                <label key={a.id} className={`grid cursor-pointer grid-cols-[auto_28px_1fr] items-center gap-2.5 px-3 py-2.5 text-[13.5px] ${
                  i > 0 ? "border-t border-[#F3F4F6]" : ""
                } ${on ? "bg-[#F1FAF4]" : ""}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(a.id)} className="h-4 w-4 accent-[#15803D]" />
                  <Avatar name={a.name} size="sm" />
                  <span className="min-w-0">
                    <b className="block truncate font-semibold text-[#111827] [unicode-bidi:plaintext]">{a.name}</b>
                    <small className="text-[12px] text-[#6B7280]">{t("a.queue", { n: fmt(a.open_leads, locale) })}</small>
                  </span>
                </label>
              );
            })}
          </div>
        </Field>

        <Field label={t("d.cap")} hint={t("d.capd")}>
          <input type="number" min={1} max={500} value={draft.cap} className={`${INPUT} w-28`}
            onChange={(e) => onDraft({ cap: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })} />
        </Field>
      </div>

      <div className="flex flex-col gap-2.5">
        <Field label={t("cb.recap")}>
          <div className="overflow-hidden rounded-lg border border-[#E5E7EB]">
            <table className="w-full border-collapse">
              <tbody>
                <Row label={t("cb.rName")}>
                  <b className="font-semibold [unicode-bidi:plaintext]">{draft.name || "—"}</b>
                </Row>
                <Row label={t("cb.rAudience")}>
                  <b className="font-semibold tabular-nums">{fmt(net, locale)}</b>
                </Row>
                {draft.offer ? <Row label={t("cb.rOffer")}>{draft.offer}</Row> : null}
                <Row label={t("cb.rChan")}>
                  <span className="inline-flex items-center gap-1.5">
                    {draft.channel === "call"
                      ? <Phone size={14} aria-hidden className="text-[#6B7280]" />
                      : <WhatsAppIcon size={14} className="text-[#16A34A]" />}
                    {t(`cb.chan.${draft.channel}`)}
                    {draft.channel === "wa_call"
                      ? ` · ${t("cb.waThen")} ${draft.waFollowUpHours} ${t("cb.hours")}` : ""}
                  </span>
                </Row>
                {draft.channel !== "call" ? (
                  <Row label={t("cb.rMsgs")}>
                    <b className="font-semibold tabular-nums">{fmt(messagesToday, locale)}</b>
                  </Row>
                ) : null}
                <Row label={t("cb.rAgents")}>
                  {draft.agentIds.length > 0 ? (
                    <span className="[unicode-bidi:plaintext]">
                      {agents.filter((a) => draft.agentIds.includes(a.id)).map((a) => a.name).join(", ")}
                    </span>
                  ) : (
                    <span className="text-[#B91C1C]">{t("cb.pickAgents")}</span>
                  )}
                </Row>
                <Row label={t("cb.rToday")}>
                  <b className="font-semibold tabular-nums">{fmt(today, locale)}</b>
                  {net > today ? (
                    <small className="ms-1.5 text-[#6B7280]">{t("d.tomorrow", { n: fmt(net - today, locale) })}</small>
                  ) : null}
                </Row>
              </tbody>
            </table>
          </div>
        </Field>

        <Hint icon={ShieldCheck}>{t("camps.ruleDesc")}</Hint>
      </div>
    </div>
  );
}
