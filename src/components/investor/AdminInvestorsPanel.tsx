"use client";

import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { Panel, EmptyState } from "@/components/dashboard/Panel";
import { AdminInvestorDrawer } from "./AdminInvestorDrawer";

interface InvestorRow {
  id: string;
  email: string;
  full_name: string;
  market_id: string | null;
  is_active: boolean;
  configured: boolean;
  legal_name: string | null;
  payout_method: string | null;
  payout_details: unknown;
  reserve_pct: number | null;
  notes: string | null;
}

const PAYOUT_METHODS = [
  { value: "bank_transfer", label: "Virement bancaire" },
  { value: "cash", label: "Espèces" },
  { value: "wallet", label: "Portefeuille" },
];

interface Draft {
  legal_name: string;
  payout_method: string;
  reserve_pct: string;
  notes: string;
}

/**
 * Investor profiles — the commercial terms behind an investor login.
 *
 * The list starts from USERS with role='investor', not from the investors
 * table, so an account that has a login but no profile shows up as "Profil
 * incomplet" instead of being invisible. That state is reachable today: the
 * portal renders "Votre profil investisseur n'est pas encore configuré" for it,
 * and until now nothing could resolve it.
 *
 * Creating the LOGIN stays on the Users page, which already handles invitations
 * and market scoping for the investor role. Duplicating that here would mean
 * two auth paths to keep in step.
 */
export function AdminInvestorsPanel({
  markets,
  locale,
}: {
  markets: { id: string; code: string; name: string }[];
  locale: string;
}) {
  const { data, error, isLoading, mutate } = useSWR<{ data: InvestorRow[] }>(
    "/api/admin/investments/investors"
  );
  const rows = data?.data ?? [];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // The operator who authorises payouts could not see what anyone was owed.
  const [viewing, setViewing] = useState<InvestorRow | null>(null);

  const marketById = new Map(markets.map((m) => [m.id, m]));

  function open(row: InvestorRow) {
    setEditingId(row.id);
    setMessage(null);
    setDraft({
      legal_name: row.legal_name ?? "",
      payout_method: row.payout_method ?? "bank_transfer",
      reserve_pct: row.reserve_pct === null ? "10" : String(row.reserve_pct),
      notes: row.notes ?? "",
    });
  }

  async function save(row: InvestorRow) {
    if (!draft) return;
    setMessage(null);

    const legalName = draft.legal_name.trim();
    if (!legalName) {
      setMessage("La raison sociale est obligatoire");
      return;
    }

    // Mirrors the CHECK on investors.reserve_pct so a bad value is caught here
    // rather than coming back as a constraint violation.
    const pct = Number(draft.reserve_pct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      setMessage("La réserve doit être comprise entre 0 et 100");
      return;
    }

    setBusy(true);
    try {
      const creating = !row.configured;
      const res = await fetch(
        creating
          ? "/api/admin/investments/investors"
          : `/api/admin/investments/investors/${row.id}`,
        {
          method: creating ? "POST" : "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...(creating ? { user_id: row.id } : {}),
            legal_name: legalName,
            payout_method: draft.payout_method,
            reserve_pct: pct,
            notes: draft.notes.trim() || null,
          }),
        }
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setMessage(body.error ?? "Enregistrement impossible");
        return;
      }

      setEditingId(null);
      setDraft(null);
      await mutate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Investisseurs">
      {error ? (
        <div className="py-6 text-center">
          <p className="m-0 mb-3 text-[13px] text-ink-secondary">
            Impossible de charger les investisseurs
          </p>
          <Button variant="secondary" onClick={() => void mutate()}>
            Réessayer
          </Button>
        </div>
      ) : isLoading ? (
        // §4.12 forbids text-only "loading…" placeholders in panels.
        <div className="flex flex-col gap-2" role="status" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[56px] w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState label="Aucun investisseur — créez d'abord un utilisateur avec le rôle investisseur" />
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col divide-y divide-line-subtle">
          {rows.map((row) => {
            const market = row.market_id ? marketById.get(row.market_id) : null;
            const isEditing = editingId === row.id;

            return (
              <li key={row.id} className="flex flex-col gap-2 py-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="m-0 text-[14px] font-medium text-ink-primary">
                      {row.legal_name ?? row.full_name}
                    </p>
                    <p className="m-0 text-[12px] text-ink-secondary">
                      {row.email}
                      {market ? ` · ${market.name}` : ""}
                      {row.configured && row.reserve_pct !== null
                        ? ` · Réserve ${row.reserve_pct} %`
                        : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {row.configured ? null : <Badge tone="critical">Profil incomplet</Badge>}
                    {row.is_active ? null : <Badge tone="neutral">Désactivé</Badge>}
                    {row.configured && !isEditing ? (
                      <Button variant="ghost" onClick={() => setViewing(row)}>
                        Voir le compte
                      </Button>
                    ) : null}
                    {!isEditing ? (
                      <Button variant="secondary" onClick={() => open(row)}>
                        {row.configured ? "Modifier" : "Configurer"}
                      </Button>
                    ) : null}
                  </div>
                </div>

                {isEditing && draft ? (
                  <div className="flex flex-col gap-3 rounded-[8px] border border-line-subtle bg-surface-page p-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <label className="text-[12px]">
                        <span className="block mb-1 text-ink-secondary">Raison sociale</span>
                        <input
                          value={draft.legal_name}
                          onChange={(e) =>
                            setDraft({ ...draft, legal_name: e.target.value })
                          }
                          className="w-full rounded-[6px] border border-line bg-surface-card px-3 py-2 text-[14px] text-ink-primary"
                        />
                      </label>

                      <label className="text-[12px]">
                        <span className="block mb-1 text-ink-secondary">Mode de versement</span>
                        <select
                          value={draft.payout_method}
                          onChange={(e) =>
                            setDraft({ ...draft, payout_method: e.target.value })
                          }
                          className="w-full rounded-[6px] border border-line bg-surface-card px-3 py-2 text-[14px] text-ink-primary"
                        >
                          {PAYOUT_METHODS.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="text-[12px]">
                        <span className="block mb-1 text-ink-secondary">Réserve (%)</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={draft.reserve_pct}
                          onChange={(e) =>
                            setDraft({ ...draft, reserve_pct: e.target.value })
                          }
                          className="w-full rounded-[6px] border border-line bg-surface-card px-3 py-2 text-[14px] tabular-nums text-ink-primary"
                        />
                      </label>
                    </div>

                    <label className="text-[12px]">
                      <span className="block mb-1 text-ink-secondary">Notes</span>
                      <input
                        value={draft.notes}
                        onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                        className="w-full rounded-[6px] border border-line bg-surface-card px-3 py-2 text-[14px] text-ink-primary"
                      />
                    </label>

                    <p className="m-0 text-[11px] text-ink-secondary">
                      La réserve s&apos;applique aux clôtures futures uniquement — chaque relevé
                      fige la sienne au moment du règlement.
                    </p>

                    <div className="flex gap-2">
                      <Button variant="primary" disabled={busy} onClick={() => void save(row)}>
                        Enregistrer
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setEditingId(null);
                          setDraft(null);
                          setMessage(null);
                        }}
                      >
                        Annuler
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {message ? (
        <p role="alert" className="m-0 mt-3 text-[12px] text-status-critical">
          {message}
        </p>
      ) : null}

      <AdminInvestorDrawer
        investorId={viewing?.id ?? null}
        investorName={viewing?.legal_name ?? viewing?.full_name ?? ""}
        marketCode={(
          (viewing?.market_id ? marketById.get(viewing.market_id)?.code : null) ?? "tn"
        ).toUpperCase()}
        locale={locale}
        onClose={() => setViewing(null)}
      />
    </Panel>
  );
}
