"use client";

import { SWRConfig } from "swr";
import { defaultSwrConfig } from "@/lib/swr-config";

export function SWRProvider({ children }: { children: React.ReactNode }) {
  return <SWRConfig value={defaultSwrConfig}>{children}</SWRConfig>;
}
