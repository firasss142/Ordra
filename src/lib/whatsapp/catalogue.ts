/**
 * Customer-facing template text, in the CUSTOMER's language.
 *
 * Lives here and not in messages/*.json for the same reason the five wa.me
 * texts did (src/lib/delivery/whatsapp-templates.ts): next-intl holds the
 * agent's interface language, and a French-speaking agent must still be able
 * to send the Arabic message a Libyan customer needs.
 *
 * Every entry is submitted to Meta as a template named `ordra_<key>_v1` in
 * both languages (« Créer les modèles Ordra » on the Modèles page). Meta's
 * rules, checked by catalogue.test.ts: placeholders numbered 1..n, a body
 * that neither starts nor ends with a variable, an example for each
 * variable, an opt-out footer on MARKETING templates. Editing a text here
 * means a `_v2` in Meta — an approved template's body is frozen.
 */
import type { CustomerLang, LifecycleEventKey, TemplateCategory, TemplateVariable } from "./types";

export type CatalogueKey =
  | LifecycleEventKey
  | "before_delivery"
  | "courier_no_answer"
  | "delayed_confirm_time"
  | "returning_last_chance"
  | "address_check"
  | "product_share"
  | "prospect_follow_up";

export interface CatalogueTemplate {
  key: CatalogueKey;
  category: TemplateCategory;
  /** The lifecycle event this template serves automatically; null = agent-only or marketing. */
  eventKey: LifecycleEventKey | null;
  /** Offered in the agent composer's chip row. */
  agentVisible: boolean;
  headerFormat: "IMAGE" | null;
  variables: TemplateVariable[];
  body: Record<CustomerLang, string>;
  footer?: Record<CustomerLang, string>;
}

const OPT_OUT_FOOTER: Record<CustomerLang, string> = {
  fr: "Répondez STOP pour ne plus recevoir nos messages.",
  ar: "أرسل توقف لإيقاف رسائلنا.",
};

export const CATALOGUE: readonly CatalogueTemplate[] = [
  // ── Lifecycle (automatic, per-market toggle, default OFF) ────────────────
  {
    key: "could_not_reach",
    category: "UTILITY",
    eventKey: "could_not_reach",
    agentVisible: false,
    headerFormat: null,
    variables: ["name", "order_ref"],
    body: {
      fr: "Bonjour {{1}}, nous avons essayé de vous joindre pour confirmer votre commande {{2}}, sans succès.\nRépondez à ce message ou dites-nous quand vous rappeler.",
      ar: "مرحباً {{1}}، حاولنا الاتصال بك لتأكيد طلبك {{2}} دون رد.\nردّ على هذه الرسالة أو أخبرنا بالوقت المناسب لمعاودة الاتصال.",
    },
  },
  {
    key: "shipped",
    category: "UTILITY",
    eventKey: "shipped",
    agentVisible: false,
    headerFormat: null,
    variables: ["name", "carrier", "tracking", "amount"],
    body: {
      fr: "Bonjour {{1}}, votre colis est en route avec {{2}}.\nN° de suivi : {{3}}.\nMontant à préparer : {{4}}.\nMerci de garder votre téléphone à portée de main.",
      ar: "مرحباً {{1}}، طلبك مع {{2}} في طريقه إليك.\nرقم التتبع: {{3}}.\nالمبلغ عند الاستلام: {{4}}.\nيرجى إبقاء هاتفك قريباً منك.",
    },
  },
  {
    key: "out_for_delivery",
    category: "UTILITY",
    eventKey: "out_for_delivery",
    agentVisible: false,
    headerFormat: null,
    variables: ["name", "amount"],
    body: {
      fr: "Bonjour {{1}}, votre colis est en cours de livraison aujourd'hui.\nMontant à préparer : {{2}}.\nLe livreur vous appellera avant de passer.",
      ar: "مرحباً {{1}}، طلبك قيد التوصيل اليوم.\nالمبلغ عند الاستلام: {{2}}.\nسيتصل بك المندوب قبل الوصول.",
    },
  },
  {
    key: "last_chance",
    category: "UTILITY",
    eventKey: "last_chance",
    agentVisible: false,
    headerFormat: null,
    variables: ["name"],
    body: {
      fr: "Bonjour {{1}}, nous n'avons pas pu vous livrer votre colis. Il repartira en retour si nous n'avons pas de vos nouvelles aujourd'hui.\nRépondez à ce message pour fixer un nouveau passage.",
      ar: "مرحباً {{1}}، لم نتمكن من تسليم طلبك. سيُعاد الطرد إذا لم نسمع منك اليوم.\nردّ على هذه الرسالة لتحديد موعد جديد للتسليم.",
    },
  },
  {
    key: "delivered",
    category: "UTILITY",
    eventKey: "delivered",
    agentVisible: false,
    headerFormat: null,
    variables: ["name"],
    body: {
      fr: "Bonjour {{1}}, votre colis a bien été remis. Merci pour votre confiance et à bientôt.",
      ar: "مرحباً {{1}}، تم تسليم طلبك بنجاح. شكراً لثقتك ونتمنى أن نراك قريباً.",
    },
  },

  // ── Agent set (picked by hand from /delivery and the order panel) ─────────
  {
    key: "before_delivery",
    category: "UTILITY",
    eventKey: null,
    agentVisible: true,
    headerFormat: null,
    variables: ["name", "carrier", "amount"],
    body: {
      fr: "Bonjour {{1}}, votre colis est en route avec {{2}}.\nMontant à préparer : {{3}}.\nPouvez-vous confirmer l'adresse et l'heure ?",
      ar: "مرحباً {{1}}، طلبك مع {{2}} في طريقه إليك.\nالمبلغ عند الاستلام {{3}}.\nهل يمكنك تأكيد العنوان ووقت الاستلام؟",
    },
  },
  {
    key: "courier_no_answer",
    category: "UTILITY",
    eventKey: null,
    agentVisible: true,
    headerFormat: null,
    variables: ["name", "courier"],
    body: {
      fr: "Bonjour {{1}}, le livreur {{2}} a essayé de vous joindre sans succès.\nQuel créneau vous convient ?",
      ar: "مرحباً {{1}}، حاول المندوب {{2}} الاتصال بك دون رد.\nمتى يناسبك الاستلام؟",
    },
  },
  {
    key: "delayed_confirm_time",
    category: "UTILITY",
    eventKey: null,
    agentVisible: true,
    headerFormat: null,
    variables: ["name"],
    body: {
      fr: "Bonjour {{1}}, votre livraison est reportée.\nQuel jour et quelle heure vous conviennent ?",
      ar: "مرحباً {{1}}، تم تأجيل التسليم.\nأي يوم وأي ساعة تناسبك؟",
    },
  },
  {
    key: "returning_last_chance",
    category: "UTILITY",
    eventKey: null,
    agentVisible: true,
    headerFormat: null,
    variables: ["name"],
    body: {
      fr: "Bonjour {{1}}, votre colis repart en retour.\nSi vous le voulez toujours, répondez aujourd'hui.",
      ar: "مرحباً {{1}}، طردك في طريق الإرجاع.\nإن كنت لا تزال تريده، ردّ اليوم ونعيد التسليم.",
    },
  },
  {
    key: "address_check",
    category: "UTILITY",
    eventKey: null,
    agentVisible: true,
    headerFormat: null,
    variables: ["name", "address"],
    body: {
      fr: "Bonjour {{1}}, pour livrer sans erreur, confirmez-vous l'adresse :\n{{2}} ?",
      ar: "مرحباً {{1}}، لنوصل بلا خطأ، هل تؤكد العنوان:\n{{2}}؟",
    },
  },

  // ── Marketing (product sheet share, prospects) ───────────────────────────
  {
    key: "product_share",
    category: "MARKETING",
    eventKey: null,
    agentVisible: true,
    headerFormat: "IMAGE",
    variables: ["name", "product", "amount"],
    body: {
      fr: "Bonjour {{1}}, voici {{2}} à {{3}}, livraison et paiement à la réception.\nRépondez à ce message pour commander.",
      ar: "مرحباً {{1}}، إليك {{2}} بسعر {{3}}، التوصيل والدفع عند الاستلام.\nردّ على هذه الرسالة للطلب.",
    },
    footer: OPT_OUT_FOOTER,
  },
  {
    key: "prospect_follow_up",
    category: "MARKETING",
    eventKey: null,
    agentVisible: true,
    headerFormat: null,
    variables: ["name", "product", "discount"],
    body: {
      fr: "Bonjour {{1}}, vous vous étiez intéressé(e) à {{2}}. Nous vous proposons {{3}} si vous commandez aujourd'hui.\nRépondez à ce message pour en profiter.",
      ar: "مرحباً {{1}}، كنت مهتماً بـ {{2}}. نقدّم لك {{3}} إذا طلبت اليوم.\nردّ على هذه الرسالة للاستفادة من العرض.",
    },
    footer: OPT_OUT_FOOTER,
  },
];

/** Example values Meta requires for each placeholder at submission. */
export const SAMPLE_VALUES: Record<CustomerLang, Record<TemplateVariable, string>> = {
  fr: {
    name: "Amel",
    order_ref: "TN-1042",
    carrier: "Navex",
    tracking: "NX48213",
    amount: "89 TND",
    product: "Sérum vitamine C",
    city: "Sousse",
    address: "12 rue de Carthage, Sousse",
    discount: "-20 %",
    agent: "Sami",
    courier: "Karim",
  },
  ar: {
    name: "نور",
    order_ref: "LY-2081",
    carrier: "درب السبيل",
    tracking: "DA91203",
    amount: "150 LYD",
    product: "كريم مرطب",
    city: "طرابلس",
    address: "شارع الجمهورية، طرابلس",
    discount: "خصم 20%",
    agent: "أحمد",
    courier: "علي",
  },
};

export function catalogueEntry(key: string): CatalogueTemplate | undefined {
  return CATALOGUE.find((e) => e.key === key);
}

/** Meta template name for a catalogue entry. A revised text is `_v2`. */
export function templateNameFor(key: CatalogueKey, version = 1): string {
  return `ordra_${key}_v${version}`;
}

export const OPT_OUT_FOOTER_TEXT = OPT_OUT_FOOTER;
