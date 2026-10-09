"use client";

import { useEffect } from "react";
import { reportBrowserError } from "@/components/journal/ClientErrorReporter";

/**
 * The root layout itself crashed, so neither translations nor styles are
 * loaded. Kept bare and bilingual on purpose; the crash still reaches Journaux.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportBrowserError({ kind: "boundary", name: error.name, message: error.message, stack: error.stack, digest: error.digest });
  }, [error]);

  return (
    <html lang="fr">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#F6F6F7", color: "#111" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16, textAlign: "center" }}>
          <div>
            <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>Ordra a rencontré un problème</h1>
            <p dir="rtl" style={{ fontSize: 15, margin: "0 0 20px" }}>واجه أوردرا مشكلة</p>
            <button
              type="button"
              onClick={reset}
              style={{ height: 38, padding: "0 16px", borderRadius: 9, border: 0, background: "#15803D", color: "#fff", fontWeight: 600, cursor: "pointer" }}
            >
              Réessayer · إعادة المحاولة
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
