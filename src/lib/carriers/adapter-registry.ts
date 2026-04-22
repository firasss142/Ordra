import type { CarrierAdapter } from "./types";
import { NavexAdapter } from "./navex-adapter";
import { DexpressAdapter } from "./dexpress-adapter";

const adapters: Record<string, () => CarrierAdapter> = {
  navex: () => new NavexAdapter(),
  dexpress: () => new DexpressAdapter(),
};

export function getCarrierAdapter(carrierCode: string): CarrierAdapter {
  const factory = adapters[carrierCode];
  if (!factory) {
    throw new Error(`Unknown carrier code: ${carrierCode}`);
  }
  return factory();
}
