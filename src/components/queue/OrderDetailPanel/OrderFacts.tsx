"use client";

import { useTranslations } from "next-intl";
import { InlineField } from "@/components/ui/InlineField";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { DarbDestinationPicker } from "@/components/shared/DarbDestinationPicker";
import { Avatar, Ic, StoreTag, type StoreInfo } from "@/components/orders/commandes/ui";
import {
  destinationLabel,
  findDestinationById,
  type DarbDestinationOption,
} from "@/lib/carriers/darb-destination-search";

interface Props {
  total: number;
  currencyCode: string;
  itemCount: number;
  /** Delivery city as the order carries it. Blank renders the missing-city line. */
  city: string | null;
  address: string | null;
  note: string | null;
  /** `null` means genuinely unassigned. */
  agent: { id: string; name: string } | null;
  carrierName: string | null;
  /** The storefront the order came from; undefined while the list loads. */
  store: StoreInfo | null | undefined;
  canEdit: boolean;
  isLibyaOrder: boolean;
  /** Libya: the Darb Assabil catalogue with ids (empty while it loads). */
  darbDestinations: DarbDestinationOption[];
  /** Libya: the pair this order is bound to, when it is. */
  darbDestinationId: number | null;
  /** Async option loader for the Tunisia city picker. */
  loadCities: (query: string) => Promise<ComboboxOption[]>;
  onCommitAddress: (v: string) => void;
  onCommitCity: (cityId: string) => void;
  onCommitDarbDestination: (destinationId: number) => void;
  onCommitNote: (v: string | null) => void;
}

/**
 * The facts as label / value lines (prototypes/commandes-v4.html `.facts`):
 * Ville, Adresse, Note, Total, Agent, Transporteur, Boutique. The city, the
 * address and the note stay editable where they are read — a missing city is
 * the one fact that blocks the shipment, so its fix sits in its own line.
 */
export function OrderFacts({
  total,
  currencyCode,
  itemCount,
  city,
  address,
  note,
  agent,
  carrierName,
  store,
  canEdit,
  isLibyaOrder,
  darbDestinations,
  darbDestinationId,
  loadCities,
  onCommitAddress,
  onCommitCity,
  onCommitDarbDestination,
  onCommitNote,
}: Props) {
  const t = useTranslations("orders.detail");
  const tRow = useTranslations("commandes.row");

  const boundPair = findDestinationById(darbDestinations, darbDestinationId);
  const cityText = boundPair ? destinationLabel(boundPair) : city?.trim() ? city : null;
  const actionLabel = cityText ? t("cityChange") : t("factCityResolve");

  const cityAction = !canEdit ? null : isLibyaOrder ? (
    <DarbDestinationPicker
      destinations={darbDestinations}
      value={boundPair ? { city: boundPair.city, area: boundPair.area } : null}
      align="end"
      onSelect={(opt) => {
        if (opt.id != null) onCommitDarbDestination(opt.id);
      }}
      renderTrigger={({ open }) => (
        <button type="button" className="lnk" onClick={open}>
          {actionLabel}
        </button>
      )}
    />
  ) : (
    <Combobox
      value=""
      options={[]}
      loadOptions={loadCities}
      onCommit={(id) => onCommitCity(id)}
      placeholder={actionLabel}
      displayMode
      displayClassName="lnk !text-[12.5px] !text-[#15803D] !not-italic font-bold"
    />
  );

  return (
    <dl className="facts">
      <dt>{t("factCity")}</dt>
      <dd data-field="city">
        {cityText ? (
          <span dir="auto">{cityText}</span>
        ) : (
          <span className="miss">
            <Ic n="alert" />
            {t("factCityMissing")}
          </span>
        )}
        {cityAction}
      </dd>

      <dt>{t("factAddress")}</dt>
      <dd>
        {canEdit ? (
          <span className="odp-val" dir="auto">
            <InlineField
              value={address ?? ""}
              onCommit={(v) => onCommitAddress(v)}
              displayMode
              placeholder={t("addressEmpty")}
              displayClassName="!text-[13.5px] !text-[#0F1728]"
            />
          </span>
        ) : address ? (
          <span dir="auto">{address}</span>
        ) : (
          <span className="q">—</span>
        )}
      </dd>

      {(note || canEdit) && (
        <>
          <dt>{t("fieldNote")}</dt>
          <dd>
            <span className="odp-val odp-note" dir="auto">
              <InlineField
                value={note ?? ""}
                onCommit={(v) => onCommitNote(v.trim() || null)}
                multiline
                displayMode
                readOnly={!canEdit}
                placeholder={t("fieldNotePlaceholder")}
                displayClassName="!text-[13.5px] !text-[#475467]"
              />
            </span>
          </dd>
        </>
      )}

      <dt>{t("factTotal")}</dt>
      <dd>
        <span>
          {(Number(total) || 0).toFixed(2)} {currencyCode}
        </span>
        <span className="q">· {t("factItemsCount", { n: itemCount })}</span>
      </dd>

      <dt>{t("factAgent")}</dt>
      <dd>
        {agent ? (
          <span className="who">
            <Avatar id={agent.id} name={agent.name} />
            <span>{agent.name}</span>
          </span>
        ) : (
          <span className="q">{tRow("unassigned")}</span>
        )}
      </dd>

      <dt>{t("factCarrier")}</dt>
      <dd>{carrierName ? <span>{carrierName}</span> : <span className="q">{t("carrierNotSent")}</span>}</dd>

      <dt>{t("factStore")}</dt>
      <dd>
        <StoreTag s={store ?? undefined} withPlatform />
      </dd>
    </dl>
  );
}
