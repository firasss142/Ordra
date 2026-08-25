"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogOut, MapPin, ShieldCheck } from "lucide-react";
import type { AuthUser } from "@/types";
import { WmCard, WmTitle } from "./primitives";

/**
 * Réglages — the screen that exists because the mockups have no header.
 *
 * Dropping the Topbar took away the agent's only route to their own identity
 * and, more importantly, to signing out. Everything it carried that an agent
 * can actually act on lands here; everything else (the market switcher, the
 * alerts bell) does not, because an agent cannot change their market and has
 * no alerts feed.
 *
 * There is deliberately no language switch: `middleware.ts` derives the locale
 * from the user's market on every request, so a switch would flip straight
 * back and read as a broken control.
 */
export function AgentSettings({
  user,
  marketName,
}: {
  user: AuthUser;
  marketName: string;
}) {
  const t = useTranslations("warehouse.settings");
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const logout = useCallback(async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Network failure still has to leave: staying here would show a session
      // that may already be dead.
    }
    router.replace(`/${user.locale}/login`);
  }, [signingOut, router, user.locale]);

  const initial = (user.full_name || user.email || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="px-4 py-5">
      <WmTitle>{t("title")}</WmTitle>

      <WmCard className="mt-4 p-4">
        <div className="flex items-center gap-3.5">
          <span
            data-testid="wm-avatar"
            className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full bg-wm-accent-soft text-[20px] font-bold text-wm-accent"
          >
            {user.avatar_url ? (
              // Raw <img>: the project configures no images.remotePatterns.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              initial
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[17px] font-bold text-wm-ink">
              <bdi>{user.full_name}</bdi>
            </p>
            <p className="truncate text-[13px] text-wm-ink-2">{user.email}</p>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-2.5 border-t border-wm-card-edge pt-3.5">
          <div className="flex items-center gap-2">
            <ShieldCheck size={15} className="shrink-0 text-wm-accent" aria-hidden="true" />
            <div className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-wm-ink-2">
                {t("role")}
              </dt>
              <dd className="truncate text-[13.5px] font-semibold text-wm-ink">
                {t("roleAgent")}
              </dd>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <MapPin size={15} className="shrink-0 text-wm-accent" aria-hidden="true" />
            <div className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-wm-ink-2">
                {t("market")}
              </dt>
              <dd className="truncate text-[13.5px] font-semibold text-wm-ink">{marketName}</dd>
            </div>
          </div>
        </dl>
      </WmCard>

      <WmCard className="mt-3 p-4">
        <button
          type="button"
          onClick={logout}
          disabled={signingOut}
          className="inline-flex min-h-[48px] w-full items-center justify-center gap-2.5 rounded-pill border border-wm-accent px-5 text-[14.5px] font-bold text-wm-accent transition-colors active:bg-wm-accent-soft disabled:opacity-50"
        >
          <LogOut size={18} aria-hidden="true" />
          {signingOut ? t("signingOut") : t("signOut")}
        </button>
        <p className="mt-2.5 text-center text-[12px] text-wm-ink-2">{t("signOutHint")}</p>
      </WmCard>
    </div>
  );
}
