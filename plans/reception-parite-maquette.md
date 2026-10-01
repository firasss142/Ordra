# Réception — parité avec la maquette, puis mise en production

> Suite de `plans/reception-de-marchandises.md`. Celui-là a construit le modèle ;
> celui-ci rend l'écran **identique à `prototypes/reception-marchandises-v2.html`**
> et le met en ligne.

## Le constat

La maquette v2 a six sections. L'implémentation en rend quatre, partiellement.
La preuve la plus courte : **huit clés de traduction existent en français et en
arabe et ne sont appelées nulle part.**

| Clé | Ce qu'elle devait porter | État |
|---|---|---|
| `segUnpaid` | le 5ᵉ filtre « Impayées » (§3) | jamais rendu |
| `unitsExpected` / `unitsCounted` | « 300 attendues » / « 312 comptées » (§3) | jamais rendu |
| `offDocket` | l'écart « +8 hors bon » (§4) | jamais rendu |
| `sendBack` | « Renvoyer à l'agent » (§4) | jamais rendu, pas de route |
| `reverse*` (4 clés) | « Contre-passer » (§4) | jamais rendu, **la route existe** |
| `addLine` | « Ajouter une ligne » (§2) | jamais rendu |

Le modèle de données, les trois RPC et la migration sont **déjà en production
depuis le 1er octobre**. Ce plan ne touche pas à la base : il n'ajoute aucune
colonne, aucune policy, aucune fonction. Tout est code applicatif.

## Ce qui est corrigé, section par section

### §3 — la liste

1. **Le 5ᵉ segment « Impayées »**, avec sa pastille rouge. Le serveur sait déjà
   filtrer `unpaid` ; il ne comptait pas.
2. **Les compteurs mentaient dès le premier clic.** Ils étaient calculés sur la
   liste *déjà filtrée* : choisir « Attendues » mettait `À valider` et
   `Validées` à zéro. Corrigé en comptant sur la projection complète, et en
   filtrant **côté client** — ce qui rend aussi le changement de segment
   instantané, comme dans la maquette.
3. **La chevron de fin de ligne** (8ᵉ colonne) — la ligne est cliquable, rien ne
   le disait.
4. **Le mot derrière le nombre** : `300 attendues`, `312 comptées`,
   `602 · 3 abîmées`, `80 annulées`. Un nombre nu ne dit pas de quoi il parle.
5. **Une réception attendue affiche son attendu, pas son reçu.** `totals.units`
   somme le *reçu* : un brouillon non compté affichait donc `0` là où la maquette
   affiche `300 attendues`. C'est le zéro-qui-ment, exactement ce que le reste du
   domaine refuse.
6. **`draft` se dit « Attendue », pas « Brouillon ».** Le filtre s'appelle déjà
   « Attendues » ; la pastille disait « Brouillon » sur les lignes qu'il
   retournait. La maquette dit « Attendue » partout. Un seul mot pour un seul
   état.
7. **Partiellement payée se lit « acompte 40 % »** — un pourcentage, pas un
   montant, parce que la colonne est étroite et que la somme restante a sa place
   dans la feuille.

### §4 — la feuille

8. **La vignette produit** sur chaque ligne (`ProductAvatar`, qui gère déjà le
   repli sur l'initiale). La maquette en met une ; reconnaître un produit sur un
   quai se fait par l'image.
9. **« Renvoyer à l'agent »** — nouvelle route `POST …/[id]/unsubmit`. Sans elle,
   un manager qui voit une erreur n'a que deux issues : valider ce qui est faux,
   ou ne rien faire. La maquette place ce bouton à côté de la validation parce
   que c'est là qu'on s'en sert.
10. **« Contre-passer »**, super_admin, sur une réception validée. La RPC et la
    route existent depuis le premier jour ; aucun bouton ne les appelait. Avec
    son dialogue : motif, et la phrase qui dit que le registre s'ajoute au lieu
    de s'effacer.
11. **« Comptée par »** devient une vraie clé. Le code fabriquait son libellé en
    retirant `{name}` d'une autre phrase par expression régulière.
12. **Les dates se lisent « 28 sept 2026 »**, pas `2026-09-28`.
13. **Une ligne comptée se teinte** (`.lrow.done`) — on voit d'un regard où on
    s'est arrêté.
14. **`+8 hors bon`** quand le produit n'était pas sur le bon de livraison.
    Aujourd'hui : rien du tout. Ce n'est pas un écart — il n'y a pas d'attendu
    pour en faire la différence — c'est un autre fait, et il a ses propres mots.

### §2 — la création

15. Les **en-têtes de colonnes** du sélecteur (`Quantité`, `Coût unit.`).
16. **`sku · en stock 943`** sous chaque produit choisi. Demande d'ajouter `sku`
    au `select` de `/api/products/search` — additif, aucun appelant cassé.
17. **« Ajouter une ligne »**, l'affordance explicite de la maquette.
18. L'indice **« Leur numéro, pas le nôtre. »** sous le n° de bon de livraison.

### §6 — le téléphone

19. **Le flux de comptage une ligne à la fois** : progression `2 / 5`, grande
    vignette, attendu + stock actuel, champ de 52 px avec `−` / `+`, les deux
    raccourcis (`l'attendu` et `zéro`), la ligne « abîmé » séparée en ambre,
    `Passer` / `Suivant`. C'est la seule section de la maquette qui n'avait
    aucun équivalent en React, et c'est celle qui sert sur un quai.
    Il s'ouvre automatiquement sous 768 px, et un bouton permet d'y entrer depuis
    le bureau.

## Hors périmètre (inchangé)

Pas de table fournisseurs, pas de bon de commande, pas de facture fournisseur,
pas de couches FIFO. Aucune migration : la base ne bouge pas.

## TDD

Un test qui échoue d'abord, pour chaque point vérifiable :

- liste : le 5ᵉ segment existe · les compteurs restent justes après un filtre ·
  une attendue affiche son attendu suffixé « attendues » · `draft` → « Attendue »
- feuille : « hors bon » quand l'attendu est nul · « Renvoyer à l'agent » visible
  pour un manager sur une déclaration, absent pour un agent · « Contre-passer »
  pour un super_admin seulement
- comptage téléphone : le raccourci « attendu » remplit le champ · « zéro » écrit
  `0` et non vide · « Passer » laisse `null`
- routes : `unsubmit` refuse à un agent, refuse sur un brouillon, remet `draft`

## Vérification

1. `npx vitest run` — aucun échec nouveau par rapport à la base (14 échecs
   pré-existants, dont 2 `DatePicker` hors sujet).
2. `npm run typecheck`, `npm run build`.
   (`npm run lint` ne fait rien dans ce dépôt — pas de config ESLint.)
3. Capture 390 × 844 en arabe du flux de comptage (page LTR, scène seule
   inversée — le harnais RTL plafonne à ~500 px).

## Mise en production

1. `feat/goods-reception` → `main` (fusion propre vérifiée : `origin/main` n'a que
   deux commits « pub » d'avance, zéro conflit).
2. `git push origin main` — Vercel déploie.
3. Vérifier le déploiement **prêt**, puis sur l'URL de production :
   `Entrepôt › Stock › Réceptions` apparaît pour un manager et pour un agent, la
   colonne coût est absente de la réponse API de l'agent.
4. Ne rien valider en production depuis une vérification : une validation bouge
   du stock réel et ne se corrige que par contre-passation.
