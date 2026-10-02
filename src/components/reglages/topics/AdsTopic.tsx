"use client";

import { useState } from "react";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { Megaphone, Plus } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { marketTimezone } from "@/lib/markets";
import type { TopicProps } from "../TopicBody";
import { useRegisterSaver } from "../form-context";
import { SettingsCard, RgBadge, EmptyState, Mark, Drawer, DrawerSection, Field, inputClass, th, td, trPlain } from "../kit/parts";
import { SettingRow } from "../kit/SettingRow";
import { NumberField } from "../kit/NumberField";
import { HistoryButton } from "../kit/HistoryButton";
import { Switch } from "../kit/Switch";
import { RgButton } from "../kit/RgButton";
import { ConfirmDialog } from "../kit/ConfirmDialog";
import { TopicSkeleton } from "../kit/TopicSkeleton";

interface Account {
  id: string;
  market_id: string;
  ad_account_id: string;
  account_name: string | null;
  account_currency: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  last_sync_error: string | null;
}

const CURRENCY = { tn: "TND", ly: "LYD" } as const;

/**
 * Réglages › Publicité (administrator) — the market's Meta ad accounts and the
 * dollar rate their spend is converted at. The connect form no longer shows to
 * a manager it would always refuse.
 */
export function AdsTopic({ marketId, marketCode }: TopicProps) {
  const t = useTranslations("reglages");
  const locale = useLocale();
  const toast = useToast();
  const { data: accountsData, mutate } = useSWR<{ data: Account[] }>("/api/meta/accounts");
  const { data: fxData, mutate: mutateFx } = useSWR<{ data: { rates: Record<string, number> } }>(`/api/meta/fx-rate?market_id=${marketId}`);
  const [rateEdit, setRateEdit] = useState<{ value: number | null } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState<Account | null>(null);
  const currency = marketCode ? CURRENCY[marketCode] : "";
  const stored = fxData?.data.rates?.USD ?? null;
  const rate = rateEdit ? rateEdit.value : stored;

  useRegisterSaver("fx", {
    count: rateEdit ? 1 : 0,
    validate: () => (rateEdit && (rateEdit.value === null || rateEdit.value <= 0) ? t("save.invalid") : null),
    save: async () => {
      const res = await fetch("/api/meta/fx-rate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market_id: marketId, currency: "USD", rate: rateEdit?.value }),
      });
      if (!res.ok) throw new Error(t("save.failed"));
      await mutateFx();
      setRateEdit(null);
    },
    reset: () => setRateEdit(null),
  });

  if (!accountsData) return <TopicSkeleton cards={2} rows={1} />;
  const accounts = accountsData.data.filter((a) => a.market_id === marketId);
  const name = (a: Account) => a.account_name ?? a.ad_account_id;
  const fmtNum = (n: number) => n.toLocaleString(locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR", { maximumFractionDigits: 4 });

  const sync = (a: Account) => {
    if (a.last_sync_error) return <RgBadge tone="bad">{t("ads.syncError")}</RgBadge>;
    if (!a.last_synced_at) return <RgBadge tone="neutral">{t("ads.neverSynced")}</RgBadge>;
    const tz = marketTimezone(marketId);
    const d = new Date(a.last_synced_at);
    const day = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(x);
    const loc = locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR";
    return day(d) === day(new Date()) ? (
      <RgBadge tone="ok">{t("ads.syncedToday", { time: new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(d) })}</RgBadge>
    ) : (
      <RgBadge tone="neutral">{t("ads.syncedOn", { date: new Intl.DateTimeFormat(loc, { day: "numeric", month: "short", timeZone: tz }).format(d) })}</RgBadge>
    );
  };

  const toggle = async (a: Account, next: boolean) => {
    const res = await fetch(`/api/meta/accounts/${a.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: next }) });
    toast.show({ message: res.ok ? t(next ? "ads.toastOn" : "ads.toastOff", { name: name(a) }) : t("common.error"), tone: res.ok ? "info" : "critical" });
    await mutate();
  };
  const runTest = async (a: Account) => {
    const res = await fetch(`/api/meta/accounts/${a.id}/test`, { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as { data?: { ok?: boolean; stages?: { status: string; detail?: string }[] } };
    const failed = body.data?.stages?.find((s) => s.status === "failed");
    toast.show({
      message: body.data?.ok ? t("ads.testOk", { name: name(a) }) : t("ads.testFail", { name: name(a), reason: failed?.detail ?? t("common.error") }),
      tone: body.data?.ok ? "info" : "critical",
    });
    await mutate();
  };

  const fxLabel = t("ads.fxLabel");
  return (
    <>
      <SettingsCard
        title={t("ads.accountsTitle")}
        description={t("ads.accountsDesc")}
        end={
          <RgButton variant="primary" onClick={() => setConnecting(true)}>
            <Plus aria-hidden />
            {t("ads.connect")}
          </RgButton>
        }
      >
        {accounts.length === 0 ? (
          <EmptyState icon={<Megaphone aria-hidden />} title={t("ads.emptyTitle")} text={t("ads.emptyText")} />
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>{t("ads.colAccount")}</th>
                <th className={th}>{t("ads.colCurrency")}</th>
                <th className={th}>{t("ads.colSync")}</th>
                <th className={`${th} text-end`}>{t("ads.colActive")}</th>
                <th className={`${th} w-[1%]`} />
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className={trPlain}>
                  <td className={td}>
                    <div className="flex items-center gap-[10px]">
                      <Mark>
                        <Megaphone aria-hidden />
                      </Mark>
                      <div>
                        <b className="block font-semibold">{name(a)}</b>
                        <span className="font-mono text-[12px] text-ink-secondary" dir="ltr">
                          Meta · {a.ad_account_id}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className={td}>{a.account_currency ?? "—"}</td>
                  <td className={td} title={a.last_sync_error ?? undefined}>
                    {sync(a)}
                  </td>
                  <td className={`${td} w-[1%] text-end`}>
                    <Switch checked={a.is_active} onChange={(v) => void toggle(a, v)} label={name(a)} />
                  </td>
                  <td className={`${td} w-[1%] whitespace-nowrap text-end`}>
                    <span className="inline-flex gap-[6px]">
                      <RgButton size="sm" onClick={() => void runTest(a)}>
                        {t("ads.test")}
                      </RgButton>
                      <RgButton size="sm" variant="quiet" onClick={() => setDisconnecting(a)}>
                        {t("ads.disconnect")}
                      </RgButton>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SettingsCard>

      <SettingsCard title={t("ads.fxTitle")} description={t("ads.fxDesc")}>
        <SettingRow
          label={fxLabel}
          dirty={!!rateEdit}
          help={rate ? t("ads.fxHelp", { n: fmtNum(rate), cur: currency }) : t("ads.fxHelpEmpty")}
          control={
            <NumberField
              label={fxLabel}
              prefix="1 USD ="
              value={rate}
              unit={currency}
              step={0.1}
              dirty={!!rateEdit}
              onChange={(v) => setRateEdit(v === stored ? null : { value: v })}
            />
          }
          history={
            <HistoryButton
              marketId={marketId}
              settingKey="ad_spend_fx_rates"
              label={fxLabel}
              format={(v) => {
                const usd = (v as Record<string, number> | null)?.USD;
                return typeof usd === "number" ? fmtNum(usd) : "—";
              }}
            />
          }
        />
      </SettingsCard>

      {connecting && (
        <ConnectAccountDrawer
          marketId={marketId}
          onClose={() => setConnecting(false)}
          onConnected={async () => {
            await mutate();
            setConnecting(false);
          }}
        />
      )}
      {disconnecting && (
        <ConfirmDialog
          title={t("ads.disconnectTitle", { name: name(disconnecting) })}
          body={t("ads.disconnectBody")}
          cancelLabel={t("common.cancel")}
          confirmLabel={t("ads.disconnect")}
          onCancel={() => setDisconnecting(null)}
          onConfirm={async () => {
            const a = disconnecting;
            setDisconnecting(null);
            const res = await fetch(`/api/meta/accounts/${a.id}`, { method: "DELETE" });
            toast.show({ message: res.ok ? t("ads.disconnected", { name: name(a) }) : t("common.error"), tone: res.ok ? "info" : "critical" });
            await mutate();
          }}
        />
      )}
    </>
  );
}

function ConnectAccountDrawer({ marketId, onClose, onConnected }: { marketId: string; onClose: () => void; onConnected: () => Promise<void> }) {
  const t = useTranslations("reglages");
  const [account, setAccount] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const KNOWN = ["invalid_account_id", "invalid_token", "meta_unreachable"];

  const connect = async () => {
    if (!account.trim() || !token.trim()) {
      setError(t("ads.drawer.required"));
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/meta/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ market_id: marketId, ad_account_id: account.trim(), access_token: token.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error && KNOWN.includes(body.error) ? t(`ads.drawer.errors.${body.error}`) : t("common.error"));
      return;
    }
    await onConnected();
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("ads.drawer.title")}
      footer={
        <>
          {error && (
            <span role="alert" className="text-[12.5px] text-status-critical">
              {error}
            </span>
          )}
          <span className="flex-1" />
          <RgButton onClick={onClose}>{t("common.cancel")}</RgButton>
          <RgButton variant="primary" onClick={() => void connect()} disabled={busy}>
            {t("ads.drawer.save")}
          </RgButton>
        </>
      }
    >
      <DrawerSection>
        <Field label={t("ads.drawer.accountId")} htmlFor="rg-meta-account" help={t("ads.drawer.accountIdHelp")}>
          <input id="rg-meta-account" dir="ltr" className={`${inputClass} font-mono text-[12.5px]`} value={account} onChange={(e) => setAccount(e.target.value)} />
        </Field>
        <Field label={t("ads.drawer.token")} htmlFor="rg-meta-token" help={t("ads.drawer.tokenHelp")}>
          <input id="rg-meta-token" type="password" dir="ltr" autoComplete="off" className={`${inputClass} font-mono text-[12.5px]`} value={token} onChange={(e) => setToken(e.target.value)} />
        </Field>
      </DrawerSection>
    </Drawer>
  );
}
