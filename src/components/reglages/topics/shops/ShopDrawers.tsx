"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useGoogleSheetsSync } from "@/hooks/useGoogleSheetsSync";
import { generateSecret } from "@/lib/storefronts/secret-gen";
import { Drawer, DrawerSection, Field, SwitchRow, inputClass, StateBadge, ReadOnlyLine, Mark, RgBadge } from "../../kit/parts";
import { OptionCards } from "../../kit/OptionCards";
import { Switch } from "../../kit/Switch";
import { RgButton } from "../../kit/RgButton";
import { CopyBox, CREATABLE_PLATFORMS, linkOnly, platformOf, receptionUrl, type ShopActivity, type ShopRow } from "./common";
import { PhotoPicker } from "@/components/ui/PhotoPicker";

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
  onLogoChanged,
}: {
  shop: ShopRow;
  activity: ShopActivity | undefined;
  stateBadge: React.ReactNode;
  editable: boolean;
  canSeeLogs: boolean;
  formatDate: (iso: string) => string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  /** Refreshes the list without closing the drawer. */
  onLogoChanged: () => Promise<unknown>;
}) {
  const t = useTranslations("reglages");
  const tp = useTranslations("photo");
  const [logoUrl, setLogoUrl] = useState(shop.logo_url ?? null);
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

  const setLogo = async (dataUrl: string | null) => {
    const res = await fetch(`/api/storefronts/${shop.id}/logo`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logo: dataUrl }),
    });
    const body = (await res.json().catch(() => ({}))) as { logo_url?: string | null };
    if (!res.ok) throw new Error("logo not saved");
    setLogoUrl(body.logo_url ?? null);
    await onLogoChanged();
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
      <DrawerSection title={tp("logoTitle")}>
        <PhotoPicker kind="logo" shape="tile" hasPhoto={!!logoUrl} onChange={setLogo} readOnly={!editable}>
          <PlatformMark platform={shop.platform} logoUrl={logoUrl} size={56} />
        </PhotoPicker>
      </DrawerSection>

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
            {typeof shop.config?.spreadsheet_id === "string" && (
              <>
                <dt className="text-ink-secondary">{t("shops.drawer.sheet")}</dt>
                <dd className="m-0 min-w-0">
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${shop.config.spreadsheet_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-[4px] font-medium text-status-action"
                  >
                    {t("shops.drawer.openSheet")}
                    <ChevronRight className="h-[14px] w-[14px] rtl:-scale-x-100" aria-hidden />
                  </a>
                </dd>
              </>
            )}
            {typeof shop.config?.sheet_name === "string" && (
              <>
                <dt className="text-ink-secondary">{t("shops.drawer.tab")}</dt>
                <dd dir="ltr" className="m-0 font-mono text-[12.5px] font-medium">
                  {shop.config.sheet_name}
                </dd>
              </>
            )}
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
                  <div className="flex h-[40px] items-center gap-[6px] rounded-[11px] border border-[rgba(15,23,40,.12)] bg-surface-sunken pe-[4px] ps-[11px]">
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

      {isSheets && <SheetSyncSection shopId={shop.id} marketId={shop.market_id} formatDate={formatDate} />}

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

type ImportFrom = "now" | "all";

/**
 * Is this sheet's import working? The last good read, the last error, how far
 * the cursor has got, and the rows that could not become orders — per shop,
 * because with several Converty accounts the alert bell alone does not say
 * which sheet stopped. "Lire maintenant" runs the market's import at once.
 */
function SheetSyncSection({ shopId, marketId, formatDate }: { shopId: string; marketId: string; formatDate: (iso: string) => string }) {
  const t = useTranslations("reglages");
  const { status, brokenSources, failures, isSyncing, syncError, triggerSync } = useGoogleSheetsSync(marketId);
  const source = status?.sources.find((s) => s.storefront_id === shopId);
  const mine = failures.filter((f) => f.storefront_id === shopId);
  if (!status) return null;

  const broken = brokenSources.some((s) => s.storefront_id === shopId);
  const lastGood = source?.last_success?.finished_at ?? source?.last_success?.started_at ?? null;
  const lastError = source?.last_run?.status === "failed" ? source.last_run.error : null;

  return (
    <DrawerSection
      title={t("shops.drawer.sync")}
      end={
        <RgButton size="sm" onClick={() => void triggerSync()} disabled={isSyncing}>
          {isSyncing ? t("shops.drawer.readingNow") : t("shops.drawer.readNow")}
        </RgButton>
      }
    >
      <dl className="m-0 grid grid-cols-[170px_minmax(0,1fr)] gap-x-[14px] gap-y-[9px] text-[13.5px]">
        <dt className="text-ink-secondary">{t("shops.drawer.syncState")}</dt>
        <dd className="m-0">
          {!source ? (
            <RgBadge tone="neutral">{t("shops.drawer.syncNever")}</RgBadge>
          ) : broken ? (
            <RgBadge tone="warn">{t("shops.drawer.syncBroken")}</RgBadge>
          ) : (
            <RgBadge tone="ok">{t("shops.drawer.syncOk")}</RgBadge>
          )}
          {lastError && (
            <span dir="ltr" className="mt-[4px] block break-words font-mono text-[12px] text-status-critical">
              {lastError}
            </span>
          )}
        </dd>
        <dt className="text-ink-secondary">{t("shops.drawer.lastRead")}</dt>
        <dd className="m-0 font-medium">{lastGood ? formatDate(lastGood) : "—"}</dd>
        <dt className="text-ink-secondary">{t("shops.drawer.rowsRead")}</dt>
        <dd className="m-0 font-medium tabular-nums">{(source?.last_row ?? 0).toLocaleString("fr-FR")}</dd>
        <dt className="text-ink-secondary">{t("shops.drawer.failedRows")}</dt>
        <dd className="m-0">
          {mine.length === 0 ? (
            <span className="font-medium">{t("shops.drawer.failedNone")}</span>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-[4px] p-0">
              {mine.slice(0, 10).map((f) => (
                <li key={f.id} className="text-[13px]">
                  <b className="font-medium tabular-nums">{t("shops.drawer.rowN", { row: f.row_index })}</b>
                  <span className="text-ink-secondary"> · </span>
                  <span dir="ltr">{f.message}</span>
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
      {syncError && (
        <p role="alert" className="m-0 mt-[10px] text-[12.5px] text-status-critical">
          {t("shops.drawer.readFailed", { error: syncError })}
        </p>
      )}
    </DrawerSection>
  );
}

/** What the API says when a sheet cannot be connected, by `code`. */
interface SheetRefusal {
  code?: string;
  columns?: string[];
  found?: string[];
  service_account?: string | null;
}

/**
 * Add a shop: a name, a platform; then its link and secret, shown once.
 *
 * A Google Sheets shop (a Converty account) has no link or secret: instead it
 * names its sheet and tab, says whether the rows already there are history or
 * orders to call, and is checked by the server before it exists.
 */
export function AddShopDrawer({ marketId, onClose, onCreated }: { marketId: string; onClose: () => void; onCreated: () => Promise<void> }) {
  const t = useTranslations("reglages");
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState<string>("shopify");
  const [sheetLink, setSheetLink] = useState("");
  const [tab, setTab] = useState("");
  const [importFrom, setImportFrom] = useState<ImportFrom>("now");
  const [created, setCreated] = useState<
    | { kind: "webhook"; id: string; secret: string; name: string }
    | { kind: "sheet"; name: string; tab: string; rows: number; importFrom: ImportFrom }
    | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isSheets = platform === "google_sheets";
  const { data: account } = useSWR<{ email: string | null }>(isSheets ? "/api/storefronts/sheets-service-account" : null);
  const serviceEmail = account?.email ?? null;

  const sheetError = (body: SheetRefusal): string => {
    switch (body.code) {
      case "invalid_sheet":
        return t("shops.drawer.sheetError.invalid_sheet");
      case "no_access":
        return t("shops.drawer.sheetError.no_access", { email: body.service_account ?? serviceEmail ?? "—" });
      case "no_tab":
        return t("shops.drawer.sheetError.no_tab", { tab: tab.trim() });
      case "missing_columns":
        return t("shops.drawer.sheetError.missing_columns", {
          columns: (body.columns ?? []).join(", "),
          found: (body.found ?? []).slice(0, 30).join(", ") || "—",
        });
      case "already_connected":
        return t("shops.drawer.sheetError.already_connected");
      default:
        return t("common.error");
    }
  };

  const create = async () => {
    if (!name.trim()) {
      setError(t("shops.drawer.required"));
      return;
    }
    if (isSheets && (!sheetLink.trim() || !tab.trim())) {
      setError(t("shops.drawer.sheetError.invalid_sheet"));
      return;
    }
    setError(null);
    const secret = isSheets ? null : generateSecret();
    setBusy(true);
    const res = await fetch("/api/storefronts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        isSheets
          ? {
              market_id: marketId,
              name: name.trim(),
              platform,
              config: { spreadsheet: sheetLink.trim(), sheet_name: tab.trim(), import_from: importFrom },
            }
          : { market_id: marketId, name: name.trim(), platform, webhook_secret: secret },
      ),
    });
    setBusy(false);
    const body = (await res.json().catch(() => ({}))) as SheetRefusal & { data?: { id?: string }; rows_existing?: number };
    if (!res.ok) {
      setError(isSheets ? sheetError(body) : t("common.error"));
      return;
    }
    setCreated(
      isSheets
        ? { kind: "sheet", name: name.trim(), tab: tab.trim(), rows: body.rows_existing ?? 0, importFrom }
        : { kind: "webhook", id: body.data?.id ?? "", secret: secret ?? "", name: name.trim() },
    );
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
          {created.kind === "sheet" ? (
            <p className="m-0 text-[13px] text-ink-secondary">
              {t(created.importFrom === "now" ? "shops.drawer.createdSheetsNow" : "shops.drawer.createdSheetsAll", {
                tab: created.tab,
                count: created.rows.toLocaleString("fr-FR"),
              })}
            </p>
          ) : (
            <>
              <p className="m-0 mb-[12px] text-[13px] text-ink-secondary">{t("shops.drawer.createdHelp")}</p>
              <Field label={t("shops.drawer.link")}>
                <CopyBox value={receptionUrl(created.id)} />
              </Field>
              <Field label={t("shops.drawer.secret")}>
                <CopyBox value={created.secret} />
              </Field>
            </>
          )}
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
            onChange={(p) => {
              setPlatform(p);
              setError(null);
            }}
            options={CREATABLE_PLATFORMS.map((p) => ({
              value: p,
              label: platformOf(p).label,
              ...(p === "google_sheets" ? { description: t("shops.drawer.sheetsDesc") } : {}),
            }))}
          />
        </Field>
      </DrawerSection>
      {isSheets ? (
        <DrawerSection title={t("shops.drawer.reception")}>
          {serviceEmail ? (
            <Field label={t("shops.drawer.shareWith")}>
              <CopyBox value={serviceEmail} />
            </Field>
          ) : (
            account && <p className="m-0 mb-[14px] text-[13px] text-status-critical">{t("shops.drawer.shareMissing")}</p>
          )}
          <Field label={t("shops.drawer.sheetLink")} htmlFor="rg-add-shop-sheet" help={t("shops.drawer.sheetLinkHelp")}>
            <input
              id="rg-add-shop-sheet"
              dir="ltr"
              className={inputClass}
              value={sheetLink}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              onChange={(e) => setSheetLink(e.target.value)}
            />
          </Field>
          <Field label={t("shops.drawer.tab")} htmlFor="rg-add-shop-tab" help={t("shops.drawer.tabHelp")}>
            <input
              id="rg-add-shop-tab"
              dir="ltr"
              className={inputClass}
              value={tab}
              placeholder={t("shops.drawer.tabPlaceholder")}
              onChange={(e) => setTab(e.target.value)}
            />
          </Field>
          <Field label={t("shops.drawer.importFrom")}>
            <OptionCards
              label={t("shops.drawer.importFrom")}
              columns={2}
              value={importFrom}
              onChange={setImportFrom}
              options={[
                { value: "now", label: t("shops.drawer.importNow"), description: t("shops.drawer.importNowHelp") },
                { value: "all", label: t("shops.drawer.importAll"), description: t("shops.drawer.importAllHelp") },
              ]}
            />
          </Field>
          <p className="m-0 text-[13px] text-ink-secondary">{t("shops.drawer.afterCreateSheets")}</p>
        </DrawerSection>
      ) : (
        <DrawerSection title={t("shops.drawer.afterCreate")}>
          <p className="m-0 text-[13px] text-ink-secondary">{t("shops.drawer.afterCreateHelp")}</p>
        </DrawerSection>
      )}
    </Drawer>
  );
}

export function PlatformMark({ platform, logoUrl, size }: { platform: string; logoUrl?: string | null; size?: number }) {
  const p = platformOf(platform);
  return (
    <Mark src={logoUrl} size={size}>
      {p.mark}
    </Mark>
  );
}
