# Investor admin CRUD

Closes the management gaps found by the end-to-end walkthrough of the investor
portal: an investor could request money nobody could see, and a new investor
could not be configured at all without hand-written SQL.

## Why this is smaller than it looks

Most of the API already exists. The walkthrough proved each of these works:

| Exists | Verified by |
|---|---|
| `POST /api/users` creates `investor` logins | `CREATABLE_ROLES` includes `investor`, super_admin only |
| `GET`/`POST /api/admin/investments` — list/create positions | `POST` validates market pairing, derives market from the product |
| `PATCH .../withdrawals/[id]` — approve / reject / mark_paid | Driven live: illegal `requested → paid` 409s, ledger row written only on payment, balance reconciled to 305.340 |
| `POST .../corrections` | Note mandatory, super_admin gated |
| `POST .../settlements` | Dry-run + commit, reconciliation `unreconciled: []` |

So the work is four missing endpoints and the entire admin UI.

## Endpoints to add

1. `GET  /api/admin/investments/investors` — investor users LEFT JOIN their
   profile, so users with `role=investor` and no `investors` row surface as
   incomplete rather than silently missing.
2. `POST /api/admin/investments/investors` — create the profile row for an
   existing investor user.
3. `PATCH /api/admin/investments/investors/[id]` — edit `legal_name`,
   `payout_method`, `payout_details`, `reserve_pct`, `notes`.
4. `PATCH /api/admin/investments/[id]` — **close** a position (end-date it).
5. `GET  /api/admin/investments/withdrawals` — the approval queue.

## Onboarding: two-step, deliberately

Creating the *login* stays on the existing Users page. This panel only manages
the *profile*. Duplicating the invite + market-scoping logic from
`POST /api/users` would mean two auth paths to keep in sync.

The portal already renders "Votre profil investisseur n'est pas encore
configuré" for a user in the half-configured state, so the panel mirrors that
with an explicit **Profil incomplet → Configurer** affordance.

## Safety rules the API must enforce

These protect money that has already been paid out.

- **Position PATCH end-dates only.** No `amount` edits. Capital amounts are
  historical inputs to statements that may already be settled; rewriting one
  silently changes what someone was owed for a closed period. `effective_to`
  must be `>= effective_from`.
- **`reserve_pct` affects future settlements only.** `computeSettlement`
  snapshots it into `cost_inputs`, so past statements are unaffected — the UI
  must say so, or an admin will assume they just changed a historical payout.
- **Corrections need a confirm step.** The ledger is append-only; a mistyped
  correction can only be fixed by another correction.
- **Closing a position does not touch settled statements** — they snapshot
  `investor_capital` / `total_capital`, so this is safe by construction.

## Permissions

`canManageInvestments` (super_admin) gates every write.
`canViewInvestorAdmin` (super_admin + market_manager) gates reads, with managers
scoped to their own market. Every write route gets an explicit 403 test for
`market_manager`, since the read and write allow-lists differ.

## UI

Four panels on `/[locale]/(dashboard)/finance/investors`:

- **Investisseurs** — list, configure profile, edit
- **Positions de capital** — existing table + create form + close action
- **Demandes de retrait** — queue with approve / reject / mark paid
- **Corrections** — compensating ledger entry, behind a confirm

Each row is denominated by **its own** market, never a global selector — the bug
that rendered Tunisian capital as Libyan dinars.

## Testing

TDD throughout. Route tests use `src/test/helpers/actorMock.ts`. Component tests
follow the `next-intl` + `swr` mocking pattern already used by
`WithdrawalsClient.test.tsx` and `AdminInvestorsClient.test.tsx`.
