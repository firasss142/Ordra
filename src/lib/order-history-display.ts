type JsonRecord = Record<string, unknown>;

const FRENCH_FIELD_LABELS: Record<string, string> = {
  customer_name: "nom",
  customer_phone: "telephone",
  customer_phone_2: "telephone 2",
  customer_address: "adresse",
  customer_city: "ville",
  customer_note: "note",
  product: "produit",
  product_id: "produit",
  variant: "variante",
  variant_id: "variante",
  city: "ville",
  city_id: "ville",
  dexpress_state_id: "ville",
  quantity: "quantite",
  delivery_fee: "frais de livraison",
  card_payment: "paiement par carte",
};

const ARABIC_FIELD_LABELS: Record<string, string> = {
  customer_name: "الاسم",
  customer_phone: "الهاتف",
  customer_phone_2: "الهاتف 2",
  customer_address: "العنوان",
  customer_city: "المدينة",
  customer_note: "الملاحظة",
  product: "المنتج",
  product_id: "المنتج",
  variant: "الخيار",
  variant_id: "الخيار",
  city: "المدينة",
  city_id: "المدينة",
  dexpress_state_id: "المدينة",
  quantity: "الكمية",
  delivery_fee: "رسوم التوصيل",
  card_payment: "الدفع بالبطاقة",
};

const FRENCH_EXACT_NOTES: Record<string, string> = {
  "Order received via webhook": "Commande re\u00e7ue via webhook",
  "Order received via Google Sheets sync": "Commande re\u00e7ue via Google Sheets",
  "Order created manually": "Commande cr\u00e9\u00e9e manuellement",
  "Order created by agent (self-assigned)": "Commande cr\u00e9\u00e9e manuellement",
  "Assigned to agent": "Assign\u00e9e \u00e0 l'agent",
  "Reassigned to agent": "R\u00e9assign\u00e9e \u00e0 l'agent",
  "Cancelled via storefront webhook": "Supprim\u00e9e",
  "Scheduled dispatch cancelled": "Livraison planifi\u00e9e annul\u00e9e",
  "Livraison planifiee annulee": "Livraison planifi\u00e9e annul\u00e9e",
  "Livraison planifiée annulée": "Livraison planifi\u00e9e annul\u00e9e",
  "Livraison planifiÃ©e annulÃ©e": "Livraison planifi\u00e9e annul\u00e9e",
  "Dispatched to carrier": "Envoy\u00e9e au transporteur",
};

const ARABIC_EXACT_NOTES: Record<string, string> = {
  "Order received via webhook": "تم استلام الطلب من تكامل المتجر",
  "Order received via Google Sheets sync": "تم استلام الطلب من جداول جوجل",
  "Order created manually": "تم إنشاء الطلب يدويا",
  "Order created by agent (self-assigned)": "تم إنشاء الطلب يدويا وتعيينه للوكيل",
  "Assigned to agent": "تم تعيين الطلب للوكيل",
  "Reassigned to agent": "تمت إعادة تعيين الطلب للوكيل",
  "Cancelled via storefront webhook": "تم إلغاء الطلب من المتجر",
  "Order manually deleted": "تم حذف الطلب يدويا",
  "Force cancel": "تم إلغاء الطلب يدويا",
  "Pas de réponse": "لم يتم الرد",
  "Scheduled dispatch cancelled": "تم إلغاء التوصيل المجدول",
  "Livraison planifiée annulée": "تم إلغاء التوصيل المجدول",
  "Livraison planifiee annulee": "تم إلغاء التوصيل المجدول",
  "Livraison planifiÃ©e annulÃ©e": "تم إلغاء التوصيل المجدول",
  "Dispatched to carrier": "تم إرسال الطلب إلى شركة التوصيل",
};

function parseJsonRecord(note: string): JsonRecord | null {
  if (!note.trim().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(note) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as JsonRecord;
  } catch {
    return null;
  }
}

function labelForField(key: string, locale: string): string {
  const labels = locale === "ar" ? ARABIC_FIELD_LABELS : FRENCH_FIELD_LABELS;
  return labels[key] ?? key.replace(/_/g, " ");
}

function formatJsonEditNote(note: string, locale: string): string | null {
  const parsed = parseJsonRecord(note);
  if (!parsed) return null;

  const fields = Object.keys(parsed)
    .filter((key) => parsed[key] !== undefined)
    .map((key) => labelForField(key, locale));

  if (fields.length === 0) return null;
  const separator = locale === "ar" ? "، " : ", ";
  return locale === "ar"
    ? `تم تحديث: ${fields.join(separator)}`
    : `Mis \u00e0 jour : ${fields.join(separator)}`;
}

function normalizeHistoryNote(note: string): string {
  return note
    .normalize("NFC")
    .replace(/ÃƒÂ©|Ã©|é/g, "e")
    .replace(/ÃƒÂ¨|Ã¨|è/g, "e")
    .replace(/ÃƒÂª|Ãª|ê/g, "e")
    .replace(/ÃƒÂ |Ã |à/g, "a")
    .replace(/ÃƒÂ»|Ã»|û/g, "u")
    .replace(/[’]/g, "'")
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function formatArabicPatternNote(note: string): string | null {
  const normalized = normalizeHistoryNote(note);

  let match = normalized.match(/^Confirme par l'agent$/i);
  if (match) return "تم التأكيد من الوكيل";

  match = normalized.match(/^Confirme par le manager$/i);
  if (match) return "تم التأكيد من المدير";

  match = normalized.match(/^Rappel prevu pour\s+(.+)$/i);
  if (match) return `تمت جدولة معاودة الاتصال: ${match[1]}`;

  match = normalized.match(/^Rappel reprogramme pour\s+(.+)$/i);
  if (match) return `تمت إعادة جدولة معاودة الاتصال: ${match[1]}`;

  match = normalized.match(/^Rappel programme apres tentative\s+(\d+)$/i);
  if (match) return `تمت جدولة معاودة الاتصال بعد المحاولة ${match[1]}`;

  match = normalized.match(/^Pas de reponse\s+-?\s+tentative\s+(\d+)$/i);
  if (match) return `لم يتم الرد - المحاولة ${match[1]}`;

  match = normalized.match(/^Pas de reponse\s+-?\s+rappel prevu pour\s+(.+)$/i);
  if (match) return `لم يتم الرد - تمت جدولة معاودة الاتصال: ${match[1]}`;

  match = normalized.match(/^Tentative\s+(\d+)\s+-\s+rappel programme$/i);
  if (match) return `المحاولة ${match[1]} - تمت جدولة معاودة الاتصال`;

  match = normalized.match(/^Tentative\s+(\d+)\s+-\s+pas de reponse$/i);
  if (match) return `المحاولة ${match[1]} - لم يتم الرد`;

  match = normalized.match(/^Auto-rejected: max attempts reached \(tentative (\d+)\)$/i);
  if (match) return `تم الرفض تلقائيا بعد الوصول إلى الحد الأقصى للمحاولات (${match[1]})`;

  match = normalized.match(/^Auto-rejected: max attempts \((\d+)\) reached$/i);
  if (match) return `تم الرفض تلقائيا بعد الوصول إلى الحد الأقصى للمحاولات (${match[1]})`;

  match = normalized.match(/^Auto-rejete\s+-\s+tentative\s+(\d+)\s+\(max\s+(\d+)\s+(?:atteint|depasse)\)$/i);
  if (match) return `تم الرفض تلقائيا في المحاولة ${match[1]} (الحد الأقصى ${match[2]})`;

  match = normalized.match(/^Auto-rejete\s+:\s+tentatives maximum(?: \((\d+)\))? (?:atteintes|depassees)$/i);
  if (match) {
    return match[1]
      ? `تم الرفض تلقائيا بعد بلوغ الحد الأقصى للمحاولات (${match[1]})`
      : "تم الرفض تلقائيا بعد بلوغ الحد الأقصى للمحاولات";
  }

  match = normalized.match(/^Livraison planifiee(?: \(auto\))? pour\s+(.+)$/i);
  if (match) return `تمت جدولة التوصيل: ${match[1]}`;

  match = normalized.match(/^Telecharge chez transporteur, suivi\s*:\s*(.+)$/i);
  if (match) return `تم رفع الطلب إلى شركة التوصيل - رقم التتبع: ${match[1]}`;

  match = normalized.match(/^Dispatched to carrier, tracking:\s*(.+)$/i);
  if (match) return `تم إرسال الطلب إلى شركة التوصيل - رقم التتبع: ${match[1]}`;

  match = normalized.match(/^Reouvert - code-barres annule chez transporteur$/i);
  if (match) return "تمت إعادة فتح الطلب - تم إلغاء الباركود لدى شركة التوصيل";

  match = normalized.match(/^Reouvert - annulation transporteur echouee, coordination manuelle requise$/i);
  if (match) return "تمت إعادة فتح الطلب - فشل إلغاء شركة التوصيل ويتطلب تنسيقا يدويا";

  match = normalized.match(/^Reouvert par agent$/i);
  if (match) return "تمت إعادة فتح الطلب من الوكيل";

  match = normalized.match(/^Code-barres supprime chez transporteur$/i);
  if (match) return "تم حذف الباركود لدى شركة التوصيل";

  match = normalized.match(/^Code-barres supprime localement - coordination manuelle requise chez transporteur$/i);
  if (match) return "تم حذف الباركود محليا - يتطلب تنسيقا يدويا مع شركة التوصيل";

  match = normalized.match(/^Code-barres supprime$/i);
  if (match) return "تم حذف الباركود";

  match = normalized.match(/^(?:Admin|Manager)\s+(.+)\s+a repris la commande de l'agent\s+(.+)$/i);
  if (match) return `استلم المدير ${match[1]} الطلب من الوكيل ${match[2]}`;

  match = normalized.match(/^(?:Admin|Manager)\s+(.+)\s+a pris en charge la commande non assignee$/i);
  if (match) return `استلم المدير ${match[1]} الطلب غير المعين`;

  if (/^Auto-assigned/i.test(normalized)) return "تم تعيين الطلب تلقائيا";

  match = normalized.match(UNMATCHED_CITY);
  if (match) return `المدينة غير معروفة: "${match[1]}"`;

  return null;
}

/**
 * Written by the intake when a storefront's city string matches no known
 * destination. It reached the timeline verbatim — English, in the middle of an
 * otherwise French or Arabic log. The raw value is kept, because it is the
 * thing someone has to recognise before they can map it.
 */
const UNMATCHED_CITY = /^Mapping needs review:\s*city unmatched\s*\(\s*"?(.*?)"?\s*\)$/i;

function formatFrenchPatternNote(note: string): string | null {
  let match = note.match(/^Confirm(?:e|é|Ã©) par l['’]agent$/i);
  if (match) return "Confirm\u00e9e par l'agent";

  match = note.match(/^Confirm(?:e|é|Ã©) par le manager$/i);
  if (match) return "Confirm\u00e9e par le manager";

  match = normalizeHistoryNote(note).match(UNMATCHED_CITY);
  if (match) return `Ville non reconnue : \u00ab ${match[1]} \u00bb`;

  return null;
}

export function formatOrderHistoryNote(
  note: string | null,
  locale: string,
): string | null {
  if (!note) return null;

  const jsonNote = formatJsonEditNote(note, locale);
  if (jsonNote) return jsonNote;

  if (locale === "ar") {
    return ARABIC_EXACT_NOTES[note] ?? formatArabicPatternNote(note) ?? note;
  }

  return FRENCH_EXACT_NOTES[note] ?? formatFrenchPatternNote(note) ?? note;
}
