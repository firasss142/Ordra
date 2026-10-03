"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { Truck } from "lucide-react";
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
 * midnight on its own. Nothing here needs to re-enable anything. Who may press
 * and who may undo is the server's answer (`canDisable` / `canEnable`): an
 * agent may say the driver came, only a manager may take it back
 * (docs/darb-pickup-switch.md). The screen draws only the buttons it is given.
 *
 * Two presentations of the one behaviour, both from the v3 prototypes:
 * - `bench` — the phone's `.pickup`: ONE compact line, dot · sentence · pill;
 * - `console` — the desk's `.pick`: one card per building, side by side.
 */

const KEY = "/api/warehouse/pickup";

export interface PickupSwitchProps {
  /** "bench" = the agent's phone; "console" = the manager's desk. */
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
      // One press changes every upload from this building for the rest of the
      // day, so it is never a single stray tap. The press also says who can
      // take it back, since the line no longer has room to.
      const message = disabled
        ? `${t("confirmOff", { site: site.name })}\n${t("managerOnly")}`
        : t("confirmOn", { site: site.name });
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

  // Latin digits and a 24-hour clock in both languages, as the prototype
  // writes it (« 11:20 »), whatever the browser's Arabic defaults are.
  const clock = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });

  const bench = variant === "bench";

  const status = (site: PickupSiteState) =>
    site.disabled
      ? site.disabledAt
        ? t("doneAt", { time: clock(site.disabledAt) })
        : t("offLabel")
      : bench
        ? t("pending")
        : t("pendingShort");

  const action = (site: PickupSiteState) => {
    const pending = busy === site.warehouseId;
    if (site.canDisable) {
      return (
        <button
          type="button"
          disabled={pending}
          onClick={() => toggle(site, true)}
          data-testid={`wh-pickup-off-${site.code}`}
          className={[
            "inline-flex shrink-0 items-center whitespace-nowrap border border-[#C9CCCF] bg-wm-card text-[12.5px] font-semibold text-wm-ink",
            bench ? "gap-[5px] rounded-pill px-[12px] py-[7px]" : "h-[30px] gap-[8px] rounded-[8px] px-[10px] hover:bg-surface-hover",
            pending ? "opacity-60" : "",
          ].join(" ")}
        >
          <Truck size={15} strokeWidth={2} aria-hidden="true" />
          <span dir="auto">{t("press")}</span>
        </button>
      );
    }
    if (site.canEnable) {
      return (
        <button
          type="button"
          disabled={pending}
          onClick={() => toggle(site, false)}
          data-testid={`wh-pickup-on-${site.code}`}
          className={[
            "inline-flex shrink-0 items-center whitespace-nowrap text-[12.5px] font-semibold text-ink-secondary",
            bench ? "rounded-pill px-[12px] py-[7px]" : "h-[30px] rounded-[8px] px-[10px] hover:bg-surface-hover",
            pending ? "opacity-60" : "",
          ].join(" ")}
        >
          <span dir="auto">{t("undo")}</span>
        </button>
      );
    }
    return null;
  };

  // The dot says the state; the sentence says it in words, because a colour
  // alone would not say which way the switch is.
  const dot = (site: PickupSiteState) => (
    <i
      aria-hidden="true"
      className={`h-[8px] w-[8px] shrink-0 rounded-full ${site.disabled ? "bg-status-success" : "bg-status-warning"}`}
    />
  );

  const errorLine = error ? (
    <p role="alert" className="mt-[6px] text-[12.5px] text-status-critical" dir="auto">
      {error}
    </p>
  ) : null;

  if (bench) {
    return (
      <div className={className} data-testid="wh-pickup-switch">
        <div className="space-y-[8px]">
          {sites.map((site) => (
            <div
              key={site.warehouseId}
              data-testid={`wh-pickup-site-${site.code}`}
              data-state={site.disabled ? "done" : "pending"}
              // 12px on the dot's side, 14px on the button's — the prototype's
              // padding, read in Arabic, where Darb works.
              className="flex items-center gap-[10px] rounded-[12px] border border-line-subtle bg-wm-card py-[10px] pe-[14px] ps-[12px]"
            >
              {dot(site)}
              <span className="min-w-0 flex-1 text-[12.5px] text-wm-ink" dir="auto">
                {/* An agent sees one building; a manager on a phone may see two. */}
                {sites.length > 1 ? <b className="font-bold">{site.name} · </b> : null}
                {status(site)}
              </span>
              {action(site)}
            </div>
          ))}
        </div>
        {errorLine}
      </div>
    );
  }

  return (
    <div className={className} data-testid="wh-pickup-switch">
      <div className="flex flex-wrap gap-[10px]">
        {sites.map((site) => (
          <div
            key={site.warehouseId}
            data-testid={`wh-pickup-site-${site.code}`}
            data-state={site.disabled ? "done" : "pending"}
            className="flex min-w-[260px] flex-1 items-center gap-[10px] rounded-[14px] border border-line-subtle bg-white px-[14px] py-[10px]"
          >
            {dot(site)}
            <b className="font-bold text-ink-primary" dir="auto">{site.name}</b>
            <span className="min-w-0 flex-1 text-[12.5px] text-ink-secondary" dir="auto">{status(site)}</span>
            {action(site)}
          </div>
        ))}
      </div>
      {errorLine}
    </div>
  );
}
