"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { jsonFetcher } from "@/lib/fetchers";
import type { ScannedPage, ScannedRow } from "@/app/api/warehouse/scanned/route";
import { ScannedCard } from "./ScannedCard";

/**
 * The parcels already scanned out — and what the carrier did with them.
 *
 * This list is the answer to "where did my parcel go after I scanned it". There
 * was none: the row left the bench and the only trace was a ledger line nobody
 * on the floor could read. Meanwhile eight of twenty parcels scanned on
 * 2026-09-08 were carrying a number Darb was not holding.
 *
 * Failures are rendered, never swallowed. A silent empty list here would be
 * indistinguishable from a clear bench, which is the exact defect that left the
 * returns screen showing a placeholder for weeks.
 */

const KEY = "/api/warehouse/scanned?limit=100";

export function ScannedList({ isLy }: { isLy: boolean }) {
  const t = useTranslations("warehouse.scanned");
  const { data, error, isLoading, mutate } = useSWR<ScannedPage>(KEY, jsonFetcher, {
    revalidateOnFocus: true,
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const call = useCallback(
    async (row: ScannedRow, path: string, body: Record<string, unknown>, okText: (r: Record<string, unknown>) => string) => {
      setBusyId(row.id);
      setFlash(null);
      try {
        const res = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_id: row.id, ...body }),
        });
        const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          setFlash({ tone: "bad", text: String(json.message ?? json.error ?? t("failed")) });
        } else {
          setFlash({ tone: "ok", text: okText(json) });
          await mutate();
        }
      } finally {
        setBusyId(null);
      }
    },
    [mutate, t],
  );

  const recheck = useCallback(
    (row: ScannedRow) =>
      call(row, "/api/warehouse/rebind", {}, (j) =>
        j.sticker_bind_state === "confirmed"
          ? t("recheckConfirmed")
          : t("recheckStill", { ref: String(j.carrier_reference ?? "—") }),
      ),
    [call, t],
  );

  const rebind = useCallback(
    (row: ScannedRow, sticker: string) =>
      call(row, "/api/warehouse/rebind", { sticker_ref: sticker }, (j) =>
        j.sticker_bind_state === "confirmed" ? t("rebindDone", { ref: sticker }) : t("rebindRefused"),
      ),
    [call, t],
  );

  const unscan = useCallback(
    (row: ScannedRow) => {
      // A reason, not a confirmation dialog: the ledger has to say why six
      // months from now, and "are you sure?" records nothing.
      const note = window.prompt(t("unscanReason"));
      if (!note || !note.trim()) return;
      return call(row, "/api/warehouse/unscan", { note: note.trim() }, (j) =>
        t("unscanDone", { n: Number(j.stock_after ?? 0) }),
      );
    },
    [call, t],
  );

  if (error) {
    return (
      <div className="mt-4 rounded-[14px] border border-wh-bad-edge bg-wh-bad-bg p-4 text-center">
        <p className="text-[15px] font-semibold text-wh-bad">{t("loadFailed")}</p>
        <button
          type="button"
          onClick={() => void mutate()}
          className="mt-2 inline-flex min-h-[44px] items-center rounded-[12px] bg-wm-accent px-4 text-[14px] font-bold text-white"
        >
          {t("retry")}
        </button>
      </div>
    );
  }

  if (isLoading && !data) {
    return <p role="status" className="py-6 text-center text-[14px] text-wm-ink-2">{t("loading")}</p>;
  }

  const rows = data?.orders ?? [];

  return (
    <div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Chip label={t("awaitingPickup", { n: data?.awaitingPickup ?? 0 })} />
        <Chip label={t("atCarrier", { n: data?.atCarrier ?? 0 })} />
        {(data?.unconfirmed ?? 0) > 0 ? (
          <Chip label={t("unconfirmed", { n: data?.unconfirmed ?? 0 })} tone="warn" />
        ) : null}
      </div>

      {flash ? (
        <p
          role="status"
          data-testid="wh-scanned-flash"
          className={`mt-2.5 rounded-[12px] border px-3 py-2 text-[13.5px] ${
            flash.tone === "ok"
              ? "border-wh-ok-edge bg-wh-ok-bg text-wh-ok"
              : "border-wh-bad-edge bg-wh-bad-bg text-wh-bad"
          }`}
        >
          {flash.text}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="py-6 text-center text-[14px] text-wm-ink-2">{t("empty")}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {rows.map((row) => (
            <ScannedCard
              key={row.id}
              row={row}
              isLy={isLy}
              busy={busyId === row.id}
              onRecheck={recheck}
              onRebind={rebind}
              onUnscan={unscan}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ label, tone }: { label: string; tone?: "warn" }) {
  return (
    <span
      className={`inline-flex items-center rounded-pill border px-3 py-1 text-[13px] font-semibold ${
        tone === "warn"
          ? "border-wh-warn-edge bg-wh-warn-bg text-wh-warn"
          : "border-wm-card-edge bg-wm-card text-wm-ink-2"
      }`}
    >
      {label}
    </span>
  );
}
