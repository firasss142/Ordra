import { redirect } from "next/navigation";

/** Legacy route — Marchés moved to /system/markets in the Système redesign. */
export default function MarketsPage({
  params,
}: {
  params: { locale: string };
}) {
  redirect(`/${params.locale}/system/markets`);
}
