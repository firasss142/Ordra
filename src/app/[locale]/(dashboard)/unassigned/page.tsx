import { redirect } from "next/navigation";

export default function UnassignedPage({
  params,
}: {
  params: { locale: string };
}) {
  redirect(`/${params.locale}/orders?preset=unassigned`);
}
