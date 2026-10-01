"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Check, ChevronLeft, CircleHelp, Clock, Globe, Info, Loader2, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { previewMapping, saveMapping, type SaveMappingResult } from "@/hooks/useAdSpendMapping";
import type {
  AdsetNodeDTO,
  CampaignNodeDTO,
  MappingPreviewDTO,
  MappingProductDTO,
} from "@/lib/ad-spend/mapping-types";
import {
  adsetOwnVersion,
  campaignVersion,
  draftFor,
  draftProblems,
  evenShares,
  isUnchanged,
  manualSum,
  toDraftBody,
  wholeShares,
  type EditorDraft,
} from "@/lib/ad-spend/mapping-view";
import { GeneralAsk } from "./MappingDetail";
import { SpendBars } from "./SpendBars";
import { ProductThumb, VersionLabel } from "./VersionLabel";
import { fmtDay, fmtMoney, fmtPct, nextDay } from "./format";

/** Neutral ramp for split segments: a split is a correction, never a verdict. */
const RAMP = ["bg-ink-primary", "bg-ink-secondary", "bg-ink-muted", "bg-line-strong", "bg-line"];

type PreviewState =
  | { status: "idle" }
  | { status: "loading"; data: MappingPreviewDTO | null }
  | { status: "ready"; data: MappingPreviewDTO }
  | { status: "error"; message: string };

const b = (chunks: ReactNode) => <b className="font-semibold text-ink-primary">{chunks}</b>;

/**
 * One change, as three plain questions — which products, how to split, from
 * when — then what it will move, shown before anything is written. The
 * preview comes from the server, computed by the save's own code path;
 * nothing here does money arithmetic beyond checking that fixed shares make 100.
 *
 * Enregistrer stays grey while nothing differs, and the footer says why.
 */
export function MappingEditor({
  campaign,
  adset,
  products,
  productList,
  historyFrom,
  marketId,
  currency,
  today,
  onCancel,
  onSaved,
}: {
  campaign: CampaignNodeDTO;
  adset: AdsetNodeDTO | null;
  products: Map<string, MappingProductDTO>;
  productList: MappingProductDTO[];
  historyFrom: string | null;
  marketId: string;
  currency: string;
  today: string;
  onCancel: () => void;
  onSaved: (result: SaveMappingResult) => void;
}) {
  const t = useTranslations("adSpend.mapping");
  const locale = useLocale();
  const campaignNow = campaignVersion(campaign);
  const [draft, setDraft] = useState<EditorDraft>(() =>
    draftFor({ own: adset ? adsetOwnVersion(adset) : campaignNow, campaign: campaignNow, isAdset: !!adset }, today),
  );
  // A campaign with no product opens on the product list: that is the only question it has.
  const [picker, setPicker] = useState(!adset && !campaignNow);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const node = adset ?? campaign;
  const problems = draftProblems(draft);
  const unchanged = isUnchanged(draft, node.versions);
  const blocked = problems.length > 0 || unchanged;
  const body = useMemo(
    () => toDraftBody(draft, { marketId, adAccountId: campaign.ad_account_id, campaignId: campaign.id, adsetId: adset?.id ?? null }),
    [draft, marketId, campaign.ad_account_id, campaign.id, adset?.id],
  );
  const bodyKey = JSON.stringify(body);

  // Debounced preview of the draft as it stands — only when it could be saved.
  useEffect(() => {
    if (blocked) {
      setPreview({ status: "idle" });
      return;
    }
    const ctrl = new AbortController();
    setPreview((p) => ({ status: "loading", data: p.status === "ready" || p.status === "loading" ? p.data : null }));
    const timer = setTimeout(() => {
      previewMapping(JSON.parse(bodyKey), ctrl.signal)
        .then((data) => !ctrl.signal.aborted && setPreview({ status: "ready", data }))
        .catch((e: unknown) => {
          if (!ctrl.signal.aborted) setPreview({ status: "error", message: e instanceof Error ? e.message : String(e) });
        });
    }, 250);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [bodyKey, blocked]);

  const data = preview.status === "ready" || preview.status === "loading" ? preview.data : null;
  const shareOf = (id: string) => data?.shares.find((s) => s.product_id === id) ?? null;

  const several = !draft.follow && draft.kind === "products" && draft.lines.length > 1;
  const manual = several && draft.split_mode === "manual";
  const total = manualSum(draft.lines);

  const setMode = (split_mode: EditorDraft["split_mode"]) =>
    setDraft((d) => {
      if (split_mode !== "manual" || d.lines.every((l) => l.share_pct !== null)) return { ...d, split_mode };
      // Fixed shares start from what the orders already say, when the preview knows it.
      const auto = d.lines.map((l) => shareOf(l.product_id)?.pct ?? null);
      const seeded =
        auto.every((x) => x !== null) && Math.round((auto as number[]).reduce((a, x) => a + x, 0)) === 100
          ? wholeShares(auto as number[])
          : evenShares(d.lines.length);
      return { ...d, split_mode, lines: d.lines.map((l, i) => ({ ...l, share_pct: seeded[i] })) };
    });
  const addProduct = (id: string) =>
    setDraft((d) => ({ ...d, kind: "products", lines: [...d.lines, { product_id: id, share_pct: d.split_mode === "manual" ? 0 : null }] }));
  const removeProduct = (id: string) => setDraft((d) => ({ ...d, lines: d.lines.filter((l) => l.product_id !== id) }));
  const setShare = (id: string, value: string) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.product_id === id ? { ...l, share_pct: value === "" ? null : Number(value) } : l)) }));
  const spreadEvenly = () =>
    setDraft((d) => {
      const even = evenShares(d.lines.length);
      return { ...d, lines: d.lines.map((l, i) => ({ ...l, share_pct: even[i] })) };
    });

  const save = async () => {
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

  const fmtNum = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  const sumText = total < 100 ? t("sumLow", { missing: fmtNum(100 - total) }) : t("sumHigh", { extra: fmtNum(total - 100) });

  let foot: ReactNode = null;
  if (saveError) foot = <span role="alert" className="text-status-critical">{saveError}</span>;
  else if (problems.includes("no_products")) foot = t("footNeed");
  else if (problems.includes("manual_sum")) foot = <span className="font-semibold text-status-critical">{sumText}</span>;
  else if (problems.includes("no_date")) foot = t("footDate");
  else if (unchanged) foot = t("footSame");
  else if (data) foot = data.moved > 0 ? t.rich("footMoved", { amount: `${fmtMoney(data.moved)} ${currency}`, b }) : t("footNone");

  const questions: ReactNode[] = [];

  if (!(adset && draft.follow)) {
    questions.push(
      <Question key="products" divided={questions.length > 0} title={adset ? t("qProductsAdset") : t("qProducts")}>
        {draft.kind === "market_level" ? (
          <>
            <div className="rounded-[12px] border border-line bg-surface-card overflow-hidden">
              <GeneralAsk />
            </div>
            <p className="text-[12.5px] text-ink-secondary">
              <LinkButton onClick={() => setDraft((d) => ({ ...d, kind: "products" }))}>{t("toProducts")}</LinkButton>
            </p>
          </>
        ) : (
          <>
            <div className="rounded-[12px] border border-line bg-surface-card">
              {draft.lines.map((l, i) => {
                const p = products.get(l.product_id);
                const name = p?.name ?? l.product_id;
                const share = shareOf(l.product_id);
                const orders =
                  several && !manual && share?.orders != null
                    ? t("ordersRun", { count: share.orders })
                    : t("orders30", { count: p?.orders_30d ?? 0 });
                return (
                  <div key={l.product_id} className="grid grid-cols-[40px_minmax(0,1fr)_auto_28px] gap-3 items-center py-2.5 ps-3 pe-2 border-t border-line-subtle first:border-t-0">
                    <ProductThumb id={l.product_id} products={products} size={40} />
                    <div className="min-w-0">
                      <b className="block truncate text-[13.5px] font-semibold text-ink-primary">
                        <bdi>{name}</bdi>
                      </b>
                      <small className="block mt-px text-[12px] text-ink-secondary">{p && !p.is_active ? t("inactiveProduct") : orders}</small>
                    </div>
                    {manual ? (
                      <label className="inline-flex items-center h-8 rounded-[8px] border border-line-strong bg-surface-card focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand-bg">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          inputMode="decimal"
                          value={l.share_pct ?? ""}
                          onChange={(e) => setShare(l.product_id, e.target.value)}
                          aria-label={t("sharePct", { name })}
                          className="w-[46px] bg-transparent ps-2 pe-0.5 text-end text-[13.5px] font-semibold tabular-nums outline-none"
                        />
                        <span className="ps-0.5 pe-2 text-[12.5px] text-ink-secondary">%</span>
                      </label>
                    ) : (
                      <span className={`inline-flex items-center justify-end gap-[7px] min-w-16 whitespace-nowrap tabular-nums text-[14px] ${several && !(share && data?.range) ? "font-medium text-ink-muted" : "font-bold text-ink-primary"}`}>
                        {several && <i aria-hidden className={`w-2.5 h-2.5 rounded-[3px] ${RAMP[i % RAMP.length]}`} />}
                        {several ? (share && data?.range ? fmtPct(share.pct) : "—") : "100 %"}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeProduct(l.product_id)}
                      aria-label={t("removeProduct", { name })}
                      className="w-7 h-7 grid place-items-center rounded-[7px] text-ink-muted hover:bg-status-criticalBg hover:text-status-critical"
                    >
                      <X size={15} aria-hidden />
                    </button>
                  </div>
                );
              })}
              <ProductPicker
                open={picker}
                onOpenChange={setPicker}
                empty={draft.lines.length === 0}
                products={productList}
                taken={new Set(draft.lines.map((l) => l.product_id))}
                onPick={addProduct}
              />
            </div>
            <p className="text-[12.5px] text-ink-secondary">
              {t.rich("toGeneral", {
                go: (chunks) => (
                  <LinkButton
                    onClick={() => {
                      setPicker(false);
                      setDraft((d) => ({ ...d, kind: "market_level" }));
                    }}
                  >
                    {chunks}
                  </LinkButton>
                ),
              })}
            </p>
          </>
        )}
      </Question>,
    );

    if (several) {
      questions.push(
        <Question key="split" divided={questions.length > 0} title={t("qSplit")}>
          <div role="radiogroup" aria-label={t("qSplit")} className="grid grid-cols-2 gap-0.5 p-[3px] rounded-[10px] bg-line-subtle">
            {(["auto_orders", "manual"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={draft.split_mode === m}
                onClick={() => setMode(m)}
                className={`h-8 rounded-[8px] text-center text-[13px] font-semibold ${
                  draft.split_mode === m
                    ? "bg-surface-card text-ink-primary shadow-[0_1px_2px_rgba(16,24,40,.08),0_0_0_1px_rgba(16,24,40,.05)]"
                    : "text-ink-secondary hover:text-ink-primary"
                }`}
              >
                {m === "manual" ? t("splitManual") : t("splitAuto")}
              </button>
            ))}
          </div>
          <div aria-hidden className="flex h-2.5 gap-0.5 rounded-[5px] overflow-hidden bg-line-subtle">
            {draft.lines.map((l, i) => {
              const w = manual ? (l.share_pct ?? 0) : (shareOf(l.product_id)?.pct ?? 100 / draft.lines.length);
              return <i key={l.product_id} className={`block h-full transition-[width] ${RAMP[i % RAMP.length]}`} style={{ width: `${Math.max(0, w)}%` }} />;
            })}
          </div>
          {manual ? (
            <>
              <div className="flex items-center gap-2.5 text-[12.5px]">
                {total === 100 ? (
                  <span className="inline-flex items-center gap-[5px] font-semibold text-status-success">
                    <Check size={14} strokeWidth={2.4} aria-hidden />
                    {t("sumOk")}
                  </span>
                ) : (
                  <span className="font-semibold text-status-critical">{sumText}</span>
                )}
                <span className="flex-1" />
                <Button variant="ghost" className="!h-7 !px-2.5 !text-[12.5px] !text-ink-secondary" onClick={spreadEvenly}>
                  {t("even")}
                </Button>
              </div>
              <p className="text-[12.5px] leading-relaxed text-ink-secondary">{t("splitManualHint")}</p>
            </>
          ) : (
            <p className="text-[12.5px] leading-relaxed text-ink-secondary">{t("splitAutoHint", { count: draft.lines.length })}</p>
          )}
        </Question>,
      );
    }
  }

  questions.push(
    <Question key="when" divided={questions.length > 0} title={t("qWhen")}>
      <div role="radiogroup" aria-label={t("qWhen")} className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <ScopeOption checked={draft.scope === "all"} onSelect={() => setDraft((d) => ({ ...d, scope: "all" }))} label={t("scopeAll")} hint={t("scopeAllHint")} />
        <ScopeOption checked={draft.scope === "from"} onSelect={() => setDraft((d) => ({ ...d, scope: "from" }))} label={t("scopeFrom")} hint={t("scopeFromHint")}>
          {draft.scope === "from" && (
            <input
              type="date"
              aria-label={t("scopeFrom")}
              value={draft.from}
              min={historyFrom ?? undefined}
              max={today}
              onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
              className="mt-2 ms-7 h-8 rounded-[8px] border border-line-strong bg-surface-card px-2 text-[13px] text-ink-primary outline-none focus:border-brand focus:ring-[3px] focus:ring-brand-bg"
            />
          )}
        </ScopeOption>
      </div>
      {node.daily.length > 0 && (
        <SpendBars
          daily={node.daily}
          from={node.daily[0][0]}
          to={node.daily[node.daily.length - 1][0]}
          currency={currency}
          label={t("qWhen")}
          cut={{ from: draft.scope === "from" && /^\d{4}-\d{2}-\d{2}$/.test(draft.from) ? draft.from : null }}
        />
      )}
    </Question>,
  );

  if (!blocked) {
    questions.push(
      <Question key="impact" divided={questions.length > 0} title={t("qImpact")}>
        <Impact
          state={preview}
          products={products}
          currency={currency}
          historyFrom={historyFrom}
          canStartAfter={(day) => draft.scope === "all" || draft.from < day}
          onStartAfter={(day) => setDraft((d) => ({ ...d, scope: "from", from: day }))}
        />
      </Question>,
    );
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-7 md:px-7 md:pt-6 md:pb-9">
        <div className="max-w-[660px] flex flex-col gap-7">
          <div>
            <button
              type="button"
              onClick={onCancel}
              className="-ms-1 inline-flex items-center gap-1 h-7 ps-1 pe-2 rounded-[7px] text-[13px] font-semibold text-ink-secondary hover:bg-line-subtle hover:text-ink-primary max-w-full"
            >
              <ChevronLeft size={16} strokeWidth={2.2} className="flex-none rtl:-scale-x-100" aria-hidden />
              <span className="truncate">{adset ? (campaign.name ?? campaign.id) : t("back")}</span>
            </button>
            <p className="mt-2.5 text-[12.5px] text-ink-secondary">
              {adset ? t("kickerAdset", { campaign: campaign.name ?? campaign.id }) : t("kickerEdit")}
            </p>
            <h3 className="mt-0.5 text-[20px] font-bold tracking-[-0.01em] text-ink-primary break-words">{node.name ?? node.id}</h3>
          </div>

          {adset && (
            <button
              type="button"
              role="switch"
              aria-checked={draft.follow}
              onClick={() => setDraft((d) => ({ ...d, follow: !d.follow }))}
              className="flex gap-3 items-start w-full p-3.5 rounded-[12px] border border-line bg-surface-card text-start hover:border-line-strong"
            >
              <span aria-hidden className={`relative flex-none mt-px w-9 h-5 rounded-[10px] transition-colors ${draft.follow ? "bg-brand" : "bg-line-strong"}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.2)] transition-[inset-inline-start] ${draft.follow ? "start-[18px]" : "start-0.5"}`} />
              </span>
              <span className="min-w-0">
                <b className="block text-[13.5px] font-semibold text-ink-primary">{t("followSwitch")}</b>
                <small className="mt-[3px] flex items-center gap-1.5 min-w-0 text-[12.5px] text-ink-secondary">
                  {t("followNow")} {campaignNow ? <VersionLabel version={campaignNow} products={products} /> : <span>{t("noProduct")}</span>}
                </small>
              </span>
            </button>
          )}

          {questions}
        </div>
      </div>

      <div className="flex-none flex flex-wrap md:flex-nowrap items-center gap-2.5 px-4 py-2.5 md:px-7 md:py-3 border-t border-line bg-surface-card">
        <p className="basis-full md:basis-auto flex-1 min-w-0 text-[13px] text-ink-secondary" aria-live="polite">
          {foot}
        </p>
        <Button variant="secondary" className="flex-1 md:flex-none" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button
          variant="primary"
          className="flex-1 md:flex-none"
          onClick={save}
          disabled={saving || blocked || preview.status === "loading" || preview.status === "idle"}
        >
          {saving && <Loader2 size={14} className="animate-spin" aria-hidden />}
          {saving ? t("saving") : t("save")}
        </Button>
      </div>
    </>
  );
}

/* ─────────────────────────── the impact ─────────────────────────── */

function Impact({
  state,
  products,
  currency,
  historyFrom,
  canStartAfter,
  onStartAfter,
}: {
  state: PreviewState;
  products: Map<string, MappingProductDTO>;
  currency: string;
  historyFrom: string | null;
  canStartAfter: (day: string) => boolean;
  onStartAfter: (day: string) => void;
}) {
  const t = useTranslations("adSpend.mapping");
  const locale = useLocale();
  const shell = (children: ReactNode) => (
    <div className="rounded-[12px] border border-line bg-surface-card overflow-hidden" aria-live="polite">
      {children}
    </div>
  );

  if (state.status === "error") return shell(<Note icon={<AlertTriangle size={16} />}>{t("impactError", { reason: state.message })}</Note>);
  const p = state.status === "ready" || state.status === "loading" ? state.data : null;
  if (!p) return shell(<Note icon={<Loader2 size={16} className="animate-spin" />}>{t("impactLoading")}</Note>);
  if (!p.range) return shell(<Note icon={<Clock size={16} />}>{historyFrom ? t("impactNone") : t("noHistory")}</Note>);

  const rows = p.products.filter((r) => r.before !== r.after);
  const label = (r: MappingPreviewDTO["products"][number]) =>
    r.product_id ? (products.get(r.product_id)?.name ?? r.product_id) : r.bucket === "general" ? t("rowGeneral") : t("rowNone");

  return shell(
    <>
      {rows.length === 0 ? (
        <Note icon={<Clock size={16} />}>{t("impactNone")}</Note>
      ) : (
        rows.map((r) => {
          const delta = r.after - r.before;
          return (
            <div
              key={r.product_id ?? r.bucket}
              className="grid grid-cols-[28px_minmax(0,1fr)_auto] sm:grid-cols-[28px_minmax(0,1fr)_auto_auto] gap-3 items-center px-3.5 py-2.5 border-t border-line-subtle first:border-t-0"
            >
              {r.product_id ? (
                <ProductThumb id={r.product_id} products={products} size={28} />
              ) : r.bucket === "general" ? (
                <span aria-hidden className="w-7 h-7 grid place-items-center rounded-[7px] bg-line-subtle text-ink-secondary"><Globe size={14} /></span>
              ) : (
                <span aria-hidden className="w-7 h-7 grid place-items-center rounded-[7px] border-[1.5px] border-dashed border-line-strong text-ink-muted"><CircleHelp size={14} /></span>
              )}
              <span className="truncate text-[13px] font-semibold text-ink-primary">
                <bdi>{label(r)}</bdi>
              </span>
              <span className="hidden sm:block text-[12.5px] text-ink-secondary whitespace-nowrap tabular-nums">
                {fmtMoney(r.before)} <span className="inline-block rtl:-scale-x-100">→</span> <b className="font-semibold text-ink-primary">{fmtMoney(r.after)}</b> {currency}
              </span>
              <span dir="ltr" className="min-w-16 px-2 py-0.5 rounded-full bg-line-subtle text-center text-[12.5px] font-bold tabular-nums whitespace-nowrap">
                {`${delta > 0 ? "+" : "−"}${fmtMoney(Math.abs(delta))}`}
              </span>
            </div>
          );
        })
      )}

      {p.clamped && p.history_from && <Note icon={<Info size={16} />}>{t("clamped", { date: fmtDay(p.history_from, locale, { year: true }) })}</Note>}

      {p.statements.map((s) => {
        const after = nextDay(s.period_end);
        const name = products.get(s.product_id)?.name ?? s.product_id;
        return (
          <Note key={`${s.product_id}-${s.sequence_no}`} warn={s.settled} icon={<AlertTriangle size={16} />}>
            <b className={`font-semibold ${s.settled ? "text-[#78350F]" : "text-ink-primary"}`}>{s.settled ? t("statementSettled") : t("statementIssued")}</b>
            <br />
            {t.rich("statementBody", {
              product: name,
              seq: s.sequence_no,
              from: fmtDay(s.period_start, locale),
              to: fmtDay(s.period_end, locale),
              direction: s.delta > 0 ? "add" : "remove",
              amount: `${fmtMoney(Math.abs(s.delta))} ${currency}`,
              b: (chunks) => <b className="font-semibold">{chunks}</b>,
              bdi: (chunks) => <bdi>{chunks}</bdi>,
            })}
            {s.settled && canStartAfter(after) && (
              <div>
                <Button
                  variant="secondary"
                  className="mt-2 !h-7 !px-2.5 !text-[12.5px] !border-ads-orange-line !text-[#78350F]"
                  onClick={() => onStartAfter(after)}
                >
                  {t("statementFix", { date: fmtDay(after, locale) })}
                </Button>
              </div>
            )}
          </Note>
        );
      })}

      {rows.length > 0 && p.statements.length === 0 && (
        <Note icon={<Check size={16} strokeWidth={2.4} className="text-status-success" />}>{t("noStatement")}</Note>
      )}
    </>,
  );
}

/* ─────────────────────────── pieces ─────────────────────────── */

function Question({ title, divided, children }: { title: string; divided: boolean; children: ReactNode }) {
  return (
    <section className={`flex flex-col gap-3 ${divided ? "pt-6 border-t border-line-subtle" : ""}`}>
      <h4 className="text-[15px] font-semibold text-ink-primary">{title}</h4>
      {children}
    </section>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-semibold text-ink-primary underline decoration-line-strong underline-offset-[3px] hover:decoration-ink-primary"
    >
      {children}
    </button>
  );
}

/** A choice card. The date field sits beside the radio, never inside it. */
function ScopeOption({
  checked,
  onSelect,
  label,
  hint,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
  hint: string;
  children?: ReactNode;
}) {
  return (
    <div className={`px-3.5 py-3 rounded-[12px] border bg-surface-card ${checked ? "border-brand shadow-[inset_0_0_0_1px_var(--brand)]" : "border-line hover:border-line-strong"}`}>
      <button type="button" role="radio" aria-checked={checked} onClick={onSelect} className="flex gap-2.5 items-start w-full text-start">
        <span aria-hidden className={`flex-none mt-px w-[18px] h-[18px] rounded-full border-[1.5px] grid place-items-center ${checked ? "border-brand" : "border-line-strong"}`}>
          {checked && <span className="w-[9px] h-[9px] rounded-full bg-brand" />}
        </span>
        <span>
          <b className="block text-[13.5px] font-semibold text-ink-primary">{label}</b>
          <span className="block mt-px text-[12.5px] text-ink-secondary">{hint}</span>
        </span>
      </button>
      {children}
    </div>
  );
}

function Note({ icon, warn = false, children }: { icon: ReactNode; warn?: boolean; children: ReactNode }) {
  return (
    <div
      className={`flex gap-2.5 px-3.5 py-3 border-t first:border-t-0 text-[12.5px] leading-normal ${
        warn ? "bg-[#FFFBEB] border-ads-orange-line text-[#92400E]" : "border-line-subtle text-ink-secondary"
      }`}
    >
      <span className="flex-none mt-px" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ProductPicker({
  open,
  onOpenChange,
  empty,
  products,
  taken,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  empty: boolean;
  products: MappingProductDTO[];
  taken: Set<string>;
  onPick: (id: string) => void;
}) {
  const t = useTranslations("adSpend.mapping");
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Opened near the bottom of the pane, the list would sit behind the sticky
  // footer: bring it into view.
  useEffect(() => {
    if (open) popRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onOpenChange]);

  const q = query.trim().toLocaleLowerCase();
  const match = (p: MappingProductDTO) => !q || p.name.toLocaleLowerCase().includes(q) || (p.sku ?? "").toLocaleLowerCase().includes(q);
  const active = products.filter((p) => p.is_active && match(p));
  const inactive = q ? products.filter((p) => !p.is_active && match(p)) : [];
  const close = () => {
    onOpenChange(false);
    setQuery("");
  };
  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

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
          close();
        }}
        className="w-full grid grid-cols-[32px_minmax(0,1fr)_auto] gap-2.5 items-center px-2 py-[7px] rounded-[8px] text-start hover:bg-surface-page disabled:opacity-50 disabled:cursor-default"
      >
        <ProductThumb id={p.id} products={productMap} size={32} />
        <span className="min-w-0">
          <b className="block truncate text-[13px] font-semibold text-ink-primary"><bdi>{p.name}</bdi></b>
          <small className="block text-[11.5px] text-ink-secondary">{p.sku ?? "—"}</small>
        </span>
        <span className="text-[12px] text-ink-secondary whitespace-nowrap tabular-nums">
          {isTaken ? <Check size={15} strokeWidth={2.4} aria-hidden /> : t("orders30Short", { count: p.orders_30d })}
        </span>
      </button>
    );
  };

  return (
    <div ref={boxRef} className={`relative ${empty ? "" : "border-t border-line-subtle"}`}>
      <button
        type="button"
        onClick={() => (open ? close() : onOpenChange(true))}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`flex items-center gap-3 w-full px-3 py-2.5 text-[13.5px] font-semibold text-brand hover:bg-surface-page ${empty ? "rounded-[11px]" : "rounded-b-[11px]"}`}
      >
        <span aria-hidden className="w-10 h-10 grid place-items-center rounded-[10px] border-[1.5px] border-dashed border-[#B7DEC4]">
          <Plus size={17} strokeWidth={2.2} />
        </span>
        {t("addProduct")}
      </button>
      {open && (
        <div
          ref={popRef}
          className="absolute top-[calc(100%+6px)] start-2 z-20 scroll-mb-24 w-[min(440px,calc(100%-16px))] rounded-[12px] bg-surface-card shadow-floating ring-1 ring-black/5 overflow-hidden"
          onKeyDown={(e) => {
            // Escape closes the list, not the editor or the drawer.
            if (e.key === "Escape") {
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
              close();
            }
          }}
        >
          <div className="relative p-2 border-b border-line-subtle">
            <Search size={14} className="absolute top-[18px] start-[19px] text-ink-muted" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("findProduct")}
              aria-label={t("findProduct")}
              className="w-full h-[34px] rounded-[8px] border border-line ps-8 pe-2.5 text-[13px] outline-none focus:border-brand"
            />
          </div>
          <div role="listbox" aria-label={t("addProduct")} className="max-h-[300px] overflow-y-auto p-1">
            {active.length > 0 && <p className="px-2 pt-2 pb-1 text-[11.5px] font-semibold text-ink-muted">{t("activeProducts")}</p>}
            {active.map(option)}
            {inactive.length > 0 && <p className="px-2 pt-2 pb-1 text-[11.5px] font-semibold text-ink-muted">{t("inactiveProducts")}</p>}
            {inactive.map(option)}
            {active.length === 0 && inactive.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-ink-secondary">{t("noProductFound")}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
