"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth";

/**
 * The signed-in person's own photo. Saves through PUT /api/me/avatar (any
 * role), then updates the client auth context and refreshes the server-built
 * chrome (sidebar, shells) so the new face shows everywhere at once.
 * Throws on failure so the PhotoPicker can say so.
 */
export function useMyPhoto() {
  const router = useRouter();
  const { patchUser } = useAuth();

  return useCallback(
    async (dataUrl: string | null) => {
      const res = await fetch("/api/me/avatar", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: dataUrl }),
      });
      const body = (await res.json().catch(() => ({}))) as { avatar_url?: string | null; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Photo not saved");
      patchUser({ avatar_url: body.avatar_url ?? null });
      router.refresh();
    },
    [patchUser, router],
  );
}
