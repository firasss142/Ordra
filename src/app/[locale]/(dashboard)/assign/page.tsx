import { redirect } from "next/navigation";

// Legacy route — assignment now lives on the orders page as the default
// "unassigned" tab view (assignment board). Kept as a redirect for bookmarks.
export default async function AssignPage({
  params,
}: {
  params: { locale: string };
}) {
  redirect(`/${params.locale}/orders?preset=unassigned`);
}
