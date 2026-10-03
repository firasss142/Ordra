"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Box, Eye, EyeOff, IdCard, MapPin, Plus } from "lucide-react";
import { LY_MARKET_ID, TN_MARKET_ID, marketIdToCode, type MarketCode } from "@/lib/markets";
import { identifierFromUsername } from "@/lib/users/access-view";
import { useWarehouseSites } from "@/hooks/useWarehouseSites";
import type { Role } from "@/types";
import { buttonClass, ROLE_ICON, TONE } from "./parts";
import { CloseButton, FormError, SidePanel } from "./layers";

export interface CreateUserPayload {
  username: string;
  password: string;
  role: string;
  market_id?: string;
  /** The building, for a warehouse agent only. Libya has two, one per Darb account. */
  warehouse_id?: string;
}

const SUPER_ADMIN_CREATABLE: Role[] = ["agent", "warehouse_agent", "market_manager", "investor"];
const MANAGER_CREATABLE: Role[] = ["agent", "warehouse_agent"];
const MARKET_ID: Record<MarketCode, string> = { tn: TN_MARKET_ID, ly: LY_MARKET_ID };

const field = "h-[40px] w-full rounded-[10px] border border-transparent bg-[#F3F4F6] px-[12px] text-[14px] text-[#15171A] transition-colors placeholder:text-[#656B72] hover:bg-[#EDEEF1] focus:border-brand focus:bg-white focus:shadow-[0_0_0_3px_var(--brand-bg)] focus:outline-none";
const label = "mb-[7px] block text-[13px] font-semibold text-[#15171A]";
const choice = "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand";

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="m-0 mb-[12px] flex items-center gap-[9px] text-[13.5px] font-semibold text-[#15171A]">
        <span aria-hidden="true" className="grid h-[22px] w-[22px] place-items-center rounded-full bg-brand-bg text-[11.5px] font-bold text-brand-hover">
          {n}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Create an account in three steps — identity, role, attachment — with the
 * login it will have shown before it exists. Same fields and payload as before;
 * the panel mounts fresh each time it opens, so nothing survives a cancel.
 */
export function CreateUserPanel({
  actorRole,
  actorMarketId,
  takenEmails,
  onClose,
  onCreate,
}: {
  actorRole: Role;
  actorMarketId: string | null;
  takenEmails: Set<string>;
  onClose: () => void;
  onCreate: (payload: CreateUserPayload) => Promise<void>;
}) {
  const t = useTranslations("users");
  const admin = actorRole === "super_admin";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [role, setRole] = useState<Role | "">("");
  const [market, setMarket] = useState<MarketCode | "">("");
  const [warehouseId, setWarehouseId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const marketId = admin ? (market ? MARKET_ID[market] : null) : actorMarketId;
  const isWarehouse = role === "warehouse_agent";
  const { sites } = useWarehouseSites(isWarehouse && marketId ? marketId : null);
  const identifier = identifierFromUsername(username);
  const taken = identifier !== "" && takenEmails.has(`${identifier}@oms.local`);
  const ready = identifier !== "" && password !== "" && role !== "" && (!admin || market !== "") && !taken && !busy;
  const ownMarket = marketIdToCode(actorMarketId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    const payload: CreateUserPayload = { username, password, role };
    if (admin && marketId) payload.market_id = marketId;
    // Only ever sent for a warehouse agent: a building on any other role is a
    // fact nothing in the system honours.
    if (isWarehouse && warehouseId) payload.warehouse_id = warehouseId;
    setBusy(true);
    setError(null);
    try {
      await onCreate(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error"));
      setBusy(false);
    }
  }

  return (
    <SidePanel labelledBy="access-create-title" onClose={onClose}>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-start gap-[12px] border-b border-[#ECEEF0] px-[22px] py-[18px]">
          <div className="min-w-0 flex-1">
            <h2 id="access-create-title" className="m-0 text-[18px] font-bold tracking-[-.01em] text-[#15171A]">
              {t("createPanel.title")}
            </h2>
            <p className="m-0 mt-[2px] text-[13px] text-[#656B72]">{t("createPanel.subtitle")}</p>
          </div>
          <CloseButton label={t("drawer.close")} onClick={onClose} />
        </div>

        <div className="flex flex-1 flex-col gap-[22px] overflow-y-auto px-[22px] py-[20px]">
          <Step n={1} title={t("createPanel.identity")}>
            <label htmlFor="access-create-username" className={label}>
              {t("createPanel.username")}
            </label>
            <input
              id="access-create-username"
              dir="auto"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("createPanel.usernamePlaceholder")}
              autoComplete="off"
              autoFocus
              aria-describedby="access-create-identifier"
              className={field}
            />
            <div id="access-create-identifier" role="status">
              {identifier && (
                <div
                  className={`mt-[9px] flex items-center gap-[10px] rounded-[10px] border px-[12px] py-[9px] text-[13px] ${
                    taken ? "border-[#F5C9C4] bg-[#FDECEA] text-[#C0362C]" : "border-[#A9DDBC] bg-brand-tint text-[#4F555B]"
                  }`}
                >
                  <span aria-hidden="true" className={`grid h-[28px] w-[28px] flex-none place-items-center rounded-[8px] bg-white ${taken ? "text-[#C0362C]" : "text-brand"}`}>
                    {taken ? <AlertTriangle size={15} /> : <IdCard size={15} />}
                  </span>
                  <span>
                    {t("createPanel.identifier")}{" "}
                    <code className={`rounded-[6px] border bg-white px-[6px] py-[1px] font-mono text-[12.5px] font-semibold ${taken ? "border-[#F5C9C4] text-[#C0362C]" : "border-[#A9DDBC] text-brand-hover"}`}>
                      <bdi>{identifier}</bdi>
                    </code>
                    <small className="mt-[2px] block text-[12px] text-[#656B72]">{taken ? t("createPanel.identifierTaken") : t("createPanel.identifierHint")}</small>
                  </span>
                </div>
              )}
            </div>

            <label htmlFor="access-create-password" className={`${label} mt-[14px]`}>
              {t("createPanel.password")}
            </label>
            <div className="relative">
              <input id="access-create-password" type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className={`${field} pe-[92px]`} />
              <button
                type="button"
                aria-pressed={show}
                onClick={() => setShow((s) => !s)}
                className="absolute end-[5px] top-[6px] inline-flex h-[28px] items-center gap-[5px] rounded-[7px] bg-white px-[10px] text-[12px] font-semibold text-[#4F555B] shadow-[0_1px_2px_rgba(16,24,40,.08),0_0_0_1px_rgba(16,24,40,.04)] hover:text-[#15171A]"
              >
                {show ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                {show ? t("createPanel.hide") : t("createPanel.show")}
              </button>
            </div>
          </Step>

          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="mb-[12px] flex items-center gap-[9px] p-0 text-[13.5px] font-semibold text-[#15171A]">
              <span aria-hidden="true" className="grid h-[22px] w-[22px] place-items-center rounded-full bg-brand-bg text-[11.5px] font-bold text-brand-hover">
                2
              </span>
              {t("createPanel.role")}
            </legend>
            <div className="grid gap-[8px]">
              {(admin ? SUPER_ADMIN_CREATABLE : MANAGER_CREATABLE).map((r) => {
                const Icon = ROLE_ICON[r];
                const on = role === r;
                return (
                  <label
                    key={r}
                    className={`${TONE[r]} ${choice} relative flex cursor-pointer items-center gap-[12px] rounded-[12px] border px-[14px] py-[12px] transition-colors ${
                      on ? "border-tone bg-tone-bg shadow-[inset_0_0_0_1px_var(--tone)]" : "border-[#E3E5E8] hover:border-tone-edge"
                    }`}
                  >
                    <input
                      type="radio"
                      name="access-create-role"
                      value={r}
                      checked={on}
                      onChange={() => {
                        setRole(r);
                        // A building belongs to the warehouse role alone.
                        if (r !== "warehouse_agent") setWarehouseId("");
                      }}
                      className="absolute opacity-0"
                    />
                    <span aria-hidden="true" className={`grid h-[32px] w-[32px] flex-none place-items-center rounded-[9px] text-tone ${on ? "bg-white" : "bg-tone-bg"}`}>
                      <Icon size={17} />
                    </span>
                    <span className="min-w-0">
                      <span className={`block text-[13.5px] font-semibold ${on ? "text-tone-ink" : "text-[#15171A]"}`}>{t(`role.${r}`)}</span>
                      <span className="mt-[2px] block text-[12.5px] leading-[1.4] text-[#4F555B]">{t(`roleDescription.${r as "agent"}`)}</span>
                    </span>
                    <span aria-hidden="true" className={`ms-auto grid h-[20px] w-[20px] flex-none place-items-center rounded-full ${on ? "bg-tone" : "bg-white shadow-[inset_0_0_0_1.5px_#D5D8DC]"}`}>
                      {on && <span className="h-[7px] w-[7px] rounded-full bg-white" />}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <Step n={3} title={t("createPanel.attach")}>
            {admin ? (
              <fieldset className="m-0 min-w-0 border-0 p-0">
                <legend className={label}>{t("createPanel.market")}</legend>
                <div className="flex gap-[2px] rounded-[10px] bg-[#F3F4F6] p-[3px]">
                  {(["tn", "ly"] as const).map((m) => (
                    <label
                      key={m}
                      className={`${choice} relative grid h-[34px] flex-1 cursor-pointer place-items-center rounded-[8px] text-[13px] ${
                        market === m ? "bg-white font-semibold text-[#15171A] shadow-[0_1px_2px_rgba(16,24,40,.08),0_0_0_1px_rgba(16,24,40,.04)]" : "font-medium text-[#4F555B] hover:text-[#15171A]"
                      }`}
                    >
                      <input
                        type="radio"
                        name="access-create-market"
                        value={m}
                        checked={market === m}
                        onChange={() => {
                          setMarket(m);
                          // Buildings are per market; the old choice cannot survive.
                          setWarehouseId("");
                        }}
                        className="absolute opacity-0"
                      />
                      {t(`market.${m}`)}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : (
              <p className="m-0 flex items-center gap-[8px] rounded-[10px] border border-[#F2F3F5] bg-[#F7F8F9] px-[12px] py-[9px] text-[13px] text-[#4F555B]">
                <MapPin size={14} aria-hidden="true" className="text-[#656B72]" />
                {t("createPanel.marketFixed", { market: ownMarket ? t(`market.${ownMarket}`) : "" })}
              </p>
            )}

            {isWarehouse && marketId && (
              <fieldset className="m-0 mt-[14px] min-w-0 border-0 p-0">
                <legend className={label}>{t("createPanel.warehouse")}</legend>
                <div className="tone-warehouse grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-[8px]">
                  {sites.map((s) => {
                    const on = warehouseId === s.id;
                    return (
                      <label
                        key={s.id}
                        className={`${choice} relative flex cursor-pointer items-center gap-[10px] rounded-[12px] border px-[12px] py-[10px] text-[13.5px] font-semibold transition-colors ${
                          on ? "border-tone bg-tone-bg text-tone-ink shadow-[inset_0_0_0_1px_var(--tone)]" : "border-[#E3E5E8] text-[#15171A] hover:border-tone-edge"
                        }`}
                      >
                        <input type="radio" name="access-create-site" value={s.id} checked={on} onChange={() => setWarehouseId(s.id)} className="absolute opacity-0" />
                        <span aria-hidden="true" className={`grid h-[30px] w-[30px] place-items-center rounded-[8px] text-tone ${on ? "bg-white" : "bg-tone-bg"}`}>
                          <Box size={15} />
                        </span>
                        {s.name}
                      </label>
                    );
                  })}
                </div>
                {warehouseId ? (
                  <p className="m-0 mt-[8px] text-[12.5px] leading-[1.45] text-[#656B72]">{t("warehouse.hint")}</p>
                ) : (
                  <div className="mt-[10px] flex items-start gap-[8px] rounded-[10px] border border-[#F8D9A6] bg-[#FFF6E5] px-[12px] py-[9px] text-[12.5px] text-[#8F4A06]">
                    <AlertTriangle size={14} aria-hidden="true" className="mt-[1px] flex-none text-[#D97706]" />
                    {t("warehouse.warn")}
                  </div>
                )}
              </fieldset>
            )}
          </Step>

          <FormError message={error} />
        </div>

        <div className="flex items-center justify-end gap-[8px] border-t border-[#ECEEF0] bg-white px-[22px] py-[14px]">
          <button type="button" onClick={onClose} className={buttonClass("neutral")}>
            {t("createPanel.cancel")}
          </button>
          <button type="submit" disabled={!ready} className={buttonClass("primary")}>
            <Plus size={16} aria-hidden="true" />
            {busy ? t("createPanel.creating") : t("createPanel.submit")}
          </button>
        </div>
      </form>
    </SidePanel>
  );
}
