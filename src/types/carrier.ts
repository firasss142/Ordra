export interface CarrierConfig {
  id: string;
  market_id: string;
  carrier_type: "navex" | "dexpress";
  api_key_encrypted: string;
  sender_name: string | null;
  sender_location: string | null;
  api_base_url: string | null;
  is_active: boolean;
}

export interface CarrierDispatchResult {
  success: boolean;
  tracking_number?: string;
  error_message?: string;
  raw_response: Record<string, unknown>;
}

export interface OrderForDispatch {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  customer_city: string;
  customer_note: string | null;
  product_name: string;
  variant_label: string;
  quantity: number;
  total_price: number;
  carrier_extra?: Record<string, unknown> | null;
}

export interface CarrierVoidResult {
  success: boolean;
  supported: boolean;
  reason?: string;
}

export interface CarrierAdapter {
  formatPayload(
    order: OrderForDispatch,
    config: CarrierConfig,
    extra?: Record<string, unknown>
  ): string;

  dispatch(payload: string, config: CarrierConfig): Promise<Response>;

  parseResponse(response: Response): Promise<CarrierDispatchResult>;

  voidDispatch(trackingNumber: string, config: CarrierConfig): Promise<CarrierVoidResult>;
}
