"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { MapPin, StickyNote } from "lucide-react";
import { InlineField } from "@/components/ui/InlineField";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { SectionCard } from "./SectionCard";

interface DexpressState {
  id: number;
  name: string;
}

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
  const [libyaPickerOpen, setLibyaPickerOpen] = useState(false);
  const [libyaQuery, setLibyaQuery] = useState("");

  const filteredDexpressStates = useMemo(() => {
    const q = libyaQuery.trim();
    if (!q) return dexpressStates;
    return dexpressStates.filter((s) => s.name.includes(q));
  }, [dexpressStates, libyaQuery]);

  // Holds address/city/note — titling this "client" put two sections headed
  // CLIENT one directly above the other.
  return (
    <SectionCard title={t("delivery")} icon={MapPin}>
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
          {isLibyaOrder ? (
            !canEdit ? (
              <span className="text-[13px] text-ink-primary" dir="auto">
                {city ?? "—"}
              </span>
            ) : !libyaPickerOpen ? (
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
            ) : (
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
            )
          ) : (
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
          )}
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
