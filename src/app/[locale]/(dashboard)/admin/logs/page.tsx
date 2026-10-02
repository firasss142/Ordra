import { redirect } from "next/navigation";

/** Journaux moved under Système: /system/logs. */
export default function LogsRedirect({ params }: { params: { locale: string } }) {
  redirect(`/${params.locale}/system/logs`);
}
