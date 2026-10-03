import { redirect } from "next/navigation";

/**
 * Ancien écran Transporteurs — les transporteurs vivent dans Réglages ›
 * Livraison (liste, ajout, identifiants, frais, options). Conservé en
 * redirection : des liens et des signets pointent dessus.
 */
export default function CarriersSettingsPage({ params }: { params: { locale: string } }) {
  redirect(`/${params.locale}/system/settings/delivery`);
}
