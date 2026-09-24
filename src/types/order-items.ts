export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  /** The ATTRIBUTE variant — this is what moves stock. */
  variant_id: string | null;
  /** Which PACK TIER was sold. Reporting only; stock moves via variant_id x quantity. */
  pack_variant_id?: string | null;
  variant_label: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  created_at: string;
  updated_at: string;
}