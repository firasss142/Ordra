"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { reportBrowserError } from "@/components/journal/ClientErrorReporter";

/**
 * A page crashed. Before 2026-10-06 the app had no error boundary: the user
 * saw Next's blank error and nobody else ever knew. Now the crash is reported
 * to Journaux (rule `browser_error`) and the user gets a calm way back.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errorScreen");

  useEffect(() => {
    reportBrowserError({ kind: "boundary", name: error.name, message: error.message, stack: error.stack, digest: error.digest });
  }, [error]);

  return (
    <main className="grid min-h-[70vh] place-items-center px-[16px]">
      <div className="w-full max-w-[440px] rounded-[14px] border border-line bg-white p-[28px] text-center">
        <span className="mx-auto mb-[16px] grid h-[44px] w-[44px] place-items-center rounded-full bg-[#FEF3F2] text-[#B42318]">
          <AlertTriangle className="h-[22px] w-[22px]" aria-hidden />
        </span>
        <h1 className="m-0 text-[18px] font-[650] text-ink-primary">{t("title")}</h1>
        <p className="mb-[22px] mt-[8px] text-[14px] leading-[1.55] text-ink-secondary">{t("body")}</p>
        <div className="flex flex-wrap justify-center gap-[10px]">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-[38px] items-center gap-[8px] rounded-[9px] bg-brand px-[16px] text-[14px] font-semibold text-white hover:opacity-90"
          >
            <RotateCcw className="h-[15px] w-[15px]" aria-hidden />
            {t("retry")}
          </button>
          <a
            href="/"
            className="inline-flex h-[38px] items-center rounded-[9px] border border-line px-[16px] text-[14px] font-medium text-ink-primary hover:bg-surface-sunken"
          >
            {t("home")}
          </a>
        </div>
      </div>
    </main>
  );
}
