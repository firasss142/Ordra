"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";

export interface DexpressState {
  id: number;
  name: string;
}

export interface CityPickerProps {
  city: string | null;
  canEdit: boolean;
  /** Libya orders pick a Dexpress state; Tunisia orders pick a `cities` row. */
  isLibyaOrder: boolean;
  dexpressStates: DexpressState[];
  /** Async option loader for the Tunisia city picker. */
  loadCities: (query: string) => Promise<ComboboxOption[]>;
  onCommitCity: (cityId: string) => void;
  onCommitDexpressState: (stateId: number) => void;
  /**
   * When true (used inside the address alert form), the Libya picker opens
   * directly into its search list instead of the "change" affordance.
   */
  startOpen?: boolean;
}

/**
 * The market-aware city editor shared by `CustomerCard` and `AddressAlert`.
 * Tunisia → async `Combobox` against the `cities` table. Libya → a filtered
 * list of Dexpress states (the same one offered at dispatch time). Extracting
 * this keeps the Tunisia/Libya branching in exactly one place.
 */
export function CityPicker({
  city,
  canEdit,
  isLibyaOrder,
  dexpressStates,
  loadCities,
  onCommitCity,
  onCommitDexpressState,
  startOpen = false,
}: CityPickerProps) {
  const t = useTranslations("orders.detail");
  const [libyaPickerOpen, setLibyaPickerOpen] = useState(startOpen);
  const [libyaQuery, setLibyaQuery] = useState("");

  const filteredDexpressStates = useMemo(() => {
    const q = libyaQuery.trim();
    if (!q) return dexpressStates;
    return dexpressStates.filter((s) => s.name.includes(q));
  }, [dexpressStates, libyaQuery]);

  if (!isLibyaOrder) {
    return (
      <Combobox
        value={city ?? ""}
        options={[]}
        loadOptions={loadCities}
        onCommit={(id) => onCommitCity(id)}
        placeholder={t("pickCity")}
        displayMode
        readOnly={!canEdit}
        displayClassName="text-[13px]"
      />
    );
  }

  if (!canEdit) {
    return (
      <span className="text-[13px] text-ink-primary" dir="auto">
        {city ?? "—"}
      </span>
    );
  }

  if (!libyaPickerOpen) {
    return (
      <button
        type="button"
        onClick={() => {
          setLibyaQuery("");
          setLibyaPickerOpen(true);
        }}
        className="group flex items-center justify-between gap-2 w-full text-start cursor-text rounded-card -mx-1 px-1 py-0.5 hover:bg-surface-hover transition-colors duration-fast"
        aria-label={t("cityChange")}
      >
        <span className="truncate text-[13px] text-ink-primary" dir="auto">
          {city ?? "—"}
        </span>
        <span
          aria-hidden="true"
          className="flex-shrink-0 text-[12px] font-medium text-ink-secondary group-hover:text-ink-primary underline-offset-2 group-hover:underline"
        >
          {t("cityChange")}
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 w-full">
      <input
        type="text"
        value={libyaQuery}
        onChange={(e) => setLibyaQuery(e.target.value)}
        placeholder={t("citySearch")}
        className="w-full h-9 px-3 text-[13px] rounded-card border border-line-subtle bg-surface-card text-ink-primary placeholder:text-ink-muted focus:outline-none focus:border-ink-primary"
        dir="auto"
        autoFocus
      />
      <div className="max-h-40 overflow-y-auto rounded-card border border-line-subtle">
        {filteredDexpressStates.length === 0 ? (
          <div className="px-3 py-2 text-[12px] text-ink-secondary">
            {t("cityNoResults")}
          </div>
        ) : (
          filteredDexpressStates.map((state) => (
            <button
              key={state.id}
              type="button"
              onClick={() => {
                onCommitDexpressState(state.id);
                setLibyaPickerOpen(false);
              }}
              className="w-full border-b border-line-subtle px-3 py-2 text-start text-[13px] last:border-b-0 text-ink-primary hover:bg-surface-hover"
              dir="auto"
            >
              {state.name}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
