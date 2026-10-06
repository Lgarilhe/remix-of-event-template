# 01 · Direction design

Ce document fixe les règles visuelles de Konekt. Il sert de référence à toute personne ou IA qui modifie l'interface. En cas de doute, il l'emporte sur l'habitude locale d'un fichier.

Il reprend et arbitre quatre sources : la maquette « Konekt Design System » du 21 septembre 2026, la maquette « Mission Konekt » du 25 septembre 2026 (refonte de l'expérience mission, en cours dans une autre session), les jetons `--k-*` posés par la refonte de la recherche en juillet (PR #218), et la demande du propriétaire sur la PR #245 : un design uniforme, pas chargé, sans effet décoratif.

## 1. Le parti pris

Konekt est un outil de travail quotidien pour des recruteurs. L'écran doit se faire oublier au profit des candidats, des messages et des décisions. Le registre visé est celui de Linear ou de Qonto : des neutres chauds, un seul accent, peu de familles de police, des espacements réguliers, un mouvement discret qui confirme chaque geste.

Ce que l'on prend des tendances 2026 :

- Le design calme : la qualité perçue vient de la régularité (mêmes hauteurs, mêmes rayons, mêmes mots) et de ce qu'on retire, pas des effets.
- Les micro-interactions : chaque élément cliquable réagit au survol, à l'appui et au focus clavier, avec les mêmes durées partout.
- L'aide contextuelle : placeholders qui donnent un exemple réel, infobulles qui expliquent une conséquence, états vides qui disent quoi faire ensuite.
- L'interface agentique honnête : quand l'IA Konekt travaille, l'écran montre les étapes, la progression et un résultat vérifiable, jamais une animation qui simule de l'activité.

Ce que l'on écarte :

- Le « liquid glass » et les surfaces en verre dépoli : illisibles sur les listes denses, coûteux à l'affichage, et contraires au calme recherché.
- Les dégradés violet-rose, halos pulsés, reflets balayants, particules et fonds animés. Ils signalent une interface générée à la chaîne. Seules exceptions : le fond de l'accueil, de la recherche et du héros du sourcing, et les cartes texturées (§ 7).
- Le grain et les textures dans l'application. Une texture discrète reste envisageable sur les pages publiques, si elle sert la marque et ne gêne pas la lecture. Même exception pour ces écrans et ces cartes.
- Les emoji servant d'icône, et l'étincelle ✨ pour dire « IA ».

## 2. Couleur

### Les surfaces

Teinte 40°, saturation 3 %. Le thème sombre est le thème par défaut, le clair est dessiné à part (les bordures passent en alpha sur fond sombre, en couleur opaque sur fond clair).

| Jeton | Rôle | Sombre | Clair |
|---|---|---|---|
| `--background` | fond de page | `40 3% 11%` | `40 12% 96%` |
| `--card` | cartes, panneaux | `40 3% 16%` | `0 0% 100%` |
| `--popover` | menus, dialogues | `40 3% 18%` | `0 0% 100%` |
| `--muted` / `--secondary` | zones en retrait, contrôles pleins, puces de filtre | `40 3% 20%` | `40 8% 92%` |
| `--accent` | survol d'une ligne ou d'un item | `40 3% 22%` | `40 8% 93%` |
| `--sidebar-background` | barre latérale | `40 3% 8%` | `40 8% 96%` |
| `--border` | filet | blanc 10 % | `40 8% 90%` |
| `--border-strong` | bord de contrôle : anneau de l'onglet actif, survol d'une puce, toggle | blanc 42 % | `40 3% 48%` |
| `--input` | bord de champ, de case à cocher, de radio, piste d'interrupteur éteint | blanc 42 % | `40 3% 48%` |

En clair (décision du propriétaire du 06/10/2026, façon Qonto) : fond à 96 %, zones grises à 92 %, cartes blanches. La carte se détache du fond à 1,09:1, la zone grise à 1,09:1 du fond et à 1,19:1 de la carte ; les zones grises se voient enfin sur une carte blanche.

`--border-strong` et `--input` sont un seul bord de contrôle : 3:1 au moins sur toutes les surfaces (3,37:1 au pire en clair, sur la ligne active, 3,6:1 sur le survol ; 3,44:1 au pire en sombre, sur le survol). Un champ se repère sans son libellé. Au survol, son bord passe à `muted-foreground` ; au focus, à `brand`, avec un anneau plein (§ 10). Les filets décoratifs restent `--border`.

Attention au nom : dans ce dépôt, `accent` (hérité de shadcn) désigne le gris de survol, pas la couleur de marque. La couleur de marque s'appelle `brand`. Pour ne pas laisser d'anciens usages invisibles, `text-accent` et `border-accent` rendent `brand` ; le nouveau code écrit `text-brand`.

### Le texte

| Jeton | Rôle | Sombre | Clair |
|---|---|---|---|
| `--foreground` | texte principal | `0 0% 98%` | `40 6% 12%` |
| `--foreground-secondary` | texte secondaire, descriptions | `40 4% 74%` | `40 5% 34%` |
| `--muted-foreground` | métadonnées, gestes de retrait | `40 3% 67%` | `40 4% 38%` |

Contraste vérifié (`tests/ux/contraste-jetons.test.mjs`) : `muted-foreground` tient 4,5:1 sur toutes les surfaces, ligne active, survol et barre latérale compris (4,90:1 au pire en clair, sur la ligne active ; 5,08:1 au pire en sombre, sur le survol). L'ancienne valeur claire (42 %) tombait à 4,3:1 sur la ligne active. Le gris secondaire ne dit plus que deux choses : « métadonnée » et « retrait » ; une action, une icône ou le texte d'un badge sont à l'encre (§ 6 et § 10). Le texte indicatif des champs (`placeholder`, `--k-text-placeholder`) prend ce gris plein, sans opacité.

Pas d'opacité sur un jeton de texte (`text-muted-foreground/60`, `text-foreground/70`) : elle fait tomber le texte sous 4,5:1. Choisir l'un des trois niveaux ci-dessus.

### L'accent

Un seul accent, bleu-vert désaturé (choisi le 28/09/2026 à la place de l'indigo, pour s'accorder aux illustrations), rationné à quatre usages : le focus clavier, la sélection (case cochée, interrupteur, onglet actif), les signaux qui demandent l'attention (compteur de non-lus, pastille de nouveauté, priorité) et la progression. Le bouton principal n'est pas en accent : il est monochrome.

| Jeton | Rôle | Sombre | Clair |
|---|---|---|---|
| `--brand` | anneau de focus, texte et icônes d'accent | `179 32% 62%` (#7fbdbc) | `181 34% 33%` (#387071) |
| `--brand-foreground` | texte posé sur un aplat `brand` | `180 25% 10%` | `0 0% 100%` |
| `--brand-hover` / `--brand-press` | survol et appui | `179 36% 70%` / `179 30% 56%` | `181 34% 28%` / `181 34% 24%` |
| `--brand-solid` | aplat qui porte du texte blanc | `181 34% 29%` (#316263) | `181 34% 29%` |

Contrastes vérifiés : `brand` tient 5,45:1 au moins sur toutes les surfaces sombres (au pire sur le survol) et 4,55:1 sur toutes les surfaces claires (au pire sur la ligne active) ; le texte sur aplat `brand` atteint 7,9:1 en sombre et 5,6:1 en clair ; le blanc sur `brand-solid` 6,9:1. L'anneau de focus est `brand` plein.

L'ancienne classe `brand-purple` (palette Skalr) est rabattue sur `brand` : ses usages restants prennent le bleu-vert.

### Les statuts

Chaque statut a une valeur par thème, lisible en texte (4,5:1) sur toutes les surfaces, ligne active et survol compris (4,66:1 au pire en clair, 4,89:1 en sombre), et sur sa propre teinte.

| Statut | Sombre | Clair | Emploi |
|---|---|---|---|
| `success` | `145 55% 50%` | `145 63% 28%` | réussite, candidat retenu, compte connecté |
| `warning` | `38 92% 58%` | `32 95% 31%` | attention requise, quota proche |
| `info` | `215 90% 72%` | `215 75% 42%` | information neutre, en cours |
| `danger` | `0 84% 75%` | `0 72% 45%` | erreur d'état, échec, alerte |
| `destructive` | `0 70% 48%` | `0 72% 45%` | aplat d'une action irréversible, texte blanc |

`danger` et `destructive` sont distincts : le premier signale une erreur, le second qualifie une action qui détruit. En sombre, aucune couleur ne peut servir aux deux (un rouge lisible sur fond sombre est trop clair pour porter du texte blanc). La classe `text-destructive` rend donc la couleur `danger`, `bg-destructive` rend l'aplat.

Forme d'un badge de statut, à la Qonto (décision du propriétaire du 06/10/2026) : fond teinté pâle, texte à l'encre et pastille ronde de 6 px de la couleur du statut avant le libellé. Une icône posée dans le badge prend la couleur du statut et remplace la pastille. La couleur ne porte jamais le texte d'un badge : le mot dit le statut, la pastille l'appuie (texte de 11,8 à 14,9:1 sur sa teinte, pastille de 5,1 à 6,6:1). Le badge neutre (`muted`) est à l'encre sur le gris, sans pastille. L'aplat plein avec texte blanc est réservé aux boutons destructifs. Bandeaux, messages d'alerte, tuiles d'icône et statuts écrits en ligne (« En retard ») ne sont pas des badges : leur texte ou leur icône garde la couleur du statut.

### Couleurs interdites

- Les couleurs Tailwind brutes (`bg-emerald-500/15`, `text-amber-600`…) : elles ignorent le thème et doublonnent les statuts. Utiliser `success`, `warning`, `info`, `danger`, `brand`.
- Les couleurs en dur (`#4f46e5`, `rgb()`…) hors des logos de tiers.
- Les jetons `--k-*` et `--skalr-*` : ils restent définis pour ne rien casser mais pointent vers les jetons ci-dessus. Ne plus en écrire.

Couleurs de tiers autorisées : `linkedin`, `whatsapp`, et les logos officiels.

### Le score d'un candidat

Un seul barème, celui du moteur de scoring : fort à partir de 65 (`success`), moyen de 50 à 64 (`warning`), faible sous 50 (`muted` : un score faible n'est pas une erreur). Un seul rendu, `ScoreBadge` (`src/components/ui/score-badge.tsx`, seuils dans `src/lib/scoreScale.ts`) : le nombre seul à l'écran, « sur 100 » et le niveau dans le nom accessible et l'infobulle.

### Les canaux

LinkedIn et WhatsApp se reconnaissent à leur logo officiel, l'e-mail et l'appel à leur icône à l'encre (`ChannelIcon`, table `src/lib/channels.ts`). La couleur d'un canal reste dans son logo : une étape de séquence, un statut, un ton ou un bouton ne prennent jamais la couleur d'un canal.

## 3. Typographie

Une seule famille dans l'application : Instrument Sans, graisses 500 (corps), 600 (emphase, titres), 700 (grands chiffres d'un tableau de bord, titre de page principal). Space Mono pour les identifiants, raccourcis clavier et chiffres alignés. Bricolage Grotesque, police de marque, est réservée aux titres des pages publiques (accueil, tarifs). Outfit, Space Grotesk et Instrument Serif sont retirés.

Paliers du design simplifié (octobre 2026, `06-simplicite.md`) : rien sous 12 px, le corps passe de 13 à 14 px.

| Palier | Classe | Taille / interligne | Emploi |
|---|---|---|---|
| caption | `text-3xs`, `text-2xs` | 12 / 16 | compteurs, badges, intitulés de section (deux noms pour un palier, à fondre dans `text-xs` au fil des lots) |
| body-sm | `text-xs` | 13 / 18 | métadonnées, en-têtes de colonne, tableaux denses |
| body | `text-sm` | 14 / 20 | corps courant, boutons, champs |
| body-lg | `text-md` | 15 / 22 | texte principal d'une ligne de liste, texte de lecture |
| section | `text-lg` | 18 / 28 | titre de section |
| title | `text-title` | 28 / 36 | titre de page (graisse 600, `PageHeader`) |

Les tailles arbitraires `text-[11px]` sont proscrites : chaque valeur a son palier nommé. Le lot des fondations les a toutes remplacées (480 dans 60 fichiers), avec le même décalage d'un pixel que les paliers. `text-title` est déclarée à `tailwind-merge` dans `cn` (`src/lib/utils.ts`) : sans cela, elle serait prise pour une couleur.

Intitulé de section : la classe `eyebrow` (12 px, graisse 600, capitales, espacement 0,08 em, couleur `muted-foreground`). C'est le seul usage des capitales. Pas de titre ni de bouton en capitales.

## 4. Espace, rayons, élévation

Espacements sur la grille de 4 px de Tailwind. Rythme courant : 4 et 8 à l'intérieur d'un contrôle, 12 et 16 entre éléments d'une carte, 24 entre sections, 32 à 40 pour le haut de page.

Trois rayons principaux, dérivés de `--radius` (8 px) :

| Nom | Classe | Valeur | Emploi |
|---|---|---|---|
| control | `rounded-lg` | 8 px | boutons, champs, onglets |
| surface | `rounded-xl` | 16 px | cartes, menus, dialogues, panneaux |
| pill | `rounded-full` | plein | badges, pastilles, avatars |

Deux cas dérivés : `rounded-md` (6 px) pour un élément imbriqué dans une surface ou un contrôle (item de menu, segment d'un contrôle segmenté), et `rounded-sm` (4 px) sous 20 px de haut (case à cocher, barre de squelette). `rounded-none`, `rounded-2xl`, `rounded-3xl` et les valeurs arbitraires sont proscrits.

Élévation : en sombre, les surfaces se distinguent par leur luminosité (`background` 11 < `card` 16 < `popover` 18 < `muted` 20 < `accent` 22) et un filet. Une carte se détache du fond de 5 points, sans dépendre de son filet. En clair, la carte est blanche sur un fond à 96 % et porte une ombre légère (`shadow-sm`, dans `Card`). Les ombres marquées servent aux éléments qui flottent : menus, dialogues, toasts (`shadow-lg`, `shadow-xl`).

Relief (demande du propriétaire du 05/10/2026, « l'application est encore un peu plate », référence Qonto) : on regroupe sur une carte ce qui demande une décision (liste « À faire », tableau des missions), on colore le fond de ce qui bloque le travail (bandeau de la panne LinkedIn : carte texturée chaude, voir § 7), et on laisse nu le reste de la page. Une carte contient des lignes séparées par des filets, jamais une autre carte.

## 5. Hauteurs de contrôle

| Taille | Hauteur | Emploi |
|---|---|---|
| `xs` | 28 px | actions en ligne, chips, actions de carte |
| `sm` | 32 px | barres d'outils, filtres |
| défaut | 36 px | boutons et champs de formulaire |
| `lg` | 40 px | action principale d'un écran |

`Button`, `Input`, `SelectTrigger` et `Toggle` partagent cette échelle. Sur téléphone, une cible tactile fait au moins 44 px : les éléments de navigation ajoutent `min-h-11 md:min-h-0`, comme la barre latérale.

## 6. Composants

Toujours passer par les primitives de `src/components/ui/` : `Button` plutôt qu'un `<button>` stylé à la main, `Input` et `Select` plutôt que les champs natifs, `Card` plutôt que `rounded-xl border bg-card` recopié.

Boutons (décision du propriétaire du 06/10/2026, « plus marqué, façon Qonto ») : trois styles, du plus fort au plus discret, plus le gris des retraits.

Tous les boutons sont des pilules (`rounded-full`). Les champs, eux, gardent le coin de contrôle à 8 px.

- `primary` : plein d'encre (noir en clair, blanc en sombre), jamais la couleur de marque. L'action de la zone, une seule par zone : l'en-tête de page, un bandeau d'alerte, une carte de décision.
- `secondary`, `outline` et `default` : contour d'encre, mêmes classes (filet `foreground` de 1 px, blanc à 70 % en sombre pour qu'il ne scintille pas ; 13,3:1 au pire en clair, 6,3:1 en sombre), fond transparent, survol `accent`. Une action qui fait avancer : l'action d'une ligne (« Lire », « Relancer »), l'action suivante, l'option qui ouvre une barre (« Aujourd'hui »).
- `ghost` et `link` : discrets à l'encre, sans contour. Action tertiaire ou d'entretien (« Toutes les tâches », « Ajouter un critère », « Actualiser »).
- Gris secondaire, seulement pour un geste de retrait (Supprimer, Retirer, Dissocier, Effacer, Révoquer, Déconnecter, Écarter, Ignorer, Mettre en pause, Arrêter, Sauter, Ne pas envoyer) : `ghost` avec `text-muted-foreground`, et `hover:text-danger` s'il détruit. Un onglet, un segment ou une bascule non choisis restent gris aussi : le gris y dit « non choisi ».
- `destructive` : action irréversible, toujours derrière une `AlertDialog`.

Désactivé : jamais d'opacité. Libellé `muted-foreground`, aplat `muted` pour un bouton plein, filet décoratif `border` pour un contour. En chargement (`loading`), le bouton reste `disabled` (pas de double envoi au clavier) et porte `aria-busy` ; un aplat garde alors sa couleur, avec la roue.

Jamais plus chargé : quand des contours d'encre s'empilent dans une zone,

1. le contour reste aux actions qui font avancer (relancer, reprendre, voir la conversation, connecter, réessayer, inscrire, l'option qui ouvre une barre) ;
2. les gestes d'entretien passent en discret à l'encre (`ghost`) : actualiser, flèches de période, réinitialiser, rétablir les valeurs par défaut, effacer la recherche, afficher la suite, vues enregistrées ;
3. les retraits d'envoi passent en discret gris : mettre en pause, arrêter, sauter, ne pas envoyer ;
4. au-delà, si une zone garde trois contours ou plus côte à côte, le troisième et les suivants passent en discret.

Un bouton icône a toujours un `aria-label` et une infobulle.

Badges : variantes `success`, `warning`, `info`, `danger`, `brand` (texte à l'encre et pastille de la couleur du statut, § 2), `muted` (encre sur le gris), `outline`. Un statut se peint de la même façon sur tous les écrans ; un badge fait main reprend la primitive, ou ses classes si sa forme diffère.

Contrôles : une puce de filtre (`FilterPill`) est grise et sans filet au repos, avec un contour d'encre quand le filtre est actif ; la bascule discrète (`SegmentedControl` `quiet`) pose l'option choisie en carte blanche sur son rail gris en clair, creusée au fond de page en sombre ; un toggle allumé porte un anneau de contrôle (`border-strong`) ; un radio a le bord de champ (`input`).

Toasts : un seul système, sonner (`import { toast } from "sonner"`). L'ancienne API `useToast` passe par lui. L'action d'un toast (« Annuler ») reste cliquable quand un dialogue est ouvert, et ce clic ne ferme pas le dialogue.

Visages et pastilles (design simplifié, `06-simplicite.md`) :

- Une ligne montre de qui ou de quoi elle parle : le visage d'une personne, le logo d'une mission (`MissionCompanyLogo`).
- `PersonAvatar` (`src/components/ui/person-avatar.tsx`) : la photo LinkedIn du candidat, ou sa copie Konekt ; sinon ses initiales, y compris quand le lien a expiré ou que l'image ne charge pas. Décoratif quand le nom est écrit à côté. `CandidateAvatar` (tableau de bord, et forme par taille nommée) passe par lui.
- `AvatarStack` (même fichier) : quelques visages qui se chevauchent, puis « +N », avec la liste des noms en nom accessible.
- `IconTile` (`src/components/ui/IconTile.tsx`) : pastille d'icône sur fond teinté en tête d'une chose à faire. Le ton dit l'urgence : `brand` par défaut, `warning` quand quelque chose attend, `destructive` quand c'est en retard. Le ton neutre (`default`) pose l'icône à l'encre sur le gris.

## 7. Mouvement

| Usage | Durée | Courbe |
|---|---|---|
| survol, appui, focus | 150 ms | `ease-out` |
| ouverture d'un menu, d'une infobulle | 150 ms | `ease-out` |
| dialogue, panneau latéral | 200 ms | `ease-out` |
| changement de page | 220 ms | `cubic-bezier(0.22, 1, 0.36, 1)` |

Retour d'appui : un bouton descend d'un pixel ou passe à 98 % de sa taille pendant l'appui. Une carte cliquable s'éclaire au survol (fond et filet), sans se soulever de plus d'un pixel.

Aucune animation en boucle hors indicateur de chargement, illustrations (§ Illustrations, décision du propriétaire du 29/09/2026), icônes qui attendent et fond de l'accueil (§ Fond animé). Avec `prefers-reduced-motion`, toutes les animations et transitions sont coupées globalement (règle dans `src/index.css`).

Fond animé (décision du propriétaire du 05/10/2026, inspiré de la page Qonto AI) : `PageBackdrop` (`src/components/layout/PageBackdrop.tsx`, styles `.konekt-backdrop` de `src/index.css`) pose sur l'accueil (`/dashboard`, par `PageLayout backdrop`), sur la recherche hors mission (`/sourcing`) et sur le héros et le plan du sourcing d'une mission (`LinkedInSearch`, nouvelle page mission : onglet Sourcing et `/sourcing/:id`, un seul fond posé à la racine, jamais sur les résultats, tableau dense aux cellules opaques) trois taches de dégradé bleu-vert et bleu qui dérivent en 23, 29 et 37 s, un grain SVG fixe, le tout fondu vers le fond de page sur 28 rem. Règles à tenir si on le retouche :

- Transform seul, jamais de `filter: blur` ni d'animation de couleur : le fond ne doit pas coûter de repeinture.
- Décoratif : `aria-hidden`, aucun clic. Avec le mouvement réduit, les taches restent à leur place de départ (règle globale de `src/index.css`).
- Le texte gris garde 4,5:1 sous les taches, en sombre comme en clair, de 390 à 1440 px de large et à toute phase de l'animation. Pour y arriver, la page qui porte le fond règle `--muted-foreground` un cran plus lisible (classe `.konekt-on-backdrop`, plus clair en sombre, plus foncé en clair). Les jetons globaux ne changent pas. Mesure faite le 05/10/2026 : 4,5 à 5,0 sur l'accueil, 5,6 et plus sur la recherche. Si on pousse les couleurs ou les opacités, refaire cette mesure avant de livrer.
- La souris (option `follow`, recherche hors mission, héros et plan du sourcing, pas l'accueil) : les taches se penchent vers le curseur par la propriété `translate`, qui se compose avec la dérive sans la gêner et n'éclaircit rien. Souris seulement : rien au toucher, rien avec le mouvement réduit. Mesure faite le 05/10/2026 avec la souris aux quatre coins de la fenêtre et au centre, à trois phases de la dérive, de 390 à 1440 px : 5,5 au pire.
- Option `contained` : dans un conteneur à marges (le sourcing), les bords se fondent aussi sur les côtés.
- Pas d'autre écran sans décision du propriétaire.

Cartes texturées (même décision, 05/10/2026) : `texturedCard(tone)` (`src/components/layout/texturedCard.ts`, styles `.konekt-card-tex` de `src/index.css`) donne à une carte un dégradé et un grain fixes, sans mouvement. Deux teintes : `teal` pour une action à faire, `warm` quand quelque chose bloque. Trois usages, pas d'autre sans décision du propriétaire :

- La carte « Maintenant » du Pipeline d'une mission (`NowCard.tsx`), seulement quand il y a une action : bleue, chaude pour le rang 0 (blocage). Les états « chargement », « rien à faire » et « tout est reporté » gardent la bande grise.
- Le bandeau « Compte LinkedIn à reconnecter » en tête de « À faire » (`DashboardFocusPanel`), chaud, placé au-dessus de la liste.
- La carte de bienvenue de l'accueil (`DashboardGreeting`), bleue, en permanence : une zone réservée aux cas particuliers ne se voyait pas sur un compte qui fonctionne (demande du propriétaire, 05/10/2026). Le bandeau LinkedIn s'y ajoute en dessous quand il y en a un, et la zone « Aucune mission active » reste neutre. Sur téléphone, le titre passe sur deux lignes dans la carte au lieu d'être coupé.

La carte porte ses propres couleurs de texte, claires dans les deux thèmes : en thème clair, c'est une île sombre. Le contenu s'écrit avec les classes habituelles, le bouton plein de la carte est blanc. Le survol d'un bouton discret y assombrit au lieu d'éclaircir, car un survol blanc translucide faisait tomber le contraste à 4,3:1. Mesure faite le 05/10/2026 sur les vrais composants, carte repliée, dépliée et bouton survolé : 6,0:1 au pire sur la carte « Maintenant », 6,4 à 7,1:1 sur l'accueil (carte de bienvenue et bandeau LinkedIn). Une teinte plus claire se mesure avant livraison.

Icônes qui attendent (design simplifié, demande du propriétaire du 04/10/2026) : `src/components/ui/animated-icons.tsx`. Une icône ne bouge que si quelque chose attend l'utilisateur, et chaque boucle finit sur la pose fixe de l'icône, celle qui reste quand le mouvement est réduit.

| Icône | Situation | Mouvement |
|---|---|---|
| `TypingIcon` | des candidats attendent une réponse | trois points s'écrivent dans la bulle |
| `HourglassIcon` | des candidats n'avancent plus | le sablier se retourne |
| `AlarmIcon` | des tâches sont en retard | le réveil sonne |
| `PingDot` | une ligne attend une réponse | le halo du point s'élargit |
| `SparkleIcon` | l'assistant | l'étoile scintille |

## 8. États d'écran

Chaque écran qui charge des données prévoit quatre états :

- Chargement : squelette pour une liste ou un tableau, indicateur circulaire pour une action ponctuelle, jamais les deux.
- Vide : une phrase qui dit pourquoi c'est vide, et l'action qui le remplit (bouton plein si c'est la seule action de la zone, sinon contour d'encre). La pastille d'icône d'un état vide est à l'encre sur le gris, sans aplat noir qui concurrencerait le bouton plein ; son cadre en tirets reste un décor.
- Erreur : ce qui a échoué en mots simples, et un bouton « Réessayer ». Une erreur ne s'affiche jamais comme un état vide.
- Succès : un toast qui dit ce qui a été fait, avec le nombre exact d'éléments traités.

### Illustrations

Des dessins à l'encre sur papier crème et kraft, avec le bleu-vert de l'accent (série du 28/09/2026). Composant `Illustration` (`src/components/ui/illustration.tsx`). Chaque dessin est fait de calques WebP de même cadrage dans `src/assets/illustrations` (15 à 45 Ko par dessin, chargés à la demande). `EmptyState` et `ErrorState` les prennent par l'option `illustration`.

- Une illustration par écran au plus, à la place de l'icône d'un état vide, d'une panne ou d'une issue (invitation, lien, page introuvable). Jamais dans une liste, une carte serrée, un bouton, un toast ni la barre latérale (présente sur chaque écran) ; une panne compacte garde son icône.
- Décorative : le titre dit ce qui se passe, l'image n'a pas de texte alternatif.
- Posée sur une tuile de surface carte (option `tile` d'`Illustration`, vraie par défaut, décision du 06/10/2026) : blanche en clair, où le papier crème se lit (1,22:1 au lieu de 1,15 à nu sur le fond), à la surface carte en sombre, sans vignette claire qui éblouirait. Jamais à nu sur le fond, jamais inversée ni filtrée ; `tile={false}` seulement dans une carte serrée.
- En mouvement, à la demande du propriétaire (29/09/2026) : une fois les calques chargés, le fond reste fixe et les pièces mobiles rejouent leur geste en boucle. Un tour dure 2,5 à 4,5 s : entrée sur le premier cinquième, pièce à sa place jusqu'aux quatre cinquièmes, puis sortie. Avec le mouvement réduit, le dessin est fixe dans son état final.
- Écart connu : une animation de plus de cinq secondes sans commande de pause s'écarte du critère 2.2.2 des WCAG. Le réglage « réduire les animations » du système l'arrête ; un arrêt après quelques tours rendrait l'écran conforme sans ce réglage.
- Une situation, un dessin :

| Dessin | Situation | Mouvement |
|---|---|---|
| `cafe` | rien à faire : journée ou semaine libre | la vapeur monte sans fin |
| `conversation` | aucune conversation, avec un candidat ou l'assistant | la grande bulle s'ouvre, la petite lui répond en boucle |
| `envoi` | aucune séquence, envoi parti | l'avion arrive avec sa trace, puis repart |
| `taches` | aucune tâche, premiers pas | les coches se posent une à une, puis repartent |
| `valide` | invitation acceptée, inscription réussie | le badge se pose sur la carte, se soulève, se repose |
| `connexion` | panne de connexion, compte LinkedIn non relié ou déconnecté | la prise et la fiche se rapprochent sans se toucher, puis s'écartent |
| `orientation` | page introuvable, lien expiré ou invalide | la flèche pivote sur son poteau |
| `recherche` | aucun candidat, recherche sans résultat | la loupe passe au-dessus des fiches, s'y arrête, puis continue |
| `brief` | poste à décrire | le dessin apparaît d'un seul tenant, puis flotte |
| `dossier` | aucune mission, aucun document | le dessin apparaît d'un seul tenant, puis flotte |

`brief` et `dossier` n'ont pas de calques qui recomposent le dessin : l'archive ne garde que le crayon du presse-papiers, et la feuille du dossier y est d'une autre échelle.

## 9. Texte

- Vouvoiement partout, y compris dans les écrans de l'IA Konekt.
- Français partout : pas de « step », « preview », « enrollment », « Strong Yes ». Les statuts techniques (`active`, `replied`) ne s'affichent jamais bruts.
- Vocabulaire des séquences : inscrire et inscription (pas « enrôler »), étape, aperçu, modèle, expéditeur, délai, statistiques, e-mail. Les libellés des étapes, des statuts et des raisons d'arrêt viennent de `src/lib/sequenceCatalog.ts`.
- Un entretien passé appelle un « compte rendu », pas un « débrief ».
- Décisions sur un candidat (`src/lib/verdicts.ts`) : recommandation d'une personne « Oui, clairement », « Oui », « À revoir », « Non », « Non, clairement » ; verdict d'une qualification « Qualifié », « Non qualifié », « À revoir », « En attente » ; recommandation de l'IA « Recommandé », « À évaluer », « Peu adapté ». Jamais « Strong Yes », « GO » ni une clé brute.
- Boutons : un verbe à l'infinitif et son objet (« Créer la mission »), en casse de phrase.
- Pas de tiret long dans l'interface : virgule, deux points ou parenthèses.
- Aucun nom de fournisseur visible (règle de `CLAUDE.md`, section Branding).
- Un message d'erreur dit ce qui s'est passé et quoi faire, jamais le message technique brut.

## 10. Accessibilité

- Focus visible sur tout élément interactif : `focus-visible`, anneau `brand` de 2 px, décalé de 2 px (4,55:1 au pire en clair, 5,45:1 en sombre). Un champ prend au focus un bord `brand` et un anneau plein de 1 px, 2 px en tout, jamais un halo transparent. Le contour d'encre d'un bouton ne remplace jamais l'anneau.
- Contraste AA : 4,5:1 pour le texte, 3:1 pour les icônes, les bords de bouton et de champ, les anneaux et les pastilles de badge. Chaque paire de jetons est recalculée par `tests/ux/contraste-jetons.test.mjs`, sur la surface la plus défavorable.
- Icônes (décision du 06/10/2026) : toute icône est à l'encre, celle d'un contrôle comme celle qui accompagne une métadonnée grise, et jamais d'opacité sur une icône visible. Gardent la couleur de leur rôle : l'icône posée dans un champ (gris secondaire, comme le texte indicatif), celle d'un geste de retrait, d'un onglet ou d'une bascule non choisis, d'un statut, de l'accent ou d'un logo, d'un élément désactivé, d'un indicateur d'état neutre écrit en gris (roue de « Chargement… », « Enregistré »), les légendes des graphiques, et la barre latérale : onglets du haut inchangés, rangée basse et têtes de ligne à `sidebar-foreground` (6,98:1 au pire en clair). L'ancienne page mission ne change pas.
- Un champ a un libellé associé, son aide et son erreur sont reliées par `aria-describedby`.
- Pas de `div` cliquable : `button` ou `a`.
- Une information ne passe jamais par la couleur seule : un statut a aussi un mot ou une icône.

## 11. Ce qui garde ces règles

- `npm run audit:design` compte la dette visuelle de `src/` : couleurs brutes et ancienne palette de marque, tailles arbitraires, effets décoratifs, rayons hors système, texte atténué par opacité, variables CSS lues sans être déclarées, emoji, tirets longs, noms de fournisseurs, boutons et champs faits main.
- Le job CI « Design (ratchet) » refuse une PR qui fait monter un de ces compteurs par rapport à `main`.
- Le banc visuel (`docs/design/05-banc-visuel.md`) capture chaque écran en clair, en sombre, sur ordinateur et sur téléphone, avant et après un lot.
- `tests/ux/contraste-jetons.test.mjs` recalcule les 44 paires à seuil de chaque thème depuis `src/index.css` et échoue sous la cible ; `tests/ux/contraste-primitives.test.mjs` garde les classes des boutons, des badges, des puces de filtre, des champs et de la tuile des illustrations.
