"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Inbox, X } from "lucide-react";
import type {
  OnTheWayRow,
  ProcessedRow,
  ReturnRow,
  ReturnsPayload,
} from "@/app/api/warehouse/returns/returns-data";
import { jsonFetcher } from "@/lib/fetchers";
import { ReturnVerdict, type VerdictResult } from "@/components/warehouse/returns/ReturnVerdict";
import { AgeChip, Thumb, ageParts, hoursSince, isLate, parcelRef } from "@/components/warehouse/returns/parts";

/**
 * « Rentrer » on the desk — prototype C.returns.
 *
 * Three stacked sections for the building the top bar chose (`?warehouse_id=`,
 * absent = every building):
 *   · Chez Darb pour nous — `to_be_returned`, the only receivable status. Each
 *     row carries the manager's two moves: « Relivrer au client »
 *     (scan_received_in, stock UNTOUCHED — the parcel goes back out) and
 *     « Recevoir… » (the Intact / Abîmé verdict, scan_return_in).
 *   · En route — `returning`, greyed and inert: Darb has not registered it yet.
 *   · Traités — what was decided in the last seven days.
 *
 * Scanning is the top bar's job on the desk; a scan that lands on
 * `?order=<id>` opens that parcel's verdict here.
 */

const TH =
  "whitespace-nowrap border-b border-line-subtle bg-white px-[14px] py-[11px] text-start text-[11px] font-semibold uppercase tracking-[0.05em] text-wh-ink-2 rtl:text-[12px] rtl:normal-case rtl:tracking-normal";
const TD = "border-b border-line-subtle px-[14px] py-[12px] align-middle";
const TBODY = "[&>tr:last-child>td]:border-b-0 [&>tr:hover>td]:bg-wh-surface-2";
const CARD = "overflow-hidden rounded-[16px] border border-line-subtle bg-white";
const BTN_SM =
  "inline-flex h-[30px] items-center justify-center whitespace-nowrap rounded-[8px] px-[10px] text-[12.5px] font-semibold disabled:opacity-50";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-[8px] text-[11px] font-semibold uppercase tracking-[0.06em] text-wh-ink-2 rtl:text-[12px] rtl:normal-case rtl:tracking-normal">
      {children}
    </div>
  );
}

function Num({ children }: { children: React.ReactNode }) {
  return (
    <span dir="ltr" className="tabular-nums [unicode-bidi:isolate]">
      {children}
    </span>
  );
}

/** The prototype's `age()` on the desk: « 4 j », « 5 h », « à l'instant ». */
function useAge() {
  const t = useTranslations("warehouse.returns2");
  return useCallback(
    (hours: number) => {
      const a = ageParts(hours);
      return a.unit === "now" ? t("now") : t(a.unit === "hours" ? "hours" : "days", { n: a.n });
    },
    [t],
  );
}

/** Thumb + « product ×n » + the reference printed on the parcel. */
function ParcelCell({
  product,
  quantity,
  image,
  reference,
}: {
  product: string;
  quantity?: number;
  image: string | null | undefined;
  reference?: string;
}) {
  return (
    <div className="flex items-center gap-[12px]">
      <Thumb src={image} size={34} icon={16} />
      <div className="min-w-0">
        <div className="font-semibold">
          <bdi>{product}</bdi>
          {quantity !== undefined ? (
            <>
              {" "}
              <span dir="ltr" className="tabular-nums text-wh-ink-2 [unicode-bidi:isolate]">
                ×{quantity}
              </span>
            </>
          ) : null}
        </div>
        {reference ? (
          <div dir="ltr" className="font-mono text-[12.5px] tabular-nums text-wh-ink-2 [unicode-bidi:isolate] rtl:text-end">
            {reference}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ClientCell({ name, city }: { name: string; city: string | null }) {
  return (
    <>
      <bdi>{name}</bdi>
      {city ? (
        <>
          {" · "}
          <span className="text-wh-ink-2">
            <bdi>{city}</bdi>
          </span>
        </>
      ) : null}
    </>
  );
}

/* ── Chez Darb pour nous ─────────────────────────────────────────────── */

function AtDarbRow({
  row,
  confirming,
  busy,
  onRedeliver,
  onReceive,
}: {
  row: ReturnRow;
  confirming: boolean;
  busy: boolean;
  onRedeliver: (row: ReturnRow) => void;
  onReceive: (id: string) => void;
}) {
  const t = useTranslations("warehouse.returns2");
  const age = useAge();
  const hours = hoursSince(row.returned_at ?? row.created_at);
  return (
    <tr data-testid="wh-return-row">
      <td className={TD}>
        <ParcelCell
          product={row.product_name}
          quantity={row.quantity}
          image={row.product_image_url}
          reference={parcelRef(row)}
        />
      </td>
      <td className={TD}>
        <ClientCell name={row.customer_name} city={row.customer_city} />
      </td>
      <td className={TD}>
        {row.darb_reason ? t(`reasons.${row.darb_reason}`) : <span className="text-wh-ink-3">—</span>}
      </td>
      <td className={TD}>
        {isLate(hours) ? (
          <AgeChip tone="warn" dense>
            {age(hours)}
          </AgeChip>
        ) : (
          <span className="text-wh-ink-2">{age(hours)}</span>
        )}
      </td>
      <td className={`${TD} text-wh-ink-2`}>{row.warehouse_name ?? "—"}</td>
      <td className={`${TD} text-end`}>
        <div className="flex items-center justify-end gap-[6px]">
          {/* A parcel back on the road is not undone by a click: the first press asks. */}
          <button
            type="button"
            disabled={busy}
            onClick={() => onRedeliver(row)}
            className={`${BTN_SM} border bg-white ${
              confirming ? "border-brand text-brand" : "border-wh-border-strong text-wh-ink-1"
            }`}
          >
            {confirming ? t("redeliverConfirm") : t("redeliver")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onReceive(row.id)}
            className={`${BTN_SM} bg-brand text-white hover:bg-brand-hover`}
          >
            {t("receive")}
          </button>
        </div>
      </td>
    </tr>
  );
}

/* ── En route ────────────────────────────────────────────────────────── */

function OnTheWayRowView({ row }: { row: OnTheWayRow }) {
  return (
    <tr data-testid="wh-return-onway">
      <td className={`${TD} min-w-[260px]`}>
        <ParcelCell product={row.product_name} image={row.product_image_url} />
      </td>
      <td className={TD}>{row.customer_city ? <bdi>{row.customer_city}</bdi> : "—"}</td>
      <td className={`${TD} text-end text-wh-ink-2`}>{row.warehouse_name ?? "—"}</td>
    </tr>
  );
}

/* ── Traités ─────────────────────────────────────────────────────────── */

function ProcessedRowView({ row }: { row: ProcessedRow }) {
  const t = useTranslations("warehouse.returns2");
  const age = useAge();
  const outcome =
    row.outcome === "damaged"
      ? [t("outcomes.damaged"), row.return_reason ? t(`causes.${row.return_reason}`) : null].filter(Boolean).join(" · ")
      : t(`outcomes.${row.outcome}`);
  const tone = row.outcome === "restocked" ? "ok" : row.outcome === "damaged" ? "bad" : "mute";
  return (
    <tr data-testid="wh-return-processed">
      <td className={`${TD} min-w-[260px]`}>
        <ParcelCell
          product={row.product_name}
          quantity={row.quantity}
          image={null}
          reference={row.tracking_number ?? row.carrier_sticker_ref ?? row.id.slice(0, 8).toUpperCase()}
        />
      </td>
      <td className={TD}>
        <ClientCell name={row.customer_name} city={row.customer_city} />
      </td>
      <td className={TD}>
        <AgeChip tone={tone} dense>
          {outcome}
        </AgeChip>
      </td>
      <td className={`${TD} text-wh-ink-2`}>{age(hoursSince(row.processed_at))}</td>
      <td className={`${TD} text-end text-wh-ink-2`}>{row.warehouse_name ?? "—"}</td>
    </tr>
  );
}

/* ── Recevoir… ───────────────────────────────────────────────────────── */

function ReceiveDialog({
  row,
  loaded,
  onClose,
  onRecorded,
}: {
  row: ReturnRow | null;
  loaded: boolean;
  onClose: () => void;
  onRecorded: (r: VerdictResult) => void;
}) {
  const t = useTranslations("warehouse.returns2");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!row && !loaded) return null;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-[rgba(26,26,26,.35)] p-[16px]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wh-receive-title"
        onClick={(e) => e.stopPropagation()}
        className="job-returns w-full max-w-[460px] rounded-[16px] bg-wh-bg p-[20px] text-[14px] leading-[1.5] text-wh-ink-1"
      >
        <div className="mb-[16px] flex items-center gap-[12px]">
          <div className="min-w-0 flex-1">
            {row ? (
              <p dir="ltr" className="font-mono text-[12.5px] font-semibold text-wh-ink-2 [unicode-bidi:isolate] rtl:text-end">
                {parcelRef(row)}
              </p>
            ) : null}
            <h2 id="wh-receive-title" className="text-[20px] font-bold tracking-[-0.02em]">
              {t("title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="grid h-[36px] w-[36px] shrink-0 place-items-center rounded-full border border-wh-border bg-white text-wh-ink-1"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {row ? (
          <ReturnVerdict key={row.id} row={row} onRecorded={onRecorded} />
        ) : (
          <div className="rounded-[16px] border border-line-subtle bg-white p-[16px] text-wh-ink-2">{t("notHere")}</div>
        )}
      </div>
    </div>
  );
}

/* ── The screen ──────────────────────────────────────────────────────── */

export function ReturnsConsole({
  marketId,
  warehouseId,
}: {
  marketId: string | null;
  /** From `?warehouse_id=`; null = every building. */
  warehouseId: string | null;
}) {
  const t = useTranslations("warehouse.returns2");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const orderParam = search?.get("order") ?? null;

  const key = `/api/warehouse/returns?limit=100${marketId ? `&market_id=${encodeURIComponent(marketId)}` : ""}${
    warehouseId ? `&warehouse_id=${encodeURIComponent(warehouseId)}` : ""
  }`;
  const { data, error, mutate } = useSWR<ReturnsPayload>(key, jsonFetcher, { revalidateOnFocus: true });

  // Longest at Darb first: that is the one costing money on their shelf.
  const atDarb = useMemo(
    () =>
      [...(data?.orders ?? [])].sort(
        (a, b) => +new Date(a.returned_at ?? a.created_at) - +new Date(b.returned_at ?? b.created_at),
      ),
    [data],
  );
  const onTheWay = data?.onTheWay ?? [];
  const processed = data?.processed ?? [];

  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!flash?.ok) return;
    const id = setTimeout(() => setFlash(null), 5000);
    return () => clearTimeout(id);
  }, [flash]);

  /* Recevoir… — opened by a row, or by a scan landing on ?order=. */
  const [receivingId, setReceivingId] = useState<string | null>(orderParam);
  useEffect(() => {
    if (orderParam) setReceivingId(orderParam);
  }, [orderParam]);
  const closeReceive = useCallback(() => {
    setReceivingId(null);
    if (!orderParam) return;
    const rest = new URLSearchParams(search?.toString() ?? "");
    rest.delete("order");
    const qs = rest.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [orderParam, search, router, pathname]);
  const onRecorded = useCallback(
    (r: VerdictResult) => {
      setFlash({ ok: true, text: r.kind === "intact" ? t("savedIntact", { n: r.quantity }) : t("savedDamaged") });
      void mutate();
      closeReceive();
    },
    [mutate, closeReceive, t],
  );

  /* Relivrer au client — two presses, then scan_received_in. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [redelivering, setRedelivering] = useState<string | null>(null);
  useEffect(() => {
    if (!confirming) return;
    const id = setTimeout(() => setConfirming(null), 4000);
    return () => clearTimeout(id);
  }, [confirming]);
  const redeliver = useCallback(
    async (row: ReturnRow) => {
      if (redelivering) return;
      if (confirming !== row.id) {
        setConfirming(row.id);
        return;
      }
      setConfirming(null);
      setRedelivering(row.id);
      setFlash(null);
      try {
        const res = await fetch("/api/warehouse/scan-received", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_id: row.id }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setFlash({ ok: false, text: body.error ?? t("failed") });
          return;
        }
        setFlash({ ok: true, text: t("savedRedelivered") });
        void mutate();
      } catch {
        setFlash({ ok: false, text: t("failed") });
      } finally {
        setRedelivering(null);
      }
    },
    [confirming, redelivering, mutate, t],
  );

  const receivingRow = receivingId ? (atDarb.find((o) => o.id === receivingId) ?? null) : null;

  return (
    <div className="job-returns px-[28px] pb-[40px] pt-[12px] text-[14px] leading-[1.5] text-wh-ink-1">
      <div className="mb-[20px] flex items-end gap-[16px]">
        <div className="min-w-0 flex-1">
          <h1 className="text-[24px] font-bold tracking-[-0.02em]">{t("title")}</h1>
          <p className="mt-[4px] text-[12.5px] text-wh-ink-2">{t("ruleDesk")}</p>
        </div>
      </div>

      {flash ? (
        <p
          role={flash.ok ? "status" : "alert"}
          className={`mb-[14px] text-[13px] font-semibold ${flash.ok ? "text-wh-ok" : "text-status-critical"}`}
        >
          {flash.text}
        </p>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="flex flex-col items-center gap-[10px] rounded-[16px] border border-wh-bad-edge bg-wh-bad-bg px-[16px] py-[24px] text-center"
        >
          <p className="text-[14px] font-semibold">{t("loadError")}</p>
          <p className="text-[12.5px] text-wh-ink-2">{t("loadErrorHint")}</p>
          <button
            type="button"
            onClick={() => void mutate()}
            className={`${BTN_SM} border border-wh-border-strong bg-white text-wh-ink-1`}
          >
            {t("retry")}
          </button>
        </div>
      ) : data === undefined ? (
        <div data-testid="wh-returns-skeleton" aria-hidden="true" className="h-[160px] rounded-[16px] bg-wm-track" />
      ) : (
        <>
          <Label>
            {t("atDarb")} · <Num>{atDarb.length}</Num>
          </Label>
          {atDarb.length === 0 ? (
            <div className={`${CARD} mb-[20px] p-[18px] text-[12.5px] text-wh-ink-2`}>{t("emptyAtDarb")}</div>
          ) : (
            <div className={`${CARD} mb-[20px]`}>
              <table data-testid="wh-returns-atdarb" className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={`${TH} min-w-[260px]`}>{t("parcel")}</th>
                    <th className={TH}>{t("client")}</th>
                    <th className={TH}>{t("darbReason")}</th>
                    <th className={TH}>{t("since")}</th>
                    <th className={TH}>{t("site")}</th>
                    <th className={`${TH} text-end`} />
                  </tr>
                </thead>
                <tbody className={TBODY}>
                  {atDarb.map((o) => (
                    <AtDarbRow
                      key={o.id}
                      row={o}
                      confirming={confirming === o.id}
                      busy={redelivering === o.id}
                      onRedeliver={(r) => void redeliver(r)}
                      onReceive={setReceivingId}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {onTheWay.length > 0 ? (
            <>
              <Label>
                {t("onWayDesk")} · <Num>{onTheWay.length}</Num>
              </Label>
              <div className={`${CARD} mb-[20px] opacity-[.65]`}>
                <table className="w-full border-collapse">
                  <tbody className={TBODY}>
                    {onTheWay.map((o) => (
                      <OnTheWayRowView key={o.id} row={o} />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          <Label>{t("processed")}</Label>
          {processed.length === 0 ? (
            <div className={`${CARD} flex items-center gap-[12px] p-[18px] text-[12.5px] text-wh-ink-2`}>
              <Inbox size={18} aria-hidden="true" className="shrink-0" />
              {t("none7")}
            </div>
          ) : (
            <div className={CARD}>
              <table className="w-full border-collapse">
                <tbody className={TBODY}>
                  {processed.map((o) => (
                    <ProcessedRowView key={o.id} row={o} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {receivingId ? (
        <ReceiveDialog row={receivingRow} loaded={data !== undefined} onClose={closeReceive} onRecorded={onRecorded} />
      ) : null}
    </div>
  );
}
