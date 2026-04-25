"use client";

import { MarketsSection } from "@/components/settings/MarketsSection";
import type { AuthUser } from "@/types";

interface Props {
  user: AuthUser;
}

export function MarketsClient({ user }: Props) {
  const isRtl = user.direction === "rtl";

  return (
    <div
      style={{
        padding: 24,
        backgroundColor: "#F6F6F7",
        minHeight: "100vh",
        direction: isRtl ? "rtl" : "ltr",
      }}
    >
      <MarketsSection role={user.role} />
    </div>
  );
}
