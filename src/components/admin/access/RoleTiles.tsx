"use client";

import { useTranslations } from "next-intl";
import type { RoleTab, RoleTile } from "@/lib/users/access-view";
import { AccessAvatar, Dot, ROLE_ICON, TONE } from "./parts";

/**
 * The role filter as entity cards (design-system §4.2, §4.23): each role wears
 * its hue — a top accent, a wash, gradient faces — with the count in its ink
 * and who is online. The chosen card takes a ring in its hue.
 */
export function RoleTiles({ tiles, selected, onSelect }: { tiles: RoleTile[]; selected: RoleTab; onSelect: (role: RoleTab) => void }) {
  const t = useTranslations("users.tiles");
  return (
    <div role="group" aria-label={t("label")} className="acx-roles">
      {tiles.map((tile) => {
        const Icon = ROLE_ICON[tile.role];
        const more = tile.count - tile.faces.length;
        return (
          <button key={tile.role} type="button" aria-pressed={tile.role === selected} onClick={() => onSelect(tile.role)} className={`${TONE[tile.role]} acx-role`}>
            <span className="acx-role-h">
              <span aria-hidden="true" className="acx-role-ic">
                <Icon size={17} strokeWidth={1.9} />
              </span>
              <span>{t(tile.role)}</span>
            </span>
            <span className="acx-role-f">
              <b>{tile.count}</b>
              <span aria-hidden="true" className="acx-stack">
                {tile.faces.map((u) => (
                  <AccessAvatar key={u.id} user={u} size="xs" />
                ))}
                {more > 0 && (
                  <span dir="ltr" className="acx-more">
                    +{more}
                  </span>
                )}
              </span>
            </span>
            <span className="acx-role-o">
              <Dot tone={tile.online ? "on" : "off"} size={7} />
              {tile.online ? t("online", { count: tile.online }) : t("nobodyOnline")}
            </span>
          </button>
        );
      })}
    </div>
  );
}
