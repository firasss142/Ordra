/**
 * Politique admin sur les six options de commande Darb.
 *
 * Les options sont un choix par commande dans le modal de dispatch. Cette
 * couche résout, pour un transporteur donné, ce que l'agent voit et ce qu'il
 * peut encore changer — sans jamais casser le comportement d'aujourd'hui quand
 * rien n'est configuré.
 *
 * Fonction pure : elle prend les lignes déjà lues et ne parle pas à Supabase.
 */

export const ORDER_OPTION_KEYS = [
  "is_pickup",
  "allow_inspection",
  "is_fragile",
  "allow_card_payment",
  "allow_testing",
  "is_replacement",
] as const;

export type OrderOptionKey = (typeof ORDER_OPTION_KEYS)[number];

/**
 * Les deux modes d'expédition, stockés dans la même table que les options mais
 * délibérément séparés d'elles.
 *
 * WHY. Une option de commande décrit ce qui arrive AU COLIS (fragile, ouvrable,
 * payable par carte). Un mode dit D'OÙ IL PART. Les mélanger donnerait huit
 * cases d'apparence identique dont deux ne se comportent pas comme les autres :
 * elles n'ont pas de « modifiable », et elles ne peuvent pas être éteintes
 * toutes les deux.
 *
 * - `mode_home_warehouse`  → « Notre entrepôt » : nous détenons le stock, Darb
 *   vient le chercher. C'est le mode qui marche toujours.
 * - `mode_carrier_warehouse` → « Entrepôt Darb Assabil » : ils détiennent le
 *   stock et le prélèvent eux-mêmes.
 */
export const FULFILMENT_MODE_KEYS = [
  "mode_home_warehouse",
  "mode_carrier_warehouse",
] as const;

export type FulfilmentModeKey = (typeof FULFILMENT_MODE_KEYS)[number];

/** Les deux modes, tels que le modal doit les proposer. */
export interface ResolvedFulfilmentModes {
  /** « Notre entrepôt » est proposé. */
  home: boolean;
  /** « Entrepôt Darb Assabil » est proposé. */
  carrier: boolean;
}

/**
 * Les deux modes sont offerts par défaut — c'est le comportement d'avant cette
 * table, et l'absence de ligne doit toujours vouloir dire « rien n'a changé ».
 */
export const CODED_FULFILMENT_MODES: ResolvedFulfilmentModes = {
  home: true,
  carrier: true,
};

/**
 * Les défauts codés d'aujourd'hui, repris tels quels de
 * DarbAssabilDispatchModal.tsx. Ce sont eux qui s'appliquent tant qu'aucune
 * ligne n'existe en base — d'où l'absence de seed dans la migration.
 *
 * `is_pickup` est le seul à ON : Darb qui ramasse chez nous est le cas normal.
 */
export const CODED_DEFAULTS: Record<OrderOptionKey, boolean> = {
  is_pickup: true,
  allow_inspection: false,
  is_fragile: false,
  allow_card_payment: false,
  allow_testing: false,
  is_replacement: false,
};

/**
 * Une ligne de `carrier_order_preferences`, telle que lue.
 *
 * `option_key` est volontairement `string` et non l'union : la table porte deux
 * familles de clés (les six options ET les deux modes), et une base en avance
 * sur le déploiement peut en contenir une troisième. Chaque résolveur filtre ce
 * qui le concerne et ignore le reste.
 */
export interface CarrierOrderPreferenceRow {
  carrier_id: string;
  option_key: string;
  default_value: boolean;
  can_override: boolean;
}

export interface ResolvedOption {
  /** Valeur d'ouverture de la case — et valeur forcée si `canOverride` est faux. */
  value: boolean;
  /** false = la case ne doit pas être rendue ; `value` part quand même. */
  canOverride: boolean;
}

export type ResolvedOrderPreferences = Record<OrderOptionKey, ResolvedOption>;

const KEY_SET = new Set<string>(ORDER_OPTION_KEYS);

function isOptionKey(key: string): key is OrderOptionKey {
  return KEY_SET.has(key);
}

/**
 * Résout la politique effective. Une clé sans ligne retombe sur son défaut
 * codé, donc le résultat couvre toujours les six options — jamais `undefined`.
 *
 * `carrierId` filtre les lignes quand l'appelant en a chargé plusieurs
 * (Tripoli et Benghazi sont deux transporteurs distincts). Omis, toutes les
 * lignes fournies sont considérées comme celles du transporteur voulu.
 */
export function resolveOrderPreferences(
  rows: readonly CarrierOrderPreferenceRow[],
  carrierId?: string,
): ResolvedOrderPreferences {
  const resolved = {} as ResolvedOrderPreferences;
  for (const key of ORDER_OPTION_KEYS) {
    resolved[key] = { value: CODED_DEFAULTS[key], canOverride: true };
  }

  for (const row of rows) {
    if (carrierId && row.carrier_id !== carrierId) continue;
    // Une clé inconnue est ignorée plutôt que de faire tomber un dispatch : la
    // contrainte CHECK la refuse déjà en base, ceci couvre une base en avance
    // sur le déploiement.
    if (!isOptionKey(row.option_key)) continue;

    resolved[row.option_key] = {
      value: row.default_value,
      canOverride: row.can_override,
    };
  }

  return resolved;
}

/**
 * Les modes d'expédition proposés par ce transporteur.
 *
 * `default_value` porte ici « ce mode est proposé », et `can_override` n'est pas
 * lu : un mode est offert ou ne l'est pas, l'agent ne le rallume pas.
 */
export function resolveFulfilmentModes(
  rows: readonly CarrierOrderPreferenceRow[],
  carrierId?: string,
): ResolvedFulfilmentModes {
  const modes: ResolvedFulfilmentModes = { ...CODED_FULFILMENT_MODES };

  for (const row of rows) {
    if (carrierId && row.carrier_id !== carrierId) continue;
    if (row.option_key === "mode_home_warehouse") modes.home = row.default_value;
    else if (row.option_key === "mode_carrier_warehouse") {
      modes.carrier = row.default_value;
    }
  }

  return modes;
}

/**
 * Les deux modes éteints laisseraient le transporteur sans aucun endroit d'où
 * expédier — un état que personne ne veut et que rien ne rattrape côté agent.
 * Refusé à l'écriture plutôt que découvert au moment d'envoyer une commande.
 */
export function isFulfilmentModeChangeValid(
  modes: ResolvedFulfilmentModes,
): boolean {
  return modes.home || modes.carrier;
}

/**
 * Les options que l'agent ne peut pas changer, avec la valeur à envoyer.
 *
 * C'est le garde-fou contre la confusion « masquée donc fausse » : une option
 * verrouillée sur `true` est absente du modal ET doit partir à `true`. Le modal
 * fusionne ce retour dans son état avant de construire le payload.
 */
export function lockedOptionValues(
  resolved: ResolvedOrderPreferences,
): Partial<Record<OrderOptionKey, boolean>> {
  const locked: Partial<Record<OrderOptionKey, boolean>> = {};
  for (const key of ORDER_OPTION_KEYS) {
    if (!resolved[key].canOverride) locked[key] = resolved[key].value;
  }
  return locked;
}
