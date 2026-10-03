"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { ReturnsPayload } from "@/app/api/warehouse/returns/returns-data";
import { jsonFetcher } from "@/lib/fetchers";
import { readScannerPrefs, signalOutcome } from "@/lib/warehouse/scanner-prefs";
import { ReturnCard, OnTheWayCard } from "@/components/warehouse/mobile/ReturnCard";
import { ReturnVerdict, type VerdictResult } from "./ReturnVerdict";
import { parcelRef } from "./parts";

/**
 * « Rentrer » on the agent's phone — prototype R.returns, then R.verdict.
 *
 * Returns are rare (2 since 9 September in Libya), so the screen is built to be
 * obvious the day one arrives, not fast in volume: what Darb holds for this
 * building, longest-held first, and what is still on the road — greyed, because
 * only `to_be_returned` is receivable (decision of 2026-09-08).
 *
 * There is no scan field here. Scanning is the centre Scan button's job; its
 * sheet lands on `?order=<id>`, the same URL a tap on a row opens, so there is
 * one verdict whichever way the parcel was found. Redelivery is the manager's,
 * on the desk.
 */

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11.5px] font-semibold uppercase tracking-[0.05em] text-wh-ink-2 rtl:text-[12.5px] rtl:normal-case rtl:tracking-normal">
      {children}
    </div>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span dir="ltr" className="tabular-nums [unicode-bidi:isolate]">
      {n}
    </span>
  );
}

const CARD = "overflow-hidden rounded-[16px] border border-line-subtle bg-white [&>*+*]:border-t [&>*+*]:border-line-subtle";

export function ReturnsHome({
  marketId,
  siteName,
  dateLabel,
}: {
  marketId: string | null;
  /** The agent's building, in the market's language. */
  siteName: string | null;
  /** The market's date, formatted on the server in its time zone. */
  dateLabel: string;
}) {
  const t = useTranslations("warehouse.returns2");
  const tBench = useTranslations("warehouse.bench");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const openId = search?.get("order") ?? null;

  const { data, error, mutate } = useSWR<ReturnsPayload>(
    `/api/warehouse/returns?limit=100${marketId ? `&market_id=${marketId}` : ""}`,
    jsonFetcher,
    { revalidateOnFocus: true },
  );

  // Longest at Darb first: that is the one costing money on their shelf.
  const atDarb = useMemo(
    () =>
      [...(data?.orders ?? [])].sort(
        (a, b) => +new Date(a.returned_at ?? a.created_at) - +new Date(b.returned_at ?? b.created_at),
      ),
    [data],
  );
  const onTheWay = data?.onTheWay ?? [];

  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(null), 5000);
    return () => clearTimeout(id);
  }, [saved]);

  const open = useCallback((id: string) => router.push(`${pathname}?order=${encodeURIComponent(id)}`), [router, pathname]);
  const close = useCallback(() => router.replace(pathname), [router, pathname]);

  const onRecorded = useCallback(
    (r: VerdictResult) => {
      signalOutcome("lookup", readScannerPrefs());
      setSaved(r.kind === "intact" ? t("savedIntact", { n: r.quantity }) : t("savedDamaged"));
      void mutate();
      close();
    },
    [mutate, close, t],
  );

  const eyebrow = [siteName, dateLabel].filter(Boolean).join(" · ");

  /* ── The verdict ────────────────────────────────────────────────── */
  if (openId) {
    const row = atDarb.find((o) => o.id === openId) ?? null;
    return (
      <div className="job-returns px-[16px] pb-[24px] pt-[18px]">
        <header className="mb-[18px] flex items-center gap-[12px]">
          <button
            type="button"
            onClick={close}
            aria-label={t("back")}
            className="grid h-[40px] w-[40px] shrink-0 place-items-center rounded-full border border-wh-border bg-white text-wh-ink-1"
          >
            <ArrowLeft size={18} aria-hidden="true" className="rtl:-scale-x-100" />
          </button>
          <div className="min-w-0 flex-1">
            {row ? (
              <p dir="ltr" className="text-[12.5px] font-semibold text-wh-ink-2 [unicode-bidi:isolate] rtl:text-end">
                {parcelRef(row)}
              </p>
            ) : null}
            <h1 className="text-[28px] font-bold leading-[1.2] tracking-[-0.02em] text-wh-ink-1">{t("title")}</h1>
          </div>
        </header>
        {row ? (
          <ReturnVerdict key={row.id} row={row} onRecorded={onRecorded} />
        ) : data ? (
          <div className="rounded-[16px] border border-line-subtle bg-white p-[16px] text-[14px] text-wh-ink-2">
            {t("notHere")}
          </div>
        ) : (
          <div aria-hidden="true" className="h-[160px] rounded-[16px] bg-wm-track" />
        )}
      </div>
    );
  }

  /* ── The list ───────────────────────────────────────────────────── */
  return (
    <div className="job-returns px-[16px] pb-[24px] pt-[18px]">
      <header className="mb-[18px]">
        {eyebrow ? (
          <p className="text-[12.5px] font-semibold text-wh-ink-2" dir="auto">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-[28px] font-bold leading-[1.2] tracking-[-0.02em] text-wh-ink-1">{t("title")}</h1>
      </header>

      {data?.siteUnassigned ? (
        <div className="rounded-[16px] border border-line-subtle bg-white px-[16px] py-[24px] text-center">
          <p className="text-[16px] font-bold text-wh-ink-1">{tBench("noSiteTitle")}</p>
          <p className="mt-[8px] text-[14px] leading-relaxed text-wh-ink-2">{tBench("noSiteBody")}</p>
        </div>
      ) : (
        <>
          <p className="-mt-[8px] mb-[14px] text-[12.5px] text-wh-ink-2">{t("rule")}</p>

          {saved ? (
            <p role="status" className="mb-[12px] text-[13px] font-semibold text-wh-ok">
              {saved}
            </p>
          ) : null}

          {error ? (
            <div
              role="alert"
              className="flex flex-col items-center gap-[10px] rounded-[16px] border border-wh-bad-edge bg-wh-bad-bg px-[16px] py-[24px] text-center"
            >
              <p className="text-[15px] font-semibold text-wh-ink-1">{t("loadError")}</p>
              <p className="text-[13px] text-wh-ink-2">{t("loadErrorHint")}</p>
              <button
                type="button"
                onClick={() => void mutate()}
                className="inline-flex min-h-[44px] items-center rounded-[12px] border border-wh-border-strong bg-white px-[16px] text-[14px] font-bold text-wh-ink-1"
              >
                {t("retry")}
              </button>
            </div>
          ) : data === undefined ? (
            <div data-testid="wh-returns-skeleton" aria-hidden="true" className="h-[136px] rounded-[16px] bg-wm-track" />
          ) : (
            <>
              <div className="mb-[8px]">
                <Label>
                  {t("atDarb")} · <Count n={atDarb.length} />
                </Label>
              </div>
              <div className={CARD}>
                {atDarb.length === 0 ? (
                  <p className="px-[14px] py-[16px] text-[13px] text-wh-ink-2">{t("emptyAtDarb")}</p>
                ) : (
                  atDarb.map((o) => <ReturnCard key={o.id} row={o} onOpen={open} />)
                )}
              </div>

              {onTheWay.length > 0 ? (
                <>
                  <div className="mb-[8px] mt-[20px]">
                    <Label>
                      {t("onWay")} · <Count n={onTheWay.length} />
                    </Label>
                  </div>
                  <div className={`${CARD} opacity-[.62]`}>
                    {onTheWay.map((o) => (
                      <OnTheWayCard key={o.id} row={o} />
                    ))}
                  </div>
                </>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
