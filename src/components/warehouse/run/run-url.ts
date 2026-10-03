/**
 * The scan run's address — what Sortir may open the run with.
 *
 *   /{locale}/warehouse/scan                                the picker (or the run saved earlier)
 *   /{locale}/warehouse/scan?roll=%23d80a0a                 « Commencer » on a roll
 *   /{locale}/warehouse/scan?roll=%23d80a0a&order=<uuid>    a parcel tapped on Sortir
 *   /{locale}/warehouse/scan?order=<uuid>                   a parcel with no known roll
 *
 * Sortir builds these (`rollHref` / `runHref` in bench/bench-format.ts). The
 * « # » must be encoded — written raw it ends the query and becomes the
 * fragment, which the server never sees — so a bare `roll=d80a0a` is accepted
 * too. Anything else is ignored rather than trusted.
 */

const HEX = /^#?([0-9a-f]{6})$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Param = string | string[] | undefined;

export function parseRunParams(search: { roll?: Param; order?: Param }): {
  roll: string | null;
  order: string | null;
} {
  const roll = typeof search.roll === "string" ? HEX.exec(search.roll)?.[1] : undefined;
  const order = typeof search.order === "string" && UUID.test(search.order) ? search.order : null;
  return { roll: roll ? `#${roll.toLowerCase()}` : null, order };
}
