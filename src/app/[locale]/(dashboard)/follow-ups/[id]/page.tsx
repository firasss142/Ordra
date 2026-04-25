"use client";

import { useAuth } from "@/context/auth";
import { FollowUpDetail } from "@/components/follow-ups/FollowUpDetail";

export default function FollowUpDetailPage({
  params,
}: {
  params: { id: string; locale: string };
}) {
  const { id, locale } = params;
  const { user } = useAuth();
  if (!user) return null;

  const marketCode: "TN" | "LY" = user.locale === "ar" ? "LY" : "TN";
  return <FollowUpDetail id={id} marketCode={marketCode} locale={locale} />;
}
