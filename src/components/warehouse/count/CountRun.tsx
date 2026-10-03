"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Package, X } from "lucide-react";
import { jsonFetcher } from "@/lib/fetchers";
import { Chip } from "@/components/warehouse/today/Chip";
import type { WarehouseStockRow } from "@/app/api/warehouse/stock/route";
import type { WarehouseSitesResponse } from "@/app/api/warehouse/sites/route";

/**
 * « Compter » — the count run, the fourth job of the day.
 *
 * On 2026-10-02 not one product had ever been counted, so every stock figure
 * in Ordra was the register alone. The run makes the first count cheap: one
 * product per screen, never-counted first, the number typed with the gap shown
 * live, the reason pre-filled (« Comptage d'inventaire ») instead of a blank
 * mandatory field.
 *
 * It counts a BUILDING. An agent counts their own (the server pins it again);
 * a manager chooses. A building's first count draws from the stock no building
 * has counted yet rather than adding to it — the rule of
 * 20261002190000_record_stock_count_draws_from_pool — so the screen calls it a
 * first count instead of showing a gap against zero.
 */

/** The figure the count is compared with: this building's last count, if any. */
function previousFor(row: WarehouseStockRow, siteId: string | null, siteCount: number): number | null {
  const here = row.sites.find((s) => s.warehouse_id === siteId);
  if (here && here.last_counted_at) return here.current_stock;
  // One building: counting it IS counting the market, so the register is the
  // honest comparison.
  if (siteCount <= 1) return row.current_stock;
  return null;
}

const sign = (d: number) => (d > 0 ? `+${d}` : d < 0 ? `−${Math.abs(d)}` : "0");

export function CountRun({
  locale,
  productId = null,
  initialSiteId = null,
}: {
  locale: string;
  /** `?product=` — « Compter » on one product: the run holds that product only. */
  productId?: string | null;
  /** `?warehouse_id=` — the building a manager chose before opening the run. */
  initialSiteId?: string | null;
}) {
  const t = useTranslations("warehouse.countRun");
  const tBench = useTranslations("warehouse.bench");

  const { data: stock, mutate } = useSWR<{ rows: WarehouseStockRow[] }>("/api/warehouse/stock", jsonFetcher);
  const { data: sitesData } = useSWR<WarehouseSitesResponse>("/api/warehouse/sites", jsonFetcher);

  // Never counted first, then the oldest count: the run starts where the
  // register is least trustworthy.
  const queue = useMemo(
    () =>
      [...(stock?.rows ?? [])].filter((r) => productId === null || r.product_id === productId).sort((a, b) => {
        const ta = a.last_counted_at ? new Date(a.last_counted_at).getTime() : -1;
        const tb = b.last_counted_at ? new Date(b.last_counted_at).getTime() : -1;
        return ta - tb || a.name.localeCompare(b.name);
      }),
    // The order is fixed when the run opens; a save must not reshuffle it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stock === undefined],
  );

  const sites = sitesData?.sites ?? [];
  const pinned = sitesData?.pinned ?? false;
  const [siteId, setSiteId] = useState<string | null>(null);
  useEffect(() => {
    if (siteId !== null || !sitesData) return;
    // An agent is pinned to their building whatever the address says; a manager
    // opens on the building they chose, else the first one.
    const asked = initialSiteId && sitesData.sites.some((s) => s.id === initialSiteId) ? initialSiteId : null;
    setSiteId(sitesData.mine ?? asked ?? sitesData.sites[0]?.id ?? null);
  }, [siteId, sitesData, initialSiteId]);

  const [index, setIndex] = useState(0);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tally, setTally] = useState({ counted: 0, skipped: 0 });

  const current = queue[index] ?? null;
  const previous = current ? previousFor(current, siteId, sites.length) : null;
  const typed = value.trim() === "" ? null : Number(value);
  const valid = typed !== null && Number.isInteger(typed) && typed >= 0;

  // The prototype opens each product on its reference figure, so a shelf that
  // matches is one tap. Only when that figure IS this building's: its own last
  // count, or the register of a one-building market. Once per product and
  // building — a background refresh must never overwrite what was typed.
  const prefilledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!current || siteId === null && sites.length > 0) return;
    const key = `${current.product_id}|${siteId ?? ""}`;
    if (prefilledFor.current === key) return;
    prefilledFor.current = key;
    setValue(previous !== null ? String(previous) : "");
  }, [current, siteId, sites.length, previous]);

  const next = (kind: "counted" | "skipped") => {
    setTally((s) => ({ ...s, [kind]: s[kind] + 1 }));
    setIndex((i) => i + 1);
    setValue("");
    setFailed(false);
  };

  const save = async () => {
    if (!current || !valid || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/warehouse/stock/count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: current.product_id,
          counted_qty: typed,
          note: t("defaultNote"),
          ...(siteId ? { warehouse_id: siteId } : {}),
        }),
      });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      void mutate();
      next("counted");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (sitesData?.unassigned) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="text-[16px] font-bold text-wm-ink">{tBench("noSiteTitle")}</p>
        <p className="mt-2 text-[14px] text-wm-ink-2">{tBench("noSiteBody")}</p>
      </div>
    );
  }

  // `.top` of the prototype: a 40px close button, then « Comptage · Benghazi »
  // over the bold « 2 / 7 ».
  const siteName = sites.find((s) => s.id === siteId)?.name ?? null;
  const header = (
    <header className="mb-[18px] flex items-center gap-[12px]">
      <Link
        href={`/${locale}/warehouse/stock`}
        aria-label={t("exit")}
        className="grid h-[40px] w-[40px] shrink-0 place-items-center rounded-full border border-wm-card-edge bg-wm-card text-wm-ink"
      >
        <X size={18} aria-hidden="true" />
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="text-[12.5px] font-semibold text-wm-ink-2" dir="auto">
          {siteName ? `${t("title")} · ${siteName}` : t("title")}
        </h1>
        {queue.length > 0 && current ? (
          <p data-testid="count-progress" className="text-[14px] font-bold tabular-nums text-wm-ink" dir="ltr">
            {`${index + 1} / ${queue.length}`}
          </p>
        ) : null}
      </div>
      {!pinned && sites.length > 1 ? (
        <label className="flex items-center gap-[8px] text-[13px] text-wm-ink-2">
          <span>{t("site")}</span>
          <select
            aria-label={t("site")}
            value={siteId ?? ""}
            onChange={(e) => setSiteId(e.target.value)}
            className="h-[40px] rounded-[10px] border border-wm-card-edge bg-wm-card px-[10px] text-[14px] font-semibold text-wm-ink"
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </header>
  );

  if (queue.length === 0) {
    return (
      <div className="job-count mx-auto w-full max-w-[560px] px-4 py-4">
        {header}
        <p className="py-8 text-center text-[14px] text-wm-ink-2">{t("empty")}</p>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="job-count mx-auto w-full max-w-[560px] px-4 py-4">
        {header}
        <div className="rounded-[16px] border border-wm-card-edge bg-wm-card px-5 py-8 text-center">
          <p className="text-[20px] font-bold text-wm-ink">{t("done")}</p>
          <p className="mt-1 text-[14px] text-wm-ink-2">{t("doneBody", tally)}</p>
          <Link
            href={`/${locale}/warehouse/stock`}
            className="mt-5 inline-flex min-h-[48px] items-center justify-center rounded-[12px] bg-job px-5 text-[15px] font-bold text-white no-underline"
          >
            {t("backToStock")}
          </Link>
        </div>
      </div>
    );
  }

  const gap = valid && previous !== null ? (typed as number) - previous : null;
  const step = (d: number) => setValue(String(Math.max(0, (valid ? (typed as number) : previous ?? 0) + d)));

  return (
    <div className="job-count mx-auto w-full max-w-[560px] px-[16px] pb-[24px] pt-[18px]">
      {header}

      {/* `.progress-dots`: done products in the job's hue. */}
      <div className="mb-[18px] flex gap-[4px]" aria-hidden="true">
        {queue.map((q, i) => (
          <i key={q.product_id} className={`h-[4px] flex-1 rounded-[2px] ${i < index ? "bg-job" : "bg-wm-track"}`} />
        ))}
      </div>

      {/* `.card.inhand` */}
      <div className="rounded-[16px] border border-wm-card-edge bg-wm-card p-[18px]">
        <div className="flex items-center gap-[12px]">
          {current.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current.image_url} alt="" className="h-[56px] w-[56px] shrink-0 rounded-[10px] object-cover" />
          ) : (
            <span className="grid h-[56px] w-[56px] shrink-0 place-items-center rounded-[10px] bg-job-bg text-job-ink">
              <Package size={24} aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-[20px] font-bold leading-[1.3] text-wm-ink" dir="auto">{current.name}</h2>
            {current.sku ? (
              <p className="mt-[2px] font-mono text-[12.5px] text-wm-ink-2" dir="ltr">{current.sku}</p>
            ) : null}
          </div>
        </div>
        <div className="my-[14px] h-px bg-wm-card-edge" />
        <div className="flex items-center gap-[12px] text-[12.5px]">
          <span className="flex-1 text-wm-ink-2">{t("register")}</span>
          <b className="tabular-nums text-wm-ink" dir="ltr">{current.current_stock}</b>
        </div>
      </div>

      <label htmlFor="count-input" className="mt-[20px] block text-[17px] font-bold text-wm-ink">
        {t("question")}
      </label>
      {/* `.stepper` */}
      <div className="mt-[16px] flex items-center gap-[10px]">
        <button
          type="button"
          aria-label={t("minus")}
          onClick={() => step(-1)}
          className="grid h-[64px] w-[64px] shrink-0 place-items-center rounded-[16px] border border-wh-border-strong bg-wm-card text-[26px] font-semibold text-wm-ink"
        >
          −
        </button>
        <input
          id="count-input"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))}
          className="h-[72px] min-w-0 flex-1 rounded-[16px] border-2 border-job bg-wm-card text-center text-[38px] font-bold tabular-nums text-wm-ink outline-none"
          dir="ltr"
        />
        <button
          type="button"
          aria-label={t("plus")}
          onClick={() => step(1)}
          className="grid h-[64px] w-[64px] shrink-0 place-items-center rounded-[16px] border border-wh-border-strong bg-wm-card text-[26px] font-semibold text-wm-ink"
        >
          +
        </button>
      </div>

      {/* `.delta`: Identique / Écart −4 / Écart +3, live. A building's first
          count in a shared register has nothing honest to compare with. */}
      <div data-testid="count-delta" className="mt-[12px] min-h-[24px] text-center text-[15px] font-bold">
        {previous === null ? (
          <Chip tone="mute">{t("firstHere")}</Chip>
        ) : !valid ? null : gap === 0 ? (
          <Chip tone="ok">{t("same")}</Chip>
        ) : (
          <Chip tone={(gap ?? 0) < 0 ? "bad" : "info"}>
            {t("gap", { d: "" })}
            <span className="tabular-nums" dir="ltr">{sign(gap ?? 0)}</span>
          </Chip>
        )}
      </div>
      <p className="mt-[4px] text-center text-[12.5px] text-wm-ink-2">{t("reason")}</p>

      {failed ? (
        <p role="alert" className="mt-[8px] text-center text-[13.5px] text-wh-bad">
          {t("failed")}
        </p>
      ) : null}

      <div className="mt-[22px] flex gap-[12px]">
        <button
          type="button"
          onClick={() => next("skipped")}
          disabled={busy}
          className="min-h-[48px] flex-1 rounded-[12px] border border-wh-border-strong bg-wm-card px-[18px] text-[15px] font-bold text-wm-ink"
        >
          {t("skip")}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!valid || busy}
          className="min-h-[48px] flex-[2] rounded-[12px] bg-brand px-[18px] text-[15px] font-bold text-white disabled:opacity-40"
        >
          {t("next")}
        </button>
      </div>
    </div>
  );
}
