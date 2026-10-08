"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { History, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { meaningfulHistory, plainSettingValue } from "@/lib/reglages/helpers";

interface HistoryRow {
  id: string;
  old_value: unknown;
  new_value: unknown;
  changed_at: string;
  users?: { full_name: string | null } | null;
}

/**
 * The clock beside a setting (prototype `.hb` + `.pop`): who changed it, when,
 * from what to what. Rows that only changed the storage format are hidden.
 */
export function HistoryButton({
  marketId,
  settingKey,
  label,
  format,
}: {
  marketId: string;
  settingKey: string;
  label: string;
  /** Turn a stored value into words (« Manuelle », « 8,4 »). */
  format?: (value: unknown) => string;
}) {
  const t = useTranslations("reglages");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const { data } = useSWR<{ data: HistoryRow[] }>(
    open ? `/api/settings/${marketId}/history?key=${encodeURIComponent(settingKey)}` : null,
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const show = (v: unknown) => {
    const plain = plainSettingValue(v);
    if (plain === null || plain === undefined) return t("history.unknown");
    if (format) return format(plain);
    return Array.isArray(plain) ? plain.join(" · ") : String(plain);
  };
  const rows = meaningfulHistory(data?.data ?? []);
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div ref={ref} className="static">
      <button
        type="button"
        aria-label={t("history.button")}
        title={t("history.button")}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rg-hist"
      >
        <History className="h-[16px] w-[16px]" aria-hidden />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="rg-pop absolute end-[16px] top-[50px] z-30 w-[340px]"
        >
          <div className="flex items-center gap-[8px] border-b border-line-subtle px-[12px] py-[10px] text-[13px] font-semibold">
            <History className="h-[16px] w-[16px]" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("common.close")}
              className="grid h-[28px] w-[28px] place-items-center rounded-[6px] text-ink-secondary hover:bg-surface-selected"
            >
              <X className="h-[15px] w-[15px]" aria-hidden />
            </button>
          </div>
          {!data ? (
            <div className="px-[12px] py-[12px] text-[13px] text-ink-secondary">{t("history.loading")}</div>
          ) : rows.length === 0 ? (
            <div className="px-[12px] py-[12px] text-[13px] text-ink-secondary">{t("history.empty")}</div>
          ) : (
            <ol className="m-0 list-none py-[4px]">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-[10px] gap-y-[2px] border-t border-line-subtle px-[12px] py-[8px] text-[13px] first:border-t-0"
                >
                  <span className="truncate">{r.users?.full_name ?? t("history.unknown")}</span>
                  <span className="whitespace-nowrap font-semibold">
                    <span className="font-normal text-[#8C9196]">{show(r.old_value)}</span>
                    <span className="mx-[4px] text-[#8C9196]" aria-hidden>
                      →
                    </span>
                    {show(r.new_value)}
                  </span>
                  <small className="col-span-full text-[12px] text-ink-secondary">{date(r.changed_at)}</small>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
