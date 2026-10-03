# Journaux — refonte complète (plan)

**Statut :** prototype v1 à valider — `prototypes/journaux-v1.html`. Rien dans `src/` avant validation.
**Date :** 2026-10-03. **Branche :** `feat/journaux-redesign` (worktree `.claude/worktrees/journaux`).
**Demande du propriétaire :** « la page /logs est bancale (design, structure, mise en page) ; sa logique
date, elle n'est pas mature ni à jour avec le système. Enquête en profondeur et construis un vrai
système de journal, pour les systèmes externes et internes. Je veux voir un prototype HTML. Soigne la
palette. »

---

## 1. Ce que l'enquête a trouvé

Méthode : trois lectures complètes du code (écrivains de journaux, intégrations externes, trous
d'audit) et des requêtes en lecture seule sur la production le 2026-10-03, uniquement des agrégats
(aucun client lu). Les chiffres ci-dessous viennent de la production.

### 1.1 L'écran actuel est en grande partie aveugle

| Onglet | Lit | Ce qu'il montre réellement |
|---|---|---|
| Commandes reçues | `webhook_delivery_log` | **24 lignes, toutes des tests Shopify du 13–14 mai.** L'arrivée réelle des commandes passe par Google Sheets : environ 1 600 commandes par mois, aucune ici. Les livraisons de webhooks WhatsApp sont mélangées dedans. |
| Transporteurs | `carrier_event_log` | **Toujours vide.** RLS activée sans aucune politique, pastille toujours à 0. |
| Synchronisations | 4 tables de passages | Aucune ligne Darb : `darb_sync_runs` et `darb_rate_harvest_runs` ont la RLS sans politique. |
| Modifications | `settings_history` + `user_audit_log` | Réglages seulement. La politique de `user_audit_log` teste `auth.jwt()->>'role' = 'super_admin'`, qui ne vaut jamais que `authenticated`. |

→ Les politiques de lecture sont corrigées dans la **PR #59** (prouvé sous un vrai JWT).

### 1.2 Du bruit à la place du signal

- `carrier_event_log` : **921 017 lignes, 540 Mo**, la plus grosse table de la base. 19 880 lignes par
  jour, toutes Navex, **0 appliquée**. Ce sont les mêmes 139 colis d'avril, réécrits toutes les 10 min.
- Aucune table de journal n'a de rétention. `cron.job_run_details` contient 311 857 lignes, jamais purgées.
- `darb_sync_runs.events_inserted` compte les lignes *tentées* : environ 24 900 par passage pour 2 changements réels.
- 6 tables de passages, 6 vocabulaires différents (`succeeded` / `completed`, `error` / `error_message` / `notes`).

### 1.3 Des échecs que personne ne voit

- **Archivage automatique : 43 nuits d'échec d'affilée** depuis le 22 août. Ni l'archivage tunisien
  ni le libyen ne tournent ; 921 commandes sont en attente. Cause : le réglage a été enregistré
  `{"value": 30}` depuis l'écran le 21 août, en même temps que 27 autres réglages. → **PR #58**.
  La même lecture fragile existe dans la Salle de contrôle, Performance et la journée d'un agent.
- **Un envoi au transporteur qui échoue n'est écrit nulle part**, quel que soit le chemin : agent,
  envoi en masse, envois programmés. Seuls les succès sont gardés.
- `poll-carriers` et `dispatch-scheduled` n'ont pas de table de passages ; pg_cron dit « réussi » dès
  que l'appel HTTP est mis en file.
- 20 passages Darb sont bloqués à `running` depuis le 25 septembre (rien ne les clôt). La récolte de
  tarifs n'écrit jamais `failed`. Un verrou WhatsApp bloqué bloquerait la file sans laisser de trace.
- Plusieurs écritures de journal sont rejetées en silence :
  - `payload NOT NULL` dans `webhook_delivery_log` ;
  - `source='manual'` refusé par `carrier_event_log` ;
  - `lead_history` attend une colonne `event_type` qui n'existe pas (`whatsapp/outbox.ts:468`).

### 1.4 Des problèmes métier que le journal aurait dû signaler

| Problème | Ampleur | Depuis |
|---|---|---|
| Navex « Livrer Payé » inconnu → colis livrés et payés restés « en route » | 91 colis, **5 479 TND** jamais comptés | avril |
| Navex « Retour reçu » refusé par la règle de statut | 48 colis, **2 732 TND**, stock jamais réintégré | avril |
| Compte Darb Benghazi désactivé le 1 oct. 18:26 → synchronisation arrêtée | **63 commandes en cours (15 347 LYD)** ; 15 sans aucune nouvelle | 1 oct. |
| Lignes Converty refusées (« Missing customer name »), jamais retraitées | **66** commandes jamais importées | 31 août |
| Commandes Converty arrivées « à associer » (ville « n/a » pour 62 % d'entre elles) | 2 575 sur 60 jours, **100 %** | — (peut-être voulu : en Libye, la destination Darb se choisit à la confirmation) |

« Aucune commande en Libye depuis le 29 sept. » n'est **pas** une panne : la dépense Meta est à 0
depuis le 30 sept. Le journal doit savoir expliquer un silence.

### 1.5 La piste d'audit interne a des trous

- **Bien journalisé** (en ajout seul, protégé par déclencheur) : statuts de commande, mouvements de
  stock, commissions, investisseurs, actions de suivi livraison, disponibilité.
- **Rien du tout** :
  - prix, coût et prix plancher des produits et variantes ;
  - lignes de commande (qui modifient `total_price`, donc le chiffre d'affaires) ;
  - coordonnées de paiement des investisseurs ;
  - suppression d'un paiement fournisseur ;
  - modification et suppression des dépenses pub ;
  - frais et identifiants des transporteurs ;
  - boutiques, comptes Meta, WhatsApp, motifs de rejet, parts de distribution, règles d'affectation ;
  - activation des sites d'entrepôt ;
  - rattachement de ville ou de produit ;
  - changement de rôle ou de marché (aucune route ; seulement en SQL) ;
  - connexions, échecs de connexion, export des clients. `auth.audit_log_entries` est **vide**.
- **À moitié** :
  - une réattribution n'enregistre ni l'ancien ni le nouvel agent ;
  - une modification client n'enregistre que la nouvelle valeur ;
  - une réouverture efface le motif du rejet sans le garder.
- **L'auteur peut être falsifié** : plusieurs RPC (`transition_order_status`, `assign_order`, …)
  prennent `p_actor_id` sans le comparer à `auth.uid()`.
- **Trouvé en route, Accès cassé** : désactiver, réactiver ou supprimer un utilisateur renvoie 500
  depuis le 2026-09-24. Désactiver rend d'abord les commandes à la file puis échoue ; supprimer
  bannit le compte puis échoue. → **PR #59**.

### 1.6 Sécurité (hors refonte, à traiter vite)

- **Un jeton Navex de 51 caractères est commité dans le dépôt PUBLIC**, dans
  `src/lib/carriers/polling/clients.test.ts` et `delivery_company_docs/navex/navex_api_reference.md`,
  depuis le 2026-04-22. Le faire tourner chez Navex ; l'historique git le garde.
- L'adaptateur Navex écrit l'URL (qui contient le jeton) dans les logs Vercel à chaque non-succès.
- L'adaptateur Dexpress écrit nom, téléphone et adresse du client à chaque envoi.
- Charges utiles complètes (téléphones, adresses) dans `webhook_delivery_log` et
  `sheet_sync_failed_rows`, sans rétention.

---

## 2. Ce que propose la v1 (le prototype)

Trois questions, trois onglets, une recherche :

| Écran | Question | Contenu |
|---|---|---|
| **Vue d'ensemble** | Est-ce que tout marche ? Sinon : quoi, depuis quand, combien ça coûte ? | Verdict en une phrase · **Problèmes** regroupés par cause, triés par impact (montant, commandes) · **Silences expliqués** · **Connexions** (barres d'une heure sur 48 h, « attendu, absent » distinct de « rien de nouveau ») · **Automatismes** (les 14 tâches, avec ce qu'elles ont *fait*, pas seulement « lancé ») |
| **Échanges externes** | Qu'a-t-on reçu, envoyé, synchronisé ? | Flux par jour, filtres par famille et résultat, **répétitions regroupées** (« ×100 depuis minuit ») et « rien de nouveau » masqué par défaut. Chaque ligne ouvre son détail et ses données reçues. |
| **Activité interne** | Qui a fait quoi ? | Personnes et automatismes ; **une action en série = une ligne** ; avant → après ; lien vers le problème causé |
| **Trace** (recherche `/`) | Qu'est-il arrivé à *cette* commande ? | Toutes les sources réunies sur une ligne de temps : import, attribution, appels, confirmation, envoi, scan, transporteur, commission |

Mots simples : « Échanges externes » et « Activité interne », pas webhooks ou audit ; « Problème » pour un regroupement par cause ; « Muet » quand
un rythme attendu manque ; « Rien de nouveau » quand une tâche tourne sans rien trouver.

### 2.1 v2 — la version allégée (2026-10-03, remplace v1 comme spécification)

Retour du propriétaire sur v1 : trop dense. `prototypes/journaux-v2.html` garde le même système et
les mêmes données, avec moins à l'écran :

- **Deux onglets.** « Aperçu » (est-ce que tout marche ?) et « Historique » (que s'est-il passé ?).
  Échanges externes et activité interne forment **un seul fil**, filtré par cinq puces : Tout ·
  Systèmes externes · Équipe · Automatique · Sécurité et erreurs. Une bascule « Problèmes seulement ».
- **Aperçu** : un verdict en une phrase, une carte par problème (titre, une phrase, un chiffre), puis
  **9 tuiles** — Darb Tripoli, Darb Benghazi, Navex, Converty, autres boutiques, Meta, WhatsApp,
  tâches automatiques, et **Ordra lui-même** (erreurs serveur et sécurité). Les « silences
  expliqués » deviennent le sous-titre de la tuile.
- **Le succès n'a pas de couleur.** Seuls un échec (rouge) et un « à vérifier » (ambre) en portent.
- **La routine est comptée, pas listée** : une ligne grise par jour (« 312 passages sans changement »).
- **Les panneaux** suivent toujours « Ce qui se passe · Combien · Que faire » ; barres horaires, liste
  des 14 tâches, codes d'erreur et données reçues sont repliés dans le panneau ou sous « Détails
  techniques ». Une modification ouvre un tableau avant → après.
- Les lignes marquées « exemple » montrent ce que le nouveau journal enregistrera et qu'Ordra
  n'enregistre pas aujourd'hui (le studio les masque avec « Réel seulement »).

---

## 3. Le système — ce qu'il faut construire

### 3.1 Principes

1. **Un problème est une cause, pas une ligne.** 13 013 lignes identiques = 1 problème « vu 13 013 fois ».
2. **On écrit les changements, pas les sondages.** Une ligne quand un statut change ; un compteur sinon.
3. **La base journalise elle-même.** Un déclencheur sur chaque table de configuration plutôt que
   « penser à écrire » dans 166 routes.
4. **L'auteur vient de la session**, jamais d'un paramètre.
5. **Chaque ligne porte son marché** (et son compte transporteur ou sa boutique).
6. **Rétention et données personnelles par construction** : extraits caviardés, purge datée.
7. **« Réussi » veut dire « a fait son travail »**, pas « a été lancé ».

### 3.2 Nouvelles tables

**`audit_events`** — en ajout seul, protégé par déclencheur (`ledger_append_only`).

| Colonne | Rôle |
|---|---|
| `occurred_at`, `market_id` | quand, quel marché |
| `actor_id`, `actor_role`, `actor_kind` (`person` / `system` / `service`) | qui |
| `action` | verbe, par ex. `carrier.updated`, `user.deactivated`, `order.reassigned`, `auth.login_failed`, `export.orders` |
| `entity_type`, `entity_id`, `entity_label` | quoi |
| `changes` | `{champ: [avant, après]}` ; secrets remplacés par `"••••"` |
| `context` | route, `request_id`, `bulk_id`, extrait d'agent utilisateur |
| `order_id` | corrélation pour la trace |

Écrit par un déclencheur générique `journal_row_change()` (AFTER INSERT/UPDATE/DELETE, colonnes
changées seulement, liste de colonnes secrètes par table) sur :
`carriers`, `carrier_order_preferences`, `storefronts`, `warehouses`, `markets`, `products`,
`product_variants`, `rejection_reason_configs`, `status_configs`, `agent_distribution_shares`,
`assignment_rules`, `agent_commission_rates`, `users` (rôle, marché, entrepôt, `is_active`,
`deleted_at`), `whatsapp_configs`, `whatsapp_templates`, `meta_ad_accounts`, `investors` (champs de
paiement), `reception_payments`, `ad_spend`, `order_items`.

L'auteur est lu dans `request.jwt.claims` ; les routes au rôle service appellent d'abord
`journal_set_actor(uid)` (un `set_config` local à la transaction).

Les actions sans ligne modifiée sont écrites par une RPC explicite `journal_record(action, …)` :
connexion, échec de connexion, export, envoi en masse.

**`integration_calls`** — chaque appel sortant qui compte.

| Colonnes | Contenu |
|---|---|
| quoi | `system`, `connection_id`, `operation` (`upload` · `void` · `bind` · `verify` · `quote` · `stock_read` · `send` · `test`) |
| résultat | `status` (`ok` · `error` · `timeout` · `refused`), `http_status`, `error_code`, `message` |
| mesure | `duration_ms`, `attempt` |
| contexte | `order_id`, `market_id`, `fingerprint` |
| extraits | `request_excerpt`, `response_excerpt` — caviardés, purgés à 30 j |

Une seule enveloppe dans la couche adaptateur, `withCallLog(op, fn)`, appelée par `perform-dispatch`,
les annulations, le bind/verify Darb et les tests de connexion.

**Passages normalisés** — une vue `integration_runs` (`source`, `connection_id`, `market_id`,
`trigger`, `status` parmi `ok` / `partial` / `failed` / `skipped` / `running`, compteurs utiles, `error`) au-dessus des six
tables existantes, et deux nouvelles tables de passages pour `poll-carriers` et
`dispatch-scheduled`. Un réapeur commun clôt tout passage `running` depuis plus de 30 min en `failed · abandonné`.

**`journal_issues`** — les problèmes.

| Colonnes | Contenu |
|---|---|
| identité | `fingerprint` (unique), `rule_key`, `system`, `connection_id`, `market_id`, `severity` (`critical` · `warning`), titre paramétré |
| chronologie | `first_seen`, `last_seen`, `occurrences` |
| impact | `affected_count`, `impact_amount`, `impact_currency` |
| état | `status` (`open` · `resolved` · `muted`), `resolved_at`, `muted_until`, `sample` |

Tenue à jour par `journal_detect()` toutes les 5 min (pg_cron), qui ouvre, met à jour et **ferme
automatiquement** quand la règle ne se déclenche plus. Règles v1 :

| # | Règle | Exemple réel |
|---|---|---|
| R1 | une tâche planifiée échoue 2 fois de suite (résultat réel) | archivage, 43 nuits |
| R2 | une connexion active est muette depuis plus de 3 fois son rythme, ou un compte inactif a des colis en route | Darb Benghazi |
| R3 | un statut transporteur est inconnu (regroupé par statut brut) | « Livrer Payé » |
| R4 | une transition est refusée (regroupée par de → vers) | « Retour reçu » |
| R5 | une ligne d'import est refusée depuis plus de 24 h | 66 lignes Converty |
| R6 | plus de N envois au transporteur échouent en 1 h, par code d'erreur | (non visible aujourd'hui) |
| R7 | une signature de webhook est invalide | (non écrit aujourd'hui) |
| R8 | un passage reste bloqué | 20 passages Darb |
| R9 | WhatsApp passe en `auth_failed` / `paused`, ou Meta renvoie l'erreur 190 | — |
| R10 | dépense pub > 0 mais aucune commande depuis X h — ou l'inverse, pour « expliquer » un silence | Libye, 30 sept. |
| R11 | une même action renvoie une erreur serveur ≥ 3 fois en 1 h, ou 100 % de ses essais en 24 h (regroupée par route + méthode) ; se ferme après 1 h sans erreur | désactiver un utilisateur, 500 depuis le 24 sept., invisible 9 jours (PR #59) |
| R12 | ≥ 5 échecs de connexion sur un compte en 15 min, ou un export de plus de 1 000 clients | — |

**`app_errors`** — les erreurs d'Ordra lui-même, aujourd'hui seulement dans les journaux Vercel.
Une enveloppe `withRouteErrors(handler)` autour des routes `app/api/**` écrit, pour toute réponse
≥ 500 ou exception : `occurred_at`, `route`, `method`, `status`, `error_code`, `message` (caviardé,
200 caractères), `actor_id`, `market_id`, `request_id`, `fingerprint` (route + méthode + code).
Écrite par le rôle service, jamais lue par le navigateur ; purgée à 30 jours. Alimente R11 et la
tuile « Ordra ». Pas de capture côté navigateur dans cette version.


**`carrier_event_log`** — on ajoute `market_id`, `carrier_id`, `repeat_count` et `last_seen_at`.
Les écrivains font une mise à jour quand le dernier événement de ce colis est identique, sinon ils
insèrent. Résultat attendu : quelques milliers de lignes au lieu de 921 017.

### 3.3 Modèle de lecture

- `journal_feed(from, to, market, family, result, cursor)` — SECURITY DEFINER, super_admin vérifié
  dans la fonction, pagination par clé (`occurred_at`, `id`). Elle réunit :
  - les passages, les appels et les événements transporteur (changements seulement) ;
  - les webhooks, les imports avec lignes ;
  - les promotions de statut Darb ;
  - les statuts WhatsApp.
- `audit_feed(...)` — elle réunit :
  - `audit_events` ;
  - `order_history`, lu à travers une vue typée `order_history_typed` (changement de statut,
    modification de champ, réattribution, tentative, rattachement, reprise) ;
  - `inventory_log`, `agent_availability_log`, `delivery_actions` ;
  - commissions, `lead_history` (appels Prospects), `customer_feedback_events` (Voix du client),
    `label_prints`, `settings_history` ;
  - `investor_statements` / `investor_deal_statements` (relevés arrêtés, côté automatismes) ;
  - les campagnes WhatsApp : une ligne par envoi, écrite par `journal_record('whatsapp.campaign_sent')`
    avec le nombre de destinataires, puis complétée des remis / en échec depuis `whatsapp_messages` ;
  - `app_errors` et les événements de sécurité (`auth.login`, `auth.login_failed`, `export.*`) pour
    la puce « Sécurité et erreurs ».

  Les séries sont regroupées par auteur, action et fenêtre de 60 s.
- `order_trace(order_id)` — toutes les sources d'une commande, dans l'ordre.
- `journal_counts()` — pastilles et verdict, par requêtes d'en-tête (`count` exact, jamais
  `n_live_tup`).

### 3.4 Rétention et données personnelles (proposé — à confirmer, voir §7)

| Données | Durée |
|---|---|
| Extraits bruts (`raw_body`, `payload`, `request_excerpt`) | 30 j, puis mis à NULL |
| `carrier_event_log` (dédupliqué) | 180 j |
| `integration_calls` | 90 j |
| `cron.job_run_details` | 30 j (purge pg_cron) |
| `audit_events` | conservé (petit) |

Dans les listes, les téléphones sont masqués (`09•• ••• 058`). Le détail complet n'apparaît que
dans le tiroir, pour le super_admin. Aucun jeton dans les logs : correction des adaptateurs.

### 3.5 Accès

Journaux reste réservé au **super_admin**, comme décidé pour Réglages. Il est donc toujours en
français (le super_admin n'a pas de marché, voir `super-admin-always-french`). Si un jour un
manager y accède, l'arabe et le RTL seront à faire.

---

## 4. Design — extension « Journaux » (§4.23 proposé pour `docs/design-system.md`)

Même console : fond `#F6F6F7`, cartes blanches, encre `#1A1A1A`, vert de marque pour le chrome
(onglet actif, bouton principal, pastille « À jour »).

**Sévérité** — vocabulaire de statut, jamais décoratif. Chaque teinte a un partenaire `-ink` pour le texte.

| Jeton | Remplissage | Encre (texte) | Fond pastille | Contraste encre/fond |
|---|---|---|---|---|
| `--lg-ok` | `#4FA886` (barres) | `#006E52` | `#F1F8F5` | 5,81 : 1 |
| `--lg-warn` | `#D9A520` | `#8A6500` | `#FFF8E6` | 5,03 : 1 |
| `--lg-fail` | `#D72C0D` | `#B42309` | `#FFF4F4` | 6,12 : 1 |
| `--lg-info` | — | `#2C6ECB` | `#EAF1FB` | 4,40 : 1 (gras) |
| `--lg-mute` | `#C5CBD3` | `#6D7175` | `#F1F2F3` | 4,39 : 1 (gras) |

**Familles** — des remplissages pour les tuiles de système et les points de filtre, jamais du texte,
jamais une sévérité. Vérifiées avec le simulateur de daltonisme (`palette.py`) : écart minimal
ΔE76 **37,5** en vision normale, **23,3** protan, **25,5** deutan, **24,1** tritan.

| Famille | Remplissage | Teinte | Encre | Encre/teinte |
|---|---|---|---|---|
| Réception | `#4F46E5` indigo | `#EEEDFC` | `#3F37C9` | 6,98 : 1 |
| Transporteurs | `#0F766E` sarcelle | `#E3F3F1` | `#0B5C56` | 6,85 : 1 |
| Publicité | `#EA6A1F` (= `--ads-pub`) | `#FDEFE6` | `#B4500F` | 4,56 : 1 |
| Messagerie | `#0EA5E9` ciel | `#E3F4FC` | `#0369A1` | 5,26 : 1 |
| Automatismes | `#A1A8B3` gris | `#F0F1F3` | `#4B5563` | 6,69 : 1 |

La couleur n'est **jamais seule** :
- une forme accompagne chaque sévérité (✕ échec, ▲ attention, anneau en pointillé « muet ») ;
- un mot accompagne chaque pastille ;
- les barres « attendu, absent » sont **creuses** (contour ambre), pas seulement d'une autre couleur ;
- les lignes en pointillé hachuré (« Nouveau ») n'existent que dans le prototype, pour montrer ce
  que le système d'aujourd'hui n'enregistre pas.

Violet reste un statut de commande (« Confirmée ») et n'est jamais une famille.

---

## 5. Phases

| Phase | Contenu | État |
|---|---|---|
| **0** | PR #58 : lecteurs de réglages et archivage nocturne. PR #59 : Accès (statut des utilisateurs) et politiques de lecture des journaux | PR ouvertes, migrations à coller |
| **1 — fondations** | `audit_events` + déclencheur générique + fil de l'auteur ; `integration_calls` + `withCallLog` ; colonnes et dédoublonnage de `carrier_event_log` ; vocabulaire des passages + réapeur ; passages de poll/dispatch ; `app_errors` + `withRouteErrors` ; `journal_record` pour connexions, exports et campagnes WhatsApp ; rétention | à faire |
| **2 — détection** | `journal_issues`, règles R1–R12, `journal_detect()` toutes les 5 min, fermeture automatique, pastille de la barre latérale | à faire |
| **3 — écran** | Journaux selon **prototype v2** : Aperçu + Historique (un fil, cinq puces), 9 tuiles, panneaux, trace ; i18n fr (+ clés ar pour la parité) ; tests de composants et de routes | à faire |
| **4 — nettoyage** | Supprimer `JournauxWorkspace` et les routes orphelines (`/api/admin/logs/summary`, `carrier-events/[id]`, `connections/overview`, `storefronts/[id]/health`) | à faire |

**Hors refonte, à décider par le propriétaire** (le journal les montre, il ne les corrige pas) :
- correspondance Navex « Livrer Payé » et transitions de retour ;
- suivi des colis en cours d'un compte Darb désactivé ;
- relance des 66 lignes Sheets ;
- rotation du jeton Navex ;
- adaptateurs qui écrivent des données personnelles dans les logs.

---

## 6. Vérification

- Chaque migration : test SQL sous un vrai JWT (`supabase/tests/`), avec les mêmes garde-fous que
  #58 et #59, et une vérification que les anciens écrivains restent valides.
- Détecteur : une base locale avec les cas réels (archivage, Navex, Benghazi, lignes Sheets) ; chaque
  règle ouvre puis ferme son problème.
- Écran : tests des composants (verdict, regroupement des répétitions, regroupement des séries, trace),
  test des tailles en pixels comme pour Réglages, et passage dans le navigateur sur la base locale.
- Lint : `npm run lint` ne vérifie rien dans ce dépôt (voir mémoire) ; `typecheck` et tests seulement.

## 7. Décisions à prendre

1. **Rétention des données brutes** (supprime environ 900 000 lignes) : 30 j recommandé / 90 j / tout garder.
2. **Navex** (Tunisie en sommeil) : corriger le suivi (91 « Livrée », 48 « Retournée », 8 211 TND)
   recommandé / arrêter le suivi Navex / laisser en l'état.
3. **Darb Benghazi** : la désactivation était-elle voulue ? Si oui, continuer à suivre les 63
   colis en cours (recommandé) ; sinon, réactiver.
4. **Alerte** : pastille dans la barre latérale seulement (recommandé) / plus un résumé quotidien.
