"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { DeactivationReason, UserWithStats } from "@/types";

export function useUsersWorkspace() {
  const { data, mutate, isLoading } = useSWR<{ data: UserWithStats[] }>(
    "/api/users?include_stats=true",
    fetcher
  );

  async function createUser(payload: {
    username: string;
    password: string;
    role: string;
    market_id?: string;
  }): Promise<void> {
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Erreur lors de la création");
    await mutate();
  }

  async function deactivateUser(
    id: string,
    reason: DeactivationReason
  ): Promise<{ ordersReturned: number }> {
    const res = await fetch(`/api/agents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deactivate", reason }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Erreur lors de la désactivation");
    await mutate();
    return { ordersReturned: body.ordersReturned ?? 0 };
  }

  async function reactivateUser(id: string): Promise<void> {
    const res = await fetch(`/api/agents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reactivate" }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Erreur lors de la réactivation");
    await mutate();
  }

  async function resetPassword(id: string, newPassword: string): Promise<void> {
    const res = await fetch(`/api/agents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset_password", new_password: newPassword }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Erreur lors de la réinitialisation");
    await mutate();
  }

  async function deleteUser(id: string): Promise<{ ordersReturned: number }> {
    const res = await fetch(`/api/agents/${id}`, { method: "DELETE" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Erreur lors de la suppression");
    await mutate();
    return { ordersReturned: body.ordersReturned ?? 0 };
  }

  async function updateAvatar(id: string, dataUrl: string): Promise<string | null> {
    const res = await fetch(`/api/agents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_avatar", avatar: dataUrl }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Erreur lors de la mise à jour de la photo");
    await mutate();
    return body.avatar_url ?? null;
  }

  return {
    users: data?.data ?? [],
    isLoading,
    mutate,
    createUser,
    deactivateUser,
    reactivateUser,
    deleteUser,
    resetPassword,
    updateAvatar,
  };
}
