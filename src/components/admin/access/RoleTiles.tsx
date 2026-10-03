"use client";

import { useTranslations } from "next-intl";
import type { RoleTab, RoleTile } from "@/lib/users/access-view";
import { AccessAvatar, Dot, ROLE_ICON, TONE } from "./parts";

/**
 * The role filter as tiles (§4.19 tinted icon holder): the count, the first
 * faces and who is online. The chosen tile takes its role's tint.
 */
export function RoleTiles({ tiles, selected, onSelect }: { tiles: RoleTile[]; selected: RoleTab; onSelect: (role: RoleTab) => void }) {
  const t = useTranslations("users.tiles");
  return (
    <div role="group" aria-label={t("label")} className="grid grid-cols-2 gap-[12px] md:grid-cols-[repeat(auto-fit,minmax(168px,1fr))]">
      {tiles.map((tile) => {
        const on = tile.role === selected;
        const Icon = ROLE_ICON[tile.role];
        const more = tile.count - tile.faces.length;
        return (
          <button
            key={tile.role}
            type="button"
            aria-pressed={on}
            onClick={() => onSelect(tile.role)}
            className={`${TONE[tile.role]} flex min-w-0 flex-col gap-[12px] rounded-[14px] border px-[16px] pb-[13px] pt-[14px] text-start transition-[border-color,background-color,box-shadow] duration-[120ms] ${
              on
                ? "border-tone bg-tone-bg shadow-[inset_0_0_0_1px_var(--tone)] [--stack-ring:var(--tone-bg)]"
                : "border-[#ECEEF0] bg-white hover:border-tone-edge [--stack-ring:#fff]"
            }`}
          >
            <span className={`flex min-w-0 items-center gap-[10px] text-[13px] font-semibold ${on ? "text-tone-ink" : "text-[#4F555B]"}`}>
              <span aria-hidden="true" className={`grid h-[32px] w-[32px] flex-none place-items-center rounded-[9px] text-tone ${on ? "bg-white" : "bg-tone-bg"}`}>
                <Icon size={17} strokeWidth={1.8} />
              </span>
              <span className="truncate">{t(tile.role)}</span>
            </span>
            <span className="flex items-center justify-between gap-[8px]">
              <b className="text-[28px] font-bold leading-none tracking-[-.025em] text-[#15171A] tabular-nums">{tile.count}</b>
              <span aria-hidden="true" className="inline-flex items-center">
                {tile.faces.map((u, i) => (
                  <span key={u.id} className={i === 0 ? "" : "-ms-[7px]"}>
                    <AccessAvatar user={u} size="xs" />
                  </span>
                ))}
                {more > 0 && (
                  <span dir="ltr" className="-ms-[5px] grid h-[24px] min-w-[28px] place-items-center rounded-full bg-[#F3F4F6] px-[6px] text-[10.5px] font-semibold text-[#4F555B] shadow-[0_0_0_2px_var(--stack-ring)] tabular-nums">
                    +{more}
                  </span>
                )}
              </span>
            </span>
            <span className="flex items-center gap-[6px] whitespace-nowrap text-[12px] text-[#656B72]">
              <Dot tone={tile.online ? "on" : "off"} size={7} />
              {tile.online ? t("online", { count: tile.online }) : t("nobodyOnline")}
            </span>
          </button>
        );
      })}
    </div>
  );
}
