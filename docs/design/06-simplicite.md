# 06 · Design simplifié

## La demande

Le 4 octobre 2026, le propriétaire du produit trouve l'application encore trop chargée et difficile à comprendre : boutons, contraste, mise en avant, icônes. Il demande un travail de fond, et des visuels pour l'appuyer : des icônes, des icônes animées, les visages ronds des candidats. Sa référence est Qonto.

Ses réponses aux questions de cadrage :

- La barre latérale, inspirée de celle de Notion, reste telle qu'elle est.
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
2. Un seul bouton plein par zone, noir (`primary`) : l'en-tête de page, un bandeau d'alerte, une carte de décision. Une action propre à une ligne est un bouton `secondary`. Le reste devient du texte ou un bouton discret (`ghost`). Précisé le 05/10/2026 (voir « Relief »).
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
| M · Page mission | En-tête avec logo, visages, note en anneau, avancement en cinq crans, bandeau « à trier », point qui pulse ; cadrage avec pastilles de section et anneau d'avancement. Avec la session de la refonte mission | Pipeline, Cadrage, Sourcing, en-tête de mission et liste des missions livrés le 04/10/2026 (carte « Maintenant » allégée, puces sur une rangée, liste avec visages et anneau de note, boutons discrets ; Cadrage sans cartes avec bandeau d'état en une ligne ; Sourcing en puces sans cadre et tableau réduit) ; en-tête avec logo du client et statut sans cadre ; liste des missions avec logo, visages en entretien et sans zéro. Reste l'état vide de /missions (`EmptyMissionState`, ancien langage) |
| P · Photos | Copie privée des photos LinkedIn : capture (recherche, notation, messagerie, extension, assistant), effacement RGPD, purge, export, rattrapage des candidats sans photo | affichage livré pour la page mission le 05/10/2026 (liste du Pipeline, À trier, kanban, fiche) et pour le /pipeline global le 05/10/2026 (kanban, tableau, chronologie). Copie privée en revue (05/10/2026) : copie de la photo enregistrée sur la ligne du candidat, quelle que soit son origine, toutes les deux minutes ; effacement RGPD, copies supprimées avec la ligne (purge comprise), export. Les visages lus en base (page mission, /pipeline, accueil, liste des missions, Tâches, agenda, scorecard) montrent la copie, sinon le lien LinkedIn, sinon les initiales. Rattrapage des candidats sans photo enregistrée : plus tard, avec l'accord du propriétaire |
| Suite | Pipeline global, messagerie, Paramètres, mêmes règles | à faire |

## Relief

Le 5 octobre 2026, le propriétaire trouve l'application encore un peu plate et demande de faire ressortir certaines choses : des fonds qui se détachent, des boutons mieux choisis. Sa référence est de nouveau Qonto (accueil, liste des transactions, comptes, en sombre).

Cause relevée sur le banc : depuis le lot A, tout est posé directement sur le fond, les actions des lignes sont de simples mots (« Lire », « Voir ») et la panne LinkedIn pèse autant qu'une ligne ordinaire.

Ce qui change, dans cet ordre de portée :

- Jetons (`index.css`) : en sombre, la carte passe de 14 à 16 %, le menu de 16 à 18 %, `muted` et `secondary` de 18 à 20 %, le survol de 20 à 22 %, `muted-foreground` de 62 à 64 %, le bord de champ de 36 à 40 % (contrastes recalculés, voir `01-direction.md` § 2). En clair, le fond de page passe à 97 %.
- Rayon des surfaces : `rounded-xl` vaut 16 px au lieu de 12 (`tailwind.config.ts`). Aucune classe ne change dans le code.
- `Button` : pilule, `secondary` en fond teinté, `outline` et `default` à filet appuyé. Deux surcharges de coin à 8 px retirées (`InvitationsPanel`).
- `Card` : ombre légère (`shadow-sm`), visible surtout en clair.
- Accueil : lignes « À faire », journée et tableau des missions sur des cartes ; panne LinkedIn en bandeau teinté avec bouton plein ; « Lire », « Répondre », « Voir » en boutons `secondary`. `AvatarStack` prend `ringClassName` pour que l'anneau des visages suive la surface.

Pas encore repris, à faire au fil des lots suivants : liste des missions, Pipeline, messagerie, Paramètres, page mission (écrans de la session « refonte mission », livrés sans cartes le 04/10/2026).

## Points ouverts

- Couleur de l'anneau de note, au lot M. La maquette le peint en couleur de marque pour tous les niveaux. Le barème actuel (`ScoreBadge`, `src/lib/scoreScale.ts`) colore par niveau, et son orange (score moyen) concurrence la règle 7.
- `text-3xs` et `text-2xs` valent tous deux 12 px : à fondre dans `text-xs` au fil des lots.
