# 03 · Plan des lots

Le chantier avance par lots. Un lot couvre le socle ou une famille d'écrans, se livre en un commit et passe la contre-revue (`04-contre-revue.md`) avant le lot suivant. Les identifiants (A-04, G-10…) renvoient au registre (`02-constats.md`) et aux annexes.

## Qui fait quoi

| Zone | Session | Lot |
|---|---|---|
| Jetons, primitives de `src/components/ui/`, coquille, pages d'erreur | chantier design | 1, 2, 3 |
| Tableau de bord | chantier design | 4 |
| Tâches, agenda | chantier design | 5 |
| Messagerie, séquences (liste, éditeur, inscription, suivi), InMail groupé | chantier design | 6 |
| Pipeline global, scorecard, coaching, assistant IA, page Agents, sheet de poste | chantier design | 7 |
| Accueil, connexion, tarifs, portails, profil public, désinscription, pages légales | chantier design | 8 |
| Onboarding, acceptation d'invitation, qualification, marketplace | chantier design | 9 |
| Textes de toutes les zones du chantier | chantier design | 10 |
| Liste et espace mission, recherche, pipeline de mission, fiche candidat | « Audit complet du dépôt » (refonte mission) | |
| Paramètres | « Audit complet du dépôt » | |
| Barre latérale et en-tête | « Audit complet du dépôt » | |

Le chantier design ne modifie pas les écrans de l'autre session. Quand un composant partagé l'oblige à toucher un fichier de cette zone (une chaîne de marque, une classe sans CSS), le changement reste d'une ligne et figure dans la note de coordination du lot.

## Ce que chaque lot doit remplir

1. Les écrans du lot suivent `01-direction.md` : jetons, hauteurs, rayons, typographie, mouvement, quatre états (chargement, vide, erreur, succès), texte.
2. Captures avant et après dans les quatre variantes du banc visuel (`05-banc-visuel.md`), avec le compte rempli et le compte vide, relues écran par écran.
3. Cliquet design : aucun compteur en hausse par rapport à `main` ; les fichiers du lot n'en portent plus, ou la raison est écrite dans le commit.
4. `npx tsc --noEmit -p tsconfig.app.json` sous la baseline, `npx vite build`, `npm run test:ux`, ESLint sans hausse.
5. Registre à jour : chaque constat du lot passe à « corrigé », « partiel » (avec ce qui reste) ou « remis ».
6. Contre-revue faite, constats bloquants traités avant le lot suivant.

## Les lots

### Lot 1 · Socle commun (fait, `b90f07a1`)

- Jetons : neutres chauds, un accent indigo, statuts avec une valeur par thème, filets en teinte et alpha séparés (les opacités `border-border/40` redeviennent valides), `text-accent` et `border-accent` rendus en indigo, `--success`, `--warning`, `--info` déclarés, variantes `dark:` actives.
- Typographie : Instrument Sans seule dans l'application, polices servies avec l'application (plus d'appel à Google Fonts), six paliers nommés, `text-sm` à 13 px.
- Primitives : `Button`, `Input`, `Textarea`, `Select`, `Tabs`, `Switch`, `Checkbox`, `Toggle`, `Badge`, `Card`, `Dialog`, `AlertDialog`, `Sheet`, `Drawer`, `Popover`, `Tooltip`, `DropdownMenu`, toasts ; nouveaux `Spinner` et `Banner` ; calques nommés.
- Mouvement : préférence de mouvement réduit suivie par le CSS et par framer-motion ; dégradés, halos et reflets partagés mis à plat.
- Garde-fous : cliquet `npm run audit:design` et job CI « Design (ratchet) » ; banc visuel (données de démo, captures).

Constats : C-01, C-02, C-04, C-62, D-04, E-12, G-01, G-02, G-04, G-06, G-13, G-15, et côté coquille A-16, A-17, A-24, A-50 à A-52 corrigés. Partiels : A-23, B-10, C-03, C-28, C-35, D-45, E-11, E-14, G-05, G-07 à G-10, G-12, G-14, G-16, G-17.

### Lot 2 · Coquille (fait, `b90f07a1`)

- `PageHeader`, `EmptyState`, `ErrorState`, `StatTile`, `Section` réécrits dans le registre cible.
- Bandeaux d'essai et de crédits sur `Banner`, dans la zone de contenu.
- Pages d'erreur (`ErrorBoundary`, `SectionErrorBoundary`, `OrganizationGuard`) sur `ErrorState` ; page 404 ; fenêtre de session expirée ; un seul indicateur de chargement.
- Palette « Aller à » titrée ; une seule bascule de thème (`src/lib/theme.ts`) ; logo qui suit le thème.

Constats corrigés : A-02, A-04, A-05, A-07 à A-13, G-20. A-14 est partiel : les composants existent, les lots suivants les adoptent.

Reste : A-01 et A-03 (bande d'en-tête vide, cible tactile du bouton de navigation) et A-15 (aide contextuelle) vont à la barre latérale ; A-06 (noms des pages) au lot 10 pour les pages du chantier.

### Lot 3 · Socle, suite

Ce que la revue G a relevé et que le lot 1 laisse ouvert.

- Bords de champ, de case à cocher et d'interrupteur à 3:1 dans les deux thèmes (G-21), comme l'annonce `01-direction.md` § 10.
- Un seul système de toast : `Auth` et l'accueil passent à sonner, l'ancien `Toaster` est démonté. Un toast reste cliquable quand un dialogue est ouvert, et le clic ne ferme pas le dialogue (G-10).
- Classes qui ne génèrent aucun CSS remplacées par des valeurs de l'échelle (G-03) ; keyframe manquante de `shimmer-button`.
- Bandeau d'essai : fermeture mémorisée pour « Essai terminé », lien vers l'abonnement dans les Paramètres (F-65).
- Cliquet : trois compteurs de plus, ancienne marque (`brand-purple`…), texte atténué par opacité (`text-muted-foreground/60`), variables CSS lues sans être déclarées (G-02, G-05, G-16).

Fini quand : toast « Annuler » cliquable par-dessus un dialogue ouvert (vérifié dans Chromium), contrastes des contrôles mesurés à 3:1 ou plus, zéro variable inconnue.

### Lot 4 · Tableau de bord

Périmètre : `src/pages/Dashboard.tsx`, `src/components/dashboard/**`, `MissionCompanyLogo`.

Constats : A-22 à A-33, dont A-23 (P1) ; A-27 (logos, qui touche aussi les tâches et l'agenda) ; A-53 à A-57 pour ces fichiers.

- En-tête sur `PageHeader` ; salutation sans emoji, sans dégradé ni tache floue.
- Indicateurs sur `StatTile` : chiffre monochrome, un zéro ne se colore pas.
- Chaque section a ses quatre états : squelette, `EmptyState` qui mène à l'action, `ErrorState` compact avec « Réessayer ».
- « Pour aujourd'hui » : tuiles neutres, couleur de statut sur le seul signal.
- Aucune animation en boucle ; entrées de 200 ms au plus.
- Réorganisation : poignée qui ne chevauche rien sur téléphone, déplaçable au clavier.
- Logos : plus d'appel à un service tiers depuis le navigateur avec le nom du client ; logo enregistré ou initiales.
- Textes : « Tableau de bord », « Messagerie », « Agenda » ; chaque lien mène où il le dit.

Fini quand : les quatre variantes, compte rempli et compte vide, passent la relecture ; `components/dashboard/**` ne porte plus d'emoji, de couleur brute ni de taille arbitraire.

### Lot 5 · Tâches et agenda

Périmètre : `src/pages/Tasks.tsx`, `src/pages/Calendar.tsx` et leurs composants.

Constats : A-34 et A-40 (P1), A-35 à A-49, A-56, A-57.

- Une panne s'affiche comme une panne (`ErrorState` et « Réessayer »), jamais « Zéro tâche en cours » ni un agenda vide.
- Même en-tête (`PageHeader`) et mêmes filtres pour les deux pages ; segmentés avec `aria-pressed`.
- Suggestions et compteurs sans émeraude ; les chiffres ne se colorent que pour un retard.
- « Nouvelle tâche » et « Programmer un entretien » : chaque champ a son libellé, vouvoiement.
- Semaine du lundi au dimanche ; vue jour lisible ; liste sans rangées vides ; une couleur stable par type d'événement, prise dans les jetons.
- Raccourcis clavier inactifs quand le focus est sur un bouton ou une liste.

### Lot 6 · Messagerie et séquences

Périmètre : `src/pages/Inbox.tsx` et `src/components/outreach/` : messagerie (`MessagesInbox`, `inbox/**`), séquences (`SequencesList`, `SequenceBuilder`, `sequence/**`), inscription (`SequenceEnrollModal`, `EnrollmentPreviewModal`, `enrollment-preview/**`), suivi (inscriptions, journal, statistiques, diagnostic), `BulkInMailModal`. Ces composants s'ouvrent aussi depuis l'onglet Outreach d'une mission : le lot touche leur contenu, pas l'onglet qui les accueille.

Constats : D-01 à D-03, D-30 à D-32, D-44 à D-46, D-54 (P1) ; D-05 à D-20, D-22 à D-27, D-29, D-33 à D-43, D-47 à D-51, D-53, D-55 à D-60, D-62, D-65 à D-72 ; G-03 et G-11 pour ces fichiers.

- Étapes, statuts et canaux affichés par leur libellé, jamais par leur identifiant ; une couleur stable par canal.
- Inscription en séquence depuis une conversation ; tri et actions accessibles au doigt et au clavier.
- Éditeur : réglages « Expéditeurs » et « Garde-fous » enregistrés, « Retour » qui prévient d'une perte, en-têtes d'étape en bouton, fenêtres sur `Dialog`.
- Préparation : Entrée ne lance plus de génération payante, les aperçus payés restent, action principale monochrome.
- Badges d'exécution lisibles dans les deux thèmes ; un seul sélecteur de ton.

Remis : D-21, D-28 (onglet Outreach), D-52 (bouton « Séquence » des résultats), D-61 (fiche), D-63 (invitations de l'onglet mission) à la refonte mission ; D-64 (webhooks) aux Paramètres.

### Lot 7 · Pipeline global, scorecard, coaching, assistant IA, page Agents

Périmètre : `src/pages/ATS.tsx` et les vues de `/pipeline` (tableau, chronologie, analyse, shortlist client), `ScorecardTab` et `ScorecardFullPage`, coaching en direct, `AgentsPage`, tiroir de l'assistant, IA en ligne, sheet de poste ; la chaîne « Deepgram » de la dictée (B-07).

Constats : E-04, E-05 (scorecard), E-09, E-10, E-13, E-14 (P1) ; E-11 hors mission ; E-15 à E-28, E-32 à E-40, E-43 à E-48, E-51, E-53.

- Un seul rendu du score (`ScoreBadge`) et un seul module de libellés d'étapes pour l'affichage, en attendant la décision sur la table d'étapes (E-01).
- Carte de pipeline sur trois lignes ; glisser-déposer au clavier, avec annonces en français et « Annuler ».
- Scorecard enregistrée en continu, suppression et régénération confirmées, verdicts en français.
- Coaching : plus d'action sans effet, plus de nom de fournisseur, textes lisibles.
- Assistant : plus d'œil animé ni de texte miroitant ; étapes nommées, bouton « Arrêter », vouvoiement.

Remis à la refonte mission : E-02, E-03, E-05 (fiche), E-06 à E-08, E-29 à E-31, E-41, E-42, E-49, E-52.

### Lot 8 · Pages publiques et portails

Périmètre : accueil (`/`), `/auth`, `/pricing`, `/portal/:token`, `/client/:token`, `/r/:slug`, `/unsubscribe`, `/privacy`, `/privacy-extension`.

Constats : F-33, F-34, F-53, F-54 (P1) ; F-35 à F-52, F-55 à F-64.

- Bricolage Grotesque réservé aux titres des pages publiques ; logo lisible sur les deux fonds.
- Un seul écran d'impasse public (logo, titre, phrase, action), qui distingue lien expiré et problème de connexion.
- Portail client : étapes en libellés ; portail candidat : étape réelle.
- Désinscription : une panne ne se lit pas comme un succès.

Attend : l'adresse de prise de rendez-vous (F-33) et la table d'étapes (F-53).

### Lot 9 · Onboarding, invitation, qualification, marketplace

Périmètre : `/onboarding` et `src/components/onboarding/**`, `WelcomeOnboardingModal`, `CollaboratorWelcome`, `/mission-invite/:token`, `/qualification/:id`, `/marketplace`.

Constats : B-01 (P1), B-07 (Apollo), B-62 à B-67, B-72, B-85, B-87, B-88 ; E-50 ; F-26 à F-31.

- Acceptation d'invitation en un seul appel, un message par cause, « Réessayer » pour le réseau.
- Onboarding : sources de postes sans nom de fournisseur, plus d'analyse simulée, plus de confettis ni d'interstitiel.
- Qualification : statut d'enregistrement visible, verdicts sans emoji (vocabulaire suivant la décision produit).
- Marketplace sur les primitives.

### Lot 10 · Passe texte

Périmètre : toutes les zones du chantier.

Constats : A-06, A-32, A-35, A-46, B-13 et C-05 pour les écrans du chantier, E-37, E-53, et les constats de texte des annexes A, D, E, F.

- Vouvoiement ; français (plus de « step », « preview », « enrollment ») ; boutons en verbe et objet.
- Un nom par page, le même partout où la page est citée (titre, palette, raccourcis, liens) ; la liste est transmise à la barre latérale.
- Typographie française : guillemets « », espace insécable avant les deux points et les points d'interrogation.
- Cliquet : tirets longs, emoji et noms de fournisseurs à zéro dans les zones du chantier.

### Lot 11 · Nettoyage

Après la fusion de la refonte mission : suppression du code mort (G-19), des jetons `--k-*` et `--skalr-*` devenus sans lecteur, des variantes de bouton en double. Le faire plus tôt casserait du code que l'autre session n'a pas encore fusionné.

## Composants partagés

Existants après les lots 1 et 2, à employer partout (les deux sessions) :

| Besoin | Composant |
|---|---|
| En-tête de page | `PageHeader` (`src/components/layout`) |
| Indicateur chiffré | `StatTile`, `StatGrid` (`src/components/layout`) |
| Section de page | `Section` (`src/components/layout`) |
| État vide | `EmptyState` (`src/components/layout`, ou `ui/EmptyState` pour la forme courte) |
| Erreur avec reprise | `ErrorState` (`src/components/layout`) |
| Chargement ponctuel | `Spinner` (`src/components/ui/spinner.tsx`) |
| Bandeau | `Banner` (`src/components/ui/banner.tsx`) |
| Tuile d'icône | `IconTile` (`src/components/ui/IconTile.tsx`) |
| Thème courant | `useAppTheme`, `setAppTheme` (`src/lib/theme.ts`) |

Prévus dans les lots, avec leur emplacement, pour éviter deux versions du même composant :

| Besoin | Composant | Lot |
|---|---|---|
| Score d'un candidat | `ScoreBadge` et barème unique (`src/lib/scoreScale.ts`) | 7 |
| Libellé d'une étape de pipeline | module d'étapes (`src/lib/pipelineStages.ts`) | 7 |
| Statut d'enregistrement | `SaveStatus` (`src/components/ui/save-status.tsx`) | 6 ou 7 |
| Libellé et couleur d'un canal | `src/lib/channels.ts` | 6 |
