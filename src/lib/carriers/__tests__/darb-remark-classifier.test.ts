import { describe, it, expect } from "vitest";
import {
  classifyRemark,
  REMARK_CLASSES,
  type RemarkClass,
} from "../darb-remark-classifier";

/**
 * Every string below is a verbatim courier remark from production
 * (`darb_shipments.latest_remark`, sampled 2026-09-13). The couriers type
 * freehand on a phone, so the corpus is full of misspellings, missing spaces
 * and Libyan dialect — "لايردها", "لام يتم الرد", "مايبيها". The classifier is
 * regex-based precisely because the variants are endless but the vocabulary is
 * small; the tests are the corpus, not invented examples.
 *
 * What this buys: `delivery_delayed` has never carried a reason. The remark is
 * the only place the reason exists, and it is thrown away today.
 */
describe("classifyRemark", () => {
  const expectClass = (remark: string, cls: RemarkClass) =>
    expect(classifyRemark({ latestRemark: remark }).class).toBe(cls);

  describe("no_answer — the customer did not pick up", () => {
    // 40 + 18 + 13 + 8 + 7 + … — by far the largest group in production.
    const corpus = [
      "3 days no response",
      "الزبون لم يرد ع التلفون",
      "لا يوجد رد",
      "لايوجد رد من زبون",
      "الزبون لا يرد",
      "لم يتم الرد",
      "لم يرد علي الهاتف",
      "عدم رد الزبون",
      "نتصل بي مفيش راد",
      "تم الاتصال ولم يرد",
      "لام يتم الرد", // misspelling of لم
      "لايوجد رد من الزبون",
      "لايردها",
      "لا يوجد رد ابدا",
      "الزبون مايردش تم ارسال رساله",
      "الزبون لايرد على الهاتف",
      "تم الاتصال وإرسال رساله ولم يرد",
      "الزبون لم يرد",
      "لايرد علي الهاتف",
      "عدم الرد ع هاتف",
      "لم يتم الرد من الزبون",
      "تم الاتصال بالعميل ولايوجد رد",
      "مايرد عليا الزبون",
      "لايوجد استجابة",
      "الزبون لم يرد ع اتصال",
      "لا يوجد رد نهائي",
      "الزبون لا يرد على المكالمات ولا رسايل",
      "الزبون ما يردش",
      "الزبون ميردش",
      "العميل لايجيب منذ ايام",
      "الزبون مجاش للاستلام",
      "اليوم الاول لا يوجد رد",
    ];
    it.each(corpus)("%s", (r) => expectClass(r, "no_answer"));
  });

  describe("customer_cancelled — the customer called it off", () => {
    const corpus = [
      "Cancelled by the customer",
      "ملغي من الزبون",
      "الزبون قال لغيت الطلب",
      "إلغاء من الزبون",
      "إلغاء من العميل",
      "اتصلت باالزبون قال ملغية",
      "الزبون قال الغيها",
      "الزبون الغاء الطلبيه",
      "الزبون لغا الطلبيه",
      "الغاء الزبون",
      "الغاء من زبون",
      "الزبون قال لغيتها",
      "الزبون قال لغيت الحجز",
      "بطلب من الزبون",
      "الزبون قال الغي",
    ];
    it.each(corpus)("%s", (r) => expectClass(r, "customer_cancelled"));
  });

  describe("not_needed — no longer wanted", () => {
    const corpus = [
      "No longer needed",
      "مايبيها",
      "الزبون قال مش طالب",
      "الزبون قال ماطلبت شي",
      "الزبون مش طالب شي",
      "الزبون لا يريد الطلبية",
      "الزبون مايبش يستلم",
      "الزبون لايريد الاستلام",
      "الزبون لم يطلب الطلبية",
      "الزبون مايبيش يستلم الطلبيه",
      "العميل يقول الطلبيه لاتخصه",
    ];
    it.each(corpus)("%s", (r) => expectClass(r, "not_needed"));
  });

  describe("coordinated — a delivery time was agreed", () => {
    // Not actionable: the courier and customer already have a plan. Calling
    // here is noise, which is why this class must not land in "act now".
    const corpus = [
      "تم التنسيق مع الزبون",
      "تم التواصل مع الزبون",
      "تم تنسيق مع الزبون",
      "تم التنسيق",
      "الاستلام غدا",
      "يستلم اليوم",
      "بيستلم اليوم",
      "تم التواصل مع زبون",
      "تم تنسيق مع الزبونه",
      "تم ارسال رساله الي الزبون",
      "تم تواصل مع زبون",
      "الزبون بيستلم",
      "الزبون يستلم بكرا",
      "بيستلم نهاية اليوم او غداً",
      "تم التواصل مع الزبون ويستلم بكرة",
      "الزبون عطني موعد يستلم",
      "الاستلام بعد العصر",
      "أستلم بكرا",
    ];
    it.each(corpus)("%s", (r) => expectClass(r, "coordinated"));
  });

  describe("out_of_coverage — the line is unreachable", () => {
    const corpus = [
      "رقم الزبون خارج التغطيه حتى اليوم",
      "خارج التغطيه",
      "الرقم مقفل",
      "رقم الزبون مقفل",
      "الرقم المطلوب خارج نطاق التغطية",
      "الرقم المطلوب مقفل",
      "الزبون رقم الهاتف مقفل",
      "الهاتف مقفل ثلاثة أيام",
      "الزبون رقمه خارج التغطيه + رساله",
    ];
    it.each(corpus)("%s", (r) => expectClass(r, "out_of_coverage"));
  });

  describe("office_pickup — collecting at the branch", () => {
    const corpus = [
      "استلام فلمكتب",
      "الزبون قال نستلم ف المكتب",
      "الدفع بالبطاقة لم ينجح غدوة يستلم من المكتب",
    ];
    it.each(corpus)("%s", (r) => expectClass(r, "office_pickup"));
  });

  describe("not_serious — the courier has given up on this buyer", () => {
    const corpus = [
      "الزبون غير جاد لاستلام",
      "الزبون غير جاد",
      "الزبون غير جاد في الإستلام",
      "الزبون غير جاد للشراء",
      "التهرب من استلام الشحنه",
      "الزبون كل يوم يقول بكرا",
      "الزبون كل مانكلمه يقول نستلم ومايستلمش",
    ];
    it.each(corpus)("%s", (r) => expectClass(r, "not_serious"));
  });

  describe("refused — turned away at the door", () => {
    // Distinct from not_needed: the parcel physically arrived and came back.
    const corpus = [
      "الزبون رفض الشحنة",
      "الزبون رفض الطلبيه",
      "الزبون رفض الاستلام لم تعجبه تم التواصل مع المتجر",
    ];
    it.each(corpus)("%s", (r) => expectClass(r, "refused"));
  });

  describe("no_cash — wants it, cannot pay today", () => {
    // A real and separate outcome in a COD market: worth a call, not a return.
    const corpus = [
      "الزبون ماعنداش فلوس",
      "الزبون معنداش كاش",
      "الزبون يقول لا أملك ثمن الطلبية",
      "الغي الحجز مافيش فلوس",
      "الاستلام غدوة الزبون معنداش المبلغ حاليا",
    ];
    it.each(corpus)("%s", (r) => expectClass(r, "no_cash"));
  });

  describe("wrong_address — the parcel is in the wrong place", () => {
    const corpus = [
      "الزبون طالبها لراس لانوف",
      "الزبون طالبها لجالو",
      "الزبون خرج بنغازي",
      "الزبون خارج طرابلس بيستلم يوم التلاتاء",
    ];
    it.each(corpus)("%s", (r) => expectClass(r, "wrong_address"));
  });

  describe("duplicate", () => {
    const corpus = ["مكراره", "الطلبية مكررة لنفس الزبونة", "الطلبية مكرره"];
    it.each(corpus)("%s", (r) => expectClass(r, "duplicate"));
  });

  describe("fallbacks", () => {
    it("returns 'none' for nothing at all", () => {
      expect(classifyRemark({}).class).toBe("none");
      expect(classifyRemark({ latestRemark: null }).class).toBe("none");
      expect(classifyRemark({ latestRemark: "" }).class).toBe("none");
      expect(classifyRemark({ latestRemark: "   " }).class).toBe("none");
    });

    it("returns 'other' for a remark it does not recognise", () => {
      // All real, all genuinely unclassifiable.
      expect(classifyRemark({ latestRemark: "129" }).class).toBe("other");
      expect(classifyRemark({ latestRemark: "الشركة الوضوح" }).class).toBe("other");
      expect(classifyRemark({ latestRemark: "ًالسراج" }).class).toBe("other");
      expect(classifyRemark({ latestRemark: "الهلال الاحمر ليوم" }).class).toBe("other");
    });

    it("never returns a class outside the declared set", () => {
      for (const r of ["129", "لا يوجد رد", "", "تم التنسيق", "مايبيها"]) {
        expect(REMARK_CLASSES).toContain(classifyRemark({ latestRemark: r }).class);
      }
    });
  });

  describe("source precedence", () => {
    it("prefers latestRemark and says so", () => {
      const got = classifyRemark({
        latestRemark: "لا يوجد رد",
        latestComment: "تم التنسيق مع الزبون",
        cancellationCause: "customer-cancelled",
      });
      expect(got.class).toBe("no_answer");
      expect(got.source).toBe("latest_remark");
    });

    it("falls to latestComment when the remark is empty or unreadable", () => {
      const got = classifyRemark({ latestRemark: "  ", latestComment: "الزبون لا يرد" });
      expect(got.class).toBe("no_answer");
      expect(got.source).toBe("latest_comment");
    });

    it("falls to cancellationCause last", () => {
      const got = classifyRemark({ cancellationCause: "customer-cancelled" });
      expect(got.class).toBe("customer_cancelled");
      expect(got.source).toBe("cancellation_cause");
    });

    it("reports source 'none' when nothing classified", () => {
      expect(classifyRemark({}).source).toBe("none");
      // An unrecognised remark still names where it looked.
      expect(classifyRemark({ latestRemark: "129" }).source).toBe("latest_remark");
    });

    it("does not let an unrecognised remark mask a usable comment", () => {
      const got = classifyRemark({ latestRemark: "129", latestComment: "الزبون لا يرد" });
      expect(got.class).toBe("no_answer");
      expect(got.source).toBe("latest_comment");
    });
  });

  describe("ordering traps", () => {
    // These are the cases where two vocabularies collide in one sentence and
    // the FIRST matching rule decides. Each assertion below is a deliberate
    // precedence decision, not an accident of rule order.

    it("'cancelled because no answer' is a cancellation, not a no-answer", () => {
      expectClass("تم الغاء لانه لا يوجد رد", "customer_cancelled");
    });

    it("'coordinated, now not answering' is still actionable", () => {
      // The promise is stale; the agent needs to see this one.
      expectClass("الزبون يماطل كل يوم الإستلام غذا والآن لا يرد", "not_serious");
    });

    it("a store-side cancellation is not blamed on the customer", () => {
      expectClass("المتجر لغاء الطلبية", "store_cancelled");
      expectClass("بي طلب من المتجر", "store_cancelled");
      expectClass("إلغاء بعلم متجر", "store_cancelled");
    });

    it("'sent a message and no reply' is a no-answer, not coordination", () => {
      expectClass("الزبون مايرد بعتله رساله", "no_answer");
    });
  });

  it("is stable — same input, same output", () => {
    const r = "الزبون لم يرد ع التلفون";
    expect(classifyRemark({ latestRemark: r })).toEqual(classifyRemark({ latestRemark: r }));
  });
});
