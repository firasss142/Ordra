/**
 * Libya warehouse E2E fixture — the ONE manifest both halves read.
 *
 *   scripts/darb-sandbox.mjs    → what Darb "knows" (shipments, _ids, branches)
 *   scripts/wh-test-fixture.ts  → what the OMS holds (orders, products, carrier)
 *
 * Sharing the file is the point: a scenario whose sticker binding must succeed
 * needs the sandbox to hold the same `_id` the order's carrier_extra carries,
 * and the same `SH…` reference the lookup path sends. Two lists would drift.
 *
 * Everything here is tagged so teardown can find it by id or prefix, never by
 * name: fixed uuids under ffffffff-0000-4000-8000-…, external ids WH-TEST-…,
 * `[TEST]` in every human-readable name.
 *
 * See plans/warehouse-ly-e2e-test-fixture.md for the scenario rationale.
 */

export const TAG = "WH-TEST";
export const NAME_MARK = "[TEST]";

export const MARKETS = {
  ly: "00000000-0000-0000-0000-000000000002",
  tn: "00000000-0000-0000-0000-000000000001",
};

/** Existing storefront rows the orders hang off (both already named "Test"). */
export const STOREFRONTS = {
  ly: "624959b2-ba8e-465e-984f-18149fadc769", // "Test", shopify, LY
  tn: "1fff7a2e-dbd6-4a42-8eaf-0a9b9ee8ed6c", // "TestSF", easy_orders, TN
};

export const ACTORS = {
  admin: "7c36ad23-330c-4739-b3a7-4c724b84b4e3", // admin@oms.local (super_admin)
  agent: "e5e04699-1c88-4cbf-b4d4-1a453df71b5f", // adel@oms.local (warehouse_agent, LY)
};

/** The real Tripoli row — fees are copied from it at seed time. */
export const TRIPOLI_CARRIER = "4f1271c8-b1f2-4836-9293-8ab3d0b18e69";

export const SANDBOX = {
  host: "127.0.0.1",
  port: 4545,
  get base() {
    return `http://${this.host}:${this.port}`;
  },
  // What the carrier row's encrypted credentials decrypt to, and therefore
  // what the sandbox demands in the three Darb headers.
  apiKey: "sandbox",
  accountId: "sandbox",
  serviceId: "sandbox",
};

export const IDS = {
  carrier: "ffffffff-0000-4000-8000-000000000301",
  productA: "ffffffff-0000-4000-8000-000000000201",
  productB: "ffffffff-0000-4000-8000-000000000202",
  productTn: "ffffffff-0000-4000-8000-000000000203",
};

export const PRODUCTS = [
  {
    key: "A",
    id: IDS.productA,
    market: "ly",
    name: "[TEST] طرد اختبار المستودع — Colis test entrepôt",
    sku: "WH-TEST-A",
    stock: 12,
    threshold: 3,
    unit_cogs: 10,
    default_price: 50,
  },
  {
    key: "B",
    id: IDS.productB,
    market: "ly",
    name: "[TEST] طرد اختبار — مخزون 1",
    sku: "WH-TEST-B",
    stock: 1,
    threshold: 3,
    unit_cogs: 10,
    default_price: 50,
  },
  {
    key: "TN",
    id: IDS.productTn,
    market: "tn",
    name: "[TEST] Colis test TN",
    sku: "WH-TEST-TN",
    stock: 1,
    threshold: 0,
    unit_cogs: 10,
    default_price: 50,
  },
];

const oid = (n) => `ffffffff-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;

/** Sticker numbers the protocol scans, one per scenario key, all 7 digits. */
export const STICKERS = {
  a: "7700001",
  b: "7700002",
  c: "7700003",
  d: "7700004",
  e: "7700005",
  f: "7700006",
  g: "7700007",
  p: "7700777",
  refuse: "7799999",
};

/**
 * One object per order. Fields:
 *   status            OMS status at seed time
 *   city / area       customer_city, carrier_extra.customer_area
 *   product / qty     which test product, how many
 *   carrier           "sandbox" | null
 *   tracking          orders.tracking_number
 *   sticker           orders.carrier_sticker_ref
 *   slug              orders.carrier_status_slug
 *   extra             merged into carrier_extra (darb_assabil_id, darb_branch_group, …)
 *   benchHoursAgo     when the `uploaded` history row is stamped (the bench clock)
 *   sandbox           the shipment Darb holds, or null when Darb must not know it
 */
export const SCENARIOS = [
  {
    key: "a", id: oid(1), external_id: "WH-TEST-LY-A-TR", market: "ly", status: "uploaded",
    customer: "[TEST] أحمد الطرابلسي", phone: "0910000001", city: "طرابلس", area: "سوق الجمعة",
    product: "A", qty: 1, carrier: "sandbox", tracking: "SHTEST0001", sticker: null, slug: "pending",
    extra: { darb_assabil_id: "sbx-a", darb_branch_group: "TR" }, benchHoursAgo: 2,
    sandbox: { _id: "sbx-a", toBranchGroup: "TR", status: "pending" },
    purpose: "happy path · rouge",
  },
  {
    key: "b", id: oid(2), external_id: "WH-TEST-LY-B-BN", market: "ly", status: "uploaded",
    customer: "[TEST] سالم البنغازي", phone: "0910000002", city: "بنغازي", area: "السلماني",
    product: "A", qty: 1, carrier: "sandbox", tracking: "SHTEST0002", sticker: null, slug: "pending",
    extra: { darb_assabil_id: "sbx-b", darb_branch_group: "BN" }, benchHoursAgo: 3,
    sandbox: { _id: "sbx-b", toBranchGroup: "BN", status: "pending" },
    purpose: "vert · duplicate-sticker refusal",
  },
  {
    key: "c", id: oid(3), external_id: "WH-TEST-LY-C-ZWY", market: "ly", status: "uploaded",
    customer: "[TEST] فاطمة الزاوية", phone: "0910000003", city: "الزاوية", area: "الزاوية",
    product: "A", qty: 1, carrier: "sandbox", tracking: "SHTEST0003", sticker: null, slug: "pending",
    extra: { darb_assabil_id: "sbx-c", darb_branch_group: "ZWY" }, benchHoursAgo: 4,
    sandbox: { _id: "sbx-c", toBranchGroup: "ZWY", status: "pending" },
    purpose: "orange · refuse / down / slow modes, idempotent rebind",
  },
  {
    key: "d", id: oid(4), external_id: "WH-TEST-LY-D-SB", market: "ly", status: "uploaded",
    customer: "[TEST] خالد سبها", phone: "0910000004", city: "سبها", area: "سبها",
    product: "A", qty: 1, carrier: "sandbox", tracking: "SHTEST0004", sticker: null, slug: "pending",
    extra: { darb_assabil_id: "sbx-d", darb_branch_group: "SB" }, benchHoursAgo: 5,
    sandbox: { _id: "sbx-d", toBranchGroup: "SB", status: "pending" },
    purpose: "cyan",
  },
  {
    key: "e", id: oid(5), external_id: "WH-TEST-LY-E-RESOLVE", market: "ly", status: "uploaded",
    customer: "[TEST] مريم مصراتة", phone: "0910000005", city: "مصراتة", area: "مصراتة",
    product: "A", qty: 1, carrier: "sandbox", tracking: "SHTEST0005", sticker: null, slug: "pending",
    extra: {}, benchHoursAgo: 6,
    sandbox: { _id: "sbx-e", toBranchGroup: "MS", status: "pending" },
    purpose: "no darb id → resolve lookup · directory colour jaune · RLS write-back",
  },
  {
    key: "f", id: oid(6), external_id: "WH-TEST-LY-F-UNKNOWNCITY", market: "ly", status: "uploaded",
    customer: "[TEST] عمر القرية", phone: "0910000006", city: "قرية مجهولة", area: null,
    product: "A", qty: 1, carrier: "sandbox", tracking: "SHTEST0006", sticker: null, slug: "pending",
    extra: {}, benchHoursAgo: 7,
    sandbox: { _id: "sbx-f", toBranchGroup: null, status: "pending" },
    purpose: "zone unknown (dashed strip) · scan still allowed",
  },
  {
    key: "g", id: oid(7), external_id: "WH-TEST-LY-G-UNDERFLOW", market: "ly", status: "uploaded",
    customer: "[TEST] نور الطرابلسي", phone: "0910000007", city: "طرابلس", area: "جنزور",
    product: "B", qty: 2, carrier: "sandbox", tracking: "SHTEST0007", sticker: null, slug: "pending",
    extra: { darb_assabil_id: "sbx-g", darb_branch_group: "TR" }, benchHoursAgo: 8,
    sandbox: { _id: "sbx-g", toBranchGroup: "TR", status: "pending" },
    purpose: "bind ok → stock underflow → darb_bound:true amber",
  },
  {
    key: "h", id: oid(8), external_id: "WH-TEST-LY-H-CARRIERWH", market: "ly", status: "uploaded",
    customer: "[TEST] يوسف مخزن الناقل", phone: "0910000008", city: "طرابلس", area: "تاجوراء",
    product: "A", qty: 1, carrier: "sandbox", tracking: "SHTEST0008", sticker: null, slug: "pending",
    extra: { darb_assabil_id: "sbx-h", darb_branch_group: "TR", fulfil_from_carrier_warehouse: true },
    benchHoursAgo: 9,
    sandbox: { _id: "sbx-h", toBranchGroup: "TR", status: "pending" },
    purpose: "carrier-warehouse order · excluded from queue · API 409",
  },
  {
    key: "i", id: oid(9), external_id: "WH-TEST-LY-I-LATE", market: "ly", status: "uploaded",
    customer: "[TEST] هدى المتأخرة", phone: "0910000009", city: "طرابلس", area: "عين زارة",
    product: "A", qty: 1, carrier: "sandbox", tracking: "SHTEST0009", sticker: null, slug: "pending",
    extra: { darb_assabil_id: "sbx-i", darb_branch_group: "TR" }, benchHoursAgo: 72,
    sandbox: { _id: "sbx-i", toBranchGroup: "TR", status: "pending" },
    purpose: "late_prepare (3 d)",
  },
  {
    key: "j", id: oid(10), external_id: "WH-TEST-LY-J-STALE", market: "ly", status: "uploaded",
    customer: "[TEST] علي المنسي", phone: "0910000010", city: "طرابلس", area: "الهضبة",
    product: "A", qty: 1, carrier: "sandbox", tracking: "SHTEST0010", sticker: null, slug: "pending",
    extra: { darb_assabil_id: "sbx-j", darb_branch_group: "TR" }, benchHoursAgo: 240,
    sandbox: { _id: "sbx-j", toBranchGroup: "TR", status: "pending" },
    purpose: "never_scanned (10 d)",
  },
  {
    key: "k", id: oid(11), external_id: "WH-TEST-LY-K-RELEASED", market: "ly", status: "uploaded",
    customer: "[TEST] سعاد في الطريق", phone: "0910000011", city: "طرابلس", area: "قرقارش",
    product: "A", qty: 1, carrier: "sandbox", tracking: "SHTEST0011", sticker: null, slug: "released",
    extra: { darb_assabil_id: "sbx-k", darb_branch_group: "TR" }, benchHoursAgo: 1,
    sandbox: { _id: "sbx-k", toBranchGroup: "TR", status: "released" },
    purpose: "gone at carrier · Take disabled · server still accepts (finding)",
  },
  {
    key: "l", id: oid(12), external_id: "WH-TEST-LY-L-CONFIRMED", market: "ly", status: "confirmed",
    customer: "[TEST] رانيا المؤكدة", phone: "0910000012", city: "طرابلس", area: "الدهماني",
    product: "A", qty: 1, carrier: null, tracking: null, sticker: null, slug: null,
    extra: {}, benchHoursAgo: null,
    sandbox: null,
    purpose: "confirmed_not_uploaded · absent from queue · API INVALID_STATUS",
  },
  {
    key: "m1", id: oid(13), external_id: "WH-TEST-LY-M1-RET", market: "ly", status: "to_be_returned",
    customer: "[TEST] منى راجعة", phone: "0910000013", city: "طرابلس", area: "الفرناج",
    product: "A", qty: 1, carrier: "sandbox", tracking: "9900101", sticker: "9900101", slug: "returned",
    extra: { darb_assabil_id: "sbx-m1", darb_branch_group: "TR" }, benchHoursAgo: 96,
    sandbox: { _id: "sbx-m1", toBranchGroup: "TR", status: "returned" },
    purpose: "returns lookup by sticker → restock",
  },
  {
    key: "m2", id: oid(14), external_id: "WH-TEST-LY-M2-RET", market: "ly", status: "to_be_returned",
    customer: "[TEST] طارق التالف", phone: "0910000014", city: "بنغازي", area: "الفويهات",
    product: "A", qty: 1, carrier: "sandbox", tracking: "9900102", sticker: "9900102", slug: "returned",
    extra: { darb_assabil_id: "sbx-m2", darb_branch_group: "BN" }, benchHoursAgo: 100,
    sandbox: { _id: "sbx-m2", toBranchGroup: "BN", status: "returned" },
    purpose: "damaged · reason other + note",
  },
  {
    key: "m3", id: oid(15), external_id: "WH-TEST-LY-M3-RET", market: "ly", status: "to_be_returned",
    customer: "[TEST] ليلى أصفار", phone: "0910000015", city: "طرابلس", area: "الأندلس",
    product: "A", qty: 1, carrier: "sandbox", tracking: "000000990103", sticker: null, slug: "returned",
    extra: { darb_assabil_id: "sbx-m3", darb_branch_group: "TR" }, benchHoursAgo: 104,
    sandbox: { _id: "sbx-m3", toBranchGroup: "TR", status: "returned" },
    purpose: "leading-zero folding → redeliver (received)",
  },
  {
    key: "m4", id: oid(16), external_id: "WH-TEST-LY-M4-RET-DARBSHAPE", market: "ly", status: "to_be_returned",
    customer: "[TEST] حسن الشكل الحقيقي", phone: "0910000016", city: "طرابلس", area: "غوط الشعال",
    product: "A", qty: 1, carrier: "sandbox", tracking: "7700888", sticker: null, slug: "returned",
    extra: { darb_assabil_id: "sbx-m4", darb_branch_group: "TR" }, benchHoursAgo: 108,
    sandbox: { _id: "sbx-m4", toBranchGroup: "TR", status: "returned" },
    purpose: "real Darb return shape (plain-digit tracking, no sticker ref) → restock",
  },
  {
    key: "n", id: oid(17), external_id: "WH-TEST-TN-N-RET", market: "tn", status: "to_be_returned",
    customer: "[TEST] Amel Tunis", phone: "20000000", city: "تونس", area: null,
    product: "TN", qty: 1, carrier: null, tracking: "9900101", sticker: "9900101", slug: null,
    extra: {}, benchHoursAgo: 96,
    sandbox: null,
    purpose: "market isolation of the returns lookup · MARKET_MISMATCH",
  },
  {
    key: "o", id: oid(18), external_id: "WH-TEST-LY-O-DARBUNKNOWN", market: "ly", status: "uploaded",
    customer: "[TEST] وليد المجهول", phone: "0910000018", city: "طرابلس", area: "أبو سليم",
    product: "A", qty: 1, carrier: "sandbox", tracking: "SHTEST0404", sticker: null, slug: null,
    extra: {}, benchHoursAgo: 0.5,
    sandbox: null,
    purpose: "Darb does not know the shipment → 409 DARB_SHIPMENT_UNKNOWN",
  },
  {
    key: "p", id: oid(19), external_id: "WH-TEST-LY-P-DARBRETURN", market: "ly", status: "uploaded",
    customer: "[TEST] كريم سيرجع", phone: "0910000019", city: "طرابلس", area: "الهضبة الخضراء",
    product: "A", qty: 1, carrier: "sandbox", tracking: "SHTEST0016", sticker: null, slug: "pending",
    extra: { darb_assabil_id: "sbx-p", darb_branch_group: "TR" }, benchHoursAgo: 24,
    sandbox: { _id: "sbx-p", toBranchGroup: "TR", status: "pending" },
    purpose: "simulated Darb return via promote_darb_status → must land in the inbox",
  },
];

export const ORDER_IDS = SCENARIOS.map((s) => s.id);
export const SCENARIO_BY_KEY = Object.fromEntries(SCENARIOS.map((s) => [s.key, s]));
