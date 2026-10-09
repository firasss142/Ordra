"use client";

import { useEffect } from "react";

/**
 * Sends browser crashes to Journaux (plans/journal-detection-and-settings-v2.md §C).
 * Mounted once in the locale layout. Only errors thrown by our own scripts are
 * kept; the server drops the rest of the noise. At most 5 reports per page
 * load and each distinct crash once, so a render loop cannot flood the journal.
 */

interface Report {
  kind?: "error" | "unhandledrejection" | "boundary";
  name?: string;
  message?: string;
  stack?: string;
  digest?: string;
}

const MAX_PER_LOAD = 5;
const sent = new Set<string>();

export function reportBrowserError(report: Report): void {
  try {
    const key = `${report.name ?? ""}|${report.message ?? ""}`;
    if (sent.has(key) || sent.size >= MAX_PER_LOAD) return;
    sent.add(key);
    const page = typeof window === "undefined" ? "/" : window.location.pathname;
    void fetch("/api/journal/browser-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...report,
        message: report.message?.slice(0, 500),
        stack: report.stack?.slice(0, 2000),
        page,
      }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Reporting must never become a second crash.
  }
}

function fromUnknown(reason: unknown): Pick<Report, "name" | "message" | "stack"> {
  if (reason instanceof Error) return { name: reason.name, message: reason.message, stack: reason.stack };
  return { name: "Error", message: typeof reason === "string" ? reason : String(reason) };
}

export function ClientErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      if (e.filename && !e.filename.startsWith(window.location.origin)) return;
      const err = e.error instanceof Error ? e.error : null;
      reportBrowserError({ kind: "error", name: err?.name ?? "Error", message: e.message || err?.message, stack: err?.stack });
    };
    const onRejection = (e: Event) => {
      reportBrowserError({ kind: "unhandledrejection", ...fromUnknown((e as PromiseRejectionEvent).reason) });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
