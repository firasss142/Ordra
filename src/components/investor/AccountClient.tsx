"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { AuthUser } from "@/types";

/**
 * Investor account page.
 *
 * Exists because the portal previously had no way to sign out at all. This
 * shell is explicitly built for a phone, which is frequently a shared or
 * family device — leaving a financial session open indefinitely for whoever
 * picks it up next is not acceptable.
 *
 * Deliberately NOT the staff /profile page: that lives in the (dashboard)
 * route group and renders the full internal sidebar.
 */
export function AccountClient({
  user,
  locale,
  legalName,
  marketName = null,
  currency = null,
  reservePct = null,
  payoutMethod = null,
}: {
  user: AuthUser;
  locale: string;
  legalName: string;
  marketName?: string | null;
  currency?: string | null;
  /** The cut withheld from every settlement — meaningless if never stated. */
  reservePct?: number | null;
  payoutMethod?: string | null;
}) {
  const t = useTranslations("investor.account");
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace(`/${locale}/login`);
      router.refresh();
    } catch {
      // Even if the call fails, send them to login — the session cookie is
      // cleared server-side and a stuck spinner is worse than a retry.
      router.replace(`/${locale}/login`);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="bg-surface-card border border-line-subtle rounded-card p-4 sm:p-5">
        <h2 className="m-0 mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
          {t("title")}
        </h2>
        <dl className="m-0 flex flex-col divide-y divide-line-subtle">
          <Row label={t("name")} value={legalName || user.full_name} />
          <Row label={t("account")} value={user.email} />
          {marketName ? (
            <Row
              label={t("market")}
              value={currency ? `${marketName} · ${currency}` : marketName}
            />
          ) : null}
          {/* The terms behind the numbers on the other three tabs. An investor
              who cannot find their own reserve rate has to ask someone. */}
          {reservePct !== null ? <Row label={t("reserve")} value={`${reservePct}%`} /> : null}
          {payoutMethod ? (
            <Row label={t("payout")} value={payoutLabel(t, payoutMethod)} />
          ) : null}
        </dl>
      </section>

      <section className="bg-surface-card border border-line-subtle rounded-card p-4 sm:p-5">
        <p className="m-0 mb-3 text-[12px] text-ink-secondary">{t("signOutHint")}</p>
        <Button variant="secondary" size="md" onClick={signOut} disabled={signingOut}>
          <span className="inline-flex items-center gap-2">
            <LogOut size={16} aria-hidden="true" />
            {t("signOut")}
          </span>
        </Button>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-[12px] text-ink-secondary">{label}</dt>
      <dd className="m-0 min-w-0 break-words text-end text-[14px] text-ink-primary">{value}</dd>
    </div>
  );
}

/**
 * payout_method is a DB enum. Falling back to the raw value keeps a future
 * option readable rather than blank, even before it has a translation.
 */
function payoutLabel(t: (key: string) => string, method: string): string {
  const known = ["bank_transfer", "cash", "wallet"];
  return known.includes(method) ? t(`payoutMethod.${method}`) : method;
}
