"use client";

import { useTranslations } from "next-intl";
import { Dispatch, SetStateAction } from "react";
import useSWR from "swr";

interface DexpressState {
  id: number;
  name: string;
}

interface DexpressPlace {
  id: number;
  name: string;
}

export interface DexpressSelection {
  stateId: number | null;
  stateName: string;
  placeId: number | null;
  womenDelivery: boolean;
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

  const { data: statesData, isLoading: statesLoading } = useSWR(
    "/api/dexpress/states",
    fetcher,
    { revalidateOnFocus: false }
  );

  const { data: placesData, isLoading: placesLoading } = useSWR(
    value.stateId != null ? `/api/dexpress/places/${value.stateId}` : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const allStates: DexpressState[] = statesData?.states ?? [];
  const allPlaces: DexpressPlace[] = placesData?.places ?? [];

  function handleStateSelect(state: DexpressState) {
    onChange((prev) => ({
      ...prev,
      stateId: state.id,
      stateName: state.name,
      placeId: null,
    }));
  }

  function handlePlaceSelect(placeId: number | null) {
    onChange((prev) => ({ ...prev, placeId }));
  }

  return (
    <div className="flex flex-col gap-4">
      {/* State picker */}
      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-ink-secondary">
          {t("searchState")}
        </label>
        {statesLoading ? (
          <div className="py-2 text-[13px] text-ink-secondary">{t("loadingStates")}</div>
        ) : (
          <div className="max-h-40 overflow-y-auto rounded border border-line-subtle">
            {allStates.map((state) => (
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
              >
                {state.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Place picker — optional, loads after state selected */}
      {value.stateId != null && (
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-ink-secondary">
            {t("searchPlace")} — {value.stateName}
          </label>
          {placesLoading ? (
            <div className="py-2 text-[13px] text-ink-secondary">{t("loadingPlaces")}</div>
          ) : (
            <div className="max-h-40 overflow-y-auto rounded border border-line-subtle">
              <button
                type="button"
                onClick={() => handlePlaceSelect(null)}
                className={[
                  "w-full border-b border-line-subtle px-3 py-2 text-start text-[13px]",
                  value.placeId == null
                    ? "bg-surface-hover font-medium text-ink-primary"
                    : "text-ink-secondary hover:bg-surface-hover",
                ].join(" ")}
              >
                {t("noPlace")}
              </button>
              {allPlaces.map((place) => (
                <button
                  key={place.id}
                  type="button"
                  onClick={() => handlePlaceSelect(place.id)}
                  className={[
                    "w-full border-b border-line-subtle px-3 py-2 text-start text-[13px] last:border-b-0",
                    value.placeId === place.id
                      ? "bg-surface-hover font-medium text-ink-primary"
                      : "text-ink-primary hover:bg-surface-hover",
                  ].join(" ")}
                >
                  {place.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Women delivery toggle */}
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={value.womenDelivery}
          onChange={(e) =>
            onChange((prev) => ({ ...prev, womenDelivery: e.target.checked }))
          }
          className="h-4 w-4 rounded border-line-subtle accent-ink-primary"
        />
        <span className="text-[13px] text-ink-primary">{t("womenDelivery")}</span>
      </label>
    </div>
  );
}
