"use client";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/context/auth";
import { LogsWorkspace } from "@/components/admin/LogsWorkspace";

export default function LogsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ locale: string }>();

  useEffect(() => {
    if (!loading && (!user || user.role !== "super_admin")) {
      router.replace(`/${params.locale}/dashboard`);
    }
  }, [loading, user, router, params.locale]);

  if (loading || !user || user.role !== "super_admin") return null;

  return <LogsWorkspace user={user} />;
}
