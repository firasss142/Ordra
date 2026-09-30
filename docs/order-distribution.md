# Distribution des commandes — pourcentages et disponibilité agent

Comment une commande trouve son agent, et pourquoi elle peut désormais
n'en trouver aucun.

## 1. Les deux décisions, séparées

| Question | Répond | Où |
|---|---|---|
| Qui **peut** recevoir ? | la disponibilité | `isReadyForOrders` — `src/lib/orders/agent-readiness.ts` |
| Qui **reçoit** celle-ci ? | l'algorithme | `selectAgent` — `src/lib/orders/auto-assignment.ts` |

La disponibilité filtre, l'algorithme choisit. Un algorithme ne voit jamais un
agent indisponible.

## 2. Être « prêt » = deux choses à la fois

```ts
is_available && is_active && deleted_at === null
  && (now - last_seen_at) < READINESS_STALE_AFTER_MS
```

La déclaration seule ne suffit pas : un portable fermé avec le bouton resté sur
« disponible » avalerait des commandes toute la nuit. Le battement seul ne
suffit pas non plus : être connecté n'est pas vouloir travailler.

**`READINESS_STALE_AFTER_MS` vaut `IDLE_THRESHOLD_MS` (30 min), pas
`ONLINE_THRESHOLD_MS` (5 min).** `usePresenceHeartbeat` s'arrête quand l'onglet
passe en arrière-plan ; à cinq minutes, un agent qui change d'application ou
verrouille son écran sortirait silencieusement de la rotation, puis recevrait
une rafale de rattrapage au retour, sans qu'aucun événement d'interface
n'explique l'un ni l'autre. C'est un alias de la constante existante, jamais une
quatrième définition de « en ligne » — `src/lib/presence.ts` existe parce que
trois surfaces avaient fini par ne plus être d'accord.

### Ce que la disponibilité a remplacé

Le réglage `active_agents_only` est retiré de l'écran Équipe. Son libellé
promettait « agents en ligne ou inactifs — jamais hors ligne » alors que le code
regardait « a agi aujourd'hui » dans `order_history`, puis retombait
silencieusement sur **tous** les agents actifs quand personne ne qualifiait. La
clé reste lisible pour ne pas casser les lignes stockées ; plus rien ne la lit.

## 3. Le quota par pourcentages

Parmi les agents **prêts**, la prochaine commande va à celui qui est le plus en
retard sur sa cible absolue :

```
D        = commandes assignées aujourd'hui dans TOUT le marché (prêts ou non)
cible_i  = part_i / 100 × (D + 1)
gagnant  = argmax sur les agents prêts de (cible_i − assigné_aujourd_hui_i)
départage : part la plus grande, puis file la plus courte, puis id
```

`assigné_aujourd_hui` compte **toutes** les assignations du jour, y compris
celles faites à la main par un manager : donner une commande à Ahmed consomme la
part d'Ahmed.

### Les parts sont absolues, pas des poids

Elles ne sont **pas** renormalisées sur les agents présents. Quand quelqu'un est
absent, ses commandes sont absorbées par ceux qui travaillent — qui passent donc
au-dessus de leur cible — et l'absent rattrape son retard à son retour. C'est le
modèle « quota strict », choisi contre la redistribution au prorata.

C'est aussi pourquoi **le total doit faire exactement 100 %** : avec des cibles
absolues, une colonne qui totalise 80 ne couvre pas la journée. La règle vit dans
`validateShares` (`src/lib/orders/agent-shares.ts`) et dans l'UI, pas dans une
contrainte de table : elle porte sur plusieurs lignes, donc il faudrait un
trigger d'instruction, et « retirer un agent » échouerait alors sur une violation
de contrainte au lieu de faire l'évident.

### Conséquence assumée : la rafale de rattrapage

Le marché a fait 200 commandes à 14 h. Un agent à 40 % se déclare disponible
sans rien avoir pris. Son déficit est de 80 : le drain lui donne tout le pool,
puis chaque commande entrante, d'affilée, jusqu'à ce qu'il soit à niveau.
C'est le modèle qui fonctionne, pas un bug. `max_open_orders_per_agent` est déjà
stocké et n'est lu par personne — c'est le frein d'une ligne, si le besoin
apparaît.

### Pourquoi le moteur ne stocke rien

`selectByPercentage` renvoie toujours `updated_config: null`. Les compteurs sont
lus dans `orders`, pas gardés dans un curseur. Deux webhooks simultanés peuvent
donc dépasser d'**une** commande, que l'appel suivant corrige tout seul — là où
le `last_assigned_index` de `round_robin`, lu puis réécrit après la RPC, dérive
définitivement. **Ne pas « optimiser » ça en compteur stocké.**

## 4. La journée

La fenêtre du quota est le jour **local du marché** : la Tunisie (UTC+1) et la
Libye (UTC+2) ne changent pas de jour au même instant. Côté TypeScript,
`marketDayStartUtc` / `todayInMarket` (`src/lib/dates/market-day.ts`) ; côté SQL,
`market_tz(uuid)` — celui de `20260918010002`, à `search_path` épinglé, pas
`warehouse_market_tz`.

`reset_agent_availability_daily()` remet tout le monde sur « pas prêt » à minuit
local et rend au pool leurs commandes intouchées. Le job tourne **toutes les
heures** à `:22` et n'agit que dans la première heure du jour local, avec une
garde d'idempotence sur `agent_availability_log` — sans elle, un agent qui se
remet disponible à 00 h 20 serait éteint au tick de 01 h. Horaire plutôt que deux
crons UTC fixes parce qu'un décalage figé serait juste aujourd'hui et faux le
jour où l'un des deux pays rétablit l'heure d'été.

## 5. Ce qui se passe quand on bascule

**ON** → `set_agent_availability` écrit l'état et le journal, puis le client
appelle `/api/agent/availability/drain`, qui distribue le pool à **tous** les
agents prêts selon leurs déficits. Le drain est volontairement hors de la RPC :
la bascule doit répondre en millisecondes, et y brancher une redistribution de
500 commandes ferait dépendre sa latence de la taille du pool.

**OFF** → les commandes **intouchées** retournent au pool : `status = 'pending'`
**et** aucun rappel programmé **et** `attempts_count = 0`. Les trois, pas une —
`pending` seul laisserait partir une commande dont l'agent a déjà ouvert la fiche
et reprogrammé l'appel. Ce qui a été travaillé reste chez lui : le contexte
n'existe que là. Une fiche ouverte par un collègue (`order_presence`) n'est
jamais arrachée ; la RPC reproduit ce garde explicitement, parce qu'elle tourne
en `SECURITY DEFINER` et que `trg_orders_lock_guard` ne se déclenche pas pour
elle.

La déconnexion appelle la même RPC (`reason: 'logout'`). Auparavant elle ne
faisait qu'effacer `last_seen_at`, ce qui rendait l'agent périmé pour le routage
mais laissait `is_available` à vrai et ne libérait rien.

## 6. Nouvelle conséquence : une commande peut n'aller nulle part

Avant, chaque commande atterrissait chez quelqu'un. Désormais, si personne n'est
prêt, elle reste `pending` et non assignée. C'est le but, mais c'est un nouveau
mode de panne : le pool est visible sur `/orders?preset=unassigned`, avec ses
paliers d'ancienneté.

« Pourquoi cette commande n'a-t-elle pas été affectée ? » a maintenant plusieurs
réponses, et l'API les nomme (`reason` dans la réponse du drain) :

| `reason` | Sens |
|---|---|
| `manual` | l'algorithme du marché est « Manuel » |
| `algorithm_inactive` | `assignment_rules.is_active` est faux |
| `no_ready_agents` | personne ne s'est déclaré disponible |
| `empty_pool` | rien à distribuer |
| `no_shares` | mode pourcentages sans répartition configurée |

## 6 bis. Ce que voit le manager

**Salle de contrôle → panneau « Disponibilité »**
(`src/components/team/control-room/AgentReadinessPanel.tsx`). Construit sur
`/api/agents/capacity`, pas sur `get_team_live` : tout ce qu'il affiche voyage
déjà sur cet endpoint, donc il n'a demandé aucune migration supplémentaire.

Il répond à trois questions, dans cet ordre :

1. **« Est-ce que quelqu'un reçoit du travail ? »** Une alerte rouge quand
   personne n'est prêt — sans elle, le pool grossit en silence jusqu'au
   lendemain matin. C'est le mode de panne que la disponibilité a introduit.
2. **« Qui croit travailler sans rien recevoir ? »** Trois états distincts, pas
   deux : *Disponible*, *Session inactive* (déclaré mais le battement s'est
   tu — le seul qui mérite un coup de fil) et *En pause*.
3. **« Qui est en retard sur sa part ? »** `assigné / cible` avec la dérive.
   La liste est triée prêts → inactifs → en pause, puis du plus en retard au
   plus en avance : elle se lit pour décider qui appeler.

Le bouton « Mettre en pause » appelle la même RPC que la bascule de l'agent
(`actor_type = 'manager'`), et rend donc aussi ses commandes intouchées. Il
existe pour le portable mort en pleine journée : sans lui l'agent reste
« disponible » jusqu'à minuit et ses commandes sont bloquées.

Le calcul vit dans `summariseReadiness` (`src/lib/team/readiness-summary.ts`),
pur et testé, pour qu'aucune arithmétique parallèle ne puisse contredire le
panneau.

**Rail d'affectation manuelle** (`AgentCapacityCard`) : un agent non disponible
reste **sélectionnable** — donner une commande précise à une personne précise
est exactement le rôle de ce rail — mais son état est écrit à côté de son nom,
sinon la commande atterrit dans une file que personne ne regarde.

## 7. Les deux colonnes qui prétendaient être « l'algorithme »

`settings.assignment_algorithm` pilote l'exécution (webhook) ;
`assignment_rules.algorithm` pilote l'affichage du tableau `/assign` et son
bouton de lot. L'écran Système › Paramètres n'écrivait que la première.

Pire : le tableau `/assign` écrit `is_active = false` dès qu'un manager y choisit
« Manuel », et `tryAutoAssign` sort immédiatement sur `!is_active`. Une fois cela
arrivé, choisir un algorithme dans les Paramètres ne faisait plus rien du tout,
silencieusement. `PATCH /api/settings/[marketId]` recopie désormais `algorithm`
et `is_active` dans `assignment_rules`, comme `PUT /api/assignment-rules` le
faisait déjà dans l'autre sens.

C'est aussi la raison pour laquelle les parts vivent dans leur propre table :
`/api/orders/auto-assign-bulk` écrasait `assignment_rules.config`.

## 8. Deux défauts corrigés dans le lot manuel

`/api/orders/auto-assign-bulk` passe maintenant par `planAssignments` :

1. il écrivait `decision.updated_config` sans condition — un algorithme sans état
   renvoie `null`, donc **une seule** exécution `workload` écrasait
   `assignment_rules.config` avec `null` et détruisait le curseur stocké ;
2. il n'avançait que `queue_size` entre deux commandes. Un algorithme à déficit
   lit `assigned_today`, qui ne bougeait pas : **tout le lot partait chez le même
   agent**.

## 9. Sécurité — le GRANT sur `users`

`030_presence_rls_policy.sql` autorise `USING (id = auth.uid())` en UPDATE. RLS
est au niveau **ligne** : cette policy laissait n'importe quel utilisateur
connecté réécrire n'importe quelle colonne de sa propre ligne, `role` compris.

```sql
REVOKE UPDATE ON public.users FROM authenticated;
GRANT  UPDATE (last_seen_at) ON public.users TO authenticated;
```

Toutes les autres écritures sur `users` passent déjà par `createAdminClient()`
(service_role, qui contourne RLS et les GRANT). `is_available` n'est
délibérément pas accordé : il ne bouge que par `set_agent_availability`, ce qui
rend le journal et la remise au pool impossibles à contourner.

## 9 bis. Les RPC ne sont PAS publiques — et ne l'étaient pas par accident

Postgres accorde `EXECUTE` à `PUBLIC` par défaut sur toute fonction. Un
`GRANT ... TO authenticated` n'enlève donc rien : `anon` hérite le droit via
`PUBLIC`, et une fonction `SECURITY DEFINER` devient appelable **sans session**
via `/rest/v1/rpc/<nom>`.

C'est arrivé aux trois RPC de cette fonctionnalité, et ce n'était pas théorique :

- `set_agent_availability` — son premier garde est
  `IF auth.uid() IS NOT NULL AND auth.uid() <> p_actor_id`. Pour un appelant
  anonyme `auth.uid()` vaut NULL, donc le garde **passe** (il est écrit ainsi
  pour laisser passer service_role et pg_cron). Avec un UUID d'agent connu
  passé en `p_agent_id` *et* `p_actor_id`, l'appel se qualifiait en « self » :
  l'agent sortait de la rotation et ses commandes intouchées repartaient au
  pool.
- `apply_pool_assignments` — `p_actor_id` NULL sautait toute la validation
  d'acteur et de marché. Le paramètre est obligatoire depuis
  `20261003000006`.
- `reset_agent_availability_daily` — accordée à `service_role` seulement, mais
  `PUBLIC` la rendait appelable par tout le monde.

`20261003000006` fait le `REVOKE ... FROM PUBLIC, anon` avant de regranter.
Même leçon que `20260924000001` pour `order_stock_lines`. **Un `CREATE OR
REPLACE` réinitialise les droits** : re-révoquer après chaque redéfinition.

Détecté par `get_advisors(type: "security")` juste après l'application —
à lancer systématiquement après un DDL.

## 10. Fichiers

| Quoi | Où |
|---|---|
| Moteur pur (6 algorithmes) | `src/lib/orders/auto-assignment.ts` |
| Planificateur de lot | `planAssignments`, même fichier |
| Disponibilité | `src/lib/orders/agent-readiness.ts` |
| Validation des parts | `src/lib/orders/agent-shares.ts` |
| Orchestrateur (webhook) | `src/lib/orders/auto-assignment-orchestrator.ts` |
| Compteurs par agent | `src/lib/orders/agent-capacity.ts` |
| Bascule agent | `src/components/layout/AgentAvailabilityToggle.tsx`, `src/hooks/useAgentAvailability.ts` |
| Éditeur de parts | `src/components/settings/general/AgentSharesEditor.tsx` |
| Vue manager | `src/components/team/control-room/AgentReadinessPanel.tsx`, `src/lib/team/readiness-summary.ts` |
| API | `/api/agent/availability`, `.../drain`, `/api/settings/agent-shares`, `/api/team/availability/reset` |
| SQL | `20261003000002` (schéma + GRANT), `20261003000003` (RPC), `20261003000004` (cron) |
