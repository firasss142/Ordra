import type { SheetCheck } from "@/lib/products/sheet-checks";
import type { ProductSignals } from "@/lib/products/signals";
import type { AgentBriefTone } from "@/types/product";

/** Shape returned by GET /api/orders/[id]/product-sheet. */

export interface ProductSheetMedia {
  id: string;
  url: string;
  alt: string | null;
  position: number;
}

export interface ProductSheetVariant {
  id: string;
  label: string;
  quantity: number;
  display_price: number;
  is_active: boolean;
  agent_note: string | null;
  /** True for the pack tier this order is actually for. */
  is_ordered: boolean;
}

export interface ProductSheetProduct {
  id: string;
  name: string;
  description: string | null;
  default_price: number | null;
  /** Lowest price the agent may agree to. super_admin-authored. */
  floor_price: number | null;
  current_stock: number;
  low_stock_threshold: number;
  is_active: boolean;
  agent_brief: string | null;
  agent_brief_tone: AgentBriefTone;
  agent_notes: string | null;
  agent_composition: string | null;
  agent_contraindications: string | null;
  agent_usage: string | null;
  agent_content_updated_at: string | null;
}

/** Minimal card for the "offer this instead" affordance. */
export interface ProductSheetCrossSell {
  id: string;
  name: string;
  image_url: string | null;
  default_price: number | null;
}

export interface ProductSheetPayload {
  /** Null when the order never resolved to a catalogue product. */
  product: ProductSheetProduct | null;
  /** The name the storefront sent, used when `product` is null. */
  raw_product_name: string;
  media: ProductSheetMedia[];
  variants: ProductSheetVariant[];
  checks: SheetCheck[];
  /** Computed outcome rates. Null only on an unmapped order. */
  signals: ProductSignals | null;
  cross_sell: ProductSheetCrossSell | null;
  /** True when the sheet is showing an alternative rather than the ordered product. */
  is_cross_sell_view: boolean;
  currency: string;
}
