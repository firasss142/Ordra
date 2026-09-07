"use client";

import { type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { MapPin, Truck } from "lucide-react";
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
 * Where this order is going, and what the carrier did with it.
 *
 * Those are two different questions with two different owners, and the tab
 * used to answer them in one undifferentiated column of five rows: a
 * dispatcher had to know, from memory, that address and city are theirs to
 * fix while carrier and tracking are written by the upload. They are now two
 * named groups, so that is settled before the first value is read.
 *
 * Three of those rows also rendered a bare `—`. §4.17 G calls that out: a dash
 * is indistinguishable from "not applicable". An empty field the dispatcher
 * can fill now says so and carries the dotted underline that marks every
 * click-to-edit value in the console; a value the carrier has simply not
 * written yet keeps the dash and says when it will arrive.
 *
 * A missing city is a blocker, so its fix sits on the same line as the
 * warning rather than flush against the far edge of the panel.
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

  const cityText = boundPair ? destinationLabel(boundPair) : city;

  const cityValue = cityText ? (
    <span className="truncate text-[13.5px] text-oms-ink-1" dir="auto">
      {cityText}
    </span>
  ) : (
    <span className="text-[13.5px] font-[650] text-oms-warn">{t("cityEmpty")}</span>
  );

  /** The city control, rendered as a link that sits beside the value. */
  const cityAction = isLibyaOrder ? (
    <DarbDestinationPicker
      destinations={darbDestinations}
      value={boundPair ? { city: boundPair.city, area: boundPair.area } : null}
      align="end"
      onSelect={(opt) => {
        if (opt.id != null) onCommitDarbDestination(opt.id);
      }}
      renderTrigger={({ open }) => (
        <button type="button" onClick={open} className={ACTION_LINK}>
          {cityActionLabel}
        </button>
      )}
    />
  ) : (
    <Combobox
      value=""
      options={[]}
      loadOptions={loadCities}
      onCommit={(id) => onCommitCity(id)}
      placeholder={cityActionLabel}
      displayMode
      readOnly={!canEdit}
      displayClassName={`${ACTION_LINK} text-end`}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <Group icon={<MapPin size={13} strokeWidth={2} aria-hidden />} label={t("groupDestination")}>
        <Row label={t("fieldAddress")}>
          <InlineField
            value={address ?? ""}
            onCommit={(v) => onCommitAddress(v)}
            displayMode
            readOnly={!canEdit}
            placeholder={t("addressEmpty")}
            displayClassName="text-[13.5px] text-oms-ink-1"
          />
        </Row>

        <Row label={t("fieldCity")} field="city">
          {/* Value and fix share one line: the blocker and its remedy must not
              sit at opposite edges of the panel. */}
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {cityValue}
            {canEdit && <span className="flex-shrink-0">{cityAction}</span>}
          </span>
        </Row>

        {(note || canEdit) && (
          <Row label={t("fieldNote")} align="start">
            <InlineField
              value={note ?? ""}
              onCommit={(v) => onCommitNote(v.trim() || null)}
              multiline
              displayMode
              readOnly={!canEdit}
              placeholder={t("fieldNotePlaceholder")}
              displayClassName="text-[13.5px] leading-relaxed text-oms-ink-2"
            />
          </Row>
        )}
      </Group>

      <Group icon={<Truck size={13} strokeWidth={2} aria-hidden />} label={t("groupCarrier")}>
        <Row label={t("factCarrier")}>
          {carrierName ? (
            <>
              <CarrierMark name={carrierName} size={21} />
              <span className="truncate text-[13.5px] text-oms-ink-1">{carrierName}</span>
            </>
          ) : (
            <Pending>{t("carrierPending")}</Pending>
          )}
        </Row>

        <Row label={t("fieldTracking")} testId="row-tracking">
          {trackingNumber ? (
            <span className="truncate text-[13.5px] tabular-nums text-oms-ink-1">
              {trackingNumber}
            </span>
          ) : (
            <Pending>{t("trackingPending")}</Pending>
          )}
        </Row>
      </Group>
    </div>
  );
}

/** The shared look of a text-link action inside a row. */
const ACTION_LINK =
  "rounded text-[12px] font-[650] text-oms-accent underline-offset-2 transition-colors duration-fast hover:underline";

/**
 * A value the system will write later — not a field anyone can fill. It keeps
 * the dash (so it never poses as a missing input) and says what it is waiting
 * for, which a bare dash cannot.
 */
function Pending({ children }: { children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span aria-hidden className="text-[13.5px] text-oms-ink-3">
        —
      </span>
      <span className="truncate text-[12px] text-oms-ink-3">{children}</span>
    </span>
  );
}

/**
 * A titled band of rows. §4.10 forbids a tinted background for section
 * identity inside a panel: identity comes from icon + label. The rows below
 * sit on the panel surface exactly as they did.
 */
function Group({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <section role="group" aria-label={label}>
      <h4 className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-oms-ink-3">
        <span className="text-oms-ink-3">{icon}</span>
        {label}
      </h4>
      <dl className="m-0 flex flex-col">{children}</dl>
    </section>
  );
}

function Row({
  label,
  children,
  field,
  testId,
  align = "center",
}: {
  label: string;
  /** Anchor so the blocker banner can scroll to and open this field. */
  field?: string;
  testId?: string;
  /** A multi-line value reads better with its label at the top. */
  align?: "center" | "start";
  children: ReactNode;
}) {
  return (
    <div
      data-field={field}
      data-testid={testId}
      className={`flex gap-3.5 border-b border-oms-border py-[11px] last:border-0 ${
        align === "start" ? "items-start" : "items-center"
      }`}
    >
      <dt
        className={`w-[92px] flex-shrink-0 text-[12px] leading-[1.4] text-oms-ink-3 ${
          align === "start" ? "pt-px" : ""
        }`}
      >
        {label}
      </dt>
      <dd className="m-0 flex min-w-0 flex-1 items-center gap-[7px] font-medium">{children}</dd>
    </div>
  );
}
