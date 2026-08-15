"use client";

import { useState, useCallback } from "react";
import useSWR from "swr";
import {
  AlertTriangle,
  Check,
  Loader2,
  Plug,
  RefreshCw,
  Trash2,
  X,
  MinusCircle,
} from "lucide-react";

/**
 * Connect a Meta ad account to a market.
 *
 * The token is a System User credential with read access to an ad account's
 * whole spend history. It goes in once, encrypted at the API boundary, and is
 * never sent back to the browser — the row shows a mask and nothing else.
 *
 * The connection test is staged rather than a single tick because the four
 * failures need four different fixes, and one red cross sends the operator back
 * to Meta to redo all of them. In particular the timezone stage is a warning
 * that cannot be cleared later: Meta will not re-report history in a different
 * zone, so a mismatch found in October has already poisoned everything synced.
 */

export interface MetaAccount {
  id: string;
  market_id: string;
  ad_account_id: string;
  account_name: string | null;
  account_currency: string;
  account_timezone: string | null;
  graph_version: string;
  token_masked: string;
  is_active: boolean;
  last_synced_at: string | null;
  last_sync_error: string | null;
}

interface Market {
  id: string;
  name: string;
  code: string;
}

/**
 * Currencies `ad_spend.amount` is already denominated in, so no rate is needed.
 * Mirrors the check in syncAccount — if the two ever disagree, the sync fails
 * on a rate the UI said was unnecessary.
 */
const NATIVE_CURRENCIES = new Set(["LYD", "TND"]);

/**
 * The FX rate the sync refuses to run without.
 *
 * Rendered on the account card rather than on a settings page of its own,
 * because the only way to know a rate is needed is to look at the account's
 * billing currency — which is right here. It appears when that currency is not
 * the market's, and shouts when it is missing.
 */
function FxRateField({ account }: { account: MetaAccount }) {
  const { data, mutate } = useSWR<{ data: { rates: Record<string, number> } }>(
    `/api/meta/fx-rate?market_id=${account.market_id}`,
    fetcher,
    { revalidateOnFocus: false },
  );

  const stored = data?.data?.rates?.[account.account_currency];
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = draft !== "" ? draft : stored !== undefined ? String(stored) : "";
  const missing = stored === undefined;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/meta/fx-rate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          market_id: account.market_id,
          currency: account.account_currency,
          rate: Number(value),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.message ?? "Enregistrement impossible.");
        return;
      }
      setDraft("");
      mutate();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`rounded-[8px] border px-3 py-2.5 ${
        missing ? "border-ads-red-line bg-ads-red-bg" : "border-ads-line bg-surface-sunken"
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12.5px] font-semibold text-ads-ink-1">
          Taux {account.account_currency} → devise du marché
        </span>
        <span className="flex-1" />
        <input
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          inputMode="decimal"
          placeholder="4.85"
          aria-label={`Taux ${account.account_currency}`}
          className="w-[110px] border border-line rounded-[6px] px-2.5 py-1.5 text-[13px] bg-surface-card text-ads-ink-1 tabular-nums"
        />
        <button
          type="button"
          onClick={save}
          disabled={saving || value === "" || Number(value) <= 0 || String(stored) === value}
          className="rounded-[8px] px-3 py-1.5 text-[13px] font-semibold bg-ads-green-ink text-white hover:bg-brand-hover disabled:opacity-50"
        >
          Enregistrer
        </button>
      </div>
      <p className={`text-[11.5px] mt-1.5 ${missing ? "text-ads-red-ink" : "text-ads-ink-2"}`}>
        {missing
          ? `Requis — la synchronisation refuse de tourner sans ce taux, plutôt que d'enregistrer des ${account.account_currency} comme des dinars.`
          : "Figé sur chaque ligne au moment de la synchronisation : le modifier n'altère pas l'historique déjà importé."}
      </p>
      {error && (
        <p role="alert" className="text-[11.5px] text-ads-red-ink mt-1">
          {error}
        </p>
      )}
    </div>
  );
}

interface Stage {
  key: string;
  status: "ok" | "warning" | "failed" | "skipped";
  detail: string;
}

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
};

const STAGE_LABELS: Record<string, string> = {
  credentials: "Identifiants",
  account: "Compte publicitaire",
  insights: "Lecture des insights",
  timezone: "Fuseau horaire",
};

function StageIcon({ status }: { status: Stage["status"] }) {
  if (status === "ok") return <Check size={14} strokeWidth={2.4} className="text-ads-green-ink" />;
  if (status === "warning") return <AlertTriangle size={14} strokeWidth={2.2} className="text-ads-orange-ink" />;
  if (status === "failed") return <X size={14} strokeWidth={2.4} className="text-ads-red-ink" />;
  return <MinusCircle size={14} strokeWidth={2} className="text-ads-ink-3" />;
}

export function MetaAdsSection({ markets }: { markets: Market[] }) {
  const { data, mutate, isLoading } = useSWR<{ data: MetaAccount[] }>("/api/meta/accounts", fetcher, {
    revalidateOnFocus: false,
  });
  const accounts = data?.data ?? [];

  const [marketId, setMarketId] = useState(markets[0]?.id ?? "");
  const [adAccountId, setAdAccountId] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; stages: Stage[] }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/meta/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          market_id: marketId,
          ad_account_id: adAccountId,
          access_token: token,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(body?.message ?? "La connexion a échoué.");
        return;
      }
      // Cleared on success only. A rejected token stays in the field so the
      // operator can fix a typo instead of fetching it from Meta again — it is
      // shown once there and re-generating invalidates the old one.
      setAdAccountId("");
      setToken("");
      mutate();
    } catch {
      setSaveError("La connexion a échoué.");
    } finally {
      setSaving(false);
    }
  }, [marketId, adAccountId, token, mutate]);

  const runTest = useCallback(async (id: string) => {
    setTesting(id);
    try {
      const res = await fetch(`/api/meta/accounts/${id}/test`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (body?.data) setResults((r) => ({ ...r, [id]: body.data }));
    } finally {
      setTesting(null);
    }
  }, []);

  const disconnect = useCallback(
    async (id: string) => {
      setBusy(id);
      try {
        await fetch(`/api/meta/accounts/${id}`, { method: "DELETE" });
        mutate();
      } finally {
        setBusy(null);
      }
    },
    [mutate],
  );

  const toggleActive = useCallback(
    async (account: MetaAccount) => {
      setBusy(account.id);
      try {
        await fetch(`/api/meta/accounts/${account.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_active: !account.is_active }),
        });
        mutate();
      } finally {
        setBusy(null);
      }
    },
    [mutate],
  );

  const marketName = (id: string) => markets.find((m) => m.id === id)?.name ?? "—";
  const canSubmit = !!marketId && adAccountId.trim().length > 0 && token.trim().length > 0 && !saving;

  return (
    <div className="flex flex-col gap-4 max-w-[900px]">
      {/* Connected accounts */}
      <div className="bg-surface-card border border-ads-line rounded-card overflow-hidden">
        <div className="px-4 py-3 border-b border-ads-line">
          <h2 className="text-[15px] font-semibold text-ads-ink-1">Meta Ads</h2>
          <p className="text-[12px] text-ads-ink-2 mt-0.5">
            Les dépenses sont importées chaque heure, sur une fenêtre glissante de 7 jours.
          </p>
        </div>

        {isLoading ? (
          <p className="px-4 py-6 text-[13px] text-ads-ink-2">Chargement…</p>
        ) : accounts.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-ads-ink-2">
            Aucun compte publicitaire connecté. Ajoutez-en un ci-dessous.
          </p>
        ) : (
          <ul className="divide-y divide-ads-line">
            {accounts.map((a) => {
              const result = results[a.id];
              return (
                <li key={a.id} className="px-4 py-3.5 flex flex-col gap-3">
                  <div className="flex items-start gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13.5px] font-semibold text-ads-ink-1">
                          {a.account_name ?? `act_${a.ad_account_id}`}
                        </span>
                        <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded-pill bg-surface-selected text-ads-ink-2">
                          {marketName(a.market_id)}
                        </span>
                        {!a.is_active && (
                          <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded-pill bg-ads-orange-bg text-ads-orange-ink">
                            En pause
                          </span>
                        )}
                      </div>
                      <p className="text-[12px] text-ads-ink-2 mt-1 tabular-nums">
                        act_{a.ad_account_id} · {a.account_currency} · {a.account_timezone ?? "fuseau inconnu"} ·
                        jeton {a.token_masked}
                      </p>
                      {a.last_sync_error && (
                        <p className="text-[12px] text-ads-red-ink mt-1">{a.last_sync_error}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => runTest(a.id)}
                        disabled={testing === a.id}
                        className="inline-flex items-center gap-1.5 border border-ads-line-2 rounded-[8px] px-3 py-[7px] text-[13px] font-semibold bg-surface-card text-ads-ink-1 hover:border-line-strong hover:bg-surface-sunken transition-colors duration-fast disabled:opacity-60"
                      >
                        {testing === a.id ? (
                          <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                        ) : (
                          <RefreshCw size={14} strokeWidth={1.8} />
                        )}
                        Tester
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleActive(a)}
                        disabled={busy === a.id}
                        className="border border-ads-line-2 rounded-[8px] px-3 py-[7px] text-[13px] font-semibold bg-surface-card text-ads-ink-1 hover:border-line-strong hover:bg-surface-sunken transition-colors duration-fast disabled:opacity-60"
                      >
                        {a.is_active ? "Mettre en pause" : "Réactiver"}
                      </button>
                      <button
                        type="button"
                        onClick={() => disconnect(a.id)}
                        disabled={busy === a.id}
                        aria-label="Déconnecter"
                        className="border border-ads-line-2 rounded-[8px] p-2 text-ads-ink-2 bg-surface-card hover:text-ads-red-ink hover:border-ads-red-line transition-colors duration-fast disabled:opacity-60"
                      >
                        <Trash2 size={14} strokeWidth={1.8} />
                      </button>
                    </div>
                  </div>

                  {!NATIVE_CURRENCIES.has(a.account_currency) && <FxRateField account={a} />}

                  {result && (
                    <div className="rounded-[8px] border border-ads-line bg-surface-sunken px-3 py-2.5 flex flex-col gap-1.5">
                      {result.stages.map((s) => (
                        <div key={s.key} className="flex items-start gap-2 text-[12.5px]">
                          <span className="mt-px">
                            <StageIcon status={s.status} />
                          </span>
                          <span className="font-semibold text-ads-ink-1 min-w-[150px]">
                            {STAGE_LABELS[s.key] ?? s.key}
                          </span>
                          <span
                            className={
                              s.status === "failed"
                                ? "text-ads-red-ink"
                                : s.status === "warning"
                                  ? "text-ads-orange-ink"
                                  : "text-ads-ink-2"
                            }
                          >
                            {s.detail || "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Connect a new account */}
      <div className="bg-surface-card border border-ads-line rounded-card p-4 flex flex-col gap-3">
        <div>
          <h3 className="text-[14px] font-semibold text-ads-ink-1">Connecter un compte publicitaire</h3>
          <p className="text-[12px] text-ads-ink-2 mt-0.5 leading-relaxed">
            Jeton d&apos;utilisateur système (Business Settings → Users → System Users), portée{" "}
            <code className="text-[11.5px] bg-surface-selected px-1 py-0.5 rounded">ads_read</code>. Il est vérifié
            auprès de Meta avant d&apos;être enregistré, puis chiffré — il ne ressort jamais.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11.5px] font-semibold uppercase tracking-[0.05em] text-ads-ink-2">Marché</span>
            <select
              value={marketId}
              onChange={(e) => setMarketId(e.target.value)}
              className="border border-line rounded-[6px] px-2.5 py-2 text-[13px] bg-surface-card text-ads-ink-1"
            >
              {markets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11.5px] font-semibold uppercase tracking-[0.05em] text-ads-ink-2">
              ID du compte publicitaire
            </span>
            <input
              value={adAccountId}
              onChange={(e) => setAdAccountId(e.target.value)}
              placeholder="act_123456789 ou 123456789"
              className="border border-line rounded-[6px] px-2.5 py-2 text-[13px] bg-surface-card text-ads-ink-1 tabular-nums"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-semibold uppercase tracking-[0.05em] text-ads-ink-2">
            Jeton d&apos;accès
          </span>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="EAAG…"
            className="border border-line rounded-[6px] px-2.5 py-2 text-[13px] bg-surface-card text-ads-ink-1 font-mono"
          />
        </label>

        {saveError && (
          <p role="alert" className="text-[12.5px] text-ads-red-ink">
            {saveError}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={connect}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 rounded-[8px] px-3.5 py-2 text-[13px] font-semibold bg-ads-green-ink text-white hover:bg-brand-hover transition-colors duration-fast disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} strokeWidth={2} />}
            Connecter
          </button>
        </div>
      </div>
    </div>
  );
}
