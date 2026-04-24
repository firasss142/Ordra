"use client";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";

export default function WebhookLogsRedirect() {
  const router = useRouter();
  const params = useParams<{ locale: string }>();

  useEffect(() => {
    router.replace(`/${params.locale}/admin/logs`);
  }, [router, params.locale]);

  return null;
}
