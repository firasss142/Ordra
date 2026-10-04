"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { KeyRound, CheckCircle2, AlertTriangle, Truck } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Drawer, DrawerSection, Field, Mark, SwitchRow, inputClass, StateBadge, ReadOnlyLine, th, td, trPlain } from "../../kit/parts";
import { PhotoPicker } from "@/components/ui/PhotoPicker";
import { getCarrierLogo } from "@/lib/carriers/carrier-logos";
import { NumberField } from "../../kit/NumberField";
import { Switch } from "../../kit/Switch";
import { RgButton } from "../../kit/RgButton";
import { KNOWN_CREDENTIALS, ORDER_OPTIONS, type AdapterDescriptor, type CarrierRow, type Preferences } from "./types";

/**
 * One carrier: identity, connection (administrator only), fees, where the
 * stock leaves from (Darb), and the order options agents start from. No tabs,
 * no « Archiver » — archiving a carrier is switching it off.
 */
export function CarrierDrawer({
  carrier,
  siteName,
  currency,
  editable,
  adapter,
  onClose,
  onSaved,
  onLogoChanged,
}: {
  carrier: CarrierRow;
  siteName: string;
  currency: string;
  editable: boolean;
  adapter: AdapterDescriptor | undefined;
  onClose: () => void;
  onSaved: () => Promise<void>;
  /** Refreshes the list without closing the drawer. */
  onLogoChanged: () => Promise<unknown>;
}) {
  const t = useTranslations("reglages");
  const tp = useTranslations("photo");
  const [logoUrl, setLogoUrl] = useState(carrier.logo_url ?? null);
  const toast = useToast();
  const { data: detail } = useSWR<{ data: { credentials?: Record<string, string> } }>(editable ? `/api/carriers/${carrier.id}` : null);
  const { data: prefsData } = useSWR<{ data: Preferences; fulfilmentModes: { home: boolean; carrier: boolean } }>(`/api/carriers/${carrier.id}/order-preferences`);

  const [name, setName] = useState(carrier.name);
  const [active, setActive] = useState(carrier.is_active);
  const [fee, setFee] = useState<number | null>(carrier.delivery_fee);
  const [ret, setRet] = useState<number | null>(carrier.return_fee);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [replacing, setReplacing] = useState<Record<string, boolean>>({});
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [modes, setModes] = useState<{ home: boolean; carrier: boolean } | null>(null);
  const [test, setTest] = useState<null | "running" | { ok: boolean; reason?: string }>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isDarb = carrier.code === "darb_assabil";

  const setLogo = async (dataUrl: string | null) => {
    const res = await fetch(`/api/carriers/${carrier.id}/logo`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logo: dataUrl }),
    });
    const body = (await res.json().catch(() => ({}))) as { logo_url?: string | null };
    if (!res.ok) throw new Error("logo not saved");
    setLogoUrl(body.logo_url ?? null);
    await onLogoChanged();
  };

  useEffect(() => {
    if (detail?.data?.credentials) setCreds(detail.data.credentials);
  }, [detail]);
  useEffect(() => {
    if (prefsData) {
      setPrefs(prefsData.data);
      setModes(prefsData.fulfilmentModes);
    }
  }, [prefsData]);

  const runTest = async () => {
    setTest("running");
    const res = await fetch(`/api/carriers/${carrier.id}/test`, { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as { reachable?: boolean; status?: number; error?: string };
    setTest(body.reachable ? { ok: true } : { ok: false, reason: body.error ?? (body.status ? `HTTP ${body.status}` : "—") });
  };

  const save = async () => {
    if (modes && !modes.home && !modes.carrier) {
      setError(t("delivery.drawer.modesOne"));
      return;
    }
    const patch: Record<string, unknown> = {};
    if (name.trim() && name.trim() !== carrier.name) patch.name = name.trim();
    if (active !== carrier.is_active) patch.is_active = active;
    if (fee !== null && fee !== carrier.delivery_fee) patch.delivery_fee = fee;
    if (ret !== null && ret !== carrier.return_fee) patch.return_fee = ret;
    const original = detail?.data?.credentials ?? {};
    const changedCreds = Object.fromEntries(
      (adapter?.credentialFields ?? [])
        .filter((f) => (f.secret ? replacing[f.key] && creds[f.key] : (creds[f.key] ?? "") !== (original[f.key] ?? "")))
        .map((f) => [f.key, creds[f.key] ?? ""]),
    );
    if (Object.keys(changedCreds).length) patch.credentials = changedCreds;
    const prefsChanged = prefsData && prefs && modes && (JSON.stringify(prefs) !== JSON.stringify(prefsData.data) || JSON.stringify(modes) !== JSON.stringify(prefsData.fulfilmentModes));

    setSaving(true);
    setError(null);
    try {
      if (Object.keys(patch).length) {
        const res = await fetch(`/api/carriers/${carrier.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error();
      }
      if (prefsChanged) {
        const res = await fetch(`/api/carriers/${carrier.id}/order-preferences`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preferences: prefs, ...(isDarb ? { fulfilmentModes: modes } : {}) }),
        });
        if (!res.ok) throw new Error();
      }
    } catch {
      setSaving(false);
      setError(t("common.error"));
      return;
    }
    setSaving(false);
    toast.show({ message: t("common.saved"), tone: "info" });
    await onSaved();
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={carrier.name}
      subtitle={`${adapter?.label ?? carrier.code} · ${siteName}`}
      footer={
        editable ? (
          <>
            {error && (
              <span role="alert" className="text-[12.5px] text-status-critical">
                {error}
              </span>
            )}
            <span className="flex-1" />
            <RgButton onClick={onClose}>{t("common.cancel")}</RgButton>
            <RgButton variant="primary" onClick={() => void save()} disabled={saving}>
              {t("common.save")}
            </RgButton>
          </>
        ) : (
          <>
            <span className="flex-1" />
            <RgButton onClick={onClose}>{t("common.close")}</RgButton>
          </>
        )
      }
    >
      <DrawerSection title={tp("logoTitle")}>
        <PhotoPicker kind="logo" shape="tile" hasPhoto={!!logoUrl} onChange={setLogo} readOnly={!editable}>
          <Mark size={56} src={getCarrierLogo(carrier.code, logoUrl)}>
            <Truck aria-hidden />
          </Mark>
        </PhotoPicker>
      </DrawerSection>

      <DrawerSection title={t("delivery.drawer.carrier")} end={editable ? undefined : <ReadOnlyLine />}>
        {editable && (
          <Field label={t("delivery.drawer.name")} htmlFor="rg-c-name">
            <input id="rg-c-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        <Field label={t("delivery.drawer.site")} help={editable ? t("delivery.drawer.siteFixed") : undefined}>
          <span className="text-[14px] font-medium">{siteName}</span>
        </Field>
        <SwitchRow
          label={t("delivery.drawer.active")}
          help={t("delivery.drawer.activeHelp")}
          control={editable ? <Switch checked={active} onChange={setActive} label={t("delivery.drawer.active")} /> : <StateBadge on={carrier.is_active} />}
        />
      </DrawerSection>

      <DrawerSection
        title={
          <>
            <KeyRound aria-hidden />
            {t("delivery.drawer.connection")}
          </>
        }
      >
        {!editable ? (
          <p className="m-0 text-[13px] text-ink-secondary">{t("delivery.drawer.credentialsHidden")}</p>
        ) : (
          <>
            {(adapter?.credentialFields ?? []).map((f) => {
              const label = KNOWN_CREDENTIALS.has(f.key) ? t(`delivery.credential.${f.key}`) : f.label;
              const id = `rg-cred-${f.key}`;
              if (f.type === "switch") {
                return (
                  <SwitchRow
                    key={f.key}
                    label={label}
                    control={<Switch checked={(creds[f.key] ?? "1") !== "0"} onChange={(v) => setCreds((c) => ({ ...c, [f.key]: v ? "1" : "0" }))} label={label} />}
                  />
                );
              }
              if (f.secret && !replacing[f.key]) {
                return (
                  <Field key={f.key} label={label} help={t("delivery.drawer.secretKept")}>
                    <div className="flex h-[38px] items-center gap-[6px] rounded-[7px] border border-[#D2D5D9] bg-surface-sunken pe-[4px] ps-[11px]">
                      <span className="flex-1 font-mono text-[12.5px]">••••••••••••••••</span>
                      <RgButton size="sm" onClick={() => setReplacing((r) => ({ ...r, [f.key]: true }))}>
                        {t("delivery.drawer.replace")}
                      </RgButton>
                    </div>
                  </Field>
                );
              }
              return (
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
            <RgButton onClick={() => void runTest()} disabled={test === "running"}>
              {test === "running" ? t("delivery.drawer.testing") : t("delivery.drawer.test")}
            </RgButton>
            {test && test !== "running" && (
              <div className={`mt-[10px] flex items-center gap-[8px] text-[13px] ${test.ok ? "text-status-success" : "text-status-critical"}`}>
                {test.ok ? <CheckCircle2 className="h-[15px] w-[15px]" aria-hidden /> : <AlertTriangle className="h-[15px] w-[15px]" aria-hidden />}
                {test.ok ? t("delivery.drawer.testOk") : t("delivery.drawer.testFail", { reason: test.reason ?? "—" })}
              </div>
            )}
            <p className="m-0 mt-[8px] text-[12.5px] text-ink-secondary">{t("delivery.drawer.testHelp")}</p>
          </>
        )}
      </DrawerSection>

      <DrawerSection title={t("delivery.drawer.fees")}>
        {isDarb ? (
          // Darb bills every delivered parcel; Ordra reads the invoice. A flat
          // fee here would be read nowhere (owner, 2026-10-03).
          <p className="m-0 text-[13px] text-ink-secondary">{t("delivery.drawer.feesDarb")}</p>
        ) : editable ? (
          <>
            <div className="grid grid-cols-2 gap-[12px]">
              <Field label={t("delivery.drawer.feeDelivery")}>
                <NumberField label={t("delivery.drawer.feeDelivery")} value={fee} onChange={setFee} unit={currency} step={0.5} fill />
              </Field>
              <Field label={t("delivery.drawer.feeReturn")}>
                <NumberField label={t("delivery.drawer.feeReturn")} value={ret} onChange={setRet} unit={currency} step={0.5} fill />
              </Field>
            </div>
            <p className="m-0 mt-[8px] text-[12.5px] text-ink-secondary">{t("delivery.drawer.feesHelp")}</p>
          </>
        ) : (
          <dl className="m-0 grid grid-cols-[170px_minmax(0,1fr)] gap-x-[14px] gap-y-[9px] text-[13.5px]">
            <dt className="text-ink-secondary">{t("delivery.drawer.feeDelivery")}</dt>
            <dd className="m-0 font-medium tabular-nums">
              {carrier.delivery_fee} {currency}
            </dd>
            <dt className="text-ink-secondary">{t("delivery.drawer.feeReturn")}</dt>
            <dd className="m-0 font-medium tabular-nums">
              {carrier.return_fee} {currency}
            </dd>
          </dl>
        )}
      </DrawerSection>

      {isDarb && modes && (
        <DrawerSection title={t("delivery.drawer.modes")}>
          <SwitchRow
            label={t("delivery.drawer.modeHome")}
            help={t("delivery.drawer.modeHomeHelp")}
            control={editable ? <Switch checked={modes.home} onChange={(v) => setModes({ ...modes, home: v })} label={t("delivery.drawer.modeHome")} /> : <StateBadge on={modes.home} />}
          />
          <SwitchRow
            label={t("delivery.drawer.modeCarrier")}
            help={t("delivery.drawer.modeCarrierHelp")}
            control={editable ? <Switch checked={modes.carrier} onChange={(v) => setModes({ ...modes, carrier: v })} label={t("delivery.drawer.modeCarrier")} /> : <StateBadge on={modes.carrier} />}
          />
        </DrawerSection>
      )}

      {prefs && (
        <DrawerSection title={t("delivery.drawer.options")}>
          <p className="m-0 -mt-[6px] mb-[10px] text-[12.5px] text-ink-secondary">{t("delivery.drawer.optionsHelp")}</p>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={`${th} px-[10px] py-[8px]`}>{t("delivery.drawer.colOption")}</th>
                <th className={`${th} px-[10px] py-[8px] text-end`}>{t("delivery.drawer.colChecked")}</th>
                <th className={`${th} px-[10px] py-[8px] text-end`}>{t("delivery.drawer.colEditable")}</th>
              </tr>
            </thead>
            <tbody>
              {ORDER_OPTIONS.map((o) => {
                const label = t(`delivery.drawer.opt.${o}.label`);
                return (
                  <tr key={o} className={trPlain}>
                    <td className={`${td} px-[10px] py-[9px] text-[13.5px]`}>
                      <b className="font-medium">{label}</b>
                      <div className="text-[12.5px] text-ink-secondary">{t(`delivery.drawer.opt.${o}.help`)}</div>
                    </td>
                    <td className={`${td} px-[10px] py-[9px] text-end`}>
                      <input
                        type="checkbox"
                        className="h-[18px] w-[18px] accent-[var(--brand)]"
                        checked={prefs[o].value}
                        disabled={!editable}
                        aria-label={t("delivery.drawer.checkedFor", { option: label })}
                        onChange={(e) => setPrefs({ ...prefs, [o]: { ...prefs[o], value: e.target.checked } })}
                      />
                    </td>
                    <td className={`${td} px-[10px] py-[9px] text-end`}>
                      {editable ? (
                        <Switch
                          checked={prefs[o].canOverride}
                          onChange={(v) => setPrefs({ ...prefs, [o]: { ...prefs[o], canOverride: v } })}
                          label={t("delivery.drawer.editableFor", { option: label })}
                        />
                      ) : (
                        <StateBadge on={prefs[o].canOverride} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DrawerSection>
      )}
    </Drawer>
  );
}
