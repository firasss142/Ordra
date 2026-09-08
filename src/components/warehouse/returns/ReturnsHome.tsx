"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Camera, Check, Clock, Package, RotateCcw, Send, Trash2, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import type { ReturnsStats } from "@/app/api/warehouse/returns/stats/route";
import type { ReturnLookupResult } from "@/app/api/warehouse/returns/lookup/route";
import { RETURN_REASONS, type ReturnReason } from "@/lib/warehouse/returns-validation";
import { jsonFetcher } from "@/lib/fetchers";
import { QrScanner } from "@/components/warehouse/QrScanner";
import { readScannerPrefs, signalOutcome } from "@/lib/warehouse/scanner-prefs";

/**
 * Returns on the phone: scan first, decide second.
 *
 * The parcel is already in the agent's hand, so the field is the first
 * object on the screen and the queue below it is what is EXPECTED back, not
 * a menu. A found parcel opens the decision sheet; a parcel the carrier has
 * not yet reported is refused with the rule spelled out (decision of
 * 2026-09-08: the bench receives nothing Darb has not marked returned); an
 * unknown number says so. A failed request names itself and offers a retry.
 *
 * The three decisions are the system's own: restock (+stock), damage
 * (writes off, needs a cause), redeliver (back out, stock untouched).
 */

type Decision = "restock" | "damage" | "redeliver";

const REASON_KEY: Record<ReturnReason, string> = {
  packaging: "reasonPackaging",
  product_defect: "reasonProductDefect",
  customer_damage: "reasonCustomerDamage",
  carrier_damage: "reasonCarrierDamage",
  other: "reasonOther",
};

const DECISIONS: Array<{ key: Decision; icon: LucideIcon; label: string; hint: string }> = [
  { key: "restock", icon: RotateCcw, label: "restock", hint: "restockHint" },
  { key: "damage", icon: Trash2, label: "damageShort", hint: "damageHint" },
  { key: "redeliver", icon: Send, label: "redeliver", hint: "redeliverHint" },
];

function parcelRef(o: WarehouseOrderRow): string {
  return o.carrier_sticker_ref ?? o.tracking_number ?? o.id.slice(0, 8).toUpperCase();
}
function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export function ReturnsHome({ marketId }: { marketId: string | null }) {
  const t = useTranslations("warehouse.returns2");
  const tStatus = useTranslations("orders.statuses");

  const { data: stats, mutate: mutateStats } = useSWR<ReturnsStats>("/api/warehouse/returns/stats", jsonFetcher, {
    revalidateOnFocus: true,
  });
  const { data: page, error: pageError, mutate } = useSWR<{ orders: WarehouseOrderRow[] }>(
    `/api/warehouse/returns?limit=100${marketId ? `&market_id=${marketId}` : ""}`,
    jsonFetcher,
    { revalidateOnFocus: true },
  );
  const orders = useMemo(
    () => [...(page?.orders ?? [])].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at)),
    [page],
  );

  const prefs = useMemo(() => readScannerPrefs(), []);
  const inputRef = useRef<HTMLInputElement>(null);
  const [scan, setScan] = useState("");
  const [camera, setCamera] = useState(false);
  const [looking, setLooking] = useState(false);
  const [verdict, setVerdict] = useState<ReturnLookupResult | null>(null);
  const [picked, setPicked] = useState<WarehouseOrderRow | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState<ReturnReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ text: string; stockAfter: number | null } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const pick = useCallback((o: WarehouseOrderRow) => {
    setPicked(o);
    setDecision(null);
    setReason(null);
    setNote("");
    setDone(null);
    setFailed(null);
    setVerdict(null);
  }, []);

  const closeAll = useCallback(() => {
    setPicked(null);
    setVerdict(null);
    setDone(null);
    setFailed(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const lookup = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      setScan("");
      if (!code || looking) return;
      setLooking(true);
      try {
        const res = await fetch(`/api/warehouse/returns/lookup?code=${encodeURIComponent(code)}`);
        const body: ReturnLookupResult = res.ok ? await res.json() : { outcome: "not_found", code };
        if (body.outcome === "found" && body.order) {
          signalOutcome("lookup", prefs);
          pick(body.order);
        } else {
          signalOutcome("refused_here", prefs);
          setVerdict({ ...body, code: body.code ?? code });
        }
      } catch {
        setVerdict({ outcome: "not_found", code });
      } finally {
        setLooking(false);
      }
    },
    [looking, pick, prefs],
  );

  useEffect(() => {
    if (!camera && !picked && !verdict) inputRef.current?.focus();
  }, [camera, picked, verdict]);

  const canValidate =
    picked !== null &&
    decision !== null &&
    (decision !== "damage" || (reason !== null && (reason !== "other" || note.trim().length > 0)));

  const confirm = useCallback(async () => {
    if (!picked || !decision || busy || !canValidate) return;
    setBusy(true);
    setFailed(null);
    try {
      const res =
        decision === "redeliver"
          ? await fetch("/api/warehouse/scan-received", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ order_id: picked.id }),
            })
          : await fetch("/api/warehouse/scan-return", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                order_id: picked.id,
                is_damaged: decision === "damage",
                return_reason: decision === "damage" ? reason : null,
                return_reason_note: decision === "damage" && reason === "other" ? note.trim() : null,
                return_photo_url: null,
              }),
            });
      const body = (await res.json().catch(() => ({}))) as { error?: string; stock_after?: number };
      if (!res.ok) {
        setFailed(body.error ?? t("failed"));
        return;
      }
      setDone({ text: t("saved"), stockAfter: typeof body.stock_after === "number" ? body.stock_after : null });
      void mutate();
      void mutateStats();
    } finally {
      setBusy(false);
    }
  }, [picked, decision, reason, note, busy, canValidate, mutate, mutateStats, t]);

  const effect = (d: Decision, p: WarehouseOrderRow) =>
    d === "restock" ? t("fxRestock", { n: p.quantity }) : d === "damage" ? t("fxDamage", { n: p.quantity }) : t("fxRedeliver");

  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-[22px] font-bold leading-tight tracking-[-0.01em] text-wm-ink">{t("title")}</h1>
        <span className="flex gap-1.5">
          <span data-testid="wh-returns-chip-queue" className="rounded-pill border border-wm-card-edge bg-wm-card px-2.5 py-0.5 text-[13px] text-wm-ink-2">
            {t("queueChip")} <b className="tabular-nums text-wm-ink">{stats?.queueCount ?? orders.length}</b>
          </span>
          <span data-testid="wh-returns-chip-done" className="rounded-pill border border-wm-card-edge bg-wm-card px-2.5 py-0.5 text-[13px] text-wm-ink-2">
            {t("doneChip")} <b className="tabular-nums text-wm-ink">{stats?.doneToday ?? 0}</b>
          </span>
        </span>
      </div>

      {/* ── The field the screen exists for ─────────────────────────── */}
      <div className="mt-3 flex gap-2">
        <input
          ref={inputRef}
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void lookup(scan);
            }
          }}
          disabled={looking}
          autoComplete="off"
          inputMode="numeric"
          aria-label={t("scanPlaceholder")}
          placeholder={t("scanPlaceholder")}
          className="min-h-[52px] min-w-0 flex-1 rounded-[12px] border-[1.5px] border-wm-accent bg-wm-card px-3.5 text-[16px] text-wm-ink outline-none placeholder:text-wm-ink-3 focus:ring-2 focus:ring-wm-accent"
        />
        <button
          type="button"
          aria-pressed={camera}
          aria-label={t("camera")}
          onClick={() => setCamera((v) => !v)}
          className={`grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[12px] border ${
            camera ? "border-wm-accent bg-wm-accent-soft text-wm-accent" : "border-wm-card-edge bg-wm-card text-wm-accent"
          }`}
        >
          <Camera size={22} aria-hidden="true" />
        </button>
      </div>
      {camera ? (
        <div className="mt-2">
          <QrScanner active={camera} onScan={(text) => void lookup(text)} onClose={() => setCamera(false)} />
        </div>
      ) : null}
      <p className="mb-1 mt-1.5 text-[12.5px] text-wm-ink-3">{t("scanRule")}</p>

      <p className="mb-2 mt-3 text-[13px] font-semibold text-wm-ink-2">{t("waitingTitle")}</p>

      {pageError ? (
        <div
          data-testid="wh-returns-error"
          role="alert"
          className="flex flex-col items-center gap-2.5 rounded-[12px] border border-wh-bad bg-wh-bad-bg px-4 py-6 text-center"
        >
          <p className="text-[15px] font-semibold text-wm-ink">{t("loadError")}</p>
          <p className="text-[13px] text-wm-ink-2">{t("loadErrorHint")}</p>
          <button
            type="button"
            onClick={() => void mutate()}
            className="inline-flex min-h-[44px] items-center rounded-[12px] border border-wm-accent bg-wm-card px-4 text-[14px] font-bold text-wm-accent"
          >
            {t("retry")}
          </button>
        </div>
      ) : page === undefined ? (
        <div data-testid="wh-returns-skeleton" className="space-y-2" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[76px] rounded-[12px] bg-wm-track" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <p className="py-6 text-center text-[14px] text-wm-ink-2">{t("queueEmpty")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {orders.map((o) => {
            const age = daysSince(o.returned_at ?? o.created_at);
            return (
              <button
                key={o.id}
                type="button"
                data-testid="wh-return-row"
                onClick={() => pick(o)}
                className="grid w-full gap-1.5 rounded-[12px] border border-wm-card-edge bg-wm-card p-3 text-start"
              >
                <span className="flex items-center gap-2.5">
                  <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-[8px] border border-wm-card-edge bg-wm-ground text-wm-ink-3">
                    {o.product_image_url ? (
                      // Raw <img>: the project configures no images.remotePatterns.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={o.product_image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <Package size={18} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[16px] font-bold leading-tight text-wm-ink"><bdi>{o.customer_name}</bdi></b>
                    <span className="block truncate text-[13.5px] text-wm-ink-2">
                      <bdi>{o.product_name}</bdi> × {o.quantity}
                      {o.customer_city ? <> · <bdi>{o.customer_city}</bdi></> : null}
                    </span>
                  </span>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-pill border px-2 py-0.5 text-[12.5px] tabular-nums ${
                      age > 0 ? "border-wh-warn-edge bg-wh-warn-bg font-bold text-wh-warn" : "border-wm-card-edge text-wm-ink-2"
                    }`}
                  >
                    <Clock size={12} aria-hidden="true" />
                    {t("days", { count: age })}
                  </span>
                </span>
                <span className="flex items-center justify-between gap-2 text-[13px] text-wm-ink-2">
                  <b dir="ltr" className="tracking-[0.04em] tabular-nums text-wm-ink">{parcelRef(o)}</b>
                  <span>{t("scanOnArrival")}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Sheets ───────────────────────────────────────────────────── */}
      {picked || verdict ? (
        <>
          <div data-testid="wh-sheet-scrim" aria-hidden="true" onClick={closeAll} className="fixed inset-0 z-[60] bg-[rgba(26,26,26,.35)]" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={picked ? t("decision") : t("scanPlaceholder")}
            className="fixed inset-x-0 bottom-0 z-[61] max-h-[92vh] overflow-y-auto rounded-t-[20px] bg-wm-ground px-4 pb-[calc(24px+env(safe-area-inset-bottom,0px))] pt-2"
          >
            <span aria-hidden="true" className="mx-auto mb-2.5 block h-1 w-10 rounded-pill bg-wm-ink-3/50" />

            {picked ? (
              done ? (
                <div data-testid="wh-return-done">
                  <div className="grid min-h-[180px] place-items-center gap-2 rounded-[12px] border border-wh-ok bg-wm-card p-4 text-center">
                    <Check size={40} strokeWidth={2} className="text-wh-ok" aria-hidden="true" />
                    <b dir="ltr" className="text-[24px] font-bold tracking-[0.05em] tabular-nums text-wm-ink">{parcelRef(picked)}</b>
                    <p className="text-[16px] font-semibold text-wm-ink">{done.text}</p>
                    <p className="text-[14px] text-wm-ink-2">
                      {done.stockAfter !== null ? t("fxRestockAfter", { n: done.stockAfter }) : effect(decision!, picked)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeAll}
                    className="mt-2.5 inline-flex min-h-[48px] w-full items-center justify-center rounded-[12px] bg-wm-accent px-4 text-[15px] font-bold text-white"
                  >
                    {t("nextParcel")}
                  </button>
                </div>
              ) : (
                <>
                  <p className="mb-3 text-[15px] font-semibold text-wm-ink">
                    {`${t("arrived")} ${picked.customer_name}${picked.customer_city ? ` · ${picked.customer_city}` : ""} · ${picked.product_name} × ${picked.quantity} · `}
                    <span dir="ltr" className="inline-block tabular-nums">{parcelRef(picked)}</span>
                  </p>
                  <div className="grid gap-2">
                    {DECISIONS.map((d) => {
                      const Icon = d.icon;
                      const on = decision === d.key;
                      return (
                        <button
                          key={d.key}
                          type="button"
                          data-testid={`wh-decide-${d.key}`}
                          aria-pressed={on}
                          disabled={busy}
                          onClick={() => {
                            setDecision(d.key);
                            if (d.key !== "damage") setReason(null);
                          }}
                          className={`flex min-h-[56px] items-center gap-3 rounded-[12px] border px-4 text-start ${
                            on ? "border-wm-accent bg-wm-accent-soft" : "border-wm-card-edge bg-wm-card"
                          }`}
                        >
                          <Icon size={22} strokeWidth={1.75} className="shrink-0 text-wm-ink" aria-hidden="true" />
                          <span className="min-w-0">
                            <span className="block text-[16px] font-bold text-wm-ink">{t(d.label)}</span>
                            <small className="block text-[13px] text-wm-ink-2">{t(d.hint)}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {decision === "damage" ? (
                    <>
                      <p className="mb-1.5 mt-3 text-[13px] font-semibold text-wm-ink-2">{t("damageReason")}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {RETURN_REASONS.map((r) => (
                          <button
                            key={r}
                            type="button"
                            aria-pressed={reason === r}
                            onClick={() => setReason(r)}
                            className={`min-h-[40px] rounded-pill border px-3 text-[13.5px] ${
                              reason === r ? "border-wm-accent bg-wm-accent-soft font-bold text-wm-ink" : "border-wm-card-edge bg-wm-card text-wm-ink"
                            }`}
                          >
                            {t(REASON_KEY[r])}
                          </button>
                        ))}
                      </div>
                      {reason === "other" ? (
                        <textarea
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder={t("reasonNote")}
                          aria-label={t("reasonNote")}
                          className="mt-2 min-h-[64px] w-full rounded-[12px] border border-wm-card-edge bg-wm-card px-3 py-2.5 text-[14px] text-wm-ink"
                        />
                      ) : null}
                    </>
                  ) : null}

                  <p className="mt-3 text-center text-[13px] text-wm-ink-2">
                    {decision ? effect(decision, picked) : t("decideHint")}
                  </p>
                  {failed ? (
                    <p role="alert" className="mt-1 text-center text-[13px] font-semibold text-wh-bad">{failed}</p>
                  ) : null}
                  <button
                    type="button"
                    disabled={!canValidate || busy}
                    onClick={() => void confirm()}
                    className="mt-2 inline-flex min-h-[48px] w-full items-center justify-center rounded-[12px] bg-wm-accent px-4 text-[15px] font-bold text-white disabled:opacity-50"
                  >
                    {t("validate")}
                  </button>
                  <button
                    type="button"
                    onClick={closeAll}
                    className="mt-1 inline-flex min-h-[44px] w-full items-center justify-center rounded-[12px] text-[14px] font-semibold text-wm-ink-2"
                  >
                    {t("cancel")}
                  </button>
                </>
              )
            ) : verdict ? (
              <>
                <div
                  data-testid="wh-return-verdict"
                  data-outcome={verdict.outcome}
                  className={`grid min-h-[180px] place-items-center gap-2 rounded-[12px] border p-4 text-center ${
                    verdict.outcome === "wrong_status" ? "border-wh-warn bg-wh-warn-bg" : "border-wm-card-edge bg-wm-card"
                  }`}
                >
                  <TriangleAlert
                    size={40}
                    strokeWidth={2}
                    className={verdict.outcome === "wrong_status" ? "text-wh-warn" : "text-wm-ink-3"}
                    aria-hidden="true"
                  />
                  <b dir="ltr" className="text-[24px] font-bold tracking-[0.05em] tabular-nums text-wm-ink">{verdict.code}</b>
                  {verdict.outcome === "wrong_status" ? (
                    <>
                      <p className="text-[16px] font-semibold text-wm-ink">
                        {t("syncLag", { status: verdict.status ? tStatus(verdict.status) : "" })}
                        {verdict.order ? ` · ${verdict.order.customer_name}` : ""}
                      </p>
                      <p className="text-[14px] text-wm-ink-2">{t("syncLagHint")}</p>
                    </>
                  ) : verdict.outcome === "ambiguous" ? (
                    <p className="text-[15px] font-semibold text-wm-ink">{t("scanAmbiguous", { n: verdict.matches ?? 0 })}</p>
                  ) : (
                    <>
                      <p className="text-[16px] font-semibold text-wm-ink">{t("unknown")}</p>
                      <p className="text-[14px] text-wm-ink-2">{t("unknownHint")}</p>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={closeAll}
                  className="mt-2.5 inline-flex min-h-[44px] w-full items-center justify-center rounded-[12px] text-[14px] font-semibold text-wm-ink-2"
                >
                  {t("close")}
                </button>
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
