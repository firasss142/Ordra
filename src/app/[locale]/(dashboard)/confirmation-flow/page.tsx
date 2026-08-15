import { redirect } from "next/navigation";

/**
 * /confirmation-flow was folded into the Salle de contrôle (/team). Bookmarks
 * and the old sidebar entry land there.
 */
export default function ConfirmationFlowRedirect({ params }: { params: { locale: string } }) {
  redirect(`/${params.locale}/team`);
}
