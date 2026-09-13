/**
 * Turns a Darb courier's freehand remark into a structured reason.
 *
 * WHY THIS EXISTS: `delivery_delayed` has never carried a reason. The only
 * place the reason exists is the courier's own note — "الزبون لم يرد ع التلفون",
 * "Cancelled by the customer" — and `promote_darb_status` throws it away. An
 * agent looking at a stalled parcel cannot tell "he did not pick up" (call the
 * second number) from "he cancelled" (stop, it is over) from "we agreed on
 * tomorrow" (do nothing at all). Those three need opposite actions.
 *
 * WHY REGEX AND NOT A MODEL: the corpus is 500-odd distinct strings drawn from
 * a vocabulary of maybe forty words. Couriers type on phones, in Libyan
 * dialect, without spaces — "لايردها", "لام يتم الرد", "مايبيها" — so the
 * variants are endless while the meanings are few. Ordered rules over
 * normalised text handle that, are auditable when an agent disputes a label,
 * and cost nothing in the sync loop. `other` is an honest answer and the
 * manager board surfaces the top unclassified remarks so these tables can grow.
 *
 * ORDER IS THE DESIGN. First match wins, so the tables run most-specific
 * first. The load-bearing cases, each pinned by a test:
 *   - "تم الغاء لانه لا يوجد رد" (cancelled BECAUSE no answer) → cancellation.
 *     The outcome already happened; the no-answer is only its cause.
 *   - "الزبون يماطل … والآن لا يرد" (stalling every day, now silent) →
 *     not_serious, which outranks both coordination and no-answer.
 *   - store-side cancellations must never be blamed on the customer, or the
 *     buyer's risk_class takes a hit for our own decision.
 */

export const REMARK_CLASSES = [
  "no_answer",
  "customer_cancelled",
  "store_cancelled",
  "not_needed",
  "refused",
  "not_serious",
  "no_cash",
  "wrong_item",
  "payment_method",
  "coordinated",
  "in_progress",
  "out_of_coverage",
  "office_pickup",
  "wrong_address",
  "duplicate",
  "other",
  "none",
] as const;

export type RemarkClass = (typeof REMARK_CLASSES)[number];

export type RemarkSource =
  | "latest_remark"
  | "latest_comment"
  | "cancellation_cause"
  | "none";

/** Classes that mean an agent should do something now. */
export const ACTIONABLE_REMARK_CLASSES: readonly RemarkClass[] = [
  "no_answer",
  "customer_cancelled",
  "not_needed",
  "refused",
  "not_serious",
  "no_cash",
  "wrong_item",
  "payment_method",
  "out_of_coverage",
  "wrong_address",
] as const;

export function isActionableRemarkClass(c: RemarkClass): boolean {
  return ACTIONABLE_REMARK_CLASSES.includes(c);
}

export interface RemarkInput {
  latestRemark?: string | null;
  latestComment?: string | null;
  cancellationCause?: string | null;
}

export interface RemarkClassification {
  class: RemarkClass;
  source: RemarkSource;
}

/**
 * Normalise Arabic so one rule covers many spellings:
 *  - strip tatweel, diacritics and the invisible marks couriers' keyboards emit
 *    (U+200B-200F, U+202A-202E) — production has remarks that begin with U+200F
 *  - fold alef forms (أ إ آ ا) and ta-marbuta/ha (ة ه), the two most common
 *    inconsistencies: "إلغاء" vs "الغاء", "الطلبيه" vs "الطلبية"
 *  - collapse whitespace
 * Deliberately NOT stripping the definite article "ال": it would turn "الغاء"
 * (cancellation) into "غاء" and break the cancellation rules.
 */
function normalise(raw: string): string {
  return raw
    .replace(/[ـ]/g, "")
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/[​-‏‪-‮﻿]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

interface Rule {
  cls: RemarkClass;
  re: RegExp;
}

/**
 * Ordered. First match wins. Within a class the alternatives are spelling
 * variants of one idea, so they can be one pattern.
 */
const RULES: Rule[] = [
  // ── Outcomes that override everything, because they already happened ──

  // Store-side cancellation. Must precede every customer rule so our own
  // decision is never recorded against the buyer.
  {
    cls: "store_cancelled",
    re: /(المتجر\s*(لغاء|لغا|الغاء|الغي|لم يصفر)|(الغاء|لغاء|بعلم)\s*(ب?علم\s*)?(من\s*)?(ال)?متجر|بي?\s*طلب من (ال)?متجر|من قبل (ال)?متجر)/,
  },

  // "Cancelled because there was no answer" — the cancellation is the outcome.
  { cls: "customer_cancelled", re: /(تم )?الغاء\s*(الطلب|الطلبيه|الحجز|الشحنه)?\s*لان/ },

  // Duplicate. Short and unambiguous, so it can run early.
  { cls: "duplicate", re: /(مكرر|متكرر|مكرار|مكراره|doublon|duplicate)/ },

  // ── The customer is deliberately stalling ──
  // Outranks coordination AND no-answer: "he says tomorrow every day and now
  // he does not answer" is neither a plan nor a missed call. "عدم مصداقية"
  // (no credibility) is the couriers' own standing phrase for this.
  {
    cls: "not_serious",
    re: /(غير\s*جاد|غير\s*جدا|جديه|التهرب|يتهرب|يماطل|يماطل|كل يوم يقول|كل يوم اندزله|كل ما\s*نكلمه|كل مره|كل مرة|مايستلمش|معاش يبي يرد|مصداقيه|مصدقيه|مصداقيه|اخلاف موعد|لم ياتي لي استلام)/,
  },

  // ── Refused at the door ──
  { cls: "refused", re: /(رفض|ارجاع بعد الوصول)/ },

  // ── Cannot pay today ──
  // Above the cancellation rules on purpose: "الغي الحجز مافيش فلوس" (cancelled
  // the booking, no money) is filed under the REASON, not the outcome. A cash
  // problem is the one cancellation a phone call can still recover — often by
  // agreeing a date after payday — so it must reach the agent as such rather
  // than disappearing into the undifferentiated "customer cancelled" pile.
  {
    cls: "no_cash",
    re: /(ماعنداش فلوس|معنداش فلوس|معنداش كاش|معنديش فلوس|مافيش فلوس|ما ?عنده? ?فلوس|لا ?املك ثمن|معنداش المبلغ|معنديش حقها|لم? فلوس|وجود سيوله|سيواله|بسب مال|لين ينزل المرتبه)/,
  },

  // ── Wrong item: right buyer, wrong parcel ──
  // Actionable and distinct from "not needed" — the sale is still alive if the
  // agent fixes the line. Before the cancellation rules, which would otherwise
  // swallow "الغاء ... مش نفس الطلبيه" and lose the reason.
  {
    cls: "wrong_item",
    re: /(مش نفس|غير مطابق|مطابقه? للمواصفات|incorrect product|replacement|استبدال|لا الون ولا المقاس|المقاس|الحجم الصغير|خطا في سعر|خطأ في سعر|السعر غير مناسب|غالطين في الشحنه|مش الطلبيه اللي|معديش طلبيه)/,
  },

  // ── Payment instrument failed (card not enabled, bank transfer instead) ──
  // A COD market with an online-payment edge: the parcel is fine, the payment
  // path is not. The agent can switch it to cash and save the delivery.
  {
    cls: "payment_method",
    re: /(بطاقه?\s*.*(مش|لا)\s*(مفعل|فعل|تدعم)|البطاقه? لا تدعم|لا تدعم الدفع|مش مفعله اون لاين|دفع الكتروني|تحويل مصرفي|امخلص تحويل|لم يصفر القيمه)/,
  },

  // ── Cancelled by the customer ──
  {
    cls: "customer_cancelled",
    re: /(cancell?ed by (the )?customer|cancelled by client|ملغي|ملغيه|ملغيه?\s*من|(الغاء|لغاء|الغي|لغي|لغا|لغاه|لغها|الغها|لغيت|لغيتها|لغايه|الغايه|لغيه|الغيها|الغاها)\s*(من\s*)?(ال)?(زبون|عميل|طلب|طلبيه|حجز|شحنه)?|(زبون|عميل)\s*(قال\s*|طلب\s*|بال)?(الغي|لغيت|لغيتها|لغاها|الغاها|لغا|الغاء|لغاء|الغاه)|بي?\s*طلب من (ال)?زبون|طلب من زبون|رغبه الزبون|customer-cancelled|قال ملغيه|قتلي الغيها|قالت الغيها|قالي الغيها|الفاء طلبيه|مانبيهش|معاش نبيه)/,
  },

  // ── No longer wanted ──
  {
    cls: "not_needed",
    re: /(no longer needed|not needed|مايبيها|مايبها|ما ?يبي|مايبش|مايبيش|ميبيش|معش يبي|معاش يبي|مش طالب|ماطلبت|م طلبت|لم اطلب|لم يطلب|لا ?يريد|لايريد|لا ?يبي|لاتخصه|مش ليها|منبهاش|منبيهش)/,
  },

  // ── Unreachable line ──
  // Before no_answer: "الرقم مقفل" is a phone state, not a missed call.
  {
    cls: "out_of_coverage",
    re: /(خارج ?(نطاق )?ال?تغطيه|خارج التعطيه|مقفل|مغلق|out of coverage|switched off)/,
  },

  // ── Collecting at the branch ──
  { cls: "office_pickup", re: /(فالمكتب|ف ?المكتب|فلمكتب|من المكتب|في المكتب|بالمكتب)/ },

  // ── Wrong place ──
  {
    cls: "wrong_address",
    re: /(طالبها ل|يبي يستلم في|يستلم (الطلبيه )?في (منتطقه|منطقه)|خرج (بنغازي|طرابلس|مصراته)|خارج (طرابلس|بنغازي)|عنوانه في|المستلم عنوانه|مكانه |مكانها |تعديل (المنطقه|الي منطقه|من طربق)|غير متواجد مكان|غير موجود في المنزل|مش موجود في المنطقه|تطلع من|برا المرج)/,
  },

  // ── Did not answer ──
  // After the outcomes above, so a resolved case is never filed as a missed
  // call. "sent him a message and he did not reply" belongs here, not in
  // coordination — which is why the reply-check precedes the message-sent rule.
  {
    cls: "no_answer",
    re: /(no response|no answer|لا ?يوجد ?ر[دا]د?|لايوجد ?ر[دا]د?|لا ?يوجد ?زد|لا ?رد|لا ?يرد|لايرد|لم ?يرد|لام ?يتم ?الرد|لم ?يتم ?رد|لم ?يتم ?الرد|زبون لم يتم رد|عدم ?الرد|عدم ?رد|عدم ?راد|ما ?يردش|مايردش|ميردش|مردش|ماردش|ما ?يرد|مايرد|مايردو|مارد ع|مفيش راد|مفيش رد|فش رد|لايردها|لا ?يراد|لايراد|لايجيب|لا ?يجيب|لايوجد استجابه|لا ?يوجد استجابه|مجاش|يسكر|سكرت عليا|سكرات عليا|حاطني حظر|حطني حظر|فالحظر|درتلي حظر|يديرلي مشغول|رقمه مشغول|فتح الخط وصكر|معاش رد|رابع يوم|ثالث يوم|ثاني يوم|تم الاتصال ثلاثه ايام|عدم الاستلام خلال|عدم استلام|صوته مش واضح|تحويل طول|الهاتف تحويل)/,
  },

  // ── Out for delivery right now ──
  // Not actionable and not a promise: the courier is mid-run. Kept separate
  // from `coordinated` so "on the way" never reads as "a date was agreed".
  {
    cls: "in_progress",
    re: /(جاري التوصيل|قيد التوصيل|جاري التسليم|سيتم تسليم الان|تم التوصيل|توا نجي|تو نجي|تو نكلمك|في طريق|ف طريق)/,
  },

  // ── A time was agreed ──
  // Last of the real classes: any of the above beats a stale promise.
  {
    cls: "coordinated",
    re: /(تنسيق|تك التنسيق|تم ?التواصل|تم ?تواصل|تم ?التوصل|تم ?الاتفاق|تم ?الاتصال ولاتفاق|تم الاتصال والاتفاق|تم ?تحديد موعد|يتم تحديد موعد|تم ارسال رساله|تم الارسال|تم الإرسال|تم ترسال|الاستلام|يستلم|بيستلم|استلم|بستلم|يستام|تستلم|عطني موعد|موعد يستلم|موعد الاستلام|التواصل|تواصل|تأجيل|تاجيل|موجل|مؤجل|اجل الاستلام|غدا|بكرا|بكره|غدوا|غدوه|غذو)/,
  },
];

function classifyText(raw: string | null | undefined): RemarkClass | null {
  if (!raw) return null;
  const text = normalise(raw);
  if (!text) return null;
  for (const rule of RULES) {
    if (rule.re.test(text)) return rule.cls;
  }
  return "other";
}

/**
 * Classify one shipment's remark material.
 *
 * Precedence: the courier's latest remark, then the conversation's latest
 * comment, then the carrier's own cancellation cause. A remark that yields
 * `other` does not mask a comment that classifies — an unreadable note should
 * never hide a usable one — but it is still reported as the source when
 * nothing else classifies, so the manager board can surface it for a new rule.
 */
export function classifyRemark(input: RemarkInput): RemarkClassification {
  const fromRemark = classifyText(input.latestRemark);
  if (fromRemark && fromRemark !== "other") {
    return { class: fromRemark, source: "latest_remark" };
  }

  const fromComment = classifyText(input.latestComment);
  if (fromComment && fromComment !== "other") {
    return { class: fromComment, source: "latest_comment" };
  }

  const fromCause = classifyText(input.cancellationCause);
  if (fromCause && fromCause !== "other") {
    return { class: fromCause, source: "cancellation_cause" };
  }

  // Nothing classified. Report `other` against whichever field actually had
  // text, so the unclassified-remarks report knows where to look.
  if (fromRemark) return { class: "other", source: "latest_remark" };
  if (fromComment) return { class: "other", source: "latest_comment" };
  if (fromCause) return { class: "other", source: "cancellation_cause" };

  return { class: "none", source: "none" };
}
