# Console manager « Prospects » — porter la maquette vers React

## Context

`/[locale]/leads` sert deux pages : la worklist agent (livrée, commit `475305d`)
et une console manager **mince** — quatre KPI, un tableau, des entonnoirs, un
roster. 412 lignes, un seul écran.

La maquette validée cette session (`prototypes/prospects-manager-v1.html`,
publiée sur https://claude.ai/artifact/6T6BjsKvgmPKuk7jMnsXLJ) va bien plus
loin : quatre onglets, la répartition en masse, le constructeur de campagne avec
son composeur d'audience, et le canal WhatsApp. On porte cette maquette telle
quelle, branchée sur les vraies données.

**Le fait qui commande tout le design**, mesuré sur la production
(`vshynigvgrlihngozuwb`, 2026-09-15) :

| marché | prospects | sans agent | statut `new` | issus d'une campagne |
| --- | --- | --- | --- | --- |
| tn | 1 700 | **1 694** | 1 675 | 1 692 |
| ly | 292 | **290** | 288 | 290 |

**1 984 prospects sur 1 992 n'ont aucun agent** — personne ne les voit, personne
ne les appelle. Le premier travail du manager n'est pas de lire des KPI : c'est
de distribuer ce stock. La page s'ouvre là-dessus.

Agents actifs : 6 en Libye, 4 en Tunisie.

## Décisions prises

1. **Composeur d'audience complet** — les 14 types de conditions, avec des
   comptes réels. Ce qui s'affiche est ce qu'on obtient.
2. **La répartition montre sa ventilation** — « N par historique · M par tour de
   rôle » avant validation.

## Ce qu'on réutilise

- `src/lib/prospects/worklist.ts` — `bucketOf()`, `sortWorklist()`,
  `countBuckets()`, `sumBuckets()`. Pur, testé. Le bucket est **dérivé**.
- `src/lib/prospects/console.ts` — `funnelWidths()`, `conversionRate()`,
  `trend()`, `agentLoad()`. Pur, testé. **Toute arithmétique nouvelle va ici.**
- `src/lib/prospects/presentation.ts` — `BUCKET_TONE`, `situationOf()`,
  `formatPhone()`, `historyOf()`, `callbackChoices()`.
- `src/lib/delivery/whatsapp-templates.ts` — **`buildWaLink()`, `toE164()`**, et
  le principe « la langue du client n'est pas celle de l'interface ».
- `src/components/prospects/ui.tsx` — `TONE`, `EDGE`, `Chip`, `Ltr`, `Money`,
  `SIT_ICON`, `PRIMARY_BTN`, `OUTLINE_BTN`, `useDuration`, `useSituationLabel`.
- `src/components/delivery/Sheets.tsx` → `SheetFrame` : à extraire vers
  `src/components/ui/SheetFrame.tsx` et partager.
- **Le patron** : `DeliveryBoardClient` (impur : SWR, mutations, horloge) +
  `DeliveryBoardView` (pur : tout en props, `Props` exportée pour les tests).

## Les écarts entre la maquette et la production

1. **`assign_lead` traite un prospect à la fois** → 1 694 allers-retours.
2. **`prospect_campaigns` n'a ni canal ni WhatsApp.**
3. **`/api/prospects/worklist` plafonne à 300 lignes** et renvoie tout au client.
4. **`leads` n'a ni `is_hot` ni `has_duplicate`** malgré `src/types/lead.ts`.
5. **`pool` et `lost` ne sont pas des buckets** : `pool` = « sans agent »,
   `lost` = un statut. Des filtres, pas de nouvelles valeurs de `Bucket`.
6. **La maquette simule tout** : `audienceCount()` applique des taux en dur,
   l'import CSV est figé à 198/11/5, les compteurs de `.fbar` sont cosmétiques.
   Rien de cela ne survit au contact des vraies données.

## Vérifié en base

- `idx_leads_market_status` couvre la sélection du pool : **3,5 ms** / 500 lignes.
- `assign_lead` garantit : refus si statut terminal, agent actif et même marché,
  promotion `new → assigned`, une ligne `lead_history`. **Le RPC en masse doit
  reproduire exactement ces règles.**
- `lead_history` est **append-only** ; `leads` porte trois CHECK
  (`lost_reason` obligatoire si `lost`, `lost_note` si `autre`,
  `converted_order_id` si `won`).
- Contrainte d'idempotence : `uq_leads_campaign_source_order`.

### Le contrat des campagnes

`rpc_run_prospect_campaign` construit l'audience **depuis `orders`**, en ne
lisant que cinq clés de `filter_json` : `order_statuses`, `date_from`, `date_to`,
`product_id`, `city`. `POST /api/leads/campaigns/preview` lit les mêmes cinq et
ne renvoie qu'un compte, en chargeant toutes les lignes en mémoire.

**Toute condition nouvelle doit être ajoutée au RPC *et* à la prévisualisation,
sinon la prévisualisation ment.**

### La matière disponible

| | commandes | livrées | retournées | villes | produits |
| --- | --- | --- | --- | --- | --- |
| ly | 4 121 | 533 | 103 | 90 | 8 |
| tn | 4 203 | 1 729 | 522 | 27 | 3 |

7 231 clients, 1 651 commandes de clients revenus. La Libye est le marché vivant
(3 178 commandes sur 90 j) ; la Tunisie dort depuis le 7 juillet.

**Piège :** `order_items` ne couvre que 4 331 des 8 324 commandes (52 %).
Filtrer sur `orders.product_id`, qui couvre tout.

**Preuve que le comptage doit être réel.** Le modèle « rachat » sur la Libye :
531 clients livrés sur 180 j → 295 dans la fenêtre 60–120 j → **290 ont déjà un
prospect ouvert** → il reste **5**. Les garde-fous font leur travail. La
simulation de la maquette aurait annoncé ~400.

### La règle de répartition par défaut, mesurée

| marché | lot | a un agent antérieur | encore actif | agents distincts |
| --- | --- | --- | --- | --- |
| ly | 288 | **288 (100 %)** | 288 | 5 |
| tn | 1 685 | **93 (5,5 %)** | 72 | 6 |

En Libye la règle tient. **En Tunisie 96 % tombe en tour de rôle.** D'où la
ventilation affichée avant validation.

---

## Le plan

### Étape 1 — L'arithmétique pure, testée d'abord

**`src/lib/prospects/distribution.ts`** (nouveau)
- `planDistribution({pool, agents, rule, cap})` → `{rows:[{agentId, byHistory,
  byRoundRobin, total, queueAfter}], assigned, left}`.
- Les trois règles : `r1` historique puis tour de rôle, `r2` tour de rôle strict,
  `r3` proportionnel à la capacité restante (la seule que la maquette calcule
  vraiment). Le plafond `cap` s'applique après.
- Pur : le lot et l'historique arrivent en arguments. **Tests d'abord.**

**`src/lib/prospects/audience.ts`** (nouveau)
- `Condition` (union discriminée sur les 14 clés `CT` de la maquette),
  `Template` (les 5 modèles), `conditionSummary()`, `validate()`.
- `toFilterJson(conditions)` / `fromFilterJson()` — la traduction vers la forme
  stockée. Pur, testé.

**`src/lib/prospects/console.ts`** (étendu) — ajouter ce que les nouveaux KPI
demandent (entonnoir 6 étages, motifs de perte, comparaison TN/LY), en gardant
le style : fonctions pures, `null` quand il n'y a rien à comparer.

### Étape 2 — La base

**Migration `..._bulk_assign_leads.sql`** — `bulk_assign_leads(p_market_id,
p_lead_ids uuid[], p_assignments jsonb, p_actor_id, p_actor_type)`.
Reproduit `assign_lead` en ensembliste : un `UPDATE ... FROM (VALUES …)`, un
`INSERT INTO lead_history SELECT`, les mêmes garde-fous (statut terminal, agent
actif et même marché). Retourne `{assigned, skipped, by_agent}`.
`security definer`, `search_path = public, pg_temp`.

**Migration `..._campaign_audience.sql`** — `preview_campaign_audience(
p_market_id, p_filter jsonb)` → `{matched, excluded:{open, ordered, incamp,
lostni, optout}, net, sample jsonb}`. Une seule requête ensembliste sur `orders`
+ les garde-fous sur `leads`. C'est elle qui rend le compte honnête.

Puis **réécrire `rpc_run_prospect_campaign`** pour lire le même `filter_json`
étendu, en passant par la même CTE d'audience — une seule définition de « qui
est dans la campagne », pour que l'aperçu et l'exécution ne puissent pas diverger.

**Migration `..._campaign_channel.sql`** — sur `prospect_campaigns` :
`channel text not null default 'call' check (channel in ('call','wa','wa_call'))`,
`wa_message text`, `wa_image boolean not null default false`,
`wa_sender text not null default 'agent' check (wa_sender in ('agent','api'))`,
`wa_window text`, `wa_rate int`, `wa_follow_up_hours int`.

> `docs/database-schema.md` dit que l'application mute par RPC. On s'y tient,
> sauf là où `/api/leads/campaigns` écrit déjà en direct — à aligner.

### Étape 3 — Les routes

- `POST /api/prospects/distribute` — corps `{lead_ids?|filter, rule, cap,
  agent_ids}`. Résout l'historique, appelle `planDistribution`, puis
  `bulk_assign_leads`. `canUseProspectConsole`, marché du manager prioritaire
  sur le paramètre.
- `POST /api/prospects/distribute/preview` — le même calcul sans écriture, pour
  la ventilation « historique / tour de rôle ».
- `POST /api/prospects/campaigns/preview` — enveloppe
  `preview_campaign_audience`.
- `POST /api/prospects/campaigns` — crée, avec le canal et les champs WhatsApp,
  puis exécute et répartit.
- **`GET /api/prospects/worklist` étendu** — `campaign_id`, `unassigned=1`, `q`,
  `bucket`, `page`. Le filtrage passe en SQL ; le client cesse de recevoir 1 700
  lignes pour en afficher 40.
- `PATCH /api/prospects/[id]` — champs éditables du panneau.
- `POST /api/prospects/[id]/close` + `/reopen`.
- Chacune avec son `route.test.ts` colocalisé : agent 403, manager cantonné à son
  marché quoi que demande la requête, super_admin 400 sans marché.

### Étape 4 — Les composants

```
src/components/prospects/
  ProspectsConsoleClient.tsx   (réécrit : SWR, mutations, horloge)
  ProspectsConsole.tsx         (réécrit : la coquille + les 4 onglets)
  console/
    OverviewTab.tsx      alertes, 2 rangées de KPI, entonnoir, pertes,
                         campagnes, table par agent
    CompareTab.tsx       la grille TN/LY quand admin + scope « tous »
    PipelineTab.tsx      chips, sélection, table, panneau droit
    CampaignsTab.tsx     liste + règle + pertes
    TeamTab.tsx          alerte de rééquilibrage, cartes agents
    ProspectPanel.tsx    le panneau droit (vue / édition / timeline)
    CampaignCard.tsx     entonnoir 4–5 segments, puce WhatsApp
    sheets/
      DistributeSheet.tsx  agents, règle, plafond, aperçu ventilé
      AssignSheet.tsx      radio agent
      CloseSheet.tsx       motif + note
      NewLeadSheet.tsx     téléphone d'abord, correspondance live
      ImportSheet.tsx      CSV, mapping, essai à blanc réel
      CampaignSheet/       les 3 étapes
        AudienceStep.tsx   modèles, conditions, compteur, exclusions
        ChannelStep.tsx    canal, offre, composeur WA, aperçu, script
        DistributeStep.tsx agents, plafond, récapitulatif
```

`ProspectsConsole` reste **pure** : données, horloge et mutations en props,
`Props` exportée. Les onglets en `useState` local ; la sélection en `Set<string>`,
Échap vide la sélection puis la ligne ouverte.

**Le style suit la maquette**, qui suit déjà le design system : les onglets sont
bien des onglets soulignés (`border-bottom` + `::after` 2px vert de marque,
500→600) — conforme au §4.11. On importe depuis `./ui.tsx` et on garde les hex
bruts, convention locale assumée de cette page et de `delivery/`.

### Étape 5 — i18n

`prospects.console` passe de 48 clés à ~200, **en parité stricte fr/ar** (elle
l'est aujourd'hui : 48/48, zéro écart). Les textes existent déjà dans la maquette
(`I18N.fr` / `I18N.ar`) — c'est une transcription, pas une rédaction. Les
pluriels ICU comme dans l'existant.

Le message WhatsApp **au client** ne passe pas par next-intl : il suit
`whatsapp-templates.ts`, langue du client choisie séparément.

### Étape 6 — Vérification

- `npm test` — d'abord les tests purs (`distribution`, `audience`, `console`),
  puis les composants (messages FR réels, horloge figée, requêtes par rôle et
  par texte), puis les routes.
- `npm run typecheck` après chaque fichier ; `npm run lint` avant commit.
- **Contre la vraie base**, en lecture : comparer l'aperçu d'audience du modèle
  « rachat » sur la Libye au chiffre mesuré ici (**5 après garde-fous**, 295
  avant). S'ils divergent, c'est le SQL qui a tort.
- Vérifier la ventilation de répartition : **Libye 288/288 par historique**,
  **Tunisie 93/1 685**.
- Écran à écran contre la maquette : `?role=manager&scope=ly`,
  `?role=admin&scope=all`, `?tab=campaigns&sheet=campaign&step=2`, et en `lang=ar`
  pour le RTL.
- Répartition réelle sur un petit lot libyen d'abord (10 prospects), vérifier les
  lignes `lead_history`, puis le reste.

## Attention

Trois autres sessions Claude tournent dans ce même checkout. Une session
parallèle a déjà effacé des fichiers non suivis par git. Les deux prototypes sont
sauvegardés dans le scratchpad de cette session. **Committer tôt.**
