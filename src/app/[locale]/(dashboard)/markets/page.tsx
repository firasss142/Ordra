import { redirect } from "next/navigation";

export default function MarketsPage({
  params,
}: {
  params: { locale: string };
}) {
  redirect(`/${params.locale}/settings?section=markets`);
}
