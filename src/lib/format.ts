/* ═════════════════════════════════════════════════════════════════════════════
   CORRECTIF BIDI MONÉTAIRE — POURQUOI LRI (U+2066) ET PAS FSI (U+2068)

   Le symbole libyen « د.ل. » est un caractère FORT-RTL. Collé à des chiffres
   latins, il contamine l'algorithme bidi d'Unicode et réordonne au rendu tout
   ce qui l'entoure : « +94 د.ل · 72,8 % » s'affiche « 72,8 % · د.ل 94+ ».
   Il faut donc enfermer le montant dans un isolat directionnel. Reste à
   choisir lequel — et FSI est un piège :

   • FSI (First-Strong Isolate) DÉDUIT la direction de l'isolat du premier
     caractère FORT qu'il contient. Or dans « −10 708,500 د.ل. » le signe est
     neutre (ES) et les chiffres sont faibles (EN) : le premier caractère fort
     est le symbole arabe lui-même. FSI résout donc l'isolat en RTL, et le
     signe repart à l'autre extrémité — le bug qu'on prétendait corriger,
     simplement déplacé à l'intérieur de l'isolat.
   • LRI (Left-to-Right Isolate) IMPOSE la direction LTR quel que soit le
     contenu. La séquence « signe → chiffres → symbole » est alors garantie,
     et l'isolat empêche toujours le symbole d'agir sur les voisins.
   FSI ne conviendrait que si le montant commençait par un caractère fort-LTR,
   ce qui n'arrive jamais. D'où LRI systématique, refermé par PDI (U+2069).

   Deux corollaires, tout aussi structurants :
   1. LE SIGNE EST À L'INTÉRIEUR DE L'ISOLAT. Un « + » ou un « − » concaténé
      par l'appelant AVANT le LRI reste soumis au contexte RTL de la page et
      migre visuellement à droite. Le signe est donc réémis ici, à partir du
      SIGNE DU NOMBRE (jamais récupéré dans les parts d'Intl, qui donnent la
      valeur absolue), et en MINUS SIGN U+2212 — pas en tiret ASCII.
   2. LES CHIFFRES VIENNENT DU FORMATEUR fr-TN, LE SYMBOLE DU FORMATEUR DEVISE.
      ar-LY groupe les milliers avec un POINT : « 10.708,500 », qu'un lecteur
      francophone lit « 10,708 » — le montant affiché est faux d'un facteur
      1000 dans sa tête. On ne prend donc d'ar-LY que le symbole, et jamais
      ses chiffres. Une seule colonne de chiffres pour toute la console.

   Enfin, on recompose au lieu de laisser Intl produire la chaîne : la position
   de l'affixe pour LYD dépend de la version d'ICU (suffixe sur Node ICU 77.1,
   préfixe sur l'ICU de plusieurs navigateurs). Recomposer rend la sortie
   identique côté serveur et côté client, ce qui supprime toute une classe
   d'erreurs d'hydratation React.
   ═══════════════════════════════════════════════════════════════════════════ */

const LRI = "⁦"; // LEFT-TO-RIGHT ISOLATE
const PDI = "⁩"; // POP DIRECTIONAL ISOLATE
const NBSP = " "; // U+00A0 NO-BREAK SPACE — sépare le montant de son symbole
const MINUS_SIGN = "−"; // MINUS SIGN typographique, jamais U+002D
/**
 * RLM (U+200F) / LRM (U+200E) / ALM (U+061C) : marques qu'ICU insère autour de
 * ses sorties arabes et qu'il faut retirer avant recomposition. Les quatre
 * constantes ci-dessus sont des caractères INVISIBLES dans ce fichier source :
 * en cas de doute, `node -e` sur leur codePointAt avant de les retoucher.
 */
const BIDI_MARKS = /[‎‏؜]/g;

/** Les monnaies TND et LYD sont en millimes : trois décimales par défaut. */
export type MoneyFractionDigits = 0 | 2 | 3;
const DEFAULT_FRACTION_DIGITS: MoneyFractionDigits = 3;

/**
 * Formateurs devise, mémoïsés par marché. Ils ne servent PLUS à produire la
 * chaîne finale : on ne leur demande que le symbole (cf. corollaire 2).
 * Les instances restent en cache — une table peut rendre des centaines de
 * montants et construire un Intl.NumberFormat par ligne est coûteux.
 */
const currencyFormatters = new Map<string, Intl.NumberFormat>();
function getCurrencyFormatter(market: string): Intl.NumberFormat {
  let fmt = currencyFormatters.get(market);
  if (!fmt) {
    if (market === "LY") {
      fmt = new Intl.NumberFormat("ar-LY", {
        style: "currency",
        currency: "LYD",
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      });
    } else {
      fmt = new Intl.NumberFormat("fr-TN", {
        style: "currency",
        currency: "TND",
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      });
    }
    currencyFormatters.set(market, fmt);
  }
  return fmt;
}

/**
 * Le symbole seul, débarrassé des marques directionnelles.
 * Jamais écrit en dur : « د.ل. » fait QUATRE caractères (point final compris)
 * et sa valeur exacte dépend de la version CLDR — il doit venir de
 * formatToParts(type === "currency").
 */
const currencySymbols = new Map<string, string>();
function getCurrencySymbol(market: string): string {
  let symbol = currencySymbols.get(market);
  if (symbol === undefined) {
    symbol = getCurrencyFormatter(market)
      .formatToParts(0)
      .filter((part) => part.type === "currency")
      .map((part) => part.value)
      .join("")
      .replace(BIDI_MARKS, "");
    currencySymbols.set(market, symbol);
  }
  return symbol;
}

/** Formateurs de nombre nus, mémoïsés par nombre de décimales. */
const decimalFormatters = new Map<number, Intl.NumberFormat>();
function getDecimalFormatter(fractionDigits: number): Intl.NumberFormat {
  let fmt = decimalFormatters.get(fractionDigits);
  if (!fmt) {
    fmt = new Intl.NumberFormat("fr-TN", {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    decimalFormatters.set(fractionDigits, fmt);
  }
  return fmt;
}

/**
 * Chiffres et symbole SÉPARÉS, sans isolat ni signe — pour un composant qui
 * veut les rendre dans deux éléments distincts (la devise typographiquement
 * rétrogradée, cf. « une seule colonne de chiffres » du design system).
 * `value` est toujours la VALEUR ABSOLUE : le signe est la responsabilité de
 * l'appelant, et formatCurrency le réémet lui-même.
 */
export function formatMoneyParts(
  amount: number,
  market: string,
  fractionDigits: MoneyFractionDigits = DEFAULT_FRACTION_DIGITS
): { value: string; symbol: string } {
  return {
    value: getDecimalFormatter(fractionDigits)
      .format(Math.abs(amount))
      .replace(BIDI_MARKS, ""),
    symbol: getCurrencySymbol(market),
  };
}

function composeMoney(
  amount: number,
  market: string,
  fractionDigits: MoneyFractionDigits,
  signed: boolean
): string {
  const { value, symbol } = formatMoneyParts(amount, market, fractionDigits);
  // Un montant qui s'arrondit à zéro ne porte pas de signe : « −0,000 DT »
  // est une aberration comptable. On teste les chiffres RENDUS (donc après
  // l'arrondi d'ICU) plutôt que de ré-arrondir nous-mêmes.
  const roundsToZero = Number.isFinite(amount) && !/[1-9]/.test(value);
  const sign = roundsToZero ? "" : amount < 0 ? MINUS_SIGN : signed ? "+" : "";
  return `${LRI}${sign}${value}${NBSP}${symbol}${PDI}`;
}

/**
 * Un montant prêt à l'affichage, protégé du réordonnancement bidi.
 *
 * @param market CODE MARCHÉ en majuscules — "TN" | "LY". Ce n'est PAS un code
 *   devise : passer "LYD" retombe silencieusement sur la branche TN (contrat
 *   historique, documenté dans lib/investors/portfolio.ts).
 * Retourne une CHAÎNE SIMPLE : elle est utilisée dans des littéraux de gabarit
 * et comme argument d'interpolation ICU next-intl — jamais un ReactNode.
 */
export function formatCurrency(
  amount: number,
  market: string,
  opts?: { signed?: boolean; fractionDigits?: MoneyFractionDigits }
): string {
  return composeMoney(
    amount,
    market,
    opts?.fractionDigits ?? DEFAULT_FRACTION_DIGITS,
    opts?.signed ?? false
  );
}

/**
 * Idem, mais un montant positif porte un « + » explicite (variations, deltas).
 * Existe pour que les appelants cessent de concaténer leur signe HORS de
 * l'isolat, ce qui est le défaut bidi le plus répandu de la base de code.
 */
export function formatCurrencySigned(
  amount: number,
  market: string,
  opts?: { fractionDigits?: MoneyFractionDigits }
): string {
  return composeMoney(
    amount,
    market,
    opts?.fractionDigits ?? DEFAULT_FRACTION_DIGITS,
    true
  );
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
function getDateFormatter(locale: string): Intl.DateTimeFormat {
  let fmt = dateFormatters.get(locale);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(
      locale === "ar" ? "ar-LY" : "fr-TN",
      { dateStyle: "short" }
    );
    dateFormatters.set(locale, fmt);
  }
  return fmt;
}

export function formatDate(date: string | Date, locale: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return getDateFormatter(locale).format(d);
}

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
function getDateTimeFormatter(locale: string): Intl.DateTimeFormat {
  let fmt = dateTimeFormatters.get(locale);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-LY" : "fr-TN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    dateTimeFormatters.set(locale, fmt);
  }
  return fmt;
}

export function formatDateTime(date: string | Date, locale: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return getDateTimeFormatter(locale).format(d);
}

const longDateFormatters = new Map<string, Intl.DateTimeFormat>();
function getLongDateFormatter(locale: string): Intl.DateTimeFormat {
  let fmt = longDateFormatters.get(locale);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-LY" : "fr-TN", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    longDateFormatters.set(locale, fmt);
  }
  return fmt;
}

/** A readable, spelled-out date — e.g. "21 mai 2026" — for at-a-glance display. */
export function formatLongDate(date: string | Date, locale: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return getLongDateFormatter(locale).format(d);
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();
function getTimeFormatter(locale: string): Intl.DateTimeFormat {
  let fmt = timeFormatters.get(locale);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-LY" : "en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    timeFormatters.set(locale, fmt);
  }
  return fmt;
}

/** A bare HH:MM time — pairs with formatLongDate for "21 mai 2026, 14:30". */
export function formatTime(date: string | Date, locale: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return getTimeFormatter(locale).format(d);
}

const dayHeaderFormatters = new Map<string, Intl.DateTimeFormat>();
function getDayHeaderFormatter(locale: string): Intl.DateTimeFormat {
  let fmt = dayHeaderFormatters.get(locale);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-LY" : "fr-TN", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    dayHeaderFormatters.set(locale, fmt);
  }
  return fmt;
}

export function formatDayHeader(date: string | Date, locale: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return locale === "ar" ? "اليوم" : "Aujourd'hui";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYesterday) return locale === "ar" ? "أمس" : "Hier";
  return getDayHeaderFormatter(locale).format(d);
}

export function minutesBetween(fromIso: string, toMs: number): number {
  return Math.max(0, Math.floor((toMs - new Date(fromIso).getTime()) / 60000));
}

export function formatExactTime(date: string | Date, _locale: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (sameDay) return `${hh}:${mm}`;

  const dd = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mo} ${hh}:${mm}`;
}

export function classifyDueTime(
  dueAt: string | null,
  nowMs: number,
  locale: string
): { key: "overdue" | "dueToday" | "due" | "noSchedule"; params?: Record<string, string> } {
  if (!dueAt) return { key: "noSchedule" };

  const due = new Date(dueAt).getTime();
  const time = formatExactTime(dueAt, locale);

  if (due < nowMs) {
    const mins = minutesBetween(dueAt, nowMs);
    const hours = Math.floor(mins / 60);
    const relStr = hours >= 1 ? `${hours}h` : `${mins}min`;
    return { key: "overdue", params: { time: `${relStr} · ${time}` } };
  }

  const midnight = new Date(nowMs);
  midnight.setHours(24, 0, 0, 0);
  if (due <= midnight.getTime()) {
    return { key: "dueToday", params: { time } };
  }

  return { key: "due", params: { time } };
}
