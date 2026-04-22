import { NavexAdapter } from "./navex";
import { DexpressAdapter } from "./dexpress";
import type { CarrierAdapter } from "@/types/carrier";

export function getCarrierAdapter(carrierType: "navex" | "dexpress"): CarrierAdapter {
  if (carrierType === "navex") return new NavexAdapter();
  if (carrierType === "dexpress") return new DexpressAdapter();
  // TypeScript exhaustiveness guard
  const _: never = carrierType;
  throw new Error(`Unknown carrier type: ${_}`);
}
