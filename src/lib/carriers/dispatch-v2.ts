// Currently unused — carrier dispatch is handled manually by managers via fulfillment progression.
import { getCarrierAdapter } from "./adapter";
import type { CarrierConfig, CarrierDispatchResult, OrderForDispatch } from "@/types/carrier";

export async function dispatchOrder(
  order: OrderForDispatch,
  config: CarrierConfig,
  extra?: Record<string, unknown>
): Promise<CarrierDispatchResult> {
  try {
    const adapter = getCarrierAdapter(config.carrier_type);
    const payload = adapter.formatPayload(order, config, extra);
    const response = await adapter.dispatch(payload, config);
    return await adapter.parseResponse(response);
  } catch (err) {
    return {
      success: false,
      error_message: err instanceof Error ? err.message : "Erreur inattendue",
      raw_response: {},
    };
  }
}
