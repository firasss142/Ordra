import { decrypt } from "@/lib/crypto";
import { getCarrierAdapter } from "./adapter-registry";
import { CarrierConfigError } from "./errors";
import type {
  CarrierOrderData,
  CarrierConfig,
  CarrierDispatchResult,
} from "./types";

export interface CarrierRow {
  id: string;
  code: string;
  api_endpoint: string | null;
  api_credentials: string | null;
  delivery_fee: number;
  return_fee: number;
}

function buildConfig(carrier: CarrierRow): CarrierConfig {
  if (!carrier.api_credentials) {
    throw new CarrierConfigError("Carrier has no API credentials configured");
  }

  let apiCredentials: Record<string, string>;
  try {
    const decrypted = decrypt(carrier.api_credentials);
    apiCredentials = JSON.parse(decrypted);
  } catch {
    throw new CarrierConfigError("Failed to parse carrier credentials");
  }

  return {
    code: carrier.code,
    apiEndpoint: carrier.api_endpoint ?? "",
    apiCredentials,
    deliveryFee: carrier.delivery_fee,
    returnFee: carrier.return_fee,
  };
}

export async function dispatchToCarrier(
  order: CarrierOrderData,
  carrier: CarrierRow,
  extra?: Record<string, unknown>
): Promise<CarrierDispatchResult> {
  const config = buildConfig(carrier);
  const adapter = getCarrierAdapter(carrier.code);

  const payload = adapter.formatPayload(order, config, extra);
  const rawResponse = await adapter.dispatch(payload, config);
  return adapter.parseResponse(rawResponse);
}
