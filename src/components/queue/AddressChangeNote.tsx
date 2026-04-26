"use client";

import { useTranslations } from "next-intl";
import { normalizeIdentity } from "@/lib/customer-history/classify";

interface Props {
  currentAddress: string | null | undefined;
  lastKnownAddress: string | null | undefined;
}

const TRUNCATE_AT = 40;

export function AddressChangeNote({ currentAddress, lastKnownAddress }: Props) {
  const t = useTranslations("customerHistory");

  if (!currentAddress || !lastKnownAddress) return null;
  if (normalizeIdentity(currentAddress) === normalizeIdentity(lastKnownAddress)) return null;

  const previewed =
    lastKnownAddress.length > TRUNCATE_AT
      ? lastKnownAddress.slice(0, TRUNCATE_AT) + "…"
      : lastKnownAddress;

  return (
    <span
      className="text-[11px] text-ink-muted"
      title={lastKnownAddress}
    >
      {t("addressChange", { previous: previewed })}
    </span>
  );
}
