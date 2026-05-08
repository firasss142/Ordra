"use client";

import { useTranslations } from "next-intl";
import { Dispatch, SetStateAction, useMemo, useState } from "react";
import useSWR from "swr";

interface DexpressState {
  id: number;
  name: string;
}

export interface DexpressSelection {
  stateId: number | null;
  stateName: string;
}

export interface DexpressLocationPickerProps {
  value: DexpressSelection;
  onChange: Dispatch<SetStateAction<DexpressSelection>>;
}

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error("Failed to fetch");
    return r.json();
  });

export function DexpressLocationPicker({
  value,
  onChange,
}: DexpressLocationPickerProps) {
  const t = useTranslations("dispatch.shippingEyes");
  const [query, setQuery] = useState("");

  const { data: statesData, isLoading: statesLoading } = useSWR(
    "/api/dexpress/states",
    fetcher,
    { revalidateOnFocus: false }
  );

  const allStates: DexpressState[] = statesData?.states ?? [];

  const filteredStates = useMemo(() => {
    const q = query.trim();
    if (!q) return allStates;
    return allStates.filter((s) => s.name.includes(q));
  }, [allStates, query]);

  function handleStateSelect(state: DexpressState) {
    onChange({ stateId: state.id, stateName: state.name });
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-ink-secondary">
          {t("searchState")}
        </label>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="mb-2 w-full rounded border border-line-subtle px-3 py-2 text-[13px] text-ink-primary outline-none focus:border-ink-primary"
          dir="auto"
        />
        {statesLoading ? (
          <div className="py-2 text-[13px] text-ink-secondary">
            {t("loadingStates")}
          </div>
        ) : (
          <div className="max-h-48 overflow-y-auto rounded border border-line-subtle">
            {filteredStates.length === 0 ? (
              <div className="px-3 py-3 text-[13px] text-ink-secondary">
                {t("noResults")}
              </div>
            ) : (
              filteredStates.map((state) => (
                <button
                  key={state.id}
                  type="button"
                  onClick={() => handleStateSelect(state)}
                  className={[
                    "w-full border-b border-line-subtle px-3 py-2 text-start text-[13px] last:border-b-0",
                    value.stateId === state.id
                      ? "bg-surface-hover font-medium text-ink-primary"
                      : "text-ink-primary hover:bg-surface-hover",
                  ].join(" ")}
                  dir="auto"
                >
                  {state.name}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
