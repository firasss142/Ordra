import type { ComplaintStatus, FeedbackCategory, FeedbackMoment, FeedbackSource } from "@/lib/feedback/taxonomy";
import type { PresetKey } from "@/lib/feedback/date-range";

export interface FeedbackTopic {
  id: string;
  category: FeedbackCategory;
  key: string;
  label_fr: string;
  label_ar: string;
  sort_order: number;
}

export interface FeedbackProductRef {
  id: string;
  name: string;
  image_url: string | null;
}

/** GET /api/feedback/context — what the capture window shows about the order on screen. */
export interface FeedbackContext {
  order: {
    id: string;
    ref: string;
    status: string;
    moment: FeedbackMoment;
    customer_id: string | null;
    customer_name: string;
    customer_phone: string;
    product: FeedbackProductRef | null;
  };
  /** This customer's earlier entries, whoever wrote them. */
  history: { count: number; open: number; quote: string | null };
}

/** GET /api/feedback/lookup — the inbound callback search. */
export interface FeedbackLookupCustomer {
  id: string;
  name: string;
  phone: string;
  city: string | null;
  orders: number;
  /** The customer's latest order — picking the customer picks it. */
  latest_order_id: string | null;
}

export interface FeedbackLookupOrder {
  id: string;
  ref: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  status: string;
  moment: FeedbackMoment;
  product: FeedbackProductRef | null;
  /** When it reached `delivered` / `returned`, from order_history. */
  status_at: string | null;
}

export interface FeedbackLookupResult {
  customers: FeedbackLookupCustomer[];
  orders: FeedbackLookupOrder[];
}

/** GET /api/feedback/mine — « Mes retours ». */
export interface MyFeedbackRow {
  id: string;
  created_at: string;
  category: FeedbackCategory;
  topic_id: string | null;
  body: string;
  moment: FeedbackMoment;
  status: ComplaintStatus | null;
  product: FeedbackProductRef | null;
  /** The order's customer (or the linked customer's name) — the row's « · name · #ref ». */
  customer_name: string | null;
  order_ref: string | null;
}

/** GET /api/feedback/rows — the manager's sheet. */
export interface FeedbackSheetRow {
  id: string;
  created_at: string;
  category: FeedbackCategory;
  topic_id: string | null;
  body: string;
  moment: FeedbackMoment;
  source: FeedbackSource;
  status: ComplaintStatus | null;
  needs_review: boolean;
  product: FeedbackProductRef | null;
  customer_name: string | null;
  customer_phone: string | null;
  order_id: string | null;
  order_ref: string | null;
  author: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
}

export interface FeedbackRowsResponse {
  rows: FeedbackSheetRow[];
  total: number;
}

export interface FeedbackFamily {
  id: string;
  label: string;
  imageUrl: string | null;
  productIds: string[];
}

/** GET /api/feedback/overview — every number above the sheet. */
export interface FeedbackOverviewResponse {
  today: string;
  /** The market's first validated feedback, for « Depuis le début ». */
  first: string | null;
  from: string;
  to: string;
  preset: PresetKey | null;
  hasPrev: boolean;
  families: FeedbackFamily[];
  topics: FeedbackTopic[];
  agents: { id: string; name: string }[];
  tabs: { all: number; byFamily: { id: string; count: number }[] };
  kpis: { category: FeedbackCategory; count: number; prev: number | null; series: number[] }[];
  total: number;
  mix: { category: FeedbackCategory; count: number }[];
  ranked: { category: FeedbackCategory; topicId: string | null; count: number; prev: number | null; share: number }[];
  byAgent: { id: string; name: string; count: number; byCategory: Record<FeedbackCategory, number> }[];
  agentsTotal: number;
  /** Not bound to the period: what is waiting, under the product filter. */
  complaints: { open: number; late: number };
  review: number;
}
