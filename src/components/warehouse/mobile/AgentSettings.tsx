"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import type { AuthUser } from "@/types";
import { jsonFetcher } from "@/lib/fetchers";
import { readScannerPrefs, writeScannerPrefs, type ScannerPrefs } from "@/lib/warehouse/scanner-prefs";

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
  siteName = null,
  locale,
}: {
  user: AuthUser;
  /** The database name, shown only when the code cannot be translated. */
  marketName: string;
  marketCode?: "ly" | "tn" | null;
  /** The agent's building, in the market's language — under their name. */
  siteName?: string | null;
  /** The route's locale (the back link); falls back to the user's. */
  locale?: string;
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
  const role = user.role === "warehouse_agent" ? t("roleAgent") : t("roleManager");

  // Prototype R.settings, px for px (the root font is 14px, so no rem classes).
  return (
    <div className="px-[16px] pb-[24px] pt-[18px]">
      <header className="mb-[18px] flex items-center gap-[12px]">
        <Link
          href={`/${locale ?? user.locale}/warehouse`}
          aria-label={t("back")}
          className="grid h-[40px] w-[40px] shrink-0 place-items-center rounded-full border border-wm-card-edge bg-wm-card text-wm-ink"
        >
          <ArrowLeft size={18} className="rtl:-scale-x-100" aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-wm-ink-2">{`${role} · ${marketLabel}`}</p>
          <h1 className="text-[28px] font-bold leading-[1.2] tracking-[-0.02em] text-wm-ink">{t("title")}</h1>
        </div>
      </header>

      <div className="flex items-center gap-[12px] rounded-[16px] border border-line-subtle bg-wm-card p-[16px]">
        <span
          data-testid="wm-avatar"
          className="grid h-[48px] w-[48px] shrink-0 place-items-center overflow-hidden rounded-full border border-wm-card-edge bg-wm-card font-bold text-wm-ink-2"
        >
          {user.avatar_url ? (
            // Raw <img>: the project configures no images.remotePatterns.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            initial
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-wm-ink">
            <bdi>{user.full_name}</bdi>
          </p>
          {siteName ? <p className="truncate text-[12.5px] text-wm-ink-2">{siteName}</p> : null}
        </div>
      </div>

      <p className="mb-[8px] mt-[18px] text-[11.5px] font-semibold uppercase tracking-[0.05em] text-wm-ink-2 rtl:text-[12.5px] rtl:normal-case rtl:tracking-normal">
        {t("myDay")}
      </p>
      <div className="flex items-center gap-[12px] rounded-[16px] border border-line-subtle bg-wm-card p-[16px]">
        <div className="min-w-0 flex-1">
          <p data-testid="wh-my-scans" className="text-[26px] font-bold leading-[1.1] tracking-[-0.02em] tabular-nums text-wm-ink" dir="ltr">
            {op?.orders_scanned_today ?? 0}
          </p>
          <p className="text-[12.5px] text-wm-ink-2">{t("scannedToday")}</p>
        </div>
        <div className="min-w-0 flex-1">
          <p data-testid="wh-my-returns" className="text-[26px] font-bold leading-[1.1] tracking-[-0.02em] tabular-nums text-wm-ink" dir="ltr">
            {summary?.day?.returnsToday ?? 0}
          </p>
          <p className="text-[12.5px] text-wm-ink-2">{t("returnsToday")}</p>
        </div>
      </div>

      <div className="mt-[12px] overflow-hidden rounded-[16px] border border-line-subtle bg-wm-card">
        {(
          [
            ["sound", t("prefSound")],
            ["vibrate", t("prefVibrate")],
            ["cameraFirst", t("prefCameraFirst")],
          ] as Array<[keyof ScannerPrefs, string]>
        ).map(([key, label], i) => (
          <div
            key={key}
            className={`flex min-h-[56px] items-center gap-[12px] px-[16px] py-[14px] ${i > 0 ? "border-t border-line-subtle" : ""}`}
          >
            <span id={`wh-pref-${key}`} className="flex-1 font-semibold text-wm-ink">{label}</span>
            <button
              type="button"
              role="switch"
              aria-checked={prefs[key]}
              aria-labelledby={`wh-pref-${key}`}
              onClick={() => toggle(key)}
              className={`relative h-[26px] w-[44px] shrink-0 rounded-pill transition-colors ${prefs[key] ? "bg-brand" : "bg-wm-track"}`}
            >
              <span
                aria-hidden="true"
                className={`absolute top-[3px] h-[20px] w-[20px] rounded-full bg-white transition-[inset-inline-start] ${
                  prefs[key] ? "start-[21px]" : "start-[3px]"
                }`}
              />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={logout}
        disabled={signingOut}
        className="mt-[16px] inline-flex min-h-[48px] w-full items-center justify-center rounded-[12px] border border-wh-border-strong bg-wm-card px-[18px] text-[15px] font-bold text-status-critical disabled:opacity-50"
      >
        {signingOut ? t("signingOut") : t("signOut")}
      </button>
    </div>
  );
}
