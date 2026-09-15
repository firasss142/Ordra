"use client";

/**
 * « Programmer un rappel » — the customer asked to be called back later.
 *
 * The presets come from callbackChoices() in lib/prospects/presentation, the
 * same helper the agent worklist uses, so "ce soir" means 18:00 on the
 * market's clock and not on the browser's. An agent in Tripoli and a manager
 * in Tunis pick the same hour from the same words.
 *
 * Design: prototypes/prospects-manager-v1.html.
 */
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Calendar } from "lucide-react";
import { callbackChoices } from "@/lib/prospects/presentation";
import { timeOnMarketClock } from "../ui";
import { Field, INPUT, OUTLINE, PRIMARY, Sheet, Toggle } from "../console/ui";

export interface CallbackSheetProps {
  customerName: string;
  busy: boolean;
  error: string | null;
  onConfirm: (input: { at: string; note: string }) => void;
  onClose: () => void;
  tz: string;
  locale: string;
  now: number;
}

export function CallbackSheet({
  customerName, busy, error, onConfirm, onClose, tz, locale, now,
}: CallbackSheetProps) {
  const t = useTranslations("prospects.console.cbk");
  const tc = useTranslations("prospects.console");

  const choices = useMemo(() => callbackChoices(now, tz), [now, tz]);
  const [at, setAt] = useState<string>(() => choices[0]?.at ?? "");
  const [custom, setCustom] = useState(false);
  const [note, setNote] = useState("");

  // The API refuses a time in the past; the button waits rather than letting
  // the agent discover that after pressing it.
  const valid = at !== "" && Date.parse(at) > now;

  return (
    <Sheet
      title={t("t")}
      sub={t("sub", { name: customerName })}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={`ms-auto h-11 px-4 text-[14px] ${OUTLINE}`}>
            {tc("panel.cancel")}
          </button>
          <button type="button" disabled={busy || !valid} onClick={() => onConfirm({ at, note })}
            className={`h-11 min-w-[150px] px-4 text-[14px] ${PRIMARY}`}>
            <Calendar size={16} aria-hidden />
            {t("go")}
          </button>
        </>
      }
    >
      {error ? (
        <p role="alert" className="m-0 rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2.5 text-[13.5px] text-[#B91C1C]">
          {error}
        </p>
      ) : null}

      <Field label={t("when")}>
        <div className="flex flex-wrap gap-1.5">
          {choices.map((c) => (
            <Toggle
              key={c.key}
              on={!custom && at === c.at}
              onClick={() => { setCustom(false); setAt(c.at); }}
            >
              {t(c.key)}
              <small className="ms-1 text-[12px] opacity-70">{timeOnMarketClock(c.at, tz, locale)}</small>
            </Toggle>
          ))}
          <Toggle on={custom} onClick={() => setCustom(true)}>{t("custom")}</Toggle>
        </div>
      </Field>

      {custom ? (
        <Field label={t("when")}>
          <input
            type="datetime-local"
            className={INPUT}
            onChange={(e) => setAt(e.target.value ? new Date(e.target.value).toISOString() : "")}
          />
        </Field>
      ) : null}

      <Field label={t("note")}>
        <textarea value={note} onChange={(e) => setNote(e.target.value)}
          className={`${INPUT} h-auto min-h-[72px] py-2`} />
      </Field>
    </Sheet>
  );
}
