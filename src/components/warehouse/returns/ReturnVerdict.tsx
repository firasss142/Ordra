"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, TriangleAlert } from "lucide-react";
import type { ReturnRow } from "@/app/api/warehouse/returns/returns-data";
import { RETURN_REASONS, type ReturnReason } from "@/lib/warehouse/returns-validation";
import { Thumb, firstName } from "./parts";

/**
 * The verdict on a returned parcel (prototype R.verdict), phone and desk alike.
 *
 * The parcel in hand, then two tiles of EQUAL size — neither is the default.
 * Intact records in one tap (scan_return_in, stock +qty). Abîmé first asks why:
 * the five causes are the `return_reason` enum the RPC accepts, and « Autre »
 * needs a note, which the RPC also requires. Nothing here writes stock itself.
 *
 * Redelivery is not here: it is a manager's decision and lives on the desk row.
 */

export type VerdictResult = { kind: "intact" | "damaged"; quantity: number };

export function ReturnVerdict({
  row,
  onRecorded,
}: {
  row: ReturnRow;
  onRecorded: (r: VerdictResult) => void;
}) {
  const t = useTranslations("warehouse.returns2");
  const [damagedOpen, setDamagedOpen] = useState(false);
  const [cause, setCause] = useState<ReturnReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const canRecordDamage = cause !== null && (cause !== "other" || note.trim().length > 0);

  const send = useCallback(
    async (damaged: boolean) => {
      if (busy) return;
      setBusy(true);
      setFailed(null);
      try {
        const res = await fetch("/api/warehouse/scan-return", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_id: row.id,
            is_damaged: damaged,
            return_reason: damaged ? cause : null,
            return_reason_note: damaged && cause === "other" ? note.trim() : null,
            return_photo_url: null,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setFailed(body.error ?? t("failed"));
          return;
        }
        onRecorded({ kind: damaged ? "damaged" : "intact", quantity: row.quantity });
      } catch {
        setFailed(t("failed"));
      } finally {
        setBusy(false);
      }
    },
    [busy, cause, note, row.id, row.quantity, onRecorded, t],
  );

  const place = [row.customer_city, firstName(row.customer_name)].filter(Boolean).join(" · ");
  const reason = row.darb_reason ? t(`reasons.${row.darb_reason}`) : null;

  return (
    <div>
      {/* ── The parcel in hand ─────────────────────────────────────── */}
      <div className="rounded-[16px] border border-line-subtle bg-white p-[18px]">
        <div className="flex items-start gap-[12px]">
          <Thumb src={row.product_image_url} size={56} icon={24} />
          <div className="min-w-0 flex-1">
            <div className="text-[20px] font-bold leading-[1.3] text-wh-ink-1" dir="auto">{row.product_name}</div>
            <div className="mt-[4px] text-[14px] text-wh-ink-2" dir="auto">{place}</div>
          </div>
          <span dir="ltr" className="shrink-0 text-[34px] font-bold leading-[1.5] tabular-nums text-wh-ink-1 [unicode-bidi:isolate]">
            ×{row.quantity}
          </span>
        </div>
        {reason ? (
          <>
            <div className="my-[14px] h-px bg-line-subtle" />
            <div className="flex items-center gap-[12px] text-[12.5px]">
              <span className="min-w-0 flex-1 text-wh-ink-2">{t("darbReason")}</span>
              <b className="font-bold text-wh-ink-1">{reason}</b>
            </div>
          </>
        ) : null}
      </div>

      {/* ── Two equal tiles ────────────────────────────────────────── */}
      <div className="mt-[16px] grid grid-cols-2 gap-[10px]">
        <button
          type="button"
          disabled={busy}
          onClick={() => void send(false)}
          className="flex min-h-[96px] flex-col items-center justify-center gap-[4px] rounded-[12px] bg-brand px-[18px] text-[15px] font-bold text-white disabled:opacity-60"
        >
          <Check size={24} strokeWidth={2.5} aria-hidden="true" />
          <span>{t("intact")}</span>
          <small dir="auto" className="text-[12px] font-semibold opacity-[.85]">{t("intactSub", { n: row.quantity })}</small>
        </button>
        <button
          type="button"
          disabled={busy}
          aria-pressed={damagedOpen}
          onClick={() => setDamagedOpen((v) => !v)}
          className="flex min-h-[96px] flex-col items-center justify-center gap-[4px] rounded-[12px] border-[1.5px] border-status-critical bg-white px-[18px] text-[15px] font-bold text-status-critical disabled:opacity-60"
        >
          <TriangleAlert size={24} strokeWidth={2.2} aria-hidden="true" />
          <span>{t("damaged")}</span>
          <small className="text-[12px] font-semibold opacity-[.85]">{t("damagedSub")}</small>
        </button>
      </div>

      {/* ── Why it is damaged ──────────────────────────────────────── */}
      {damagedOpen ? (
        <div className="mt-[12px] rounded-[16px] border border-line-subtle bg-white p-[16px]">
          <div className="text-[14px] font-bold text-wh-ink-1">{t("cause")}</div>
          <div className="mt-[12px] flex flex-wrap gap-[8px]">
            {RETURN_REASONS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={cause === c}
                disabled={busy}
                onClick={() => setCause(c)}
                className={`rounded-pill border px-[14px] py-[9px] text-[13.5px] font-semibold ${
                  cause === c
                    ? "border-status-critical bg-status-critical text-white"
                    : "border-wh-border-strong bg-white text-wh-ink-1"
                }`}
              >
                {t(`causes.${c}`)}
              </button>
            ))}
          </div>
          {cause === "other" ? (
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("causeNote")}
              aria-label={t("causeNote")}
              className="mt-[10px] h-[44px] w-full rounded-[10px] border border-wh-border-strong bg-white px-[12px] text-[14px] text-wh-ink-1 outline-none focus:border-brand"
            />
          ) : null}
          <button
            type="button"
            disabled={!canRecordDamage || busy}
            onClick={() => void send(true)}
            className="mt-[12px] inline-flex min-h-[48px] w-full items-center justify-center rounded-[12px] bg-status-critical px-[18px] text-[15px] font-bold text-white disabled:opacity-40"
          >
            {t("record")}
          </button>
        </div>
      ) : null}

      {failed ? (
        <p role="alert" className="mt-[12px] text-center text-[13px] font-semibold text-status-critical">
          {failed}
        </p>
      ) : null}
    </div>
  );
}
