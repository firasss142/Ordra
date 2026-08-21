"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { WarehouseStockRow } from "@/app/api/warehouse/stock/route";
import { WH_LABEL } from "./tokens";

/**
 * Physical count.
 *
 * The operator types WHAT IS ON THE SHELF, never a correction. The delta is
 * derived and shown before they commit, so the number they confirm is the
 * number they counted — a sign error cannot quietly create stock.
 */
export function StockCountDialog({
  row,
  onClose,
  onDone,
}: {
  row: WarehouseStockRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("warehouse.stock");
  const [counted, setCounted] = useState<string>(String(row.current_stock));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstField.current?.focus();
    firstField.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const parsed = Number.parseInt(counted, 10);
  const valid = Number.isInteger(parsed) && parsed >= 0;
  const delta = valid ? parsed - row.current_stock : 0;

  async function submit() {
    if (!valid || !note.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/warehouse/stock/count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: row.product_id, counted_qty: parsed, note: note.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? String(res.status));
        return;
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "network");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("modalTitle")}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[440px] rounded-wh border border-wh-border bg-wh-surface shadow-lg">
        <header className="border-b border-wh-border px-5 py-4">
          <h2 className="text-[15px] font-semibold text-wh-ink-1">{t("modalTitle")}</h2>
          <p className="mt-1 text-[12.5px] text-wh-ink-2">{row.name}</p>
        </header>

        <div className="flex flex-col gap-4 px-5 py-4">
          <p className="text-[12.5px] text-wh-ink-2">{t("modalHint")}</p>

          <label className="flex flex-col gap-1.5">
            <span className={WH_LABEL}>{t("fieldCounted")}</span>
            <input
              ref={firstField}
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              className="rounded-[8px] border border-wh-border bg-wh-surface px-3 py-2 text-[16px] font-semibold tabular-nums text-wh-ink-1 outline-none focus:border-wh-ok"
            />
          </label>

          {/* The arithmetic, shown before they commit to it. */}
          <div className="flex items-center gap-4 rounded-[8px] bg-wh-sunken px-3 py-2.5 text-[12.5px]">
            <span className="text-wh-ink-2">
              {t("system")} <b className="tabular-nums text-wh-ink-1">{row.current_stock}</b>
            </span>
            <span className="text-wh-ink-2">
              {t("delta")}{" "}
              <b
                className={`tabular-nums ${
                  delta > 0 ? "text-wh-ok" : delta < 0 ? "text-wh-bad" : "text-wh-ink-2"
                }`}
              >
                {delta > 0 ? "+" : ""}
                {valid ? delta : "—"}
              </b>
            </span>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className={WH_LABEL}>{t("fieldNote")}</span>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("notePlaceholder")}
              className="resize-none rounded-[8px] border border-wh-border bg-wh-surface px-3 py-2 text-[13px] text-wh-ink-1 outline-none focus:border-wh-ok"
            />
            {!note.trim() ? (
              <span className="text-[11.5px] text-wh-ink-3">{t("noteRequired")}</span>
            ) : null}
          </label>

          {error ? (
            <p role="alert" className="rounded-[8px] border border-wh-bad-edge bg-wh-bad-bg px-3 py-2 text-[12.5px] text-wh-bad">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex justify-end gap-2 border-t border-wh-border px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] border border-wh-border px-3.5 py-2 text-[13px] font-semibold text-wh-ink-2 hover:border-wh-border-strong"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!valid || !note.trim() || saving}
            className="rounded-[8px] border border-wh-ok bg-wh-ok px-3.5 py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("confirm")}
          </button>
        </footer>
      </div>
    </div>
  );
}
