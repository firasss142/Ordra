export const STATUS_LABELS: Record<string, string> = {
  new: "Nouveau",
  assigned: "Assigné",
  attempt_1: "Tentative 1",
  attempt_2: "Tentative 2",
  attempt_3: "Tentative 3",
  callback_scheduled: "Rappel prévu",
  confirmed: "Confirmé",
  dispatch_scheduled: "Livraison planifiée",
  uploaded: "Téléchargé",
  scanned: "Scanné",
  dispatched: "Expédié",
  deposit: "Dépôt",
  in_transit: "En transit",
  to_be_returned: "À retourner",
  delivered: "Livré",
  returned: "Retourné",
  rejected: "Rejeté",
  cancelled: "Annulé",
};

const STATUS_LABELS_AR: Record<string, string> = {
  new: "جديد",
  assigned: "معيّن",
  attempt_1: "محاولة 1",
  attempt_2: "محاولة 2",
  attempt_3: "محاولة 3",
  callback_scheduled: "مكالمة مجدولة",
  confirmed: "مؤكد",
  dispatch_scheduled: "توصيل مجدول",
  uploaded: "تم الرفع",
  scanned: "تم المسح",
  dispatched: "تم الإرسال",
  deposit: "إيداع",
  in_transit: "في الطريق",
  to_be_returned: "للإرجاع",
  delivered: "تم التسليم",
  returned: "مرتجع",
  rejected: "مرفوض",
  cancelled: "ملغى",
};

export function getStatusLabel(status: string, locale: string): string {
  if (locale === "ar") return STATUS_LABELS_AR[status] ?? status;
  return STATUS_LABELS[status] ?? status;
}
