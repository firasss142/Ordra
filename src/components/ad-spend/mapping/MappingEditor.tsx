"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Check, Info, Loader2, Plus, X } from "lucide-react";
import { ProductAvatar } from "@/components/orders/ProductAvatar";
import { previewMapping, saveMapping, type SaveMappingResult } from "@/hooks/useAdSpendMapping";
import type {
  AdsetNodeDTO,
  CampaignNodeDTO,
  MappingPreviewDTO,
  MappingProductDTO,
  MappingTreeDTO,
} from "@/lib/ad-spend/mapping-types";
import {
  draftProblems,
  evenShares,
  manualSum,
  toDraftBody,
  type EditorDraft,
} from "@/lib/ad-spend/mapping-view";
import { fmtDay, fmtMoney, fmtPct, nextDay } from "./format";

/** Neutral ramp for split segments: a split is a correction, never a verdict. */
const RAMP = ["bg-ink-primary", "bg-ink-secondary", "bg-ink-muted", "bg-line-strong", "bg-line"];

type PreviewState =
  | { status: "idle" }
  | { status: "loading"; data: MappingPreviewDTO | null }
  | { status: "ready"; data: MappingPreviewDTO }
  | { status: "error"; message: string };

/**
 * One change: what the target sells, how its spend splits, and from when —
 * with what it will move shown before anything is written.
 *
 * Every change carries its own history decision, so there is one Apply per
 * change and no "save 5 changes". The preview comes from the server, computed
 * by the save's own code path; nothing here does money arithmetic beyond
 * checking that manual shares make 100.
 */
export function MappingEditor({
  tree,
  campaign,
  adset,
  marketId,
  currency,
  initial,
  today,
  onCancel,
  onSaved,
}: {
  tree: MappingTreeDTO;
  campaign: CampaignNodeDTO;
  adset: AdsetNodeDTO | null;
  marketId: string;
  currency: string;
  initial: EditorDraft;
  today: string;
  onCancel: () => void;
  onSaved: (result: SaveMappingResult) => void;
}) {
  const t = useTranslations("adSpend.mapping");
  const locale = useLocale();
  const [draft, setDraft] = useState<EditorDraft>(initial);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const products = useMemo(() => new Map(tree.products.map((p) => [p.id, p])), [tree.products]);
  const account = tree.accounts.find((a) => a.ad_account_id === campaign.ad_account_id) ?? tree.accounts[0];
  const problems = draftProblems(draft);
  const body = useMemo(
    () =>
      toDraftBody(draft, {
        marketId,
        adAccountId: campaign.ad_account_id,
        campaignId: campaign.id,
        adsetId: adset?.id ?? null,
      }),
    [draft, marketId, campaign.ad_account_id, campaign.id, adset?.id],
  );
  const bodyKey = JSON.stringify(body);

  // Debounced preview of the draft as it stands.
  useEffect(() => {
    if (problems.length > 0) {
      setPreview({ status: "idle" });
      return;
    }
    const ctrl = new AbortController();
    setPreview((p) => ({ status: "loading", data: p.status === "ready" ? p.data : p.status === "loading" ? p.data : null }));
    const timer = setTimeout(() => {
      previewMapping(JSON.parse(bodyKey), ctrl.signal)
        .then((data) => !ctrl.signal.aborted && setPreview({ status: "ready", data }))
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return;
          setPreview({ status: "error", message: e instanceof Error ? e.message : String(e) });
        });
    }, 250);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
    // bodyKey carries the whole draft; problems is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyKey]);

  const data = preview.status === "ready" ? preview.data : preview.status === "loading" ? preview.data : null;
  const shareOf = (productId: string) => data?.shares.find((s) => s.product_id === productId) ?? null;

  const setKind = (kind: EditorDraft["kind"]) => setDraft((d) => ({ ...d, kind }));
  const setMode = (split_mode: EditorDraft["split_mode"]) =>
    setDraft((d) => {
      if (split_mode !== "manual" || d.lines.every((l) => l.share_pct !== null)) return { ...d, split_mode };
      // Seed manual shares from the automatic split when there is one — the
      // natural starting point is what the data already says.
      const auto = d.lines.map((l) => shareOf(l.product_id)?.pct ?? null);
      const seeded =
        auto.every((x) => x !== null) && Math.round((auto as number[]).reduce((a, b) => a + b, 0)) === 100
          ? roundTo100(auto as number[])
          : evenShares(d.lines.length);
      return { ...d, split_mode, lines: d.lines.map((l, i) => ({ ...l, share_pct: seeded[i] })) };
    });
  const addProduct = (id: string) =>
    setDraft((d) => ({
      ...d,
      kind: "products",
      lines: [...d.lines, { product_id: id, share_pct: d.split_mode === "manual" ? 0 : null }],
    }));
  const removeProduct = (id: string) => setDraft((d) => ({ ...d, lines: d.lines.filter((l) => l.product_id !== id) }));
  const setShare = (id: string, value: string) =>
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l) => (l.product_id === id ? { ...l, share_pct: value === "" ? null : Number(value) } : l)),
    }));
  const spreadEvenly = () =>
    setDraft((d) => {
      const even = evenShares(d.lines.length);
      return { ...d, lines: d.lines.map((l, i) => ({ ...l, share_pct: even[i] })) };
    });

  const apply = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      onSaved(await saveMapping(body));
    } catch (e) {
      setSaveError(t("saveError", { reason: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSaving(false);
    }
  };

  const several = draft.kind === "products" && draft.lines.length > 1;
  const manual = several && draft.split_mode === "manual";
  const total = manualSum(draft.lines);

  const kinds: { kind: EditorDraft["kind"]; label: string; hint: string }[] = [
    ...(adset ? [{ kind: "inherit" as const, label: t("kindInherit"), hint: t("kindInheritHint", { campaign: campaign.name ?? campaign.id }) }] : []),
    { kind: "products", label: t("kindProducts"), hint: t("kindProductsHint") },
    { kind: "market_level", label: t("kindMarket"), hint: t("kindMarketHint") },
  ];

  return (
    <div className="flex flex-col">
      <div className="rounded-[12px] border-[1.5px] border-ink-primary">
        {/* 1 — what it sells */}
        <Step n={1} title={adset ? t("step1Adset") : t("step1Campaign")}>
          <div role="radiogroup" aria-label={adset ? t("step1Adset") : t("step1Campaign")} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${kinds.length}, minmax(0, 1fr))` }}>
            {kinds.map((k) => (
              <RadioCard key={k.kind} checked={draft.kind === k.kind} onSelect={() => setKind(k.kind)} label={k.label} hint={k.hint} />
            ))}
          </div>

          {draft.kind === "products" && (
            <div className="mt-3 rounded-[8px] border border-line">
              {draft.lines.map((l, i) => {
                const p = products.get(l.product_id);
                const name = p?.name ?? l.product_id;
                const share = shareOf(l.product_id);
                const orders =
                  several && draft.split_mode === "auto_orders" && share?.orders != null
                    ? t("ordersDuring", { count: share.orders })
                    : t("orders30", { count: p?.orders_30d ?? 0 });
                return (
                  <div key={l.product_id} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 ps-3 pe-2 py-2.5 border-t border-line-subtle first:border-t-0">
                    <ProductAvatar imageUrl={p?.image_url ?? null} productName={name} size={36} />
                    <div className="min-w-0">
                      <b className="block text-[13px] font-semibold text-ink-primary truncate"><bdi>{name}</bdi></b>
                      <small className="block text-[11.5px] text-ink-secondary truncate">
                        {[p?.sku, orders, p && !p.is_active ? t("inactiveProduct") : null].filter(Boolean).join(" · ")}
                      </small>
                    </div>
                    {manual ? (
                      <label className="inline-flex items-center h-[30px] rounded-[7px] border border-line-strong bg-surface-card focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand-bg">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          inputMode="decimal"
                          value={l.share_pct ?? ""}
                          onChange={(e) => setShare(l.product_id, e.target.value)}
                          aria-label={t("sharePct", { name })}
                          className="w-14 h-7 bg-transparent text-end ps-2 pe-1 text-[13px] font-semibold tabular-nums outline-none"
                        />
                        <span className="pe-2 ps-0.5 text-[12.5px] text-ink-secondary">%</span>
                      </label>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 min-w-[64px] justify-end text-[13px] font-bold tabular-nums">
                        {several && <i aria-hidden className={`w-2.5 h-2.5 rounded-[3px] ${RAMP[i % RAMP.length]}`} />}
                        {several ? (share && data?.range ? fmtPct(share.pct) : "—") : "100 %"}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeProduct(l.product_id)}
                      aria-label={t("removeProduct", { name })}
                      className="w-7 h-7 grid place-items-center rounded-[6px] text-ink-muted hover:bg-status-criticalBg hover:text-status-critical"
                    >
                      <X size={14} strokeWidth={2} />
                    </button>
                  </div>
                );
              })}
              <ProductPicker products={tree.products} taken={new Set(draft.lines.map((l) => l.product_id))} onPick={addProduct} />
            </div>
          )}
        </Step>

        {/* 2 — how it splits */}
        {several && (
          <Step n={2} title={t("step2")}>
            <div role="radiogroup" aria-label={t("step2")} className="grid grid-cols-2 gap-[3px] p-[3px] rounded-[10px] border border-line bg-surface-sunken">
              {(["auto_orders", "manual"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={draft.split_mode === m}
                  onClick={() => setMode(m)}
                  className={`text-start px-3 py-[7px] rounded-[7px] ${
                    draft.split_mode === m ? "bg-surface-card shadow-[0_1px_2px_rgba(16,24,40,.08),0_0_0_1px_#E1E3E5]" : "hover:bg-surface-card/60"
                  }`}
                >
                  <b className="block text-[13px] font-semibold text-ink-primary">{m === "manual" ? t("splitManualLabel") : t("splitAutoLabel")}</b>
                  <span className="block text-[11.5px] text-ink-secondary">{m === "manual" ? t("splitManualHint") : t("splitAutoHint")}</span>
                </button>
              ))}
            </div>

            <div className="flex h-3 mt-3.5 rounded-[6px] overflow-hidden gap-0.5 bg-line-subtle" aria-hidden>
              {draft.lines.map((l, i) => {
                const pct = manual ? l.share_pct ?? 0 : (shareOf(l.product_id)?.pct ?? 0);
                return <i key={l.product_id} className={`block h-full transition-[width] ${RAMP[i % RAMP.length]}`} style={{ width: `${Math.max(0, pct)}%` }} />;
              })}
            </div>

            {manual ? (
              <>
                <div className="flex items-center gap-2.5 mt-2.5 text-[12.5px]">
                  {total === 100 ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-status-success">
                      <Check size={13} strokeWidth={2.4} aria-hidden />
                      <span>{t("sumOk")}</span>
                    </span>
                  ) : total < 100 ? (
                    <span className="font-semibold text-status-critical">{t("sumLow", { total: fmtNum(total), missing: fmtNum(100 - total) })}</span>
                  ) : (
                    <span className="font-semibold text-status-critical">{t("sumHigh", { total: fmtNum(total), extra: fmtNum(total - 100) })}</span>
                  )}
                  <span className="flex-1" />
                  <button type="button" onClick={spreadEvenly} className="h-7 px-2.5 rounded-[7px] text-[12.5px] font-semibold text-ink-secondary hover:bg-surface-hover hover:text-ink-primary">
                    {t("even")}
                  </button>
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{t("manualExplain")}</p>
              </>
            ) : (
              <p className="mt-2.5 text-[12px] leading-relaxed text-ink-secondary">
                {t("autoExplain")} {data && !data.range ? t("autoNoSpend") : null}
              </p>
            )}
          </Step>
        )}

        {/* 3 — from when */}
        <Step n={several ? 3 : 2} title={t("step3")}>
          <div role="radiogroup" aria-label={t("step3")} className="grid grid-cols-2 gap-2">
            <RadioCard
              checked={draft.scope === "all"}
              onSelect={() => setDraft((d) => ({ ...d, scope: "all" }))}
              label={t("scopeAll")}
              hint={t("scopeAllHint")}
            />
            <div
              className={`flex gap-2.5 items-start p-3 rounded-[8px] border bg-surface-card ${
                draft.scope === "from" ? "border-brand shadow-[inset_0_0_0_1px_var(--brand)]" : "border-line"
              }`}
            >
              <RadioDot
                checked={draft.scope === "from"}
                label={t("scopeFrom")}
                onSelect={() => setDraft((d) => ({ ...d, scope: "from" }))}
              />
              <div className="min-w-0">
                <input
                  type="date"
                  aria-label={t("scopeFrom")}
                  value={draft.from}
                  max={today}
                  onChange={(e) => setDraft((d) => ({ ...d, scope: "from", from: e.target.value }))}
                  className="h-7 rounded-[6px] border border-line-strong px-1.5 text-[12.5px] font-medium text-ink-primary"
                />
                <span className="block mt-1 text-[11.5px] text-ink-secondary">{t("scopeFromHint")}</span>
              </div>
            </div>
          </div>

          <Impact
            state={preview}
            problems={problems.length > 0}
            products={products}
            currency={currency}
            historyFrom={account?.history_from ?? null}
            onStartAfter={(date) => setDraft((d) => ({ ...d, scope: "from", from: date }))}
          />
        </Step>
      </div>

      {/* sticky footer: what the click will do, then the click */}
      <div className="sticky bottom-0 -mx-6 mt-4 px-6 py-3 border-t border-line bg-surface-card flex items-center gap-2.5">
        <p className="text-[12.5px] text-ink-secondary tabular-nums min-w-0 truncate">
          {saveError ? (
            <span role="alert" className="text-status-critical">{saveError}</span>
          ) : data?.range && data.moved > 0 ? (
            t("footMoved", { amount: `${fmtMoney(data.moved)} ${currency}`, days: data.days })
          ) : data ? (
            t("footNothing")
          ) : null}
        </p>
        <span className="flex-1" />
        <button type="button" onClick={onCancel} className="h-[34px] px-3.5 rounded-[8px] border border-line-strong bg-surface-card text-[13px] font-semibold hover:bg-surface-hover">
          {t("cancel")}
        </button>
        <button
          type="button"
          onClick={apply}
          disabled={saving || problems.length > 0 || preview.status === "loading"}
          className="inline-flex items-center gap-1.5 h-[34px] px-3.5 rounded-[8px] bg-brand text-white text-[13px] font-semibold hover:bg-brand-hover disabled:opacity-45 disabled:cursor-not-allowed"
        >
          {saving && <Loader2 size={14} className="animate-spin" aria-hidden />}
          {saving ? t("applying") : t("apply")}
        </button>
      </div>
    </div>
  );
}

function Impact({
  state,
  problems: blocked,
  products: byId,
  currency: cur,
  historyFrom,
  onStartAfter,
}: {
  state: PreviewState;
  problems: boolean;
  products: Map<string, MappingProductDTO>;
  currency: string;
  historyFrom: string | null;
  onStartAfter: (date: string) => void;
}) {
  const t = useTranslations("adSpend.mapping");
  const locale = useLocale();
  if (blocked || state.status === "idle") return null;
  const shell = (children: ReactNode) => (
    <div className="mt-3.5 rounded-[10px] border border-line-subtle bg-surface-sunken overflow-hidden" aria-live="polite">
      {children}
    </div>
  );
  if (state.status === "error") {
    return shell(<p className="px-3.5 py-3 text-[12.5px] text-status-critical">{t("impactError", { reason: state.message })}</p>);
  }
  const p = state.status === "ready" ? state.data : state.data;
  if (!p) return shell(<p className="px-3.5 py-3 text-[12.5px] text-ink-secondary">{t("impactLoading")}</p>);
  if (!p.range) {
    return shell(<p className="px-3.5 py-3 text-[12.5px] text-ink-secondary">{historyFrom ? t("impactNothing") : t("noHistory")}</p>);
  }

  const rows = p.products.filter((r) => r.before !== r.after);
  const name = (id: string | null) => (id ? (byId.get(id)?.name ?? id) : t("marketRow"));
  return shell(
    <>
      <div className="flex items-baseline gap-2.5 px-3.5 pt-3 pb-2">
        <h5 className="text-[13px] font-semibold text-ink-primary">{t("impact")}</h5>
        {p.moved > 0 && (
          <span className="text-[12.5px] text-ink-secondary tabular-nums">
            {t("impactMoved", { amount: `${fmtMoney(p.moved)} ${cur}`, days: p.days })}
          </span>
        )}
        {state.status === "loading" && <Loader2 size={12} className="animate-spin text-ink-muted" aria-hidden />}
      </div>
      {rows.length === 0 ? (
        <p className="px-3.5 pb-3 text-[12.5px] text-ink-secondary">{t("impactNothing")}</p>
      ) : (
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="text-[11px] text-ink-secondary">
              <th className="text-start font-medium px-3.5 py-1 border-b border-line-subtle">{t("colProduct")}</th>
              <th className="text-end font-medium px-3.5 py-1 border-b border-line-subtle">{t("colBefore")}</th>
              <th className="border-b border-line-subtle" />
              <th className="text-end font-medium px-3.5 py-1 border-b border-line-subtle">{t("colAfter")}</th>
              <th className="text-end font-medium px-3.5 py-1 border-b border-line-subtle">{t("colDelta")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const prod = r.product_id ? byId.get(r.product_id) : null;
              const delta = r.after - r.before;
              return (
                <tr key={r.product_id ?? "market"} className="border-b border-line-subtle last:border-b-0">
                  <td className="px-3.5 py-1.5">
                    <span className="flex items-center gap-2 min-w-0">
                      {r.product_id ? (
                        <ProductAvatar imageUrl={prod?.image_url ?? null} productName={name(r.product_id)} size={20} />
                      ) : (
                        <span className="w-5 h-5 rounded-[4px] bg-line-subtle" aria-hidden />
                      )}
                      <span className="truncate max-w-[260px]"><bdi>{name(r.product_id)}</bdi></span>
                    </span>
                  </td>
                  <td className="px-3.5 py-1.5 text-end tabular-nums whitespace-nowrap">{fmtMoney(r.before)}</td>
                  <td className="text-ink-muted text-center rtl:-scale-x-100" aria-hidden>→</td>
                  <td className="px-3.5 py-1.5 text-end tabular-nums whitespace-nowrap font-semibold">{fmtMoney(r.after)}</td>
                  <td className="px-3.5 py-1.5 text-end tabular-nums whitespace-nowrap font-bold">
                    <bdi dir="ltr">{`${delta > 0 ? "+" : "−"}${fmtMoney(Math.abs(delta))}`}</bdi>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {p.clamped && p.history_from && (
        <Note tone="info" icon={<Info size={16} aria-hidden />}>
          {t("clamped", { date: fmtDay(p.history_from, locale, { year: true }) })}
        </Note>
      )}

      {p.statements.length > 0 ? (
        p.statements.map((s) => (
          <Note key={`${s.product_id}-${s.sequence_no}`} tone={s.settled ? "warn" : "info"} icon={<AlertTriangle size={16} aria-hidden />}>
            <b className="font-semibold">{s.settled ? t("statementSettled") : t("statementIssued")}</b>
            <br />
            {t("statementBody", {
              product: name(s.product_id),
              seq: s.sequence_no,
              from: fmtDay(s.period_start, locale),
              to: fmtDay(s.period_end, locale),
              delta: `${s.delta > 0 ? "+" : "−"}${fmtMoney(Math.abs(s.delta))} ${cur}`,
            })}
            {s.settled && (
              <div>
                <button
                  type="button"
                  onClick={() => onStartAfter(nextDay(s.period_end))}
                  className="mt-2 h-7 px-2.5 rounded-[7px] border border-ads-orange-line bg-surface-card text-[12px] font-semibold text-ads-orange-ink hover:bg-ads-orange-bg"
                >
                  {t("statementFix", { date: fmtDay(nextDay(s.period_end), locale, { long: true }) })}
                </button>
              </div>
            )}
          </Note>
        ))
      ) : rows.length > 0 ? (
        <Note tone="ok" icon={<Check size={16} aria-hidden />}>{t("noStatement")}</Note>
      ) : null}
    </>,
  );
}

/* ─────────────────────────── pieces ─────────────────────────── */

function fmtNum(n: number): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

/** Round shares to the cent so they make exactly 100 (largest remainder). */
function roundTo100(pcts: number[]): number[] {
  const cents = pcts.map((p) => Math.floor(p * 100));
  let left = 10_000 - cents.reduce((a, b) => a + b, 0);
  const order = pcts.map((p, i) => ({ i, f: p * 100 - Math.floor(p * 100) })).sort((a, b) => b.f - a.f);
  for (let k = 0; left > 0 && k < order.length; k++, left--) cents[order[k].i] += 1;
  return cents.map((c) => c / 100);
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="px-[18px] py-4 border-t border-line-subtle first:border-t-0">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-5 h-5 rounded-full bg-ink-primary text-white text-[11.5px] font-bold grid place-items-center" aria-hidden>
          {n}
        </span>
        <b className="text-[13.5px] font-semibold text-ink-primary">{title}</b>
      </div>
      {children}
    </section>
  );
}

function RadioCard({ checked, onSelect, label, hint }: { checked: boolean; onSelect: () => void; label: string; hint: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={`flex gap-2.5 items-start text-start p-3 rounded-[8px] border bg-surface-card ${
        checked ? "border-brand shadow-[inset_0_0_0_1px_var(--brand)]" : "border-line hover:border-line-strong"
      }`}
    >
      <Dot checked={checked} />
      <span>
        <b className="block text-[13px] font-semibold text-ink-primary">{label}</b>
        <span className="block text-[11.5px] leading-snug text-ink-secondary mt-px">{hint}</span>
      </span>
    </button>
  );
}

/** A radio whose options sit beside it (the date input must not live inside a button). */
function RadioDot({ checked, onSelect, label }: { checked: boolean; onSelect: () => void; label: string }) {
  return (
    <button type="button" role="radio" aria-checked={checked} onClick={onSelect} className="flex gap-2.5 items-center text-start">
      <Dot checked={checked} />
      <b className="text-[13px] font-semibold text-ink-primary whitespace-nowrap">{label}</b>
    </button>
  );
}

function Dot({ checked }: { checked: boolean }) {
  return (
    <span aria-hidden className={`flex-none mt-px w-4 h-4 rounded-full border-[1.5px] grid place-items-center ${checked ? "border-brand" : "border-line-strong"}`}>
      {checked && <span className="w-2 h-2 rounded-full bg-brand" />}
    </span>
  );
}

function Note({ tone, icon, children }: { tone: "warn" | "info" | "ok"; icon: ReactNode; children: ReactNode }) {
  const cls =
    tone === "warn"
      ? "bg-ads-orange-bg text-ads-orange-ink border-ads-orange-line"
      : "bg-surface-card text-ink-secondary border-line-subtle";
  return (
    <div className={`flex gap-2.5 px-3.5 py-3 border-t text-[12.5px] leading-relaxed ${cls}`}>
      <span className="flex-none mt-0.5">{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ProductPicker({
  products,
  taken,
  onPick,
}: {
  products: MappingProductDTO[];
  taken: Set<string>;
  onPick: (id: string) => void;
}) {
  const t = useTranslations("adSpend.mapping");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Opened near the bottom of the pane, the list would sit behind the sticky
  // footer: bring it into view (scroll-mb clears the footer).
  useEffect(() => {
    if (open) popRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const q = query.trim().toLocaleLowerCase();
  const match = (p: MappingProductDTO) => !q || p.name.toLocaleLowerCase().includes(q) || (p.sku ?? "").toLocaleLowerCase().includes(q);
  const active = products.filter((p) => p.is_active && match(p));
  const inactive = q ? products.filter((p) => !p.is_active && match(p)) : [];

  const option = (p: MappingProductDTO) => {
    const isTaken = taken.has(p.id);
    return (
      <button
        key={p.id}
        type="button"
        role="option"
        aria-selected={isTaken}
        disabled={isTaken}
        onClick={() => {
          onPick(p.id);
          setOpen(false);
          setQuery("");
        }}
        className="w-full grid grid-cols-[auto_1fr_auto] gap-2.5 items-center px-3 py-2 text-start hover:bg-surface-hover disabled:opacity-45 disabled:cursor-default"
      >
        <ProductAvatar imageUrl={p.image_url} productName={p.name} size={32} />
        <span className="min-w-0">
          <b className="block text-[13px] font-semibold text-ink-primary truncate"><bdi>{p.name}</bdi></b>
          <small className="block text-[11.5px] text-ink-secondary">{p.sku ?? ""}</small>
        </span>
        <span className="text-[11.5px] text-ink-secondary tabular-nums whitespace-nowrap">
          {isTaken ? "✓" : t("orders30", { count: p.orders_30d })}
        </span>
      </button>
    );
  };

  return (
    <div ref={boxRef} className="relative border-t border-line-subtle first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="w-full flex items-center gap-2 px-3 py-2.5 text-[13px] font-semibold text-brand hover:bg-surface-hover"
      >
        <Plus size={15} strokeWidth={2.2} aria-hidden />
        {t("addProduct")}
      </button>
      {open && (
        <div
          ref={popRef}
          className="absolute top-[calc(100%+4px)] start-2 z-20 scroll-mb-24 w-[420px] max-w-[calc(100%-16px)] rounded-[10px] border border-line bg-surface-card shadow-floating overflow-hidden"
          onKeyDown={(e) => {
            // Escape closes the picker, not the whole drawer.
            if (e.key === "Escape") {
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
              setOpen(false);
            }
          }}
        >
          <div className="p-2 border-b border-line-subtle">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("findProduct")}
              aria-label={t("findProduct")}
              className="w-full h-8 rounded-[7px] border border-line px-2.5 text-[13px] outline-none focus:border-brand"
            />
          </div>
          <div role="listbox" aria-label={t("addProduct")} className="max-h-[300px] overflow-y-auto py-1">
            {active.length > 0 && <p className="px-3 pt-2 pb-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-ink-muted">{t("activeProducts")}</p>}
            {active.map(option)}
            {inactive.length > 0 && <p className="px-3 pt-2 pb-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-ink-muted">{t("inactiveProducts")}</p>}
            {inactive.map(option)}
            {active.length === 0 && inactive.length === 0 && (
              <p className="px-3 py-3 text-[12.5px] text-ink-secondary">{t("noProductFound")}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
