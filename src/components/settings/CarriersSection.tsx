"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import useSWR from "swr";
import FocusTrap from "focus-trap-react";
import { canManageCarriers } from "@/lib/settings-permissions";
import type { Role } from "@/types";
import {
  CarrierHealthBadge,
  AdapterBadge,
  computeCarrierHealth,
  formatDeliveryRate,
  formatHours,
} from "./carriers/CarrierHealthBadge";
import { IntegrationGuidePanel } from "./carriers/IntegrationGuidePanel";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Carrier {
  id: string;
  market_id: string;
  name: string;
  code: string;
  api_endpoint: string;
  api_credentials: string;
  delivery_fee: number;
  return_fee: number;
  is_active: boolean;
}

interface AdapterDescriptor {
  code: string;
  label: string;
  description: string;
  defaultEndpoint?: string;
  credentialFields: Array<{
    key: string;
    label: string;
    placeholder?: string;
    secret: boolean;
  }>;
  markets?: string[];
}

interface CarriersSectionProps {
  role: Role;
  marketId: string;
  currency?: string;
}

interface PerfRow {
  carrier_id: string;
  delivered: number;
  returned: number;
  delivery_rate_30d: number | null;
  median_transit_hours: number | null;
  sample_size: number;
}

interface TestResult {
  reachable: boolean;
  status?: number;
  error?: string;
  adapter?: {
    code: string;
    known: boolean;
    dryRun?: { payloadPreview: Record<string, string> };
  };
}

const MASK = "••••••••";

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  color: "#374151",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  height: 36,
  padding: "0 12px",
  fontSize: 14,
  border: "1px solid #E1E3E5",
  borderRadius: "0.5rem",
  background: "white",
  outline: "none",
  boxSizing: "border-box",
};

const primaryButton: React.CSSProperties = {
  backgroundColor: "#1A1A1A",
  color: "white",
  border: "none",
  borderRadius: "0.5rem",
  padding: "8px 16px",
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};

const secondaryButton: React.CSSProperties = {
  backgroundColor: "white",
  color: "#1A1A1A",
  border: "1px solid #E1E3E5",
  borderRadius: "0.5rem",
  padding: "8px 16px",
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};

const textButton: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#2C6ECB",
  fontSize: 13,
  cursor: "pointer",
  padding: 0,
};

const CUSTOM_CODE = "__custom__";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function CarriersSection({
  role,
  marketId,
  currency = "TND",
}: CarriersSectionProps) {
  const { data, mutate } = useSWR<{ data: Carrier[] }>(
    marketId ? `/api/carriers?market_id=${marketId}` : null,
    fetcher
  );
  const { data: perfData } = useSWR<{ data: PerfRow[] }>(
    marketId ? `/api/carriers/performance?market_id=${marketId}` : null,
    fetcher,
    { refreshInterval: 60_000 }
  );
  const { data: adaptersData } = useSWR<{ data: AdapterDescriptor[] }>(
    marketId ? `/api/carriers/adapters?market_id=${marketId}` : null,
    fetcher
  );

  const carriers = data?.data ?? [];
  const adapters = adaptersData?.data ?? [];

  const perfMap = useMemo(() => {
    const m = new Map<string, PerfRow>();
    for (const p of perfData?.data ?? []) m.set(p.carrier_id, p);
    return m;
  }, [perfData]);

  const [panelOpen, setPanelOpen] = useState(false);
  const [editCarrier, setEditCarrier] = useState<Carrier | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  const [onboardingOpen, setOnboardingOpen] = useState(false);

  // form
  const [form, setForm] = useState({
    adapter_code: "" as string,
    name: "",
    code: "",
    api_endpoint: "",
    api_key: "",
    delivery_fee: "",
    return_fee: "",
    rotatingKey: false,
  });

  const canManage = canManageCarriers(role);

  const httpError = useCallback((status: number): string => {
    if (status === 401) return "Session expirée — veuillez vous reconnecter";
    if (status === 403) return "Action non autorisée";
    if (status === 409) return "Conflit — rechargez la page";
    return "Erreur";
  }, []);

  function openAdd() {
    setEditCarrier(null);
    setForm({
      adapter_code: adapters[0]?.code ?? CUSTOM_CODE,
      name: "",
      code: "",
      api_endpoint: adapters[0]?.defaultEndpoint ?? "",
      api_key: "",
      delivery_fee: "",
      return_fee: "",
      rotatingKey: false,
    });
    setErrorMsg("");
    setPanelOpen(true);
  }

  function openEdit(c: Carrier) {
    setEditCarrier(c);
    setForm({
      adapter_code: c.code && adapters.some((a) => a.code === c.code) ? c.code : CUSTOM_CODE,
      name: c.name,
      code: c.code,
      api_endpoint: c.api_endpoint,
      api_key: MASK,
      delivery_fee: String(c.delivery_fee),
      return_fee: String(c.return_fee),
      rotatingKey: false,
    });
    setErrorMsg("");
    setPanelOpen(true);
  }

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setEditCarrier(null);
  }, []);

  useEffect(() => {
    if (!panelOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [panelOpen, closePanel]);

  async function handleToggleActive(c: Carrier) {
    await mutate(
      (prev) => ({
        data: (prev?.data ?? []).map((x) =>
          x.id === c.id ? { ...x, is_active: !c.is_active } : x
        ),
      }),
      false
    );
    await fetch(`/api/carriers/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !c.is_active }),
    });
    mutate();
  }

  async function handleTest(c: Carrier, mode: "reachability" | "dry_run") {
    setTestingId(c.id);
    try {
      const res = await fetch(
        `/api/carriers/${c.id}/test?mode=${mode}`,
        { method: "POST" }
      );
      const body = (await res.json().catch(() => ({}))) as TestResult;
      setTestResults((r) => ({ ...r, [c.id]: body }));
    } finally {
      setTestingId(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrorMsg("");
    try {
      const finalCode =
        form.adapter_code === CUSTOM_CODE
          ? (form.code || slugify(form.name))
          : form.adapter_code;

      if (editCarrier) {
        const body: Record<string, unknown> = {
          name: form.name,
          delivery_fee: parseFloat(form.delivery_fee) || 0,
          return_fee: parseFloat(form.return_fee) || 0,
        };
        if (form.rotatingKey && form.api_key !== MASK && form.api_key.length > 0) {
          body.api_key = form.api_key;
        }
        const res = await fetch(`/api/carriers/${editCarrier.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          setErrorMsg((b as { error?: string }).error ?? httpError(res.status));
          return;
        }
      } else {
        const res = await fetch("/api/carriers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            market_id: marketId,
            name: form.name,
            code: finalCode,
            api_endpoint: form.api_endpoint,
            api_key: form.api_key,
            delivery_fee: parseFloat(form.delivery_fee) || 0,
            return_fee: parseFloat(form.return_fee) || 0,
          }),
        });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          setErrorMsg((b as { error?: string }).error ?? httpError(res.status));
          return;
        }
      }
      mutate();
      closePanel();
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) return null;

  const selectedDescriptor = adapters.find((a) => a.code === form.adapter_code);

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A", margin: 0 }}>
          Transporteurs
        </h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() => setOnboardingOpen(true)}
            style={secondaryButton}
          >
            Guide d&apos;intégration
          </button>
          <button type="button" onClick={openAdd} style={primaryButton}>
            Ajouter
          </button>
        </div>
      </div>

      {carriers.length === 0 ? (
        <div
          style={{
            border: "1px dashed #C9CCCF",
            borderRadius: "0.5rem",
            padding: 32,
            textAlign: "center",
            color: "#6D7175",
            background: "white",
          }}
        >
          <p style={{ margin: "0 0 12px 0", fontSize: 14 }}>
            Aucun transporteur configuré pour ce marché.
          </p>
          <button type="button" onClick={openAdd} style={primaryButton}>
            Configurer un transporteur
          </button>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(min(340px, 100%), 1fr))",
            gap: 16,
          }}
        >
          {carriers.map((c) => {
            const perf = perfMap.get(c.id) ?? null;
            const test = testResults[c.id] ?? null;
            const health = computeCarrierHealth({
              is_active: c.is_active,
              reachable: test ? test.reachable : null,
              delivery_rate_30d: perf?.delivery_rate_30d ?? null,
              sample_size: perf?.sample_size ?? 0,
            });
            const adapterKnown = adapters.some((a) => a.code === c.code);

            return (
              <div
                key={c.id}
                data-testid={`carrier-card-${c.id}`}
                style={{
                  border: "1px solid #E1E3E5",
                  borderRadius: "0.5rem",
                  background: "white",
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 8,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 4,
                      }}
                    >
                      <h3
                        style={{
                          margin: 0,
                          fontSize: 15,
                          fontWeight: 600,
                          color: "#1A1A1A",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c.name}
                      </h3>
                      <AdapterBadge code={c.code} known={adapterKnown} />
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "#6D7175",
                        fontFamily: "monospace",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.api_endpoint || "—"}
                    </div>
                  </div>
                  <CarrierHealthBadge state={health} />
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 8,
                    padding: "8px 0",
                    borderTop: "1px solid #F1F2F3",
                    borderBottom: "1px solid #F1F2F3",
                  }}
                >
                  <Stat
                    label="Livraison 30j"
                    value={formatDeliveryRate(perf?.delivery_rate_30d ?? null)}
                    sub={
                      perf && perf.sample_size > 0
                        ? `${perf.sample_size} cmd`
                        : "n/a"
                    }
                  />
                  <Stat
                    label="Transit médian"
                    value={formatHours(perf?.median_transit_hours ?? null)}
                    sub={perf && perf.delivered > 0 ? `${perf.delivered} livrées` : "n/a"}
                  />
                  <Stat
                    label="Frais"
                    value={`${c.delivery_fee}/${c.return_fee}`}
                    sub={`livr./ret. ${currency}`}
                  />
                </div>

                {test && (
                  <div
                    role="status"
                    style={{
                      fontSize: 12,
                      color: test.reachable ? "#008060" : "#D72C0D",
                      background: test.reachable ? "#E3F2E8" : "#FDEDEA",
                      padding: "6px 10px",
                      borderRadius: 6,
                    }}
                  >
                    {test.reachable
                      ? test.adapter?.dryRun
                        ? `Dry-run OK — ${Object.keys(test.adapter.dryRun.payloadPreview).length} champs formatés`
                        : `Joignable (${test.status ?? "HEAD"})`
                      : test.error ?? "Injoignable"}
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 4,
                  }}
                >
                  <div style={{ display: "flex", gap: 12 }}>
                    <button
                      type="button"
                      onClick={() => openEdit(c)}
                      style={textButton}
                    >
                      Configurer
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTest(c, "reachability")}
                      disabled={testingId === c.id}
                      style={textButton}
                    >
                      {testingId === c.id ? "Test…" : "Ping"}
                    </button>
                    {adapterKnown && (
                      <button
                        type="button"
                        onClick={() => handleTest(c, "dry_run")}
                        disabled={testingId === c.id}
                        style={textButton}
                      >
                        Test dispatch
                      </button>
                    )}
                  </div>
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      cursor: "pointer",
                      gap: 6,
                    }}
                  >
                    <span style={{ fontSize: 12, color: "#6D7175" }}>Actif</span>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={`Actif ${c.name}`}
                      checked={c.is_active}
                      onChange={() => handleToggleActive(c)}
                      style={{
                        width: 32,
                        height: 18,
                        cursor: "pointer",
                        accentColor: "#1A1A1A",
                      }}
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {onboardingOpen && (
        <IntegrationGuidePanel
          adapters={adapters}
          onClose={() => setOnboardingOpen(false)}
          onAddCarrier={openAdd}
        />
      )}

      {panelOpen && (
        <>
          <div
            onClick={closePanel}
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(26,26,26,0.4)",
              zIndex: 40,
            }}
          />
          <FocusTrap
            focusTrapOptions={{
              allowOutsideClick: true,
              fallbackFocus: () => panelRef.current ?? document.body,
            }}
          >
            <div
              ref={panelRef}
              tabIndex={-1}
              style={{
                position: "fixed",
                top: 0,
                insetInlineEnd: 0,
                bottom: 0,
                width: "min(460px, 100vw)",
                backgroundColor: "white",
                borderInlineStart: "1px solid #E1E3E5",
                zIndex: 50,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div style={{ padding: "20px 24px", borderBottom: "1px solid #E1E3E5" }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#1A1A1A" }}>
                  {editCarrier ? "Configurer le transporteur" : "Ajouter un transporteur"}
                </h3>
              </div>

              <form
                onSubmit={handleSubmit}
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: 24,
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                }}
              >
                {!editCarrier && (
                  <div>
                    <label style={labelStyle}>Adaptateur</label>
                    <select
                      value={form.adapter_code}
                      onChange={(e) => {
                        const code = e.target.value;
                        const desc = adapters.find((a) => a.code === code);
                        setForm((f) => ({
                          ...f,
                          adapter_code: code,
                          api_endpoint: desc?.defaultEndpoint ?? f.api_endpoint,
                        }));
                      }}
                      style={inputStyle}
                    >
                      {adapters.map((a) => (
                        <option key={a.code} value={a.code}>
                          {a.label}
                        </option>
                      ))}
                      <option value={CUSTOM_CODE}>Personnalisé</option>
                    </select>
                    {selectedDescriptor && (
                      <p style={{ margin: "6px 0 0 0", fontSize: 12, color: "#6D7175" }}>
                        {selectedDescriptor.description}
                      </p>
                    )}
                    {form.adapter_code === CUSTOM_CODE && (
                      <p style={{ margin: "6px 0 0 0", fontSize: 12, color: "#8A6116" }}>
                        Un adaptateur personnalisé nécessite une nouvelle classe dans{" "}
                        <code>src/lib/carriers/</code>.
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <label style={labelStyle}>Nom affiché</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    style={inputStyle}
                  />
                </div>

                {!editCarrier && form.adapter_code === CUSTOM_CODE && (
                  <div>
                    <label style={labelStyle}>Code</label>
                    <input
                      type="text"
                      value={form.code}
                      onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                      placeholder="ex: mon_transporteur"
                      style={inputStyle}
                    />
                  </div>
                )}

                <div>
                  <label style={labelStyle}>Endpoint API</label>
                  <input
                    type="url"
                    required
                    value={form.api_endpoint}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, api_endpoint: e.target.value }))
                    }
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={labelStyle}>
                    Clé API{" "}
                    {editCarrier && !form.rotatingKey && (
                      <span style={{ color: "#6D7175", fontWeight: 400 }}>
                        (masquée)
                      </span>
                    )}
                  </label>
                  {editCarrier && !form.rotatingKey ? (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="text"
                        disabled
                        value={MASK}
                        style={{ ...inputStyle, color: "#6D7175" }}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setForm((f) => ({ ...f, rotatingKey: true, api_key: "" }))
                        }
                        style={secondaryButton}
                      >
                        Faire tourner
                      </button>
                    </div>
                  ) : (
                    <input
                      type="password"
                      value={form.api_key}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, api_key: e.target.value }))
                      }
                      style={inputStyle}
                      placeholder={editCarrier ? "Nouvelle clé" : ""}
                    />
                  )}
                  {editCarrier && form.rotatingKey && (
                    <p style={{ margin: "6px 0 0 0", fontSize: 12, color: "#6D7175" }}>
                      L&apos;ancienne clé sera remplacée à l&apos;enregistrement.
                    </p>
                  )}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={labelStyle}>Frais livraison ({currency})</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.delivery_fee}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, delivery_fee: e.target.value }))
                      }
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Frais retour ({currency})</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.return_fee}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, return_fee: e.target.value }))
                      }
                      style={inputStyle}
                    />
                  </div>
                </div>

                {errorMsg && (
                  <p style={{ fontSize: 13, color: "#D72C0D", margin: 0 }}>{errorMsg}</p>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    type="submit"
                    disabled={saving}
                    style={{
                      ...primaryButton,
                      cursor: saving ? "not-allowed" : "pointer",
                      opacity: saving ? 0.7 : 1,
                    }}
                  >
                    {saving ? "Enregistrement…" : "Enregistrer"}
                  </button>
                  <button type="button" onClick={closePanel} style={secondaryButton}>
                    Annuler
                  </button>
                </div>
              </form>
            </div>
          </FocusTrap>
        </>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#6D7175", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A", marginTop: 2 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "#6D7175", marginTop: 2 }}>{sub}</div>
      )}
    </div>
  );
}

