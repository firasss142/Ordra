"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import type { MarketCode } from "@/lib/markets";
import { Drawer, DrawerSection, Field, inputClass } from "../../kit/parts";
import { RgButton } from "../../kit/RgButton";
import { CopyBox } from "../shops/common";

export interface WhatsAppConfig {
  id: string;
  market_id: string;
  waba_id: string;
  phone_number_id: string;
  app_id: string;
  graph_version: string;
  display_phone: string | null;
  verified_name: string | null;
  quality_rating: string | null;
  messaging_limit_tier: string | null;
  status: string;
  last_webhook_at: string | null;
  templates?: { approved: number; pending: number; rejected: number };
}

function newVerifyToken(code: string): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return `ordra-${code}-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

type Form = { waba_id: string; phone_number_id: string; app_id: string; access_token: string; app_secret: string; verify_token: string; graph_version: string };

/**
 * Connect the brand's WhatsApp Business number, or change its credentials.
 * Meta checks them on save. Blank secrets keep the stored ones.
 */
export function WhatsAppConnectDrawer({
  marketId,
  marketCode,
  config,
  onClose,
  onSaved,
}: {
  marketId: string;
  marketCode: MarketCode | null;
  config: WhatsAppConfig | undefined;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations("reglages");
  const toast = useToast();
  const isNew = !config;
  const [form, setForm] = useState<Form>({
    waba_id: config?.waba_id ?? "",
    phone_number_id: config?.phone_number_id ?? "",
    app_id: config?.app_id ?? "",
    access_token: "",
    app_secret: "",
    verify_token: isNew ? newVerifyToken(marketCode ?? "xx") : "",
    graph_version: config?.graph_version ?? "v26.0",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const callback = typeof window !== "undefined" ? `${window.location.origin}/api/webhooks/whatsapp` : "/api/webhooks/whatsapp";

  const save = async () => {
    const required: (keyof Form)[] = isNew ? ["waba_id", "phone_number_id", "app_id", "access_token", "app_secret"] : ["waba_id", "phone_number_id", "app_id"];
    if (required.some((k) => !form[k].trim())) {
      setError(t("whatsapp.drawer.required"));
      return;
    }
    setBusy(true);
    setError(null);
    const payload = isNew ? { market_id: marketId, ...form } : Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== ""));
    const res = await fetch(isNew ? "/api/whatsapp/config" : `/api/whatsapp/config/${marketId}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(t("whatsapp.drawer.failed", { reason: body.message ?? body.error ?? res.status }));
      return;
    }
    toast.show({ message: t("common.saved"), tone: "info" });
    await onSaved();
  };

  const input = (k: keyof Form, label: string, opts: { secret?: boolean; help?: string } = {}) => (
    <Field label={label} htmlFor={`rg-wa-${k}`} help={opts.help}>
      <input id={`rg-wa-${k}`} type={opts.secret ? "password" : "text"} dir="ltr" autoComplete="off" className={`${inputClass} font-mono text-[12.5px]`} value={form[k]} onChange={set(k)} />
    </Field>
  );

  return (
    <Drawer
      open
      onClose={onClose}
      title={t(isNew ? "whatsapp.drawer.connectTitle" : "whatsapp.drawer.editTitle")}
      subtitle={marketCode ? t(`market.${marketCode}`) : undefined}
      footer={
        <>
          {error && (
            <span role="alert" className="text-[12.5px] text-status-critical">
              {error}
            </span>
          )}
          <span className="flex-1" />
          <RgButton onClick={onClose}>{t("common.cancel")}</RgButton>
          <RgButton variant="primary" onClick={() => void save()} disabled={busy}>
            {t("whatsapp.drawer.save")}
          </RgButton>
        </>
      }
    >
      <DrawerSection title={t("whatsapp.drawer.identity")}>
        {input("waba_id", t("whatsapp.drawer.waba"))}
        {input("phone_number_id", t("whatsapp.drawer.pnid"))}
        {input("app_id", t("whatsapp.drawer.appId"))}
        {input("access_token", t("whatsapp.drawer.token"), { secret: true, help: isNew ? undefined : t("whatsapp.drawer.keep") })}
        {input("app_secret", t("whatsapp.drawer.appSecret"), { secret: true, help: isNew ? undefined : t("whatsapp.drawer.keep") })}
        {input("graph_version", t("whatsapp.drawer.graph"))}
      </DrawerSection>
      <DrawerSection title={t("whatsapp.drawer.meta")}>
        <p className="m-0 -mt-[6px] mb-[12px] text-[12.5px] text-ink-secondary">{t("whatsapp.drawer.metaHelp")}</p>
        <Field label={t("whatsapp.drawer.callback")}>
          <CopyBox value={callback} />
        </Field>
        {input("verify_token", t("whatsapp.drawer.verifyToken"), { help: isNew ? undefined : t("whatsapp.drawer.keep") })}
      </DrawerSection>
    </Drawer>
  );
}
