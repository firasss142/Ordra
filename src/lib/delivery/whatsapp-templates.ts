/**
 * WhatsApp v1: prefilled wa.me links, logged as an action. No Business API.
 *
 * The texts live here, not in messages/*.json, on purpose: they are written
 * to the CUSTOMER, in the customer's language, which the agent toggles
 * independently of their own interface locale. next-intl only holds the
 * interface language, so a French-speaking agent could not produce the Arabic
 * message a Libyan customer needs.
 */
import { normalizePhone } from "@/lib/leads/phone";
import type { MarketCode } from "@/lib/markets";

export const TEMPLATE_KEYS = [
  "before_delivery",
  "courier_no_answer",
  "delayed_confirm_time",
  "returning_last_chance",
  "address_check",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];
export type CustomerLang = "ar" | "fr";

export interface TemplateVars {
  name: string;
  amount: string;
  currency: string;
  carrier: string;
  courier: string;
  address: string;
}

/** A run of message text; `variable` runs are highlighted in the sheet. */
export interface TemplatePart {
  text: string;
  variable: boolean;
}

type Piece = string | { v: keyof TemplateVars | "money" };

const TEXTS: Record<CustomerLang, Record<TemplateKey, Piece[]>> = {
  ar: {
    before_delivery: ["مرحباً ", { v: "name" }, "، طلبك مع ", { v: "carrier" }, " في طريقه إليك.\nالمبلغ عند الاستلام ", { v: "money" }, ".\nهل يمكنك تأكيد العنوان ووقت الاستلام؟"],
    courier_no_answer: ["مرحباً ", { v: "name" }, "، حاول المندوب ", { v: "courier" }, " الاتصال بك دون رد.\nمتى يناسبك الاستلام؟"],
    delayed_confirm_time: ["مرحباً ", { v: "name" }, "، تم تأجيل التسليم.\nأي يوم وأي ساعة تناسبك؟"],
    returning_last_chance: ["مرحباً ", { v: "name" }, "، طردك في طريق الإرجاع.\nإن كنت لا تزال تريده، ردّ اليوم ونعيد التسليم."],
    address_check: ["مرحباً ", { v: "name" }, "، لنوصل بلا خطأ، هل تؤكد العنوان:\n", { v: "address" }, "؟"],
  },
  fr: {
    before_delivery: ["Bonjour ", { v: "name" }, ", votre colis est en route avec ", { v: "carrier" }, ".\nMontant à préparer : ", { v: "money" }, ".\nPouvez-vous confirmer l'adresse et l'heure ?"],
    courier_no_answer: ["Bonjour ", { v: "name" }, ", le livreur ", { v: "courier" }, " a essayé de vous joindre sans succès.\nQuel créneau vous convient ?"],
    delayed_confirm_time: ["Bonjour ", { v: "name" }, ", votre livraison est reportée.\nQuel jour et quelle heure vous conviennent ?"],
    returning_last_chance: ["Bonjour ", { v: "name" }, ", votre colis repart en retour.\nSi vous le voulez toujours, répondez aujourd'hui."],
    address_check: ["Bonjour ", { v: "name" }, ", pour livrer sans erreur, confirmez-vous l'adresse :\n", { v: "address" }, " ?"],
  },
};

export function renderTemplate(key: TemplateKey, lang: CustomerLang, vars: TemplateVars): TemplatePart[] {
  return TEXTS[lang][key].map((piece) => {
    if (typeof piece === "string") return { text: piece, variable: false };
    const text = piece.v === "money" ? `${vars.amount} ${vars.currency}` : vars[piece.v] || "—";
    return { text, variable: true };
  });
}

export function templateText(key: TemplateKey, lang: CustomerLang, vars: TemplateVars): string {
  return renderTemplate(key, lang, vars).map((p) => p.text).join("");
}

const COUNTRY: Record<MarketCode, { code: string; digits: number }> = {
  ly: { code: "218", digits: 9 },
  tn: { code: "216", digits: 8 },
};

/** The number wa.me wants: country code + subscriber digits, no plus. */
export function toE164(phone: string | null | undefined, market: MarketCode): string | null {
  if (!phone) return null;
  const national = normalizePhone(phone);
  const { code, digits } = COUNTRY[market];
  if (!new RegExp(`^[0-9]{${digits}}$`).test(national)) return null;
  return code + national;
}

export function buildWaLink(phone: string | null | undefined, market: MarketCode, text: string): string | null {
  const e164 = toE164(phone, market);
  if (!e164) return null;
  return `https://wa.me/${e164}?text=${encodeURIComponent(text)}`;
}

/** The template that fits the parcel's situation, most urgent first. */
export function suggestTemplate(row: {
  bucket: string;
  status: string;
  remark_class: string | null;
}): TemplateKey {
  if (row.bucket === "returning") return "returning_last_chance";
  if (row.remark_class === "no_answer" || row.remark_class === "out_of_coverage") return "courier_no_answer";
  if (row.remark_class === "wrong_address") return "address_check";
  if (row.status === "delivery_delayed") return "delayed_confirm_time";
  return "before_delivery";
}
