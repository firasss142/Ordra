import { redirect } from "next/navigation";

// Legacy route — alerts now open as a slide-over panel (bell in the sidebar).
// Kept as a redirect for bookmarks; ?alerts=open deep-links the panel open.
export default async function AlertsPage({
  params,
}: {
  params: { locale: string };
}) {
  redirect(`/${params.locale}/dashboard?alerts=open`);
}
