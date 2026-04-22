"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import type { MarketSettings, AssignmentAlgorithm } from "@/types/settings";
import type { Role } from "@/types";
import { canEditCosts } from "@/lib/role-permissions";

const TIME_RE = /^([0-1]\d|2[0-3]):([0-5]\d)$/;

const schema = z.object({
  delivery_fee: z.number({ invalid_type_error: "Valeur invalide" }).min(0, "Valeur invalide"),
  return_fee: z.number({ invalid_type_error: "Valeur invalide" }).min(0, "Valeur invalide"),
  packing_cost: z.number({ invalid_type_error: "Valeur invalide" }).min(0, "Valeur invalide"),
  max_call_attempts: z
    .number({ invalid_type_error: "Valeur invalide" })
    .int()
    .min(1, "Minimum 1")
    .max(10, "Maximum 10"),
  assignment_algorithm: z.enum([
    "manual",
    "round_robin",
    "workload",
    "product_based",
    "region_based",
  ]),
  active_agents_only: z.boolean(),
  agent_inactivity_minutes: z.preprocess(
    (v) => (v === "" || v === null || (typeof v === "number" && isNaN(v)) ? undefined : Number(v)),
    z.number().int().min(1, "Minimum 1").optional()
  ),
  attempt_retry_times: z
    .array(z.string())
    .max(3, "Maximum 3 créneaux")
    .superRefine((list, ctx) => {
      let prev = -1;
      for (let i = 0; i < list.length; i++) {
        const match = TIME_RE.exec(list[i] ?? "");
        if (!match) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [i],
            message: "Format attendu: HH:MM",
          });
          continue;
        }
        const mins = Number(match[1]) * 60 + Number(match[2]);
        if (mins <= prev) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [i],
            message: "Les horaires doivent être strictement croissants",
          });
        }
        prev = mins;
      }
    })
    .optional(),
});

type FormValues = z.infer<typeof schema>;

interface GeneralSettingsFormProps {
  initialValues: MarketSettings;
  onSubmit: (values: MarketSettings) => void;
  marketId?: string;
  role?: Role;
}

const ALGORITHM_OPTIONS: { value: AssignmentAlgorithm; label: string; available: boolean }[] = [
  { value: "manual", label: "Manuel", available: true },
  { value: "round_robin", label: "Round Robin", available: true },
  { value: "workload", label: "Charge de travail", available: true },
  { value: "product_based", label: "Par produit — bientôt disponible", available: false },
  { value: "region_based", label: "Par région — bientôt disponible", available: false },
];

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
  border: "1px solid #D1D5DB",
  borderRadius: "0.5rem",
  background: "white",
  outline: "none",
  boxSizing: "border-box",
};

const inputFocusHandlers = {
  onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    e.currentTarget.style.border = "2px solid #1A1A1A";
  },
  onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    e.currentTarget.style.border = "1px solid #D1D5DB";
  },
};

const errorStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#D72C0D",
  marginTop: 4,
};

export function GeneralSettingsForm({
  initialValues,
  onSubmit,
  marketId,
  role,
}: GeneralSettingsFormProps) {
  const showCosts = role ? canEditCosts(role) : false;
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      ...initialValues,
      attempt_retry_times: initialValues.attempt_retry_times ?? [],
    },
  });

  const currentAlgorithm = watch("assignment_algorithm");
  const retryTimes = watch("attempt_retry_times") ?? [];

  function httpError(status: number): string {
    if (status === 401) return "Session expirée — veuillez vous reconnecter";
    if (status === 403) return "Action non autorisée";
    if (status === 409) return "Conflit — rechargez la page";
    return "Erreur lors de l'enregistrement";
  }

  async function onFormSubmit(values: FormValues) {
    if (marketId) {
      setSaving(true);
      setSuccessMsg("");
      setErrorMsg("");
      try {
        const res = await fetch(`/api/settings/${marketId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setErrorMsg((body as { error?: string }).error ?? httpError(res.status));
        } else {
          setSuccessMsg("Paramètres enregistrés");
          setTimeout(() => setSuccessMsg(""), 3000);
          onSubmit(values as MarketSettings);
        }
      } catch {
        setErrorMsg("Erreur réseau — veuillez réessayer");
      } finally {
        setSaving(false);
      }
    } else {
      onSubmit(values as MarketSettings);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {showCosts && (
          <>
            <div>
              <label htmlFor="delivery_fee" style={labelStyle}>
                Frais de livraison (TND)
              </label>
              <input
                id="delivery_fee"
                type="number"
                step="0.01"
                style={inputStyle}
                {...inputFocusHandlers}
                {...register("delivery_fee", { valueAsNumber: true })}
              />
              {errors.delivery_fee && (
                <p style={errorStyle}>{errors.delivery_fee.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="return_fee" style={labelStyle}>
                Frais de retour (TND)
              </label>
              <input
                id="return_fee"
                type="number"
                step="0.01"
                style={inputStyle}
                {...inputFocusHandlers}
                {...register("return_fee", { valueAsNumber: true })}
              />
              {errors.return_fee && (
                <p style={errorStyle}>{errors.return_fee.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="packing_cost" style={labelStyle}>
                Coût d&apos;emballage (TND)
              </label>
              <input
                id="packing_cost"
                type="number"
                step="0.01"
                style={inputStyle}
                {...inputFocusHandlers}
                {...register("packing_cost", { valueAsNumber: true })}
              />
              {errors.packing_cost && (
                <p style={errorStyle}>{errors.packing_cost.message}</p>
              )}
            </div>
          </>
        )}

        <div>
          <label htmlFor="max_call_attempts" style={labelStyle}>
            Tentatives max
          </label>
          <input
            id="max_call_attempts"
            type="number"
            min="1"
            max="10"
            style={inputStyle}
            {...inputFocusHandlers}
            {...register("max_call_attempts", { valueAsNumber: true })}
          />
          {errors.max_call_attempts && (
            <p style={errorStyle}>{errors.max_call_attempts.message}</p>
          )}
        </div>

        <div>
          <label style={labelStyle}>
            Heures de rappel automatique
          </label>
          <p style={{ fontSize: 12, color: "#6D7175", marginTop: -2, marginBottom: 8 }}>
            Jusqu&apos;à 3 créneaux horaires. Lorsqu&apos;un agent enregistre une tentative sans réponse, le système programme le prochain créneau disponible.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[0, 1, 2].map((idx) => {
              const value = retryTimes[idx];
              if (value === undefined) return null;
              const fieldError = Array.isArray(errors.attempt_retry_times)
                ? (errors.attempt_retry_times as Array<{ message?: string } | undefined>)[idx]
                : undefined;
              return (
                <div key={idx} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <input
                    type="time"
                    value={value}
                    onChange={(e) => {
                      const next = [...retryTimes];
                      next[idx] = e.target.value;
                      setValue("attempt_retry_times", next, { shouldValidate: true, shouldDirty: true });
                    }}
                    style={{ ...inputStyle, width: 140 }}
                    {...inputFocusHandlers}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const next = retryTimes.filter((_, i) => i !== idx);
                      setValue("attempt_retry_times", next, { shouldValidate: true, shouldDirty: true });
                    }}
                    style={{
                      background: "none",
                      border: "1px solid #D1D5DB",
                      borderRadius: "0.25rem",
                      color: "#6B7280",
                      cursor: "pointer",
                      fontSize: 13,
                      padding: "0 12px",
                      height: 36,
                    }}
                  >
                    Retirer
                  </button>
                  {fieldError?.message && (
                    <p style={{ ...errorStyle, marginTop: 9 }}>{fieldError.message}</p>
                  )}
                </div>
              );
            })}
            {retryTimes.length < 3 && (
              <button
                type="button"
                onClick={() => {
                  const next = [...retryTimes, ""];
                  setValue("attempt_retry_times", next, { shouldValidate: true, shouldDirty: true });
                }}
                style={{
                  alignSelf: "flex-start",
                  background: "none",
                  border: "1px dashed #9CA3AF",
                  borderRadius: "0.25rem",
                  color: "#1A1A1A",
                  cursor: "pointer",
                  fontSize: 13,
                  padding: "6px 12px",
                }}
              >
                + Ajouter un créneau
              </button>
            )}
            {retryTimes.length === 0 && (
              <p style={{ fontSize: 12, color: "#6D7175" }}>
                Aucun créneau défini — les tentatives utiliseront un délai par défaut de +2h.
              </p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="assignment_algorithm" style={labelStyle}>
            Algorithme d&apos;affectation
          </label>
          <select
            id="assignment_algorithm"
            style={{ ...inputStyle, cursor: "pointer" }}
            {...inputFocusHandlers}
            {...register("assignment_algorithm")}
          >
            {ALGORITHM_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={!opt.available} style={opt.available ? {} : { color: "#9CA3AF" }}>
                {opt.label}
              </option>
            ))}
          </select>
          {errors.assignment_algorithm && (
            <p style={errorStyle}>{errors.assignment_algorithm.message}</p>
          )}
        </div>

        {currentAlgorithm !== "manual" && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              id="active_agents_only"
              type="checkbox"
              style={{ width: 16, height: 16, cursor: "pointer" }}
              {...register("active_agents_only")}
            />
            <label
              htmlFor="active_agents_only"
              style={{ ...labelStyle, margin: 0, cursor: "pointer" }}
            >
              Agents actifs uniquement
            </label>
          </div>
        )}

        <div>
          <label htmlFor="agent_inactivity_minutes" style={labelStyle}>
            Seuil d&apos;inactivité agent (minutes)
          </label>
          <input
            id="agent_inactivity_minutes"
            type="number"
            min={1}
            placeholder="ex: 30"
            style={{ ...inputStyle, width: 120 }}
            {...inputFocusHandlers}
            {...register("agent_inactivity_minutes", { valueAsNumber: true })}
          />
          {errors.agent_inactivity_minutes && (
            <p style={errorStyle}>{errors.agent_inactivity_minutes.message}</p>
          )}
          <p style={{ fontSize: 12, color: "#6D7175", marginTop: 4 }}>
            Agents sans activité depuis ce délai seront exclus de l&apos;auto-assignation.
          </p>
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <button
          type="button"
          disabled={saving}
          onClick={() => handleSubmit(onFormSubmit)()}
          style={{
            backgroundColor: saving ? "#9CA3AF" : "#1A1A1A",
            color: "white",
            border: "none",
            borderRadius: "0.25rem",
            padding: "8px 16px",
            fontSize: 14,
            fontWeight: 500,
            cursor: saving ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
        {successMsg && (
          <span style={{ marginLeft: 12, fontSize: 13, color: "#008060" }}>
            {successMsg}
          </span>
        )}
        {errorMsg && (
          <span style={{ marginLeft: 12, fontSize: 13, color: "#D72C0D" }}>
            {errorMsg}
          </span>
        )}
      </div>
    </div>
  );
}
