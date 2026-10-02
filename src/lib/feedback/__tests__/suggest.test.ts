import { describe, expect, test } from "vitest";
import { suggestFromWords, suggestFromRemark } from "../suggest";

// The same keyword rules as the « Autre » import (20261002120200), so the reject flow
// suggests what the import would have chosen.
describe("suggestFromWords", () => {
  test.each([
    ["قال اريد الدفع بالبطاقة", "objection", "card"],
    ["ليس لديه كاش ويريد تحويل", "objection", "card"],
    ["قال السعر غالي الغي الطلب", "objection", "expensive"],
    ["قالت الراتب لم ينزل", "objection", "nocash"],
    ["قالت لا املك المبلغ", "objection", "nocash"],
    ["تبي رواية قالون", "suggestion", "version"],
    ["قال أريد حجم متوسط", "suggestion", "version"],
    ["قال لا اريده كنت نحسابه الكتروني", "objection", "expect"],
    ["لانه من غير قفازات", "objection", "expect"],
    ["اشترت من مكان آخر", "objection", "elsewhere"],
    ["قالت الغي طلبيه لاني خارج مدينتي", "objection", "delivery"],
    ["العميل رفض بسبب التوصيل..ظن السعر يشمل التوصيل", "objection", "expensive"],
  ])("« %s » → %s · %s", (text, category, topicKey) => {
    expect(suggestFromWords(text)).toEqual({ category, topicKey });
  });

  test("a misfiled known reason is not a customer voice", () => {
    expect(suggestFromWords("لم أطلب شيئا")).toBeNull();
    expect(suggestFromWords("")).toBeNull();
  });

  test("payment wins over price when both are said — the rule order of the import", () => {
    expect(suggestFromWords("غالي و يريد الدفع بالبطاقة")).toEqual({ category: "objection", topicKey: "card" });
  });
});

describe("suggestFromRemark", () => {
  test.each([
    ["wrong_item", "مش نفس لي في نت", "reclamation", "nonconform"],
    ["payment_method", "البطاقة مش مفعلة", "objection", "card"],
    ["no_cash", "زبون قالي توا معنديش فلوس", "objection", "nocash"],
    ["refused", "الزبون رفض الاستلام لم تعجبه", "objection", "expect"],
  ])("class %s → %s · %s", (cls, text, category, topicKey) => {
    expect(suggestFromRemark(cls, text)).toEqual({ category, topicKey });
  });

  test("refused without an opinion has no topic", () => {
    expect(suggestFromRemark("refused", "الزبون رفض الشحنة")).toEqual({ category: "objection", topicKey: null });
  });

  test("a logistics class falls back to the words of the remark", () => {
    expect(suggestFromRemark("customer_cancelled", "قال السعر غالي")).toEqual({ category: "objection", topicKey: "expensive" });
    expect(suggestFromRemark("no_answer", "لا يرد")).toBeNull();
    expect(suggestFromRemark(null, null)).toBeNull();
  });
});
