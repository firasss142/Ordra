"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { MessageCircle, Plug, Pause, Play, ChevronRight } from "lucide-react";
import { canEditArea } from "@/lib/reglages/topics";
import { formatSendWindow, parseSendWindow } from "@/lib/reglages/helpers";
import type { MarketSettings } from "@/types/settings";
import type { TopicProps } from "../TopicBody";
import { useMarketSettingsForm } from "../useMarketSettingsForm";
import { SettingsCard, ReadOnlyLine, RgBadge, EmptyState, StateBadge } from "../kit/parts";
import { SettingRow } from "../kit/SettingRow";
import { Switch } from "../kit/Switch";
import { NumberField } from "../kit/NumberField";
import { OptionCards } from "../kit/OptionCards";
import { RgButton } from "../kit/RgButton";
import { TopicSkeleton } from "../kit/TopicSkeleton";
import { WhatsAppConnectDrawer, type WhatsAppConfig } from "./whatsapp/WhatsAppConnectDrawer";

const EVENTS = ["could_not_reach", "shipped", "out_for_delivery", "last_chance", "delivered"] as const;
type EventKey = (typeof EVENTS)[number];
const eventSetting = (e: EventKey) => `whatsapp_event_${e}` as keyof MarketSettings;

function tierRecipients(tier: string | null | undefined): number | null {
  if (!tier) return null;
  if (tier === "TIER_UNLIMITED") return Infinity;
  const m = /^TIER_(\d+)(K?)$/.exec(tier);
  return m ? Number(m[1]) * (m[2] ? 1000 : 1) : null;
}

/**
 * Réglages › WhatsApp — the connected number (Connexions › Services tiers) and
 * the automatic messages (Paramètres › WhatsApp), one page. Set by the
 * administrator; a manager reads it.
 */
export function WhatsAppTopic({ user, marketId, marketCode }: TopicProps) {
  const t = useTranslations("reglages");
  const locale = useLocale();
  const form = useMarketSettingsForm(marketId);
  const editable = canEditArea(user.role, "whatsapp");
  const { data: configData, mutate: mutateConfig } = useSWR<{ data: WhatsAppConfig[] }>("/api/whatsapp/config");
  const { data: tplData } = useSWR<{ data: { event_key: string | null; language: string; status: string }[] }>(`/api/whatsapp/templates?market_id=${marketId}`);
  const [drawer, setDrawer] = useState(false);
  const [test, setTest] = useState<null | "running" | { ok: boolean; reason?: string }>(null);
  if (!configData || !form.loaded) return <TopicSkeleton cards={2} />;

  const cfg = configData.data.find((c) => c.market_id === marketId);
  const marketName = marketCode ? t(`market.${marketCode}`) : "";
  const lock = editable ? undefined : <ReadOnlyLine />;

  const tplState = (event: EventKey, lang: "fr" | "ar") => {
    const rows = (tplData?.data ?? []).filter((x) => x.event_key === event && x.language === lang);
    if (rows.some((x) => x.status === "APPROVED")) return "ok" as const;
    if (rows.some((x) => x.status === "PENDING")) return "pend" as const;
    return "none" as const;
  };
  const tone = { ok: "ok", pend: "warn", none: "neutral" } as const;

  if (!cfg) {
    return (
      <>
        <SettingsCard title={t("whatsapp.numberTitle")} end={lock}>
          <EmptyState
            icon={<MessageCircle aria-hidden />}
            title={t("whatsapp.notConnectedTitle", { market: marketName })}
            text={t("whatsapp.notConnectedText")}
            actions={
              editable ? (
                <RgButton variant="primary" onClick={() => setDrawer(true)}>
                  <Plug aria-hidden />
                  {t("whatsapp.connect")}
                </RgButton>
              ) : (
                <ReadOnlyLine text={t("whatsapp.adminConnects")} />
              )
            }
          />
        </SettingsCard>
        <SettingsCard title={t("whatsapp.autoTitle")} description={t("whatsapp.autoDisabledDesc")}>
          {EVENTS.map((e) => (
            <SettingRow key={e} muted label={t(`whatsapp.events.${e}.label`)} help={t(`whatsapp.events.${e}.help`)} control={<StateBadge on={false} />} />
          ))}
        </SettingsCard>
        {drawer && <WhatsAppConnectDrawer marketId={marketId} marketCode={marketCode} config={undefined} onClose={() => setDrawer(false)} onSaved={async () => { await mutateConfig(); setDrawer(false); }} />}
      </>
    );
  }

  const recipients = tierRecipients(cfg.messaging_limit_tier);
  const limit =
    recipients === null ? "—" : recipients === Infinity ? t("whatsapp.limitUnlimited") : recipients <= 250 ? t("whatsapp.limitUnverified", { n: recipients }) : t("whatsapp.limitN", { n: recipients.toLocaleString("fr-FR") });
  const quality = (cfg.quality_rating ?? "UNKNOWN").toUpperCase();
  const qualityTone = quality === "GREEN" ? "ok" : quality === "YELLOW" ? "warn" : quality === "RED" ? "bad" : "neutral";
  const lastMessage = cfg.last_webhook_at
    ? new Intl.DateTimeFormat(locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(cfg.last_webhook_at))
    : t("whatsapp.never");

  const runTest = async () => {
    setTest("running");
    const res = await fetch(`/api/whatsapp/config/${marketId}/test`, { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as { data?: { ok?: boolean; stages?: { status: string; detail?: string }[] } };
    const failed = body.data?.stages?.find((s) => s.status === "failed");
    setTest(body.data?.ok ? { ok: true } : { ok: false, reason: failed?.detail ?? "—" });
    await mutateConfig();
  };
  const setStatus = async (status: "active" | "paused") => {
    await fetch(`/api/whatsapp/config/${marketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await mutateConfig();
  };

  const master = !!form.value("whatsapp_lifecycle_enabled");
  const lang = (form.value("whatsapp_default_language") ?? "ar") as "fr" | "ar";
  const sendWindow = parseSendWindow(form.value("whatsapp_send_window") as string | undefined) ?? { start: 0, end: 24 };
  const setWindow = (start: number | null, end: number | null) => {
    if (start === null || end === null) return;
    form.set("whatsapp_send_window", formatSendWindow(start, end));
  };

  return (
    <>
      <SettingsCard
        title={t("whatsapp.numberTitle")}
        end={
          editable ? (
            <>
              <RgButton onClick={() => void runTest()} disabled={test === "running"}>
                {test === "running" ? t("whatsapp.testing") : t("whatsapp.test")}
              </RgButton>
              <RgButton onClick={() => setDrawer(true)}>{t("whatsapp.editCreds")}</RgButton>
              {cfg.status === "paused" ? (
                <RgButton variant="quiet" onClick={() => void setStatus("active")}>
                  <Play aria-hidden />
                  {t("whatsapp.resume")}
                </RgButton>
              ) : (
                <RgButton variant="quiet" onClick={() => void setStatus("paused")}>
                  <Pause aria-hidden />
                  {t("whatsapp.pause")}
                </RgButton>
              )}
            </>
          ) : (
            <ReadOnlyLine />
          )
        }
      >
        <div className="px-[20px] py-[16px]">
          <dl className="m-0 grid grid-cols-[170px_minmax(0,1fr)] gap-x-[14px] gap-y-[9px] text-[13.5px]">
            <dt className="text-ink-secondary">{t("whatsapp.number")}</dt>
            <dd className="m-0 font-medium tabular-nums" dir="ltr">
              {cfg.display_phone ?? "—"}
            </dd>
            <dt className="text-ink-secondary">{t("whatsapp.verifiedName")}</dt>
            <dd className="m-0 font-medium">{cfg.verified_name ?? "—"}</dd>
            <dt className="text-ink-secondary">{t("whatsapp.quality")}</dt>
            <dd className="m-0">
              <RgBadge tone={qualityTone}>{t(`whatsapp.qualityLevel.${["GREEN", "YELLOW", "RED"].includes(quality) ? quality : "UNKNOWN"}`)}</RgBadge>
            </dd>
            <dt className="text-ink-secondary">{t("whatsapp.limit")}</dt>
            <dd className="m-0 font-medium">{limit}</dd>
            <dt className="text-ink-secondary">{t("whatsapp.state")}</dt>
            <dd className="m-0">
              {cfg.status === "paused" ? (
                <RgBadge tone="warn">{t("whatsapp.statePaused")}</RgBadge>
              ) : cfg.status === "auth_failed" ? (
                <RgBadge tone="bad">{t("whatsapp.stateAuthFailed")}</RgBadge>
              ) : (
                <RgBadge tone="ok">{t("whatsapp.stateActive")}</RgBadge>
              )}
            </dd>
            <dt className="text-ink-secondary">{t("whatsapp.lastMessage")}</dt>
            <dd className="m-0 font-medium">{lastMessage}</dd>
          </dl>
          {test && test !== "running" && (
            <p role="status" className={`m-0 mt-[12px] text-[13px] ${test.ok ? "text-status-success" : "text-status-critical"}`}>
              {test.ok ? t("whatsapp.testOk") : t("whatsapp.testFail", { reason: test.reason ?? "—" })}
            </p>
          )}
        </div>
      </SettingsCard>

      <SettingsCard title={t("whatsapp.autoTitle")} description={t("whatsapp.autoDesc")} end={lock}>
        <SettingRow
          sunken
          label={t("whatsapp.master")}
          help={t("whatsapp.masterHelp")}
          dirty={form.isDirty("whatsapp_lifecycle_enabled")}
          control={editable ? <Switch checked={master} onChange={(v) => form.set("whatsapp_lifecycle_enabled", v)} label={t("whatsapp.master")} /> : <StateBadge on={master} />}
        />
        {EVENTS.map((e) => {
          const key = eventSetting(e);
          const on = !!form.value(key);
          const label = t(`whatsapp.events.${e}.label`);
          return (
            <SettingRow
              key={e}
              label={label}
              dirty={form.isDirty(key)}
              help={
                <>
                  {t(`whatsapp.events.${e}.help`)}
                  <span className="mt-[6px] flex flex-wrap gap-[6px]">
                    {(["fr", "ar"] as const).map((l) => {
                      const s = tplState(e, l);
                      return (
                        <RgBadge key={l} tone={tone[s]}>
                          {t("whatsapp.tplLang", { lang: l.toUpperCase(), state: t(`whatsapp.tpl.${s}`) })}
                        </RgBadge>
                      );
                    })}
                  </span>
                </>
              }
              control={editable ? <Switch checked={on} onChange={(v) => form.set(key, v as never)} label={label} disabled={!master} /> : <StateBadge on={on} />}
            />
          );
        })}
        <SettingRow
          stack
          label={t("whatsapp.language")}
          help={t("whatsapp.languageHelp")}
          dirty={form.isDirty("whatsapp_default_language")}
          control={
            <OptionCards
              label={t("whatsapp.language")}
              columns={2}
              value={lang}
              disabled={!editable}
              onChange={(v) => form.set("whatsapp_default_language", v)}
              options={[
                { value: "fr", label: t("language.fr") },
                { value: "ar", label: t("language.ar") },
              ]}
            />
          }
        />
        <SettingRow
          label={t("whatsapp.window")}
          help={t("whatsapp.windowHelp")}
          dirty={form.isDirty("whatsapp_send_window")}
          control={
            editable ? (
              <>
                <NumberField label={t("whatsapp.windowFrom")} value={sendWindow.start} onChange={(n) => setWindow(n, sendWindow.end)} min={0} max={23} unit="h" width={52} />
                <span aria-hidden className="text-ink-secondary">
                  →
                </span>
                <NumberField label={t("whatsapp.windowTo")} value={sendWindow.end} onChange={(n) => setWindow(sendWindow.start, n)} min={1} max={24} unit="h" width={52} />
              </>
            ) : (
              <span className="font-semibold tabular-nums" dir="ltr">
                {sendWindow.start} h → {sendWindow.end} h
              </span>
            )
          }
        />
      </SettingsCard>

      <SettingsCard
        title={t("whatsapp.templatesTitle")}
        description={`${t("whatsapp.templatesDesc")} ${t("whatsapp.templatesCount", { approved: cfg.templates?.approved ?? 0, pending: cfg.templates?.pending ?? 0 })}`}
        end={
          <Link href={`/${locale}/messages/templates`} className="inline-flex h-[36px] items-center gap-[7px] rounded-[11px] border border-[rgba(15,23,40,.09)] bg-[rgba(255,255,255,.88)] px-[14px] text-[13px] font-bold hover:bg-white">
            {t("whatsapp.templatesLink")}
            <ChevronRight className="h-[15px] w-[15px] rtl:-scale-x-100" aria-hidden />
          </Link>
        }
      />

      {drawer && <WhatsAppConnectDrawer marketId={marketId} marketCode={marketCode} config={cfg} onClose={() => setDrawer(false)} onSaved={async () => { await mutateConfig(); setDrawer(false); }} />}
    </>
  );
}
