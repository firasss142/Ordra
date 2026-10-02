"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { generateSecret } from "@/lib/storefronts/secret-gen";
import { Drawer, DrawerSection, Field, SwitchRow, inputClass, StateBadge, ReadOnlyLine, Mark } from "../../kit/parts";
import { OptionCards } from "../../kit/OptionCards";
import { Switch } from "../../kit/Switch";
import { RgButton } from "../../kit/RgButton";
import { CopyBox, CREATABLE_PLATFORMS, linkOnly, platformOf, receptionUrl, type ShopActivity, type ShopRow } from "./common";

/** One shop: name and state, how its orders reach Ordra, its activity. */
export function ShopDrawer({
  shop,
  activity,
  stateBadge,
  editable,
  canSeeLogs,
  formatDate,
  onClose,
  onSaved,
}: {
  shop: ShopRow;
  activity: ShopActivity | undefined;
  stateBadge: React.ReactNode;
  editable: boolean;
  canSeeLogs: boolean;
  formatDate: (iso: string) => string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations("reglages");
  const locale = useLocale();
  const toast = useToast();
  const [name, setName] = useState(shop.name);
  const [active, setActive] = useState(shop.is_active);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const platform = platformOf(shop.platform);
  const isSheets = shop.platform === "google_sheets";

  const regenerate = async () => {
    const secret = generateSecret();
    setBusy(true);
    const res = await fetch(`/api/storefronts/${shop.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ webhook_secret: secret }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(t("common.error"));
      return;
    }
    setNewSecret(secret);
  };

  const save = async () => {
    const patch: Record<string, unknown> = {};
    if (name.trim() && name.trim() !== shop.name) patch.name = name.trim();
    if (active !== shop.is_active) patch.is_active = active;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/storefronts/${shop.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setBusy(false);
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
      title={shop.name}
      subtitle={
        <>
          {platform.label} · {stateBadge}
        </>
      }
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
            <RgButton variant="primary" onClick={() => void save()} disabled={busy}>
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
      <DrawerSection title={t("shops.drawer.shop")} end={editable ? undefined : <ReadOnlyLine />}>
        {editable ? (
          <Field label={t("shops.drawer.name")} htmlFor="rg-shop-name">
            <input id="rg-shop-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        ) : null}
        <SwitchRow
          label={t("shops.drawer.active")}
          help={t("shops.drawer.activeHelp")}
          control={editable ? <Switch checked={active} onChange={setActive} label={t("shops.drawer.active")} /> : <StateBadge on={shop.is_active} />}
        />
      </DrawerSection>

      <DrawerSection title={t("shops.drawer.reception")}>
        {isSheets ? (
          <dl className="m-0 grid grid-cols-[170px_minmax(0,1fr)] gap-x-[14px] gap-y-[9px] text-[13.5px]">
            <dt className="text-ink-secondary">{t("shops.drawer.source")}</dt>
            <dd className="m-0 font-medium">Google Sheets</dd>
            <dt className="text-ink-secondary">{t("shops.drawer.reading")}</dt>
            <dd className="m-0 font-medium">{t("shops.drawer.every15")}</dd>
          </dl>
        ) : (
          <>
            <Field label={t("shops.drawer.link")} help={linkOnly(shop) ? t("shops.drawer.linkOnlyHelp") : t("shops.drawer.linkHelp", { platform: platform.label })}>
              <CopyBox value={receptionUrl(shop.id)} />
            </Field>
            {!linkOnly(shop) && (
              <Field label={t("shops.drawer.secret")} help={newSecret ? t("shops.drawer.newSecret") : t("shops.drawer.secretHelp")}>
                {newSecret ? (
                  <CopyBox value={newSecret} />
                ) : (
                  <div className="flex h-[38px] items-center gap-[6px] rounded-[7px] border border-[#D2D5D9] bg-surface-sunken pe-[4px] ps-[11px]">
                    <span className="flex-1 font-mono text-[12.5px]">••••••••••••••••••••</span>
                    {editable && (
                      <RgButton size="sm" onClick={() => void regenerate()} disabled={busy}>
                        {t("shops.drawer.regenerate")}
                      </RgButton>
                    )}
                  </div>
                )}
              </Field>
            )}
          </>
        )}
      </DrawerSection>

      <DrawerSection title={t("shops.drawer.activity")}>
        <dl className="m-0 grid grid-cols-[170px_minmax(0,1fr)] gap-x-[14px] gap-y-[9px] text-[13.5px]">
          <dt className="text-ink-secondary">{t("shops.colOrders")}</dt>
          <dd className="m-0 font-medium tabular-nums">{(activity?.orders_30d ?? 0).toLocaleString("fr-FR")}</dd>
          <dt className="text-ink-secondary">{t("shops.colLast")}</dt>
          <dd className="m-0 font-medium">{activity?.last_order_at ? formatDate(activity.last_order_at) : "—"}</dd>
        </dl>
        {canSeeLogs && !isSheets && (
          <Link href={`/${locale}/system/logs`} className="mt-[12px] inline-flex items-center gap-[4px] text-[13px] font-medium text-status-action">
            {t("shops.drawer.seeLogs")}
            <ChevronRight className="h-[14px] w-[14px] rtl:-scale-x-100" aria-hidden />
          </Link>
        )}
      </DrawerSection>
    </Drawer>
  );
}

/** Add a shop: a name, a platform; then its link and secret, shown once. */
export function AddShopDrawer({ marketId, onClose, onCreated }: { marketId: string; onClose: () => void; onCreated: () => Promise<void> }) {
  const t = useTranslations("reglages");
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState<string>("shopify");
  const [created, setCreated] = useState<{ id: string; secret: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) {
      setError(t("shops.drawer.required"));
      return;
    }
    const secret = generateSecret();
    setBusy(true);
    const res = await fetch("/api/storefronts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ market_id: marketId, name: name.trim(), platform, webhook_secret: secret }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(t("common.error"));
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { data?: { id?: string } };
    setCreated({ id: body.data?.id ?? "", secret, name: name.trim() });
    await onCreated();
  };

  if (created) {
    return (
      <Drawer
        open
        onClose={onClose}
        title={t("shops.drawer.createdTitle", { name: created.name })}
        subtitle={platformOf(platform).label}
        footer={
          <>
            <span className="flex-1" />
            <RgButton variant="primary" onClick={onClose}>
              {t("common.close")}
            </RgButton>
          </>
        }
      >
        <DrawerSection>
          <p className="m-0 mb-[12px] text-[13px] text-ink-secondary">{t("shops.drawer.createdHelp")}</p>
          <Field label={t("shops.drawer.link")}>
            <CopyBox value={receptionUrl(created.id)} />
          </Field>
          <Field label={t("shops.drawer.secret")}>
            <CopyBox value={created.secret} />
          </Field>
        </DrawerSection>
      </Drawer>
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("shops.drawer.addTitle")}
      subtitle={t("shops.drawer.addSub")}
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
            {t("shops.drawer.create")}
          </RgButton>
        </>
      }
    >
      <DrawerSection>
        <Field label={t("shops.drawer.name")} htmlFor="rg-add-shop-name" help={t("shops.drawer.nameHelp")}>
          <input id="rg-add-shop-name" className={inputClass} value={name} placeholder={t("shops.drawer.namePlaceholder")} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("shops.drawer.platform")} help={t("shops.drawer.platformHelp")}>
          <OptionCards
            label={t("shops.drawer.platform")}
            columns={2}
            value={platform}
            onChange={setPlatform}
            options={CREATABLE_PLATFORMS.map((p) => ({ value: p, label: platformOf(p).label }))}
          />
        </Field>
      </DrawerSection>
      <DrawerSection title={t("shops.drawer.afterCreate")}>
        <p className="m-0 text-[13px] text-ink-secondary">{t("shops.drawer.afterCreateHelp")}</p>
      </DrawerSection>
    </Drawer>
  );
}

export function PlatformMark({ platform }: { platform: string }) {
  const p = platformOf(platform);
  return <Mark>{p.mark}</Mark>;
}
