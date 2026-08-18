"use client";

import { useTranslations } from "next-intl";
import { useDarbControlRoom } from "@/hooks/useDarbControlRoom";
import { findDarbStatus } from "@/lib/carriers/darb-assabil-statuses";
import { Button } from "@/components/ui/Button";

/**
 * Darb Assabil operations panel.
 *
 * Exists because Darb orders were invisible to every existing tracking surface:
 * /in-delivery and /warehouse/carrier-tracking both filter on the phase-2
 * statuses (dispatched / deposit / in_transit / to_be_returned), and Libya
 * orders go straight from `uploaded` to a terminal state — so an order out for
 * delivery, delayed, or being returned appeared nowhere at all.
 *
 * This panel reads the carrier's OWN status taxonomy from the local mirror, and
 * surfaces the three things that were previously unanswerable:
 *   - which courier is holding a parcel, and their phone number
 *   - what that courier wrote about why it hasn't been delivered
 *   - which orders the carrier has lost entirely
 *
 * Read-only. Nothing here mutates an order; the lost list is explicitly a
 * human-decision queue.
 */

const RTL_ISOLATE = "⁦"; // keeps Latin phone numbers readable inside RTL text
const RTL_POP = "⁩";

function Phone({ value }: { value: string | null }) {
  if (!value) return <span className="text-ink-secondary">—</span>;
  return (
    <a href={`tel:${value}`} className="font-medium text-ink underline-offset-2 hover:underline">
      {RTL_ISOLATE}
      {value}
      {RTL_POP}
    </a>
  );
}

function StatusPill({ slug }: { slug: string | null }) {
  const entry = findDarbStatus(slug);
  const label = entry?.labelAr ?? slug ?? "—";
  const terminal = slug === "completed" || slug === "returned" || slug === "cancelled";
  const warn = slug === "delayed" || slug === "returning";
  return (
    <span
      className={[
        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium",
        terminal
          ? "bg-surface-hover text-ink-secondary"
          : warn
            ? "bg-amber-50 text-amber-800"
            : "bg-blue-50 text-blue-800",
      ].join(" ")}
    >
      {label}
    </span>
  );
}

export function DarbControlRoom({ enabled = true }: { enabled?: boolean }) {
  const t = useTranslations("darbControlRoom");
  const { data, error, isLoading, refresh } = useDarbControlRoom(enabled);

  if (!enabled) return null;

  if (error) {
    return (
      <section className="rounded border border-line-subtle bg-surface-card p-5">
        <p className="text-sm text-ink">{t("loadError")}</p>
        <Button onClick={() => refresh()} className="mt-3">
          {t("retry")}
        </Button>
      </section>
    );
  }

  if (isLoading || !data) {
    return (
      <section className="rounded border border-line-subtle bg-surface-card p-5">
        <div role="status" aria-busy="true" aria-label={t("loading")} className="space-y-2">
          <div className="h-5 w-56 animate-pulse rounded bg-surface-hover" />
          <div className="h-24 w-full animate-pulse rounded bg-surface-hover" />
        </div>
      </section>
    );
  }

  const inFlightStatuses = data.statuses.filter(
    (s) => !["completed", "returned", "cancelled"].includes(s.slug),
  );

  return (
    <section className="space-y-4">
      {/* Header + schedule honesty */}
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink">{t("title")}</h2>
          <p className="text-xs text-ink-secondary">{t("subtitle")}</p>
        </div>
        <p className="text-xs text-ink-secondary">
          {data.cron?.active
            ? t("scheduleLive", { schedule: data.cron.schedule })
            : t("scheduleMissing")}
        </p>
      </header>

      {/* Per-account funnel */}
      <div className="grid gap-3 md:grid-cols-2">
        {data.accounts.map((a) => (
          <div key={a.carrier_id} className="rounded border border-line-subtle bg-surface-card p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">{a.carrier_name}</h3>
              <span className="text-xs text-ink-secondary">
                {t("lastSync")}:{" "}
                {a.minutes_since_sync === null
                  ? t("never")
                  : t("minutesAgo", { n: a.minutes_since_sync })}
              </span>
            </div>
            <div className="mt-2 flex gap-6">
              <div>
                <div className="text-xl font-semibold text-ink">{a.in_flight}</div>
                <div className="text-[11px] uppercase tracking-wide text-ink-secondary">
                  {t("inFlight")}
                </div>
              </div>
              <div>
                <div className="text-xl font-semibold text-ink">{a.total}</div>
                <div className="text-[11px] uppercase tracking-wide text-ink-secondary">
                  {t("totalShipments")}
                </div>
              </div>
            </div>
            <ul className="mt-3 space-y-1">
              {inFlightStatuses.map((s) => {
                const n = a.by_status[s.slug] ?? 0;
                if (n === 0) return null;
                return (
                  <li key={s.slug} className="flex items-center justify-between text-xs">
                    <StatusPill slug={s.slug} />
                    <span className="font-medium text-ink">{n}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* Real delivery cost */}
      <div className="rounded border border-line-subtle bg-surface-card p-4">
        <h3 className="text-sm font-semibold text-ink">{t("costTitle")}</h3>
        <p className="mt-0.5 text-xs text-ink-secondary">{t("costHelp")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {data.cost.map((c) => (
            <div key={c.carrier_id} className="text-xs">
              <div className="font-medium text-ink">{c.carrier_name}</div>
              <div className="text-ink-secondary">
                {t("avgBilled")}:{" "}
                <span className="font-semibold text-ink">
                  {c.avg_billed === null ? "—" : c.avg_billed}
                </span>{" "}
                · {t("range")}: {c.min_billed ?? "—"}–{c.max_billed ?? "—"} ·{" "}
                {c.shipments_priced} {t("pricedShipments")}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stuck shipments — with the courier and their note */}
      <div className="rounded border border-line-subtle bg-surface-card">
        <div className="border-b border-line-subtle px-4 py-3">
          <h3 className="text-sm font-semibold text-ink">
            {t("stuckTitle", { days: data.stuck_days_threshold })}{" "}
            <span className="text-ink-secondary">({data.stuck.length})</span>
          </h3>
        </div>
        {data.stuck.length === 0 ? (
          <p className="px-4 py-4 text-xs text-ink-secondary">{t("stuckEmpty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-ink-secondary">
                <tr className="border-b border-line-subtle">
                  <th className="px-4 py-2 text-start font-medium">{t("reference")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("status")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("customer")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("courier")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("courierNote")}</th>
                </tr>
              </thead>
              <tbody>
                {data.stuck.map((s) => (
                  <tr key={s.darb_id} className="border-b border-line-subtle last:border-0">
                    <td className="px-4 py-2 align-top">
                      <div className="font-medium text-ink">{s.reference ?? "—"}</div>
                      <div className="text-ink-secondary">{s.carrier_name}</div>
                    </td>
                    <td className="px-4 py-2 align-top">
                      <StatusPill slug={s.status_slug} />
                      <div className="mt-1 text-ink-secondary">
                        {t("daysOnStatus", { n: s.days_on_status })}
                      </div>
                    </td>
                    <td className="px-4 py-2 align-top">
                      <div className="text-ink">{s.customer_name ?? "—"}</div>
                      <Phone value={s.customer_phone} />
                      <div className="text-ink-secondary">{s.to_city ?? ""}</div>
                    </td>
                    <td className="px-4 py-2 align-top">
                      <div className="text-ink">{s.handler_name ?? "—"}</div>
                      <Phone value={s.handler_phone} />
                      {s.handler_account_name && (
                        <div className="text-ink-secondary">{s.handler_account_name}</div>
                      )}
                    </td>
                    <td className="px-4 py-2 align-top">
                      {s.latest_remark && <div className="text-ink">{s.latest_remark}</div>}
                      {s.latest_comment && (
                        <div className="text-ink-secondary">{s.latest_comment}</div>
                      )}
                      {!s.latest_remark && !s.latest_comment && (
                        <span className="text-ink-secondary">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Lost at carrier — human decision queue */}
      <div className="rounded border border-line-subtle bg-surface-card">
        <div className="border-b border-line-subtle px-4 py-3">
          <h3 className="text-sm font-semibold text-ink">
            {t("lostTitle")} <span className="text-ink-secondary">({data.lost_total})</span>
          </h3>
          <p className="mt-0.5 text-xs text-ink-secondary">{t("lostHelp")}</p>
        </div>
        {data.lost.length === 0 ? (
          <p className="px-4 py-4 text-xs text-ink-secondary">{t("lostEmpty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-ink-secondary">
                <tr className="border-b border-line-subtle">
                  <th className="px-4 py-2 text-start font-medium">{t("reference")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("customer")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("product")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("value")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("daysStranded", { n: "" })}</th>
                </tr>
              </thead>
              <tbody>
                {data.lost.map((o) => (
                  <tr key={o.order_id} className="border-b border-line-subtle last:border-0">
                    <td className="px-4 py-2 align-top">
                      <div className="font-medium text-ink">{o.tracking_number ?? "—"}</div>
                      <div className="text-ink-secondary">{o.carrier_name}</div>
                    </td>
                    <td className="px-4 py-2 align-top">
                      <div className="text-ink">{o.customer_name ?? "—"}</div>
                      <Phone value={o.customer_phone} />
                      <div className="text-ink-secondary">{o.customer_city ?? ""}</div>
                    </td>
                    <td className="px-4 py-2 align-top text-ink">{o.product_name ?? "—"}</td>
                    <td className="px-4 py-2 text-end align-top text-ink">
                      {o.total_price ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-end align-top text-ink">{o.days_stranded}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.lost_total > data.lost.length && (
              <p className="px-4 py-2 text-[11px] text-ink-secondary">
                {t("showingFirst", { n: data.lost.length, total: data.lost_total })}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
