"use client";

import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/dashboard/Panel";

interface InvestorOption {
  id: string;
  legal_name: string | null;
  full_name: string;
  configured: boolean;
}

const ENTRY_TYPES = [
  { value: "correction", label: "Correction" },
  { value: "reserve_release", label: "Libération de réserve" },
  { value: "principal_return", label: "Retour de capital" },
];

/**
 * Compensating ledger entries.
 *
 * investor_ledger is append-only by trigger, so a mistake can only be answered
 * with another entry — there is no edit and no delete. That is exactly why this
 * form confirms before posting and why the note is mandatory: an unexplained
 * adjustment to someone's money is indistinguishable from theft when it is read
 * back a year later.
 *
 * The API enforces both rules too; this is the affordance, not the guard.
 */
export function AdminCorrectionsPanel() {
  const { data } = useSWR<{ data: InvestorOption[] }>("/api/admin/investments/investors");
  // A correction needs an investors row to hang off — an unconfigured user has
  // no profile and the RPC would reject it.
  const investors = (data?.data ?? []).filter((i) => i.configured);

  const [investorId, setInvestorId] = useState("");
  const [entryType, setEntryType] = useState("correction");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(
    null
  );

  function review() {
    setMessage(null);

    if (!investorId) {
      setMessage({ kind: "error", text: "Choisissez un investisseur" });
      return;
    }
    const value = Number(amount);
    if (!Number.isFinite(value) || value === 0) {
      setMessage({ kind: "error", text: "Le montant doit être différent de zéro" });
      return;
    }
    if (!note.trim()) {
      setMessage({
        kind: "error",
        text: "Un motif est obligatoire — une correction doit être explicable",
      });
      return;
    }

    setConfirming(true);
  }

  async function post() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/investments/corrections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          investor_id: investorId,
          entry_type: entryType,
          amount: Number(amount),
          note: note.trim(),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setMessage({ kind: "error", text: body.error ?? "Écriture impossible" });
        return;
      }

      setAmount("");
      setNote("");
      setConfirming(false);
      setMessage({ kind: "success", text: "Écriture enregistrée" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Corrections">
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-[12px]">
            <span className="block mb-1 text-ink-secondary">Investisseur</span>
            <select
              value={investorId}
              onChange={(e) => setInvestorId(e.target.value)}
              className="w-full rounded-[6px] border border-line bg-surface-card px-3 py-2 text-[14px] text-ink-primary"
            >
              <option value="">—</option>
              {investors.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.legal_name ?? i.full_name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-[12px]">
            <span className="block mb-1 text-ink-secondary">Type</span>
            <select
              value={entryType}
              onChange={(e) => setEntryType(e.target.value)}
              className="w-full rounded-[6px] border border-line bg-surface-card px-3 py-2 text-[14px] text-ink-primary"
            >
              {ENTRY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-[12px]">
            <span className="block mb-1 text-ink-secondary">Montant</span>
            <input
              type="number"
              step="0.001"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-[6px] border border-line bg-surface-card px-3 py-2 text-[14px] tabular-nums text-ink-primary"
            />
          </label>
        </div>

        <label className="text-[12px]">
          <span className="block mb-1 text-ink-secondary">Motif</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-[6px] border border-line bg-surface-card px-3 py-2 text-[14px] text-ink-primary"
          />
        </label>

        <p className="m-0 text-[11px] text-ink-secondary">
          Un montant négatif retire de l&apos;argent au solde de l&apos;investisseur, un montant
          positif en ajoute.
        </p>

        {!confirming ? (
          <div>
            <Button variant="primary" onClick={review}>
              Poster l&apos;écriture
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 rounded-[8px] border border-status-critical bg-status-criticalBg p-3">
            {/* The confirm step used to be a generic warning that never said
                WHAT was about to be posted, so it could only be agreed with,
                never checked. */}
            <p className="m-0 text-[12px] text-status-critical">
              <strong>
                {ENTRY_TYPES.find((t) => t.value === entryType)?.label ?? entryType}
              </strong>{" "}
              de <strong>{amount}</strong> sur le compte de{" "}
              <strong>
                {investors.find((i) => i.id === investorId)?.legal_name ??
                  investors.find((i) => i.id === investorId)?.full_name ??
                  "—"}
              </strong>
              {" — "}
              {note.trim()}
            </p>
            <p className="m-0 text-[12px] text-status-critical">
              Le grand livre est immuable : cette écriture est irréversible et ne pourra être
              corrigée que par une autre écriture.
            </p>
            <div className="flex gap-2">
              <Button variant="destructive" disabled={busy} onClick={() => void post()}>
                Confirmer
              </Button>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Annuler
              </Button>
            </div>
          </div>
        )}

        {message ? (
          <p
            role="alert"
            className={`m-0 text-[12px] ${
              message.kind === "error" ? "text-status-critical" : "text-status-success"
            }`}
          >
            {message.text}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
