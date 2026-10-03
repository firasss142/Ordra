"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowRight } from "lucide-react";
import type { UserWithStats } from "@/types";
import { AccessAvatar } from "./parts";

/**
 * A warehouse agent with no building sees nothing and can scan nothing
 * (CLAUDE.md). The page says so before anyone has to find the row.
 */
export function UnassignedBanner({ users, onAssign }: { users: UserWithStats[]; onAssign: (user: UserWithStats, opener: HTMLElement) => void }) {
  const t = useTranslations("users.banner");
  if (users.length === 0) return null;
  return (
    <div role="alert" className="flex items-start gap-[14px] rounded-[14px] border border-[#F5C9C4] border-s-[4px] border-s-[#C0362C] bg-white px-[16px] py-[14px]">
      <span aria-hidden="true" className="grid h-[32px] w-[32px] flex-none place-items-center rounded-[9px] bg-[#FDECEA] text-[#C0362C]">
        <AlertTriangle size={17} />
      </span>
      <div className="min-w-0">
        <b className="block text-[14.5px] font-semibold text-[#C0362C]">{t("title", { count: users.length })}</b>
        <p className="m-0 mt-[2px] text-[13px] leading-[1.5] text-[#4F555B]">{t("body")}</p>
        <div className="mt-[10px] flex flex-wrap gap-[8px]">
          {users.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={(e) => onAssign(u, e.currentTarget)}
              className="inline-flex h-[34px] max-w-full items-center gap-[8px] whitespace-nowrap rounded-full border border-[#E3E5E8] bg-[#F7F8F9] pe-[6px] ps-[5px] text-[13px] font-semibold text-[#15171A] hover:border-[#F5C9C4] hover:bg-white"
            >
              <AccessAvatar user={u} size="xs" />
              <bdi className="min-w-0 truncate">{u.full_name}</bdi>
              <span className="inline-flex h-[24px] flex-none items-center gap-[4px] rounded-full bg-[#C0362C] px-[9px] text-[12px] font-semibold text-white">
                {t("assign")}
                <ArrowRight size={13} aria-hidden="true" className="rtl:-scale-x-100" />
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
