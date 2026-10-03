import { redirect } from "next/navigation";

/** Old Système › Marchés — now the Marchés topic of Réglages. */
export default function MarketsRedirect({ params }: { params: { locale: string } }) {
  redirect(`/${params.locale}/system/settings/markets`);
}
