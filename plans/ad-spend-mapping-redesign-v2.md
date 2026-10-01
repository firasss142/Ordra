# Ad spend mapping drawer: redesign v2

**Status:** Phase 1 built on 2026-10-01 (owner: "implement ad-spend-mapping-v2.html"), in the worktree `.claude/worktrees/adset-mapping` (branch `feat/ad-spend-adset-mapping`). Not committed or deployed yet. No migration, so a plain deploy ships it.

**Where the build differs from the table below:**
- The tree gained `spend_unattributed` (per node) and `spend_by_product` (per campaign), and the preview splits a null product into `general` / `none` buckets. Without that split, "set to general spend" would preview as "nothing changes". `tree.unmapped` is gone, and the page counts with `needsAttribution`.
- `MappingChip` was replaced by `mapping/VersionLabel.tsx`. The product table never used it.
- The date stays a native field, not the app `DatePicker`; see `docs/ad-spend-mapping.md` §4.
- Fixed shares are seeded in whole percents (`wholeShares`), because a decimal seed shows as "16," in the field.

**Brief (owner, 2026-10-01).** The v1 drawer, shipped 2026-09-30, is "not clear and a bit dense with unnecessary information". The redesign aims for simplicity, visual clarity, good components, a simple flow and descriptive words.

**Scope.** Screen only. No migration, no RPC, no change to the allocation or the projection. The model in `docs/ad-spend-mapping.md` stands.

## Phase 0: prototype (done, under review)

`prototypes/ad-spend-mapping-v2.html` runs on real Libya data, read from prod on 2026-10-01.

- **Presets:** `?screen=list|campaign|pick|edit|manual|date|adset|done`, `?lang=fr|ar`, `?device=desktop|phone`.
- **Review notes:** the critique (13 points, v1 → v2), the decisions, the code impact and what is simulated are at the bottom of the file.

## What changes

1. **One count.** A campaign is *to attribute* only when spend is waiting for a product, or when it is running with no product. That is the page's `spent_campaigns`, not `isUnmapped`. Today the count is 2 campaigns and 542 LYD, not 6.
2. **One period.** The drawer works on the whole history (`adset_history_from` → today), not the page window:
   - one status sentence;
   - one amount per row: spent since tracking began.
3. **List:**
   - campaigns only, grouped as À attribuer / En cours / En pause / Jamais diffusées (that last group collapsed);
   - search only: no filter chips and no "hide never-spent" box;
   - a row shows thumbnail, campaign, what it sells and the amount;
   - selection is a rounded tint.
4. **Detail:**
   - status pill, name, one sentence ("16 696 LYD dépensés du 6 juil. au 4 sept.") and a slim spend strip;
   - then "Ce qu'elle vend", with the version in force in the card footer and the history behind a link;
   - ad sets are shown only when there are 2 or more;
   - gone: KPIs, Meta purchases, cost per purchase, Meta ID, objective and creation date. Purchases stay on the page's product table.
5. **Editor:** three plain questions (which products / how to split / from when), with:
   - the share written on each product row;
   - "general spend" as a quiet link instead of a first-step choice;
   - a cut timeline under the date (grey = unchanged, black = new);
   - an impact list with before → after per product;
   - **Enregistrer greyed while nothing differs**, and a footer that says why.
6. **Opening:** the drawer opens on the first campaign to attribute, never on an empty pane.
7. **Words:**
   - "À mapper" → "Sans produit / À attribuer";
   - "Niveau marché / Dépense de marché" → "Dépense générale";
   - "Attribuer autrement" → "Attribuer à part";
   - "réattribués sur N j" → "N LYD changent de produit";
   - "Appliquer l'attribution" → "Enregistrer".

## Phase 1: React (after approval), TDD

| Where | Change |
|---|---|
| `lib/ad-spend/mapping-view.ts` | `needsAttribution`, `groupCampaigns`, `isUnchanged(draft, current)`; drop `ListFilter` + `hideNeverSpent`. Tests first. |
| `hooks/useAdSpendMapping.ts` + `GET /api/meta/mapping` | Request the whole history; `daily` per campaign over it. Route test first. |
| `mapping/MappingList.tsx` | Rewritten: groups, no tree. |
| `mapping/MappingDetail.tsx` | Slimmed as above; `HistoryTimeline` behind a link. |
| `mapping/MappingEditor.tsx` | No kind step; share per row; `SpendBars` gains a `cutFrom` mode; app `DatePicker`; disabled save when unchanged. |
| `AdSpendMappingDrawer.tsx` | No filters/checkbox/rules; status sentence; auto-select first to attribute. |
| `MappingChip.tsx` | Kept for the ad-set rows and the page's product table only. |
| `AdSpendClient.tsx` | Button "Campagnes et produits" + "N sans produit". |
| `messages/fr.json`, `ar.json` | Renamed keys; parity test. |
| `__tests__/AdSpendMappingDrawer.test.tsx` | Rewritten first, against the prototype's flows. |

## Decisions I made as the expert

- **Colour is for state only:**
  - amber when money is waiting for a product;
  - green for running and for "all attributed";
  - the split stays on the grey ramp.
- **"Attribuer à part" starts from a copy of the campaign's products.** The real case is "this ad set *also* sells X". Going back is one switch.
- **Phone:** the list comes first. The editor's status band is hidden while editing, and the footer buttons take the full width.

## Open (unchanged, not blocking)

- A change that reaches into a settled investor period: warn (current) or block?
