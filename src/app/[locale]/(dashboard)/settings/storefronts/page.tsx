import { redirect } from "next/navigation";

/** Legacy route — shops live in Réglages › Boutiques. */
export default function StorefrontsSettingsPage({ params }: { params: { locale: string } }) {
  redirect(`/${params.locale}/system/settings/shops`);
}
