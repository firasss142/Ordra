import { redirect } from "next/navigation";

/** Legacy route — Marchés is a topic of Réglages. */
export default function MarketsPage({ params }: { params: { locale: string } }) {
  redirect(`/${params.locale}/system/settings/markets`);
}
