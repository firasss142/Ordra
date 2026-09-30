"use client";

// Prototype: whatsapp-manager-v1.html?screen=parametres. Unlike its sibling
// sections this one is translated (whatsappAdmin.settings): the WhatsApp
// screens ship in French and Arabic from the start.

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Info, Lock, Zap } from "lucide-react";
import type { MarketSettings } from "@/types/settings";
import { isValidSendWindow } from "@/types/settings";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useWhatsAppAvailability } from "@/hooks/useWhatsAppAvailability";
import { useWhatsAppTemplates } from "@/hooks/useWhatsAppTemplates";
import { LIFECYCLE_EVENT_KEYS, type LifecycleEventKey } from "@/lib/whatsapp/types";
import { marketTimezone } from "@/lib/markets";
import { inputClass } from "./SectionShell";
import { SettingToggle } from "./SettingToggle";
import { OptionCards } from "./OptionCards";
import { ChangeHistoryPopover } from "../ChangeHistoryPopover";

interface Props {
  values: MarketSettings;
  marketId: string;
  set: <K extends keyof MarketSettings>(key: K, value: MarketSettings[K]) => void;
  onSave: () => void;
  onReset: () => void;
  saving: boolean;
  successMsg: string;
  errorMsg: string;
  /** market_manager: sees everything, changes nothing (owner's decision). */
  readOnly?: boolean;
}

const EVENT_SETTING: Record<LifecycleEventKey, keyof MarketSettings> = {
  could_not_reach: "whatsapp_event_could_not_reach",
  shipped: "whatsapp_event_shipped",
  out_for_delivery: "whatsapp_event_out_for_delivery",
  last_chance: "whatsapp_event_last_chance",
  delivered: "whatsapp_event_delivered",
};

type TplState = "ok" | "pend" | "none";
const TPL_CLS: Record<TplState, string> = {
  ok: "bg-status-successBg text-status-success",
  pend: "bg-status-warningBg text-status-warning",
  none: "bg-status-criticalBg text-status-critical",
};
const LANGS = ["fr", "ar"] as const;

function tierRecipients(tier: string | null | undefined): number | null {
  if (!tier) return null;
  const m = /^TIER_(\d+)(K?)$/.exec(tier);
  return m ? Number(m[1]) * (m[2] ? 1000 : 1) : null;
}

export function WhatsAppSection({ values, marketId, set, onSave, onReset, saving, successMsg, errorMsg, readOnly = false }: Props) {
  const t = useTranslations("whatsappAdmin.settings");
  const tCommon = useTranslations("whatsappAdmin.common");
  const { availability } = useWhatsAppAvailability(marketId);
  const { templates } = useWhatsAppTemplates(marketId);
  const master = values.whatsapp_lifecycle_enabled ?? false;
  const [windowDraft, setWindowDraft] = useState<string | null>(null);

  const stateFor = useMemo(() => {
    return (event: LifecycleEventKey, lang: "fr" | "ar"): TplState => {
      const rows = templates.filter((tp) => tp.event_key === event && tp.language === lang);
      if (rows.some((tp) => tp.status === "APPROVED")) return "ok";
      if (rows.some((tp) => tp.status === "PENDING")) return "pend";
      return "none";
    };
  }, [templates]);

  const connected = availability?.connected ?? null;
  const recipients = tierRecipients(availability?.messaging_limit_tier);
  const unverified = connected && recipients !== null && recipients <= 250;
  // One line per gap, naming the language and the event (prototype pWarnTpl).
  const missing = master
    ? LIFECYCLE_EVENT_KEYS.filter((k) => values[EVENT_SETTING[k]] === true).flatMap((k) =>
        LANGS.filter((l) => stateFor(k, l) !== "ok").map((l) => t("warnMissing", { language: t(`inLanguage.${l}`), event: t(`events.${k}.label`) })),
      )
    : [];

  const windowValue = windowDraft ?? values.whatsapp_send_window ?? "";
  const windowInvalid = !isValidSendWindow(windowValue);

  return (
    <div className="flex flex-col gap-4">
      {readOnly ? (
        <div role="note" className="flex items-start gap-2.5 rounded-md border border-line bg-surface-sunken px-4 py-2.5 text-[13px] text-ink-secondary">
          <Lock size={15} aria-hidden className="mt-px shrink-0" />
          <span>{tCommon("readOnly")}</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {errorMsg && <span className="text-[13px] text-status-critical">{errorMsg}</span>}
          {successMsg && <span className="text-[13px] text-status-success">{successMsg}</span>}
          <Button variant="secondary" size="sm" onClick={onReset}>
            {t("reset")}
          </Button>
          <Button variant="primary" size="sm" disabled={saving} onClick={onSave}>
            {saving ? t("saving") : t("save")}
          </Button>
        </div>
      )}

      {connected === false && (
        <div role="status" className="flex gap-3 rounded-md border border-line bg-surface-sunken px-4 py-3 text-[13px] text-ink-primary">
          <Info size={16} aria-hidden className="mt-px shrink-0 text-ink-secondary" />
          <div>
            <b className="block">{t("noConfigTitle")}</b>
            {t("noConfig")}
          </div>
        </div>
      )}
      {unverified && (
        <div role="status" className="flex gap-3 rounded-md border border-[#F5E1A4] bg-status-warningBg px-4 py-3 text-[13px] text-[#7A5B00]">
          <AlertTriangle size={16} aria-hidden className="mt-px shrink-0" />
          <div>{t("warnUnverified")}</div>
        </div>
      )}
      {missing.length > 0 && (
        <div role="alert" className="flex gap-3 rounded-md border border-[#F5C6BC] bg-status-criticalBg px-4 py-3 text-[13px] text-[#9A2A14]">
          <AlertTriangle size={16} aria-hidden className="mt-px shrink-0" />
          <div>
            {missing.map((line) => (
              <div key={line}>{line}</div>
            ))}
            <div>{missing.length > 1 ? t("warnMissingTailMany") : t("warnMissingTail")}</div>
          </div>
        </div>
      )}

      <Card className="overflow-visible">
        <CardHeader>
          <h2 className="m-0 flex items-center gap-2 text-[15px] font-semibold text-ink-primary">
            <Zap size={16} strokeWidth={1.9} aria-hidden />
            {t("card")}
          </h2>
          <p className="m-0 mt-0.5 text-[12.5px] text-ink-secondary">{t("cardSub")}</p>
        </CardHeader>

        <div className="flex items-center justify-between gap-4 border-b border-line-subtle bg-surface-sunken px-5 py-3">
          <div className="min-w-0">
            <div className="text-[13.5px] font-medium text-ink-primary">{t("master")}</div>
            <p className="m-0 mt-0.5 text-[12.5px] text-ink-secondary">{t("masterHint")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-[12.5px] text-ink-secondary">
            <SettingToggle on={master} onToggle={() => set("whatsapp_lifecycle_enabled", !master)} label={t("master")} disabled={readOnly} />
            <span>{master ? t("on") : t("off")}</span>
          </div>
        </div>

        <div className="divide-y divide-line-subtle">
          {LIFECYCLE_EVENT_KEYS.map((k) => {
            const setting = EVENT_SETTING[k];
            const on = values[setting] === true;
            const label = t(`events.${k}.label`);
            return (
              <div key={k} className="flex items-center justify-between gap-4 px-5 py-3" data-testid={`wa-event-${k}`}>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium text-ink-primary">{label}</div>
                  <p className="m-0 mt-0.5 text-[12.5px] text-ink-secondary">{t(`events.${k}.hint`)}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {LANGS.map((l) => {
                      const st = stateFor(k, l);
                      return (
                        <span key={l} className={`rounded-pill px-2 py-0.5 text-[12px] font-semibold ${TPL_CLS[st]}`}>
                          {l} · {t(`tpl.${st}`)}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-[12.5px] text-ink-secondary">
                  <SettingToggle on={on} onToggle={() => set(setting, !on as never)} label={label} disabled={readOnly || !master} />
                  <span>{on ? t("on") : t("off")}</span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="overflow-visible">
          <CardHeader className="flex items-center justify-between gap-3 py-3">
            <h2 className="m-0 text-[14px] font-semibold text-ink-primary">{t("lang")}</h2>
            <ChangeHistoryPopover marketId={marketId} settingKey="whatsapp_default_language" />
          </CardHeader>
          <CardBody>
            <p className="m-0 mb-2.5 text-[12.5px] text-ink-secondary">{t("langHint")}</p>
            <OptionCards
              value={values.whatsapp_default_language ?? ""}
              onChange={(v) => set("whatsapp_default_language", (v === "ar" || v === "fr" ? v : undefined) as MarketSettings["whatsapp_default_language"])}
              options={[
                { value: "ar", label: tCommon("language.ar"), hint: "ar" },
                { value: "fr", label: tCommon("language.fr"), hint: "fr" },
              ]}
              disabled={readOnly}
            />
          </CardBody>
        </Card>
        <Card className="overflow-visible">
          <CardHeader className="flex items-center justify-between gap-3 py-3">
            <h2 className="m-0 text-[14px] font-semibold text-ink-primary">{t("window")}</h2>
            <ChangeHistoryPopover marketId={marketId} settingKey="whatsapp_send_window" />
          </CardHeader>
          <CardBody>
            <p className="m-0 mb-2.5 text-[12.5px] text-ink-secondary">{t("windowHint")}</p>
            <div className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
              <input
                value={windowValue}
                onChange={(ev) => {
                  setWindowDraft(ev.target.value);
                  if (isValidSendWindow(ev.target.value)) set("whatsapp_send_window", ev.target.value.trim() as MarketSettings["whatsapp_send_window"]);
                }}
                placeholder="10-20"
                dir="ltr"
                aria-label={t("window")}
                aria-invalid={windowInvalid}
                className={`${inputClass} w-[120px] tabular-nums ${windowInvalid ? "border-status-critical" : ""}`}
                disabled={readOnly}
              />
              <span>{t("windowUnit", { tz: marketTimezone(marketId) })}</span>
            </div>
            {windowInvalid && (
              <p role="alert" className="m-0 mt-1 text-[12px] text-status-critical">
                {t("windowInvalid")}
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
