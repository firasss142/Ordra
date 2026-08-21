"use client";

import useSWR from "swr";
import { Badge } from "@/components/ui/Badge";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface SyncRun {
  id: string;
  source: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  trigger: string;
  error: string | null;
}

const STATUS_TONE: Record<string, "success" | "warning" | "critical" | "neutral" | "action"> = {
  succeeded: "success",
  completed: "success",
  running: "action",
  partial: "warning",
  failed: "critical",
  skipped_locked: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  succeeded: "Réussi",
  completed: "Réussi",
  running: "En cours",
  partial: "Partiel",
  failed: "Échec",
  skipped_locked: "Verrouillé",
};

function fmt(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale === "ar" ? "ar-LY" : "fr-TN", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function duration(started: string, finished: string | null): string {
  if (!finished) return "—";
  const ms = new Date(finished).getTime() - new Date(started).getTime();
  if (ms < 0) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

export function SyncRunsPanel({ locale }: { locale: string }) {
  const { data, isLoading } = useSWR<{ data: SyncRun[] }>("/api/admin/sync-runs", fetcher, {
    refreshInterval: 30_000,
  });
  const rows = data?.data ?? [];

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr>
              {["Heure", "Source", "Déclencheur", "Durée", "Résultat", "Détail"].map((h, i) => (
                <th key={i} className={`whitespace-nowrap border-b border-line px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-secondary ${i === 3 ? "text-end" : "text-start"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-secondary">Chargement…</td></tr>}
            {!isLoading && rows.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-ink-secondary">Aucune synchronisation sur la période.</td></tr>}
            {rows.map((r) => (
              <tr key={`${r.source}-${r.id}`} className={`border-b border-line-subtle hover:bg-surface-hover ${r.status === "failed" ? "shadow-[inset_3px_0_0_var(--critical)]" : ""}`}>
                <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{fmt(r.started_at, locale)}</td>
                <td className="px-4 py-2.5 font-medium text-ink-primary">{r.source}</td>
                <td className="px-4 py-2.5"><span className="rounded-pill bg-surface-sunken px-2 py-0.5 text-[12px] text-ink-secondary">{r.trigger}</span></td>
                <td className="whitespace-nowrap px-4 py-2.5 text-end tabular-nums text-ink-secondary">{duration(r.started_at, r.finished_at)}</td>
                <td className="px-4 py-2.5"><Badge tone={STATUS_TONE[r.status] ?? "neutral"} dot>{STATUS_LABEL[r.status] ?? r.status}</Badge></td>
                <td className="px-4 py-2.5 text-[12px] text-status-critical">{r.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-line-subtle bg-surface-sunken px-4 py-2.5 text-[12px] text-ink-secondary">
        Google Sheets · Meta Ads · Darb (sync + tarifs) réunis. pg_cron peut marquer « réussi » alors que l'appel HTTP a expiré — la vérité est dans <span className="font-mono">net._http_response</span>.
      </div>
    </div>
  );
}
