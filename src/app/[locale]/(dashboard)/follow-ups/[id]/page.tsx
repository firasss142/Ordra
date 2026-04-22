"use client";

import { use } from "react";
import { useAuth } from "@/context/auth";
import { FollowUpDetail } from "@/components/follow-ups/FollowUpDetail";

export default function FollowUpDetailPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = use(params);
  const { user } = useAuth();
  if (!user) return null;

  const marketCode: "TN" | "LY" = user.locale === "ar" ? "LY" : "TN";
  return <FollowUpDetail id={id} marketCode={marketCode} locale={locale} />;
}
