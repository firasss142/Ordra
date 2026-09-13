"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { Truck, TruckIcon } from "lucide-react";
import { jsonFetcher } from "@/lib/fetchers";
import type { PickupSiteState } from "@/app/api/warehouse/pickup/route";

/**
 * "Le chauffeur est passé" — the per-site pickup switch.
 *
 * Darb books a collection on every upload (`isPickup: true`), which is right
 * until the driver has physically been: an order uploaded after he left sends
 * him back for parcels that did not exist while he was here. This is where the
 * warehouse says "already collected today", per building.
 *
 * The switch is not a stored boolean. The server records WHEN it was pressed
 * and compares that to the market's local day, so it returns to its default at
 * midnight on its own. Nothing here needs to re-enable anything.
 *
 * Two shells wear this: the agent bench (`wm-*` tokens, under .wh-mobile) and
 * the manager console (the Orders console tokens). Hence `variant` — the markup
 * and the behaviour are one, only the palette differs.
 */

const KEY = "/api/warehouse/pickup";

export interface PickupSwitchProps {
  /** "bench" = the agent's mobile shell; "console" = the manager's desk. */
  variant?: "bench" | "console";
  className?: string;
}

interface PickupResponse {
  sites: PickupSiteState[];
}

export function PickupSwitch({ variant = "bench", className }: PickupSwitchProps) {
  const t = useTranslations("warehouse.pickupSwitch");
  const locale = useLocale();
  const { data, mutate, isLoading } = useSWR<PickupResponse>(KEY, jsonFetcher, {
    revalidateOnFocus: true,
    // The driver's arrival is a real-world event this screen cannot observe;
    // a minute's staleness would let two agents disagree about it.
    refreshInterval: 60_000,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(
    async (site: PickupSiteState, disabled: boolean) => {
      const message = disabled
        ? t("confirmOff", { site: site.name })
        : t("confirmOn", { site: site.name });
      // One press changes every upload from this building for the rest of the
      // day, so it is never a single stray tap.
      if (!window.confirm(message)) return;

      setBusy(site.warehouseId);
      setError(null);
      try {
        const res = await fetch(KEY, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ warehouse_id: site.warehouseId, disabled }),
        });
        if (!res.ok) {
          setError(t("failed"));
          return;
        }
        const json = (await res.json()) as PickupResponse;
        await mutate(json, { revalidate: false });
      } catch {
        setError(t("failed"));
      } finally {
        setBusy(null);
      }
    },
    [mutate, t],
  );

  const sites = data?.sites ?? [];
  if (isLoading || sites.length === 0) return null;

  const bench = variant === "bench";
  const card = bench
    ? "rounded-[14px] border border-wm-card-edge bg-wm-card"
    : "rounded-card border border-border-subtle bg-surface";
  const ink = bench ? "text-wm-ink" : "text-ink-primary";
  const ink2 = bench ? "text-wm-ink-2" : "text-ink-secondary";

  return (
    <section className={[card, "px-3.5 py-3", className ?? ""].join(" ")} data-testid="wh-pickup-switch">
      <h2 className={["flex items-center gap-1.5 text-[13px] font-bold", ink2].join(" ")} dir="auto">
        <Truck size={14} strokeWidth={2} aria-hidden="true" />
        {t("title")}
      </h2>

      <ul className="mt-2 space-y-2">
        {sites.map((site) => {
          const pending = busy === site.warehouseId;
          return (
            <li
              key={site.warehouseId}
              data-testid={`wh-pickup-site-${site.code}`}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2"
            >
              <div className="min-w-0">
                {/* The building, then its state in words. A colour alone would
                    not say which way the switch is. */}
                <p className={["text-[14px] font-semibold leading-snug", ink].join(" ")} dir="auto">
                  {site.name}
                </p>
                <p
                  className={[
                    "text-[12.5px] leading-snug",
                    site.disabled ? "text-status-warning" : ink2,
                  ].join(" ")}
                  dir="auto"
                >
                  {site.disabled ? t("offLabel") : t("onLabel")}
                </p>
                <p className={["text-[12px] leading-snug", ink2].join(" ")} dir="auto">
                  {site.disabled
                    ? site.disabledAt
                      ? `${t("disabledSince", {
                          time: new Date(site.disabledAt).toLocaleTimeString(locale, {
                            hour: "2-digit",
                            minute: "2-digit",
                          }),
                        })} · ${t("offHint")}`
                      : t("offHint")
                    : t("onHint")}
                </p>
                {/* An agent who cannot undo their own press is told why, rather
                    than left looking for a button that is not there. */}
                {site.disabled && !site.canEnable ? (
                  <p className={["mt-0.5 text-[12px] leading-snug", ink2].join(" ")} dir="auto">
                    {t("managerOnly")}
                  </p>
                ) : null}
              </div>

              {site.canDisable ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => toggle(site, true)}
                  data-testid={`wh-pickup-off-${site.code}`}
                  className={[
                    "inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-semibold",
                    bench
                      ? "bg-wm-accent text-white active:bg-wm-accent-deep"
                      : "bg-ink-primary text-white hover:bg-black",
                    pending ? "opacity-60" : "",
                  ].join(" ")}
                >
                  <TruckIcon size={15} strokeWidth={2} aria-hidden="true" />
                  <span dir="auto">{t("turnOff")}</span>
                </button>
              ) : site.canEnable ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => toggle(site, false)}
                  data-testid={`wh-pickup-on-${site.code}`}
                  className={[
                    "inline-flex min-h-[38px] shrink-0 items-center rounded-[10px] border px-3 text-[13px] font-semibold",
                    bench
                      ? "border-wm-card-edge text-wm-ink"
                      : "border-border-subtle text-ink-primary hover:bg-surface-sunken",
                    pending ? "opacity-60" : "",
                  ].join(" ")}
                >
                  <span dir="auto">{t("turnOn")}</span>
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      {error ? (
        <p className="mt-2 text-[12.5px] text-status-error" dir="auto">
          {error}
        </p>
      ) : null}
    </section>
  );
}
