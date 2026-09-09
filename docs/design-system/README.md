# Cartographie de l'interface Konekt

Relevé exhaustif de toutes les pages de l'application, au bouton et au libellé près,
constitué le 2026-09-09 sur la branche `claude/app-details-exhaustifs-s6nf9t`.
Objet : disposer de la matière réelle avant de redessiner le design system, plutôt que
de partir d'une intention.

Périmètre couvert : 532 fichiers TypeScript sous `src/`, 105 616 lignes de `.tsx`,
31 routes, 53 primitives UI.

## Les documents

| Fichier | Contenu |
|---|---|
| `00-fondations.md` | Audit quantitatif transverse : tokens, typographie, espacement, rayons, ombres, z-index, iconographie, états d'écran, dates, accessibilité, responsive |
| `01-ui-kit.md` | Les 53 composants de `src/components/ui/`, variantes cva et classes exactes, doublons, fichiers morts |
| `02-shell-dashboard.md` | Routes et gardes, `AppLayout`, sidebar, header, palette de navigation, Dashboard, Agents, Marketplace |
| `03-missions.md` | `/missions`, workspace mission (3 phases, 8 sous-onglets), brief, process, config, invitations |
| `04-sourcing-recherche.md` | Hero de recherche, plan, barre de facettes, panneau de filtres, résultats, carte profil, table compacte, fiche détail, scoring, quotas |
| `05-outreach-inbox.md` | Séquences, éditeur d'étapes, enrôlements, invitations, InMails, comptes connectés, inbox |
| `06-pipeline-ats.md` | Kanban, table, timeline, analytics, scorecard, qualification, fiche candidat et ses 9 onglets |
| `07-reglages-facturation.md` | Les 13 onglets de `/settings`, page `/pricing` publique |
| `08-public-auth-portails.md` | Landing, authentification, onboarding, portail candidat, portail client, profil recruteur public, pages légales |
| `09-calendrier-taches-ia.md` | Calendrier, tâches, drawer de l'agent, connecteurs, crédits |

Chaque document se termine par une section « anomalies » propre à sa zone.

## Comment lire ces documents

Ils décrivent l'existant, pas une cible. Un libellé cité entre guillemets est le texte
que l'utilisateur voit aujourd'hui, faute d'orthographe comprise. Une classe Tailwind
citée est celle qui figure dans le fichier. Les compteurs proviennent de relevés
automatiques sur le dépôt, reproductibles.

Deux documents d'audit antérieurs traînent à la racine du dépôt et sont périmés :
`DESIGN_AUDIT.md` décrit un style « brutal » en `rounded-none` avec ombres décalées, alors
que `index.css` a été réécrit le 2026-09-06 en thème Qonto avec `--radius: 0.75rem` ;
`UX_AUDIT.md` décrit 8 onglets de mission là où il y a désormais 3 phases.

---

# Diagnostic

Dix constats ressortent des dix documents. Ils sont classés par ce qu'ils coûtent à une
refonte, pas par gravité esthétique.

## 1. Le design system existe mais l'application ne l'utilise pas

L'application contient 625 balises `<button>` écrites à la main contre 341 usages du
composant `Button`. Le rapport est le même pour les cartes : 24 fichiers importent `Card`,
67 endroits recomposent `rounded-xl border border-border bg-card` à la main.

Conséquence directe : changer `buttonVariants` ne change presque rien à l'écran. Les
`variant` et `size` du bouton ne sont pas des paramètres exploitables aujourd'hui, ce sont
des conventions suivies par un tiers du produit. Le Dashboard, le Calendrier, les Tâches et
toute la zone de recherche n'emploient quasiment aucun `Button`.

Le relevé recense au moins dix formes de bouton primaire distinctes selon la page :
`h-9 px-4 rounded-full bg-foreground text-background text-[12px]` sur le Dashboard,
`h-9 px-4 border border-border bg-foreground text-background text-xs uppercase` sans rayon
sur Marketplace et Agents, `h-10 px-5` dans le kit, `h-12 px-7 border-2` sur la landing.

## 2. Deux langages visuels cohabitent, parfois dans la même page

Un langage « brutaliste » subsiste : aucun rayon, `border border-border`,
`text-xs font-bold uppercase tracking-wider`, aplat `bg-foreground text-background`.
Il tient Agents, Marketplace, le portail candidat, les états d'erreur globaux, les
primitives de `components/layout/`, la page 404.

Un langage « SaaS arrondi » domine ailleurs : `rounded-xl`, `bg-card`, `font-display`,
boutons `rounded-full`, ombres douces, animations framer-motion.

La page `/marketplace` mélange les deux : les listes de missions sont carrées, la carte
partenaire et la section des missions partenaires sont en `rounded-xl` avec effet de
survol. La page `/pipeline` fait pareil : la vue ATS est arrondie, la vue Shortlist qui
vit dans le même écran est carrée, avec une barre de filtres en `h-9` à côté d'une barre
en `h-8`.

L'onboarding ajoute un troisième registre, éditorial et sérif. Le portail client en ajoute
un quatrième, avec emojis en guise d'icônes et dégradés animés.

## 3. Deux systèmes de tokens, dont un plus abouti que l'officiel

Le thème shadcn historique vit dans `index.css` sous forme de triplets HSL. Une refonte
plus récente a introduit 26 variables `--k-*` en valeurs complètes, consommées via
`bg-[var(--k-surface)]`.

Le second système est le plus construit des deux. Il a une échelle de surfaces explicite
(`--k-bg` 8.5 %, `--k-surface` 11 %, `--k-surface-2` 14 %, `--k-surface-3` 16.5 %), trois
niveaux de filet, quatre niveaux de texte, et un accent avec ses états de survol, d'appui,
d'anneau et de teinte. Le système shadcn n'a rien de tout cela.

Mais `--k-*` ne couvre que le haut de l'écran de recherche : hero, plan, barre de facettes,
surcouches, barre de prompt. Les résultats, la carte profil, la table et la fiche détail
sont restés en shadcn. La frontière passe à deux pixels, entre la barre de facettes et le
panneau de résultats. Le fichier `SearchFiltersPanel.tsx` mélange les deux dans le même
composant.

Trois accents concurrents circulent en même temps : `--k-accent` en indigo,
`--accent`/`--primary` shadcn, et un dégradé violet écrit en dur
(`#4f46e5 → #7c3aed → #c026d3`) sur le bouton de scoring.

## 4. Une couleur d'accent non tokenisée porte l'identité visuelle

`bg-emerald-500/15` apparaît 74 fois dans 33 fichiers. C'est la tuile d'icône par défaut de
la sidebar, du Dashboard, du Calendrier, des Tâches, de la scorecard, du pipeline, des
états vides. Autrement dit, le vert qui signe l'interface vient de la palette Tailwind
brute, pas des tokens, et ne suit ni le thème clair ni le thème sombre.

Le composant qui existe précisément pour cela, `IconTile`, n'est utilisé que dans 5
fichiers. Son ton `default` code d'ailleurs la même valeur en dur.

Au total, 394 occurrences de couleurs Tailwind brutes contournent les tokens sémantiques.
`emerald` et `amber` doublonnent `success` et `warning`, qui existent pourtant et sont
employés en parallèle : `bg-success` compte 199 usages, `text-warning` 169. Le même statut
se peint donc de deux façons selon le fichier, avec des valeurs différentes
(`--status-success` vaut `142 71% 45%`, `emerald-500` vaut `160 84% 39%`).

## 5. L'échelle typographique a été définie puis contournée

`tailwind.config.ts` ajoute `text-3xs` (10 px) et `text-2xs` (11 px) avec un commentaire
explicite : ces paliers existent pour « bannir l'usage de `text-[Npx]` arbitraires ».

Le dépôt contient 1 122 tailles en pixels écrites en dur. `text-[10px]` compte 380
occurrences, soit deux fois plus que `text-3xs` qui vaut exactement la même chose.
`text-[11px]` compte 255 occurrences contre 155 pour `text-2xs`.

Dix paliers coexistent dans une plage de cinq pixels : 10, 10.5, 11, 11.5, 12, 12.5, 13,
13.5, 14, 15. Le corps de texte réel de l'application tourne autour de 11 px, alors que
l'échelle nominale place `text-xs` à 12 px et `text-sm` à 14 px.

Six graisses circulent. `body` est en `font-medium`, ce qui rend les 843 `font-medium`
posés localement sans effet. La règle globale qui force `h1, h2, h3` en Outfit 700 rend
`font-display` redondant sur les titres et interdit un titre en graisse 500 sans surcharge.

## 6. Les états d'écran n'ont pas de forme partagée

Le composant `EmptyState` est importé dans 6 fichiers. Les chaînes « Aucun » et « Aucune »
apparaissent 189 fois dans 116 fichiers. Environ 95 % des états vides sont donc écrits à la
main, la plupart sans illustration ni action de sortie. Les paddings relevés vont de `py-8`
à `py-16`, la ponctuation finale varie d'une occurrence à l'autre.

Le chargement a trois implémentations : `Skeleton` shadcn dans 12 fichiers, `Loader2` avec
`animate-spin` dans 105 fichiers (248 occurrences), `BrutalLoader` dans 20 fichiers, plus
40 `animate-pulse` posés à la main. Sur la seule page `/settings`, cinq traitements
différents cohabitent d'un onglet à l'autre, dont un spinner carré qui tourne sans
`rounded-full`.

Plusieurs écrans n'ont aucun état d'erreur : la page Agents affiche « Aucun agent » quand
la requête échoue, la page Tâches affiche « Zéro tâche en cours », le Calendrier n'exploite
pas son `isError`. Une panne réseau se lit comme un état vide.

## 7. Le vocabulaire produit n'est pas stabilisé

Les étapes de pipeline existent en deux tables incompatibles : `ATS_STAGES` (10 étapes en
français, « Nouveau » à « Perdu ») et `STAGE_CONFIG` du portail client (7 étapes en
anglais, `sourced` à `rejected`). La page Qualification écrit en base deux étapes,
« Qualifié » et « Rejeté », qui n'existent dans aucune des deux tables.

Les libellés de source du candidat ont quatre définitions concurrentes selon le fichier.
Les seuils de score ont trois barèmes (70/40, 70/50, 70 seul). Les seuils de stagnation
sont recopiés à l'identique dans quatre fichiers.

L'échelle de notation change de dénominateur : le portail client affiche « Score n/100 »
partout mais sa scorecard envoie une note sur 5.

Les libellés d'entretien de la scorecard restent en anglais dans une interface française :
« Phone Screen », « Culture Fit », « Strong Yes », « Maybe ». Les titres de l'assistant IA
aussi : « Sourcing Assistant », « Brief Assistant ».

## 8. Le ton oscille entre tutoiement et vouvoiement

Le relevé compte 308 marqueurs de vouvoiement (« votre » 162, « vos » 79, « vous » 67) et
127 marqueurs de tutoiement (« ton » 26, « tes » 20, « tu » 17, plus les impératifs).

Le partage ne suit aucune règle de zone. L'onglet Actions IA tutoie (« Tu vas approuver »),
la bannière de crédits vouvoie, et les deux s'affichent dans le même écran. Le portail
client tutoie, mais sa scorecard revouvoie dans le placeholder du champ commentaire. La
page Tâches tutoie, le Calendrier vouvoie.

## 9. L'accessibilité repose sur des acquis partiels

Le focus visible global est posé dans `index.css`, mais `--ring` vaut en thème sombre
`0 0% 100% / 25%`, soit un contour blanc à 25 % d'opacité. Le ratio de 3:1 exigé par
WCAG 2.1 pour un indicateur de focus n'est pas atteint.

Le kit lui-même est inégal : `Badge` et `SelectTrigger` utilisent `focus:` au lieu de
`focus-visible:`, la sidebar utilise `ring-sidebar-ring` sans décalage, les items de menu
n'ont pas d'anneau du tout.

Aucune bibliothèque de formulaire n'est en service. `form.tsx` est mort, donc
`react-hook-form` n'est utilisé nulle part et `zod` n'est importé dans aucun fichier. La
validation est écrite à la main partout, ce qui explique l'unique `aria-describedby` du
dépôt : rien n'associe automatiquement un champ, son libellé et son message d'erreur.

Cinq réglages de l'onglet Agence utilisent un bouton affichant « Activé » ou « Désactivé »
au lieu d'un `Switch`, sans `role="switch"` ni `aria-pressed`.

Les animations infinies ne respectent pas `prefers-reduced-motion`. La règle de
neutralisation ne couvre que `.interactive-card`, `.interactive-row` et `.stagger-in`. Les
248 `animate-spin`, les halos pulsants du Dashboard, les gradients animés du portail client
et les canevas animés continuent de tourner.

## 10. Quinze fichiers du kit sont morts, et ce qu'ils emportent compte

Ne sont importés nulle part : `accordion`, `aspect-ratio`, `background-paths`,
`breadcrumb`, `calendar`, `carousel`, `chart`, `drawer`, `form`, `slider`, `text-rotate`,
`toggle-group`, `use-toast`, `AnimatedChatBubble`, `AnimatedCompass`.

Ce que leur mort entraîne :

- `form.tsx` mort, donc pas de validation de formulaire outillée dans tout le produit.
- `calendar.tsx` mort, donc la page `/calendar` (924 lignes) réimplémente sa grille.
- `chart.tsx` mort, donc `recharts` n'est importé que par un seul fichier et les analytics
  du pipeline dessinent leurs barres en CSS.
- `breadcrumb.tsx` mort, donc aucun fil d'Ariane dans une application à trois niveaux de
  profondeur (`/missions/:id?tab=sourcing`).
- `use-toast.ts` mort et `sonner.tsx` importé sans être monté : deux systèmes de toast en
  dépôt, un seul rendu, 93 fichiers appellent `sonner`.

---

# Ce que le design system doit fixer

Les valeurs ci-dessous sont des propositions, dérivées de ce que l'application fait déjà
majoritairement plutôt que d'un idéal théorique. Chacune remplace un ensemble de pratiques
relevé plus haut.

## Fusionner les deux jeux de tokens

Reprendre la structure `--k-*` et la porter sur l'ensemble, puisqu'elle est plus explicite,
mais la déclarer en triplets HSL pour rester consommable par les classes Tailwind
sémantiques. Cela fait disparaître les 200 et quelques `bg-[var(--k-surface)]` au profit de
`bg-surface`.

Échelle de surfaces à quatre niveaux, filets à trois niveaux, texte à quatre niveaux,
accent avec ses cinq états. Un seul accent, rationné.

Ajouter un token d'ombrage d'overlay, aujourd'hui écrit `bg-black/80` dans quatre fichiers
du kit.

Ajouter un token `danger` distinct de `destructive`, pour séparer l'erreur d'état de
l'action destructive, aujourd'hui portées par la même variable.

Supprimer le préfixe `skalr`, nom d'un produit antérieur, des cinq variables de marque.

## Décider du sort de `emerald`

Deux issues seulement. Soit ce vert devient un token de marque déclaré et employé via
`IconTile`, et les 74 occurrences en dur migrent. Soit il disparaît au profit de
`bg-accent` ou `bg-success/15`. Le laisser en l'état revient à maintenir une couleur
d'identité hors du système, insensible au thème.

## Une échelle typographique à six paliers

L'usage réel se concentre sur 10, 11, 12, 13 et 14 px. Une échelle de six valeurs suffit,
avec des noms qui empêchent le retour aux pixels :

| Palier | Taille | Usage relevé |
|---|---|---|
| `caption` | 10 px | eyebrows, badges, compteurs |
| `micro` | 11 px | métadonnées, pills de toolbar |
| `body-sm` | 12 px | corps dense (tables, cartes) |
| `body` | 13 px | corps courant |
| `body-lg` | 14 px | titres de carte, boutons |
| `title` | 16 à 32 px | titres de page et de section |

Trois graisses au lieu de six : 500 pour le corps, 600 pour l'emphase, 700 pour les titres.
Retirer la règle globale sur `h1, h2, h3` et confier les titres à des classes.

## Quatre hauteurs de contrôle

Le relevé en trouve six dans le kit et sept dans le pipeline. Les usages réels se répartissent
entre `h-7` (283), `h-8` (296), `h-9` (269) et `h-10` (100).

| Nom | Hauteur | Usage |
|---|---|---|
| `xs` | 28 px | actions en ligne, chips, actions de carte |
| `sm` | 32 px | barres d'outils, filtres |
| `md` | 36 px | boutons de formulaire, champs |
| `lg` | 40 px | action principale d'un écran |

Aligner `Input`, `SelectTrigger`, `Button` et `Toggle` sur la même échelle. Aujourd'hui
`Input` est à 40 px, `Button size="sm"` à 36, `Toggle size="sm"` à 36 mais avec un rayon
différent, et quatre endroits surchargent la taille du bouton par `className`.

## Trois rayons

Le dépôt en emploie sept, plus `rounded` nu (151 occurrences) qui vaut 4 px et ne dérive
pas de `--radius`.

| Nom | Valeur | Usage |
|---|---|---|
| `control` | 8 px | champs, boutons rectangulaires, items de menu |
| `surface` | 12 px | cartes, popovers, dialogues, panneaux |
| `pill` | plein | badges, pills, avatars, boutons d'action |

Trancher les incohérences relevées dans le kit : `Tooltip` en 12 px contre `Popover` en
16 px, `Toggle` en 10 px contre `Button` en plein, `Sheet` sans rayon contre `Dialog` en
16 px.

## Une échelle de calques

Le dépôt contient `z-[9999]`, `z-[9998]`, `z-[6000]`, `z-[4000]`, `z-[2100]`, `z-[200]`,
`z-[100]`, `z-[70]`, `z-[60]`. Les overlays Radix sont à `z-50` et se font donc franchir.
Le `ToastViewport` est à `z-[100]`, ce qui rend un toast invisible derrière un dialogue
ouvert.

Cinq niveaux nommés suffisent : `base`, `sticky`, `overlay`, `modal`, `toast`, ce dernier
au-dessus de tout.

## Une primitive par état d'écran

Trois composants à écrire, puis à imposer :

`EmptyState` étendu, avec illustration, titre, explication et action. Il existe déjà, il
faut le rendre suffisant pour absorber les 189 états vides écrits à la main.

`ErrorState`, qui n'existe pas. Il remplacerait les trois implémentations concurrentes
(`ErrorBox` de Marketplace, le bloc de `OrganizationGuard`, `SectionErrorBoundary`) et
comblerait les écrans qui affichent aujourd'hui un état vide sur une erreur.

`LoadingState`, avec un seul parti pris par forme de contenu : squelette pour une liste ou
un tableau, indicateur circulaire pour une action, jamais les deux pour le même cas.

## Une couche de formatage

Deux systèmes de date coexistent (`date-fns` dans 62 fichiers, `toLocaleDateString` dans
26 endroits) et la locale française n'est importée que dans 4 fichiers. Partout ailleurs,
`format()` rend les mois et les jours en anglais dans une interface française.

Vingt formats de date distincts circulent, avec trois séparateurs différents entre la date
et l'heure (« à », « · », espace).

Un module unique avec six fonctions nommées (`formatDate`, `formatDateTime`,
`formatTimeOnly`, `formatRelative`, `formatDayLabel`, `formatMonthYear`) résout à la fois
la localisation et l'uniformité.

## Un vocabulaire produit unique

Une seule table d'étapes de pipeline, avec ses libellés français, ses couleurs et ses
seuils de stagnation, importée par l'ATS, le portail client, la qualification et les
analytics.

Un seul barème de score, avec ses trois seuils et son dénominateur.

Une décision sur le ton, appliquée partout. Le vouvoiement domine à deux contre un dans le
relevé, ce qui en fait le choix par défaut le moins coûteux à généraliser.

Une règle sur les emojis. Ils servent aujourd'hui d'icônes dans les pills de statut de la
recherche, les catégories de tâches, les étapes du portail client, les verdicts de
qualification et les actions de coaching. Soit ils deviennent un vocabulaire déclaré, soit
ils cèdent la place à lucide, qui fournit déjà 217 icônes distinctes.

---

# Ordre de bataille

Les étapes sont ordonnées par ce qu'elles débloquent, pas par leur difficulté.

1. Poser les tokens fusionnés et l'échelle typographique. Rien d'autre n'est stable tant
   que la base bouge.
2. Réécrire `Button`, `Input`, `Card`, `Badge` sur ces tokens, avec les quatre hauteurs et
   les trois rayons.
3. Migrer les 625 `<button>` natifs et les 67 cartes manuelles. C'est le gros du travail,
   et c'est lui qui rend le système effectif.
4. Écrire les trois primitives d'état et la couche de formatage.
5. Trancher le vocabulaire produit et passer une revue de copie sur le ton.
6. Reprendre l'accessibilité : anneau de focus contrasté, `focus-visible` uniforme,
   `prefers-reduced-motion` étendu, formulaires outillés.
7. Supprimer les 15 fichiers morts du kit, après avoir décidé du sort de `form.tsx`,
   `chart.tsx` et `breadcrumb.tsx`, qui méritent d'être ranimés plutôt que retirés.

La zone `/missions/:id` concentre 229 fichiers et 38 dialogues. Elle décide de la
faisabilité de toute refonte et devrait servir de terrain d'essai avant généralisation.
