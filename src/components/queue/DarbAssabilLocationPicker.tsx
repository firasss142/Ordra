"use client";

import { Dispatch, SetStateAction, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  DARB_ASSABIL_CITIES,
  darbAreasFor,
} from "@/lib/carriers/darb-assabil-areas";

export interface DarbAssabilSelection {
  city: string | null;
  area: string | null;
}

interface CityAreaPair {
  city: string;
  area: string;
}

export interface DarbAssabilLocationPickerProps {
  value: DarbAssabilSelection;
  onChange: Dispatch<SetStateAction<DarbAssabilSelection>>;
  /**
   * When set, restrict the list to this city's areas. Used when the order's
   * city is a known multi-area Darb city so the agent picks the AREA within it,
   * not a different city. Omit to show every deliverable city/area combo.
   */
  restrictToCity?: string | null;
}

// Every deliverable city/area combo, flattened once at module load.
const ALL_PAIRS: CityAreaPair[] = Object.entries(DARB_ASSABIL_CITIES).flatMap(
  ([city, areas]) => areas.map((area) => ({ city, area }))
);

/**
 * Searchable destination picker for Darb Assabil. The carrier resolves the
 * branch from (city, area), so the agent picks a real deliverable pair. When
 * scoped to a city, only that city's areas are shown (agent picks the area);
 * otherwise the full city/area list is searchable.
 */
export function DarbAssabilLocationPicker({
  value,
  onChange,
  restrictToCity,
}: DarbAssabilLocationPickerProps) {
  const t = useTranslations("dispatch.darbAssabil");
  const [query, setQuery] = useState("");

  const scoped = useMemo<CityAreaPair[]>(() => {
    if (restrictToCity) {
      return darbAreasFor(restrictToCity).map((area) => ({
        city: restrictToCity,
        area,
      }));
    }
    return ALL_PAIRS;
  }, [restrictToCity]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return scoped;
    return scoped.filter((d) => d.city.includes(q) || d.area.includes(q));
  }, [query, scoped]);

  function label(d: CityAreaPair): string {
    return d.city === d.area ? d.city : `${d.city} — ${d.area}`;
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-ink-secondary">
          {t("searchDestination")}
        </label>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="mb-2 w-full rounded border border-line-subtle px-3 py-2 text-[13px] text-ink-primary outline-none focus:border-ink-primary"
          dir="auto"
        />
        <div className="max-h-36 overflow-y-auto rounded border border-line-subtle sm:max-h-48">
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-[13px] text-ink-secondary">
              {t("noResults")}
            </div>
          ) : (
            filtered.map((d) => {
              const selected = value.city === d.city && value.area === d.area;
              return (
                <button
                  key={`${d.city}|${d.area}`}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onChange({ city: d.city, area: d.area })}
                  className={[
                    "w-full border-b border-line-subtle px-3 py-2 text-start text-[13px] last:border-b-0",
                    selected
                      ? "bg-surface-hover font-medium text-ink-primary"
                      : "text-ink-primary hover:bg-surface-hover",
                  ].join(" ")}
                  dir="auto"
                >
                  {label(d)}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
