"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Camera,
  Clock,
  MapPin,
  MessageSquareQuote,
  Package,
  Phone as PhoneIcon,
  RotateCw,
  Wallet,
} from "lucide-react";
import { useDarbShipment } from "@/hooks/useDarbShipment";
import { formatLongDate, formatTime } from "@/lib/format";
import { findDarbStatus } from "@/lib/carriers/darb-assabil-statuses";
import {
  currentHolder,
  displayTimeline,
  eventHue,
  findCancellationCause,
  initialOf,
  shippingCostLegs,
  statusHue,
  type DarbHue,
} from "@/lib/carriers/darb-shipment-display";

interface DarbStatusSectionProps {
  orderId: string;
  enabled: boolean;
}

/**
 * Darb Assabil carrier detail for the order panel (Libya, RTL).
 *
 * Reads the local mirror instead of calling the carrier on open. That swap is
 * what makes this panel possible: the old version fetched a list of Arabic event
 * labels and showed only those, discarding the courier, the phone, the notes and
 * the cost on every render.
 *
 * DESIGN. Colour is load-bearing, never decoration. The console reserves
 * `--oms-info` (teal) for carrier-side state so phase 2 can never be mistaken
 * for phase 1's violet, and pairs amber/red/green with warn/bad/ok. The whole
 * panel takes its accent from the shipment's own status, so a delayed parcel
 * reads amber and a returned one reads red before a word is read. Every token
 * here is an existing console token — no new palette.
 *
 * Order of information follows what an agent needs before dialling:
 *   1. who is holding the parcel, and a one-tap call
 *   2. what that person last wrote about it
 *   3. why it is stalled — delay date, cancellation reason, attempts
 *   4. the money — billed cost, COD outstanding, settlement
 *   5. history, collapsed
 *
 * Read-only. Nothing here mutates OMS state.
 */

const PREVIEW_EVENTS = 4;

/**
 * Static class maps — Tailwind's scanner cannot see interpolated class names,
 * so every variant is spelled out. Opacity modifiers are avoided deliberately:
 * these tokens are `var()` colours without an `<alpha-value>` channel, so a
 * `/20` suffix would silently produce no colour at all.
 */
const HUE: Record<DarbHue, { chip: string; tint: string; rule: string; dot: string; avatar: string }> = {
  neutral: {
    chip: "bg-oms-sunken text-oms-ink-2",
    tint: "bg-oms-sunken",
    rule: "border-oms-border-strong",
    dot: "bg-oms-ink-3",
    avatar: "bg-oms-border-strong text-oms-ink-1",
  },
  info: {
    chip: "bg-oms-info-bg text-oms-info-ink",
    tint: "bg-oms-info-bg",
    rule: "border-oms-info",
    dot: "bg-oms-info",
    avatar: "bg-oms-info text-white",
  },
  warn: {
    chip: "bg-oms-warn-bg text-oms-warn-ink",
    tint: "bg-oms-warn-bg",
    rule: "border-oms-warn",
    dot: "bg-oms-warn",
    avatar: "bg-oms-warn text-white",
  },
  ok: {
    chip: "bg-oms-ok-bg text-oms-ok",
    tint: "bg-oms-ok-bg",
    rule: "border-oms-ok",
    dot: "bg-oms-ok",
    avatar: "bg-oms-ok text-white",
  },
  bad: {
    chip: "bg-oms-bad-bg text-oms-bad",
    tint: "bg-oms-bad-bg",
    rule: "border-oms-bad",
    dot: "bg-oms-bad",
    avatar: "bg-oms-bad text-white",
  },
};

/** Section eyebrow — the panel's one repeating typographic device. */
function Eyebrow({ icon: Icon, children }: { icon?: typeof Clock; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-oms-ink-3">
      {Icon && <Icon size={11} strokeWidth={2.2} aria-hidden="true" />}
      {children}
    </div>
  );
}

/** Bidi isolation keeps Latin phone numbers readable inside RTL Arabic text. */
function CallButton({ phone, label }: { phone: string; label: string }) {
  return (
    <a
      href={`tel:${phone}`}
      aria-label={`${label} ${phone}`}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-oms-border-strong bg-oms-surface px-2.5 py-1 text-[12px] font-medium tabular-nums text-oms-ink-1 transition-colors hover:border-oms-ink-3 hover:bg-oms-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-oms-info"
    >
      <PhoneIcon size={12} strokeWidth={2.2} aria-hidden="true" />
      <bdi>{phone}</bdi>
    </a>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-[0.07em] text-oms-ink-3">{label}</dt>
      <dd className="mt-0.5 text-[13px] leading-snug text-oms-ink-1">{children}</dd>
    </div>
  );
}

export function DarbStatusSection({ orderId, enabled }: DarbStatusSectionProps) {
  const t = useTranslations("darbStatus");
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false);
  const { shipment, timeline, comments, hasLoaded, isLoading, error, refresh } =
    useDarbShipment(orderId, enabled);

  if (!enabled) return null;

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <section className="border-b border-line-subtle bg-oms-surface px-5 py-4">{children}</section>
  );
  const Header = (
    <Eyebrow icon={Package}>{t("sectionTitle")}</Eyebrow>
  );

  if (isLoading || (!hasLoaded && !error)) {
    return (
      <Shell>
        {Header}
        <div
          role="status"
          aria-busy="true"
          aria-label={t("loading")}
          className="mt-3 space-y-2"
        >
          <div className="h-11 w-full animate-pulse rounded-lg bg-oms-sunken" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-oms-sunken" />
        </div>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        {Header}
        <div
          role="alert"
          className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-oms-bad-bg px-3 py-2.5 text-[13px] text-oms-bad"
        >
          <span>{t("loadError")}</span>
          <button
            type="button"
            onClick={() => refresh()}
            className="shrink-0 rounded-md border border-oms-bad px-2 py-1 text-[12px] font-medium transition-colors hover:bg-oms-surface"
          >
            {t("retry")}
          </button>
        </div>
      </Shell>
    );
  }

  // No mirror row is meaningful, not an error: the carrier has no record of this
  // shipment. Say what that means instead of showing an empty timeline.
  if (!shipment) {
    return (
      <Shell>
        {Header}
        <div className={`mt-3 rounded-lg border-s-2 ${HUE.warn.rule} ${HUE.warn.tint} px-3 py-2.5`}>
          <p className="text-[13px] font-medium text-oms-ink-1">{t("noShipment")}</p>
          <p className="mt-1 text-[12px] leading-snug text-oms-ink-2">{t("noShipmentHelp")}</p>
        </div>
      </Shell>
    );
  }

  const hue = HUE[statusHue(shipment.status_slug)];
  const status = findDarbStatus(shipment.status_slug);
  const holder = currentHolder(shipment);
  const cause = findCancellationCause(shipment.cancellation_cause);
  const legs = shippingCostLegs(shipment.shipping_breakdown);
  const events = displayTimeline(timeline);
  const shown = expanded ? events : events.slice(0, PREVIEW_EVENTS);
  const currency = shipment.billed_currency?.toUpperCase() ?? "";
  const initial = initialOf(holder?.name);
  const legLabel = (key: string) =>
    key === "branchToBranch"
      ? t("legBranchToBranch")
      : key === "pickFromDoor"
        ? t("legPickFromDoor")
        : key === "dropToDoor"
          ? t("legDropToDoor")
          : key;

  const destination = [shipment.to_city, shipment.to_area, shipment.to_address]
    .filter(Boolean)
    .join(" — ");
  const hasFacts =
    shipment.delayed_until ||
    cause ||
    shipment.cancel_count ||
    shipment.resend_count ||
    shipment.completed_at ||
    destination ||
    shipment.service_title ||
    shipment.notes;

  return (
    <section className="border-b border-line-subtle bg-oms-surface px-5 py-4">
      {/* ── Header: status is the headline ─────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        {Header}
        <button
          type="button"
          onClick={() => refresh()}
          aria-label={t("refresh")}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-oms-ink-3 transition-colors hover:bg-oms-sunken hover:text-oms-ink-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-oms-info"
        >
          <RotateCw size={11} strokeWidth={2.2} aria-hidden="true" />
          {t("refresh")}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        {status && (
          <span
            dir="rtl"
            lang="ar"
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-semibold ${hue.chip}`}
          >
            {status.labelAr}
          </span>
        )}
        {shipment.reference && (
          <span className="font-mono text-[12px] tabular-nums text-oms-ink-3">
            <bdi>{shipment.reference}</bdi>
          </span>
        )}
      </div>

      {/* ── 1. Who is holding it ───────────────────────────────────── */}
      {holder && (
        <div className={`mt-3 flex items-center gap-3 rounded-xl ${hue.tint} p-3`}>
          <span
            aria-hidden="true"
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold ${hue.avatar}`}
          >
            {initial ?? "?"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-[0.07em] text-oms-ink-3">
              {holder.isOfficeFallback ? t("office") : t("courier")}
            </div>
            {/* <bdi> gives correct bidi ordering without flipping the block's
                alignment — the label above and the name must share an edge. */}
            <div className="truncate text-[15px] font-semibold leading-tight text-oms-ink-1">
              <bdi>{holder.name}</bdi>
            </div>
            {holder.isOfficeFallback ? (
              <div className="truncate text-[12px] text-oms-ink-2">{t("officeFallback")}</div>
            ) : (
              holder.office && (
                <div className="truncate text-[12px] text-oms-ink-2">
                  <bdi>{holder.office}</bdi>
                </div>
              )
            )}
          </div>
          {holder.phone && <CallButton phone={holder.phone} label={t("call")} />}
        </div>
      )}

      {/* ── 2. What that person last wrote ─────────────────────────── */}
      {shipment.latest_remark && (
        <figure className={`mt-2 rounded-lg border-s-2 ${hue.rule} bg-oms-sunken px-3 py-2`}>
          <Eyebrow icon={MessageSquareQuote}>{t("courierNote")}</Eyebrow>
          <blockquote dir="auto" className="mt-1 text-[13px] leading-relaxed text-oms-ink-1">
            {shipment.latest_remark}
          </blockquote>
        </figure>
      )}

      {/* ── 3. Why it is stalled + shipment facts ──────────────────── */}
      {hasFacts && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
          {shipment.delayed_until && (
            <Fact label={t("delayedUntil")}>
              <span className="tabular-nums">
                {formatLongDate(shipment.delayed_until, locale)}
              </span>
            </Fact>
          )}
          {cause && (
            <Fact label={t("cancelReason")}>
              <bdi>{cause.labelAr}</bdi>
            </Fact>
          )}
          {!!shipment.cancel_count && (
            <Fact label={t("attempts")}>
              <span className="tabular-nums">{shipment.cancel_count}</span>
            </Fact>
          )}
          {!!shipment.resend_count && (
            <Fact label={t("resends")}>
              <span className="tabular-nums">{shipment.resend_count}</span>
            </Fact>
          )}
          {shipment.completed_at && (
            <Fact label={t("deliveredAt")}>
              <span className="tabular-nums">
                {formatLongDate(shipment.completed_at, locale)}
              </span>
            </Fact>
          )}
          {destination && (
            <Fact label={t("destination")}>
              <span className="flex items-start gap-1">
                <MapPin
                  size={12}
                  strokeWidth={2}
                  className="mt-0.5 shrink-0 text-oms-ink-3"
                  aria-hidden="true"
                />
                <bdi>{destination}</bdi>
              </span>
            </Fact>
          )}
          {shipment.service_title && (
            <Fact label={t("service")}>
              <bdi>{shipment.service_title}</bdi>
            </Fact>
          )}
          {shipment.notes && (
            <Fact label={t("shipmentNotes")}>
              <bdi>{shipment.notes}</bdi>
            </Fact>
          )}
        </dl>
      )}

      {/* ── 4. Money ───────────────────────────────────────────────── */}
      {(shipment.billed_shipping_amount !== null || shipment.cod_outstanding !== null) && (
        <div className="mt-3 rounded-xl bg-oms-sunken p-3">
          <Eyebrow icon={Wallet}>{t("billedCost")}</Eyebrow>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {shipment.billed_shipping_amount !== null && (
              <span className="text-[18px] font-semibold tabular-nums leading-none text-oms-ink-1">
                {shipment.billed_shipping_amount}{" "}
                <span className="text-[12px] font-medium text-oms-ink-3">{currency}</span>
              </span>
            )}
            {shipment.cod_outstanding !== null && (
              <span className="text-[12px] text-oms-ink-2">
                {t("codOutstanding")}:{" "}
                <span className="font-semibold tabular-nums text-oms-ink-1">
                  {shipment.cod_outstanding} {currency}
                </span>
              </span>
            )}
          </div>
          {legs.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {legs.map((l) => (
                <li
                  key={l.key}
                  className="rounded-full bg-oms-surface px-2 py-0.5 text-[11px] tabular-nums text-oms-ink-2"
                >
                  {legLabel(l.key)} {l.amount}
                </li>
              ))}
            </ul>
          )}
          {shipment.delivery_withdrawal_at && (
            <div className="mt-2 text-[11px] text-oms-ink-3">
              {t("codSettled")}:{" "}
              <span className="tabular-nums">
                {formatLongDate(shipment.delivery_withdrawal_at, locale)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Carrier comment thread — present on ~8% of shipments ────── */}
      {comments.length > 0 && (
        <div className="mt-3">
          <Eyebrow icon={MessageSquareQuote}>{t("carrierComments")}</Eyebrow>
          <ul className="mt-1.5 space-y-1.5">
            {comments.map((c) => (
              <li
                key={c.message_id}
                className="rounded-lg border-s-2 border-oms-border-strong bg-oms-sunken px-3 py-1.5"
              >
                <p dir="auto" className="text-[13px] leading-snug text-oms-ink-1">
                  {c.message}
                </p>
                {c.posted_at && (
                  <span className="mt-0.5 block text-[11px] tabular-nums text-oms-ink-3">
                    {formatLongDate(c.posted_at, locale)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Proof photos the courier attached ──────────────────────── */}
      {shipment.attachments.length > 0 && (
        <div className="mt-3">
          <Eyebrow icon={Camera}>{t("proofPhotos", { n: shipment.attachments.length })}</Eyebrow>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {shipment.attachments.map((a, i) => (
              <a
                key={a.url}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-oms-border-strong bg-oms-surface px-2.5 py-1 text-[12px] text-oms-ink-1 transition-colors hover:bg-oms-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-oms-info"
              >
                <Camera size={11} strokeWidth={2} aria-hidden="true" />
                {i + 1}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* ── 5. History ─────────────────────────────────────────────── */}
      {events.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-2">
            <Eyebrow icon={Clock}>{t("history")}</Eyebrow>
            {events.length > PREVIEW_EVENTS && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-oms-ink-2 transition-colors hover:bg-oms-sunken hover:text-oms-ink-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-oms-info"
              >
                {expanded ? t("showLess") : t("showAll", { n: events.length })}
              </button>
            )}
          </div>

          <ol className="relative mt-2 space-y-3 border-s border-oms-border ps-4">
            {shown.map((ev) => {
              const dot = HUE[eventHue(ev.type)].dot;
              return (
                <li key={ev.event_id} className="relative">
                  <span
                    aria-hidden="true"
                    className={`absolute -start-[21px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-oms-surface ${dot}`}
                  />
                  {/* dir="auto" and not "rtl": Darb falls back to English on
                      some events, and an LTR sentence in an RTL block moves its
                      full stop to the front. */}
                  <p dir="auto" className="text-[13px] leading-snug text-oms-ink-1">
                    {ev.description_ar || ev.description_en || t("eventFallback")}
                  </p>
                  {ev.remarks && (
                    <p
                      dir="auto"
                      className="mt-1 rounded border-s-2 border-oms-border-strong bg-oms-sunken px-2 py-1 text-[12px] leading-snug text-oms-ink-1"
                    >
                      {ev.remarks}
                    </p>
                  )}
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-oms-ink-3">
                    {ev.occurred_at && (
                      <span className="tabular-nums">
                        {formatLongDate(ev.occurred_at, locale)},{" "}
                        {formatTime(ev.occurred_at, locale)}
                      </span>
                    )}
                    {ev.actor_name && (
                      <span className="truncate">
                        {t("by")} <bdi>{ev.actor_name}</bdi>
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <p className="mt-3 text-[11px] text-oms-ink-3">
        {t("syncedAt")}:{" "}
        <span className="tabular-nums">
          {formatLongDate(shipment.last_synced_at, locale)},{" "}
          {formatTime(shipment.last_synced_at, locale)}
        </span>
      </p>
    </section>
  );
}
