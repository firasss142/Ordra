"use client";

import useSWR from "swr";
import { Badge } from "@/components/ui/Badge";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface AuditRow {
  id: string;
  kind: "settings" | "user";
  at: string;
  actor: string | null;
  summary: string;
  meta: Record<string, unknown>;
}

function fmt(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale === "ar" ? "ar-LY" : "fr-TN", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function AuditPanel({ locale }: { locale: string }) {
  const { data, isLoading } = useSWR<{ data: AuditRow[] }>("/api/admin/audit", fetcher, {
    refreshInterval: 60_000,
  });
  const rows = data?.data ?? [];

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr>
              {["Date", "Auteur", "Modification", "Type"].map((h, i) => (
                <th key={i} className="whitespace-nowrap border-b border-line px-4 py-2.5 text-start text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-secondary">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={4} className="px-4 py-8 text-center text-ink-secondary">Chargement…</td></tr>}
            {!isLoading && rows.length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-ink-secondary">Aucune modification enregistrée.</td></tr>}
            {rows.map((r) => (
              <tr key={`${r.kind}-${r.id}`} className="border-b border-line-subtle hover:bg-surface-hover">
                <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{fmt(r.at, locale)}</td>
                <td className="px-4 py-2.5 text-ink-primary">{r.actor ?? "—"}</td>
                <td className="px-4 py-2.5 font-mono text-[12.5px] text-ink-primary">{r.summary}</td>
                <td className="px-4 py-2.5"><Badge tone={r.kind === "settings" ? "action" : "neutral"} dot>{r.kind === "settings" ? "Réglage" : "Utilisateur"}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-line-subtle bg-surface-sunken px-4 py-2.5 text-[12px] text-ink-secondary">
        Modifications de réglages et actions sur les utilisateurs. Les événements de connexion (création, archivage, rotation de secret) rejoindront ce flux avec un <span className="font-mono">system_audit_log</span> dédié.
      </div>
    </div>
  );
}
