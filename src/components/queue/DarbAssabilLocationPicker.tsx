"use client";

import { Dispatch, SetStateAction, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  DARB_ASSABIL_AREAS,
  type DarbAssabilArea,
} from "@/lib/carriers/darb-assabil-areas";

export interface DarbAssabilSelection {
  city: string | null;
  area: string | null;
}

export interface DarbAssabilLocationPickerProps {
  value: DarbAssabilSelection;
  onChange: Dispatch<SetStateAction<DarbAssabilSelection>>;
}

/**
 * Searchable destination picker for Darb Assabil. The carrier resolves the
 * destination branch from (city, area), so the agent must pick one of the
 * vendor's known pairs (bundled in `darb-assabil-areas`). Single-area cities
 * show just the city name; Tripoli's sub-areas show "city — area".
 */
export function DarbAssabilLocationPicker({
  value,
  onChange,
}: DarbAssabilLocationPickerProps) {
  const t = useTranslations("dispatch.darbAssabil");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return DARB_ASSABIL_AREAS;
    return DARB_ASSABIL_AREAS.filter(
      (d) => d.city.includes(q) || d.area.includes(q)
    );
  }, [query]);

  function label(d: DarbAssabilArea): string {
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
