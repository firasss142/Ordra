"use client";

import { createContext, useContext, type ReactNode } from "react";

const TypingActivityContext = createContext<(() => void) | null>(null);

/**
 * Broadcasts "somebody is typing in here" to every InlineField beneath it.
 *
 * A context rather than a prop threaded through CustomerCard, CustomerHero and
 * OrderItemsCard: there are seven fields today, and a prop is something the
 * eighth one silently forgets. The presence bubble would then be right for six
 * fields and wrong for one, which is worse than not having it.
 */
export function TypingActivityProvider({
  onActivity,
  children,
}: {
  onActivity: () => void;
  children: ReactNode;
}) {
  return (
    <TypingActivityContext.Provider value={onActivity}>
      {children}
    </TypingActivityContext.Provider>
  );
}

/** No provider = no signal. Safe everywhere InlineField is used. */
export function useTypingActivity(): (() => void) | null {
  return useContext(TypingActivityContext);
}
