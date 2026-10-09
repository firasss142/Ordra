"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowRight } from "lucide-react";
import type { UserWithStats } from "@/types";
import { AccessAvatar } from "./parts";

/**
 * A warehouse agent with no building sees nothing and can scan nothing
 * (CLAUDE.md). The page says so before anyone has to find the row — as the
 * calm problem line (§4.2): red icon, red count, the why, then one chip per
 * person that opens their file. Six at most until asked: a dozen red chips
 * is a wall, not a line.
 */
const FIRST = 6;

export function UnassignedBanner({ users, onAssign }: { users: UserWithStats[]; onAssign: (user: UserWithStats, opener: HTMLElement) => void }) {
  const t = useTranslations("users.banner");
  const [all, setAll] = useState(false);
  if (users.length === 0) return null;
  const shown = all ? users : users.slice(0, FIRST);
  const hidden = users.length - shown.length;
  return (
    <div role="alert" className="acx-alert">
      <span aria-hidden="true" className="acx-alert-ic">
        <AlertTriangle size={17} />
      </span>
      <div className="min-w-0">
        <b>{t("title", { count: users.length })}</b>
        <p>{t("body")}</p>
        <div className="acx-alert-who">
          {shown.map((u) => (
            <button key={u.id} type="button" onClick={(e) => onAssign(u, e.currentTarget)} className="acx-who">
              <AccessAvatar user={u} size="xs" />
              <bdi>{u.full_name}</bdi>
              <span className="acx-who-go">
                {t("assign")}
                <ArrowRight size={13} aria-hidden="true" className="rtl:-scale-x-100" />
              </span>
            </button>
          ))}
          {hidden > 0 && (
            <button type="button" aria-expanded={false} onClick={() => setAll(true)} className="acx-who more">
              {t("more", { count: hidden })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
