export interface CarrierMetadata {
  requiresLocationPicker: boolean;
}

const CARRIER_METADATA: Record<string, CarrierMetadata> = {
  navex: { requiresLocationPicker: false },
  dexpress: { requiresLocationPicker: true },
};

export function getCarrierMetadata(
  carrierCode: string
): CarrierMetadata {
  return CARRIER_METADATA[carrierCode] ?? { requiresLocationPicker: false };
}
