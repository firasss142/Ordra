"use client";

import { useTranslations } from "next-intl";
import { Inbox, User } from "lucide-react";

interface Props {
  owner: "me" | "none" | "other" | undefined;
  ownerName?: string | null;
  status?: string | null;
}

/**
 * Who holds an order the agent found in the market: « Chez Walid » or
 * « Non attribuée ». Nothing for the agent's own orders, and nothing on a
 * deleted one — its status already says all there is.
 *
 * Neutral on purpose (design-system: colour belongs to status). The one tint,
 * on « Non attribuée », marks the only case a manager can hand straight over.
 */
export function OwnerTag({ owner, ownerName, status }: Props) {
  const t = useTranslations("queue.search");
  if (!owner || owner === "me" || status === "deleted") return null;

  const none = owner === "none";
  const Icon = none ? Inbox : User;
  return (
    <span
      className={[
        "inline-flex h-[22px] max-w-[140px] items-center gap-1 whitespace-nowrap rounded-md border px-2 text-[12px] font-semibold",
        none
          ? "border-[#FCD9A8] bg-[#FFF7ED] text-[#9A3412]"
          : "border-agent-outline-variant bg-agent-surface text-agent-on-surface-variant",
      ].join(" ")}
    >
      <Icon size={12} strokeWidth={2} aria-hidden="true" className="shrink-0" />
      <span className="truncate">
        {none ? t("ownerNone") : ownerName ? t("ownerOther", { name: ownerName }) : t("ownerOtherUnknown")}
      </span>
    </span>
  );
}
