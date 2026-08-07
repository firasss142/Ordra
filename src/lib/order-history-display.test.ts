import { describe, expect, it } from "vitest";
import { formatOrderHistoryNote } from "./order-history-display";

describe("formatOrderHistoryNote", () => {
  it("renders known Libya action notes in Arabic", () => {
    expect(formatOrderHistoryNote("Order received via webhook", "ar")).toBe(
      "تم استلام الطلب من تكامل المتجر",
    );
    expect(formatOrderHistoryNote("Order received via Google Sheets sync", "ar")).toBe(
      "تم استلام الطلب من جداول جوجل",
    );
    expect(formatOrderHistoryNote("Pas de réponse — tentative 2", "ar")).toBe(
      "لم يتم الرد - المحاولة 2",
    );
    expect(
      formatOrderHistoryNote(
        "Auto-rejected: max attempts reached (tentative 3)",
        "ar",
      ),
    ).toBe("تم الرفض تلقائيا بعد الوصول إلى الحد الأقصى للمحاولات (3)");
  });

  it("renders older French and English system notes in Arabic for Libya", () => {
    expect(formatOrderHistoryNote("Confirmé par l'agent", "ar")).toBe(
      "تم التأكيد من الوكيل",
    );
    expect(formatOrderHistoryNote("Rappel prévu pour 21/05/2026 14:00", "ar")).toBe(
      "تمت جدولة معاودة الاتصال: 21/05/2026 14:00",
    );
    expect(formatOrderHistoryNote("Tentative 2 — rappel programmé", "ar")).toBe(
      "المحاولة 2 - تمت جدولة معاودة الاتصال",
    );
    expect(formatOrderHistoryNote("Auto-rejeté — tentative 3 (max 3 atteint)", "ar")).toBe(
      "تم الرفض تلقائيا في المحاولة 3 (الحد الأقصى 3)",
    );
    expect(formatOrderHistoryNote("Livraison planifiée (auto) pour 21/05/2026 14:00", "ar")).toBe(
      "تمت جدولة التوصيل: 21/05/2026 14:00",
    );
    expect(formatOrderHistoryNote("Téléchargé chez transporteur, suivi : DX123", "ar")).toBe(
      "تم رفع الطلب إلى شركة التوصيل - رقم التتبع: DX123",
    );
    expect(formatOrderHistoryNote("Dispatched to carrier, tracking: DX123", "ar")).toBe(
      "تم إرسال الطلب إلى شركة التوصيل - رقم التتبع: DX123",
    );
    expect(formatOrderHistoryNote("Réouvert par agent", "ar")).toBe(
      "تمت إعادة فتح الطلب من الوكيل",
    );
    expect(formatOrderHistoryNote("Code-barres supprimé chez transporteur", "ar")).toBe(
      "تم حذف الباركود لدى شركة التوصيل",
    );
    expect(formatOrderHistoryNote("Manager Sami a repris la commande de l'agent Ali", "ar")).toBe(
      "استلم المدير Sami الطلب من الوكيل Ali",
    );
    expect(formatOrderHistoryNote("Force cancel", "ar")).toBe(
      "تم إلغاء الطلب يدويا",
    );
  });

  it("keeps unknown free-text notes unchanged", () => {
    expect(formatOrderHistoryNote("Customer asked for evening delivery", "ar")).toBe(
      "Customer asked for evening delivery",
    );
  });

  it("renders edit JSON as a localized summary", () => {
    const note = JSON.stringify({
      customer_phone: "0912345678",
      city: "Tripoli",
    });

    expect(formatOrderHistoryNote(note, "ar")).toBe("تم تحديث: الهاتف، المدينة");
    expect(formatOrderHistoryNote(note, "fr")).toBe(
      "Mis à jour : telephone, ville",
    );
  });

  it("preserves the existing French system-note rendering", () => {
    expect(formatOrderHistoryNote("Order received via webhook", "fr")).toBe(
      "Commande reçue via webhook",
    );
  });
});

describe("the city-mapping note", () => {
  // The intake writes a developer string when a storefront city fails to match
  // a known destination. It reached the log verbatim — English, quoted, and
  // in the middle of an otherwise French or Arabic timeline.
  const RAW = 'Mapping needs review: city unmatched ("n/a")';

  it("reads as French in a French log, and keeps the value that failed", () => {
    const out = formatOrderHistoryNote(RAW, "fr")!;
    expect(out).not.toMatch(/mapping needs review/i);
    expect(out).toMatch(/ville non reconnue/i);
    expect(out).toContain("n/a");
  });

  it("reads as Arabic in an Arabic log", () => {
    const out = formatOrderHistoryNote(RAW, "ar")!;
    expect(out).not.toMatch(/mapping needs review/i);
    expect(out).toContain("n/a");
  });

  it("handles an unmatched city with no quotes around it", () => {
    const out = formatOrderHistoryNote("Mapping needs review: city unmatched (Tripoli)", "fr")!;
    expect(out).toMatch(/ville non reconnue/i);
    expect(out).toContain("Tripoli");
  });
});
