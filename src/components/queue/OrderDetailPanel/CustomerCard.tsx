"use client";

import { useState, useMemo, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { InlineField } from "@/components/ui/InlineField";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { CarrierMark } from "@/components/shared/CarrierMark";

interface DexpressState {
  id: number;
  name: string;
}

export interface CustomerCardProps {
  address: string | null;
  city: string | null;
  note: string | null;
  /** Resolved carrier name — `null` when none is assigned yet. */
  carrierName: string | null;
  trackingNumber: string | null;
  canEdit: boolean;
  isLibyaOrder: boolean;
  dexpressStates: DexpressState[];
  /** Async option loader for the standard (Tunisia) city picker. */
  loadCities: (query: string) => Promise<ComboboxOption[]>;
  onCommitAddress: (v: string) => void;
  onCommitCity: (cityId: string) => void;
  onCommitDexpressState: (stateId: number) => void;
  onCommitNote: (v: string | null) => void;
}

/**
 * Where this order is going, as a plain label/value list.
 *
 * It used to be a bordered card inside a tab — two disclosures for one job,
 * and card chrome that only repeated the tab's own name. It also stopped at
 * address, city and note, so the carrier and the tracking number were nowhere
 * on the delivery screen despite the panel holding both.
 *
 * A missing city reads amber, not as a dash: it is the condition that blocks
 * the carrier upload, and a dash is indistinguishable from "not applicable".
 */
export function CustomerCard({
  address,
  city,
  note,
  carrierName,
  trackingNumber,
  canEdit,
  isLibyaOrder,
  dexpressStates,
  loadCities,
  onCommitAddress,
  onCommitCity,
  onCommitDexpressState,
  onCommitNote,
}: CustomerCardProps) {
  const t = useTranslations("orders.detail");
  const [libyaPickerOpen, setLibyaPickerOpen] = useState(false);
  const [libyaQuery, setLibyaQuery] = useState("");

  const filteredDexpressStates = useMemo(() => {
    const q = libyaQuery.trim();
    if (!q) return dexpressStates;
    return dexpressStates.filter((s) => s.name.includes(q));
  }, [dexpressStates, libyaQuery]);

  const hasCity = Boolean(city?.trim());
  // "Changer" is wrong when there is nothing there yet, and it is the missing
  // case that needs the louder invitation.
  const cityActionLabel = hasCity ? t("cityChange") : t("cityDefine");

  const cityValue = hasCity ? (
    <span className="truncate text-[13.5px] text-oms-ink-1" dir="auto">
      {city}
    </span>
  ) : (
    <span className="text-[13.5px] font-[650] text-oms-warn">{t("cityEmpty")}</span>
  );

  return (
    <dl className="m-0 flex flex-col">
      <Row label={t("fieldAddress")}>
        <InlineField
          value={address ?? ""}
          onCommit={(v) => onCommitAddress(v)}
          displayMode
          readOnly={!canEdit}
          placeholder={canEdit ? "—" : ""}
          displayClassName="text-[13.5px] text-oms-ink-1"
        />
      </Row>

      <Row label={t("fieldCity")} field="city">
        {isLibyaOrder ? (
          !canEdit ? (
            cityValue
          ) : !libyaPickerOpen ? (
            <>
              {cityValue}
              <button
                type="button"
                onClick={() => {
                  setLibyaQuery("");
                  setLibyaPickerOpen(true);
                }}
                className="ms-auto flex-shrink-0 text-[12px] font-[650] text-oms-accent underline-offset-2 hover:underline"
              >
                {cityActionLabel}
              </button>
            </>
          ) : (
            <div className="flex w-full flex-col gap-2">
              <input
                type="text"
                value={libyaQuery}
                onChange={(e) => setLibyaQuery(e.target.value)}
                placeholder={t("citySearch")}
                className="h-[34px] w-full rounded-[8px] border border-oms-border bg-oms-sunken px-3 text-[13px] text-oms-ink-1 placeholder:text-oms-ink-3 focus:border-oms-accent focus:outline-none"
                dir="auto"
                autoFocus
              />
              <div className="max-h-40 overflow-y-auto rounded-[10px] border border-oms-border">
                {filteredDexpressStates.length === 0 ? (
                  <div className="px-3 py-2 text-[12px] text-oms-ink-2">{t("cityNoResults")}</div>
                ) : (
                  filteredDexpressStates.map((state) => (
                    <button
                      key={state.id}
                      type="button"
                      onClick={() => {
                        onCommitDexpressState(state.id);
                        setLibyaPickerOpen(false);
                      }}
                      className="w-full border-b border-oms-border px-3 py-2 text-start text-[13px] text-oms-ink-1 last:border-b-0 hover:bg-oms-sunken"
                      dir="auto"
                    >
                      {state.name}
                    </button>
                  ))
                )}
              </div>
            </div>
          )
        ) : !hasCity && canEdit ? (
          // Tunisia rendered a bare combobox whose empty state looked like a
          // disabled field. State the problem, then offer the picker.
          <>
            {cityValue}
            <span className="ms-auto min-w-[132px] flex-shrink-0">
              <Combobox
                value=""
                options={[]}
                loadOptions={loadCities}
                onCommit={(id) => onCommitCity(id)}
                placeholder={cityActionLabel}
                displayMode
                readOnly={!canEdit}
                displayClassName="text-[12px] font-[650] text-oms-accent text-end"
              />
            </span>
          </>
        ) : (
          <Combobox
            value={city ?? ""}
            options={[]}
            loadOptions={loadCities}
            onCommit={(id) => onCommitCity(id)}
            placeholder={t("pickCity")}
            displayMode
            readOnly={!canEdit}
            displayClassName="text-[13.5px] text-oms-ink-1"
          />
        )}
      </Row>

      <Row label={t("factCarrier")}>
        {carrierName ? (
          <>
            <CarrierMark name={carrierName} size={21} />
            <span className="truncate text-[13.5px] text-oms-ink-1">{carrierName}</span>
          </>
        ) : (
          <span className="text-[13.5px] text-oms-ink-3">—</span>
        )}
      </Row>

      <Row label={t("fieldTracking")}>
        {trackingNumber ? (
          <span className="truncate text-[13.5px] tabular-nums text-oms-ink-1">
            {trackingNumber}
          </span>
        ) : (
          <span className="text-[13.5px] text-oms-ink-3">—</span>
        )}
      </Row>

      {(note || canEdit) && (
        <Row label={t("fieldNote")}>
          <InlineField
            value={note ?? ""}
            onCommit={(v) => onCommitNote(v.trim() || null)}
            multiline
            displayMode
            readOnly={!canEdit}
            placeholder={canEdit ? t("fieldNotePlaceholder") : "—"}
            displayClassName="text-[13.5px] leading-relaxed text-oms-ink-2"
          />
        </Row>
      )}
    </dl>
  );
}

function Row({
  label,
  children,
  field,
}: {
  label: string;
  /** Anchor so the blocker banner can scroll to and open this field. */
  field?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-field={field}
      className="flex items-center gap-3.5 border-b border-oms-border py-[11px] last:border-0"
    >
      <dt className="w-[92px] flex-shrink-0 text-[12px] leading-[1.4] text-oms-ink-3">{label}</dt>
      <dd className="m-0 flex min-w-0 flex-1 items-center gap-[7px] font-medium">{children}</dd>
    </div>
  );
}
