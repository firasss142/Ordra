"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { jsonFetcher } from "@/lib/fetchers";
import type { XDeliveryPickupSite, XDeliveryPickupParcel } from "@/lib/carriers/xdelivery/pickup-view";

/**
 * « X-DELIVERY Enlèvement » — the « Demande d'enlèvement » button, per building.
 *
 * MINIMAL ON PURPOSE (2026-10-08): the backend moved from an automatic request with
 * an ON/OFF switch to an on-demand batch (plans/xdelivery-manifests.md). This card
 * only keeps the bench working — count, one button that sends every waiting parcel,
 * the parcel list. The real screens (untick parcels, sent lists, delete a list) are
 * built by the UI session on the contract in docs/xdelivery-manifests.md.
 *
 * Renders nothing where no building ships X-Delivery — Libya, and Tunisia until the
 * account is configured.
 */

const KEY = "/api/warehouse/xdelivery-pickup";
const LIST_MAX = 4;

// X-Delivery is Tunisian; its times are Tunis times whoever reads them.
const clock = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Tunis" }).format(new Date(iso));

/** 611791217700001 → « 6117 9121 7700 001 », the way it reads off the label. */
const grouped = (code: string) => code.replace(/(\d{4})(?=\d)/g, "$1 ");

export function XDeliveryPickupCard({
  className,
  withParcels = true,
}: {
  className?: string;
  /** The parcel list belongs on the bench; « Aujourd'hui » keeps its own tiles first. */
  withParcels?: boolean;
}) {
  const { data, mutate } = useSWR<{ sites: XDeliveryPickupSite[] }>(KEY, jsonFetcher, {
    revalidateOnFocus: true,
    refreshInterval: 60_000,
  });
  const sites = data?.sites ?? [];
  if (sites.length === 0) return null;

  return (
    <div className={className}>
      {sites.map((s) => (
        <SiteCard key={s.warehouseId} site={s} withParcels={withParcels} onSent={() => mutate()} />
      ))}
    </div>
  );
}

function SiteCard({
  site,
  withParcels,
  onSent,
}: {
  site: XDeliveryPickupSite;
  withParcels: boolean;
  onSent: () => unknown;
}) {
  const t = useTranslations("warehouse.xdeliveryPickup");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waiting = site.awaiting.length;
  const lastList = site.lists[0] ?? null;

  const request = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(KEY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouse_id: site.warehouseId, order_ids: site.awaiting.map((p) => p.orderId) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error_code?: string };
        setError(body.error_code === "PORTAL_LOGIN_REFUSED" ? t("failureLogin") : t("failed"));
        return;
      }
      await onSent();
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  }, [site.warehouseId, site.awaiting, onSent, t]);

  const shown = withParcels ? site.awaiting.slice(0, LIST_MAX) : [];
  const hidden = waiting - shown.length;

  return (
    <>
      <section
        data-testid={`xd-pickup-${site.code}`}
        className="rounded-[14px] border border-wm-card-edge bg-wm-card px-3.5 py-3"
      >
        <h2 className="flex items-center gap-2 text-[13px] font-bold text-wm-ink-2">
          {/* Carrier identity, as on the carrier's own label — not a status colour. */}
          <span className="inline-flex h-4 items-center rounded-[5px] bg-[#E8EEF7] px-1.5 text-[11px] font-extrabold tracking-[0.02em] text-[#0D2C54]">
            {t("brand")}
          </span>
          {t("title")}
        </h2>

        <p className="mt-2 text-[14px] font-semibold text-wm-ink">{site.name}</p>
        <p data-testid="xd-pickup-waiting" className="text-[12.5px] text-wm-ink-2">
          {t("waiting", { n: waiting })}
        </p>
        {lastList?.createdAt ? (
          <p data-testid="xd-pickup-last" className="text-[12.5px] text-wm-ink-2">
            {t("sentList", { time: clock(lastList.createdAt), n: lastList.open })}
          </p>
        ) : null}

        {site.hasPortalLogin ? (
          <button
            type="button"
            data-testid="xd-pickup-request"
            disabled={busy || waiting === 0 || !site.canManage}
            onClick={request}
            className="mt-2.5 h-10 w-full rounded-[10px] bg-wm-accent text-[14px] font-semibold text-white disabled:opacity-50"
          >
            {t("request", { n: waiting })}
          </button>
        ) : (
          <p role="alert" className="mt-2.5 rounded-[10px] bg-status-warningBg px-2.5 py-2 text-[12.5px] text-status-warning">
            {t("noLogin")}
          </p>
        )}

        {error ? (
          <p role="alert" className="mt-2 text-[12.5px] text-status-critical">
            {error}
          </p>
        ) : null}
      </section>

      {shown.length > 0 ? (
        <>
          <p className="mb-2 mt-4 text-[13px] font-semibold text-wm-ink-2">{t("listTitle")}</p>
          <ul>
            {shown.map((p) => (
              <ParcelRow key={p.orderId} parcel={p} />
            ))}
          </ul>
          {hidden > 0 ? <p className="text-[12.5px] text-wm-ink-2">{t("more", { n: hidden })}</p> : null}
        </>
      ) : null}
    </>
  );
}

function ParcelRow({ parcel }: { parcel: XDeliveryPickupParcel }) {
  const t = useTranslations("warehouse.xdeliveryPickup");
  const what = [parcel.city, parcel.product ? `${parcel.product}${(parcel.quantity ?? 1) > 1 ? ` ×${parcel.quantity}` : ""}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <li
      data-testid="xd-pickup-parcel"
      className="mb-1.5 flex items-center justify-between gap-3 rounded-[12px] border border-wm-card-edge bg-wm-card px-3 py-2.5 text-[14px]"
    >
      <div className="min-w-0">
        <p className="truncate text-wm-ink">{t("parcel", { tracking: grouped(parcel.tracking ?? "—") })}</p>
        <p className="truncate text-[12.5px] text-wm-ink-2" dir="auto">
          {what}
        </p>
      </div>
      <span className="shrink-0 rounded-pill bg-wm-track px-2 py-0.5 text-[11.5px] font-bold text-wm-ink-2">{t("toRequest")}</span>
    </li>
  );
}
