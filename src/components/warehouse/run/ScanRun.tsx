"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { jsonFetcher } from "@/lib/fetchers";
import { bucketize, type Bucket, type RunMode, type RunRow } from "@/lib/warehouse/scan-buckets";
import { useElapsed } from "@/hooks/useElapsed";
import { RollBand } from "./RollBand";
import { RunSetup } from "./RunSetup";
import { RunParcel } from "./RunParcel";
import { RunScanner } from "./RunScanner";
import { RunSummary, type RunTally } from "./RunSummary";

/**
 * A scan run: decide once what you are holding, then work the batch.
 *
 * WHY THIS EXISTS. The bench is a list, and a list asks the same question on
 * every row: which colour, which card, take, scan, back to the list. On the
 * floor the answer never changes for twenty parcels in a row — the roll is
 * already in your hand, or you are already at the rack. The run makes that
 * decision once and then only ever asks the question that changes: is this the
 * parcel, and did the sticker take.
 *
 * The bench keeps working exactly as before. This is a second door onto the
 * same queue and the same `/api/warehouse/scan-out`, not a replacement.
 *
 * WHAT IT REFUSES TO DO. No streaks, no personal bests, no score. The figures
 * on the summary are the four the run actually measured. A warehouse screen
 * that invents a number is one an agent stops believing, and this one carries
 * an act that moves stock.
 */

const QUEUE_KEY = "/api/warehouse/to-label?limit=200";
const STATE_KEY = "wh.run";
const MODE_KEY = "wh.run.mode";

interface QueuePage {
  orders: RunRow[];
  siteUnassigned?: boolean;
}

/** What survives a locked screen or a browser tab eviction, and nothing more. */
interface Persisted {
  mode: RunMode;
  bucketKey: string | null;
  cursor: string | null;
  skipped: string[];
  startedAt: number | null;
  tally: RunTally;
}

const EMPTY_TALLY: RunTally = { bound: 0, refused: 0, skipped: 0, problems: [] };

function readState(): Persisted | null {
  try {
    const raw = sessionStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}
function writeState(state: Persisted | null) {
  try {
    if (state) sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
    else sessionStorage.removeItem(STATE_KEY);
  } catch {
    // Storage blocked: the run still works for this page view.
  }
}
function readMode(): RunMode {
  try {
    return sessionStorage.getItem(MODE_KEY) === "zone" ? "zone" : "product";
  } catch {
    return "product";
  }
}

export function ScanRun({
  market,
  locale,
  currency,
  initialOrders,
  siteName,
  siteUnassigned,
}: {
  market: "ly" | "tn";
  locale: string;
  currency: string;
  initialOrders: RunRow[];
  siteName?: string | null;
  siteUnassigned?: boolean;
}) {
  const t = useTranslations("warehouse.run");
  const router = useRouter();

  const { data, mutate } = useSWR<QueuePage>(QUEUE_KEY, jsonFetcher, {
    fallbackData: { orders: initialOrders },
    revalidateOnFocus: true,
  });

  /*
   * The run starts empty on BOTH sides, then restores.
   *
   * `sessionStorage` does not exist on the server, so reading it in a state
   * initialiser makes the server render the picker while the browser renders a
   * batch in progress — React then throws away the tree and warns about a
   * hydration mismatch. The saved run is applied in an effect instead, one
   * paint later, which is invisible on a phone and correct everywhere.
   */
  const [mode, setMode] = useState<RunMode>("product");
  const [bucketKey, setBucketKey] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [tally, setTally] = useState<RunTally>(EMPTY_TALLY);
  /** Nothing is written back until the saved run has been read, or it erases it. */
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    if (siteUnassigned) {
      setRestored(true);
      return;
    }
    const saved = readState();
    if (saved) {
      setMode(saved.mode);
      setBucketKey(saved.bucketKey);
      setCursor(saved.cursor);
      setSkipped(saved.skipped);
      setStartedAt(saved.startedAt);
      setTally(saved.tally);
    } else {
      setMode(readMode());
    }
    setRestored(true);
  }, [siteUnassigned]);
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState(false);
  /*
   * Bound parcels leave the batch the instant the server says so, not on the
   * next revalidation. Without this the parcel is still in the list when the
   * run advances, and an agent who re-scans it hits Darb's duplicate-key
   * refusal — which is how parcels became permanently unscannable in September.
   */
  const [boundIds, setBoundIds] = useState<Set<string>>(() => new Set());

  const elapsed = useElapsed(startedAt);

  const live = useMemo(
    () => (data?.orders ?? []).filter((o) => !boundIds.has(o.id)),
    [data, boundIds],
  );

  const buckets = useMemo(
    () => bucketize(live, mode, market, locale),
    [live, mode, market, locale],
  );

  /*
   * The batch, and a memory of it.
   *
   * `bucketize` derives the batches from the LIVE queue, so binding the last
   * parcel of a batch makes that batch disappear from the list — and with it
   * the screen the agent is standing on. The run would fall back to the picker
   * as if nothing had happened, swallowing the summary of the work just done.
   * Holding the last non-empty shape keeps the finished batch nameable.
   */
  const lastBucket = useRef<Bucket | null>(null);
  const bucket = useMemo(() => {
    const live = buckets.find((b) => b.key === bucketKey) ?? null;
    // A ref, not state: this is a memory of the last render, and storing it in
    // state would set state during render on every revalidation.
    if (live) lastBucket.current = live;
    return live ?? (lastBucket.current?.key === bucketKey ? lastBucket.current : null);
  }, [buckets, bucketKey]);

  /** Skipped parcels go to the end of the batch, in the order they were skipped. */
  const queue = useMemo(() => {
    if (!bucket) return [];
    const open = bucket.rows.filter((r) => !boundIds.has(r.id));
    const rest = open.filter((r) => !skipped.includes(r.id));
    const back = skipped
      .map((id) => open.find((r) => r.id === id))
      .filter((r): r is RunRow => Boolean(r));
    return [...rest, ...back];
  }, [bucket, skipped, boundIds]);

  /*
   * The parcel on screen.
   *
   * A bound parcel leaves `queue` immediately — that is deliberate, it is what
   * stops an agent re-scanning it into Darb's duplicate-key refusal. But its
   * RESULT is still on screen and still names it, so the row is looked up in
   * the batch rather than the queue while the agent reads it.
   */
  const current = useMemo(() => {
    if (cursor) {
      // The bound parcel is gone from `queue` AND from the recomputed bucket —
      // both are derived from the live list — so it is looked up in the raw
      // page. Its result card is still on screen and still names it.
      const hit =
        queue.find((r) => r.id === cursor) ??
        (data?.orders ?? []).find((r) => r.id === cursor) ??
        null;
      if (hit) return hit;
    }
    return queue[0] ?? null;
  }, [queue, cursor, data]);

  const inQueue = current ? queue.findIndex((r) => r.id === current.id) : -1;
  // A parcel already bound is no longer IN the queue but is still the one being
  // read, so it counts as the position just past the ones that remain.
  const position = current ? (inQueue >= 0 ? inQueue + 1 : queue.length + 1) : 0;
  const total = Math.max(queue.length, position);

  useEffect(() => {
    // Before the restore lands the state is still the empty default; writing it
    // would wipe the very run this component is about to pick back up.
    if (!restored) return;
    if (!bucketKey) {
      writeState(null);
      return;
    }
    writeState({ mode, bucketKey, cursor, skipped, startedAt, tally });
  }, [restored, mode, bucketKey, cursor, skipped, startedAt, tally]);

  /*
   * A batch ends when it runs out of parcels — but not while the agent is still
   * reading the outcome of the last one. `advance` is what closes it, so the
   * summary follows a deliberate tap rather than appearing under their thumb.
   */
  useEffect(() => {
    if (bucketKey && queue.length === 0 && startedAt !== null && !armed) setDone(true);
  }, [bucketKey, queue.length, startedAt, armed]);

  const pickMode = useCallback((next: RunMode) => {
    setMode(next);
    try {
      sessionStorage.setItem(MODE_KEY, next);
    } catch {
      // Nothing to remember; the picker simply opens on "product" next time.
    }
  }, []);

  const pickBucket = useCallback((b: Bucket) => {
    setBucketKey(b.key);
    setCursor(b.rows[0]?.id ?? null);
    setSkipped([]);
    setStartedAt(Date.now());
    setTally(EMPTY_TALLY);
    setArmed(false);
    setDone(false);
    lastBucket.current = b;
  }, []);

  const advance = useCallback(() => {
    setArmed(false);
    const i = current ? queue.findIndex((r) => r.id === current.id) : -1;
    // Whatever follows in the queue; a bound parcel has already left it, so
    // slicing from -1 correctly starts at the front.
    const next = queue.slice(i + 1)[0] ?? queue.find((r) => r.id !== current?.id) ?? null;
    setCursor(next?.id ?? null);
    if (!next) setDone(true);
  }, [current, queue]);

  const onBound = useCallback(() => {
    if (current) {
      setBoundIds((s) => new Set(s).add(current.id));
      /*
       * Pin the cursor to the parcel that was just bound.
       *
       * It leaves `queue` immediately — deliberately, so nobody can re-scan it
       * into Darb's duplicate-key refusal — and without this the next parcel
       * would slide under the agent's thumb, taking the result card with it.
       * The stock effect and the sticker number have to stay readable until
       * they tap on.
       */
      setCursor(current.id);
    }
    setTally((v) => ({
      ...v,
      bound: v.bound + 1,
      // A retry that finally took is not a problem any more: drop it from both
      // the count and the list, or the summary reports a box that has left.
      refused: current && v.problems.some((p) => p.id === current.id) ? v.refused - 1 : v.refused,
      problems: current ? v.problems.filter((p) => p.id !== current.id) : v.problems,
    }));
    void mutate();
  }, [current, mutate]);

  /**
   * A parcel that did not leave. Counted once per parcel, not per attempt: an
   * agent who retries a refused sticker three times has one problem, not three.
   */
  const onUnresolved = useCallback(
    (message: string) => {
      if (!current) return;
      setTally((v) =>
        v.problems.some((p) => p.id === current.id)
          ? v
          : {
              ...v,
              refused: v.refused + 1,
              problems: [...v.problems, { id: current.id, name: current.customer_name, message }],
            },
      );
    },
    [current],
  );

  const skip = useCallback(() => {
    if (!current) return;
    const again = skipped.includes(current.id);
    setSkipped((s) => (again ? s : [...s, current.id]));
    // Counted once per parcel: an agent who puts the same box down twice has
    // set aside one parcel, not two.
    if (!again) setTally((v) => ({ ...v, skipped: v.skipped + 1 }));
    setArmed(false);

    /*
     * A parcel comes back to the end of the batch ONCE.
     *
     * Skipping it a second time ends the batch instead of handing it over
     * again: the queue would otherwise loop the same box forever, with no way
     * out but the exit button, and the agent would never see the summary that
     * names what they set aside.
     */
    const rest = queue.filter((r) => r.id !== current.id && !skipped.includes(r.id));
    if (rest.length === 0 && again) {
      setCursor(null);
      setDone(true);
      return;
    }
    const i = queue.findIndex((r) => r.id === current.id);
    const next = queue[i + 1] ?? queue.find((r) => r.id !== current.id) ?? null;
    if (!next) {
      setCursor(null);
      setDone(true);
      return;
    }
    setCursor(next.id);
  }, [current, queue, skipped]);

  const exit = useCallback(() => {
    writeState(null);
    router.push(`/${locale}/warehouse`);
  }, [router, locale]);

  const changeMode = useCallback(() => {
    setBucketKey(null);
    setCursor(null);
    setSkipped([]);
    setStartedAt(null);
    setDone(false);
    setArmed(false);
    writeState(null);
  }, []);

  const nextBucket = useMemo(
    () => buckets.find((b) => b.key !== bucketKey && b.rows.length > 0) ?? null,
    [buckets, bucketKey],
  );

  /*
   * No building, no run. An agent nobody assigned to Tripoli or Benghazi would
   * be shown both warehouses' parcels and refused at every scan; the screen
   * names the reason rather than offering a camera that cannot work.
   */
  if (siteUnassigned) {
    return (
      <div className="px-4 py-4">
        <RunChrome onExit={exit} title={t("title")} />
        <div
          data-testid="wh-run-no-site"
          className="mt-4 rounded-[14px] border border-wm-card-edge bg-wm-card px-4 py-6 text-center"
        >
          <p className="text-[16px] font-bold text-wm-ink">{t("noSiteTitle")}</p>
          <p className="mt-2 text-[14px] leading-relaxed text-wm-ink-2">{t("noSiteBody")}</p>
        </div>
      </div>
    );
  }

  if (done && bucket) {
    return (
      <div>
        <RunChrome onExit={exit} title={t("title")} subtitle={siteName ?? undefined} />
        <RunSummary
          tally={tally}
          duration={elapsed}
          next={nextBucket}
          onNext={() => nextBucket && pickBucket(nextBucket)}
          onChangeMode={changeMode}
          onExit={exit}
        />
      </div>
    );
  }

  if (!bucket || !current) {
    return (
      <div>
        <RunChrome onExit={exit} title={t("title")} subtitle={siteName ?? undefined} />
        {live.length === 0 ? (
          <p className="px-4 py-10 text-center text-[15px] text-wm-ink-2">{t("empty")}</p>
        ) : (
          <RunSetup market={market} mode={mode} buckets={buckets} onMode={pickMode} onPick={pickBucket} />
        )}
      </div>
    );
  }

  return (
    <div>
      <RunChrome
        onExit={exit}
        title={bucket.kind === "mixed" ? t("mixed") : bucket.label || t("title")}
        subtitle={siteName ?? undefined}
        progress={t("progress", { done: position, total })}
        progressLabel={t("progressLabel", { done: position, total })}
        elapsed={t("elapsed", { time: elapsed })}
        tally={tally}
      />

      <div className="mx-auto w-full max-w-[640px] px-4 pb-8">
        {market === "ly" ? (
          <div className="mb-3">
            <RollBand zone={current.zone} />
          </div>
        ) : null}

        {armed ? (
          <RunScanner
            market={market}
            row={current}
            hex={market === "ly" ? current.zone.colorHex : null}
            onBound={onBound}
            onUnresolved={onUnresolved}
            onNext={advance}
            onSkip={skip}
          />
        ) : (
          <RunParcel row={current} currency={currency} onConfirm={() => setArmed(true)} onSkip={skip} />
        )}
      </div>
    </div>
  );
}

/** The run's own chrome: it replaces the shell, so it carries the way out. */
function RunChrome({
  onExit,
  title,
  subtitle,
  progress,
  progressLabel,
  elapsed,
  tally,
}: {
  onExit: () => void;
  title: string;
  subtitle?: string;
  progress?: string;
  progressLabel?: string;
  elapsed?: string;
  tally?: RunTally;
}) {
  const t = useTranslations("warehouse.run");
  return (
    <header className="sticky top-0 z-10 border-b border-wm-card-edge bg-wm-ground/95 px-3 py-2 backdrop-blur">
      <div className="mx-auto w-full max-w-[640px]">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onExit}
          aria-label={t("exit")}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] border border-wm-card-edge bg-wm-card text-wm-ink-2"
        >
          <X size={20} aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-bold leading-tight text-wm-ink">
            <bdi>{title}</bdi>
          </p>
          {subtitle ? <p className="truncate text-[12.5px] text-wm-ink-2">{subtitle}</p> : null}
        </div>
        {progress ? (
          <div className="shrink-0 text-end">
            <p data-testid="wh-run-progress" aria-label={progressLabel} className="text-[17px] font-bold leading-none tabular-nums text-wm-ink">
              {progress}
            </p>
            {elapsed ? <p className="mt-0.5 text-[12px] tabular-nums text-wm-ink-3">{elapsed}</p> : null}
          </div>
        ) : null}
      </div>
      {tally ? (
        <p data-testid="wh-run-tally" className="mt-1.5 flex flex-wrap gap-x-3 text-[12px] text-wm-ink-2">
          <span className="text-wh-ok">{t("tallyBound", { n: tally.bound })}</span>
          {tally.refused > 0 ? <span className="text-wh-bad">{t("tallyRefused", { n: tally.refused })}</span> : null}
          {tally.skipped > 0 ? <span>{t("tallySkipped", { n: tally.skipped })}</span> : null}
        </p>
      ) : null}
      </div>
    </header>
  );
}
