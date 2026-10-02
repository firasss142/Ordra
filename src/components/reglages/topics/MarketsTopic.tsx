"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { ChevronRight, Info } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import type { TopicProps } from "../TopicBody";
import {
  SettingsCard,
  StateBadge,
  Drawer,
  DrawerSection,
  Field,
  SwitchRow,
  inputClass,
  th,
  td,
  trClick,
} from "../kit/parts";
import { OptionCards } from "../kit/OptionCards";
import { Switch } from "../kit/Switch";
import { RgButton } from "../kit/RgButton";
import { TopicSkeleton } from "../kit/TopicSkeleton";

interface MarketRow {
  id: string;
  code: "tn" | "ly";
  name: string;
  language: "fr" | "ar";
  currency: string;
  is_active: boolean;
  sender_name: string | null;
  sender_address: string | null;
  sender_phone: string | null;
}

/**
 * Réglages › Marchés (super_admin) — prototype v2: one quiet list, a row opens
 * the market. A settings screen sets things; it does not monitor them, so no
 * order counts and no « À vérifier » here (owner, 2026-10-02).
 */
export function MarketsTopic(_props: TopicProps) {
  const t = useTranslations("reglages");
  const { data, mutate } = useSWR<{ data: MarketRow[] }>("/api/markets?detail=1");
  const [open, setOpen] = useState<MarketRow | null>(null);
  if (!data) return <TopicSkeleton cards={1} rows={2} />;

  return (
    <>
      <SettingsCard
        footer={
          <>
            <Info aria-hidden />
            <span>{t("markets.addNote")}</span>
          </>
        }
      >
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={`${th} rounded-tl-[10px] rtl:rounded-tl-none rtl:rounded-tr-[10px]`}>{t("markets.colMarket")}</th>
              <th className={th}>{t("markets.colLanguage")}</th>
              <th className={th}>{t("markets.colCurrency")}</th>
              <th className={th}>{t("markets.colState")}</th>
              <th className={`${th} w-[1%] rounded-tr-[10px] rtl:rounded-tr-none rtl:rounded-tl-[10px]`} />
            </tr>
          </thead>
          <tbody>
            {data.data.map((m) => (
              <tr key={m.id} className={`${trClick} group`} onClick={() => setOpen(m)}>
                <td className={`${td} py-[16px]`}>
                  <div className="flex items-center gap-[10px]">
                    <span className="grid h-[36px] w-[36px] flex-none place-items-center rounded-[9px] bg-[#F1F2F3] text-[12px] font-bold tracking-[.04em] text-ink-primary">
                      {m.code.toUpperCase()}
                    </span>
                    <b className="text-[15px] font-semibold">{t(`market.${m.code}`)}</b>
                  </div>
                </td>
                <td className={`${td} py-[16px]`}>{t(`language.${m.language}`)}</td>
                <td className={`${td} py-[16px] tabular-nums`}>{m.currency}</td>
                <td className={`${td} py-[16px]`}>
                  <StateBadge on={m.is_active} />
                </td>
                <td className={`${td} w-[1%] py-[16px] text-end`}>
                  <button
                    type="button"
                    aria-label={t("markets.open", { market: t(`market.${m.code}`) })}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(m);
                    }}
                    className="grid h-[28px] w-[28px] place-items-center rounded-[6px] text-[#8C9196] group-hover:text-ink-primary"
                  >
                    <ChevronRight className="h-[16px] w-[16px] rtl:-scale-x-100" aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SettingsCard>
      {open && (
        <MarketDrawer
          market={open}
          onClose={() => setOpen(null)}
          onSaved={async () => {
            await mutate();
            setOpen(null);
          }}
        />
      )}
    </>
  );
}

function MarketDrawer({ market, onClose, onSaved }: { market: MarketRow; onClose: () => void; onSaved: () => Promise<void> }) {
  const t = useTranslations("reglages");
  const toast = useToast();
  const [name, setName] = useState(market.name);
  const [language, setLanguage] = useState(market.language);
  const [active, setActive] = useState(market.is_active);
  const [senderName, setSenderName] = useState(market.sender_name ?? "");
  const [senderAddress, setSenderAddress] = useState(market.sender_address ?? "");
  const [senderPhone, setSenderPhone] = useState(market.sender_phone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      setError(t("markets.nameRequired"));
      return;
    }
    const patch: Record<string, unknown> = {};
    if (name.trim() !== market.name) patch.name = name.trim();
    if (language !== market.language) patch.language = language;
    if (active !== market.is_active) patch.is_active = active;
    const sender = (v: string) => (v.trim() === "" ? null : v.trim());
    if (sender(senderName) !== market.sender_name) patch.sender_name = sender(senderName);
    if (sender(senderAddress) !== market.sender_address) patch.sender_address = sender(senderAddress);
    if (sender(senderPhone) !== market.sender_phone) patch.sender_phone = sender(senderPhone);
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/markets/${market.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setSaving(false);
    if (!res.ok) {
      setError(t("common.error"));
      return;
    }
    toast.show({ message: t("common.saved"), tone: "info" });
    await onSaved();
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={t(`market.${market.code}`)}
      subtitle={t("markets.drawerSub")}
      footer={
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
      }
    >
      <DrawerSection title={t("markets.identity")}>
        <Field label={t("markets.name")} htmlFor="rg-market-name">
          <input id="rg-market-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("markets.teamLanguage")} help={t("markets.teamLanguageHelp")}>
          <OptionCards
            label={t("markets.teamLanguage")}
            columns={2}
            value={language}
            onChange={setLanguage}
            options={[
              { value: "fr", label: "Français", description: t("markets.ltr") },
              { value: "ar", label: "العربية", description: t("markets.rtl") },
            ]}
          />
        </Field>
        <Field label={t("markets.currency")} htmlFor="rg-market-currency" help={t("markets.currencyHelp")}>
          <input id="rg-market-currency" className={inputClass} value={market.currency} readOnly />
        </Field>
        <SwitchRow
          label={t("markets.activeLabel")}
          help={t("markets.activeHelp")}
          control={<Switch checked={active} onChange={setActive} label={t("markets.activeLabel")} />}
        />
      </DrawerSection>
      <DrawerSection title={t("markets.sender")}>
        <p className="m-0 -mt-[6px] mb-[12px] text-[12.5px] text-ink-secondary">{t("markets.senderHelp")}</p>
        <Field label={t("markets.senderName")} htmlFor="rg-sender-name">
          <input id="rg-sender-name" className={inputClass} value={senderName} onChange={(e) => setSenderName(e.target.value)} />
        </Field>
        <Field label={t("markets.senderAddress")} htmlFor="rg-sender-address">
          <input
            id="rg-sender-address"
            className={inputClass}
            value={senderAddress}
            placeholder={t("markets.senderAddressPlaceholder")}
            onChange={(e) => setSenderAddress(e.target.value)}
          />
        </Field>
        <Field label={t("markets.senderPhone")} htmlFor="rg-sender-phone">
          <input
            id="rg-sender-phone"
            className={inputClass}
            dir="ltr"
            value={senderPhone}
            placeholder={market.code === "ly" ? "+218 …" : "+216 …"}
            onChange={(e) => setSenderPhone(e.target.value)}
          />
        </Field>
      </DrawerSection>
    </Drawer>
  );
}
