"use client";

import { type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { InlineField } from "@/components/ui/InlineField";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { CarrierMark } from "@/components/shared/CarrierMark";
import { DarbDestinationPicker } from "@/components/shared/DarbDestinationPicker";
import {
  destinationLabel,
  findDestinationById,
  type DarbDestinationOption,
} from "@/lib/carriers/darb-destination-search";

export interface CustomerCardProps {
  address: string | null;
  city: string | null;
  note: string | null;
  /** Resolved carrier name — `null` when none is assigned yet. */
  carrierName: string | null;
  trackingNumber: string | null;
  canEdit: boolean;
  isLibyaOrder: boolean;
  /** Libya: the Darb Assabil catalogue with ids (empty while it loads). */
  darbDestinations: DarbDestinationOption[];
  /** Libya: the pair this order is bound to, when it is. */
  darbDestinationId: number | null;
  /** Async option loader for the standard (Tunisia) city picker. */
  loadCities: (query: string) => Promise<ComboboxOption[]>;
  onCommitAddress: (v: string) => void;
  onCommitCity: (cityId: string) => void;
  onCommitDarbDestination: (destinationId: number) => void;
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
  darbDestinations,
  darbDestinationId,
  loadCities,
  onCommitAddress,
  onCommitCity,
  onCommitDarbDestination,
  onCommitNote,
}: CustomerCardProps) {
  const t = useTranslations("orders.detail");

  // Libya: a bound pair reads as "city — zone"; an unbound order shows the
  // free-text city it arrived with (and the picker asks for the zone).
  const boundPair = findDestinationById(darbDestinations, darbDestinationId);
  const hasCity = Boolean(city?.trim());
  // "Changer" is wrong when there is nothing there yet, and it is the missing
  // case that needs the louder invitation.
  const cityActionLabel = hasCity ? t("cityChange") : t("cityDefine");

  const cityValue = boundPair ? (
    <span className="truncate text-[13.5px] text-oms-ink-1" dir="auto">
      {destinationLabel(boundPair)}
    </span>
  ) : hasCity ? (
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
          ) : (
            <>
              {cityValue}
              <span className="ms-auto flex-shrink-0">
                <DarbDestinationPicker
                  destinations={darbDestinations}
                  value={boundPair ? { city: boundPair.city, area: boundPair.area } : null}
                  align="end"
                  onSelect={(opt) => {
                    if (opt.id != null) onCommitDarbDestination(opt.id);
                  }}
                  renderTrigger={({ open }) => (
                    <button
                      type="button"
                      onClick={open}
                      className="text-[12px] font-[650] text-oms-accent underline-offset-2 hover:underline"
                    >
                      {cityActionLabel}
                    </button>
                  )}
                />
              </span>
            </>
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
