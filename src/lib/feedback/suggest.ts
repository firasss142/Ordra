import type { FeedbackCategory } from "./taxonomy";

export interface Suggestion {
  category: FeedbackCategory;
  /** A `feedback_topics.key`, or null when the category is clear but the topic is not. */
  topicKey: string | null;
}

// The keyword rules of the « Autre » import (20261002120200_customer_feedback_import.sql),
// in the same order: the first rule that matches wins. Keep the two in step.
const PAY = /(بطاقة|بالبطالة|تحويل|حوالة|موبي|بالخدمات|بطريقة اخرى|بطريقه اخرى|الدفع بالكاش)/;
const PRICE = /(غالي|غالية|تخفيض|بسعر اقل|سعرها 25|بعد سماع السعر|سمعت السعر)/;
const NOCASH = /(المبلغ|المال|فلوس|الراتب|رواتب|الكاش|كاش|ثمنها|القيمة|قادر على|حقه|فلوسي|السعر حاليا)/;
const PRODUCT = /(حفص|قالون|رواية|مصحف ?العادي|مصحف عادي|متوسط|حجم|قفازات|جهاز|قلم|هواء|الكتروني|إلكتروني|دورة|تفسيد|معجبتنيش)/;
const VERSION = /(حفص|قالون|رواية|مصحف ?العادي|مصحف عادي|متوسط|حجم|جهاز|قلم)/;
const ELSEWHERE = /(مكان آخر|مكان اخر|مكان ثاني|مكان تاني|متجر اخر|متجر آخر|متجر تاني|محل|شخص تاني|المكان الثاني|وحدة اخرى|وحده فال|شروا غيرها|شريت|شرينا|شرت|اشترت|اشترى|خديت|اخذت من)/;
const DELIVERY = /(تاخرتو|توصيل|التوصيل|مدة طويلة|الاستلام|مصر|خارج مدينتي|برا المدينة|منطقة اخرى|المجينة|المدينة)/;

/**
 * The category and topic the customer's words point to, or null when they carry no customer
 * voice at all (« لم أطلب » is a misfiled rejection, not an objection).
 */
export function suggestFromWords(text: string | null | undefined): Suggestion | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  if (PAY.test(t)) return { category: "objection", topicKey: "card" };
  if (PRICE.test(t)) return { category: "objection", topicKey: "expensive" };
  if (NOCASH.test(t)) return { category: "objection", topicKey: "nocash" };
  if (PRODUCT.test(t)) {
    return VERSION.test(t) ? { category: "suggestion", topicKey: "version" } : { category: "objection", topicKey: "expect" };
  }
  if (ELSEWHERE.test(t)) return { category: "objection", topicKey: "elsewhere" };
  if (DELIVERY.test(t)) {
    return /يشمل التوصيل/.test(t) ? { category: "objection", topicKey: "expensive" } : { category: "objection", topicKey: "delivery" };
  }
  return null;
}

/**
 * From a Darb courier remark: its class first (the same mapping as the courier suggestions in
 * 20261002120100), else its words.
 */
export function suggestFromRemark(remarkClass: string | null | undefined, text: string | null | undefined): Suggestion | null {
  switch (remarkClass) {
    case "wrong_item":
      return { category: "reclamation", topicKey: "nonconform" };
    case "payment_method":
      return { category: "objection", topicKey: "card" };
    case "no_cash":
      return { category: "objection", topicKey: "nocash" };
    case "refused":
      return { category: "objection", topicKey: /تعجبه/.test(text ?? "") ? "expect" : null };
    default:
      return suggestFromWords(text);
  }
}
