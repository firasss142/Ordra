"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { DARB_ZONES, DARB_ZONE_ORDER } from "@/lib/carriers/darb-zones";
import type { RollRow } from "./ScanStation";
import { WH_LABEL } from "./tokens";

/**
 * The rolls on the shelf.
 *
 * Registering one is the ON-SWITCH for the whole sticker guard: with no open
 * roll the bench accepts any number, because refusing every scan on day one
 * would strand the warehouse. So the form's job is to make a WRONG roll hard to
 * register — a bad range either refuses good stickers all day or waves through
 * foreign ones, and Darb checks neither.
 *
 * The COLOUR IS NOT TYPED. It is chosen from the nine Darb publishes, because a
 * tenth would create a zone no destination can ever match. Everything else on
 * the form is what only a person holding the roll can know: which account it
 * came from, and its first and last number.
 */

/** Matches the route, which matches the live distribution (6–8 digits). */
const MIN_STICKER = 100_000;
const MAX_STICKER = 999_999_999_999;
const MAX_ROLL_SPAN = 10_000;

export interface RollAccount {
  id: string;
  name: string;
}

export function StickerRollsDialog({
  rolls,
  accounts,
  onClose,
  onChanged,
}: {
  rolls: RollRow[];
  accounts: RollAccount[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("warehouse.rolls");

  const [carrierId, setCarrierId] = useState(accounts[0]?.id ?? "");
  const [colorHex, setColorHex] = useState<string>(DARB_ZONE_ORDER[0]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstField = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    firstField.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const from = Number.parseInt(start, 10);
  const to = Number.parseInt(end, 10);

  /**
   * The same rules the route enforces, applied here so the operator sees the
   * problem before submitting. The route stays the authority — this only saves
   * them a round trip.
   */
  const wellFormed = (n: number) => Number.isInteger(n) && n >= MIN_STICKER && n <= MAX_STICKER;
  const span = wellFormed(from) && wellFormed(to) && to >= from ? to - from + 1 : null;
  const valid =
    Boolean(carrierId) &&
    Boolean(DARB_ZONES[colorHex]) &&
    span !== null &&
    span <= MAX_ROLL_SPAN;

  const sorted = useMemo(
    () =>
      [...rolls].sort((a, b) => {
        if (a.status !== b.status) return a.status === "open" ? -1 : 1;
        return (DARB_ZONE_ORDER.indexOf(a.color_hex) - DARB_ZONE_ORDER.indexOf(b.color_hex));
      }),
    [rolls],
  );

  async function send(init: RequestInit) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/warehouse/sticker-rolls", {
        headers: { "Content-Type": "application/json" },
        ...init,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? String(res.status));
        return false;
      }
      onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "network");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    if (!valid || saving) return;
    const ok = await send({
      method: "POST",
      body: JSON.stringify({
        carrier_id: carrierId,
        color_hex: colorHex,
        range_start: from,
        range_end: to,
        label: label.trim() || null,
        band_code: DARB_ZONES[colorHex]?.nameAr ?? null,
      }),
    });
    if (ok) {
      setStart("");
      setEnd("");
      setLabel("");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-[620px] flex-col rounded-wh border border-wh-border bg-wh-surface shadow-lg">
        <header className="border-b border-wh-border px-5 py-4">
          <h2 className="text-[15px] font-semibold text-wh-ink-1">{t("title")}</h2>
          <p className="mt-1 text-[12.5px] text-wh-ink-2">{t("hint")}</p>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className={`mb-2 ${WH_LABEL}`}>{t("onShelf")}</div>
          {sorted.length === 0 ? (
            <p className="rounded-[8px] border border-wh-warn-edge bg-wh-warn-bg px-3 py-2.5 text-[12.5px] text-wh-warn">
              {t("none")}
            </p>
          ) : (
            <ul className="mb-5 flex flex-col gap-1.5">
              {sorted.map((r) => (
                <li
                  key={r.id}
                  className={`flex flex-wrap items-center gap-3 rounded-[10px] border border-wh-border px-3 py-2.5 ${
                    r.status === "open" ? "bg-wh-surface" : "bg-wh-sunken opacity-70"
                  }`}
                >
                  <span
                    className="h-5 w-5 shrink-0 rounded-full border border-black/15"
                    style={{ background: r.color_hex }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <b className="block truncate text-[13px] font-semibold text-wh-ink-1">
                      {r.label || r.colour_fr}
                    </b>
                    <span className="block font-mono text-[11.5px] tabular-nums text-wh-ink-3">
                      {r.range_start} – {r.range_end}
                    </span>
                  </span>
                  <span className="ms-auto text-end">
                    {r.status === "open" ? (
                      <>
                        <b className="block font-mono text-[15px] font-bold tabular-nums text-wh-ink-1">
                          {r.remaining}
                        </b>
                        <span className="block text-[11px] text-wh-ink-3">{t("remaining")}</span>
                      </>
                    ) : (
                      <span className="text-[12px] font-semibold text-wh-ink-3">
                        {r.status === "exhausted" ? t("exhausted") : t("void")}
                      </span>
                    )}
                  </span>
                  {r.status === "open" ? (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        void send({
                          method: "PATCH",
                          body: JSON.stringify({ id: r.id, status: "exhausted" }),
                        })
                      }
                      className="rounded-[8px] border border-wh-border px-2.5 py-1.5 text-[12px] font-semibold text-wh-ink-2 hover:border-wh-border-strong disabled:opacity-50"
                    >
                      {t("markExhausted")}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <div className={`mb-2 ${WH_LABEL}`}>{t("addTitle")}</div>

          {accounts.length === 0 ? (
            // Tunisia prints its own labels, so there is no roll to register.
            <p className="rounded-[8px] bg-wh-sunken px-3 py-2.5 text-[12.5px] text-wh-ink-2">
              {t("noAccounts")}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className={WH_LABEL}>{t("fieldAccount")}</span>
                <select
                  ref={firstField}
                  value={carrierId}
                  onChange={(e) => setCarrierId(e.target.value)}
                  className="rounded-[8px] border border-wh-border bg-wh-surface px-3 py-2 text-[13px] text-wh-ink-1 outline-none focus:border-wh-ok"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className={WH_LABEL}>{t("fieldColour")}</span>
                <div className="flex items-center gap-2.5">
                  {/* The swatch is Darb's own hex, so the picker matches the
                      roll on the shelf rather than a palette we invented. */}
                  <span
                    className="h-8 w-8 shrink-0 rounded-full border border-black/15"
                    style={{ background: colorHex }}
                    aria-hidden="true"
                  />
                  <select
                    value={colorHex}
                    onChange={(e) => setColorHex(e.target.value)}
                    className="flex-1 rounded-[8px] border border-wh-border bg-wh-surface px-3 py-2 text-[13px] text-wh-ink-1 outline-none focus:border-wh-ok"
                  >
                    {DARB_ZONE_ORDER.map((hex) => (
                      <option key={hex} value={hex}>
                        {DARB_ZONES[hex].colourFr} — {DARB_ZONES[hex].nameFr}
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className={WH_LABEL}>{t("fieldStart")}</span>
                  <input
                    inputMode="numeric"
                    value={start}
                    onChange={(e) => setStart(e.target.value.replace(/\D/g, ""))}
                    placeholder="889188"
                    className="rounded-[8px] border border-wh-border bg-wh-surface px-3 py-2 font-mono text-[15px] font-semibold tabular-nums text-wh-ink-1 outline-none focus:border-wh-ok"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={WH_LABEL}>{t("fieldEnd")}</span>
                  <input
                    inputMode="numeric"
                    value={end}
                    onChange={(e) => setEnd(e.target.value.replace(/\D/g, ""))}
                    placeholder="889287"
                    className="rounded-[8px] border border-wh-border bg-wh-surface px-3 py-2 font-mono text-[15px] font-semibold tabular-nums text-wh-ink-1 outline-none focus:border-wh-ok"
                  />
                </label>
              </div>

              {/* The arithmetic, before they commit to it — the same reason the
                  physical count shows its delta. */}
              <div className="rounded-[8px] bg-wh-sunken px-3 py-2 text-[12.5px] text-wh-ink-2">
                {span !== null ? (
                  <>
                    {t("spanCount", { n: span })}
                    {span > MAX_ROLL_SPAN ? (
                      <b className="ms-2 text-wh-bad">{t("spanTooWide")}</b>
                    ) : null}
                  </>
                ) : (
                  t("spanHint")
                )}
              </div>

              <label className="flex flex-col gap-1.5">
                <span className={WH_LABEL}>{t("fieldLabel")}</span>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={t("labelPlaceholder")}
                  className="rounded-[8px] border border-wh-border bg-wh-surface px-3 py-2 text-[13px] text-wh-ink-1 outline-none focus:border-wh-ok"
                />
              </label>
            </div>
          )}

          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-[8px] border border-wh-bad-edge bg-wh-bad-bg px-3 py-2 text-[12.5px] text-wh-bad"
            >
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
            {t("close")}
          </button>
          {accounts.length > 0 ? (
            <button
              type="button"
              onClick={submit}
              disabled={!valid || saving}
              className="rounded-[8px] border border-wh-ok bg-wh-ok px-3.5 py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("save")}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
