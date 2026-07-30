# OMS — Présentation technique (Français)

> Système de gestion de commandes pour l'e-commerce COD (cash à la livraison) en Tunisie et Libye.

---

## C'est quoi ce projet, en une phrase ?

Un **OMS multi-marché** : les commandes arrivent des boutiques en ligne, des agents les confirment par téléphone, on les envoie aux transporteurs, elles sont scannées en entrepôt, et on les suit jusqu'à la livraison ou le retour. Deux marchés complètement isolés (Tunisie + Libye) dans un seul système.

---

## 1. Stack technique

| Couche | Technologie |
|---|---|
| Frontend / Routing | Next.js 14 App Router + TypeScript + Tailwind |
| Internationalisation | `next-intl` — français (LTR) + arabe (RTL) |
| Données client (cache) | SWR (stale-while-revalidate) |
| Backend / Base de données | Supabase — Postgres + Auth + RLS + Realtime |
| Déploiement | Vercel (preview par PR, prod sur merge) |
| Tests | Vitest + Testing Library (~377 fichiers de tests) |

### Les trois clients Supabase

Il y a **trois façons différentes** d'accéder à la base, selon le contexte :

- **Browser client** (clé anonyme + session utilisateur) — utilisé côté client, respecte le RLS.
- **Server client** (`createClient`) — côté serveur dans les Route Handlers, respecte aussi le RLS.
- **Admin client** (`createAdminClient`) — clé service-role, **contourne le RLS**. Utilisé **uniquement** dans les webhooks et certains chemins système. Jamais côté navigateur.

---

## 2. Comment les appels API fonctionnent

```
Navigateur → hook SWR → /app/api/... (Route Handler) → RPC Supabase ou requête table → DB
                                                        → Adapter transporteur → fetch() → API externe
```

- Le navigateur ne parle **jamais directement** à la base de données.
- Les calculs financiers et les appels aux transporteurs se font **exclusivement côté serveur**.
- SWR gère le cache, la revalidation et la déduplication des requêtes automatiquement.

---

## 3. Machine à états des commandes (le cœur du système)

Les commandes passent par **deux phases**.

### Phase 1 — Confirmation (agents)

```
pending → attempt_1/2/3 → callback_scheduled → confirmed → uploaded → scanned
                                                          → dispatch_scheduled → uploaded (cron)
                                             → rejected (TERMINAL)
cancelled (TERMINAL — manager, avant dispatch)
```

### Phase 2 — Livraison (transporteur)

```
scanned → dispatched → deposit → in_transit → delivered (TERMINAL)
                                            → to_be_returned → returned (TERMINAL)
                                            → unverified (temporaire, auto-effacé)
```

### Les frontières importantes (à retenir)

| Statut | Ce que ça signifie vraiment |
|---|---|
| `confirmed` | Confirmation téléphonique faite. **Aucun lien avec le transporteur encore.** |
| `uploaded` | API transporteur appelée avec succès. `tracking_number` + `carrier_id` définis. |
| `scanned` | **Frontière stock** : scan entrepôt → stock −1 |
| `deposit` | **Frontière coût** : les frais transporteur commencent à s'accumuler |
| `delivered` | **Frontière revenu** : le revenu est réalisé |

### Qui peut faire quoi ?

- **Agent** : tenter, rappeler, confirmer, rejeter, envoyer au transporteur.
- **Entrepôt** : scanner (scanned, returned).
- **Système** (webhook/cron) : créer (pending), faire avancer la livraison.
- **Manager/super_admin** : annuler, supprimer, forcer n'importe quelle transition valide.

### Sécurité des transitions

Trois niveaux de vérification (défense en profondeur) :

1. **TypeScript** `canTransition(from, to)` — empêche les transitions invalides dans l'UI.
2. **`canTransitionOrder(role, from, to)`** — vérifie aussi le rôle de l'acteur.
3. **RPC Postgres `transition_order_status`** — verrou `SELECT FOR UPDATE` + validation atomique. C'est la source de vérité. Si deux agents agissent sur la même commande en même temps, le second échoue proprement (verrou de ligne).

---

## 4. Isolation des marchés — RLS (Row-Level Security)

Les deux marchés (Tunisie `…0001`, Libye `…0002`) sont **complètement isolés** au niveau de la base de données, pas juste dans l'interface.

### Comment ça marche

- RLS activé sur toutes les tables.
- Deux fonctions `SECURITY DEFINER` : `get_user_role()` et `get_user_market_id()` lisent le rôle depuis `auth.uid()`.
- Chaque requête d'un manager libyen ne retourne **physiquement** que des lignes libyennes — Postgres filtre au niveau du moteur, pas l'application.

### Pourquoi pas juste filtrer dans l'UI ?

Un filtre UI peut être contourné par une requête API directe. Avec RLS, même si le code de l'application oublie de filtrer, Postgres ne retournera jamais les mauvaises données. Un bug dans un composant React ne peut pas faire fuiter des commandes d'un autre marché.

### Cas spéciaux

- `super_admin` a `market_id = NULL` → la politique court-circuite vers "toutes les lignes".
- Les webhooks utilisent la clé service-role (contourne RLS), mais chaque commande créée porte le `market_id` de sa boutique — isolation par construction à l'écriture.

---

## 5. Intégration transporteurs — Pattern Adapter

Chaque transporteur (Navex, Dexpress, Darb Assabil) est une **classe adapter** qui implémente la même interface :

```
formatPayload → dispatch → parseResponse → voidDispatch
```

La factory `getCarrierAdapter(code)` renvoie le bon adapter. Les credentials sont chiffrés (AES-256-CBC) dans la colonne `carriers.api_credentials`.

### Flux d'envoi au transporteur

1. `POST /api/orders/[id]/dispatch` → `performDispatch`
2. Vérifications préalables : commande trouvée, pas déjà un `tracking_number` actif, transporteur actif et du bon marché.
3. `dispatchToCarrier` → adapter → appel API externe.
4. Succès → RPC `dispatch_order` (pose `tracking_number` + `carrier_id`, transition → `uploaded`, append historique).

### Deux gardes anti-double-expédition

1. **Backstop dans `performDispatch`** : si `tracking_number` est déjà défini → refus (409). Impossible d'envoyer deux fois.
2. **Garde doublon** : même téléphone + produit + quantité dans les 24h, avec une commande déjà expédiée → bloqué (nécessite confirmation explicite).

### Réouverture fail-closed (le cas le plus délicat)

Quand un agent veut modifier une commande `uploaded`, il faut d'abord annuler l'envoi chez le transporteur :

- On appelle `voidDispatch` chez le transporteur.
- **Si l'annulation n'est pas confirmée** (`local_only`) et que l'opérateur n'a pas passé `confirm_manual_cancel` → **on ne réouvre PAS**. La commande reste `uploaded`.
- Pourquoi ? Parce que si on réouvre et que l'envoi original n'était pas vraiment annulé, l'agent peut recréer un second envoi → double livraison → coût réel.
- Si l'annulation est confirmée (`carrier_voided`) → transition `uploaded → confirmed`, `tracking_number` effacé, colonnes forensiques `carrier_barcode_deleted_at` et `carrier_barcode_deleted_carrier_code` renseignées.

---

## 6. Calculs financiers — pures et côté serveur uniquement

Tout le code financier est dans `src/lib/calculations/` : fonctions **pures** (entrée → sortie, zéro effet de bord), jamais importées côté client.

### Règles absolues

- **Revenu = `orders.total_price` uniquement.** Jamais `unit_price × qty` ou un autre champ.
- **Tous les coûts viennent de la table `settings`** (frais livraison, retour, emballage, taux pub). Rien n'est hardcodé.
- Paiement carte = +10% sur le sous-total uniquement (pas sur la livraison).

### Pourquoi pures et serveur uniquement ?

- **Pures** → testables à 100%, déterministes, zéro surprise.
- **Serveur** → les marges et les coûts ne partent jamais dans le navigateur (pas d'exposition au client), et on empêche toute manipulation côté navigateur.

---

## 7. Intégration boutiques (webhooks)

Chaque plateforme (Shopify, EasyOrders, WooCommerce, LightFunnels, Buybox) a son **adapter** qui implémente : `validateWebhook → parseEventType → mapToInternalOrder`.

### Flux d'intake

1. Validation signature (HMAC-SHA256 pour Shopify/EasyOrders/Woo, UUID-URL pour Buybox).
2. **Idempotence** : dédup via `webhook_delivery_log` + contrainte unique `(storefront_id, external_id)` en base. Un même webhook reçu 3 fois → une seule commande créée.
3. Résolution produit et ville → `mapping_status` (complete / product_unmapped / city_unmapped).
4. Insertion commande `pending`, historique, tentative d'auto-assignation.

Si le produit ou la ville ne peut pas être résolu → la commande est quand même créée (on ne perd pas de commandes), avec un flag `mapping_status`. L'agent ou le manager résout manuellement.

---

## 8. Realtime et tâches planifiées

### Realtime

Supabase Postgres Changes (`postgres_changes`) pousse les changements de la base vers les clients. Les subscriptions sont **refcountées** : plusieurs composants qui écoutent la même table/filtre partagent **un seul channel**. Quand plus personne n'écoute, le channel est fermé proprement. Le handler realtime appelle `mutate()` de SWR → SWR refetch la donnée.

### Cron (Vercel Cron → `/api/cron/*`)

- `dispatch-scheduled` : auto-envoie les commandes `dispatch_scheduled` dont l'heure est arrivée. Si la destination manque → revient à `confirmed` (jamais de mauvais envoi automatique).
- `poll-carriers` : synchronise les statuts des commandes en transit.

---

## 9. Intégrité du stock

Le stock ne change que par **exactement trois chemins** :

1. **Création produit** → `initial_stock` (une ligne `inventory_log`, raison `initial_stock`).
2. **RPC `adjust_product_stock`** → super_admin uniquement, corrections manuelles.
3. **`scan_order_out` (−qty)** et **`scan_return_in` (+qty ou endommagé)** → entrepôt uniquement.

Managers et agents ne touchent jamais au stock. Chaque mouvement écrit une ligne dans `inventory_log` avec `balance_after` → le solde est toujours vérifiable et auditble.

---

## 10. Audit — logs append-only

Deux tables ne peuvent qu'être lues et écrites (jamais modifiées ni supprimées) :

- **`order_history`** : une ligne par transition de statut (from, to, acteur, note).
- **`inventory_log`** : une ligne par mouvement de stock (changement, raison, balance_after, acteur).

Comment c'est garanti ? Par la politique RLS elle-même : il n'existe **aucune politique UPDATE ou DELETE** sur ces tables. Postgres refuse physiquement toute modification, même via le service-role normal. C'est une contrainte par construction, pas par convention.

---

## 11. TDD — Développement piloté par les tests

**La loi de fer : aucun code de production sans un test qui échoue d'abord.**

Cycle : écrire le test → le voir échouer (pour la bonne raison) → écrire le minimum de code pour qu'il passe → refactorer.

~377 fichiers de tests. Les fonctions pures (calculs, preflight, adapters, graphe de statuts) ont des tests unitaires exhaustifs. Les Route Handlers sont testés avec des clients Supabase mockés pour vérifier les gardes d'auth, la validation des paramètres, et les bons codes HTTP retournés.

---

## Résumé en une ligne

Next.js 14 + Supabase (Postgres/RLS/Realtime) + Vercel, deux marchés isolés par RLS, machine à états atomique en RPC Postgres, adapters transporteurs/boutiques, calculs financiers purs serveur-only, logs append-only, TDD strict.
