"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { KeyRound } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Drawer, DrawerSection, Field, SwitchRow, inputClass } from "../../kit/parts";
import { OptionCards } from "../../kit/OptionCards";
import { NumberField } from "../../kit/NumberField";
import { Switch } from "../../kit/Switch";
import { RgButton } from "../../kit/RgButton";
import { KNOWN_CREDENTIALS, type AdapterDescriptor, type SiteRow } from "./types";

/**
 * « Ajouter un transporteur » — works again (it used to loop back to the same
 * page). One of the market's carrier integrations, a display name, the site it
 * ships from, its credentials and fees. Created, then tested.
 */
export function AddCarrierDrawer({
  marketId,
  marketLabel,
  currency,
  adapters,
  sites,
  onClose,
  onCreated,
}: {
  marketId: string;
  marketLabel: string;
  currency: string;
  adapters: AdapterDescriptor[];
  sites: SiteRow[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const t = useTranslations("reglages");
  const locale = useLocale();
  const toast = useToast();
  const [code, setCode] = useState(adapters[0]?.code ?? "");
  const [name, setName] = useState("");
  const activeSites = sites.filter((s) => s.isActive);
  const [siteId, setSiteId] = useState(activeSites.find((s) => s.isDefault)?.id ?? activeSites[0]?.id ?? "");
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [fee, setFee] = useState<number | null>(0);
  const [ret, setRet] = useState<number | null>(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const adapter = adapters.find((a) => a.code === code);

  const create = async () => {
    const fields = adapter?.credentialFields ?? [];
    const credentials = Object.fromEntries(
      fields
        .map((f) => [f.key, f.type === "switch" ? creds[f.key] ?? "1" : (creds[f.key] ?? "").trim()] as const)
        .filter(([, v]) => v !== ""),
    );
    const missingSecret = fields.some((f) => f.secret && !credentials[f.key]);
    if (!adapter || !name.trim() || missingSecret) {
      setError(t("delivery.drawer.required"));
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/carriers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        market_id: marketId,
        name: name.trim(),
        code: adapter.code,
        api_endpoint: adapter.defaultEndpoint ?? "",
        credentials,
        delivery_fee: fee ?? 0,
        return_fee: ret ?? 0,
        ...(siteId ? { warehouse_id: siteId } : {}),
      }),
    });
    if (!res.ok) {
      setBusy(false);
      setError(res.status === 409 ? t("delivery.drawer.duplicate") : t("common.error"));
      return;
    }
    const created = (await res.json().catch(() => ({}))) as { data?: { id?: string } };
    let reachable = true;
    if (created.data?.id) {
      const test = await fetch(`/api/carriers/${created.data.id}/test`, { method: "POST" });
      const body = (await test.json().catch(() => ({}))) as { reachable?: boolean };
      reachable = !!body.reachable;
    }
    setBusy(false);
    toast.show({
      message: t(reachable ? "delivery.drawer.created" : "delivery.drawer.createdTestFail", { name: name.trim() }),
      tone: reachable ? "info" : "warning",
    });
    await onCreated();
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("delivery.drawer.addTitle")}
      subtitle={t("delivery.drawer.addSub", { market: marketLabel })}
      footer={
        <>
          {error && (
            <span role="alert" className="text-[12.5px] text-status-critical">
              {error}
            </span>
          )}
          <span className="flex-1" />
          <RgButton onClick={onClose}>{t("common.cancel")}</RgButton>
          <RgButton variant="primary" onClick={() => void create()} disabled={busy}>
            {t("delivery.drawer.create")}
          </RgButton>
        </>
      }
    >
      <DrawerSection>
        <Field label={t("delivery.drawer.company")} help={t("delivery.drawer.companyHelp")}>
          <OptionCards
            label={t("delivery.drawer.company")}
            columns={2}
            value={code}
            onChange={(v) => {
              setCode(v);
              setCreds({});
            }}
            options={adapters.map((a) => ({ value: a.code, label: a.label, description: t(`delivery.adapters.${a.code}`) }))}
          />
        </Field>
        <Field label={t("delivery.drawer.name")} htmlFor="rg-add-name" help={t("delivery.drawer.nameHelp")}>
          <input id="rg-add-name" className={inputClass} value={name} placeholder={t("delivery.drawer.namePlaceholder")} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("delivery.drawer.site")} htmlFor="rg-add-site">
          <select id="rg-add-site" className={inputClass} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            {activeSites.map((s) => (
              <option key={s.id} value={s.id}>
                {locale === "ar" ? s.nameAr : s.nameFr}
              </option>
            ))}
          </select>
        </Field>
      </DrawerSection>

      <DrawerSection
        title={
          <>
            <KeyRound aria-hidden />
            {t("delivery.drawer.connection")}
          </>
        }
      >
        {(adapter?.credentialFields ?? []).map((f) => {
          const label = KNOWN_CREDENTIALS.has(f.key) ? t(`delivery.credential.${f.key}`) : f.label;
          const id = `rg-add-cred-${f.key}`;
          return f.type === "switch" ? (
            <SwitchRow
              key={f.key}
              label={label}
              control={<Switch checked={(creds[f.key] ?? "1") !== "0"} onChange={(v) => setCreds((c) => ({ ...c, [f.key]: v ? "1" : "0" }))} label={label} />}
            />
          ) : (
            <Field key={f.key} label={label} htmlFor={id}>
              <input
                id={id}
                type={f.secret ? "password" : "text"}
                dir="ltr"
                className={`${inputClass} font-mono text-[12.5px]`}
                value={creds[f.key] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => setCreds((c) => ({ ...c, [f.key]: e.target.value }))}
              />
            </Field>
          );
        })}
      </DrawerSection>

      <DrawerSection title={t("delivery.drawer.fees")}>
        <div className="grid grid-cols-2 gap-[12px]">
          <Field label={t("delivery.drawer.feeDelivery")}>
            <NumberField label={t("delivery.drawer.feeDelivery")} value={fee} onChange={setFee} unit={currency} step={0.5} fill />
          </Field>
          <Field label={t("delivery.drawer.feeReturn")}>
            <NumberField label={t("delivery.drawer.feeReturn")} value={ret} onChange={setRet} unit={currency} step={0.5} fill />
          </Field>
        </div>
      </DrawerSection>
    </Drawer>
  );
}
