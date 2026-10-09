/**
 * The four starter messages of « Nouvelle liste » → WhatsApp.
 *
 * Written in the template builder's own tokens (lib/whatsapp/campaign-template:
 * {nom} {produit} {ville} {remise}, bound per lead by the drain), never
 * starting or ending on a token — Meta refuses both. « [proposé] » is not a
 * token: the products a list proposes are the same for everyone on it, so
 * they are written into the text when the manager picks the template.
 */
import { validateCampaignBody, type CampaignBodyError } from "@/lib/whatsapp/campaign-template";
import type { WaTemplate } from "./wizard";

const NEXT = "[proposé]";

export const TEMPLATES: Record<WaTemplate, { ar: string; fr: string }> = {
  new_book: {
    ar: `السلام عليكم {nom} 🌿\nنتمنى أن يكون « {produit} » قد نال إعجابك.\nوصلنا جديد: « ${NEXT} ».\n{remise}\nاضغط « نعم » ونجهّز طلبك اليوم.`,
    fr: `Bonjour {nom} 🌿\nNous espérons que « {produit} » vous plaît.\nNouveau chez nous : « ${NEXT} ».\n{remise}\nAppuyez sur « Oui » et on prépare votre commande aujourd'hui.`,
  },
  changed: {
    ar: "مرحباً {nom}،\nلاحظنا أنك تراجعت عن طلب « {produit} ». هل ما زلت مهتماً؟\n{remise}\nنحن في الخدمة.",
    fr: "Bonjour {nom},\nvous aviez renoncé à « {produit} ». Toujours intéressé ?\n{remise}\nNous sommes à votre écoute.",
  },
  returned: {
    ar: "مرحباً {nom}،\nلم نتمكن من توصيل « {produit} » إليك. هل نعيد إرساله في يوم يناسبك؟",
    fr: "Bonjour {nom},\nnous n'avons pas pu vous livrer « {produit} ». On vous le renvoie le jour qui vous arrange ?",
  },
  free: {
    ar: `عرض خاص لك يا {nom} 🎁\nتوصيل مجاني على « ${NEXT} » حتى يوم الخميس.`,
    fr: `Une offre pour vous, {nom} 🎁\nLivraison offerte sur « ${NEXT} » jusqu'à jeudi.`,
  },
};

/** The template's text with the proposed products written in (or their line dropped when there are none). */
export function templateText(tpl: WaTemplate, lang: "ar" | "fr", proposed: string[]): string {
  const raw = TEMPLATES[tpl][lang];
  if (proposed.length) return raw.split(NEXT).join(proposed.join(lang === "ar" ? " أو " : " ou "));
  return raw.split("\n").filter((line) => !line.includes(NEXT)).join("\n");
}

export const VAR_TOKENS = { name: "{nom}", got: "{produit}", city: "{ville}", offer: "{remise}" } as const;

/** The message as the sample customer reads it in the preview. */
export function fillSample(msg: string, s: { name: string; got: string; city: string; offer: string }): string {
  return msg.split("{nom}").join(s.name).split("{produit}").join(s.got).split("{ville}").join(s.city).split("{remise}").join(s.offer);
}

export function messageErrors(msg: string): CampaignBodyError[] {
  return validateCampaignBody(msg);
}
