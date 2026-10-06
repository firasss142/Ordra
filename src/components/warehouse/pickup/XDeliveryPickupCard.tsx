"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { jsonFetcher } from "@/lib/fetchers";
import type { XDeliveryPickupSite, XDeliveryPickupParcel } from "@/lib/carriers/xdelivery/pickup-view";

/**
 * « X-DELIVERY Enlèvement » — the bench card of prototypes/xdelivery-v1.html (screens 1–2).
 *
 * X-Delivery never collects on its own: every poll tick asks for the parcels the
 * warehouse has scanned out, while this switch is ON (the default). OFF means « the
 * driver already came » or « we ask on their portal »; it comes back ON at midnight.
 * Unlike Darb's switch, the agent may turn it back ON (owner decision 6), so a press
 * is a plain toggle, not a confirmed one-way act.
 *
 * Renders nothing where no site ships X-Delivery — Libya, and Tunisia until the
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
    // The tick runs every 10 minutes; a minute is enough to show its result.
    refreshInterval: 60_000,
  });
  const sites = data?.sites ?? [];
  if (sites.length === 0) return null;

  return (
    <div className={className}>
      {sites.map((s) => (
        <SiteCard
          key={s.warehouseId}
          site={s}
          withParcels={withParcels}
          onChanged={(next) => mutate(next, { revalidate: false })}
        />
      ))}
    </div>
  );
}

function SiteCard({
  site,
  withParcels,
  onChanged,
}: {
  site: XDeliveryPickupSite;
  withParcels: boolean;
  onChanged: (next: { sites: XDeliveryPickupSite[] }) => unknown;
}) {
  const t = useTranslations("warehouse.xdeliveryPickup");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const on = !site.disabled;

  const toggle = useCallback(async () => {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(KEY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouse_id: site.warehouseId, disabled: on }),
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      await onChanged(await res.json());
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }, [site.warehouseId, on, onChanged]);

  const shown = withParcels ? site.parcels.slice(0, LIST_MAX) : [];
  const hidden = site.parcels.length - shown.length;

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

        <div className="mt-2.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-wm-ink">{site.name}</p>
            <p className={`text-[13px] font-semibold ${on ? "text-wm-accent" : "text-status-warning"}`}>
              {on ? t("onWord") : site.disabledAt ? t("offWord", { time: clock(site.disabledAt) }) : t("offWordNoTime")}
            </p>
            <p className="text-[12.5px] text-wm-ink-2">{on ? t("onHint") : t("offHint")}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={t("switchLabel")}
            disabled={busy || !site.canToggle}
            onClick={toggle}
            className={`relative h-[30px] w-[52px] shrink-0 rounded-pill transition-colors disabled:opacity-60 ${
              on ? "bg-wm-accent" : "bg-wm-track"
            }`}
          >
            <span
              aria-hidden="true"
              className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-[inset-inline-start] ${
                on ? "start-[25px]" : "start-[3px]"
              }`}
            />
          </button>
        </div>

        {on ? (
          <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-wm-card-edge pt-2.5">
            <p data-testid="xd-pickup-waiting" className="text-[12px] text-wm-ink-2">
              <b className="block text-[15px] tabular-nums text-wm-ink">{site.waiting}</b>
              {t("nextRun", { n: site.waiting })}
            </p>
            <p data-testid="xd-pickup-last" className="text-[12px] text-wm-ink-2">
              <b className="block text-[15px] tabular-nums text-wm-ink">
                {site.lastRequest ? clock(site.lastRequest.at) : "—"}
              </b>
              {site.lastRequest ? t("lastRequest", { n: site.lastRequest.count }) : t("noRequestToday")}
            </p>
          </div>
        ) : site.waiting > 0 ? (
          <p role="status" className="mt-2.5 rounded-[10px] bg-status-warningBg px-2.5 py-2 text-[12.5px] text-status-warning">
            {t("offWaiting", { n: site.waiting })}
          </p>
        ) : null}

        {site.failure ? (
          <p role="alert" className="mt-2.5 rounded-[10px] bg-status-criticalBg px-2.5 py-2 text-[12.5px] text-status-critical">
            {site.failure.kind === "login" ? t("failureLogin") : t("failureOther")}
          </p>
        ) : null}

        {error ? <p className="mt-2 text-[12.5px] text-status-critical">{t("failed")}</p> : null}
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
      <span
        className={`shrink-0 rounded-pill px-2 py-0.5 text-[11.5px] font-bold ${
          parcel.requested ? "bg-wm-accent-soft text-wm-accent-deep" : "bg-wm-track text-wm-ink-2"
        }`}
      >
        {parcel.requested
          ? parcel.requestedAt
            ? t("requestedAt", { time: clock(parcel.requestedAt) })
            : t("requested")
          : t("toRequest")}
      </span>
    </li>
  );
}
