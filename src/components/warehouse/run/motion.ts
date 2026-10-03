"use client";

import { useEffect, type RefObject } from "react";

/**
 * The run's motion, without a stylesheet.
 *
 * The prototype's outcomes are felt as much as read: a green band that sweeps
 * once across a bound sticker, a short shake on a refusal, the badge that pops,
 * the ring that counts down to the next parcel, the laser in the roll colour.
 * Tailwind ships none of those keyframes and globals.css is shared, so they run
 * through the Web Animations API on the element itself.
 *
 * Every animation is skipped under `prefers-reduced-motion`, and where the API
 * is missing (jsdom, very old WebViews) nothing happens: each element's resting
 * style is its final, readable state.
 */

function reduced(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
}

export function useMotion(
  ref: RefObject<Element | null>,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
  /** Replays whenever this changes. */
  key: unknown = null,
) {
  useEffect(() => {
    const el = ref.current as (Element & { animate?: Element["animate"] }) | null;
    if (!el || typeof el.animate !== "function" || reduced()) return;
    const animation = el.animate(keyframes, options);
    return () => animation.cancel();
    // The keyframes are literals at each call site; `key` is the replay switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, key]);
}

export const SWEEP: [Keyframe[], KeyframeAnimationOptions] = [
  [{ transform: "translateX(-110%)" }, { transform: "translateX(260%)" }],
  { duration: 700, delay: 50, easing: "ease-out", fill: "forwards" },
];

export const SHAKE: [Keyframe[], KeyframeAnimationOptions] = [
  [
    { transform: "none" },
    { transform: "translateX(-6px)", offset: 0.25 },
    { transform: "translateX(6px)", offset: 0.75 },
    { transform: "none" },
  ],
  { duration: 320, easing: "ease-in-out" },
];

export const POP: [Keyframe[], KeyframeAnimationOptions] = [
  [{ transform: "scale(.4)" }, { transform: "scale(1)" }],
  { duration: 280, easing: "cubic-bezier(.3,1.6,.6,1)" },
];

export const LASER: [Keyframe[], KeyframeAnimationOptions] = [
  [{ top: "46px" }, { top: "160px" }],
  { duration: 1800, easing: "ease-in-out", iterations: Infinity, direction: "alternate" },
];

/** The ring around the next parcel: full in exactly the auto-advance delay. */
export const RING_MS = 1400;
export const RING: [Keyframe[], KeyframeAnimationOptions] = [
  [{ strokeDashoffset: 57 }, { strokeDashoffset: 0 }],
  { duration: RING_MS, easing: "linear", fill: "forwards" },
];
