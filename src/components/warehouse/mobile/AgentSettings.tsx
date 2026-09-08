"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Languages, LogOut, MapPin, ShieldCheck } from "lucide-react";
import type { AuthUser } from "@/types";
import { jsonFetcher } from "@/lib/fetchers";
import { readScannerPrefs, writeScannerPrefs, type ScannerPrefs } from "@/lib/warehouse/scanner-prefs";
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
  marketCode = null,
}: {
  user: AuthUser;
  /** The database name, shown only when the code cannot be translated. */
  marketName: string;
  marketCode?: "ly" | "tn" | null;
}) {
  const t = useTranslations("warehouse.settings");
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [prefs, setPrefs] = useState<ScannerPrefs>(() => readScannerPrefs());

  const { data: op } = useSWR<{ orders_scanned_today?: number }>("/api/warehouse/operator-stats", jsonFetcher);
  const { data: summary } = useSWR<{ day?: { returnsToday?: number } }>("/api/warehouse/summary", jsonFetcher);

  const toggle = useCallback((key: keyof ScannerPrefs) => {
    setPrefs((p) => {
      const next = { ...p, [key]: !p[key] };
      writeScannerPrefs(next);
      return next;
    });
  }, []);

  const marketLabel = marketCode === "ly" ? t("marketLy") : marketCode === "tn" ? t("marketTn") : marketName;

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
              <dd className="truncate text-[13.5px] font-semibold text-wm-ink">{marketLabel}</dd>
            </div>
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <Languages size={15} className="shrink-0 text-wm-accent" aria-hidden="true" />
            <div className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-wm-ink-2">
                {t("language")}
              </dt>
              {/* The locale follows the market (middleware.ts), so there is no
                  switch: a control that flips straight back reads as broken. */}
              <dd className="truncate text-[13.5px] font-semibold text-wm-ink">{t("languageFollowsMarket")}</dd>
            </div>
          </div>
        </dl>
      </WmCard>

      <p className="mb-2 mt-4 text-[13px] font-semibold text-wm-ink-2">{t("myDay")}</p>
      <WmCard className="p-4">
        <dl className="grid gap-2.5 text-[15px]">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-wm-ink-2">{t("scannedToday")}</dt>
            <dd data-testid="wh-my-scans" className="font-semibold tabular-nums text-wm-ink">{op?.orders_scanned_today ?? 0}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-wm-ink-2">{t("returnsToday")}</dt>
            <dd data-testid="wh-my-returns" className="font-semibold tabular-nums text-wm-ink">{summary?.day?.returnsToday ?? 0}</dd>
          </div>
        </dl>
      </WmCard>

      <p className="mb-2 mt-4 text-[13px] font-semibold text-wm-ink-2">{t("scanner")}</p>
      <WmCard className="p-4">
        <div className="grid gap-2.5">
          {(
            [
              ["sound", t("prefSound")],
              ["vibrate", t("prefVibrate")],
              ["cameraFirst", t("prefCameraFirst")],
            ] as Array<[keyof ScannerPrefs, string]>
          ).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <span id={`wh-pref-${key}`} className="text-[15px] text-wm-ink-2">{label}</span>
              <button
                type="button"
                role="switch"
                aria-checked={prefs[key]}
                aria-labelledby={`wh-pref-${key}`}
                onClick={() => toggle(key)}
                className={`relative h-7 w-[46px] shrink-0 rounded-pill transition-colors ${prefs[key] ? "bg-wm-accent" : "bg-wm-track"}`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white transition-[inset-inline-start] ${
                    prefs[key] ? "start-[21px]" : "start-[3px]"
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
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
