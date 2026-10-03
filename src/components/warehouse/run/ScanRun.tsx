"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { jsonFetcher } from "@/lib/fetchers";
import { zoneLabels } from "@/lib/carriers/darb-zones";
import { bucketize, type Bucket, type RunMode, type RunRow } from "@/lib/warehouse/scan-buckets";
import { useElapsed } from "@/hooks/useElapsed";
import { RollBand } from "./RollBand";
import { RunSetup } from "./RunSetup";
import { RunScanner } from "./RunScanner";
import { RunSummary, type RunTally } from "./RunSummary";

/**
 * A scan run: the parcel in hand, the roll in the other hand, the camera
 * between them (`R.run` / `R.bound` / `R.wrongsite` in the v3 prototype).
 *
 * WHY THIS EXISTS. The bench is a list, and a list asks the same question on
 * every row: which colour, which card, take, scan, back to the list. On the
 * floor the answer never changes for twenty parcels in a row — the roll is
 * already in your hand. The run makes that decision once (« Commencer » on a
 * roll in Sortir, or the picker here) and then only asks the question that
 * changes: did the sticker take.
 *
 * THE PARCEL IS IN HAND. There is no "is this the parcel?" step: the run opens
 * on the parcel with the scanner already under it, and can open on the very
 * parcel tapped on Sortir (`?order=`). The card stays above the camera for the
 * whole scan, and the bound card names product and city right after — that is
 * what guards against a sticker on the wrong box.
 *
 * WHAT IT REFUSES TO DO. No streaks, no personal bests, no score. The figures
 * on the summary are the ones the run actually measured. A warehouse screen
 * that invents a number is one an agent stops believing, and this one carries
 * an act that moves stock.
 */

const QUEUE_KEY = "/api/warehouse/to-label?limit=200";
const STATE_KEY = "wh.run";
const MODE_KEY = "wh.run.mode";
/**
 * The roll being worked, for Sortir's sticker-first bind: a sticker scanned
 * before any parcel is offered parcels of the roll it most likely came from.
 * The same key Sortir (`BenchHome`) reads and writes.
 */
export const LAST_ROLL_KEY = "wh.bench.roll";

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
  /** Parcels of another building, taken out of this batch for good. */
  dropped?: string[];
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
  initialOrders,
  siteName,
  siteUnassigned,
  initialRoll,
  initialOrder,
}: {
  market: "ly" | "tn";
  locale: string;
  /** Kept for the page's call; the run shows no price (the prototype has none). */
  currency?: string;
  initialOrders: RunRow[];
  siteName?: string | null;
  siteUnassigned?: boolean;
  /**
   * The roll chosen with « Commencer » on Sortir (`?roll=`). The agent has
   * already picked the roll in their hand, so the run opens on it directly —
   * and it wins over a run saved earlier, because the choice was just made.
   */
  initialRoll?: string | null;
  /** The parcel tapped on Sortir (`?order=`): the run opens with it in hand. */
  initialOrder?: string | null;
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
  const [dropped, setDropped] = useState<string[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [tally, setTally] = useState<RunTally>(EMPTY_TALLY);
  /** Nothing is written back until the saved run has been read, or it erases it. */
  const [restored, setRestored] = useState(false);
  /**
   * The parcel just bound, while its outcome is on screen.
   *
   * It leaves the queue the instant the server says so — that is what stops an
   * agent re-scanning it into Darb's duplicate-key refusal, which is how parcels
   * became permanently unscannable in September — and the revalidated page no
   * longer carries it either. Its number and its stock move must stay readable
   * until the agent taps on, so the row is held here.
   */
  const [held, setHeld] = useState<{ row: RunRow; index: number } | null>(null);
  const [done, setDone] = useState(false);
  const [boundIds, setBoundIds] = useState<Set<string>>(() => new Set());
  /*
   * The batch, and a memory of it.
   *
   * `bucketize` derives the batches from the LIVE queue, so binding the last
   * parcel of a batch makes that batch disappear from the list — and with it
   * the screen the agent is standing on. Holding the last non-empty shape keeps
   * the finished batch nameable for its summary.
   */
  const lastBucket = useRef<Bucket | null>(null);

  useEffect(() => {
    if (siteUnassigned) {
      setRestored(true);
      return;
    }
    /*
     * Sortir chose for us: a roll (« Commencer »), or one parcel of it. The
     * parcel decides the batch when both are given — it is the box in hand.
     */
    const rolls = initialRoll || initialOrder ? bucketize(initialOrders, "zone", market, locale) : [];
    const chosen =
      (initialOrder ? rolls.find((b) => b.rows.some((r) => r.id === initialOrder)) : undefined) ??
      (initialRoll ? rolls.find((b) => b.key === initialRoll) : undefined);
    if (chosen) {
      const first = chosen.rows.find((r) => r.id === initialOrder) ?? chosen.rows[0];
      setMode("zone");
      setBucketKey(chosen.key);
      setCursor(first?.id ?? null);
      setSkipped([]);
      setDropped([]);
      setStartedAt(Date.now());
      setTally(EMPTY_TALLY);
      lastBucket.current = chosen;
      setRestored(true);
      return;
    }
    const saved = readState();
    if (saved) {
      setMode(saved.mode);
      setBucketKey(saved.bucketKey);
      setCursor(saved.cursor);
      setSkipped(saved.skipped);
      setDropped(saved.dropped ?? []);
      setStartedAt(saved.startedAt);
      setTally(saved.tally);
    } else {
      setMode(readMode());
    }
    setRestored(true);
    // Runs once on mount: the address is read once, the saved run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteUnassigned]);

  const elapsed = useElapsed(startedAt);

  const live = useMemo(
    () => (data?.orders ?? []).filter((o) => !boundIds.has(o.id)),
    [data, boundIds],
  );

  const buckets = useMemo(() => bucketize(live, mode, market, locale), [live, mode, market, locale]);

  const bucket = useMemo(() => {
    const found = buckets.find((b) => b.key === bucketKey) ?? null;
    // A ref, not state: this is a memory of the last render, and storing it in
    // state would set state during render on every revalidation.
    if (found) lastBucket.current = found;
    return found ?? (lastBucket.current?.key === bucketKey ? lastBucket.current : null);
  }, [buckets, bucketKey]);

  /** Skipped parcels go to the end of the batch, in the order they were skipped. */
  const queue = useMemo(() => {
    if (!bucket) return [];
    const open = bucket.rows.filter((r) => !boundIds.has(r.id) && !dropped.includes(r.id));
    const rest = open.filter((r) => !skipped.includes(r.id));
    const back = skipped
      .map((id) => open.find((r) => r.id === id))
      .filter((r): r is RunRow => Boolean(r));
    return [...rest, ...back];
  }, [bucket, skipped, boundIds, dropped]);

  const current = useMemo(() => {
    if (held && cursor === held.row.id) return held.row;
    return (cursor ? queue.find((r) => r.id === cursor) : undefined) ?? queue[0] ?? null;
  }, [queue, cursor, held]);

  /** The parcel that follows: the one after this, else whatever is left. */
  const nextRow = useMemo(() => {
    if (!current) return null;
    const i = queue.findIndex((r) => r.id === current.id);
    if (i < 0) return queue[held?.index ?? 0] ?? queue[0] ?? null;
    return queue[i + 1] ?? queue.find((r) => r.id !== current.id) ?? null;
  }, [current, queue, held]);

  /*
   * « k / n ». A parcel bound or sent back to its building is handled; the
   * batch is those plus what is still on the table, so the count does not
   * shrink under the agent as they work.
   */
  const handled = tally.bound + dropped.length;
  const inQueue = current ? queue.findIndex((r) => r.id === current.id) : -1;
  const position = inQueue >= 0 ? handled + inQueue + 1 : handled;
  const total = handled + queue.length;

  useEffect(() => {
    // Before the restore lands the state is still the empty default; writing it
    // would wipe the very run this component is about to pick back up.
    if (!restored) return;
    if (!bucketKey) {
      writeState(null);
      return;
    }
    writeState({ mode, bucketKey, cursor, skipped, dropped, startedAt, tally });
  }, [restored, mode, bucketKey, cursor, skipped, dropped, startedAt, tally]);

  const rollHex = market === "ly" ? current?.zone.colorHex ?? null : null;
  useEffect(() => {
    if (!rollHex) return;
    try {
      sessionStorage.setItem(LAST_ROLL_KEY, rollHex);
    } catch {
      // Nothing to remember; the sticker-first bind simply asks for the roll.
    }
  }, [rollHex]);

  /*
   * A batch ends when it runs out of parcels — but not while the agent is
   * still reading the outcome of the last one. `advance` is what closes it, so
   * the summary follows a deliberate tap rather than appearing under a thumb.
   */
  useEffect(() => {
    if (bucketKey && queue.length === 0 && startedAt !== null && !held) setDone(true);
  }, [bucketKey, queue.length, startedAt, held]);

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
    setDropped([]);
    setStartedAt(Date.now());
    setTally(EMPTY_TALLY);
    setHeld(null);
    setDone(false);
    lastBucket.current = b;
  }, []);

  /** Off the outcome card, onto the next parcel — by the ring or by « Suivant ». */
  const advance = useCallback(() => {
    setHeld(null);
    setCursor(nextRow?.id ?? null);
    if (!nextRow) setDone(true);
  }, [nextRow]);

  const onBound = useCallback(() => {
    if (current) {
      setBoundIds((s) => new Set(s).add(current.id));
      setHeld({ row: current, index: Math.max(0, queue.findIndex((r) => r.id === current.id)) });
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
  }, [current, queue, mutate]);

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
    setHeld(null);

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

  /**
   * « Compris » on the wrong-building card: the parcel leaves THIS batch for
   * good. Handing it back at the end would only refuse it a second time — it
   * belongs on the other building's table. The summary still names it.
   */
  const setAside = useCallback(() => {
    if (!current) return;
    setDropped((d) => (d.includes(current.id) ? d : [...d, current.id]));
    setHeld(null);
    const i = queue.findIndex((r) => r.id === current.id);
    const next = queue[i + 1] ?? queue.find((r) => r.id !== current.id) ?? null;
    setCursor(next?.id ?? null);
    if (!next) setDone(true);
  }, [current, queue]);

  const exit = useCallback(() => {
    writeState(null);
    router.push(`/${locale}/warehouse/out`);
  }, [router, locale]);

  const changeMode = useCallback(() => {
    setBucketKey(null);
    setCursor(null);
    setSkipped([]);
    setDropped([]);
    setStartedAt(null);
    setDone(false);
    setHeld(null);
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
      <div className="job-out">
        <RunChrome onExit={exit} title={t("title")} />
        <div className="mx-auto w-full max-w-[640px] px-[16px] pt-[16px]">
          <div
            data-testid="wh-run-no-site"
            className="rounded-[16px] border border-line-subtle bg-white px-[16px] py-[24px] text-center"
          >
            <p className="text-[16px] font-bold text-wm-ink">{t("noSiteTitle")}</p>
            <p className="mt-[8px] text-[14px] leading-[1.5] text-wm-ink-2">{t("noSiteBody")}</p>
          </div>
        </div>
      </div>
    );
  }

  if (done && bucket) {
    return (
      <div className="job-out">
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
      <div className="job-out">
        <RunChrome onExit={exit} title={t("title")} subtitle={siteName ?? undefined} />
        {live.length === 0 ? (
          <p className="px-[16px] py-[40px] text-center text-[15px] text-wm-ink-2">{t("empty")}</p>
        ) : (
          <RunSetup market={market} mode={mode} buckets={buckets} onMode={pickMode} onPick={pickBucket} />
        )}
      </div>
    );
  }

  /*
   * The band. In Libya it is the parcel's ROLL — the colour to reach for — in
   * every mode: a batch of one product still goes to several rolls. Elsewhere
   * there is no roll, and the band names the batch in the job's own hue.
   */
  const labels = zoneLabels(rollHex, locale);
  const band =
    market === "ly"
      ? {
          hex: rollHex,
          title: rollHex
            ? t("rollName", { colour: labels.colour ?? current.zone.colourFr ?? rollHex })
            : t("unknownZone"),
          sub: labels.name ?? (locale === "ar" ? current.zone.nameAr : current.zone.nameFr) ?? null,
          plate: rollHex ? current.zone.branchGroup : null,
        }
      : {
          hex: null,
          title:
            bucket.kind === "mixed"
              ? t("mixed")
              : bucket.kind === "zone_unknown"
                ? t("unknownZoneTn")
                : bucket.label || t("title"),
          sub: siteName ?? null,
          plate: null,
        };

  return (
    <div className="job-out mx-auto w-full max-w-[640px] px-[16px] pb-[24px] pt-[18px]">
      <RollBand hex={band.hex} title={band.title} sub={band.sub} plate={band.plate} onExit={exit} />
      <RunScanner
        key={current.id}
        market={market}
        row={current}
        hex={rollHex}
        colourName={rollHex ? labels.colour : null}
        position={position}
        total={total}
        done={handled}
        next={nextRow}
        sameRoll={market === "ly" && !!rollHex && nextRow?.zone.colorHex === rollHex}
        onBound={onBound}
        onUnresolved={onUnresolved}
        onNext={advance}
        onSkip={skip}
        onSetAside={setAside}
        onClose={exit}
      />
    </div>
  );
}

/**
 * The chrome of the run's two in-between screens — choosing a batch, and its
 * summary. The parcel screen has none: the roll band carries the way out.
 */
function RunChrome({ onExit, title, subtitle }: { onExit: () => void; title: string; subtitle?: string }) {
  const t = useTranslations("warehouse.run");
  return (
    <header className="sticky top-0 z-10 border-b border-line-subtle bg-wm-ground/95 px-[16px] py-[10px] backdrop-blur">
      <div className="mx-auto flex w-full max-w-[640px] items-center gap-[10px]">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-bold leading-[1.3] text-wm-ink">
            <bdi>{title}</bdi>
          </p>
          {subtitle ? <p className="truncate text-[12.5px] text-wm-ink-2">{subtitle}</p> : null}
        </div>
        <button
          type="button"
          onClick={onExit}
          aria-label={t("exit")}
          className="grid h-[36px] w-[36px] shrink-0 place-items-center rounded-full bg-[rgba(0,0,0,.06)] text-wm-ink-2"
        >
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
