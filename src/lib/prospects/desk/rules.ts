/**
 * « Règles » — what the manager may store under the settings key
 * `prospect_recovery`. The SQL merges it over its defaults
 * (prospect_recovery_settings); this decides what is sane to save.
 */
import type { RecoverySettings } from "./types";

/**
 * Sub-reasons that can be won back. The « commande invalide » group (non
 * commandé, non sérieux, simple info, doublon) never is: those people did not
 * want the order in the first place.
 */
export const RECOVERABLE_SUBREASONS = [
  "pas_de_reponse", "raccroche", "numero_hors_service", "changement_avis", "prix_eleve",
  "produit_non_voulu", "numero_invalide", "mauvais_interlocuteur", "achete_ailleurs", "autre",
] as const;

export type ParseResult = { ok: true; value: RecoverySettings } | { ok: false; field: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const intIn = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

export function parseRules(body: unknown): ParseResult {
  if (!isObj(body)) return { ok: false, field: "body" };
  const { enabled, rej, ret, old, dist } = body;
  if (typeof enabled !== "boolean") return { ok: false, field: "enabled" };
  if (!isObj(rej) || typeof rej.on !== "boolean") return { ok: false, field: "rej" };
  if (!intIn(rej.delay_days, 0, 60)) return { ok: false, field: "rej.delay_days" };
  if (!Array.isArray(rej.subreasons) || !rej.subreasons.every((s) => (RECOVERABLE_SUBREASONS as readonly string[]).includes(s as string))) {
    return { ok: false, field: "rej.subreasons" };
  }
  if (!isObj(ret) || typeof ret.on !== "boolean") return { ok: false, field: "ret" };
  if (!isObj(old) || typeof old.on !== "boolean") return { ok: false, field: "old" };
  if (!intIn(old.after_days, 7, 365)) return { ok: false, field: "old.after_days" };
  if (!isObj(dist)) return { ok: false, field: "dist" };
  if (!intIn(dist.hour, 0, 23)) return { ok: false, field: "dist.hour" };
  if (!intIn(dist.file_cap, 1, 200)) return { ok: false, field: "dist.file_cap" };
  if (!intIn(dist.release_days, 1, 30)) return { ok: false, field: "dist.release_days" };
  if (!intIn(dist.max_tries, 1, 10)) return { ok: false, field: "dist.max_tries" };
  return {
    ok: true,
    value: {
      enabled,
      rej: { on: rej.on, delay_days: rej.delay_days as number, subreasons: [...new Set(rej.subreasons as string[])] },
      ret: { on: ret.on },
      old: { on: old.on, after_days: old.after_days as number },
      dist: { hour: dist.hour as number, file_cap: dist.file_cap as number, release_days: dist.release_days as number, max_tries: dist.max_tries as number },
    },
  };
}
