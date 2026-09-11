"use client";

/**
 * The "…is typing" bubble, pinned to a presence head.
 *
 * MOTION — a deliberate, argued exception to design-system §7 ("no entrance
 * animations, page transitions, or transforms"):
 *
 *  - §7 exists to stop DECORATIVE motion. This is not decoration. It is the
 *    only honest way to render an action that is happening right now, and a
 *    static mark cannot distinguish "is editing" from "edited at some point".
 *  - The product already makes this exception seven times for genuinely
 *    transient states — menuDrop, slideInEnd, slideInStart, scanPop, fadeInUp,
 *    sidebar-menu-enter, sidebar-backdrop-enter.
 *  - It is confined to a ~16×9px bubble that exists ONLY while someone is
 *    actively typing, and vanishes ~4s after they stop (see useTypingMode).
 *  - It honours `prefers-reduced-motion`: the dots hold still and the bubble
 *    stays solid, so the meaning survives without the movement.
 *
 * Accessibility: aria-hidden. The head's own aria-label already reads
 * "<name> modifie cette commande depuis N min" — that stays the source of
 * truth, per §4.17 D (colour, and motion, are never the only carrier).
 *
 * The 2px border is the same trick the control-room presence dot uses: it is
 * the page colour, not a shadow, so the bubble lifts off the avatar underneath
 * without breaking "zero shadows at rest".
 */
export function TypingDots({ className = "" }: { className?: string }) {
  return (
    <span
      data-testid="typing-dots"
      aria-hidden="true"
      className={
        "typing-bubble pointer-events-none inline-flex items-center gap-[2.5px] rounded-full " +
        "border-2 border-oms-surface bg-status-action px-[4px] py-[3.5px] " +
        className
      }
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          data-typing-dot
          className="typing-dot block h-[3.5px] w-[3.5px] rounded-full bg-white"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  );
}
