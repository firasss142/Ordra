"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { ArrowLeft, Search } from "lucide-react";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import type { OrderZone } from "@/lib/warehouse/zone-index";
import { DARB_ZONES } from "@/lib/carriers/darb-zones";
import { ScanStation } from "./ScanStation";
import { WH_LABEL } from "./tokens";

/**
 * Scan mode — one parcel, full screen.
 *
 * The queue is reduced to a picker: the operator finds the parcel in their
 * hands, takes it, scans, and the next search box is already focused. Anything
 * that is not "which parcel" or "which sticker" is off this screen.
 *
 * Échap goes back to Préparation, because a tablet at a packing table has no
 * comfortable browser chrome.
 */

type Row = WarehouseOrderRow & { zone: OrderZone };

const fetcher = (u: string) => fetch(u).then((r) => {
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
});

export function ScanModeClient({
  locale,
  initialOrders,
}: {
  locale: string;
  initialOrders: Row[];
}) {
  const t = useTranslations("warehouse.scan");
  const tp = useTranslations("warehouse.prep2");
  const router = useRouter();

  const { data, mutate } = useSWR<{ orders: Row[] }>(
    "/api/warehouse/to-label?limit=100",
    fetcher,
    { fallbackData: { orders: initialOrders }, revalidateOnFocus: true },
  );

  const [query, setQuery] = useState("");
  const [hand, setHand] = useState<Row | null>(null);

  const orders = useMemo(() => data?.orders ?? [], [data]);
  const back = `/${locale}/warehouse/preparation`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push(back);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router, back]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return orders
      .filter((o) =>
        [o.customer_name, o.customer_city, o.product_name, o.id, o.tracking_number]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      )
      .slice(0, 6);
  }, [orders, query]);

  const onScanned = useCallback(() => {
    setHand(null);
    setQuery("");
    void mutate();
  }, [mutate]);

  return (
    <div className="min-h-dvh bg-wh-canvas px-4 py-6">
      <header className="mx-auto mb-5 flex w-full max-w-[720px] items-center gap-3">
        <Link
          href={back}
          className="grid h-9 w-9 place-items-center rounded-[10px] border border-wh-border bg-wh-surface text-wh-ink-2 hover:border-wh-border-strong"
          aria-label={tp("title")}
        >
          <ArrowLeft size={17} aria-hidden="true" />
        </Link>
        <div>
          <h1 className="text-[19px] font-bold tracking-[-0.02em] text-wh-ink-1">
            {tp("scanMode")}
          </h1>
          <p className="text-[12.5px] text-wh-ink-2">{t("oneSticker")}</p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[720px]">
        {/* Find the parcel in your hands. Deliberately not the whole queue —
            that screen exists, and it is one tap away. */}
        <div className="mb-3">
          <label className="flex items-center gap-2.5 rounded-[12px] border border-wh-border bg-wh-surface px-4 py-3 shadow-sm focus-within:border-wh-ok">
            <Search size={17} className="text-wh-ink-3" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tp("search")}
              className="w-full border-none bg-transparent text-[15px] outline-none"
            />
          </label>
          {matches.length > 0 ? (
            <div className="mt-1.5 overflow-hidden rounded-[12px] border border-wh-border bg-wh-surface shadow-sm">
              {matches.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    setHand(o);
                    setQuery("");
                  }}
                  className="flex w-full items-center gap-3 border-b border-wh-border px-4 py-2.5 text-start last:border-0 hover:bg-wh-surface-2"
                >
                  <span
                    className="h-4 w-4 shrink-0 rounded-full border border-black/15"
                    style={{ background: o.zone.colorHex ?? "transparent" }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[14px] font-semibold text-wh-ink-1">
                      <bdi>{o.customer_name}</bdi>
                    </b>
                    <span className="block truncate text-[12px] text-wh-ink-3">
                      <bdi>{o.customer_city}</bdi> · <bdi>{o.product_name}</bdi> × {o.quantity}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11.5px] text-wh-ink-3">
                    {o.zone.colorHex ? DARB_ZONES[o.zone.colorHex]?.colourFr : tp("zoneUnknown")}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <ScanStation
          variant="station"
          market="ly"
          hand={hand}
          handZone={hand?.zone ?? null}
          orders={orders}
          onScanned={onScanned}
        />

        <p className={`mt-4 text-center ${WH_LABEL}`}>{tp("escToLeave")}</p>
      </div>

    </div>
  );
}
