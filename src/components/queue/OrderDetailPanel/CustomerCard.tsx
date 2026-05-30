"use client";

import { useTranslations } from "next-intl";
import { MapPin, StickyNote } from "lucide-react";
import { InlineField } from "@/components/ui/InlineField";
import { type ComboboxOption } from "@/components/ui/Combobox";
import { SectionCard } from "./SectionCard";
import { CityPicker, type DexpressState } from "./CityPicker";

export interface CustomerCardProps {
  address: string | null;
  city: string | null;
  note: string | null;
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
 * Address + city + note section card. Renders as a single pure-white card —
 * no tinted backgrounds, identity comes from the `User` icon and the
 * "Client" label. The note is placed *inside* the customer card (rather than
 * as its own section) since they share semantic ownership and we want fewer
 * cards on screen.
 */
export function CustomerCard({
  address,
  city,
  note,
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

  return (
    <SectionCard title={t("client")} icon={MapPin}>
      <div className="flex flex-col">
        <FieldRow label={t("fieldAddress")}>
          <InlineField
            value={address ?? ""}
            onCommit={(v) => onCommitAddress(v)}
            displayMode
            readOnly={!canEdit}
            placeholder={canEdit ? "—" : ""}
            displayClassName="text-[13px]"
          />
        </FieldRow>
        <FieldRow label={t("fieldCity")}>
          <CityPicker
            city={city}
            canEdit={canEdit}
            isLibyaOrder={isLibyaOrder}
            dexpressStates={dexpressStates}
            loadCities={loadCities}
            onCommitCity={onCommitCity}
            onCommitDexpressState={onCommitDexpressState}
          />
        </FieldRow>

        {(note || canEdit) && (
          <FieldRow label={t("fieldNote")} icon={StickyNote}>
            <InlineField
              value={note ?? ""}
              onCommit={(v) => onCommitNote(v.trim() || null)}
              multiline
              displayMode
              readOnly={!canEdit}
              placeholder={canEdit ? t("fieldNotePlaceholder") : "—"}
              displayClassName="text-[13px] text-ink-secondary leading-relaxed"
            />
          </FieldRow>
        )}
      </div>
    </SectionCard>
  );
}

function FieldRow({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon?: typeof MapPin;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-4 py-2 border-b border-line-subtle last:border-0">
      <span className="w-[88px] flex-shrink-0 inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-muted leading-[1.4]">
        {Icon ? <Icon size={11} strokeWidth={2} aria-hidden="true" className="flex-shrink-0" /> : null}
        {label}
      </span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
