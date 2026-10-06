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
| `--background` | fond de page | `40 3% 11%` | `40 12% 97%` |
| `--card` | cartes, panneaux | `40 3% 16%` | `0 0% 100%` |
| `--popover` | menus, dialogues | `40 3% 18%` | `0 0% 100%` |
| `--muted` / `--secondary` | zones en retrait, contrôles pleins | `40 3% 20%` | `40 8% 95%` |
| `--accent` | survol d'une ligne ou d'un item | `40 3% 22%` | `40 8% 93%` |
| `--sidebar-background` | barre latérale | `40 3% 8%` | `40 8% 96%` |
| `--border` | filet | blanc 10 % | `40 8% 90%` |
| `--border-strong` | filet appuyé | blanc 18 % | `40 8% 80%` |
| `--input` | bord de champ, de case à cocher, piste d'interrupteur éteint | blanc 40 % | `40 3% 53%` |

`--input` atteint 3:1 sur toutes les surfaces (3,3:1 au pire sur `accent` en sombre, 2,8:1 sur `accent` en clair, où le champ garde son libellé) : un champ se repère sans son libellé. Au survol, son bord passe à `muted-foreground` ; au focus, à `brand`.

Attention au nom : dans ce dépôt, `accent` (hérité de shadcn) désigne le gris de survol, pas la couleur de marque. La couleur de marque s'appelle `brand`. Pour ne pas laisser d'anciens usages invisibles, `text-accent` et `border-accent` rendent `brand` ; le nouveau code écrit `text-brand`.

### Le texte

| Jeton | Rôle | Sombre | Clair |
|---|---|---|---|
| `--foreground` | texte principal | `0 0% 98%` | `40 6% 12%` |
| `--foreground-secondary` | texte secondaire, descriptions | `40 4% 74%` | `40 5% 34%` |
| `--muted-foreground` | métadonnées, libellés discrets | `40 3% 64%` | `40 4% 42%` |

Contraste vérifié : `muted-foreground` dépasse 4,5:1 sur le fond, la carte, le menu et `muted`, dans les deux thèmes (5,0:1 au pire en sombre, 4,7:1 en clair), et reste à 4,7:1 sur le survol en sombre. L'ancienne valeur sombre (56 %) tombait à 4,2:1 sur `muted`, l'ancienne valeur claire (46 %) à 4,3:1 sur le fond.

Pas d'opacité sur un jeton de texte (`text-muted-foreground/60`, `text-foreground/70`) : elle fait tomber le texte sous 4,5:1. Choisir l'un des trois niveaux ci-dessus.

### L'accent

Un seul accent, bleu-vert désaturé (choisi le 28/09/2026 à la place de l'indigo, pour s'accorder aux illustrations), rationné à quatre usages : le focus clavier, la sélection (case cochée, interrupteur, onglet actif), les signaux qui demandent l'attention (compteur de non-lus, pastille de nouveauté, priorité) et la progression. Le bouton principal n'est pas en accent : il est monochrome.

| Jeton | Rôle | Sombre | Clair |
|---|---|---|---|
| `--brand` | anneau de focus, texte et icônes d'accent | `179 32% 62%` (#7fbdbc) | `181 34% 33%` (#387071) |
| `--brand-foreground` | texte posé sur un aplat `brand` | `180 25% 10%` | `0 0% 100%` |
| `--brand-hover` / `--brand-press` | survol et appui | `179 36% 70%` / `179 30% 56%` | `181 34% 28%` / `181 34% 24%` |
| `--brand-solid` | aplat qui porte du texte blanc | `181 34% 29%` (#316263) | `181 34% 29%` |

Contrastes vérifiés : `brand` dépasse 5,9:1 sur toutes les surfaces sombres (fond, carte, menu, `muted`, survol, barre latérale) et 4,8:1 sur toutes les surfaces claires ; le texte sur aplat `brand` atteint 7,9:1 en sombre et 5,7:1 en clair ; le blanc sur `brand-solid` 6,9:1. L'anneau de focus est `brand` plein.

L'ancienne classe `brand-purple` (palette Skalr) est rabattue sur `brand` : ses usages restants prennent le bleu-vert.

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

### Le score d'un candidat

Un seul barème, celui du moteur de scoring : fort à partir de 65 (`success`), moyen de 50 à 64 (`warning`), faible sous 50 (`muted` : un score faible n'est pas une erreur). Un seul rendu, `ScoreBadge` (`src/components/ui/score-badge.tsx`, seuils dans `src/lib/scoreScale.ts`) : le nombre seul à l'écran, « sur 100 » et le niveau dans le nom accessible et l'infobulle.

### Les canaux

LinkedIn et WhatsApp se reconnaissent à leur logo officiel, l'e-mail et l'appel à leur icône en gris (`ChannelIcon`, table `src/lib/channels.ts`). La couleur d'un canal reste dans son logo : une étape de séquence, un statut, un ton ou un bouton ne prennent jamais la couleur d'un canal.

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

Élévation : en sombre, les surfaces se distinguent par leur luminosité (`background` 11 < `card` 16 < `popover` 18 < `muted` 20 < `accent` 22) et un filet. Une carte se détache du fond de 5 points, sans dépendre de son filet. En clair, la carte est blanche sur un fond à 97 % et porte une ombre légère (`shadow-sm`, dans `Card`). Les ombres marquées servent aux éléments qui flottent : menus, dialogues, toasts (`shadow-lg`, `shadow-xl`).

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

Boutons :

Tous les boutons sont des pilules (`rounded-full`). Les champs, eux, gardent le coin de contrôle à 8 px.

- `primary` : action principale, monochrome (texte `background` sur fond `foreground`). Un seul par zone : l'en-tête de page, un bandeau d'alerte, une carte de décision.
- `secondary` : action suivante, ou action propre à une ligne (« Lire », « Répondre »). Fond `foreground/10`, qui se lit sur toutes les surfaces.
- `default` / `outline` : option, filet appuyé (`border-strong`) et fond transparent.
- `ghost` : action tertiaire, sans contour.
- `destructive` : action irréversible, toujours derrière une `AlertDialog`.
- `link` : lien dans un texte.

Un bouton icône a toujours un `aria-label` et une infobulle.

Badges : variantes `success`, `warning`, `info`, `danger`, `brand`, `muted`, `outline`, toutes en fond teinté. Un statut se peint de la même façon sur tous les écrans.

Toasts : un seul système, sonner (`import { toast } from "sonner"`). L'ancienne API `useToast` passe par lui. L'action d'un toast (« Annuler ») reste cliquable quand un dialogue est ouvert, et ce clic ne ferme pas le dialogue.

Visages et pastilles (design simplifié, `06-simplicite.md`) :

- Une ligne montre de qui ou de quoi elle parle : le visage d'une personne, le logo d'une mission (`MissionCompanyLogo`).
- `PersonAvatar` (`src/components/ui/person-avatar.tsx`) : la photo LinkedIn du candidat, ou sa copie Konekt ; sinon ses initiales, y compris quand le lien a expiré ou que l'image ne charge pas. Décoratif quand le nom est écrit à côté. `CandidateAvatar` (tableau de bord, et forme par taille nommée) passe par lui.
- `AvatarStack` (même fichier) : quelques visages qui se chevauchent, puis « +N », avec la liste des noms en nom accessible.
- `IconTile` (`src/components/ui/IconTile.tsx`) : pastille d'icône sur fond teinté en tête d'une chose à faire. Le ton dit l'urgence : `brand` par défaut, `warning` quand quelque chose attend, `destructive` quand c'est en retard.

## 7. Mouvement

| Usage | Durée | Courbe |
|---|---|---|
| survol, appui, focus | 150 ms | `ease-out` |
| ouverture d'un menu, d'une infobulle | 150 ms | `ease-out` |
| dialogue, panneau latéral | 200 ms | `ease-out` |
| changement de page | 220 ms | `cubic-bezier(0.22, 1, 0.36, 1)` |

Retour d'appui : un bouton descend d'un pixel ou passe à 98 % de sa taille pendant l'appui. Une carte cliquable s'éclaire au survol (fond et filet), sans se soulever de plus d'un pixel.

Aucune animation en boucle hors indicateur de chargement, illustrations (§ Illustrations, décision du propriétaire du 29/09/2026), icônes qui attendent et fond de l'accueil (§ Fond animé). L'onboarding a sa propre exception (§ 11). Avec `prefers-reduced-motion`, toutes les animations et transitions sont coupées globalement (règle dans `src/index.css`).

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
- Vide : une phrase qui dit pourquoi c'est vide, et l'action qui le remplit.
- Erreur : ce qui a échoué en mots simples, et un bouton « Réessayer ». Une erreur ne s'affiche jamais comme un état vide.
- Succès : un toast qui dit ce qui a été fait, avec le nombre exact d'éléments traités.

### Illustrations

Des dessins à l'encre sur papier crème et kraft, avec le bleu-vert de l'accent (série du 28/09/2026). Composant `Illustration` (`src/components/ui/illustration.tsx`). Chaque dessin est fait de calques WebP de même cadrage dans `src/assets/illustrations` (15 à 45 Ko par dessin, chargés à la demande). `EmptyState` et `ErrorState` les prennent par l'option `illustration`.

- Une illustration par écran au plus, à la place de l'icône d'un état vide, d'une panne ou d'une issue (invitation, lien, page introuvable). Jamais dans une liste, une carte serrée, un bouton, un toast ni la barre latérale (présente sur chaque écran) ; une panne compacte garde son icône.
- Décorative : le titre dit ce qui se passe, l'image n'a pas de texte alternatif.
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

- Focus visible sur tout élément interactif : `focus-visible`, anneau `brand` de 2 px, décalé de 2 px.
- Contraste AA : 4,5:1 pour le texte, 3:1 pour les icônes, filets de champ et anneaux.
- Un champ a un libellé associé, son aide et son erreur sont reliées par `aria-describedby`.
- Pas de `div` cliquable : `button` ou `a`.
- Une information ne passe jamais par la couleur seule : un statut a aussi un mot ou une icône.

## 11. Exception : l'onboarding

Décision du propriétaire du 29/09/2026. Le premier contact avec l'application est un moment de marque, pas un écran de travail : il a le droit au mouvement et aux illustrations que le reste de l'application s'interdit. L'exception est bornée à `src/pages/Onboarding.tsx`, `src/components/onboarding/**`, `src/hooks/onboarding/**` et `src/lib/onboarding/**`. Ni la barre latérale, ni les écrans de mission, ni la modale d'accueil des invités n'y ont droit.

Ce que l'onboarding se permet :

- Le bureau : les objets du kit d'illustrations (§ 8) posés sur un sous-main, tous ensemble sur l'écran (plusieurs illustrations, à une taille de décor), qui tombent, flottent, suivent le pointeur (parallaxe), se laissent attraper à la souris et reviennent à leur place. Papier et encre viennent des variables `--paper*` de `src/index.css`.
- Des animations en boucle : le flottement des objets, la vapeur de la tasse, la loupe qui cherche, l'anneau du fil des étapes.
- Le titre en Bricolage Grotesque (`font-brand`), révélé mot à mot ; les cartes qui s'inclinent vers le pointeur ; les nombres qui montent ; les barres et les anneaux qui se remplissent ; la lettre du message qui s'écrit.
- Deux lueurs floutées derrière la scène, qui suivent le pointeur.
- Une salve de papiers découpés à la fin, jouée une fois.

Ce qui reste interdit, comme partout : les dégradés violet-rose, les reflets balayants, les textures et le grain, les emoji, les couleurs en dur et les jetons `--k-*`, les tirets longs, le tutoiement, le nom d'un fournisseur dans un texte visible. Les compteurs de `npm run audit:design` ne montent pas (la PR du 29/09 les laisse tous égaux ou plus bas).

Mouvement réduit : rien n'attend son tour (`useDelay`), les objets restent posés, le glisser-déposer et la salve sont coupés. Sur téléphone, le bureau se réduit à une carte au-dessus de la question, sans glisser.

Ce que l'onboarding produit pour de vrai, et non en démonstration : le prénom (profil et compte, il signe les messages de l'IA), l'espace, le logo et le site trouvés pour l'entreprise, une mission avec son brief structuré, ses filtres IA et ses étapes d'entretien, la liaison LinkedIn, une recherche réelle d'une page sur le compte relié, un scoring facultatif, un exemple de message (rien n'est envoyé) et le ton d'écriture (`profiles.ai_context.tone`). Toute nouvelle question posée dans ce parcours doit écrire quelque chose que le produit lit : une réponse sans lecteur n'a pas sa place (c'est ce qui a retiré la taille d'équipe, le volume annuel et les secteurs, écrits mais jamais lus).

## 12. Ce qui garde ces règles

- `npm run audit:design` compte la dette visuelle de `src/` : couleurs brutes et ancienne palette de marque, tailles arbitraires, effets décoratifs, rayons hors système, texte atténué par opacité, variables CSS lues sans être déclarées, emoji, tirets longs, noms de fournisseurs, boutons et champs faits main.
- Le job CI « Design (ratchet) » refuse une PR qui fait monter un de ces compteurs par rapport à `main`.
- Le banc visuel (`docs/design/05-banc-visuel.md`) capture chaque écran en clair, en sombre, sur ordinateur et sur téléphone, avant et après un lot.
