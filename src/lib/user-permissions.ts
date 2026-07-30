import type { Role } from "@/types";

export interface PermissionItem {
  key: string;
  allowed: boolean;
}

const PERMISSION_KEYS = [
  "canConfirmOrders",
  "canViewAllOrders",
  "canManageAgents",
  "canViewFinances",
  "canAccessSettings",
  "canScanWarehouse",
  "canManageProducts",
  "canInviteUsers",
] as const;

type PermissionKey = (typeof PERMISSION_KEYS)[number];

const ROLE_PERMISSIONS: Record<Role, Record<PermissionKey, boolean>> = {
  super_admin: {
    canConfirmOrders: true,
    canViewAllOrders: true,
    canManageAgents: true,
    canViewFinances: true,
    canAccessSettings: true,
    canScanWarehouse: true,
    canManageProducts: true,
    canInviteUsers: true,
  },
  market_manager: {
    canConfirmOrders: false,
    canViewAllOrders: true,
    canManageAgents: true,
    canViewFinances: false,
    canAccessSettings: true,
    canScanWarehouse: true,
    canManageProducts: false,
    canInviteUsers: true,
  },
  agent: {
    canConfirmOrders: true,
    canViewAllOrders: false,
    canManageAgents: false,
    canViewFinances: false,
    canAccessSettings: false,
    canScanWarehouse: false,
    canManageProducts: false,
    canInviteUsers: false,
  },
  warehouse_agent: {
    canConfirmOrders: false,
    canViewAllOrders: false,
    canManageAgents: false,
    canViewFinances: false,
    canAccessSettings: false,
    canScanWarehouse: true,
    canManageProducts: false,
    canInviteUsers: false,
  },
  // Investors are external and read-only. They see their own portfolio through
  // dedicated server-computed endpoints, never a staff capability.
  // canViewFinances stays false: it gates the internal FINANCES sidebar section
  // (market P&L, ad spend, stock), which is whole-business data.
  investor: {
    canConfirmOrders: false,
    canViewAllOrders: false,
    canManageAgents: false,
    canViewFinances: false,
    canAccessSettings: false,
    canScanWarehouse: false,
    canManageProducts: false,
    canInviteUsers: false,
  },
};

export function getPermissionsForRole(role: Role): PermissionItem[] {
  const map = ROLE_PERMISSIONS[role];
  return PERMISSION_KEYS.map((key) => ({ key, allowed: map[key] }));
}
