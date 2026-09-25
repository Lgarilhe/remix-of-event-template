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

### Lot 3 · Socle, suite (fait)

Ce que la revue G a relevé et que le lot 1 laissait ouvert.

- Bords de champ, de case à cocher et d'interrupteur à 3:1 dans les deux thèmes (`--input` : blanc 36 % en sombre, `40 3% 53%` en clair, 3,1:1 au pire), survol en `muted-foreground`, focus en `brand`. L'onglet actif d'un `Tabs` prend un filet `border-strong` (G-21).
- Un seul système de toast : l'ancienne API `useToast` passe par sonner, l'ancien `Toaster` est démonté et ses fichiers retirés. Un toast reste cliquable quand un dialogue ou un panneau est ouvert, et ce clic ne le ferme plus : vérifié dans Chromium sur « Nouvelle tâche » et sur la palette « Aller à » (G-10).
- Les classes qui ne généraient aucun CSS (quatorze occurrences dans six fichiers) prennent des valeurs de l'échelle ; une recompilation de Tailwind sur toutes les classes du code n'en trouve plus (G-03). La keyframe `shimmer-spin` reste absente à dessein : l'effet est proscrit, et le seul bouton qui l'emploie part avec l'état vide des missions (B-09).
- Bandeau d'essai : « Essai terminé » se ferme et reste fermé pour l'organisation, « Choisir un plan » mène à l'abonnement dans les Paramètres, un membre lit le nom du propriétaire (F-65).
- Noms de fournisseurs : les quatre « Deepgram » de la dictée et du coaching deviennent « la transcription » ou « la dictée », le badge de source « Apollo » de l'onboarding devient « Base Konekt » (B-07, E-10). Le compteur couvre aussi les fournisseurs de transcription, de recherche et d'enrichissement.
- Cliquet : trois compteurs de plus, avec leurs valeurs de départ : ancienne palette de marque 158, texte atténué par opacité 484, variables CSS lues sans être déclarées 0 (G-02, G-05, G-16).

Reste : l'onglet actif et l'item de menu survolé se distinguent de leurs voisins sous 3:1 (fond, filet, couleur du texte). Relever ces fonds alourdirait tous les menus ; le choix est soumis à la contre-revue.

### Lot 4 · Tableau de bord (fait)

Périmètre : `src/pages/Dashboard.tsx`, `src/components/dashboard/**`.

- En-tête sur `PageHeader` : « Bon après-midi, Camille », la date et le récapitulatif, sans emoji, avatar, dégradé ni tache floue. Trois actions : « Nouvelle mission » (principale), « Rechercher » (qui mène enfin à `/sourcing`), « Messagerie » (A-22, A-32).
- Plus aucune animation : ni boucle, ni entrée décalée, ni compteur qui défile. La transition de page de la coquille suffit (A-23).
- Canaux : statut en texte avec un point, action « Connecter » ou « Reconnecter » visible (A-31).
- « Pour aujourd'hui » : tuiles neutres, un zéro reste gris, un chiffre non nul passe en texte principal avec un point d'accent ; le total concurrent de la barre latérale est retiré ; « Rappels du jour » devient « Tâches du jour » (A-26, A-32).
- Missions : initiales neutres, « 140 sourcés · 24 contactés · 12 retenus » en mots, détail dépliable par un bouton toujours visible, progression en accent (A-29).
- Journée : `Checkbox` du kit, liens au lieu de rechargements, sous-titre « 3 en retard · 2 à venir », « En cours », « Dans 12 min », « Rejoindre » en bouton principal (A-30).
- Semaine : courbes monochromes, variation écrite en couleur de statut, « Voir l'analyse » (A-24).
- Chaque section a ses états : squelette, erreur avec « Réessayer » (panne simulée vérifiée), vide avec la prochaine action (A-25).
- Réorganisation : le glisser-déposer laisse place à un mode « Personnaliser la page » avec « Monter » et « Descendre », au clavier comme au doigt, annonce du déplacement aux lecteurs d'écran (A-28).
- Code mort retiré : `JobDetailSheet` jamais ouvert (A-33).

Composants partagés modifiés : `CandidateAvatar` (initiales neutres, image décorative), `MissionCompanyLogo` (plus aucun appel à un service tiers : logo enregistré ou initiales, A-27), `LivePulse` (point fixe), `Sparkline` (monochrome), `Section` (niveau de titre, `aria-labelledby`), `StatGrid` (classes écrites en entier), `PageHeader` (actions qui passent à la ligne sur téléphone), `useAllReminders` (une lecture en échec remonte au lieu de renvoyer une liste vide). `CandidateAvatar` sert aussi au menu de l'avatar de la barre latérale : les initiales y deviennent neutres.

Reste : le logo des clients pourrait être résolu côté serveur et enregistré sur la mission ; c'est une évolution du modèle de données, hors du chantier. (Dans Tâches, le logo recevait l'intitulé du poste : les lignes de tâche n'ont plus de logo depuis le lot 5.)

### Lot 5 · Tâches et agenda (fait)

Périmètre : `src/pages/Tasks.tsx`, `src/pages/Calendar.tsx`, `src/components/tasks/**`, `src/components/calendar/**`.

- Une panne s'affiche comme une panne : `ErrorState` et « Réessayer » dans les deux pages, vérifié sur panne simulée. Le filtre « Actives » n'affiche pas « (0) » tant que la liste n'est pas lue (A-34, A-40).
- Même en-tête (`PageHeader`) et mêmes contrôles dans les deux pages : `SegmentedControl` (« Mes tâches / Équipe », « Mon agenda / Équipe », « Semaine / Jour / Liste », avec `aria-pressed`) et `FilterPill`, deux primitives ajoutées au kit (A-38, A-45, A-56).
- Tâches : plus de bandeau émeraude, de cartes de compteurs ni d'emoji. Les groupes (en retard, aujourd'hui, cette semaine, plus tard, terminées) portent leur nombre ; seule l'échéance dépassée se colore. Chaque ligne se coche avec la `Checkbox` du kit, mène au candidat et à la mission, se supprime après confirmation. Une suggestion tient en un titre et un motif, avec « Créer la tâche » et « Ignorer » (A-35 à A-37).
- Plus de logo dans les lignes de tâche : l'intitulé du poste n'est plus pris pour un nom de client (A-27, part Tâches).
- « Nouvelle tâche » et « Programmer un entretien » : chaque champ a son libellé, vouvoiement, messages d'erreur rédigés. La recherche de candidat suit le modèle d'une liste de suggestions accessible (flèches, Entrée, Échap ferme la liste sans fermer la fenêtre). Le format se choisit dans un segmenté, avec l'icône du téléphone pour « Téléphone » (A-39, A-46).
- Une table pour les catégories de tâche (`src/lib/taskCategories.ts`), une pour les types d'événement et les libellés d'entretien (`src/components/calendar/eventMeta.ts`) : « 1er entretien », « 2e entretien », « Entretien final » dans la grille, la fiche, le filtre et le formulaire (A-44, A-46).
- Semaine du lundi au dimanche. Vue jour : carte compacte, événements simultanés côte à côte, plage élargie pour un entretien très tôt ou très tard, trait de l'heure en accent. Vue liste : seuls les jours qui ont des événements, en-têtes collants. Sur téléphone, la liste est l'affichage par défaut, les jours vides restent compacts et les boutons de vue gardent leur libellé (A-41 à A-43, A-49).
- Types d'événement neutres, reconnus à leur icône et à leur nom ; la seule couleur de la grille signale un conflit d'horaire. Un événement passé perd son fond et atténue son nom, sans opacité sur le texte (A-44).
- Fiche d'événement : une action principale (« Ouvrir le compte rendu » pour un entretien passé, la page où mène aussi la barre latérale ; sinon « Rejoindre la réunion » ; sinon « Préparer l'entretien »), le reste dans « Plus ». « Copier » s'écrit en toutes lettres et disparaît quand il n'y a rien à copier (A-47).
- Raccourcis J, K, T, N, 1, 2, 3 : même garde que les raccourcis G (`src/lib/keyboardShortcuts.ts`), inactifs sur un bouton, dans une liste ou quand une fenêtre est ouverte ; aide lisible ; l'affichage choisi se relit sans erreur quand le stockage du navigateur est bloqué (A-48).
- Plus d'animation d'entrée propre aux deux pages : reste la transition de route de la coquille (A-57).

Vocabulaire : « compte rendu » remplace « débrief » dans les tâches et l'agenda, comme dans la barre latérale. L'action IA « Débrief rapide » relève du lot 7.

Composants partagés modifiés : `ui/dialog.tsx` (Échap ferme d'abord une liste de suggestions ouverte, repérée par `data-suggestions-open` dans `src/lib/overlayInteractions.ts`), `GoShortcuts` (garde commune), `useCalendarEvents` (une lecture en échec remonte ; libellés d'entretien), `useAutoTaskSuggestions` (vouvoiement, « compte rendu »).

Reste : les champs date et heure sont ceux du navigateur, leur format suit la langue du système.

### Lot 6 · Messagerie et séquences

Périmètre : `src/pages/Inbox.tsx` et `src/components/outreach/` : messagerie (`MessagesInbox`, `inbox/**`), séquences (`SequencesList`, `SequenceBuilder`, `sequence/**`), inscription (`SequenceEnrollModal`, `EnrollmentPreviewModal`, `enrollment-preview/**`), suivi (inscriptions, journal, statistiques, diagnostic), `BulkInMailModal`. Ces composants s'ouvrent aussi depuis l'onglet Outreach d'une mission : le lot touche leur contenu, pas l'onglet qui les accueille.

Constats : D-01 à D-03, D-30 à D-32, D-44 à D-46, D-54 (P1) ; D-05 à D-20, D-22 à D-27, D-29, D-33 à D-43, D-47 à D-51, D-53, D-55 à D-60, D-62, D-65 à D-72 ; G-03 et G-11 pour ces fichiers.

- Étapes, statuts et canaux affichés par leur libellé, jamais par leur identifiant ; une couleur stable par canal.
- Inscription en séquence depuis une conversation ; tri et actions accessibles au doigt et au clavier.
- Éditeur : réglages « Expéditeurs » et « Garde-fous » enregistrés, « Retour » qui prévient d'une perte, en-têtes d'étape en bouton, fenêtres sur `Dialog`.
- Préparation : Entrée ne lance plus de génération payante, les aperçus payés restent, action principale monochrome.
- Badges d'exécution lisibles dans les deux thèmes ; un seul sélecteur de ton.

Remis : D-21, D-28 (onglet Outreach), D-52 (bouton « Séquence » des résultats), D-61 (fiche), D-63 (invitations de l'onglet mission) à la refonte mission ; D-64 (webhooks) aux Paramètres.

Socle commun, posé avant les écrans : `src/lib/channels.ts` et `ChannelIcon` (nom, logo ou icône d'un canal), `src/lib/sequenceCatalog.ts` et `SequenceBadges` (libellé et icône de chaque étape, statut d'une inscription ou d'une exécution, raison d'arrêt, tons de message). Test `tests/ux/lot6-catalogue.test.mjs`.

Fait (messagerie, D-01 à D-20) :

- Frise de conversation sur le catalogue : plus aucun identifiant technique, appels par `ChannelIcon`, durée « 3 min 20 s », rendez-vous en lien vers sa qualification (D-01, D-16).
- « Inscrire dans une séquence » dans l'en-tête sur grand écran, dans « Plus d'actions » ailleurs ; la fenêtre « Choisir une séquence » passe sur le `Dialog` du kit, avec le nombre d'étapes et les canaux (D-02).
- Un seul segment Toutes / À répondre / En attente ; statut, étiquette, boîte LinkedIn et non lues dans le menu « Filtres » ; ligne de conversation sur trois niveaux (D-05 à D-07).
- Mission devinée affichée « Mission probable » ; plus de repli sur « la seule mission active », qui donnait à l'IA une mission prise au hasard (D-08 partiel : « Associer à une mission » demande une écriture nouvelle).
- Panne de chargement avec « Réessayer », vide réel, vide filtré avec « Effacer les filtres », compte absent avec « Relier votre compte LinkedIn » (D-09).
- Préfixe « Brouillon : » dans la liste, « Brouillon enregistré » sous le champ (D-10) ; hauteur de la page mesurée au lieu des 124 px écrits en dur (D-11).
- Actions de ligne visibles au survol, au focus et au doigt ; menu « Plus d'actions » sur téléphone (D-03, D-12).
- Composeur : boutons de mise en forme nommés, Envoyer seul bouton principal, suggestions IA qui remplissent le champ au lieu d'envoyer sans relecture (D-13, D-14).
- Bulles sans dégradé, flou, ombre ni ressort ; vouvoiement ; badges de statut du socle ; archiver sans confirmation ni rouge, « Restaurer » en place (D-15, D-17 à D-20 ; D-20 partiel : le toast « Annuler » vit dans `useChatStatus`).
- Test `tests/ux/lot6a-messagerie.test.mjs` ; UX07 de `lot1-sequences` reformulé (aucune couche arbitraire, conversation mobile sur `z-sticky`).

Fait (liste et éditeur de séquences, D-22 à D-43) :

- Liste : un squelette, une erreur avec « Réessayer », un vide avec son action ; « Nouvelle séquence » en principal, « Avancer les envois » (ancien « Envoyer tout ») avec une infobulle exacte, menu « Plus d'actions » ; colonnes Inscrits, Statuts, Créée ; icônes des canaux au lieu d'émoji ; même menu sur téléphone et ordinateur (D-22 partiel, D-23 à D-26).
- Interrupteur nommé ; sans abonnement, désactivé avec un bandeau « Voir les offres » (D-25). Bandeau de sélection et inscription par clic retirés : rien ne les alimentait (D-27).
- Éditeur : expéditeurs et garde-fous écrits à la création comme à la modification, et relus à l'ouverture ; « Quitter sans enregistrer ? » dès qu'un champ change ; en-têtes d'étape en `Collapsible` ; fenêtre plein écran sur le `Dialog` Radix (D-30 à D-33).
- « Enregistrer sans activer » et « Enregistrer et activer » distincts ; une nouvelle séquence reste inactive sauf choix contraire ; le bouton reste actif et montre ce qui manque (D-34).
- Étapes, canevas et nœuds sur le catalogue, sans couleur de statut ni agrandissement ; canevas au thème de l'application ; la touche Suppr n'efface plus le dessin d'un nœud en gardant l'étape (D-35, D-42).
- Aperçu sur un exemple neutre (Marie Dupont, Cabinet Horizon), une seule syntaxe `{{first_name}}` (D-36) ; encarts en `Banner` (D-37) ; contrôles icône nommés, cibles de 44 px au doigt, assistant en ligne sous 1 024 px (D-38, D-39) ; glossaire français, rayons du kit (D-40, D-41, D-43).
- Nouveau `src/components/ui/save-status.tsx` (« Enregistré », « Enregistrement… », « Modifications non enregistrées », « Échec de l'enregistrement »). Test `tests/ux/lot6b-sequences.test.mjs`.

Fait (suivi et InMail, D-54 à D-60, D-62) :

- Badges d'exécution teintés, lisibles dans les deux thèmes ; un statut, un libellé, un ton, dans le panneau des inscriptions comme dans les statistiques (D-54, D-55).
- Étapes par leur libellé, « Déroulé », raisons d'arrêt traduites, pause expliquée (D-56) ; tuiles du kit, « Traiter maintenant » en bouton, arrêt groupé derrière une `AlertDialog` (D-57) ; journal sur le catalogue (D-58).
- Diagnostic en mots de recruteur, un seul seuil de retard (10 minutes, le moteur passe toutes les 5 minutes) (D-59) ; statistiques avec légende de la couleur réelle des barres, titre « Statistiques : {nom} » (D-60).
- InMail : annulation des envois en attente confirmée, bouton principal monochrome, ton en `SegmentedControl`, couleur LinkedIn réservée au logo (D-62).
- Chaque panneau a son squelette, son erreur avec « Réessayer » et son vide rédigé ; les délais annoncés sont ceux du moteur (« dans les 5 minutes »). Test `tests/ux/lot6d-suivi.test.mjs`.

Fait (inscription et préparation, D-44 à D-53) :

- Plus d'écouteur clavier sur toute la page : les raccourcis partent de la ligne d'un candidat qui a le focus (flèches pour parcourir, P pour passer, X ou Suppr pour retirer), avec une aide sous la liste. Entrée et Espace font ce que dit le bouton ; aucune génération payante ne part du clavier. Un bouton « Générer les N aperçus » par candidat annonce son coût (D-44).
- « Inscrire N candidats » en bouton principal monochrome, « Générer tous les aperçus » en secondaire ; plus de dégradé, reflet, halo ni ressort (D-45).
- Fermer avec du travail en cours demande confirmation et dit ce qui est gardé. Les aperçus et les retouches restent en mémoire pendant la session (jamais dans le navigateur), par séquence, mission, compte d'envoi et candidat ; un aperçu n'est repris que si son étape n'a pas changé. La génération groupée n'écrase plus les retouches et s'arrête à la fermeture (D-46).
- Vocabulaire : inscrire, aperçu, étape, « Présélectionner sans message », crédits en toutes lettres ; moyens de contact manquants écrits (« sans e-mail ») ; canaux par `ChannelIcon`, étapes par le catalogue (D-47 à D-49).
- En-tête du candidat à plat, `ScoreBadge`, badge fixe « Ouvert aux opportunités » ; la recommandation brute (« STRONG_MATCH ») n'est plus affichée ; plus de framer-motion (D-50, D-69).
- Casse de phrase, rayons du système ; une panne d'inscription propose « Réessayer » ; le toast d'échec de planification dit que le moteur reprend seul ces inscriptions ; la fenêtre simple ne déborde plus à droite (D-51).
- `Checkbox` et `SegmentedControl` du kit (D-53) ; la préparation est un `Dialog` avec titre, piège de focus et Échap qui passe par la confirmation, sans `z-[4000]` (D-33, D-72).
- Test `tests/ux/lot6c-preparation.test.mjs`.

Reste pour le lot 6 : les 30 émojis du sélecteur de l'éditeur InMail, contenu inséré dans le message, à trancher au lot 10.

### Lot 7 · Pipeline global, scorecard, coaching, assistant IA, page Agents

Périmètre : `src/pages/ATS.tsx` et les vues de `/pipeline` (tableau, chronologie, analyse, shortlist client), `ScorecardTab` et `ScorecardFullPage`, coaching en direct, `AgentsPage`, tiroir de l'assistant, IA en ligne, sheet de poste.

Constats : E-04, E-05 (scorecard), E-09, E-13, E-14 (P1) ; E-11 hors mission ; E-15 à E-28, E-32 à E-40, E-43 à E-48, E-51, E-53.

- Un seul rendu du score (`ScoreBadge`) et un seul module de libellés d'étapes pour l'affichage, en attendant la décision sur la table d'étapes (E-01).
- Carte de pipeline sur trois lignes ; glisser-déposer au clavier, avec annonces en français et « Annuler ».
- Scorecard enregistrée en continu, suppression et régénération confirmées, verdicts en français.
- Coaching : plus d'action sans effet, textes lisibles.
- Assistant : plus d'œil animé ni de texte miroitant ; étapes nommées, bouton « Arrêter », vouvoiement.

Remis à la refonte mission : E-02, E-03, E-05 (fiche), E-06 à E-08, E-29 à E-31, E-41, E-42, E-49, E-52.

Fait (pipeline global, `/pipeline`) :

- En-tête « Pipeline », indicateurs neutres (`StatTile`), cinq vues en `SegmentedControl` à icônes, état vide « Aucun candidat pour l'instant » avec « Aller aux missions » ; plus d'icônes 3D, d'entonnoir animé (`AnimatedFunnel` supprimé) ni de « Sync… » (E-14, E-24).
- Carte sur trois lignes : nom, score (`ScoreBadge`), poste ; une seule étape ; signal de réponse en texte, seulement en Nouveau et Contacté ; statut de séquence par `EnrollmentStatusBadge` ; « Sans mouvement depuis N j » en texte d'alerte, une seule table de seuils pour la carte, le tableau et l'analyse (E-11, E-15, E-17 partiel, E-19, E-43 partiel).
- Glisser-déposer au clavier : Espace saisit, les flèches changent de colonne, Espace ou Entrée dépose, Échap annule ; consignes et annonces en français ; le focus revient à la carte déposée. Menu « Déplacer vers… » sur chaque carte, au doigt comme à la souris (E-21 partiel, E-22).
- Déplacement groupé : un toast avec le nombre exact, les échecs comptés et « Annuler » ; les candidats en échec restent cochés ; tout échec remet l'état précédent. Chaque écriture est relue (E-23).
- Provenance en mots (« Mission », « Séquence », « InMail ») au lieu du badge « PIPELINE » ; filtre « Avec rappel » ; Rappels dans un `Sheet` (E-18, E-20).
- Tableau : nom en bouton qui ouvre la fiche, tri annoncé (`aria-sort`), liens nommés ; chronologie datée, atteignable au clavier ; analyse aux métriques renommées, barres monochromes avec valeur écrite et définitions (E-25 à E-27).
- Shortlist client sur les primitives du kit, « Taux de placement » distinct du « Taux de réussite » (E-28 partiel).
- Squelettes à la forme de chaque vue, `ErrorState` avec « Réessayer », plus de « Failed to load data » (E-44). Test `tests/ux/lot7a-pipeline.test.mjs`.

Reste pour le pipeline : une colonne à la fois avec sélecteur d'étape sur téléphone (E-21) ; la fusion de la shortlist dans le pipeline, décision produit (E-28) ; les gabarits communs de candidat et un avatar neutre unique (E-43) ; le module d'étapes commun, qui attend la décision sur la table d'étapes (E-01) : aujourd'hui une étape de mission inconnue s'affiche « Nouveau » dans le pipeline global.

Fait (assistant, page Agents, IA en ligne, sheet de poste) :

- Page `/agents` renommée « Assistant » comme l'onglet de la barre latérale et la palette ; « Nouvelle conversation » ouvre le tiroir ; erreur avec « Réessayer », squelette, état vide ; statuts partagés avec l'historique du tiroir (`src/lib/agentConversations.ts`, E-35, E-39).
- Plus d'œil animé : monogramme Konekt fixe ; ligne d'état en texte avant la première réponse ; bloc « Réflexion » sans étincelle ni miroitement, contenu replié non monté ; bouton « Arrêter » pendant une réponse (E-14, E-36 partiel).
- Vouvoiement de l'accueil, des placeholders et des erreurs ; un seul nom, « l'assistant » ; bouton d'envoi nommé et monochrome ; composeur à 12 px (E-37).
- Carte d'approbation sans ombre décalée ni police mono, textes rédigés, boutons du kit ; puces d'outils sans emoji, repli « Action de l'assistant » au lieu du nom technique (E-38).
- Aide à la rédaction (`AiTextarea`) : commandes à l'infinitif, sans emoji ni violet, « Aperçu » ; sélecteur de modèle et coût en toutes lettres (« 3 crédits »), sans étincelle ni « tokens » (E-40, E-47, E-51 partiel).
- Sheet de poste : statut en français, filtres avec les libellés de la recherche, onglets `Tabs`, onglet « Analyse » sans jargon, critères « Indispensable, Important, Appréciable », scores par `ScoreBadge` ; la fiche remplace le sheet au lieu de s'empiler ; un poste de mission (« project:… ») affiche enfin son brief (E-34).
- Recommandation de l'IA en trois mots, comme le barème du score : « Recommandé » (65 et plus), « À évaluer » (50 à 64), « Peu adapté » (sous 50). Une seule table (`AI_RECOMMENDATIONS`, `src/lib/verdicts.ts`) ramène à ces trois mots les clés de l'assistant et les verdicts du moteur de scoring (`STRONG_MATCH` à `NO_MATCH`). L'assistant, la qualification, la scorecard et l'historique d'un candidat (`useCandidateFullProfile`, lu aussi par la fiche) l'utilisent ; le score de la qualification passe sur `ScoreBadge` (un score faible en gris, plus en rouge).

Fait (scorecard et assistant d'entretien) :

- Scorecard enregistrée en continu : chaque champ part 1,5 s après la dernière saisie ; l'écriture est forcée au départ de la grille, au démontage (changement d'onglet de la fiche) et avant le plein écran ; chaque écriture est relue. Statut annoncé : « Modifications non enregistrées », « Enregistrement… », « Enregistré à 16:07 », « Échec de l'enregistrement » avec « Réessayer ». Une mise à jour n'écrit plus `created_by`, `candidate_id` ni `organization_id` (E-04).
- Suppression et régénération d'une grille derrière une `AlertDialog` qui dit ce qui sera effacé ; boutons toujours visibles et nommés (E-05 pour la scorecard).
- Assistant d'entretien : « Avancer dans le pipeline » et « Écarter + copier » retirés (sans effet, table d'étapes non tranchée) ; « Programmer l'entretien suivant » ouvre la fenêtre « Programmer un entretien » ; « Voir le profil du candidat » affiche le panneau en plein écran (E-09). Un seul nom, « Assistant d'entretien » ; « Démarrer l'enregistrement » monochrome, le rouge réservé au point et au minuteur de l'enregistrement en cours, sans clignotement ; un seul panneau monté ; la transcription défile dans sa zone (E-33).
- Textes lisibles sur toutes les teintes (E-13) ; score de l'IA par `ScoreBadge`, moyennes sur 5 neutres à une décimale (E-15) ; recommandations et types d'entretien par `verdicts.ts`, le compte rendu proposé signalé comme tel (E-16).
- Grille : catégories au libellé seul, poids en toutes lettres, note de 1 à 5 en `ToggleGroup` monochrome, coût et modèle affichés une fois, état vide rédigé ; plus de lecture de la base toutes les 5 s (E-32).
- Squelettes et `ErrorState` avec « Réessayer » ; plus d'étincelle, d'émoji ni d'animation en boucle ; le plein écran défile jusqu'au verdict et ne déborde plus sur téléphone (E-44 à E-48, E-53 pour ces fichiers). Test `tests/ux/lot7b-scorecard.test.mjs`.

Reste pour la scorecard : préremplir le candidat et la mission dans « Programmer un entretien » (prop à ajouter à `CreateEventModal`) ; le choix du modèle à chaque action (E-51) ; dans la fiche (refonte mission), retirer l'état `mobileProfileOpen` jamais lu et renommer « Scorecard d'entretien » en « Grille d'entretien » (E-31).

Reste pour l'assistant : la carte d'approbation insérée dans le fil sous le message qui la propose (E-36) ; la trace des connecteurs consultés, masquée à dessein après succès (choix figé par `tests/agent/chat-rendering.test.mjs`) ; le choix du modèle réglé une fois dans les Paramètres plutôt qu'à chaque action (E-51).

### Lot 8 · Pages publiques et portails (fait)

Périmètre : accueil (`/`), `/auth`, `/pricing`, `/portal/:token`, `/client/:token`, `/r/:slug`, `/unsubscribe`, `/privacy`, `/privacy-extension`. Composants communs sous `src/components/public/`.

- Coquille publique commune : en-tête (logo qui suit le thème), pied de page (tarifs, confidentialité, mentions légales), écran d'impasse unique qui distingue lien expiré, page introuvable et panne, seule la panne proposant « Réessayer » (F-34, F-48, F-60).
- Accueil : suit le thème du visiteur, kit partout, plus de dégradé ni de pastille, Bricolage Grotesque aux titres et Instrument Sans ailleurs, chiffres non sourcés et témoignage anonyme retirés, démo jouée une fois puis figée, un seul appel principal « Commencer l'essai gratuit » qui ouvre l'inscription, formulaire de contact en ligne (F-35 à F-41, F-43 à F-45).
- « Réserver une démo » devient « Demander une démo » et mène au formulaire de contact (F-33, partiel).
- Connexion : libellés visibles, erreurs traduites, deux boutons du kit de même hauteur (F-46, F-47).
- Tarifs, dans l'intention de la PR #245 : plus de dégradé ni de violet, plan recommandé signalé par un filet et un badge d'accent, action principale monochrome, bascule mensuel ou annuel en segment, erreur avec « Réessayer » (F-49 à F-52).
- Portails : étapes en libellés français, repli neutre, jamais de clé brute ; non-retenus comptés à part ; vouvoiement ; primitives du kit ; score par `ScoreBadge` (F-53 à F-59).
- Profil public et désinscription : une panne propose « Réessayer » au lieu d'un faux « lien invalide » (F-61, F-62).
- Pages légales : un gabarit, une adresse de contact unique (F-63).

Changements de comportement : « Commencer l'essai gratuit » ouvre l'inscription ; le résumé enregistré d'une évaluation client s'écrit « Évaluation de X, note moyenne 4,2/5 » ; les évaluations envoyées depuis le portail sont mémorisées dans le navigateur.

Reste, à fournir par le propriétaire : l'adresse de prise de rendez-vous (F-33) ; l'identité légale des mentions (siège, RCS ou SIREN, capital, directeur de la publication, hébergeur : F-42) ; la confirmation que la boîte `privacy@konekt.io` existe (F-63). Reste côté base : l'étape réelle du candidat dans `get_portal_by_token` (F-54), les évaluations déjà faites renvoyées par `client-portal-data` (F-58), le nom de l'expéditeur dans `handle-email-unsubscribe` (F-62). F-64 (liste des routes publiques de `src/App.tsx`) n'est pas traité : changement d'une ligne proposé à la coquille.

### Lot 9 · Onboarding, invitation, qualification, marketplace (fait)

Périmètre : `/onboarding` et `src/components/onboarding/**`, `WelcomeOnboardingModal`, `CollaboratorWelcome`, `/mission-invite/:token`, `/qualification/:id`, `/marketplace`.

- Acceptation d'invitation : un seul appel par lien (trois auparavant sur un succès), un message par cause (acceptée, expirée, autre adresse, introuvable, session expirée), « Réessayer » pour une panne (B-01, B-72).
- Onboarding : plus d'analyse simulée ni d'attente artificielle, une recherche avec squelette puis la fiche ; plus d'interstitiel, de confettis ni de fond animé ; initiales neutres ; « Continuer » et « Retour » partout (B-62 à B-66).
- Qualification : statut d'enregistrement visible (non enregistré, en cours, enregistré à HH:mm, échec avec « Réessayer »), notes enregistrées 10 s après la frappe, chaque écriture relue ; verdicts « Qualifié », « Non qualifié », « À revoir », « En attente » en groupe radio, sans emoji ; vouvoiement (B-67, B-85 partiel, B-13 et B-30 pour cet écran, E-50 partiel).
- Marketplace : une anatomie de carte, une action par carte, champs du kit reliés à leur libellé, squelettes et états vides, en-tête `PageHeader` (F-26 à F-30, F-31 partiel).
- Tuiles et onglets du kit (B-87, B-88) ; cibles de 44 px sur téléphone.

Reste : l'adresse d'équipe du Cercle partenaires (F-31) ; côté base, l'appel `update-candidate-stage` de la Qualification ne correspond pas au contrat de la fonction (échec désormais signalé par un toast, correction attendue avec la table d'étapes, E-01) ; l'enregistrement automatique des notes repasse une qualification terminée en « en cours » ; `accept-mission-invitation` devrait renvoyer un code d'erreur distinct pour « autre adresse ».

### Lot 10 · Passe texte

Périmètre : toutes les zones du chantier.

Constats : A-06, A-32, A-35, A-46, B-13 et C-05 pour les écrans du chantier, E-37, E-53, et les constats de texte des annexes A, D, E, F.

- Vouvoiement ; français (plus de « step », « preview », « enrollment ») ; boutons en verbe et objet.
- Un nom par page, le même partout où la page est citée (titre, palette, raccourcis, liens) ; la liste est transmise à la barre latérale.
- Typographie française : guillemets « », espace insécable avant les deux points et les points d'interrogation.
- Cliquet : tirets longs, emoji et noms de fournisseurs à zéro dans les zones du chantier.
- Outil : `node scripts/design/texts.mjs` liste, fichier par fichier, le tutoiement et le franglais des textes visibles (le 25 septembre : 85 fichiers, 109 tutoiements, 177 anglicismes, dont une moitié dans les zones de l'autre session).

### Lot 11 · Nettoyage

Après la fusion de la refonte mission : suppression du code mort (G-19), des jetons `--k-*` et `--skalr-*` devenus sans lecteur, des variantes de bouton en double. Le faire plus tôt casserait du code que l'autre session n'a pas encore fusionné.

Code mort déjà repéré : le composant `LinkedInAccountManager` (seule sa fonction `applySubscriptionOverrides` est encore importée), `ICPList` et `ICPFormModal` (jamais montés), `.landing-sky-gradient` et les variables `--landing-*` de `src/index.css` (sans lecteur depuis le lot 8), une image inutilisée (`skalr-logo-concept-3.webp`) et dix icônes 3D déjà orphelines sur `main` (`src/assets/icon-{bell,billing,building,credits,dashboard,integrations,job,profile,settings,team}-3d.{png,webp}`), à retirer après la fusion des sessions en cours. Les six icônes 3D du pipeline et de l'onboarding sont supprimées (lots 7 et 9). `ProxyConfigPanel` n'est plus monté que dans les Paramètres.

## Composants partagés

Existants, à employer partout (les deux sessions) :

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
| Choix exclusif visible (« Mes tâches / Équipe », vues) | `SegmentedControl` (`src/components/ui/segmented-control.tsx`, lot 5) |
| Filtre à choix multiples dans une barre | `FilterPill`, `FilterOption` (`src/components/ui/filter-pill.tsx`, lot 5) |
| Garde des raccourcis clavier globaux | `shouldIgnoreShortcut` (`src/lib/keyboardShortcuts.ts`, lot 5) |
| Canal (nom, logo ou icône) | `src/lib/channels.ts`, `ChannelIcon` (`src/components/ui/ChannelIcon.tsx`, lot 6) |
| Score d'un candidat | `ScoreBadge` (`src/components/ui/score-badge.tsx`), barème `src/lib/scoreScale.ts` (lot 7) |
| Décision sur un candidat, recommandation de l'IA, type d'entretien | `src/lib/verdicts.ts` (lot 7) |
| Étape, statut, raison d'arrêt d'une séquence | `src/lib/sequenceCatalog.ts` ; `SequenceActionIcon`, `SequenceActionLabel`, `EnrollmentStatusBadge`, `ExecutionStatusBadge` (`src/components/outreach/SequenceBadges.tsx`, lot 6) |

Prévus dans les lots, avec leur emplacement, pour éviter deux versions du même composant :

| Besoin | Composant | Lot |
|---|---|---|
| Libellé d'une étape de pipeline | module d'étapes (`src/lib/pipelineStages.ts`) | 7 |
| Statut d'enregistrement | `SaveStatus` (`src/components/ui/save-status.tsx`) | 6 ou 7 |
