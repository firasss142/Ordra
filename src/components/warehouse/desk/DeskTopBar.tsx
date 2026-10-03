"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useSWRConfig } from "swr";
import { Check, ScanLine, TriangleAlert, X } from "lucide-react";
import type { AuthUser } from "@/types";
import { zoneLabels } from "@/lib/carriers/darb-zones";
import type { ScanOutcome } from "@/lib/preparation/scan-outcome";
import { useScanOut } from "@/components/warehouse/bench/useScanOut";
import { useWarehouseSites } from "@/hooks/useWarehouseSites";
import { useDeskScan } from "./DeskScanContext";

/**
 * The desk top bar — on every Entrepôt screen of a manager or super_admin.
 *
 * A permanent scan field, the building switch, the avatar. The field took over
 * the side ScanStation's job: one scanner, not a third version of it.
 *
 * A USB scanner types like a keyboard and ends with Enter. With a parcel in
 * hand Enter binds the sticker through `useScanOut` — the same local refusals,
 * the same `/api/warehouse/scan-out` guards and Darb verification, the same
 * four outcomes. With nothing in hand Enter only LOOKS the code up and opens
 * the order: a sticker is never bound to nothing.
 */

interface LookupBody {
  outcome?: "found" | "wrong_status" | "ambiguous" | "not_found" | "empty";
  order?: { id: string };
  /** The order's status when `wrong_status` — `returning` still belongs on Rentrer. */
  status?: string;
  matches?: number;
}

type Lookup =
  | { state: "looking"; code: string }
  | { state: "ambiguous"; code: string; matches: number }
  | { state: "unknown"; code: string };

const TONE: Record<ScanOutcome, { box: string; ink: string }> = {
  bound: { box: "border-[#BFE3CB] bg-[#F1F8F5]", ink: "text-[#008060]" },
  refused_here: { box: "border-[#F5C6BC] bg-[#FFF4F4]", ink: "text-[#D72C0D]" },
  refused_darb: { box: "border-[#F5C6BC] bg-[#FFF4F4]", ink: "text-[#D72C0D]" },
  bound_not_committed: { box: "border-[#EED9A8] bg-[#FFF8E6]", ink: "text-[#7A5B00]" },
  bind_unverified: { box: "border-[#EED9A8] bg-[#FFF8E6]", ink: "text-[#7A5B00]" },
};

export function DeskTopBar({ user }: { user: AuthUser }) {
  const initial = (user.full_name || user.email || "?").trim().charAt(0).toUpperCase();
  return (
    <div
      data-testid="wh-desk-topbar"
      className="sticky top-0 z-30 flex items-center gap-[14px] border-b border-[#ECEEF0] bg-white px-[24px] py-[12px]"
    >
      <DeskScanField />
      <Suspense fallback={null}>
        <BuildingSwitch />
      </Suspense>
      <span className="flex-1" />
      <span
        data-testid="wh-desk-avatar"
        aria-hidden="true"
        className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-[#F2F2F2] text-[14px] font-bold text-[#6D7175]"
      >
        {initial}
      </span>
    </div>
  );
}

function DeskScanField() {
  const t = useTranslations("warehouse.desk");
  const ts = useTranslations("warehouse.scan");
  const locale = useLocale();
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { hand, take, queue } = useDeskScan();
  const market = queue?.market ?? "ly";
  const isLy = market === "ly";
  const orders = queue?.orders ?? [];

  const [value, setValue] = useState("");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [view, setView] = useState<"scan" | "lookup" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onScanned = useCallback(() => {
    take(null);
    // The parcel left the bench: the queue, the scanned list and the page's
    // own counts all re-read.
    void mutate(
      (key) =>
        typeof key === "string" &&
        (key.startsWith("/api/warehouse/to-label") || key.startsWith("/api/warehouse/scanned")),
    );
    router.refresh();
  }, [take, mutate, router]);

  const { submit, busy, last, clear } = useScanOut({ market, hand, orders, onScanned });

  // A new parcel in hand: a clean field, focused, so the scanner types into it.
  const handId = hand?.id ?? null;
  useEffect(() => {
    if (!handId) return;
    clear();
    setLookup(null);
    setView(null);
    setValue("");
    inputRef.current?.focus();
  }, [handId, clear]);

  // The field is disabled while Darb answers, which drops the focus; the next
  // sticker must land in the field again without anyone clicking it.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) inputRef.current?.focus();
    wasBusy.current = busy;
  }, [busy]);

  const doLookup = useCallback(
    async (code: string) => {
      setView("lookup");
      setLookup({ state: "looking", code });
      try {
        const res = await fetch(`/api/warehouse/returns/lookup?code=${encodeURIComponent(code)}`);
        const body = (res.ok ? await res.json() : { outcome: "not_found" }) as LookupBody;
        if ((body.outcome === "found" || body.outcome === "wrong_status") && body.order?.id) {
          setLookup(null);
          setView(null);
          // A return is decided on Rentrer (Recevoir… / Relivrer), which opens
          // its verdict from `?order=`; a parcel still on the road shows there
          // greyed. Anything else is an order to look at.
          const isReturn = body.outcome === "found" || body.status === "returning";
          router.push(
            isReturn
              ? `/${locale}/warehouse/returns?order=${encodeURIComponent(body.order.id)}`
              : `/${locale}/orders/${body.order.id}`,
          );
          return;
        }
        setLookup(
          body.outcome === "ambiguous"
            ? { state: "ambiguous", code, matches: Number(body.matches ?? 0) }
            : { state: "unknown", code },
        );
      } catch {
        setLookup({ state: "unknown", code });
      }
    },
    [locale, router],
  );

  const act = useCallback(
    (raw: string) => {
      const code = raw.trim();
      setValue("");
      if (!code) return;
      // Tunisia's label QR is the order id: it resolves from the bench itself.
      const onBench = !isLy && orders.some((o) => o.id === code || o.id.startsWith(code));
      if (hand || onBench) {
        setLookup(null);
        setView("scan");
        void submit(code);
        return;
      }
      void doLookup(code);
    },
    [hand, isLy, orders, submit, doLookup],
  );

  const zone = hand ? zoneLabels(hand.zone, locale) : null;
  const city = hand ? hand.customer_city || hand.customer_name : "";
  const placeholder = !hand
    ? t("scanPh")
    : !isLy
      ? t("scanHandTn", { city })
      : zone?.colour
        ? t("scanHand", { colour: zone.colour, city })
        : t("scanHandNoRoll", { city });

  const dismiss = () => setView(null);

  return (
    <div className="relative min-w-0 max-w-[620px] flex-1">
      <label
        data-testid="wh-desk-scanfield"
        data-hand={hand ? "true" : "false"}
        className={`flex h-[42px] items-center gap-[10px] rounded-[10px] border-[1.5px] bg-white px-[12px] text-[#1A1A1A] ${
          hand
            ? "border-[var(--brand)] shadow-[0_0_0_3px_var(--brand-bg)]"
            : "border-[#C9CCCF] focus-within:border-[var(--brand)]"
        }`}
      >
        <ScanLine size={18} aria-hidden="true" className="shrink-0" />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              act(value);
            } else if (e.key === "Escape") {
              if (hand) take(null);
              setView(null);
            }
          }}
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
          aria-label={t("scanPh")}
          placeholder={placeholder}
          className="min-w-0 flex-1 border-0 bg-transparent text-[14px] outline-none placeholder:text-[#8C9196] disabled:cursor-wait"
        />
        <kbd className="shrink-0 rounded-[5px] border border-b-2 border-[#E1E3E5] px-[6px] py-[1px] font-mono text-[11px] leading-[1.5] text-[#6D7175]">
          ⏎
        </kbd>
      </label>

      {view === "scan" && (busy || last) ? (
        <ResultPanel onDismiss={dismiss} dismissLabel={t("dismiss")}>
          {busy ? (
            <p role="status" className="text-[13px] font-semibold text-[#1A1A1A]">
              {isLy ? ts("binding") : ts("bindingTn")}
            </p>
          ) : last ? (
            <ScanResult entry={last} t={t} ts={ts} />
          ) : null}
        </ResultPanel>
      ) : null}

      {view === "lookup" && lookup ? (
        <ResultPanel onDismiss={dismiss} dismissLabel={t("dismiss")}>
          {lookup.state === "looking" ? (
            <p role="status" className="text-[13px] font-semibold text-[#1A1A1A]">{t("looking")}</p>
          ) : (
            <div data-testid="wh-desk-lookup" data-outcome={lookup.state} className="flex min-w-0 flex-col gap-[2px]">
              <b dir="ltr" className="self-start font-mono text-[13px] tabular-nums text-[#1A1A1A]">{lookup.code}</b>
              {lookup.state === "ambiguous" ? (
                <p className="text-[13px] text-[#1A1A1A]">{t("lookupAmbiguous", { n: lookup.matches })}</p>
              ) : (
                <>
                  <p className="text-[13px] font-semibold text-[#1A1A1A]">{t("lookupUnknown")}</p>
                  <p className="text-[12.5px] text-[#6D7175]">{t("lookupUnknownHint")}</p>
                </>
              )}
            </div>
          )}
        </ResultPanel>
      ) : null}
    </div>
  );
}

function ResultPanel({
  children,
  onDismiss,
  dismissLabel,
}: {
  children: React.ReactNode;
  onDismiss: () => void;
  dismissLabel: string;
}) {
  return (
    <div
      aria-live="polite"
      className="absolute inset-x-0 top-[calc(100%+8px)] z-40 flex items-start gap-[10px] rounded-[10px] border border-[#E1E3E5] bg-white px-[14px] py-[12px] shadow-[0_8px_24px_rgba(16,24,40,.10)]"
    >
      <div className="min-w-0 flex-1">{children}</div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={dismissLabel}
        className="grid h-[24px] w-[24px] shrink-0 place-items-center rounded-[6px] text-[#6D7175] hover:bg-[#F7F7F7]"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** The last scan, in its four distinguishable outcomes. */
function ScanResult({
  entry,
  t,
  ts,
}: {
  entry: NonNullable<ReturnType<typeof useScanOut>["last"]>;
  t: Translate;
  ts: Translate;
}) {
  const tone = TONE[entry.outcome];
  const heading: Record<ScanOutcome, string> = {
    bound: ts("okBound"),
    refused_here: ts("errRefused"),
    refused_darb: ts("errCarrier"),
    bound_not_committed: ts("errBoundNotCommitted"),
    bind_unverified: ts("errBindUnverified"),
  };
  const committed = entry.outcome === "bound" || entry.outcome === "bind_unverified";
  const Icon = entry.outcome === "bound" ? Check : committed || entry.outcome === "bound_not_committed" ? TriangleAlert : X;
  return (
    <div
      data-testid="wh-desk-result"
      data-outcome={entry.outcome}
      className={`-mx-[6px] -my-[4px] rounded-[8px] border px-[10px] py-[8px] ${tone.box}`}
    >
      <div className={`flex items-center gap-[8px] text-[13px] font-semibold ${tone.ink}`}>
        <Icon size={15} aria-hidden="true" className="shrink-0" />
        <span>{heading[entry.outcome]}</span>
        <b dir="ltr" className="ms-auto font-mono text-[13px] tabular-nums text-[#1A1A1A]">{entry.code}</b>
      </div>
      <p className="mt-[2px] text-[12.5px] text-[#1A1A1A]">
        {committed ? (
          <span dir="ltr" className="tabular-nums" style={{ unicodeBidi: "isolate" }}>
            {t("stockMove", { from: entry.from ?? "—", to: entry.to ?? "—" })}
          </span>
        ) : (
          entry.message
        )}
      </p>
      {entry.outcome === "bound_not_committed" ? (
        <p className="mt-[2px] text-[12.5px] text-[#6D7175]">{t("notCommittedHint")}</p>
      ) : null}
      {entry.outcome === "bind_unverified" ? (
        <p className="mt-[2px] text-[12.5px] text-[#6D7175]">{t("unverifiedHint", { ref: entry.carrierRef ?? "—" })}</p>
      ) : null}
    </div>
  );
}

/**
 * Tous | Tripoli | Benghazi — the market's active buildings, written into
 * `?warehouse_id=` on the page in view (absent = every building). Every desk
 * Entrepôt page reads the building from there. One building, no switch.
 */
function BuildingSwitch() {
  const t = useTranslations("warehouse.desk");
  const { sites } = useWarehouseSites();
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  if (sites.length <= 1) return null;

  const current = params.get("warehouse_id");
  const go = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("warehouse_id", id);
    else next.delete("warehouse_id");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };
  const known = sites.some((s) => s.id === current);
  const options: Array<{ id: string | null; label: string; on: boolean }> = [
    { id: null, label: t("all"), on: !known },
    ...sites.map((s) => ({ id: s.id, label: s.name, on: s.id === current })),
  ];

  return (
    <div role="group" aria-label={t("sites")} className="inline-flex shrink-0 gap-[2px] rounded-[10px] bg-[#ECEDEF] p-[3px]">
      {options.map((o) => (
        <button
          key={o.id ?? "all"}
          type="button"
          aria-pressed={o.on}
          onClick={() => go(o.id)}
          className={`whitespace-nowrap rounded-[8px] px-[12px] py-[6px] text-[13px] font-semibold leading-[1.5] ${
            o.on ? "bg-white text-[#1A1A1A]" : "text-[#6D7175] hover:text-[#1A1A1A]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
