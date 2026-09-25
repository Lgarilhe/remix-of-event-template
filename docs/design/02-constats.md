# 02 · Registre des constats

Le registre rassemble les revues du 25 septembre 2026. Sept revues en lecture seule ont relu le code de `main` (commit `5882084`) et les captures du banc visuel, avec pour étalon `01-direction.md` : six par zone de l'application (A à F), une sur le design system lui-même (G). Chaque constat cite sa preuve (`fichier:ligne`, capture ou mesure) et dit s'il était déjà relevé par l'inventaire du 9 septembre (branche `claude/app-details-exhaustifs-s6nf9t`).

Les rapports entiers sont en annexe, dans `docs/design/audit/`. Ce document en garde les chiffres, les motifs communs, tous les constats P1 et tous les constats du design system, avec leur statut.

## Chiffres

| Zone | Annexe | Constats | P1 | P2 | P3 | Destinataire principal |
|---|---|--:|--:|--:|--:|---|
| A. Coquille, tableau de bord, tâches, agenda | `audit/A-coquille-tableau-de-bord-taches-agenda.md` | 57 | 4 | 30 | 23 | chantier design |
| B. Missions et onboarding | `audit/B-missions-onboarding.md` | 90 | 14 | 61 | 15 | refonte mission (onboarding, qualification, invitation : chantier design) |
| C. Sourcing et recherche | `audit/C-sourcing-recherche.md` | 70 | 15 | 48 | 7 | refonte mission |
| D. Outreach et messagerie | `audit/D-outreach-messagerie.md` | 72 | 12 | 45 | 15 | chantier design (onglet Outreach de mission : refonte mission) |
| E. Pipeline, candidats, IA | `audit/E-pipeline-candidats-ia.md` | 53 | 14 | 36 | 3 | chantier design (pipeline de mission et fiche candidat : refonte mission) |
| F. Paramètres, marketplace, pages publiques | `audit/F-parametres-marketplace-public.md` | 66 | 5 | 39 | 22 | chantier design (Paramètres : session « Audit complet du dépôt ») |
| G. Design system | `audit/G-design-system.md` | 21 | 5 | 13 | 3 | chantier design |
| **Total** | | **429** | **69** | **272** | **88** | |

Priorités : P1 pour une information fausse, un parcours cassé, une règle de marque violée, un contraste ou un accès clavier bloquant, un effet décoratif sur l'action principale. P2 pour une incohérence visible ou un état manquant. P3 pour la finition. La revue G notait P0, P1 et P2 : ils sont comptés ici en P1, P2 et P3.

## Les motifs communs

Les 429 constats se ramènent à dix causes. Les traiter à la source règle des dizaines de constats d'un coup : c'est l'objet des lots 1 et 3.

1. **Des jetons qui trahissent le code.** Les variantes `dark:` ne s'appliquaient jamais (Tailwind attendait une classe `.dark` jamais posée), `border-border/40` donnait un CSS invalide en sombre (96 classes), `text-accent` rendait un gris invisible, `--success` et `--info` étaient lus sans exister. Corrigé au lot 1.
2. **Des statuts dessinés pour un seul thème.** Les couleurs de statut avaient la même valeur en clair et en sombre : vert 2,2:1 et ambre 1,9:1 en texte sur fond clair. Les jetons `*-foreground`, faits pour un aplat plein, sont posés sur des teintes à 10 % (1,1:1 à 1,3:1). Jetons corrigés au lot 1 ; les usages `*-foreground` sur teinte se reprennent écran par écran.
3. **Trois registres visuels.** Brutaliste (angles vifs, capitales grasses), SaaS arrondi, éditorial à empattements, parfois sur le même écran.
4. **Des effets décoratifs sur les actions principales.** Dégradé violet-rose animé, reflet, halo, particules, œil animé de l'assistant. Les classes partagées sont neutralisées au lot 1 ; les dégradés écrits en dur et les 123 classes `brand-purple` restent à retirer.
5. **Des erreurs qui se lisent comme des états vides ou des succès.** Tâches (« Zéro tâche en cours » sur une panne), agenda, agents, paramètres, désinscription.
6. **Des actions sans effet ou qui ne font pas ce qu'elles annoncent.** Actions IA de la fiche, coaching, « Envoyer un message » du tableau, « Créer une séquence », inscription depuis la messagerie.
7. **Un vocabulaire produit instable.** Trois tables d'étapes écrivent dans la même colonne, cinq barèmes de score, sept vocabulaires de verdict, aucune couleur stable par canal, statuts techniques affichés bruts (`connection_request`, `ACTIVE`, `REPLIED`).
8. **Le ton.** Tutoiement et vouvoiement dans le même écran, franglais (« step », « preview », « enrollment »), messages serveur bruts, deux noms de fournisseurs visibles (Deepgram, Apollo).
9. **Le clavier et le toucher.** `div` cliquables, actions visibles au seul survol, raccourcis qui captent Entrée sur les boutons, cibles de 22 à 32 px sur téléphone, quatre modales faites main sans rôle ni piège de focus.
10. **Les primitives contournées.** 633 `<button>` faits main, 1 124 tailles de texte arbitraires, 433 couleurs Tailwind brutes, 48 % des `Button` qui surchargent leur hauteur, composants partagés (`PageHeader`, `EmptyState`, `StatTile`) jamais utilisés.

## Les constats P1

Statut tenu à jour à chaque lot (dernier : lot 5). « Lot n » renvoie à `03-lots.md`.

### A. Coquille, tableau de bord, tâches, agenda

| ID | Constat | Statut |
|---|---|---|
| A-04 | Bandeaux d'essai et de crédits rendus sous la barre latérale fixe : « Essai : N jours restants » masqué | corrigé (lot 2) |
| A-23 | Tableau de bord : 48 animations, dont 7 en boucle, sans respect du mouvement réduit | corrigé (lot 4 : plus aucune animation propre au tableau de bord) |
| A-34 | Tâches : une panne affiche « Zéro tâche en cours » et une coche verte | corrigé (lot 5 : erreur et « Réessayer », vérifié sur panne simulée) |
| A-40 | Agenda : une panne affiche un agenda vide | corrigé (lot 5 : erreur et « Réessayer », vérifié sur panne simulée) |

### B. Missions et onboarding

| ID | Constat | Statut |
|---|---|---|
| B-01 | Acceptation d'invitation : après un succès, la page bascule sur « Invitation invalide » (effet relancé) | lot 9 |
| B-02 | Vue d'ensemble : process inventé affiché même quand la mission a le sien | remis à la refonte mission |
| B-03 | Vue d'ensemble : funnel toujours à 0 pour Répondu, Entretien, Offre (colonnes inexistantes) | remis à la refonte mission |
| B-04 | Stepper : phases cochées « terminées » selon leur position, pas leur complétude | remis à la refonte mission |
| B-05 | Liste des missions : le KPI « Réponses » compte des shortlistés | remis à la refonte mission |
| B-06 | « Shortlister » ajoute en statut `untreated` et annonce « shortlisté » | remis à la refonte mission |
| B-07 | Noms de fournisseurs visibles : « Apollo » (badge de source), « Deepgram » (toast de la dictée) | corrigé (lot 3) |
| B-08 | Revue des filtres : modale maison sans rôle, sans piège de focus, voile blanc à 60 % en sombre | remis à la refonte mission |
| B-09 | État vide de /missions : fond animé, particules, bouton dans un bouton, faux logos d'intégration | remis à la refonte mission |
| B-10 | CTA principaux en dégradé animé avec reflet | partiel (lot 1 : aplat indigo sans animation) ; remis à la refonte mission |
| B-11 | Pipeline de mission, tableau : scores illisibles (`*-foreground` sur teinte) | remis à la refonte mission |
| B-12 | Pipeline de mission, tableau : « Envoyer un message » sans effet | remis à la refonte mission |
| B-13 | Tutoiement et vouvoiement dans le même écran | lot 10 (passe texte) et refonte mission |
| B-14 | Process : une étape se supprime d'un clic, sans confirmation | remis à la refonte mission |

### C. Sourcing et recherche

| ID | Constat | Statut |
|---|---|---|
| C-01 | Filets `border-border/60` blancs en sombre (CSS invalide) | corrigé (lot 1) |
| C-02 | Variantes `dark:` jamais appliquées | corrigé (lot 1) |
| C-03 | Bouton de scoring et rapport en dégradé, halo, reflet, shimmer infini | partiel (lot 1 : classes partagées à plat) ; remis à la refonte mission |
| C-04 | `text-accent` invisible (gris de survol) ; quatre systèmes d'accent | corrigé (lot 1) |
| C-05 | Tutoiement et vouvoiement dans le même écran | lot 10 et refonte mission |
| C-06 | Messages serveur bruts à l'écran, dont « Unipile not configured » (règle de marque) | remis à la refonte mission, à traiter en priorité |
| C-17 | Recherche autonome : deux heros successifs, libellés de mission sans mission | remis à la refonte mission |
| C-21 | Sourcing de mission : trois chemins contradictoires pour générer les filtres | remis à la refonte mission |
| C-28 | Bandeau « session LinkedIn instable » illisible en sombre, jargon (« li_at ») | partiel (lot 1 : contraste) ; remis à la refonte mission |
| C-35 | Options avancées : aplats pastel et libellés ambre illisibles en sombre | partiel (lot 1 : variantes `dark:`) ; remis à la refonte mission |
| C-42 | Modale « Élargir » : `*-foreground` sur teinte (1,1:1 à 1,2:1) | remis à la refonte mission |
| C-44 | Vue compacte : aucun chemin clavier vers la fiche d'un profil | remis à la refonte mission |
| C-60 | Scoring par lot : aucune progression conservée, pas d'arrêt | remis à la refonte mission |
| C-61 | Scoring : profils « skip » archivés d'office, sans annulation | remis à la refonte mission |
| C-62 | Anneaux Confiance et Engagement vides : `--success` inexistant | corrigé (lot 1) |

### D. Outreach et messagerie

| ID | Constat | Statut |
|---|---|---|
| D-01 | Frise de conversation : étapes affichées sous leur identifiant technique | lot 6 |
| D-02 | Inscription en séquence inatteignable depuis la messagerie | lot 6 |
| D-03 | Messagerie sur téléphone : aucune action de tri, actions au seul survol | lot 6 |
| D-04 | Badges d'intention illisibles en sombre (variantes `dark:` inertes) | corrigé (lot 1) |
| D-21 | Onglet Outreach : « Créer une séquence » ne fait rien | remis à la refonte mission |
| D-30 | Création de séquence : réglages « Expéditeurs » et « Garde-fous » jamais enregistrés | lot 6 |
| D-31 | Modification de séquence : « Retour » perd les changements sans avertir | lot 6 |
| D-32 | Éditeur : en-tête d'étape en `div` cliquable, inaccessible au clavier | lot 6 |
| D-44 | Préparation : Entrée sur « Enrôler » lance une génération payante | lot 6 |
| D-45 | Préparation : « Enrôler » en dégradé animé, reflet, halo | partiel (lot 1) ; lot 6 |
| D-46 | Préparation : fermer jette les aperçus déjà payés en crédits | lot 6 |
| D-54 | Badges d'exécution illisibles en clair (blanc sur teinte) | lot 6 |

### E. Pipeline, candidats, IA

| ID | Constat | Statut |
|---|---|---|
| E-01 | Le même candidat à trois étapes différentes selon l'écran (trois tables d'étapes) | décision produit (voir plus bas) ; refonte mission et lot 7 |
| E-02 | Fiche ouverte depuis la mission : sélecteur d'étape faux, sans nom accessible | remis à la refonte mission |
| E-03 | Notes « Perso » lisibles par toute l'équipe de la mission | remis à la refonte mission (fiche) ; décision produit sur la confidentialité |
| E-04 | Scorecard : commentaires et verdict perdus au changement d'onglet | lot 7 |
| E-05 | Six suppressions sans confirmation (règle `AlertDialog` de `CLAUDE.md`) | lot 7 pour la scorecard ; remis à la refonte mission pour la fiche (note, commentaire, rappel, tag, contacts) |
| E-06 | Fausse alerte permanente « Manque email / téléphone » | remis à la refonte mission (fiche) |
| E-07 | Bouton « Portail » annoncé pour le client, crée le lien du portail candidat | remis à la refonte mission (fiche) |
| E-08 | Quatre actions IA de la fiche sans effet | remis à la refonte mission (fiche) |
| E-09 | Coaching : boutons sans effet | lot 7 |
| E-10 | « Deepgram » visible (règle de marque) | corrigé (lot 3) |
| E-11 | Scores illisibles en clair | partiel (lot 1 : statuts par thème) ; lot 7 hors mission, refonte mission pour la mission |
| E-12 | `text-accent` invisible (page Agents, outils de l'assistant) | corrigé (lot 1) |
| E-13 | Coaching : textes à 1,06:1 et 1,24:1 (`*-foreground` sur teinte) | lot 7 |
| E-14 | Œil animé de l'assistant, entonnoir à particules, boucles infinies | partiel (lot 1 : mouvement réduit) ; lot 7 |

### F. Paramètres, marketplace, pages publiques

| ID | Constat | Statut |
|---|---|---|
| F-10 | Installation de l'extension : commandes de développeur (`npm run build`) demandées au client | remis à la session Paramètres, décision produit |
| F-33 | Accueil : les quatre « Réserver une démo » ouvrent un agenda générique (`calendly.com/demo`) | lot 8, adresse à fournir |
| F-34 | Logo bleu marine peu lisible sur fond sombre (/auth, /pricing) | partiel (lot 2 : le logo sait suivre le thème) ; lot 8 |
| F-53 | Portail client : étapes brutes (« 📋 dismissed », identifiant) | décision produit (étapes) ; lot 8 |
| F-54 | Portail candidat : étape figée à la création du lien | lot 8, à confirmer en base |

## Les constats du design system (G)

Tous les constats G sont listés : ils portent sur le socle et conditionnent les autres lots.

| ID | Prio | Constat | Statut |
|---|---|---|---|
| G-01 | P1 | 96 classes d'opacité sur des jetons à alpha intégré : CSS invalide en sombre | corrigé (lot 1) |
| G-02 | P1 | `var(--success)`, `var(--info)`, `var(--k-bad)` lus sans exister : courbes et anneaux non tracés | corrigé (lot 1) ; le cliquet compte les variables inconnues depuis le lot 3 (0) |
| G-04 | P1 | 53 variantes `dark:` inertes (texte d'alerte LinkedIn à 1,57:1) | corrigé (lot 1) |
| G-05 | P1 | Statuts à valeur unique pour les deux thèmes ; 290 `text-muted-foreground/NN` sous 4,5:1 | partiel (lot 1 : statuts par thème ; lot 3 : opacités de texte comptées par le cliquet, 484 au départ) ; reprises écran par écran |
| G-06 | P1 | Anneau de focus à 2,3:1 ; `focus:` au lieu de `focus-visible:` dans quatre primitives | corrigé (lot 1) |
| G-03 | P2 | Classes sans CSS généré (`bg-foreground/8`, `w-4.5`, `line-clamp-8`) | corrigé (lot 3) |
| G-07 | P2 | Bouton principal jamais employé, 143 aplats inversés refaits à la main ; `AlertDialogAction` transparent | partiel (lot 1 : `primary` monochrome, `AlertDialogAction` en `primary` ou `destructive`) ; aplats repris dans les lots d'écran |
| G-08 | P2 | Hauteurs : 48 % des `Button`, 71 % des `Input`, 79 % des `SelectTrigger` surchargent la leur | partiel (lot 1 : échelle 28, 32, 36, 40) ; surcharges retirées dans les lots d'écran |
| G-09 | P2 | 1 124 tailles `text-[Npx]`, règle Outfit sur les titres, six familles chargées | partiel (lot 1 : une famille, règle retirée, paliers nommés) ; tailles reprises dans les lots d'écran |
| G-10 | P2 | Deux systèmes de toast ; l'action d'un toast est inopérante quand un dialogue est ouvert | corrigé (lot 1 : thème ; lot 3 : un seul système, toast cliquable par-dessus un dialogue) |
| G-11 | P2 | Aucune échelle de calques ; quatre modales faites main sans rôle ni piège de focus | partiel (lot 1 : calques nommés) ; `SequenceBuilder` et `EnrollmentPreviewModal` au lot 6, `FilterWizard` et `CreateProjectModal` remis à la refonte mission |
| G-12 | P2 | Deux jeux de jetons qui se doublonnent (`--k-*` et shadcn) | partiel (lot 1 : `--k-*` pointent vers les jetons communs) ; usages de la recherche remis à la refonte mission |
| G-13 | P2 | `accent` désigne un gris de survol, `text-accent` écrit en gris | corrigé (lot 1) : `bg-accent` reste le survol, `text-accent` et `border-accent` rendent l'indigo |
| G-14 | P2 | 16 rayons en circulation, cinq dans les seules primitives | partiel (lot 1 : primitives alignées) ; usages repris dans les lots d'écran |
| G-15 | P2 | Mouvement réduit ignoré par 48 fichiers framer-motion | corrigé (lot 1) ; boucles décoratives retirées dans les lots d'écran |
| G-16 | P2 | Ancien dégradé « skalr » et 123 classes `brand-purple` | partiel (lot 1 : classes partagées à plat ; lot 3 : compteur, 158 au départ) ; lots d'écran |
| G-17 | P2 | 433 couleurs de palette brute, dont 76 tuiles d'icône émeraude | partiel (lot 1 : `IconTile` neutre par défaut) ; lots d'écran |
| G-18 | P2 | Pas de primitives d'état : deux `EmptyState`, `ErrorBox` isolé, trois systèmes de chargement | partiel (lot 2 : `EmptyState`, `ErrorState`, `Spinner`) ; adoption dans les lots d'écran |
| G-19 | P3 | Code mort : 16 fichiers de `ui/`, 4 de `layout/`, classes CSS orphelines | lot 11 (après fusion de la refonte mission) |
| G-20 | P3 | Deux bascules de thème désynchronisées, `theme-color` faux | corrigé (lot 2) |
| G-21 | P3 | Contrôles peu visibles : bord de champ 1,44:1, case vide 1,36:1, interrupteur éteint 1,46:1 | partiel (lot 3 : champs, cases et interrupteurs à 3:1 ; onglet actif et item de menu sous 3:1, soumis à la contre-revue) |

## Ce qui attend une décision du propriétaire du produit

- **Une seule table d'étapes de pipeline** (E-01, E-02, F-53, B-06). Aujourd'hui `ATS_STAGES` (français), les colonnes de mission (`sourced`, `messaged`, identifiants d'étapes de process) et les clés du portail client écrivent dans `job_candidate_status.pipeline_stage`. C'est une décision de modèle de données, qui touche la refonte mission.
- **Un seul barème de score** : seuils (70/40, 70/50, 80), dénominateur (/100 ou /5) et couleurs.
- **La confidentialité des notes** (E-03) : notes personnelles réellement privées, ou libellé « Notes de l'équipe ».
- **L'adresse de prise de rendez-vous** de la page d'accueil (F-33).
- **La distribution de l'extension Chrome** (F-10) : lien du Chrome Web Store, ou retrait du dialogue.

## Remis à la session « Audit complet du dépôt »

Cette session mène la refonte de l'expérience mission, de la barre latérale et des Paramètres, sur du code pas encore fusionné. Le chantier design ne modifie pas ces écrans et lui remet :

- **Refonte mission** : les constats B sur la liste des missions, la création et l'espace mission ; tout C ; D-21, D-28, D-52, D-61, D-63 ; E-01 à E-03, E-05 (fiche), E-06 à E-08, E-29 à E-31, E-41, E-42, E-49, E-52 ; G-11 pour `FilterWizard` et `CreateProjectModal`. Les annexes B, C et E donnent pour chaque écran les changements à viser.
- **Paramètres** : les 26 constats de `/settings` de l'annexe F, dont F-10 ; D-64 (webhooks).
- **Barre latérale et en-tête** : A-01, A-03, A-15 et A-18 à A-21 (bande d'en-tête vide, cibles tactiles, aide contextuelle, textes de 9 et 9,5 px, couleur en dur, couleur des compteurs).

Les lots 1 à 3 profitent déjà à ces zones : jetons, contrastes, variantes `dark:`, primitives, classes décoratives à plat.
