"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { History, Info, KeyRound, Plus, Search, Trash2, User, UserCheck, UserX } from "lucide-react";
import { useUsersWorkspace } from "@/hooks/useUsersWorkspace";
import { useToast } from "@/components/ui/Toast";
import { marketIdToCode } from "@/lib/markets";
import { accessStatus, buildAccessView, type AccessFilters, type RoleTab } from "@/lib/users/access-view";
import { RoleTiles } from "@/components/admin/access/RoleTiles";
import { AccessToolbar } from "@/components/admin/access/AccessToolbar";
import { UnassignedBanner } from "@/components/admin/access/UnassignedBanner";
import { DisabledFold, UsersTable, type RowContext } from "@/components/admin/access/UsersTable";
import { UserDrawer, type DrawerAction } from "@/components/admin/access/UserDrawer";
import { CreateUserPanel } from "@/components/admin/access/CreateUserPanel";
import { DeactivateUserDialog, DeleteUserDialog, ResetPasswordDialog } from "@/components/admin/access/dialogs";
import { buttonClass } from "@/components/admin/access/parts";
import type { RowMenuItem } from "@/components/admin/access/RowMenu";
import type { AuthUser, UserWithStats } from "@/types";

type Dialog = { kind: "deactivate" | "delete" | "reset"; user: UserWithStats };

/** Presence is a time-relative fact: re-read the clock every minute. */
function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Équipe › Accès (/users) — prototypes/acces-v2.html. Who can sign in, with
 * which role and on which market: role tiles, one table, a file per person,
 * creation in three steps. Same routes and role rules as before; a manager's
 * list is already scoped by GET /api/users.
 */
export function UsersPageClient({ user }: { user: AuthUser }) {
  const t = useTranslations("users");
  const locale = useLocale();
  const { show } = useToast();
  const ws = useUsersWorkspace();
  const now = useNow();
  const admin = user.role === "super_admin";

  const [filters, setFilters] = useState<AccessFilters>({ tab: "all", market: "all", query: "", dormantOnly: false });
  const [foldOpen, setFoldOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [journalFirst, setJournalFirst] = useState(false);
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const createButton = useRef<HTMLButtonElement>(null);

  const view = useMemo(() => buildAccessView(ws.users, user.role, filters, now), [ws.users, user.role, filters, now]);
  const openUser = openId ? ws.users.find((u) => u.id === openId) ?? null : null;
  const takenEmails = useMemo(() => new Set(ws.users.map((u) => u.email)), [ws.users]);
  const ownMarket = marketIdToCode(user.market_id);

  const focusBack = (el: HTMLElement | null) => {
    if (el?.isConnected) el.focus();
  };
  const closeFile = () => {
    setOpenId(null);
    setJournalFirst(false);
    focusBack(opener.current);
  };
  const closeDialog = () => {
    setDialog(null);
    if (!openId) focusBack(opener.current);
  };
  const closeCreate = () => {
    setCreating(false);
    focusBack(createButton.current);
  };

  // One Escape, the topmost layer only. The row menu stops its own Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (dialog) closeDialog();
      else if (creating) closeCreate();
      else if (openId) closeFile();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const fail = (err: unknown) => show({ tone: "critical", message: err instanceof Error ? err.message : t("error") });

  const open = (u: UserWithStats, el: HTMLElement | null, journal = false) => {
    opener.current = el;
    setJournalFirst(journal);
    setOpenId(u.id);
  };

  const act = async (u: UserWithStats, action: DrawerAction) => {
    if (action === "reactivate") {
      try {
        await ws.reactivateUser(u.id);
        show({ message: t("toast.reactivated", { name: u.full_name }) });
      } catch (err) {
        fail(err);
      }
      return;
    }
    if (!openId) opener.current = document.activeElement as HTMLElement | null;
    setDialog({ kind: action, user: u });
  };

  const menuFor = (u: UserWithStats): RowMenuItem[] => {
    const rowButton = () => document.querySelector<HTMLElement>(`[aria-label="${CSS.escape(t("actionsFor", { name: u.full_name }))}"]`);
    const items: RowMenuItem[] = [
      { key: "open", label: t("menu.open"), icon: User, onSelect: () => open(u, rowButton()) },
      { key: "reset", label: t("menu.reset"), icon: KeyRound, onSelect: () => { opener.current = rowButton(); setDialog({ kind: "reset", user: u }); } },
      accessStatus(u) === "active"
        ? { key: "deactivate", label: t("menu.deactivate"), icon: UserX, critical: true, onSelect: () => { opener.current = rowButton(); setDialog({ kind: "deactivate", user: u }); } }
        : { key: "reactivate", label: t("menu.reactivate"), icon: UserCheck, onSelect: () => void act(u, "reactivate") },
    ];
    if (admin) items.push({ key: "journal", label: t("menu.journal"), icon: History, onSelect: () => open(u, rowButton(), true) });
    if (admin && u.id !== user.id) {
      items.push({ key: "delete", label: t("menu.delete"), icon: Trash2, critical: true, separated: true, onSelect: () => { opener.current = rowButton(); setDialog({ kind: "delete", user: u }); } });
    }
    return items;
  };

  const setWarehouse = async (u: UserWithStats, warehouseId: string | null) => {
    // Throws on failure: the control that asked shows the error beside itself.
    await ws.setWarehouse(u.id, warehouseId);
    show({ message: t("warehouse.saved") });
  };

  const setPhoto = async (u: UserWithStats, dataUrl: string | null) => {
    // Throws on failure: the picker shows the error under the photo.
    await ws.updateAvatar(u.id, dataUrl);
  };

  const ctx: RowContext = {
    now,
    showMarket: admin,
    selectedId: openId,
    isSelf: (u) => u.id === user.id,
    onOpen: (u, el) => open(u, el),
    menuFor,
    onSetWarehouse: setWarehouse,
  };

  const patch = (next: Partial<AccessFilters>) => setFilters((f) => ({ ...f, ...next }));
  const filtered = filters.query.trim() !== "" || filters.dormantOnly || filters.tab !== "all" || filters.market !== "all";

  return (
    <div dir={locale === "ar" ? "rtl" : "ltr"} className="min-h-screen bg-surface-page">
      <div className="mx-auto flex max-w-[1160px] flex-col gap-[18px] px-[16px] pb-[64px] pt-[28px] md:px-[32px]">
        <header className="flex flex-wrap items-end justify-between gap-[16px]">
          <div>
            <h1 className="m-0 text-[24px] font-bold tracking-[-.02em] text-[#15171A]">{t("title")}</h1>
            <p className="m-0 mt-[4px] text-[14px] text-[#4F555B]">
              {admin ? t("subtitleAdmin") : t("subtitleManager", { market: ownMarket ? t(`market.${ownMarket}`) : "" })}
            </p>
          </div>
          <button ref={createButton} type="button" onClick={() => setCreating(true)} className={buttonClass("primary")}>
            <Plus size={16} aria-hidden="true" />
            {t("create")}
          </button>
        </header>

        <UnassignedBanner users={view.unassignedWarehouse} onAssign={(u, el) => open(u, el)} />

        {ws.isLoading ? (
          <div role="status" aria-label={t("loading")} className="flex flex-col gap-[18px]">
            <div className="grid grid-cols-2 gap-[12px] md:grid-cols-[repeat(auto-fit,minmax(168px,1fr))]">
              {Array.from({ length: admin ? 6 : 3 }, (_, i) => (
                <span key={i} className="block h-[118px] animate-pulse rounded-[14px] bg-[#EEF0F2]" />
              ))}
            </div>
            <div className="flex flex-col gap-[14px] rounded-[14px] border border-[#ECEEF0] bg-white p-[20px]">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="flex items-center gap-[12px]">
                  <span className="block h-[36px] w-[36px] animate-pulse rounded-full bg-[#EEF0F2]" />
                  <span className="block h-[12px] animate-pulse rounded-[6px] bg-[#EEF0F2]" style={{ width: 90 + ((i * 37) % 70) }} />
                  <span className="ms-[18%] block h-[24px] animate-pulse rounded-full bg-[#EEF0F2]" style={{ width: 120 + ((i * 23) % 50) }} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <RoleTiles tiles={view.tiles} selected={filters.tab} onSelect={(tab: RoleTab) => patch({ tab })} />

            <div className="overflow-hidden rounded-[14px] border border-[#ECEEF0] bg-white">
              <AccessToolbar
                query={filters.query}
                onQuery={(query) => patch({ query })}
                market={admin ? filters.market : null}
                marketCounts={view.marketCounts}
                onMarket={(market) => patch({ market })}
                dormantCount={view.dormantCount}
                dormantOnly={filters.dormantOnly}
                onDormant={() => patch({ dormantOnly: !filters.dormantOnly })}
                resultCount={view.rows.length}
              />
              {view.rows.length > 0 ? (
                <UsersTable rows={view.rows} ctx={ctx} />
              ) : (
                <div className="px-[16px] py-[48px] text-center text-[14px] text-[#4F555B]">
                  <span aria-hidden="true" className="mx-auto mb-[12px] grid h-[44px] w-[44px] place-items-center rounded-[12px] bg-brand-bg text-brand">
                    <Search size={18} />
                  </span>
                  <p className="m-0">{filters.query.trim() ? t("emptyQuery", { query: filters.query.trim() }) : t("empty")}</p>
                  {filtered && (
                    <button type="button" onClick={() => setFilters({ tab: "all", market: "all", query: "", dormantOnly: false })} className={`${buttonClass("neutral", "sm")} mt-[14px]`}>
                      {t("clear")}
                    </button>
                  )}
                </div>
              )}
              <DisabledFold rows={view.disabled} ctx={ctx} open={foldOpen} onToggle={() => setFoldOpen((o) => !o)} />
            </div>

            <p className="m-0 flex items-center gap-[7px] px-[4px] text-[12.5px] text-[#656B72]">
              <Info size={14} aria-hidden="true" />
              {t("footnote")}
            </p>
          </>
        )}
      </div>

      {openUser && (
        <UserDrawer
          user={openUser}
          actorRole={user.role}
          isSelf={openUser.id === user.id}
          now={now}
          journalFirst={journalFirst}
          onClose={closeFile}
          onAction={(action) => void act(openUser, action)}
          onSetWarehouse={(wid) => setWarehouse(openUser, wid)}
          onSetPhoto={(dataUrl) => setPhoto(openUser, dataUrl)}
        />
      )}

      {creating && (
        <CreateUserPanel
          actorRole={user.role}
          actorMarketId={user.market_id}
          takenEmails={takenEmails}
          onClose={closeCreate}
          onCreate={async (payload) => {
            await ws.createUser(payload);
            const identifier = payload.username.trim().toLowerCase().replace(/\s+/g, ".");
            setCreating(false);
            setFilters({ tab: "all", market: "all", query: "", dormantOnly: false });
            show({ message: t("toast.created", { name: payload.username.trim(), identifier }) });
          }}
        />
      )}

      {dialog?.kind === "deactivate" && (
        <DeactivateUserDialog
          user={dialog.user}
          onClose={closeDialog}
          onConfirm={async (reason) => {
            const { ordersReturned } = await ws.deactivateUser(dialog.user.id, reason);
            closeDialog();
            show({ message: t("toast.deactivated", { name: dialog.user.full_name, count: ordersReturned }) });
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteUserDialog
          user={dialog.user}
          onClose={closeDialog}
          onConfirm={async () => {
            const { ordersReturned } = await ws.deleteUser(dialog.user.id);
            setDialog(null);
            if (openId === dialog.user.id) setOpenId(null);
            show({ message: t("toast.deleted", { name: dialog.user.full_name, count: ordersReturned }) });
          }}
        />
      )}
      {dialog?.kind === "reset" && (
        <ResetPasswordDialog
          user={dialog.user}
          onClose={closeDialog}
          onConfirm={async (password) => {
            await ws.resetPassword(dialog.user.id, password);
            closeDialog();
            show({ message: t("toast.reset") });
          }}
        />
      )}
    </div>
  );
}
