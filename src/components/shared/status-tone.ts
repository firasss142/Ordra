import type { StatusHue, StatusWeight } from "@/lib/orders/status-presentation";

/**
 * How a status hue and weight turn into classes — one table, both surfaces.
 *
 * The orders console badge and the agent queue pill used to carry a private
 * copy each: identical in shape, one written against `oms-*` and one against
 * `hue-*`. That is precisely the drift the `hue-*` aliases were introduced to
 * prevent, so the table lives here and both import it.
 *
 * `weight` steps three things at once — the fill, the face, and how opaque the
 * border is (§4.17 F-bis, amended: the border is no longer switched on and off,
 * so it is no longer the alarm).
 *
 * The `-fill-soft` / `-edge-soft` / `-edge-mid` tokens exist because Tailwind v3
 * cannot apply an opacity modifier to a `var()`-backed colour. `bg-hue-amber-bg/70`
 * and `border-hue-amber-edge/25` compile to *nothing*, which left every pill
 * wearing the preflight grey border instead of its own hue. Do not reintroduce
 * that form — see the note in globals.css.
 */
export const STATUS_HUE_TONE: Record<
  StatusHue,
  { ink: string; quiet: string; medium: string; loud: string }
> = {
  neutral: {
    ink: "text-hue-neutral-ink",
    quiet: "bg-hue-neutral-fill-soft border-hue-neutral-edge-soft",
    medium: "bg-hue-neutral-bg border-hue-neutral-edge-mid",
    loud: "bg-hue-neutral-bg border-hue-neutral-edge",
  },
  amber: {
    ink: "text-hue-amber-ink",
    quiet: "bg-hue-amber-fill-soft border-hue-amber-edge-soft",
    medium: "bg-hue-amber-bg border-hue-amber-edge-mid",
    loud: "bg-hue-amber-bg border-hue-amber-edge",
  },
  violet: {
    ink: "text-hue-violet-ink",
    quiet: "bg-hue-violet-fill-soft border-hue-violet-edge-soft",
    medium: "bg-hue-violet-bg border-hue-violet-edge-mid",
    loud: "bg-hue-violet-bg border-hue-violet-edge",
  },
  teal: {
    ink: "text-hue-teal-ink",
    quiet: "bg-hue-teal-fill-soft border-hue-teal-edge-soft",
    medium: "bg-hue-teal-bg border-hue-teal-edge-mid",
    loud: "bg-hue-teal-bg border-hue-teal-edge",
  },
  green: {
    ink: "text-hue-green-ink",
    quiet: "bg-hue-green-fill-soft border-hue-green-edge-soft",
    medium: "bg-hue-green-bg border-hue-green-edge-mid",
    loud: "bg-hue-green-bg border-hue-green-edge",
  },
  red: {
    ink: "text-hue-red-ink",
    quiet: "bg-hue-red-fill-soft border-hue-red-edge-soft",
    medium: "bg-hue-red-bg border-hue-red-edge-mid",
    loud: "bg-hue-red-bg border-hue-red-edge",
  },
};

/** Weight on the face. Steps with the fill and the border, never alone. */
export const STATUS_WEIGHT_FONT: Record<StatusWeight, string> = {
  quiet: "font-medium",
  medium: "font-semibold",
  loud: "font-[650]",
};
