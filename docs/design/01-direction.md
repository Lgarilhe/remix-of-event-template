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
- Les dégradés violet-rose, halos pulsés, reflets balayants, particules et fonds animés. Ils signalent une interface générée à la chaîne.
- Le grain et les textures dans l'application. Une texture discrète reste envisageable sur les pages publiques, si elle sert la marque et ne gêne pas la lecture.
- Les emoji servant d'icône, et l'étincelle ✨ pour dire « IA ».

## 2. Couleur

### Les surfaces

Teinte 40°, saturation 3 %. Le thème sombre est le thème par défaut, le clair est dessiné à part (les bordures passent en alpha sur fond sombre, en couleur opaque sur fond clair).

| Jeton | Rôle | Sombre | Clair |
|---|---|---|---|
| `--background` | fond de page | `40 3% 11%` | `40 14% 98%` |
| `--card` | cartes, panneaux | `40 3% 14%` | `0 0% 100%` |
| `--popover` | menus, dialogues | `40 3% 16%` | `0 0% 100%` |
| `--muted` / `--secondary` | zones en retrait, contrôles pleins | `40 3% 18%` | `40 8% 95%` |
| `--accent` | survol d'une ligne ou d'un item | `40 3% 20%` | `40 8% 93%` |
| `--sidebar-background` | barre latérale | `40 3% 8%` | `40 8% 96%` |
| `--border` | filet | blanc 10 % | `40 8% 90%` |
| `--border-strong` | filet appuyé | blanc 18 % | `40 8% 80%` |
| `--input` | bord de champ, de case à cocher, piste d'interrupteur éteint | blanc 36 % | `40 3% 53%` |

`--input` atteint 3:1 sur toutes les surfaces (3,1:1 au pire, sur `muted` en sombre et sur `accent` en clair) : un champ se repère sans son libellé. Au survol, son bord passe à `muted-foreground` ; au focus, à `brand`.

Attention au nom : dans ce dépôt, `accent` (hérité de shadcn) désigne le gris de survol, pas la couleur de marque. La couleur de marque s'appelle `brand`. Pour ne pas laisser d'anciens usages invisibles, `text-accent` et `border-accent` rendent `brand` ; le nouveau code écrit `text-brand`.

### Le texte

| Jeton | Rôle | Sombre | Clair |
|---|---|---|---|
| `--foreground` | texte principal | `0 0% 98%` | `40 6% 12%` |
| `--foreground-secondary` | texte secondaire, descriptions | `40 4% 74%` | `40 5% 34%` |
| `--muted-foreground` | métadonnées, libellés discrets | `40 3% 62%` | `40 4% 42%` |

Contraste vérifié : `muted-foreground` dépasse 4,5:1 sur le fond, la carte et `muted`, dans les deux thèmes (5,1:1 au pire). L'ancienne valeur sombre (56 %) tombait à 4,2:1 sur `muted`, l'ancienne valeur claire (46 %) à 4,3:1 sur le fond.

Pas d'opacité sur un jeton de texte (`text-muted-foreground/60`, `text-foreground/70`) : elle fait tomber le texte sous 4,5:1. Choisir l'un des trois niveaux ci-dessus.

### L'accent

Un seul accent, indigo désaturé, rationné à quatre usages : le focus clavier, la sélection (case cochée, interrupteur, onglet actif), les signaux qui demandent l'attention (compteur de non-lus, pastille de nouveauté, priorité) et la progression. Le bouton principal n'est pas en accent : il est monochrome.

| Jeton | Rôle | Sombre | Clair |
|---|---|---|---|
| `--brand` | anneau de focus, texte et icônes d'accent | `248 54% 72%` (#9b91de) | `248 45% 58%` (#7164c4) |
| `--brand-foreground` | texte posé sur un aplat `brand` | `250 28% 12%` | `0 0% 100%` |
| `--brand-solid` | aplat qui porte du texte blanc | `248 42% 50%` | `248 42% 50%` |

L'anneau de focus passe de blanc 25 % (2,3:1 sur le fond, insuffisant) à `brand` plein (6,1:1 en sombre, 4,7:1 en clair).

### Les statuts

Chaque statut a une valeur par thème, lisible en texte sur le fond, la carte et sa propre teinte.

| Statut | Sombre | Clair | Emploi |
|---|---|---|---|
| `success` | `145 55% 50%` | `145 63% 30%` | réussite, candidat retenu, compte connecté |
| `warning` | `38 92% 58%` | `32 95% 34%` | attention requise, quota proche |
| `info` | `215 90% 68%` | `215 75% 42%` | information neutre, en cours |
| `danger` | `0 84% 71%` | `0 72% 45%` | erreur d'état, échec, alerte |
| `destructive` | `0 70% 48%` | `0 72% 45%` | aplat d'une action irréversible, texte blanc |

`danger` et `destructive` sont distincts : le premier signale une erreur, le second qualifie une action qui détruit. En sombre, aucune couleur ne peut servir aux deux (un rouge lisible sur fond sombre est trop clair pour porter du texte blanc). La classe `text-destructive` rend donc la couleur `danger`, `bg-destructive` rend l'aplat.

Forme par défaut d'un badge de statut : fond teinté à 12-14 % et texte de la couleur du statut. L'aplat plein avec texte blanc est réservé aux boutons destructifs.

### Couleurs interdites

- Les couleurs Tailwind brutes (`bg-emerald-500/15`, `text-amber-600`…) : elles ignorent le thème et doublonnent les statuts. Utiliser `success`, `warning`, `info`, `danger`, `brand`.
- Les couleurs en dur (`#4f46e5`, `rgb()`…) hors des logos de tiers.
- Les jetons `--k-*` et `--skalr-*` : ils restent définis pour ne rien casser mais pointent vers les jetons ci-dessus. Ne plus en écrire.

Couleurs de tiers autorisées : `linkedin`, `whatsapp`, et les logos officiels.

## 3. Typographie

Une seule famille dans l'application : Instrument Sans, graisses 500 (corps), 600 (emphase, titres), 700 (grands chiffres d'un tableau de bord, titre de page principal). Space Mono pour les identifiants, raccourcis clavier et chiffres alignés. Bricolage Grotesque, police de marque, est réservée aux titres des pages publiques (accueil, tarifs). Outfit, Space Grotesk et Instrument Serif sont retirés.

Six paliers :

| Palier | Classe | Taille / interligne | Emploi |
|---|---|---|---|
| caption | `text-3xs` | 10 / 14 | compteurs, badges denses |
| micro | `text-2xs` | 11 / 15 | métadonnées, intitulés de section en capitales |
| body-sm | `text-xs` | 12 / 16 | tableaux, cartes denses |
| body | `text-sm` | 13 / 20 | corps courant, boutons, champs |
| body-lg | `text-md` | 14 / 20 | titres de carte, texte de lecture |
| title | `text-base` à `text-3xl` | 16 à 30 | titres de page (20, graisse 600) et de section |

`text-sm` vaut désormais 13 px, comme le corps des maquettes. Les tailles arbitraires `text-[11px]` sont proscrites : chaque valeur a son palier nommé.

Intitulé de section : la classe `eyebrow` (11 px, graisse 600, capitales, espacement 0,08 em, couleur `muted-foreground`). C'est le seul usage des capitales. Pas de titre ni de bouton en capitales.

## 4. Espace, rayons, élévation

Espacements sur la grille de 4 px de Tailwind. Rythme courant : 4 et 8 à l'intérieur d'un contrôle, 12 et 16 entre éléments d'une carte, 24 entre sections, 32 à 40 pour le haut de page.

Trois rayons principaux, dérivés de `--radius` (8 px) :

| Nom | Classe | Valeur | Emploi |
|---|---|---|---|
| control | `rounded-lg` | 8 px | boutons, champs, onglets |
| surface | `rounded-xl` | 12 px | cartes, menus, dialogues, panneaux |
| pill | `rounded-full` | plein | badges, pastilles, avatars |

Deux cas dérivés : `rounded-md` (6 px) pour un élément imbriqué dans une surface ou un contrôle (item de menu, segment d'un contrôle segmenté), et `rounded-sm` (4 px) sous 20 px de haut (case à cocher, barre de squelette). `rounded-none`, `rounded-2xl`, `rounded-3xl` et les valeurs arbitraires sont proscrits.

Élévation : en sombre, les surfaces se distinguent par leur luminosité (`background` < `card` < `popover`) et un filet, pas par l'ombre. Les ombres servent aux éléments qui flottent : menus, dialogues, toasts (`shadow-lg`, `shadow-xl`).

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

Boutons :

- `primary` : action principale, monochrome (texte `background` sur fond `foreground`). Un seul par zone.
- `default` / `outline` : action secondaire, filet et fond transparent.
- `ghost` : action tertiaire, sans contour.
- `destructive` : action irréversible, toujours derrière une `AlertDialog`.
- `link` : lien dans un texte.

Un bouton icône a toujours un `aria-label` et une infobulle.

Badges : variantes `success`, `warning`, `info`, `danger`, `brand`, `muted`, `outline`, toutes en fond teinté. Un statut se peint de la même façon sur tous les écrans.

Toasts : un seul système, sonner (`import { toast } from "sonner"`). L'ancienne API `useToast` passe par lui. L'action d'un toast (« Annuler ») reste cliquable quand un dialogue est ouvert, et ce clic ne ferme pas le dialogue.

## 7. Mouvement

| Usage | Durée | Courbe |
|---|---|---|
| survol, appui, focus | 150 ms | `ease-out` |
| ouverture d'un menu, d'une infobulle | 150 ms | `ease-out` |
| dialogue, panneau latéral | 200 ms | `ease-out` |
| changement de page | 220 ms | `cubic-bezier(0.22, 1, 0.36, 1)` |

Retour d'appui : un bouton descend d'un pixel ou passe à 98 % de sa taille pendant l'appui. Une carte cliquable s'éclaire au survol (fond et filet), sans se soulever de plus d'un pixel.

Aucune animation en boucle hors indicateur de chargement. Avec `prefers-reduced-motion`, toutes les animations et transitions sont coupées globalement (règle dans `src/index.css`).

## 8. États d'écran

Chaque écran qui charge des données prévoit quatre états :

- Chargement : squelette pour une liste ou un tableau, indicateur circulaire pour une action ponctuelle, jamais les deux.
- Vide : une phrase qui dit pourquoi c'est vide, et l'action qui le remplit.
- Erreur : ce qui a échoué en mots simples, et un bouton « Réessayer ». Une erreur ne s'affiche jamais comme un état vide.
- Succès : un toast qui dit ce qui a été fait, avec le nombre exact d'éléments traités.

## 9. Texte

- Vouvoiement partout, y compris dans les écrans de l'IA Konekt.
- Français partout : pas de « step », « preview », « enrollment », « Strong Yes ». Les statuts techniques (`active`, `replied`) ne s'affichent jamais bruts.
- Boutons : un verbe à l'infinitif et son objet (« Créer la mission »), en casse de phrase.
- Pas de tiret long dans l'interface : virgule, deux points ou parenthèses.
- Aucun nom de fournisseur visible (règle de `CLAUDE.md`, section Branding).
- Un message d'erreur dit ce qui s'est passé et quoi faire, jamais le message technique brut.

## 10. Accessibilité

- Focus visible sur tout élément interactif : `focus-visible`, anneau `brand` de 2 px, décalé de 2 px.
- Contraste AA : 4,5:1 pour le texte, 3:1 pour les icônes, filets de champ et anneaux.
- Un champ a un libellé associé, son aide et son erreur sont reliées par `aria-describedby`.
- Pas de `div` cliquable : `button` ou `a`.
- Une information ne passe jamais par la couleur seule : un statut a aussi un mot ou une icône.

## 11. Ce qui garde ces règles

- `npm run audit:design` compte la dette visuelle de `src/` : couleurs brutes et ancienne palette de marque, tailles arbitraires, effets décoratifs, rayons hors système, texte atténué par opacité, variables CSS lues sans être déclarées, emoji, tirets longs, noms de fournisseurs, boutons et champs faits main.
- Le job CI « Design (ratchet) » refuse une PR qui fait monter un de ces compteurs par rapport à `main`.
- Le banc visuel (`docs/design/05-banc-visuel.md`) capture chaque écran en clair, en sombre, sur ordinateur et sur téléphone, avant et après un lot.
