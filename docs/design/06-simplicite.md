# 06 · Design simplifié

## La demande

Le 4 octobre 2026, le propriétaire du produit trouve l'application encore trop chargée et difficile à comprendre : boutons, contraste, mise en avant, icônes. Il demande un travail de fond, et des visuels pour l'appuyer : des icônes, des icônes animées, les visages ronds des candidats. Sa référence est Qonto.

Ses réponses aux questions de cadrage :

- La barre latérale, inspirée de celle de Notion, reste telle qu'elle est. Exception décidée par le fondateur le 05/10/2026 (décision 8 du lot 5) : une entrée « Séquences » dans la rangée basse, entre Agenda et Marketplace, même lien et même infobulle que ses voisines. Elle vit derrière l'interrupteur `konekt.sequences-v2` (lot 5c-2) jusqu'à son ouverture à tous (lot 5h).
- La page mission suit les mêmes règles que le reste, en accord avec la session de la refonte mission.
- Les pastilles des candidats montrent leurs vraies photos LinkedIn. Konekt en garde une petite copie privée, supprimée avec le candidat.
- La perte de la photo à la notation est corrigée tout de suite, à part (PR #257).
- L'accueil suit la maquette : plus de cartes des canaux (une ligne « À faire » quand le compte LinkedIn est à reconnecter), plus de « Cette semaine », d'activité récente ni de « Personnaliser la page ». Les chiffres de la semaine restent dans le Pipeline (onglet Analyse), l'activité sur la fiche de chaque candidat.

## Le constat

Mesures du banc local (`05-banc-visuel.md`) sur `main` du 30 septembre 2026 :

- Plus de 90 % du texte mesure 13 px ou moins, et 480 tailles écrites à la main (`text-[11px]`, `text-[10px]`…) échappent aux paliers.
- Accueil : 30 contrôles dans la page. Page mission : 45 contrôles sur le Pipeline, 41 contrôles et 25 cadres sur le Cadrage.
- La barre latérale porte à elle seule 16 contrôles et 14 icônes.

## Les règles

Elles valent pour chaque écran repris. La maquette « Konekt simplifié » (canevas privé du propriétaire, https://claude.ai/artifact/3yeUQL7xF851WAnmDjsajw) montre l'avant et l'après de l'accueil, de la page mission, des tâches et du cadrage.

1. Le texte courant passe à 14 et 15 px, les titres de page à 28 px, rien sous 12 px (`01-direction.md`, § 3).
2. Un seul bouton plein par zone, à l'encre (`primary`, noir en clair, blanc en sombre) : l'en-tête de page, un bandeau d'alerte, une carte de décision. Une action propre à une ligne est un bouton à contour d'encre (`secondary`). Le reste devient du texte ou un bouton discret à l'encre (`ghost`) ; le gris est réservé aux gestes de retrait. Précisé le 05/10/2026 (voir « Relief ») et le 06/10/2026 (voir « Contraste »).
3. Des filets fins et de l'espace entre les lignes ; les listes qui demandent une décision sont posées sur une carte (voir « Relief »).
4. Chaque ligne montre de qui ou de quoi elle parle : le visage du candidat (`PersonAvatar`, `AvatarStack`), ou le logo de la mission.
5. Une pastille d'icône (`IconTile`) annonce chaque chose à faire. Elle bouge seulement quand quelque chose attend l'utilisateur (`01-direction.md`, § 7), et reste fixe quand le mouvement est réduit.
6. La note d'un candidat devient un anneau, son avancement une barre à cinq crans.
7. La couleur ne sert qu'à ce qui demande d'agir : orange quand un candidat attend, rouge quand c'est en retard.
8. Pas de zéro affiché, pas d'état qui ne demande rien.

## Les lots

| Lot | Contenu | État |
|---|---|---|
| Photo | La notation garde la photo du candidat | PR #257 |
| F · Fondations | Paliers de texte (rien sous 12 px), tailles écrites à la main remplacées, titre de page à 28 px, `PersonAvatar` et `AvatarStack`, icônes qui attendent | PR #258 |
| A · Accueil | « À faire » en pastilles et piles de visages, tâches en retard avec visage ou logo, missions avec logo et visages en entretien | PR #259 |
| T · Tâches | Visage ou logo par tâche, réveil sur « En retard », filtres dans un seul menu, corbeille au survol, suggestions sous la liste (trois au plus) | PR #263 |
| M · Page mission | En-tête avec logo, visages, note en anneau, avancement en cinq crans, bandeau « à trier », point qui pulse ; cadrage avec pastilles de section et anneau d'avancement. Avec la session de la refonte mission | Pipeline, Cadrage, Sourcing, en-tête de mission et liste des missions livrés le 04/10/2026 (carte « Maintenant » allégée, puces sur une rangée, liste avec visages et anneau de note, boutons discrets ; Cadrage sans cartes avec bandeau d'état en une ligne ; Sourcing en puces sans cadre et tableau réduit) ; en-tête avec logo du client et statut sans cadre ; liste des missions avec logo, visages en entretien et sans zéro. État vide de /missions en revue (05/10/2026) : dessin « dossier », une phrase, « Coller une fiche de poste » seul bouton plein, titre « Missions » gardé ; plus de chiffres publicitaires ni de logos d'outils non reliés. La fenêtre de création de mission (Brief IA) suit les mêmes règles depuis le 05/10/2026. |
| P · Photos | Copie privée des photos LinkedIn : capture (recherche, notation, messagerie, extension, assistant), effacement RGPD, purge, export, rattrapage des candidats sans photo | affichage livré pour la page mission le 05/10/2026 (liste du Pipeline, À trier, kanban, fiche) et pour le /pipeline global le 05/10/2026 (kanban, tableau, chronologie). Copie privée en revue (05/10/2026) : copie de la photo enregistrée sur la ligne du candidat, quelle que soit son origine, toutes les deux minutes ; effacement RGPD, copies supprimées avec la ligne (purge comprise), export. Les visages lus en base (page mission, /pipeline, accueil, liste des missions, Tâches, agenda, scorecard) montrent la copie, sinon le lien LinkedIn, sinon les initiales. Rattrapage des candidats sans photo enregistrée : plus tard, avec l'accord du propriétaire Adresses gardées fraîches à la recherche (P-0b, 05/10/2026) : `refresh_candidate_pictures`, voir `07-photos-lot-p.md`. |
| Suite | Pipeline global, messagerie, Paramètres, mêmes règles | Pipeline global livré le 05/10/2026 (#286) : phrase chiffrée sous le titre, recherche et un seul menu « Filtres », bascule d'affichage de la page mission, colonnes et cartes du kanban de mission, note en anneau (`ScoreRing`), tableau à six colonnes, chronologie et analyse sans cadre, pagination sous un filet, chiffres dans l'Analyse seulement, aucun zéro, cibles de 44 px au doigt. Messagerie livrée le 05/10/2026 (#288) : titre à 28 px, plus d'« Actualiser », bascule de la page mission, filtres sans compte, étiquettes et intentions en texte, « À répondre » en orange, non-lus en gras sans pastille, plus de logo LinkedIn sur chaque visage, état de séquence en mots, mise en forme dans un menu, panneau vide sans cadre. Paramètres en revue (05/10/2026) : cartes à plat sous chaque rubrique (`CardPlainProvider` posé par `SettingsAnchor`), plus de « 0 / N » (plafonds LinkedIn, Base Konekt, forfait de contacts, compteurs de rédaction), états en mots, « Dissocier » neutre au repos, coût par action et protections LinkedIn à la demande, listes à plat. La coquille, le Journal et les politiques et connecteurs des Règles de l'assistant suivront #260 et #262 |

## Relief

Le 5 octobre 2026, le propriétaire trouve l'application encore un peu plate et demande de faire ressortir certaines choses : des fonds qui se détachent, des boutons mieux choisis. Sa référence est de nouveau Qonto (accueil, liste des transactions, comptes, en sombre).

Cause relevée sur le banc : depuis le lot A, tout est posé directement sur le fond, les actions des lignes sont de simples mots (« Lire », « Voir ») et la panne LinkedIn pèse autant qu'une ligne ordinaire.

Ce qui change, dans cet ordre de portée :

- Jetons (`index.css`) : en sombre, la carte passe de 14 à 16 %, le menu de 16 à 18 %, `muted` et `secondary` de 18 à 20 %, le survol de 20 à 22 %, `muted-foreground` de 62 à 64 %, le bord de champ de 36 à 40 % (contrastes recalculés, voir `01-direction.md` § 2). En clair, le fond de page passe à 97 % (puis à 96 % le 06/10/2026, voir « Contraste »).
- Rayon des surfaces : `rounded-xl` vaut 16 px au lieu de 12 (`tailwind.config.ts`). Aucune classe ne change dans le code.
- `Button` : pilule, `secondary` en fond teinté, `outline` et `default` à filet appuyé. Deux surcharges de coin à 8 px retirées (`InvitationsPanel`). Depuis le 06/10/2026, `secondary` n'est plus un fond teinté : les trois sont un contour d'encre (voir « Contraste »).
- `Card` : ombre légère (`shadow-sm`), visible surtout en clair.
- Accueil : lignes « À faire », journée et tableau des missions sur des cartes ; panne LinkedIn en bandeau texturé (carte chaude du § 7 de `01-direction.md`) avec bouton plein ; « Lire », « Répondre », « Voir » en boutons `secondary`. `AvatarStack` prend `ringClassName` pour que l'anneau des visages suive la surface.

Pas encore repris, à faire au fil des lots suivants : liste des missions, Pipeline, messagerie, Paramètres, page mission (écrans de la session « refonte mission », livrés sans cartes le 04/10/2026).

## Contraste

Le 6 octobre 2026, après les avant et après de la spécification du contraste, le propriétaire choisit « plus marqué, façon Qonto » : un écran plus net, jamais plus chargé (aucun cadre ni couleur d'interface ajoutés, un bouton plein par zone). Règles détaillées dans `01-direction.md` (§ 2, § 6, § 8 et § 10) ; jetons et primitives d'abord, écrans ensuite, par lots.

- Deux styles d'action, comme Qonto : plein d'encre (`primary`, jamais la couleur de marque) et contour d'encre (`secondary`, `outline`, `default`, blanc à 70 % en sombre), plus un discret à l'encre (`ghost`).
- Une seule encre pour les icônes, les libellés d'action et le texte des badges. La couleur ne porte plus de texte : elle tient dans la pastille d'un badge, une icône de statut, l'accent `brand` et les logos.
- Le gris secondaire ne dit plus que « métadonnée » et « retrait » (Supprimer, Retirer, Dissocier, Mettre en pause, Arrêter…). L'ancienne page mission reste telle quelle.
- Thème clair : fond de page à 96 %, zones grises à 92 %, cartes blanches ; bord de contrôle et de champ à 3,37:1 au moins, gris secondaire à 4,90:1 au moins, sur toutes les surfaces.
- Désactivé sans opacité, chargement annoncé par `aria-busy`, focus d'un champ en anneau plein.
- Quand trois contours d'encre s'empilent dans une zone, les actions tertiaires passent en discret (grammaire du § 6 de `01-direction.md`).
- Barre latérale : structure et onglets du haut inchangés ; icônes de la rangée basse et des têtes de ligne à la couleur du texte de la barre.
- Illustrations sur une tuile de surface carte ; pastille d'état vide à l'encre.
- Kanban en clair : colonnes grises, cartes de candidat blanches à ombre légère ; le sombre ne change pas. Lignes faites au gris secondaire, sans opacité.
- Badges faits main repris : la primitive `Badge` (ou ses classes, `badgeVariants`, quand la forme diffère), texte à l'encre, couleur dans la pastille ou l'icône, sans capitales. Les tuiles d'icône de statut, les bandeaux et les statuts écrits en ligne qui demandent d'agir (« En retard », un échec) gardent leur couleur.
- Champs faits main au bord de champ (`border-input`), désactivés sans opacité ; bascules faites main au rendu `quiet` (rail gris plein, option en carte blanche).
- Un appel qui change la couleur du bord d'un bouton à contour la redonne aussi en sombre (`dark:border-…`) : sinon le filet blanc du contour d'encre ressort en sombre seulement.
- Un bouton à contour repeint d'un aplat de couleur (bleu LinkedIn) prend un bord transparent et un texte blanc : l'encre sur le bleu ne tient que 3,25:1. Un aplat d'action passe par `primary`, jamais par une couleur d'état.
- Gardes : `tests/ux/contraste-jetons.test.mjs` (contrastes recalculés depuis les jetons), `tests/ux/contraste-primitives.test.mjs`, `tests/ux/contraste-ecrans.test.mjs` (kanban, lignes faites, champs et bascules faits main, barre latérale, rétrogradations, badges faits main, bords des boutons à contour en sombre) et `tests/ux/contraste-icones.test.mjs` (icônes et boutons discrets à l'encre, liste blanche décroissante).

## Points ouverts

- Couleur de l'anneau de note : couleur de marque pour tous les niveaux, comme la maquette (page mission au lot M, `ScoreRing` du kit pour le Pipeline global au lot Suite). `ScoreBadge` (`src/lib/scoreScale.ts`), coloré par niveau, reste sur la scorecard, la qualification, le portail client, la préparation d'envoi, l'assistant et la fiche de mission du /pipeline ; son orange (score moyen) concurrence la règle 7.
- `text-3xs` et `text-2xs` valent tous deux 12 px : à fondre dans `text-xs` au fil des lots.
