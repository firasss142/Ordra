# Add Delete User (soft-delete) to /users page

## Context

The `/users` page currently supports deactivate (sets `is_active=false`, returns open orders to pool, user can still log in is blocked but row is intact) and reactivate. There is no way to *remove* a user.

A true SQL `DELETE` is not feasible: multiple tables hold `NOT NULL` FKs to `users(id)` without `ON DELETE` semantics — notably `user_audit_log.target_id`, `warehouse_print_log.printed_by`, `products.created_by`, `alert_acknowledgements.actor_id`. Deleting an experienced user would either fail or destroy historical records.

**Decisions captured from clarification:**
- Soft-delete: add `deleted_at TIMESTAMPTZ` to `users`. Auth user is removed (so they cannot log in), but the `users` row is preserved so every historical FK still resolves.
- **super_admin only** can trigger delete. Market managers keep deactivate, never see Delete.
- Open orders are auto-returned to pool at delete time (same path as deactivate).
- Deleted users are **hidden completely** from `/users` — the workspace API filters them out. Historical joins (order_history, audit log, etc.) still resolve their name.
- Audit log is preserved unchanged (no schema change needed) because soft-delete does not destroy any rows.

## Files to change

### 1. Migration — new file

`supabase/migrations/20260530000001_users_soft_delete.sql`

```sql
-- Soft-delete column on users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS users_deleted_at_idx
  ON users(deleted_at) WHERE deleted_at IS NOT NULL;
```

No FK changes needed. No RLS changes — existing market-isolation policies still apply; the API layer filters `deleted_at IS NULL`.

### 2. API — new DELETE handler

`src/app/api/agents/[id]/route.ts`

Add `export async function DELETE(req, { params })` modeled on the existing `PATCH` handler (lines 36–164). Steps:

1. `getActor(req)` — reuse existing helper.
2. **Gate strictly to super_admin** (not `canManageAgents`): `if (actor.role !== "super_admin") return 403`.
3. Look up target user, 404 if not found, 409 if already `deleted_at IS NOT NULL`.
4. Return open orders to pool — reuse `returnToPool()` from `@/lib/orders` and the existing `REASSIGN_STATUSES` constant at the top of the file. Same loop as deactivate (lines 95–105).
5. `admin.auth.admin.deleteUser(id)` — pattern already used in `src/app/api/users/route.ts` (the POST rollback path) and the existing `createAdminClient()` import on line 2 of this file.
6. UPDATE users set `deleted_at = now(), is_active = false`. Do not null other fields — keep name/email for historical joins.
7. `writeAuditLog(admin, actor.id, id, "user_deleted", { orders_returned })` — reuse existing helper at lines 21–34.
8. Return `{ success: true, ordersReturned }`.

**Auth-delete failure handling**: if `auth.admin.deleteUser` fails, do NOT proceed to the DB update — return 500 with the error. Acceptable to leave orders already returned to the pool; the admin can retry and the second call is idempotent on `returnToPool` for already-unassigned orders (no-op).

### 3. API — filter deleted users from the workspace list

`src/app/api/users/route.ts` (GET handler)

Add `.is("deleted_at", null)` to the `users` query so deleted users disappear from the workspace entirely.

### 4. Hook — wire `deleteUser`

`src/hooks/useUsersWorkspace.ts`

Add a `deleteUser(id)` method modeled on `deactivateUser` (lines 29–42):

```ts
async function deleteUser(id: string): Promise<{ ordersReturned: number }> {
  const res = await fetch(`/api/agents/${id}`, { method: "DELETE" });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Erreur lors de la suppression");
  await mutate();
  return { ordersReturned: body.ordersReturned ?? 0 };
}
```

Export it from the hook return object alongside the others.

### 5. UI — Delete confirmation modal

`src/components/admin/DeleteUserFlow.tsx` (new file)

Single-step confirmation modal modeled on the *second step* of `DeactivateUserFlow.tsx` (lines 1–60 give the FocusTrap / Escape / loading pattern). No reason picker — just:

- Title: `t("deleteConfirmTitle", { name })`
- Body: `t("deleteConfirmBody")` — explicit "irreversible, user can no longer log in, open orders will be returned to pool"
- Cancel + red Delete button (`#B91C1C`)
- On confirm → `onDelete(id)`, on success → toast `t("deletedWithCount", { count: ordersReturned })`

### 6. UI — Delete menu item

`src/components/admin/UserCard.tsx`

Add a new `onDelete` prop. Inside the dropdown menu (lines 218–268), after the Deactivate/Reactivate entry, add:

```tsx
{actorRole === "super_admin" && (
  <button
    onClick={() => { setMenuOpen(false); onDelete(); }}
    style={{ ...menuItemStyle, color: "#B91C1C" }}
  >
    <Trash2 size={14} />
    {t("delete")}
  </button>
)}
```

Import `Trash2` from `lucide-react` alongside the existing icons on line 5.

### 7. UI — Plumb through UserRoleSection

`src/components/admin/UserRoleSection.tsx`

Add `onDelete: (user: UserWithStats) => void` to `Props` and forward to each `<UserCard onDelete={() => onDelete(u)} />`.

### 8. UI — Wire into UsersPageClient

`src/app/[locale]/(dashboard)/users/UsersPageClient.tsx`

- Pull `deleteUser` from `useUsersWorkspace()`.
- Add `const [deletingUser, setDeletingUser] = useState<UserWithStats | null>(null);`
- Pass `onDelete={(u) => setDeletingUser(u)}` to `<UserRoleSection>`.
- Render `<DeleteUserFlow>` near the existing `<DeactivateUserFlow>` block (lines 155–169).

### 9. Translations

`src/messages/fr.json` and `src/messages/ar.json` — under the `users` key, add:

- `delete` — "Supprimer" / "حذف"
- `deleteConfirmTitle` — "Supprimer définitivement {name} ?" / "حذف {name} نهائياً؟"
- `deleteConfirmBody` — "Cette action est irréversible. L'utilisateur ne pourra plus se connecter et ses commandes en cours seront retournées au pool." / equivalent Arabic
- `deletedWithCount` — "Utilisateur supprimé. {count, plural, =0 {} one {1 commande retournée} other {# commandes retournées}}"

### 10. Tests (TDD — write first)

- `src/app/api/agents/[id]/route.test.ts` — add a `describe("DELETE")` block covering:
  - 403 when actor is not super_admin (market_manager included)
  - 404 when target not found
  - 409 when target already deleted (`deleted_at` not null)
  - Happy path: calls `auth.admin.deleteUser`, sets `deleted_at`, calls `returnToPool` for each open order, writes `user_deleted` audit row, returns `ordersReturned` count
  - Failure path: when `auth.admin.deleteUser` errors, returns 500 and does NOT set `deleted_at`
- `src/components/admin/__tests__/DeleteUserFlow.test.tsx` (new) — modeled on existing `DeactivateUserFlow.test.tsx` if it exists; otherwise on the patterns in `src/components/admin/__tests__/`. Verify confirm calls `onDelete`, escape closes, focus is trapped, loading state disables the button.

Follow `.claude/skills/test-driven-development/SKILL.md`: write the failing test, watch it fail, then implement.

## Verification

1. `npm test -- agents` — new DELETE tests pass.
2. `npm test -- DeleteUserFlow` — modal tests pass.
3. `npm run typecheck` — no errors.
4. `npx supabase db reset` (or apply the migration to a branch) — verify the `deleted_at` column exists and the partial index is created.
5. `npm run dev` and manually:
   - Sign in as super_admin → /users → open the menu on an active user → Delete option visible (red).
   - Confirm in the modal. Toast appears with the orders-returned count. User disappears from the list.
   - Try to sign in as the deleted user → blocked (auth user is gone).
   - Sign in as market_manager → /users → the Delete option is NOT visible in any menu.
   - Check `user_audit_log` directly: a `user_deleted` row exists with the actor's id.
   - Check `orders` previously assigned to the deleted user: `assigned_to` is null and a returned-to-pool order_history row exists.
