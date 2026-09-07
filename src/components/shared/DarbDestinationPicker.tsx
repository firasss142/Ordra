"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CornerUpLeft,
  History,
  MapPin,
  Search,
  X,
} from "lucide-react";
import {
  destinationLabel,
  findDestination,
  groupByCity,
  matchRange,
  searchDestinations,
  type DarbDestinationOption,
  type DestinationCityGroup,
} from "@/lib/carriers/darb-destination-search";
import { normalizeCityName } from "@/lib/storefronts/normalize-city";

export interface DestinationValue {
  city: string;
  area: string;
}

export interface DarbDestinationPickerProps {
  /** The catalogue to offer — from `useDarbDestinations()`. */
  destinations: DarbDestinationOption[];
  value: DestinationValue | null;
  onSelect: (option: DarbDestinationOption) => void;
  /** When given, the field shows a clear button that calls it. */
  onClear?: () => void;
  /**
   * Restrict to one city's zones (the order already names a multi-area city;
   * the agent only picks the zone). No city list, no back button.
   */
  scopeCity?: string | null;
  /**
   * `field` — a form control that opens the list on click (create form,
   * order detail). `inline` — always visible, for a step whose whole job is
   * this choice (the dispatch modal): cities and zones side by side.
   */
  variant?: "field" | "inline";
  placeholder?: string;
  /** Paint the field as invalid (form validation). */
  invalid?: boolean;
  /** Replace the default field trigger (e.g. a "Changer" text link). */
  renderTrigger?: (args: { open: () => void; expanded: boolean }) => ReactNode;
  /** Field variant: dropdown alignment when the trigger is narrower than the panel. */
  align?: "start" | "end";
  /** Optional id for the field trigger (label association). */
  id?: string;
}

type Row =
  | { kind: "heading"; key: string; city: string }
  | { kind: "city"; key: string; city: string; count: number }
  | { kind: "option"; key: string; option: DarbDestinationOption; centre: boolean };

type ActiveRow = Exclude<Row, { kind: "heading" }>;

const RECENTS_KEY = "oms:darb-destination-recents";
const RECENTS_MAX = 5;

function isCentre(o: DestinationValue): boolean {
  return normalizeCityName(o.area) === normalizeCityName(o.city);
}

function sameValue(a: DestinationValue, b: DestinationValue): boolean {
  return (
    normalizeCityName(a.city) === normalizeCityName(b.city) &&
    normalizeCityName(a.area) === normalizeCityName(b.area)
  );
}

function readRecents(): DestinationValue[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (v): v is DestinationValue =>
            typeof v === "object" &&
            v !== null &&
            typeof (v as DestinationValue).city === "string" &&
            typeof (v as DestinationValue).area === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function pushRecent(v: DestinationValue): DestinationValue[] {
  const next = [v, ...readRecents().filter((r) => !sameValue(r, v))].slice(0, RECENTS_MAX);
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* a viewer without storage simply gets no recents */
  }
  return next;
}

/** The text with the matched part wrapped in <mark>. */
function Highlight({ text, query }: { text: string; query: string }) {
  const range = query ? matchRange(text, query) : null;
  if (!range) return <>{text}</>;
  const [a, b] = range;
  return (
    <>
      {text.slice(0, a)}
      <mark className="rounded-[3px] bg-brand-bg px-[1px] font-semibold text-brand-hover">
        {text.slice(a, b)}
      </mark>
      {text.slice(b)}
    </>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-oms-border bg-oms-sunken px-1 py-px font-[inherit] text-[10.5px] text-oms-ink-2">
      {children}
    </kbd>
  );
}

const ROW_BASE =
  "group flex w-full items-center gap-2 rounded-md px-2.5 py-[7px] text-start text-[13px] leading-5 transition-colors duration-fast";

function rowTone(selected: boolean, hot: boolean): string {
  if (selected) return "bg-brand-bg text-brand-hover";
  if (hot) return "bg-oms-sunken text-oms-ink-1";
  return "text-oms-ink-1 hover:bg-oms-sunken";
}

/**
 * One control for choosing a Darb Assabil destination — the Libya city list.
 *
 * Browse two levels (cities, then a city's zones) so 26 rows are read, not
 * 300; or type and search everything at once with the intake's Arabic folding
 * (سوكنه finds سوكنة), the matched letters highlighted. The last five picks
 * come back as chips. Keyboard: arrows move, Enter picks, Backspace on an
 * empty query steps back, Escape closes — and is stopped there, so the dialog
 * behind the field does not close with it. Typing on the closed field opens
 * it with that text.
 */
export function DarbDestinationPicker({
  destinations,
  value,
  onSelect,
  onClear,
  scopeCity = null,
  variant = "field",
  placeholder,
  invalid = false,
  renderTrigger,
  align = "start",
  id,
}: DarbDestinationPickerProps) {
  const t = useTranslations("destinationPicker");
  const inline = variant === "inline";
  const [open, setOpen] = useState(inline);
  const [query, setQuery] = useState("");
  const [drillCity, setDrillCity] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(-1);
  const [recents, setRecents] = useState<DestinationValue[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const browseCity = scopeCity ?? drillCity;
  const q = query.trim();
  // Inline + unscoped + no query → cities and zones side by side.
  const twoPane = inline && !scopeCity && !q;

  // In the two-pane view the city list is always the full one; the drilled
  // city only decides what the zones pane shows.
  const groups = useMemo<DestinationCityGroup[]>(
    () => groupByCity(destinations, twoPane ? null : browseCity),
    [destinations, browseCity, twoPane],
  );
  const paneGroup = twoPane
    ? (groups.find((g) => normalizeCityName(g.city) === normalizeCityName(drillCity)) ?? null)
    : null;

  const rows = useMemo<Row[]>(() => {
    if (q) {
      // Inline: a query always searches every city, even with one open on
      // the side — typing is how you leave it.
      const searchScope = scopeCity ?? (inline ? null : drillCity);
      const hits = searchDestinations(destinations, q, searchScope);
      const out: Row[] = [];
      let lastCity: string | null = null;
      for (const o of hits) {
        if (!searchScope && o.city !== lastCity) {
          out.push({ kind: "heading", key: `h:${o.city}`, city: o.city });
          lastCity = o.city;
        }
        out.push({ kind: "option", key: `o:${o.city}|${o.area}`, option: o, centre: isCentre(o) });
      }
      return out;
    }
    if (twoPane) {
      // Keyboard walks the zones once a city is chosen, the cities before.
      const list = paneGroup ? paneGroup.areas : null;
      if (list) {
        return list.map((o) => ({
          kind: "option" as const,
          key: `o:${o.city}|${o.area}`,
          option: o,
          centre: isCentre(o),
        }));
      }
    } else if (browseCity) {
      return (groups[0]?.areas ?? []).map((o) => ({
        kind: "option" as const,
        key: `o:${o.city}|${o.area}`,
        option: o,
        centre: isCentre(o),
      }));
    }
    return groups.map((g) =>
      g.areas.length === 1
        ? { kind: "option" as const, key: `o:${g.city}|${g.areas[0].area}`, option: g.areas[0], centre: false }
        : { kind: "city" as const, key: `c:${g.city}`, city: g.city, count: g.areas.length },
    );
  }, [destinations, q, browseCity, scopeCity, drillCity, inline, groups, twoPane, paneGroup]);

  const active = useMemo(() => rows.filter((r): r is ActiveRow => r.kind !== "heading"), [rows]);
  const resultCount = q ? active.length : 0;

  // A new list means a new highlight. -1 = nothing yet; Enter then takes the first.
  useEffect(() => setHighlighted(-1), [rows]);

  useEffect(() => {
    if (open) setRecents(readRecents());
  }, [open]);

  const close = useCallback(() => {
    setQuery("");
    setDrillCity(null);
    setHighlighted(-1);
    if (!inline) setOpen(false);
  }, [inline]);

  useEffect(() => {
    if (!open || inline) return;
    const away = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open, inline, close]);

  // Stepping into or out of a city moves focus to the button that did it;
  // bring it back to the search box.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, drillCity]);

  useEffect(() => {
    if (highlighted < 0 || !wrapRef.current) return;
    const el = wrapRef.current.querySelector<HTMLElement>(`[data-index="${highlighted}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [highlighted]);

  function openPanel(seed = "") {
    setQuery(seed);
    setDrillCity(null);
    setHighlighted(-1);
    setOpen(true);
  }

  function pick(option: DarbDestinationOption) {
    setRecents(pushRecent({ city: option.city, area: option.area }));
    onSelect(option);
    if (inline) {
      setQuery("");
      setHighlighted(-1);
    } else {
      close();
    }
  }

  function enterCity(city: string) {
    setDrillCity(city);
    setQuery("");
  }

  function activate(row: ActiveRow) {
    if (row.kind === "city") enterCity(row.city);
    else pick(row.option);
  }

  function pickRecent(r: DestinationValue) {
    const option = findDestination(destinations, r.city, r.area);
    if (option) pick(option);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlighted((h) => (active.length === 0 ? -1 : Math.min(h + 1, active.length - 1)));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlighted((h) => Math.max(h - 1, 0));
        break;
      case "Enter": {
        e.preventDefault();
        const row = active[highlighted] ?? active[0];
        if (row) activate(row);
        break;
      }
      case "Backspace":
        if (!query && drillCity && !scopeCity) {
          e.preventDefault();
          setDrillCity(null);
        }
        break;
      case "Escape":
        // One key press, one dismissal — the dialog behind must not close too.
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
    }
  }

  // Typing on the closed field opens it with that character as the query.
  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (open || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.length === 1 && e.key !== " ") {
      e.preventDefault();
      openPanel(e.key);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      openPanel();
    }
  }

  const isSelected = (o: DestinationValue) => value != null && sameValue(o, value);
  const label = value ? destinationLabel(value) : null;

  // ---- rows ---------------------------------------------------------------

  function cityRow(city: string, count: number, index: number, current = false) {
    const hot = index === highlighted || current;
    return (
      <button
        key={`c:${city}`}
        type="button"
        role="option"
        aria-selected={current}
        // Plain text for assistive tech — the visual label carries <mark>.
        aria-label={`${city}, ${t("zones", { count })}`}
        data-index={index}
        onMouseEnter={() => setHighlighted(index)}
        onClick={() => enterCity(city)}
        className={`${ROW_BASE} ${rowTone(false, hot)}`}
        dir="auto"
      >
        <span className="min-w-0 flex-1 truncate">
          <Highlight text={city} query={q} />
        </span>
        <span className="flex-none rounded-full bg-oms-sunken px-1.5 text-[11px] tabular-nums text-oms-ink-2 group-hover:bg-oms-surface">
          {t("zones", { count })}
        </span>
        <ChevronRight
          size={14}
          strokeWidth={2}
          aria-hidden
          className="flex-none text-oms-ink-3 rtl:-scale-x-100"
        />
      </button>
    );
  }

  /** `showCity`: top-level browse — a single-zone city reads as the city. */
  function optionRow(option: DarbDestinationOption, centre: boolean, index: number, showCity: boolean) {
    const selected = isSelected(option);
    const hot = index === highlighted;
    return (
      <button
        key={`o:${option.city}|${option.area}`}
        type="button"
        role="option"
        aria-selected={selected}
        aria-label={showCity ? option.city : option.area}
        data-index={index}
        onMouseEnter={() => setHighlighted(index)}
        onClick={() => pick(option)}
        className={`${ROW_BASE} ${rowTone(selected, hot)}`}
        dir="auto"
      >
        <span className="min-w-0 flex-1 truncate">
          <Highlight text={showCity ? option.city : option.area} query={q} />
        </span>
        {centre && !showCity && (
          <span className="flex-none text-[11px] text-oms-ink-3">{t("cityCentre")}</span>
        )}
        {selected && (
          <Check size={14} strokeWidth={2.5} aria-hidden className="flex-none text-brand" />
        )}
      </button>
    );
  }

  function renderRows(list: Row[]) {
    let index = -1;
    return list.map((row) => {
      if (row.kind === "heading") {
        return (
          <div
            key={row.key}
            className="sticky top-0 z-[1] bg-oms-surface px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-oms-ink-3"
            dir="auto"
          >
            {row.city}
          </div>
        );
      }
      index += 1;
      return row.kind === "city"
        ? cityRow(row.city, row.count, index)
        : optionRow(row.option, row.centre, index, !browseCity && !q);
    });
  }

  const empty = (
    <div className="px-3 py-6 text-center">
      <p className="text-[13px] text-oms-ink-2">
        {destinations.length === 0 ? t("loading") : t("noResults")}
      </p>
      {destinations.length > 0 && (
        <p className="mt-1 text-[12px] text-oms-ink-3">{t("noResultsHint")}</p>
      )}
    </div>
  );

  const recentsRow =
    !q && !drillCity && !scopeCity && recents.length > 0 ? (
      <div
        role="group"
        aria-label={t("recents")}
        className="flex flex-wrap items-center gap-1.5 border-b border-oms-border px-2.5 py-2"
      >
        <History size={12} strokeWidth={2} aria-hidden className="me-0.5 flex-none text-oms-ink-3" />
        {recents.map((r) => (
          <button
            key={`${r.city}|${r.area}`}
            type="button"
            onClick={() => pickRecent(r)}
            className={`max-w-full truncate rounded-full border px-2.5 py-[3px] text-[12px] transition-colors duration-fast ${
              isSelected(r)
                ? "border-brand bg-brand-bg text-brand-hover"
                : "border-oms-border bg-oms-surface text-oms-ink-1 hover:border-oms-border-strong hover:bg-oms-sunken"
            }`}
            dir="auto"
          >
            {destinationLabel(r)}
          </button>
        ))}
      </div>
    ) : null;

  function zonesHeader(city: string, count: number) {
    return (
      <div className="flex items-baseline justify-between px-3 pb-1 pt-2.5">
        <h4 className="text-[13px] font-semibold text-oms-ink-1" dir="auto">
          {city}
        </h4>
        <span className="text-[11px] tabular-nums text-oms-ink-3">
          {count === 1 ? t("zoneOne") : t("zones", { count })}
        </span>
      </div>
    );
  }

  const footerLeft = q
    ? resultCount === 1
      ? t("resultOne")
      : t("results", { count: resultCount })
    : drillCity && !twoPane
      ? ""
      : `${groups.length} ${t("cities").toLowerCase()}`;

  const footer = (
    <div className="flex items-center justify-between gap-3 border-t border-oms-border px-3 py-1.5 text-[11px] text-oms-ink-3">
      <span className="tabular-nums">{footerLeft}</span>
      <span className="hidden items-center gap-2 sm:flex">
        <span className="flex items-center gap-1">
          <Kbd>↑↓</Kbd>
          {t("hintNavigate")}
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd>
          {t("hintPick")}
        </span>
        {!scopeCity && (
          <span className="flex items-center gap-1">
            <Kbd>⌫</Kbd>
            {t("hintBack")}
          </span>
        )}
        <span className="flex items-center gap-1">
          <Kbd>Esc</Kbd>
          {t("hintClose")}
        </span>
      </span>
    </div>
  );

  const showBack = Boolean(drillCity) && !scopeCity && !twoPane;
  const searchBar = (
    <div className="flex items-center gap-1.5 border-b border-oms-border px-2 py-1.5">
      {showBack ? (
        <button
          type="button"
          aria-label={t("allCities")}
          title={t("allCities")}
          onClick={() => {
            setDrillCity(null);
            setQuery("");
          }}
          className="flex h-7 flex-none items-center gap-1 rounded-md px-1.5 text-[12px] font-medium text-oms-ink-2 transition-colors duration-fast hover:bg-oms-sunken hover:text-oms-ink-1"
        >
          <CornerUpLeft size={13} strokeWidth={2} aria-hidden className="rtl:-scale-x-100" />
          <span className="hidden sm:inline">{t("allCities")}</span>
        </button>
      ) : (
        <Search size={14} strokeWidth={2} aria-hidden className="ms-1.5 flex-none text-oms-ink-3" />
      )}
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        // Focused on mount, not a frame later: the very next keystroke
        // must land here.
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={showBack ? (drillCity as string) : t("searchPlaceholder")}
        className="h-7 min-w-0 flex-1 bg-transparent text-[13px] text-oms-ink-1 outline-none placeholder:text-oms-ink-3"
        dir="auto"
      />
      {query && (
        <button
          type="button"
          aria-label={t("clear")}
          onClick={() => setQuery("")}
          className="flex h-6 w-6 flex-none items-center justify-center rounded text-oms-ink-3 hover:bg-oms-sunken hover:text-oms-ink-1"
        >
          <X size={13} strokeWidth={2} aria-hidden />
        </button>
      )}
    </div>
  );

  // ---- bodies -------------------------------------------------------------

  const singleList = (
    <>
      {showBack && zonesHeader(drillCity as string, active.length)}
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        className={`overflow-y-auto p-1 ${inline ? "max-h-[280px]" : "max-h-[320px]"}`}
      >
        {rows.length === 0 ? empty : renderRows(rows)}
      </div>
    </>
  );

  // Two-pane: cities on the start side, the chosen city's zones on the end
  // side. Zone rows index from 0 (they are `rows` for the keyboard); city rows
  // carry an offset so hover never collides with a zone index.
  const twoPaneBody = twoPane ? (
    <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div
        role="listbox"
        aria-label={t("cities")}
        className="max-h-[280px] overflow-y-auto border-e border-oms-border p-1"
      >
        {groups.length === 0
          ? empty
          : groups.map((g, i) =>
              g.areas.length === 1
                ? optionRow(g.areas[0], false, paneGroup ? 1000 + i : i, true)
                : cityRow(g.city, g.areas.length, paneGroup ? 1000 + i : i, paneGroup?.city === g.city),
            )}
      </div>
      {paneGroup ? (
        <div className="flex max-h-[280px] flex-col">
          {zonesHeader(paneGroup.city, paneGroup.areas.length)}
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={t("zonesHeading")}
            className="min-h-0 flex-1 overflow-y-auto p-1"
          >
            {paneGroup.areas.map((o, i) => optionRow(o, isCentre(o), i, false))}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center px-4 text-center">
          <p className="text-[12.5px] text-oms-ink-3">{t("pickCityFirst")}</p>
        </div>
      )}
    </div>
  ) : null;

  const panel = (
    <div
      className={
        inline
          ? "overflow-hidden rounded-card border border-oms-border bg-oms-surface"
          : `absolute top-[calc(100%+6px)] z-30 min-w-[300px] overflow-hidden rounded-card border border-oms-border bg-oms-surface shadow-floating animate-[menuDrop_140ms_cubic-bezier(0.16,1,0.3,1)] ${
              align === "end" ? "end-0" : "start-0"
            } w-full`
      }
    >
      {searchBar}
      {recentsRow}
      {twoPane ? twoPaneBody : singleList}
      {footer}
    </div>
  );

  // ---- variants -----------------------------------------------------------

  if (inline) {
    return (
      <div ref={wrapRef} className="flex flex-col gap-2">
        {panel}
        {label && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-card border border-brand bg-brand-bg px-3 py-2 text-[13px]"
            dir="auto"
          >
            <MapPin size={14} strokeWidth={2} aria-hidden className="flex-none text-brand" />
            <span className="text-oms-ink-2">{t("selected")}</span>
            <span className="font-semibold text-oms-ink-1">{label}</span>
            <Check size={14} strokeWidth={2.5} aria-hidden className="ms-auto flex-none text-brand" />
          </div>
        )}
      </div>
    );
  }

  const clearable = Boolean(onClear && value);

  return (
    <div ref={wrapRef} className="relative">
      {renderTrigger ? (
        renderTrigger({ open: () => openPanel(), expanded: open })
      ) : (
        <>
          <button
            id={id}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => (open ? close() : openPanel())}
            onKeyDown={onTriggerKeyDown}
            className={
              `flex h-10 w-full items-center gap-2 rounded-lg border ps-3 text-[13.5px] transition-colors duration-fast ${
                clearable ? "pe-16" : "pe-9"
              } ` +
              (open
                ? "border-brand bg-oms-surface ring-2 ring-brand/15"
                : invalid
                  ? "border-oms-bad bg-oms-surface"
                  : "border-oms-border bg-oms-surface hover:border-oms-border-strong")
            }
          >
            <MapPin
              size={15}
              strokeWidth={2}
              aria-hidden
              className={"flex-none " + (value ? "text-brand" : "text-oms-ink-3")}
            />
            {value ? (
              <span className="flex min-w-0 items-baseline gap-1.5 truncate" dir="auto">
                <span className="truncate font-medium text-oms-ink-1">{value.city}</span>
                {!isCentre(value) && (
                  <>
                    <span aria-hidden className="text-oms-ink-3">
                      ·
                    </span>
                    <span className="truncate text-oms-ink-2">{value.area}</span>
                  </>
                )}
              </span>
            ) : (
              <span className="min-w-0 truncate text-oms-ink-3" dir="auto">
                {placeholder ?? t("placeholder")}
              </span>
            )}
          </button>
          {clearable && (
            <button
              type="button"
              aria-label={t("clear")}
              onClick={onClear}
              className="absolute end-8 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-oms-ink-3 transition-colors duration-fast hover:bg-oms-sunken hover:text-oms-ink-1"
            >
              <X size={14} strokeWidth={2} aria-hidden />
            </button>
          )}
          <ChevronDown
            size={14}
            strokeWidth={2}
            aria-hidden
            className={`pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-oms-ink-3 transition-transform duration-fast ${
              open ? "rotate-180" : ""
            }`}
          />
        </>
      )}
      {open && panel}
    </div>
  );
}
