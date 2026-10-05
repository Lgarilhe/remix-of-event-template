# LOGBOOK.md — Journal de bord Konekt AI Platform

Un entry par décision, spec, insight, ou action majeure. Ajouté en fin de chaque conversation pro importante avec Claude Code. Du plus récent en haut.

**Format strict** : date ISO, type, titre, corps. Pas de padding, pas d'emoji dans les titres, pas de "j'ai fait" — seulement le fait.

---

## Template d'entry

```markdown
## AAAA-MM-JJ — <TYPE> — <Titre court>

**Contexte** : 1-2 phrases.
**Décision / Fait** : ce qui a été tranché ou livré.
**Raison** : pourquoi (si non évident).
**Impact** : fichiers touchés, modules, users concernés.
**Reste à faire** : bullets courts. `[ ]` ouvert, `[x]` fait.
**Refs** : commit SHA, ticket, URL Notion, page Airtable.
```

**Types autorisés** :
- `DECISION` — choix d'architecture, de lib, de process
- `SPEC` — nouvelle feature spécifiée (sortie de /spec)
- `SHIP` — déploiement (staging ou prod)
- `INSIGHT` — apprentissage, gotcha, surprise technique
- `BUG` — bug identifié (ouvert ou fermé)
- `REFACTOR` — restructuration significative
- `SECURITY` — finding sécurité (audit, fix, alerte)
- `ROLLBACK` — retour arrière
- `MEETING` — synthèse d'une discussion externe (client, équipe)

---

## 2026-10-05 — SHIP — Design simplifié, lot Suite 2 : la messagerie

**Contexte** : deuxième écran du lot « Suite » de `docs/design/06-simplicite.md`, après le Pipeline global (#286). La messagerie avait déjà sa revue (lot 6a), mais gardait des pastilles colorées sur chaque ligne (étiquette, intention, non-lus, logo LinkedIn sur chaque visage), « À répondre » en couleur de marque, un bouton « Actualiser », des comptes « (0) » dans les filtres, cinq boutons de mise en forme dans le composeur et un cadre pointillé autour du panneau vide.
**Décision / Fait** :
- Colonne des conversations : titre de page à 28 px ; plus d'« Actualiser » (la liste se relit déjà toutes les 30 s, `useMessagesInbox`), ni dans l'en-tête ni dans l'état vide ; bascule « Toutes / À répondre / En attente » de la page mission (`SegmentedControl` quiet) ; filtres sans compte.
- Lignes : étiquette posée à la main ou intention lue par l'IA en texte discret, sans pastille ni couleur ; « À répondre » en orange (un candidat attend) ; les non-lus en gras, sans pastille chiffrée, le nombre restant lu par les lecteurs d'écran ; liste repliée : un point orange. Le logo LinkedIn ne se pose plus sur chaque visage : seul un autre canal se signale.
- Conversation : l'état de l'inscription s'écrit en mots à côté du nom (`EnrollmentStatusBadge`, nouvelle option `plain`, même libellé que la pastille) ; « Inscrire dans une séquence » en bouton discret ; le panneau « Sélectionnez une conversation » sans cadre.
- Composeur : la mise en forme tient dans son menu à toutes les tailles, raccourcis rappelés et toujours actifs ; le nombre de suggestions en texte neutre ; « Envoyer » reste le seul bouton plein. Suggestions rapides de 44 px au doigt.
**Raison** : règles 1, 2, 3, 7 et 8 du design simplifié. Mesures du banc, neuf conversations simulées (réponses LinkedIn et IA remplacées, quatre analyses et une étiquette posées le temps des mesures puis retirées), ordinateur 1 440 px : liste, 25 puis 24 contrôles, textes colorés 6 puis 3 (les seuls « À répondre »), cadres 1 puis 0 ; conversation ouverte, 49 puis 44 contrôles, textes colorés 7 puis 2. Sur téléphone, conversation ouverte : textes colorés 2 puis 0. Dix logos LinkedIn et trois pastilles de non-lus en moins sur la liste.
**Impact** : `src/components/outreach/inbox/` (`ChatListSidebar`, `ChatListItem`, `MessageView`, `MessageComposer`, `SmartReplies`), `MessagesInbox.tsx` (plus de comptes de statut passés à la liste), `SequenceBadges.tsx` (option `plain`, rendu par défaut inchangé). Aucune lecture ni écriture ne change. Tests : `tests/ux/messagerie-simplicite.test.mjs` (8 tests, nouveau, rendu statique des lignes), `tests/ux/lot6a-messagerie.test.mjs` mis à jour (D-04 : étiquettes en texte ; D-13 : mise en forme dans un menu).
**Recette `qa.md`** (banc local, base inchangée avant et après) :
| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Liste prête en 2,6 s (9 conversations) ; onglets À répondre 6, En attente 3 ; recherche « Sarah » : 1 ; menu Filtres (Statut, Étiquette, Boîte LinkedIn) sans compte ; conversation ouverte, suggestion insérée dans le composeur, menu « Mise en forme » à 5 outils, « Inscrire dans une séquence » ouvre son dialogue ; aucun envoi | PASS |
| Claire | Aucun terme technique ni nom de fournisseur, liste et conversation ; un seul bouton plein : « Envoyer » | PASS |
| Théo | Messagerie vide : l'état vide seul, sans « Actualiser » ni zéro ; lecture en échec : erreur avec « Réessayer » ; nom très long avec emoji et texte de droite à gauche : aucun débordement (liste, en-tête) | PASS |
| Sophie | Téléphone 390 px tactile : aucun contrôle sous 44 px (liste, conversation), menu « Mise en forme » à 44 px | PASS |
**Reste à faire** :
- [ ] Paramètres (Suite 3), après #260 et #262.
- [ ] Bulles envoyées en aplat sombre : à revoir avec le propriétaire, hors des huit règles.
- [ ] Le banc visuel (`scripts/design/capture.mjs`) ne simule pas de conversation : la messagerie y reste vide.
**Refs** : docs/design/06-simplicite.md (lot Suite), #286.

---

## 2026-10-05 — SHIP — Design simplifié, lot Suite 1 : le Pipeline global

**Contexte** : premier écran du lot « Suite » de `docs/design/06-simplicite.md` (Pipeline global, messagerie, Paramètres, mêmes règles, sans maquette). Le /pipeline gardait l'ancien langage : six tuiles de chiffres au-dessus de toutes les vues, quatre menus de filtres et « Avec rappel », colonnes et cartes encadrées, note en pastille colorée par niveau, statut de séquence en pastille, tableau à huit colonnes, chronologie et analyse en cartes.
**Décision / Fait** :
- En-tête : une phrase chiffrée (« 28 candidats dans 4 missions ») et « Rappels » en bouton discret. Plus d'« Actualiser » : la liste se relit au retour sur l'onglet (`refetchOnWindowFocus` de `useATSData`).
- Une rangée : la recherche, un seul menu « Filtres » (étape ; source s'il y en a plusieurs ; mission ; étiquettes ; « Avec rappel »), puis la bascule d'affichage de la page mission (`SegmentedControl`, nouvelle variante `quiet`, icônes seules sur téléphone). Sans candidat, ni filtres ni bascule.
- Colonnes au style du kanban de la page mission : fond de carte sans bordure, effectif écrit seulement s'il n'est pas nul, colonne vide muette sauf pendant un glisser (« Déposer ici »). Cartes : visage, nom, note en anneau (`ScoreRing`, nouveau, même rendu que la page mission), mission en texte, signal en texte (statut de séquence lu dans `sequenceLabels`), orange seulement pour un candidat bloqué.
- Tableau sans cadre, six colonnes au lieu de huit : la provenance passe sous la mission (« Séquence Approche Lead, en cours », « InMail »), la note en anneau, les liens au survol.
- Chronologie : lignes sans cadre ni pastille, une ligne de texte (étape, étape d'entretien, mission, séquence).
- Les chiffres passent dans l'onglet Analyse, sur fond doux, sections séparées par un filet. Aucun chiffre à zéro : « Jours dans l'étape » attend un candidat engagé, « Sans mouvement » un candidat bloqué, « Taux de réussite » une sortie. Goulots « Critique » en rouge, « À surveiller » en orange, écrits en texte.
- Au doigt, chaque contrôle a 44 px : en-têtes triables, noms et missions du tableau, liens de profil et d'e-mail, mission de la chronologie.
- Pagination du tableau et de la chronologie (#278, #282, arrivées sur `main` pendant le lot) : barre sans cadre sous un filet, Précédent et Suivant en boutons discrets de 44 px au doigt.
**Raison** : règles 1 à 8 du design simplifié. Mesures du banc contre `main` (pagination comprise), mêmes données, ordinateur 1 440 px :
| Vue | Contrôles | Cadres | Textes colorés | Zéros | Hauteur |
|---|---|---|---|---|---|
| Colonnes | 123 → 119 | 48 → 28 (les cartes) | 40 → 8 | 4 → 0 | 999 → 900 px |
| Tableau | 93 → 88 | 7 → 0 | 38 → 6 | 0 → 0 | 2 022 → 1 758 px |
| Chronologie | 63 → 59 | 32 → 0 | 0 → 0 | 0 → 0 | 3 084 → 2 591 px |
| Analyse | 20 → 13 | 16 → 0 | 5 → 5 | 3 → 0 | 1 553 → 1 318 px |
Sur téléphone (390 px), la page passe de 2 013 à 1 614 px en colonnes, de 2 370 à 1 968 px en tableau, de 4 566 à 3 861 px en chronologie, de 2 855 à 2 302 px en analyse.
**Impact** : `src/pages/ATS.tsx` ; `src/components/ats/` : `ATSFilters`, `ATSStats`, `ATSDroppableColumn`, `ATSKanban`, `ATSKanbanSkeleton`, `ATSCandidateCard`, `ATSTable`, `ATSTableSkeleton`, `ATSTimeline`, `ATSPagination`, `ATSPipelineAnalytics`, `ATSStatsSkeleton.tsx` supprimé ; kit : `src/components/ui/score-ring.tsx` (nouveau), `segmented-control.tsx` (variante `quiet` et `iconsOnlyOnPhone`, rendu par défaut inchangé). Aucune lecture ni aucun calcul de chiffre ne change. Tests : `tests/ux/pipeline-simplicite.test.mjs` (11 tests, nouveau), `tests/ux/lot7a-pipeline.test.mjs` mis à jour (anneau, menu « Filtres », six colonnes).
**Recette `qa.md`** (banc local) :
| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Colonnes prêtes en 2,5 s ; Tableau (six colonnes, `?view=table`, 25 lignes puis « 26 à 28 sur 28 »), Chronologie, Analyse, retour aux Colonnes au clavier ; menu « Filtres » (Étape, Mission, Rappel) : À trier, 28 puis 5 cartes, puis filtres effacés ; recherche « Inès » : 1 carte ; Rappels, fiche et « Déplacer vers… » (10 étapes) s'ouvrent ; aucune écriture en base | PASS |
| Claire | Aucun terme technique ni nom de fournisseur sur les quatre vues ; « Rappels » visible sans défiler | PASS |
| Théo | Compte vide : l'état vide seul, sans filtres, bascule ni zéro ; lecture en échec : erreur avec « Réessayer » ; nom très long avec emoji et texte de droite à gauche : aucun débordement (colonnes, tableau, chronologie) | PASS |
| Sophie | Téléphone 390 px tactile : aucun contrôle sous 44 px sur les quatre vues, zone élargie comprise, aucun débordement ; options du menu « Filtres » de 44 à 62 px, menu dans l'écran | PASS |
**Reste à faire** :
- [ ] Messagerie (Suite 2), puis Paramètres (Suite 3, après #260 et #262).
- [ ] `ScoreBadge`, coloré par niveau, reste hors du Pipeline (fiche de mission du /pipeline, scorecard, qualification, portail client, préparation d'envoi, assistant) : à passer à l'anneau au fil des lots.
**Refs** : docs/design/06-simplicite.md (lot Suite).

---

## 2026-10-05 — SHIP — Design simplifié, lot P : copie privée des photos des candidats

**Contexte** : les visages des candidats viennent du lien de photo LinkedIn enregistré sur leur ligne du pipeline (`linkedin_profile_data`). LinkedIn signe ces liens et les fait expirer : quelques semaines après la recherche, le visage redevient des initiales. Décision du propriétaire (« Copie privée ») : Konekt garde une petite copie, supprimée avec le candidat.
**Décision / Fait** :
- Bucket privé `candidate-photos` (200 ko, JPEG, PNG ou WebP) et table `candidate_photos`, une ligne par organisation et candidat. Lecture par les membres de l'organisation, écriture par la clé de service seulement.
- `capture-candidate-photos`, lancée toutes les deux minutes par pg_cron, copie 25 photos par passage. Le registre RGPD est lu avant tout téléchargement ; seules les photos LinkedIn sont prises, sans suivre de redirection, type lu sur les octets. Un lien refusé (403, 404, 410) n'est repris que s'il change ; un autre échec est retenté trois fois, à une heure d'écart. Le profil LinkedIn n'est lu que pour 100 candidats au plus par passage, et un candidat examiné n'est relu qu'après un changement de sa ligne : sans cela, chaque passage relisait tous les profils du pipeline. Un candidat sorti du pipeline de l'organisation perd sa copie au passage suivant.
- Effacement RGPD (`recordGdprErasure`, étape 10) : fichiers supprimés, lignes marquées `erased`, jamais reprises. `export-org-data` exporte la table.
- Écran : `PersonAvatar` reçoit `candidateId` et montre la copie, sinon le lien LinkedIn, sinon les initiales. Les adresses sont signées par lots de 100 et valent une heure ; celles des visages encore affichés sont redemandées cinq minutes avant la fin. Une réserve par personne connectée (`CandidatePhotosProvider`). Écrans branchés : page mission (liste, À trier, kanban, fiche), /pipeline (kanban, tableau, chronologie), accueil, liste des missions, Tâches, agenda, scorecard. Les sources en direct (recherche, messagerie, invitations) ne changent pas.
**Impact** : migration `20261005121536_photos_candidats_copie_privee.sql` ; `supabase/functions/capture-candidate-photos/`, `_shared/candidate-photo.ts`, `_shared/get-or-fetch-contact.ts`, `export-org-data` ; `src/lib/candidatePhotos.ts`, `src/components/CandidatePhotosProvider.tsx`, `person-avatar.tsx`, `types.ts` et les écrans cités. Tests : `tests/c1/photos-copie-privee.test.mjs` (14), audit `supabase/tests/candidate_photos_audit.sql` (17 contrôles, CI e2e, avec les appels anonymes refusés par l'API). La fusion touche `_shared/` : toutes les fonctions sont redéployées, `resolve-client-logo` comprise.
**Recette `qa.md`** (banc local) :
| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Lien LinkedIn simulé en 404 : le kanban montre la copie ; copie affichée 27 ms après le nom ; passage à la vue par étape sans nouvelle lecture | PASS |
| Claire | Aucun terme technique ni nom de fournisseur sur la page mission, /pipeline, l'accueil et Tâches ; aucune copie cassée | PASS |
| Théo | Autre organisation : 0 ligne, signature refusée, dossier vide ; envoi et suppression de fichier refusés ; écriture de la table refusée (42501) ; adresse publique 400 ; appel anonyme 401 ; tâche sans secret 403 | PASS |
| Sophie | Téléphone 390 px tactile : copie affichée, aucun débordement | PASS |
**Reste à faire** :
- [ ] Rattrapage, par LinkedIn, des candidats sans photo enregistrée ou au lien déjà expiré : plus tard, avec l'accord du propriétaire.
- [ ] Effacement RGPD des profils (`linkedin_profile_data`) et des CV : lot à part.
- [x] Première heure suivie après la fusion, en lecture seule : 114 copies `stored`, 670 `expired` (liens LinkedIn déjà échus), 433 candidats sans lien de photo, 1 photo trop lourde, aucune copie en échec ni en attente ; 32 passages, dont 6 où l'appel de pg_net a expiré à 5 s, sans effet sur les copies.
**Refs** : #271, docs/design/06-simplicite.md (lot P).

---

## 2026-10-05 — BUG — Logos des clients : la fonction n'avait pas d'entrée dans config.toml

**Contexte** : `resolve-client-logo` (#261) est arrivée sans entrée `[functions.resolve-client-logo]` dans `supabase/config.toml`. Le déploiement lit cette configuration : sans entrée, la fonction part avec `verify_jwt = true`, et la passerelle refuse les jetons ES256 des sessions. Les appels de `useClientLogoBackfill` échouaient donc sans bruit (l'erreur est avalée), et les logos des clients ne s'enregistraient probablement pas en production.
**Décision / Fait** : entrée `verify_jwt = false` ajoutée, comme pour toutes les fonctions (l'authentification se fait dans la fonction, `requireAuth`). Garde dans `tests/c1/c1-fonctions.test.mjs` : chaque dossier de `supabase/functions/` a son entrée, `verify_jwt = false` sauf `submit-application` (neutralisée au lot C1, exception documentée).
**Impact** : `supabase/config.toml`, `tests/c1/c1-fonctions.test.mjs`. Le déploiement automatique ne se déclenche que sur `supabase/functions/**` : après fusion, redéployer la fonction à la main (workflow « Deploy Supabase Edge Functions », cible `resolve-client-logo`).
**Reste à faire** :
- [x] Redéployer `resolve-client-logo` après fusion : fait le 05/10/2026 à 13:32 UTC par le déploiement de #270.
**Refs** : #261.

---

## 2026-10-05 — SHIP — Design simplifié, lot T : la page Tâches comme la maquette

**Contexte** : troisième écran du design simplifié (`docs/design/06-simplicite.md`), après l'accueil. La page Tâches suit la maquette « Konekt simplifié » : sept contrôles de filtre, une liste encadrée, des dates en rouge sur chaque ligne et une corbeille par ligne. Sur le banc, huit suggestions passaient avant les tâches : sur téléphone, la première tâche arrivait à 1 408 px du haut de la page.
**Décision / Fait** : un seul bouton plein (« Nouvelle tâche », plus d'« Actualiser ») ; Mes tâches / Équipe et En cours / Toutes, puis un seul menu « Filtres » (catégorie, mission, origine), comme la messagerie. Listes sans cadre ; « En retard » en rouge sous le réveil qui sonne, les dates des lignes sans couleur. Chaque ligne montre le visage du candidat (photo enregistrée, sinon initiales), sinon le logo du client de la mission enregistré depuis #261 (sinon ses initiales), avec un seul lien : la fiche du candidat, sinon la mission (adresse sans `project:`, l'ancien lien de mission était cassé). La mission s'écrit avec son client ; le nom du candidat n'est pas répété s'il est déjà dans le titre. La corbeille apparaît au survol, au clavier, et reste visible sur un écran tactile. Les suggestions passent sous la liste, avec le visage du candidat, trois au plus et les autres à la demande ; « Créer la tâche » devient un lien. Sous-titre sans zéro. La liste se relit au retour sur l'onglet (`refetchOnWindowFocus`), faute de bouton « Actualiser ».
**Raison** : règles 2, 3, 4, 5, 7 et 8 du design simplifié. Mesures du banc, mêmes données : 45 contrôles avant, 28 après (corbeilles comprises) ; première tâche à 802 px puis 215 px sur ordinateur, à 1 408 px puis 387 px sur téléphone ; page de 1 169 px puis 908 px sur ordinateur.
**Impact** : `src/pages/Tasks.tsx`, `src/components/tasks/TaskList.tsx` (nouveau : sections, lignes, suggestions, sans lecture), `TasksFiltersBar.tsx`, `useAllReminders.ts` ; les tâches de mission de l'accueil prennent aussi le logo du client (`Dashboard.tsx`, `DashboardTodayPanel.tsx`) ; test `tests/ux/taches-simplicite.test.mjs` (13 tests, job Build de la CI).
**Recette `qa.md`** :
| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Lien de ligne vers la fiche, case cochée puis décochée sur place, filtre choisi puis effacé, vue Toutes, suggestions dépliées, confirmation de suppression ; page prête en 2,2 s | PASS |
| Claire | Aucun terme technique ni nom de fournisseur ; « Nouvelle tâche » en haut sans défiler ; suppression par fenêtre de confirmation en français | PASS |
| Théo | Compte vide : état vide, aucun zéro, aucune section vide ; lecture en échec : erreur avec « Réessayer » ; titre très long, emoji et texte de droite à gauche sans débordement | PASS |
| Sophie | Écran tactile 390 px : 38 contrôles, aucun sous 44 px, aucun débordement ; options du menu Filtres à 44 px ; fenêtre de suppression dans l'écran | PASS |
**Reste à faire** :
- [ ] Les suggestions créées ne portent ni mission ni client (l'insertion n'écrit pas `job_id`) : la ligne montre le candidat seul.
- [ ] Bandeau d'essai (hors page Tâches) : « Choisir un plan » (20 px) et « Fermer le bandeau » (36 px) restent sous 44 px sur téléphone.
- [x] Les gardes `lot0c-lectures` (0c-1, jouée par la CI) et `lot12-sourcing` (S-7), cassées sur `main` par le commit 2148cfab (/sourcing refait) : alignées sur la nouvelle page par la PR #264.
**Refs** : docs/design/06-simplicite.md (lot T), maquette « Konekt simplifié ».

## 2026-10-05 — INSIGHT — Spike S1 : le CDN d'images sert la sortie réseau de la base

**Contexte** : le propriétaire a donné son accord pour S1 (télécharger une vingtaine de vraies photos pour savoir si le CDN répond à un centre de données). Le proxy du poste de développement refuse le CDN et le domaine Supabase, donc l'essai est parti de la base de production par `pg_net`.
**Décision / Fait** : 25 adresses valides tirées au hasard (20 petites, 5 grandes), tirées et lancées en SQL sans que la session lise une adresse, sans cookie ni `Referer`, plage d'octets 0-4095. 25 réponses sur 25 en 206, 24 JPEG et 1 PNG. Petites : 1,4 à 41 ko (médiane 5,3 ko) ; grandes : 25 à 131 ko et un PNG de 846 ko. Chemin identique pour 64 des 71 candidats relus avec des adresses différentes. Lignes de réponse de l'essai supprimées ensuite.
**Raison** : la copie côté serveur du lot P dépend de cette réponse ; sans elle, le plan B (image du prestataire de messagerie) s'imposait.
**Impact** : `docs/design/07-photos-lot-p.md` (S1, risques, porte d'activation de P-4). Aucun code, aucune fonction déployée, aucune donnée conservée.
**Reste à faire** :
- [ ] Confirmer depuis une fonction au premier lot de P-4 (la sortie réseau de la base n'est pas celle des fonctions).
- [ ] Les côtés réels en pixels ne sont pas mesurés : la garde lira les octets de tête.
**Refs** : docs/design/07-photos-lot-p.md (P-0, S1).

---

## 2026-10-05 — SHIP — P-0b, garder les adresses de photo fraîches (sur la branche, pas encore sur main)

**Contexte** : première étape du lot P, demandée par le propriétaire (« Oui lance »). Les adresses de photo LinkedIn expirent après quelques semaines et une recherche qui retrouvait une personne connue n'écrivait pas son adresse fraîche.
**Décision / Fait** : migration `20261005102025_photos_lot_p0b_rafraichir_adresses.sql` (`refresh_candidate_pictures`, `candidate_picture_expiry`, `candidate_picture_is_stale`, `candidate_picture_should_replace`) ; `batchDiscover` rafraîchit les adresses des profils de la page ; la découverte garde la grande photo ; la fiche garde la photo en enregistrant le profil visité ; « Retenir » et l'inscription en séquence créent leur ligne avec le profil entier. Fusion jsonb côté base, lignes de l'appelant, profil existant seulement, aucune écriture si l'adresse enregistrée est bonne.
**Raison** : 82 % des adresses stockées sont expirées ; sans cette étape, le visage du Pipeline revient aux initiales. Un profil réduit à une photo aurait rendu la ligne éligible à la notation de fond, d'où le profil entier.
**Impact** : `supabase/migrations`, `src/lib/pictureUrl.ts`, `src/hooks/useJobCandidateStatus.ts`, `useLinkedInSearchActions.ts`, `useLinkedInScoring.ts` (export), `ProfileDetailSheet.tsx`, `EnrollmentPreviewModal.tsx`, `AddToProjectButton.tsx`, `CardActions.tsx`, `types.ts`, audit SQL et `e2e.yml`, tests, `CLAUDE.md`, plan du lot P. Coût mesuré en local : 200 lignes en 224 ms, 200 appels d'ingestion en file, aucun recalcul d'embedding. Dates : les entrées et documents du lot P portaient à tort le 6 octobre, corrigés au 5.
**Reste à faire** :
- [ ] Accord du propriétaire pour pousser sur main (migration appliquée par le workflow, puis relever la part des lignes du Pipeline à adresse valide, 3 % avant).
- [ ] Spike S1 (télécharger une vingtaine de vraies photos) : demande l'accord du propriétaire, à lancer avant le 22/10/2026.
- [ ] Deux tests déjà en échec sur main (`0c-1 : recherches, résumé du matin et tableau de bord disent « au total »`, `S-7 : seule la nouvelle page passe la disposition « mission-v3 »`), venus du commit 2148cfa.
**Refs** : docs/design/07-photos-lot-p.md (P-0b).

---

## 2026-10-05 — SPEC — Plan du lot P, copie privée des photos des candidats

**Contexte** : le propriétaire demande de préparer le lot P (copie privée des photos LinkedIn, supprimée avec le candidat) après la mise en ligne des visages. Quatre enquêtes en lecture seule (captures, RGPD, stockage, modèle de données) et des comptages sur la production, puis relecture du plan par deux relecteurs.
**Décision / Fait** : plan écrit dans `docs/design/07-photos-lot-p.md` : table `candidate_photos` par organisation et personne, bucket privé `candidate-photos`, liens signés d'une heure, déclencheur d'enfilage et worker de copie sans appel LinkedIn, effacement et purge branchés avant la première copie, sous-lots P-0 à P-7 (P-3 en deux parties). Aucun code livré. Deux relectures indépendantes ont corrigé le premier jet : trace d'effacement (ligne `erased`), course entre effacement et copie, verrou de réclamation, boîte d'envoi des suppressions de fichiers, droits par colonne, périmètre de la copie.
**Raison** : les mesures du 05/10/2026 montrent que 82 % des adresses de photo stockées sont déjà expirées (durée médiane 20 jours entre la création d'une ligne et l'expiration), que 35 des 1 011 personnes du Pipeline ont une adresse valide et que 585 n'en ont aucune ; 27 % des adresses du Pipeline sont déjà expirées à la dernière écriture de la ligne. La copie doit donc se faire au moment où l'adresse est fraîche, et une première étape (P-0b) ferme les pertes d'adresse du navigateur. `rgpd-purge` n'est planifiée nulle part et l'effacement RGPD laisse l'adresse de la photo dans le profil de la ligne.
**Impact** : `docs/design/07-photos-lot-p.md`, `docs/design/README.md`, `docs/design/06-simplicite.md`.
**Reste à faire** :
- [ ] Décisions D1 à D12 du plan (périmètre, durée, planification de `rgpd-purge`, lecture de profil LinkedIn, export des fichiers).
- [ ] Spike S1 avant le 22/10/2026 : tant qu'il reste des adresses valides, vérifier que le CDN répond à une fonction Supabase.
- [ ] Questions au juriste (section 10 du plan).
**Refs** : docs/design/07-photos-lot-p.md.

---

## 2026-10-05 — REFACTOR — Visages des candidats dans le /pipeline global

**Contexte** : après les photos de la page mission, le propriétaire demande les visages dans la partie Pipeline. Le /pipeline global (kanban, tableau, chronologie) n'affichait aucun visage : sa lecture de `mission_candidate_rows` ne portait pas la photo.
**Décision / Fait** : `MCR_DISPLAY_COLUMNS` extrait la photo côté base (`picture`, `picture_large`), `candidateOfMissionRow` la range dans `ATSCandidate.pictureUrl`, et la carte du kanban (28 px), le tableau et la chronologie (32 px) la passent à `PersonAvatar` ; sans photo ou avec un lien expiré, les initiales. Un candidat de séquence ou d'InMail sans ligne de mission n'a pas de photo.
**Raison** : même règle 4 du design simplifié. Mesure sur la base de production le 05/10/2026 (comptages seuls) : 2 375 lignes, 1 551 avec une photo enregistrée (65 %), profil de 9 ko en moyenne, donc la lecture avec la liste reste bon marché. Les candidats sans photo enregistrée gardent leurs initiales tant que le lot P n'a pas rattrapé les profils.
**Impact** : `useATSData.ts`, `ATSCandidateCard.tsx`, `ATSTable.tsx`, `ATSTimeline.tsx` ; test statique `tests/c1/lot0c4-pipeline.test.mjs` (regex des colonnes adaptée à la chaîne typée `string`, TS2589) ; scénario e2e « les visages » de `e2e/flows/stage-0c-lectures.spec.ts` (photo, initiales, lien expiré, carte attrapée par sa photo, tableau, chronologie).
**Reste à faire** :
- [ ] Lot P : copie privée des photos, rattrapage des profils sans photo, effacement RGPD, purge, export.
**Refs** : docs/design/06-simplicite.md (lot P).

---

## 2026-10-05 — REFACTOR — Refonte mission, photos des candidats sur la page mission

**Contexte** : retour du propriétaire après le lot M : des pastilles avec la photo des gens, plus lisibles que des initiales. `PersonAvatar` savait déjà afficher une photo ; la page mission ne lui passait que le nom (le Sourcing, la liste des missions et l'accueil passaient déjà la photo).
**Décision / Fait** : la liste de Pipeline, la section À trier, le kanban et l'en-tête de la fiche affichent la photo LinkedIn déjà enregistrée dans `linkedin_profile_data`, sinon les initiales (aussi pour un lien expiré ou une image qui ne charge pas). `MISSION_ROW_LIGHT_COLUMNS` extrait la photo côté base (`picture`, `picture_large`), jamais le profil entier ; `MissionCandidateRow.pictureUrl` en dérive. Kanban : carte en deux rangées (visage, nom et anneau, puis l'action sur toute la largeur), colonnes de 190 à 224 px, pastille sur le fond de la page pour ne pas se fondre dans la carte. Fiche : photo de la ligne, sinon du profil déjà chargé par la fiche (`candidatePictureUrl`) ; nom sur deux lignes, « N sur M » sous le nom sur téléphone. `PersonAvatar` : `draggable={false}`, comme les autres images du dépôt.
**Raison** : règle 4 de `docs/design/06-simplicite.md` (chaque ligne montre de qui elle parle) ; aucune nouvelle donnée stockée.
**Impact** : `v3/types.ts`, `v3/pipeline/{CandidateListRow,MissionBoard}.tsx`, `v3/panels/CandidatePanelHeader.tsx` ; tests `tests/ux/lot12-mission-beta.test.mjs`, `lot12-pipeline.test.mjs`, scénario e2e « Visages » de `e2e/flows/mission-v3.spec.ts` (photo, repli sur la grande photo, sans photo, lien expiré). Mesure sur la base locale : 2000 lignes de 25 ko de profil, lecture du kanban 17 ms avec ou sans la photo.
**Reste à faire** :
- [ ] Lot P : copie privée des photos (les adresses LinkedIn expirent ; sans copie, les initiales reviennent avec le temps), effacement RGPD, purge, export.
- [ ] Visage dans la carte « Maintenant » (le candidat qui attend) et vrais logos dans le menu des missions.
**Refs** : docs/design/06-simplicite.md (lot P).

---

## 2026-10-05 — REFACTOR — Refonte mission, en-tête de mission et liste des missions allégés

**Contexte** : fin du lot M du design simplifié (`docs/design/06-simplicite.md`) après le Pipeline, le Cadrage et le Sourcing (en ligne sur main depuis ef4d33b). Même méthode : un agent par écran, trois relectures indépendantes (règles de design, non-régression, accessibilité), correction, puis vérification complète.
**Décision / Fait** : en-tête avec le logo du client, statut sans cadre ni point de couleur (déplacé à droite), un seul « Réactiver » sur une mission archivée. Liste des missions avec logo du client, visages des candidats en entretien, aucun zéro écrit, colonnes d'effectifs à partir de 1280 px, menu de ligne au survol, au focus ou au toucher.
**Raison** : zéros partout, « à l'instant » répété sur chaque ligne, aucun logo, pastille de statut encadrée, « Réactiver » en double.
**Impact** : `src/components/missions/v3/shell/**`, `v3/panels/ContactPanel.tsx` (une prop, pour garder un « Réactiver » atteignable dans le panneau plein écran), `outreach/projects/ProjectsListV2.tsx` et ses deux voisins (`missionListFormat.ts`, `useInterviewingPeople.ts`), tests c1 et ux, `e2e/flows/mission-v3.spec.ts`, `stage-0c-lectures.spec.ts`. Aucun calcul de chiffre ne change. Un test du 04/10 (`mission-now`, scénario 10) dépendait de l'heure (7 j avant midi à Paris, 8 j après) : assertion rendue tolérante.
**Reste à faire** :
- [ ] État vide de /missions (`EmptyMissionState`, ancien langage : majuscules, cartes, chiffres marketing).
- [ ] « Réessayer » de `ErrorState` reste un bouton plein à côté de « Nouvelle mission » (composant partagé).
- [ ] Menu des autres missions : le logo n'a que des initiales (les lignes de la barre latérale n'ont pas l'adresse du logo).
- [ ] Photos réelles à la place des initiales (lot P).

---

## 2026-10-04 — REFACTOR — Refonte mission, Cadrage et Sourcing allégés

**Contexte** : suite de l'allègement du Pipeline (retour « trop chargé, on comprend mal »), mêmes règles (`docs/design/06-simplicite.md`, lot M). Travail mené par deux agents en parallèle (un par écran), relu par trois angles indépendants (règles de design, non-régression, accessibilité), puis corrigé.
**Décision / Fait** : Cadrage sans cartes, bandeau d'état en une ligne, contrôles secondaires visibles au survol, au focus ou au toucher, « Qui recrute » sur une ligne, Réglages sans cartes. Sourcing : puces d'état et bascule sans cadre, « Noter les N profils » seul bouton plein, tableau sans carte et colonnes par défaut réduites, vue Détaillé et zone Filtres allégées. Composants partagés avec l'ancienne page modifiés seulement derrière un drapeau (`variant`, `embedded`, `quiet`), rendu par défaut comparé à celui de HEAD par un rendu serveur des composants (aucun écart relevé, mesure des agents).
**Raison** : trois cadres et quarante contrôles au Cadrage, dix colonnes presque vides au Sourcing, jargon (« 18/46 colonnes », phrase technique sur le type d'organisation).
**Impact** : `src/components/missions/v3/cadrage/**`, `v3/sourcing/**`, `SourcingScreen.tsx`, `outreach/search/*`, `LinkedInResultCard`, `VoiceDictation`, `MissionConfigV2` et ses deux sections (`embedded`), `process/shared.tsx`, tests `lot12-cadrage` et `lot12-sourcing`, `e2e/flows/mission-v3.spec.ts`. Vérifié : tsc à la baseline de 11, c1 235, ux 1270, cliquet de dette design en baisse, lint sans nouveau problème.
**Reste à faire** :
- [ ] En-tête de mission et liste des missions (lot M).
- [ ] Mission archivée : « Réactiver » s'affiche deux fois, cibles de 44 px (`ArchivedNotice`, `MissionStateBanner`, hors périmètre des agents).
- [ ] Photos réelles à la place des initiales (lot P).

---

## 2026-10-04 — REFACTOR — Refonte mission, écran Pipeline allégé (retour « trop chargé »)

**Contexte** : après le lot 3, le propriétaire trouve la page mission chargée et difficile à comprendre. Captures du banc local avant et après, direction `docs/design/06-simplicite.md` (lot M, partie Pipeline).
**Décision / Fait** : la carte « Maintenant » garde une phrase, un bouton plein et deux liens ; proposition, règle, « Ensuite » et « Non suivi » passent sous « Pourquoi maintenant ? ». Puces d'étapes sur une rangée sans titres de groupe ni effectif nul. Bilan et Prise de contact sans cadre (icône seule sur téléphone). Liste : visage (initiales), étape avec l'ancienneté dessous, action seulement quand il y en a une, note en anneau, colonne « Depuis » retirée.
**Raison** : trois blocs de texte plus une ligne « Ensuite » au-dessus de la liste, deux titres de groupe, puces et boutons encadrés, « Aucune action depuis 0 j » à chaque ligne.
**Impact** : `src/components/missions/v3/pipeline/` (NowCard, ThenLine, StageBar, PipelineToolbar, CandidateList, CandidateListRow, MissionBoard, ToSortSection), `tests/c1/lot3-ecrans.test.mjs`, `tests/ux/lot12-pipeline.test.mjs`, `e2e/flows/mission-now.spec.ts` (ouvre « Pourquoi maintenant ? » avant de lire la proposition). `rowNextAction` et la règle des rangs inchangées. Vérifié : c1 235, ux 1244, e2e mission-now 16 sur 16 et mission-v3 vert, tsc à la baseline de 11.
**Reste à faire** :
- [ ] En-tête de mission, Cadrage, Sourcing et liste des missions suivent les mêmes règles (lot M).
- [ ] Photos réelles à la place des initiales (lot P).

---

## 2026-10-04 — SHIP — Design simplifié, lot A : l'accueil comme la maquette

**Contexte** : deuxième lot du design simplifié (`docs/design/06-simplicite.md`), après les fondations (PR #258). Le propriétaire a choisi l'accueil « comme la maquette ».
**Décision / Fait** : deux sections. « À faire » : une ligne par chose qui attend (compte LinkedIn à reconnecter, réponses à lire, candidats qui attendent une réponse, candidats qui n'avancent plus), avec visages et lien d'action, puis les tâches en retard sous le réveil et la journée. « Missions en cours » : cinq missions, visages des candidats en entretien, cumuls « au total ». Retirés : cartes des canaux, « Cette semaine », activité récente, « Personnaliser la page ». `PageHeader` : actions sur leur propre ligne sous 640 px. `AvatarStack` : chevauchement de 6 px. Cibles de 44 px sur téléphone.
**Impact** : `src/pages/Dashboard.tsx`, `src/components/dashboard/*`, `PageHeader.tsx`, `person-avatar.tsx`. Retirés : `DashboardConnections`, `DashboardWeekHighlight`, `DashboardActivityFeed`, `DashboardSortableItem`, `Sparkline`, `useDashboardLayout`.
**Recette `qa.md`** (banc local) : Guillaume PASS (liens vers messagerie, analyse, connexions, tâches, agenda et mission ; case cochée sur place ; page prête en 2 s). Claire PASS (aucun terme technique ni nom de fournisseur, « Nouvelle mission » en haut sans défiler). Théo PASS (compte vide : états vides, aucun zéro inventé ; `@critical` multi-tenant vert). Sophie PASS (iPhone 13 : aucun débordement, toutes les cibles de l'accueil à 44 px, cases des tâches comprises).
**Reste à faire** :
- [ ] Photos dans la pile « réponses à lire » : la notification ne porte pas le candidat (lot P).
- [ ] Bandeau d'essai, hors accueil : « Choisir un plan » (20 px) et « Fermer le bandeau » (36 px) sous 44 px sur téléphone.
**Refs** : PR #259.

---

## 2026-10-04 — SHIP — Refonte mission, lots 0c-3 et 0c-4 : écrans de mission, /pipeline, fiches, annulation

**Contexte** : les écrans lisent la vue `mission_candidate_rows` et `get_mission_stage_counts` (lots 0c-1 et 0c-2). Livrés avant le lot 0b-5 (repli « ordre B » du plan 0c).
**Décision / Fait** : un effectif porte le nom de l'étape, un cumul est écrit « au total ». Liste des missions sans « Brief incomplet », kanban avec Retenu et sans profils jamais ouverts, tableau de mission, /pipeline rangé par l'étape générale (même mots que la mission), « Dans cette étape depuis N j » sur `stage_entered_at`, annulation par `undo_candidate_stages`, grille IA qui reçoit le poste et les étapes d'entretien, tableau de bord (« Cette semaine » sur les jalons, activité récente sur l'étape générale). `get_project_stats` et `useProjectStats` n'ont plus de lecteur dans `src/`.
**Impact** : `src/lib/stageDisplay.ts`, `src/lib/candidateStage.ts`, `src/hooks/useATSData.ts`, `MissionPipeline.tsx`, `ProjectsListV2.tsx`, `ATS.tsx`, `ScorecardTab.tsx`, `generate-scorecard`, specs `e2e/flows/stage-0b4-gestes.spec.ts`, `seq-decisions-ui.spec.ts`, `seq-reply-paths.spec.ts` mises aux nouveaux titres, `e2e/api/stage-0c-lectures.spec.ts` (A2 et C ajoutés).
**Reste à faire** :
- [ ] Recette `qa.md` : Guillaume (tableau « écran, libellé, nombre » : liste, kanban, tableau, /pipeline, tableau de bord ; annulation d'un geste), Théo (isolement de la vue, de la fonction et de l'annulation, refus anonyme), Sophie (kanban et liste sur téléphone).
- [ ] Flow e2e `stage-0c-lectures.spec.ts` à rejouer sur la pile locale (`down.sh --reset`).
- [ ] Fenêtre du lot 0b-5 : repart au 04/10/2026, au plus tôt le 09/10/2026 ; journal `jcs_direct_write_log` à lire avant de poser le mode `refuse`.
- [ ] Lot 0c-6 : retrait de `get_project_stats` et `get_multiple_project_stats`, deux semaines au plus tôt après 0c-4.
**Refs** : `docs/refonte-mission/conception.md` section 13.

---

## 2026-07-07 — SHIP — Scoring à deux niveaux : éval. rapide (liste) vs éval. complète (fiche = visite de profil)

**Contexte** : idée de Laurent — le scoring de masse ne dispose que des données de liste (pas de « À propos », pas de descriptions d'expériences) depuis que le robot d'enrichissement est éteint (décision 07/07) ; il affichait pourtant un score faussement précis. Le seul chemin légitime vers les données complètes est la visite de profil que l'user déclenche lui-même.
**Décision / Fait** :
1. **score-profile-job** : body accepte `scoringMode:'deep'` → bypass du cache match_scores + résultat marqué `scoringDepth:'deep'|'quick'` (persisté dans scoring_result et job_candidate_status.scoring_details). Les scores historiques sans le champ = quick.
2. **Fiche candidat (ProfileDetailSheet)** : à l'ouverture (job sélectionné, score pas encore 'deep'), après un délai anti-rafale de 1,5 s → récupère le profil complet (ordre : données déjà en main → linkedin_profile_data persisté SI il passe `looksLikeFullProfileData` (résumé ou description d'expérience — les blobs minces du scoring de masse sont écartés) → sinon get_profile = 1 visite réelle, gated ledger côté serveur) puis `scoreProfile(full, {deep:true})`. Une tentative max par profil ; échecs silencieux ; pas d'auto-dismiss en deep (l'user regarde le profil). La visite persiste le blob complet (écrasement volontaire du blob mince) → les ouvertures suivantes ne re-visitent pas.
3. **UI honnête** : badge « Éval. rapide » / « Éval. complète » + spinner « Analyse complète en cours… » dans le bloc Scoring de la fiche ; coche CheckCircle2 sur le badge score des cartes + tooltips différenciés.
**Garde-fou** : le scoring profond n'est déclenché QUE par l'ouverture manuelle d'une fiche — aucun chemin batch (sinon on recrée le robot d'enrichissement par la porte de devant).
**Impact** : score-profile-job (edge, redéployé via workflow), useLinkedInScoring (scoreProfile options.deep + mapping scoringDepth), JobScoreDisplay (type), ProfileDetailSheet (effet deep + helpers mergeUnipileFullProfile/looksLikeFullProfileData factorisation), SearchResultsPanel + LinkedInSearch (câblage onDeepScoreProfile), CardStatusBadges (badge).
**Reste à faire** :
- [ ] Valider en prod avec Laurent : ouvrir une fiche d'un profil scoré → badge passe de « rapide » à « complète », score potentiellement ajusté.
**Refs** : branche claude/sourcing-filters-visibility-r0zsr8 → main.

---

## 2026-07-07 — SHIP — Bannière reconnexion + InMails cron réparés (enrichissement : en attente de confirmation)

**Contexte** : suite du verdict conflits de session (INSIGHT 2026-07-06). Chantiers du backlog livrés sur feu vert Laurent.
**Décision / Fait** :
1. **Bannière « compte à reconnecter »** : RPC `get_linkedin_reconnect_alerts` (SECURITY DEFINER — agrège search_failure_log qui reste service-role-only ; ≥ 2 `multiple_sessions` en 12 h, scoping org via member_linkedin_accounts → organization_members) + hook `useReconnectAlerts` + composant `LinkedInReconnectBanner` inséré dans LinkedInSearch sous AppliedFiltersBar. Fenêtre « problème actif » = dernier échec < 1 h ; dismiss croix persisté en localStorage par (account, last_failure_at) — un conflit plus récent ré-affiche. CTA → /settings?tab=connectors.
2. **process-inmail-queue mode cron** : Bearer = PROCESS_SEQUENCES_SECRET ou service key → traite les items dus de TOUS les users (quotas heures ouvrées + credentials LinkedIn résolus par user propriétaire, cachés par run) ; mode JWT user inchangé (scopé caller). Avant : `validateUser()` → 400 à CHAQUE cycle de 3 min (58 occurrences sur 3 h observées en prod), les InMails planifiés ne partaient jamais d'eux-mêmes. Ajout de la sérialisation par compte (cooldown 5 min après toute action `manual_*` du ledger), identique à process-enrichment-queue.
3. **Enrichissement — décision : reste ÉTEINT.** Kill-switch vérifié en prod (86 réponses `paused:true` sur 3 h), garde-fous prêts (sérialisation par compte, heures ouvrées, caps ledger, 3 items/run espacés de 12 s). Le garde-fou de sécurité de session a exigé une confirmation nominative (compte post-suspension — un feu vert générique ne suffit pas) → question explicite posée à Laurent avec explication du rôle du worker → réponse : « Non, laisse-le éteint ». Flag `true` conservé, ne réactiver que sur demande explicite. Les ~17 items pending de profile_enrichment_queue restent sans effet ; les scores continuent de se baser sur les données de recherche seules.
**Impact** : migration 20260706234500_linkedin_reconnect_alerts.sql, supabase/functions/process-inmail-queue, src/components/outreach/LinkedInSearch.tsx, src/hooks/useReconnectAlerts.ts, src/components/outreach/search/LinkedInReconnectBanner.tsx, types.ts (RPC).
**Reste à faire** :
- [ ] Vérifier le 07/07 matin : cron inmail répond 200, les 4 InMails Numspot en file depuis le 30/06 partent aux heures ouvrées (annulables avant depuis l'app si devenus obsolètes).
**Refs** : branche claude/sourcing-filters-visibility-r0zsr8 → main.

---

## 2026-07-06 — INSIGHT — Verdict conflits de session : compte Recruiter mono-session, reconnexion en méthode cookie requise

**Contexte** : après extinction du worker enrichissement (innocenté pour la journée — le ledger ne montre QUE des actions manuelles sur le compte), les échecs persistaient même onglets LinkedIn fermés. La boîte noire `search_failure_log` a capturé l'erreur exacte à 16:53 UTC.
**Décision / Fait** : 401 `errors/multiple_sessions` avec le message provider complet : « LinkedIn limits the use of multiple sessions on certain Recruiter accounts. […] causing a popup to appear in the user's browser, prompting them to choose a session […] **To avoid this error, use the cookie connection method.** » → le compte Recruiter de Laurent est soumis à la politique mono-session LinkedIn ; connecté au provider en **credentials** → session dédiée côté provider → conflit structurel avec toute session navigateur (+ popup LinkedIn côté user pouvant déconnecter le compte). **Remède : reconnecter le compte en méthode cookie (li_at)** — le provider réutilise alors la session du navigateur, plus de deuxième session. Toast conflit mis à jour avec ce remède (CTA → Réglages → Connecteurs).
**Note annexe** : `process-inmail-queue` répond 400 à CHAQUE cron (toutes les 3 min) : la branche `action=process` appelle `validateUser()` (scopée user, `.eq("created_by", user.id)`) alors que le cron s'authentifie avec le secret → throw → 400. Les InMails planifiés ne partent donc JAMAIS via le cron (seulement quand un user déclenche depuis l'app). Bug séparé, à corriger (mode cron multi-users).
**Impact** : search_failure_log (nouvelle table diagnostic, purge 14 j), useLinkedInSearchActions (toast remède).
**Reste à faire** :
- [x] Laurent reconnecte le compte en méthode cookie → CONFIRMÉ le 06/07 22:43 UTC : reconnexion avec cookies frais (li_at + li_a — il était DÉJÀ en méthode cookie, mais import du 02/06 devenu obsolète après rotation de session navigateur) → 5 recherches OK d'affilée, 45 profils trouvés, zéro ligne search_failure_log. Règle opérationnelle : ré-importer les cookies après chaque re-login navigateur ; piste produit : bannière « compte à reconnecter » quand la boîte noire voit ≥2 multiple_sessions
- [x] Fix process-inmail-queue mode cron → livré le 07/07 (cf. SHIP 2026-07-07)
- [x] Décision réactivation enrichissement → tranchée le 07/07 : reste ÉTEINT (choix explicite de Laurent après explication du rôle du worker ; cf. SHIP 2026-07-07)

---

## 2026-07-06 — BUG — Vrais conflits de session : le worker enrichissement jamais mis en pause en prod (suspicion forte)

**Contexte** : après le fix de classification, Laurent relance → le VRAI toast conflit de session s'affiche (multiple_sessions authentique). Quelque chose utilise son compte LinkedIn en parallèle des recherches manuelles.
**Décision / Fait** : le kill-switch `ENRICHMENT_PAUSED=true` (commit 24f5e4b du 2026-06-02, motivé par EXACTEMENT ce symptôme) **n'a jamais été déployé** — cause identifiée : le workflow deploy-edge-functions avait un bug silencieux entre le 2026-05-20 (création) et le 2026-06-11 (fix d1e1dd4 « cassait sur les pushes multi-commits » : diff sur clone shallow → `|| true` → RIEN ne se déployait). Le commit #205 est tombé pile dans cette fenêtre. Pendant un mois, la version ACTIVE du worker a consommé la session Recruiter (profile_views de fond toutes les 2 min, exécutions 0,6-11,2 s dans les logs) → collisions avec les recherches manuelles. Fait : (1) sérialisation par compte implémentée — avant chaque item, check `linkedin_action_log` source manual_* < 5 min → report +5 min sans consommer de tentative ; (2) flag pause conservé ; (3) **déployé en prod via le workflow auto (run 28798669886, « Deployed: 1, Failed: 0 », 2026-07-06 14:23 UTC)** — le robot est coupé.
**Impact** : supabase/functions/process-enrichment-queue/index.ts (déployé). Leçons : (a) tracer chaque déploiement d'edge function ; (b) le MCP Supabase down n'empêche pas de déployer — workflow_dispatch/push de deploy-edge-functions.yml fait le job.
**Reste à faire** :
- [ ] Quand le MCP Supabase revient : confirmer dans les logs (durées → ms) + ledger linkedin_action_log autour des échecs (confirmer l'acteur, regarder aussi process-inmail-queue qui répond 400 en boucle)
- [ ] Décision produit : réactiver l'enrichissement (ENRICHMENT_PAUSED=false) maintenant que la sérialisation protège l'usage interactif — à valider avec Laurent (compte sensible post-avertissement)

---

## 2026-07-06 — BUG — Faux « Conflit de session LinkedIn » : « unable to process » mal classé

**Contexte** : sur certaines combinaisons de filtres (générés IA notamment), le toast « Conflit de session LinkedIn » s'affiche alors que le dashboard provider montre les comptes Running, rien d'anormal. Corrélation nette avec les filtres, pas avec le compte.
**Décision / Fait** : `useLinkedInSearchActions` classait TOUT message contenant « unable to process » comme multiple_sessions (ligne 989). Or « Unable to process… » est le message générique du provider quand LinkedIn REJETTE la recherche (payload trop lourd, combinaison de filtres invalide) — aucun rapport avec un conflit de session. Fix : (1) classification conflit de session restreinte à errorType/message multiple_sessions ; (2) nouveau branch « unable to process » → toast actionnable « LinkedIn n'a pas pu traiter cette recherche — retire un critère ou raccourcis les mots-clés » ; (3) texte du vrai toast conflit adapté sur /sourcing (l'onglet « Base de données » n'y existe pas). Le prochain échec réel montrera le bon diagnostic ; les logs edge (« Search error: » + « Request body was: ») permettront d'identifier le filtre exact rejeté.
**Impact** : useLinkedInSearchActions uniquement (pas de redéploiement edge).
**Reste à faire** :
- [ ] Quand le cas se reproduit : lire les logs unipile-search pour identifier la combinaison de filtres rejetée et la corriger à la source (mapping buildSearchParams)

---

## 2026-07-06 — BUG — Recherche : « Unexpected token < » + faux avertissement « Brief peu détaillé »

**Contexte** : premier test réel du flux prompt par Laurent — deux messages anormaux au lancement de la recherche.
**Décision / Fait** : (1) « unexpected HTML » : logs prod → un POST unipile-search 500 après ~7 s ; cause = `data = await response.json()` non protégé (ligne 1042) quand la passerelle LinkedIn renvoie une page HTML (502/504 maintenance) → SyntaxError brute propagée jusqu'au toast. Fix : parse défensif (text → JSON.parse try/catch), réponse invalide traitée comme transitoire (retry avec les délais existants 0/6/15 s), message propre « Le service LinkedIn a renvoyé une réponse invalide » ; + filet côté front (useLinkedInSearchActions) qui humanise tout message contenant unexpected token/doctype/html. Fonction déployée v29. Les ~14 autres `response.json()` de la fonction restent non gardés (actions non-search) — le filet front les couvre. (2) « Brief peu détaillé — complétez le brief » sur une recherche sans brief : le job synthétique n'avait que le titre. Fix : le prompt est maintenant persisté en `description` du sourcing_project → devient la description du job synthétique (l'avertissement ne se déclenche plus + le scoring reçoit tout le contexte du prompt) ; et les messages de garde de handleSearch sont adaptés quand kind='search' (« décris ta cible via le Prompt IA » au lieu de « complétez le brief »).
**Impact** : supabase/functions/unipile-search/index.ts (v29 prod), useLinkedInSearchActions, PromptSearchHero.
**Refs** : logs edge-function 2026-07-06 13:26 UTC (POST 500, 6977 ms)

---

## 2026-07-06 — SHIP — Recherche par prompt sur /sourcing : hero IA « Décris qui tu cherches »

**Contexte** : retour fondateur immédiat après le ship /sourcing — le champ « Que cherches-tu ? » laissait croire à une recherche par prompt (« ça marche mal », « l'UX pourrait être beaucoup mieux fait ») alors qu'il ne faisait que renommer.
**Décision / Fait** : vrai flux prompt → filtres. Nouveau `PromptSearchHero` (src/components/sourcing/) affiché tant qu'aucun filtre n'existe : textarea langage naturel + 3 exemples cliquables + « Générer la recherche ». Appelle `generate-search-filters` via invokeWithCredits (action `filter_generation`, prompt entier dans job.description comme le Brief IA de CreateProjectModal), persiste `filters_snapshot = { ...data.filters, suggestions, brief_text, generated_at }` (spread top-level — PAS la réponse entière, cf. bug du tool agent regenerate_search_filters) + `name`/`job_details.title` = `analysis.suggested_title` → le scoring se débloque tout seul. L'hydratation existante (deps [id, filters_snapshot], snapshotKey=generated_at) applique les filtres au panneau sans plumbing. Boutons « Prompt IA » (ré-ouvrir, prompt pré-rempli, warning remplacement) et « Configurer manuellement » (skip). Bonus : (1) fix hydratation Branch B — `skills_keywords`/`industry_keywords` n'étaient PAS copiés dans le state au rechargement (chips perdues aussi côté missions) ; (2) SearchWelcomeMessage variante standalone (l'étape « Sélectionnez un poste dans le panneau de gauche » n'existe pas ici).
**Impact** : PromptSearchHero (nouveau), SourcingSearch, useLinkedInSearch (2 mappings), SearchResultsPanel (variante welcome).
**QA** : tsc + build OK ; navigateur 22/22 (hero à la création, exemple cliquable, payload generate-search-filters, PATCH snapshot+titre, hydratation FILTRES=4 + chips, champ intitulé auto-rempli, ré-ouverture prompt pré-rempli, skip manuel, liste renommée, transformation mission intacte).
**Reste à faire** :
- [ ] Auto-lancer la recherche post-génération (bloqué par la résolution asynchrone de la localisation — pendingLocationRef ; à faire proprement ou pas du tout)
- [ ] FilterReviewModal (validation avant application) — volontairement pas branché : il perd company/school/spotlight/open_to_work
**Refs** : contrat complet generate-search-filters documenté dans l'entry (input job structuré, output filters/analysis/suggestions/power_filters)

---

## 2026-07-06 — SHIP — Recherche autonome (/sourcing) : sourcer sans créer de mission

**Contexte** : le sourcing n'existait que dans une mission ; Laurent veut chercher librement et ne créer la mission que quand la recherche devient sérieuse.
**Décision / Fait** : une recherche autonome EST un sourcing_project léger `kind='search'` (colonne + CHECK + index, migration 20260706130611, appliquée en prod) — toute la machinerie mission (filters_snapshot, job_candidate_status keyé project:{id}, stats triggers, quotas LinkedIn et crédits IA côté serveur) fonctionne sans duplication. Pages : /sourcing (liste des recherches — cards avec stats, suppression AlertDialog, nom auto « Recherche du 6 juillet, 14h32 ») et /sourcing/:id (champ « Que cherches-tu ? » → job_details.title + name, LinkedInSearch monté tel quel, bouton « Transformer en mission » = UPDATE kind+name → workspace mission avec candidats/filtres/statuts déjà en place, zéro migration de données). Entrée sidebar « Recherche » + palette ⌘K. Garde-fous : scoring bloqué tant que la cible n'est pas définie (`scoringDisabledReason`), pré-check « brief incomplet » neutralisé pour les recherches (`skipBriefCheck`), SourcingReadinessPanel (qui parle du brief) remplacé par le welcome générique, useQuotaGate ne compte plus les recherches dans max_jobs, listes missions filtrées kind='mission' (`useSourcingProjects(kind)`).
**Raison** : audit préalable (2 sub-agents) — le seul vrai verrou était le selectedJob (recherche+scoring) ; réutiliser l'objet mission évite un 2e système de persistance et rend la conversion instantanée. Audit quotas : tous les mécanismes (member_quotas, ledger linkedin_action_log, rate limit, crédits IA) sont keyés compte/user/org, jamais mission → aucun contournement possible depuis la page autonome.
**Impact** : useSourcingProjects, useLinkedInScoring, LinkedInSearch, SearchResultsPanel, useQuotaGate, App.tsx, AppSidebar, NavigationPalette, pages/SourcingSearches + pages/SourcingSearch, types.ts, migration SQL.
**QA** : tsc + vite build OK ; harnais navigateur 12/12 (liste vide, création → workspace, welcome générique sans panneau brief, PATCH title+name au blur, liste renommée, dialog transformation préremplie, PATCH kind=mission → /missions/:id).
**Reste à faire** :
- [x] Pré-remplissage IA des filtres depuis le champ cible (réutiliser generate-search-filters) — fait le jour même, voir entry suivante
- [ ] Tuto vidéo de l'écran Recherche
- [ ] Option : masquer les panneaux séquences/enrollment dans une recherche (fonctionnels mais orientés mission)
**Refs** : supabase/migrations/20260706130611_sourcing_projects_kind.sql

---

## 2026-07-02 — SHIP — Tutos vidéo in-app : popup d'aide + studio de tournage Playwright

**Contexte** : Laurent veut des popups d'aide avec vidéos tuto courtes où l'on voit la souris naviguer.
**Décision / Fait** : (1) composant générique `TutorialVideoDialog` (bouton « ? » → Dialog avec vidéo autoplay muted loop + points clés) — chaque écran peut monter son tuto ; premier montage : header Pipeline (« Le pipeline en 30 secondes », public/tutos/pipeline-tour.webm, 2,1 Mo / 27 s). (2) Studio de tournage : harnais Playwright (app réelle + Supabase intercepté, mocks STATEFUL pour que le drag persiste à l'écran) + recordVideo, curseur factice injecté (suivi mousemove, ripple au clic) + barre de sous-titres injectée pilotée depuis le script. Scénario : funnel → clic tuile → drag Sarah vers Entretien technique (toast) → fiche candidat → outro. Sortie webm VP8 (le ffmpeg Playwright n'a pas libx264 — pas de mp4 ; lisible partout sauf très vieux Safari).
**Raison** : onboarding visuel sans dépendance à un outil externe (Loom etc.) — reproductible à chaque évolution d'écran en relançant le script.
**Impact** : src/components/help/TutorialVideoDialog.tsx, MissionPipeline (montage), public/tutos/.
**Reste à faire** :
- [ ] Tuto sourcing (pills, toggle À l'écoute) avec le même studio
- [ ] Pièges de tournage documentés : cibler les cartes par classe (le toast sonner peut porter le même texte), attendre la disparition des toasts, scrollIntoViewIfNeeded avant clic (sinon clic sidebar)
**Refs** : MissionPipeline.tsx, TutorialVideoDialog.tsx

---

## 2026-07-02 — SHIP — Vue Pipeline mission : données réparées (project_id, RPCs) + refonte DA v2

**Contexte** : Pipeline débloqué le même jour → l'user découvre une vue quasi vide et restée en DA brutaliste.
**Décision / Fait** : (1) job_candidate_status.project_id NULL sur 1352/1398 lignes (le sourcing ne le remplissait jamais) alors que useProjectCandidates filtre dessus → trigger BEFORE auto-résolution depuis job_id + backfill + index partiel ; (2) les 3 RPCs de 20260309170900 (get_project_stats…) n'existaient PAS en prod — jamais rejouées après le repair tracking-only de la désynchro migrations → re-créées avec fix (untreated='discovered', pas 'untreated') et gardes org (SECURITY DEFINER non borné = fuite cross-tenant) ; (3) refonte MissionPipeline en DA v2 (pills segmentées, colonnes/cartes arrondies, casse normale, suppression du double cadre) + colonne « Contacté » dans le kanban dynamique (les messaged/replied étaient noyés dans « Sourcé ») + table : hauteur viewport (350px fixes), statuts replied/scored/discovered affichés, token mort hover:text-linkedin.
**QA** : dry-run transactionnel prod (rollback) : backfill 46→1398, pipeline f0bf=434 candidats, trigger OK ; harnais Playwright avant/après PASS ; tsc+build OK.
**Itération 2 (même jour, « pas ouf, fais mieux »)** : refonte command-center issue d'un panel de 3 directions design + juge — command bar avec funnel actionnable (compteurs font-display + taux de passage entre étapes, tuiles cliquables qui scrollent vers la colonne), système de staleness (badge global « X sans mouvement +7j », compteur par colonne, âge orange sur carte), avatars initiales (hash nom→palette brand), thème sémantique des colonnes (Contacté=info, Embauché=success — plus de couleurs positionnelles), cartes denses avec LinkedIn au hover, board pleine hauteur (100dvh), toasts nominatifs (« X embauché ! »), perf 400 cartes (React.memo + content-visibility). dnd-kit inchangé.
**Itération 3 (retour fondateur : cartes non ouvrables = « nul »)** : clic sur une carte kanban → CandidateDetailModal (le modal riche de l'ATS : profil, évaluation, CV, séquences, messages, notes, rappels) avec nouvelle prop `stageOptions` pour utiliser les étapes de LA mission dans le sélecteur (au lieu des ATS_STAGES hardcodés) ; garde anti-clic-fantôme post-drag (dragHappenedRef) ; colonnes fluides flex-1 min/max-w (fini la moitié d'écran vide) ; `.thin-scrollbar` (index.css) sur colonnes + board ; CTA « Contacter les candidats » (→ tab outreach) dans la colonne Contacté vide.
**Itération 4 (question fondateur : « pourquoi pas les mêmes étapes ? »)** : sans étapes de process configurées, le board tombe sur les colonnes génériques sans l'expliquer → bannière « Board générique — définissez vos étapes d'entretien » avec CTA → tab process, affichée seulement si steps.length===0 et des candidats existent. Vérifié au navigateur (bannière, absence avec steps, navigation CTA).
**Reste à faire** :
- [ ] Persister viewMode kanban/table (localStorage) si demandé
- [ ] Insights : vérifier ce qu'il affiche maintenant que project-candidates remonte des données
- [ ] Fiche candidat : « Postes liés » affiche le job_id brut (project:{uuid}) quand pas de titre — mapper vers le nom de mission (useCandidateFullProfile)
**Refs** : migration 20260702164207, MissionPipeline.tsx, ProjectCandidatesTableEnhanced.tsx

---

## 2026-07-02 — SHIP — Filtres sourcing (À l'écoute/Shortlist), visibilité contactés, déblocage Pipeline

**Contexte** : UX sourcing dégradée — impossible de filtrer les profils à l'écoute, de retrouver ses shortlistés/contactés ; phase Pipeline grisée malgré l'activité réelle.
**Décision / Fait** : (1) pills Shortlist + toggle « À l'écoute » (spotlight OPEN_TO_WORK serveur — l'API search ne renvoie JAMAIS le flag par profil, vérifié 0/1213 en base) ; (2) useJobCandidateStatus lit les 2 formes de job_id (`project:{uuid}` et nu — l'inscription séquence normalise, le sourcing préfixait → contactés invisibles) ; (3) pills DB embarquent le pool même en vue Résultats ; (4) trigger SQL sync stats_* mission + backfill (colonnes jamais mises à jour → readiness verrouillait Pipeline à vie) ; (5) add-to-shortlist écrit enfin job_candidate_status (upsert par candidate_id, match URL par slug ; avant : UPDATE par URL stricte = 0 match, et rien du tout si Notion absent) ; pill Shortlist matche aussi la shortlist Notion par nom.
**Impact** : useLinkedInSearch, useFilteredResults, useJobCandidateStatus, useLinkedInSearchActions, LinkedInSearch, SearchResultsPanel, edge add-to-shortlist, migration 20260702121429.
**QA** : préflight tsc+build OK ; persona Guillaume (sourcing) couvert par harnais Playwright (app réelle, Supabase intercepté, 16+22 checks PASS) ; migration validée par dry-run transactionnel sur schéma prod (rollback).
**Reste à faire** :
- [ ] `supabase functions deploy add-to-shortlist` après merge
- [ ] Vérifier le workflow deploy-migrations sur le push main (backfill → Pipeline débloqué)
- [ ] Générer le spec e2e sourcing live (test.fixme du socle QA)
**Refs** : 9f71dff, 08aa113, 0de9097, 7a1298e (branche claude/sourcing-filters-visibility-r0zsr8)

---

## 2026-04-27 — SECURITY — QA 4 personas sur feature enrichment, fix sécurité multi-tenant

**Contexte** : Sprint 1+2+3 enrichment (cascade lookup + bulk + permissions + RGPD + analytics) déployés en prod sans avoir lancé `/qa` 4 personas — manquement à la skill `qa.md` "Obligatoire avant tout deploy en prod". Laurent m'a recadré → audit rétroactif lancé.

**Décision / Fait** :
- QA Théo a révélé 1 trou de sécurité CRITIQUE : `get-enrichment-status` faisait un fallback BC direct si la row n'existait pas en DB → un user pouvait brute-force des `request_id` BC valides et récupérer les emails/phones d'enrichments d'autres orgs. Fix : suppression du fallback, refus strict 404 si row absente.
- Théo bug #2 : pas de rate limit sur `get-enrichment-status` (polled 5s). Fix : ajout `check_rate_limit` 60 req/min/user.
- Théo bug #3 : double-clic sur `EnrichContactButton.handleConfirm` possible. Fix : `submitting` state + early return guard.
- Guillaume bug : `INSUFFICIENT_CREDITS` ou `QUOTA_EXCEEDED` ne stoppait pas le bulk → 70 erreurs 402 inutiles. Fix : `aborted` flag + skip workers restants + toast d'erreur explicite.
- Guillaume UX : pas de progress UI pendant le bulk. Fix : `toast.loading` updated tous les 5 profils.
- Claire bug : "cascade de fournisseurs" + "Background" anglais visibles dans modale. Fix : "plusieurs sources de données vérifiées" + "Arrière-plan".
- Sophie : modale `max-w-md` ok sur iPhone 13 portrait, pas de fix nécessaire.

**Raison** : sécurité multi-tenant non négociable, le reste UX.

**Impact** :
- `supabase/functions/get-enrichment-status/index.ts` : refus strict no-row + rate limit
- `src/components/outreach/result-card/EnrichContactButton.tsx` : submitting guard + textes FR
- `src/components/outreach/result-card/BulkEnrichButton.tsx` : aborted flag + progress toast

**Reste à faire** :
- [ ] Lancer /qa systématiquement avant chaque commit prod (pas après)
- [ ] Écrire tests unitaires pour `_shared/get-or-fetch-contact.ts`, `parseBoolean`, `cleanLocationPart`
- [ ] UI admin Settings>Équipe pour modifier `can_enrich_contacts` + `enrichment_quota_monthly` per-user (actuellement faut SQL editor)
- [ ] Webhook BC au lieu de polling (perf)

**Refs** : commit à venir (post-fixes)

---

## 2026-04-21 — SHIP — Migration Lovable → Vercel + Supabase achevée

**Contexte** : bascule du backend Konekt de Lovable Cloud vers un projet Supabase self-managed (`konekt-production`, ref `crckfywoyjxkawathdff`, West EU Ireland), frontend repositionné sur Vercel (https://konekt-app-navy.vercel.app). L'onboarding était cassé en prod sur "permission denied for table organizations", 0 secrets Supabase configurés, deploy des edge functions bloqué.

**Décision / Fait** :
- Schéma Supabase importé (88 tables, 194 policies RLS, 3 plans seed) — fichier `MIGRATION_CLEAN.sql` gardé à la racine comme référence.
- Bug RLS résolu : root cause = GRANTs manquants à la role `authenticated` (schema importé sans les privileges standard Supabase). Fix appliqué via `fix-organizations-rls.sql` : GRANT SELECT/INSERT/UPDATE/DELETE sur toutes les tables public + default privileges pour les futures.
- Deploy des edge functions débloqué : suppression du bloc `[functions.copilot]` orphelin dans `supabase/config.toml` (dossier inexistant) + correction du `project_id`. **77/77 fonctions déployées** sans erreur.
- Inventaire complet des secrets requis (26 secrets au total dont 6 critical, 8 important, 12 optional) — détail dans CLAUDE.md section "Supabase secrets".
- Vercel SPA rewrites déjà commit précédent (`vercel.json`).

**Raison** : sortir de la dépendance Lovable avant le weekend 2026-04-25 pour avoir un stack full-contrôlé (git → Vercel + Supabase CLI).

**Impact** :
- `CLAUDE.md` : nouvelle section stack + infra + runbook hotfix + liste secrets + auth URL config.
- `supabase/config.toml` : `project_id` → `crckfywoyjxkawathdff`, bloc copilot retiré, note auth URL config.
- `supabase/migrations/20260309170000_invalidate_match_scores_on_job_update.sql` : no-op (la table `public.jobs` n'existe pas dans le nouveau schéma).
- `fix-organizations-rls.sql` : nouveau, à rejouer si un reset/restore casse les grants.
- Frontend : ~zéro changement, branche main auto-deploy Vercel.

**Reste à faire** :
- [ ] Setter les 6 secrets CRITICAL dans le Dashboard Supabase : `ANTHROPIC_API_KEY`, `LOVABLE_API_KEY`, `OPENAI_API_KEY`, `UNIPILE_API_KEY`, `UNIPILE_DSN`, `NOTION_API_KEY` (+ 3 `NOTION_*_DB_ID`), `STRIPE_SECRET_KEY`.
- [x] Configurer Site URL + Redirect URLs dans le Dashboard Auth.
- [ ] Setter les secrets IMPORTANT (Apollo, PDL, webhooks) pour débloquer enrichissement et webhooks.
- [x] Tester onboarding end-to-end — débugging complet des 3 bugs RLS/triggers (voir 2026-04-21-bis).
- [ ] Rejouer un premier scoring LinkedIn pour valider la chaîne Unipile + score-profile-job.

**Refs** : commits à venir sur main — voir `git log` après push.

---

## 2026-04-21 — REFACTOR — Sortie totale de Lovable (emails → Resend)

**Contexte** : Après la migration AI Gateway Lovable → Anthropic direct, il restait 3 fonctions email qui dépendaient encore de Lovable (SDK `@lovable.dev/email-js` + webhooks `@lovable.dev/webhooks-js`). Objectif : couper totalement Lovable.

**Décision / Fait** :
- `process-email-queue` : remplace `sendLovableEmail` par fetch direct à l'API Resend (`https://api.resend.com/emails`). Gère 429 (Retry-After), 401/403 (auth → DLQ immédiat), 422 (validation → DLQ), autres erreurs (log + VT retry). Ajoute `Idempotency-Key` + `List-Unsubscribe` RFC 8058 + `X-Entity-Ref-ID`. Log enrichi avec `{provider: 'resend', resend_email_id}` dans metadata.
- `preview-transactional-email` : remplace l'auth `LOVABLE_API_KEY` par comparaison `token === SUPABASE_SERVICE_ROLE_KEY`. La fonction rend juste les templates React Email, n'envoie pas.
- `handle-email-suppression` : réécrit pour le format Resend webhook (événements `email.bounced`, `email.complained`, `email.delivery_delayed`). Verification de signature Svix (HMAC-SHA256 sur `${svix-id}.${svix-timestamp}.${body}` avec `whsec_<base64>`, rejet si timestamp > ±5 min). Mapping vers `suppressed_emails.reason` ('bounce' / 'complaint'). Unsubscribes restent gérés par `handle-email-unsubscribe` (endpoint One-Click déjà existant).
- Nouvelle migration `20260421200000_suppressed_emails_unique.sql` : ajout UNIQUE sur `suppressed_emails.email` (nécessaire pour l'upsert `onConflict: 'email'`).
- 3 fonctions redéployées, 0 erreur.

**Raison** : simplification de la stack, élimination de la dépendance Lovable, control total de la delivery (domaines vérifiés côté Resend, logs consultables).

**Impact** :
- `supabase/functions/process-email-queue/index.ts` : réécriture complète, fetch direct Resend.
- `supabase/functions/preview-transactional-email/index.ts` : auth guard changé.
- `supabase/functions/handle-email-suppression/index.ts` : réécriture complète pour webhook Resend/Svix.
- `supabase/migrations/20260421200000_suppressed_emails_unique.sql` : nouveau.
- `CLAUDE.md` : `RESEND_API_KEY` + `RESEND_WEBHOOK_SECRET` ajoutés, `LOVABLE_API_KEY` retiré partout.

**Reste à faire** :
- [ ] Setter `RESEND_API_KEY` dans les secrets Supabase.
- [ ] Vérifier le(s) domaine(s) d'envoi dans le dashboard Resend (sinon emails depuis `@konekt.fr` refusés).
- [ ] Configurer le webhook Resend Dashboard → Webhooks : endpoint = `https://crckfywoyjxkawathdff.supabase.co/functions/v1/handle-email-suppression`, cocher events `email.bounced` + `email.complained`, récupérer le `whsec_xxx` → setter comme `RESEND_WEBHOOK_SECRET`.
- [ ] Tester un envoi bout en bout : créer une invitation d'équipe → vérifier réception + log `email_send_log` avec `status=sent` + `metadata.provider='resend'`.

**Refs** : commit à venir. Fichiers clés : `process-email-queue/index.ts`, `handle-email-suppression/index.ts`.

---

## 2026-04-21 — REFACTOR — Sortie de Lovable AI Gateway, passage à Anthropic direct

**Contexte** : 16 fonctions edge appelaient le Lovable AI Gateway (`https://ai.gateway.lovable.dev/v1/chat/completions`) avec `LOVABLE_API_KEY` pour utiliser principalement Google Gemini 2.5 Flash / 3 Flash Preview. Laurent veut couper la dépendance à Lovable post-migration Supabase.

**Décision / Fait** :
- Nouveau helper `supabase/functions/_shared/call-claude.ts` : drop-in replacement qui prend le même payload (messages, tools, tool_choice, response_format, temperature, max_tokens) et le convertit en appel Anthropic Messages API directe. Gère retries 429/529, timeout, JSON mode (via consigne system), tool use (conversion OpenAI ↔ Anthropic).
- Migration des 16 fonctions : ai-chat-completion, analyze-linkedin-profile, analyze-response, audit-employer-brand, auto-categorize-chats, detect-profile-fraud, enrich-company (8 blocs tools), fetch-notion-jobs, generate-call-report, generate-recruiter-bio, generate-scorecard, live-coach, nurturing-analyzer, process-debrief, screen-candidate.
- Modèle par défaut : `claude-haiku-4-5-20251001` (aussi rapide que Gemini Flash, meilleur pour reasoning/extraction).
- `LOVABLE_API_KEY` toujours utilisé par 3 fonctions email (`process-email-queue`, `preview-transactional-email`, `handle-email-suppression`) — service Lovable Email, à migrer séparément (Resend/Postmark/SES selon choix).
- Les 15 fonctions AI redéployées, 0 erreur. `enrich-company` = le plus gros morceau (~1900 lignes, 8 blocs tools convertis).

**Raison** : 1 seul vendor AI (Anthropic) simplifie la gestion des clés et aligne avec CLAUDE.md qui préconise déjà Claude Sonnet/Haiku. Élimine un middleman.

**Impact** :
- `supabase/functions/_shared/call-claude.ts` (nouveau, ~200 lignes).
- 15 fonctions edge modifiées.
- `CLAUDE.md` : section secrets mise à jour, `LOVABLE_API_KEY` déplacé de CRITICAL vers "DEPRECATED — à migrer" (pour les emails uniquement).

**Reste à faire** :
- [ ] Setter `ANTHROPIC_API_KEY` dans les secrets Supabase pour que tout marche.
- [ ] Décider du provider email de remplacement (Resend par défaut) et migrer les 3 fonctions restantes.
- [ ] Valider un scoring LinkedIn + un audit employer-brand pour vérifier que la chaîne Claude fonctionne en prod.

**Refs** : commit à venir. Fichier clé : `supabase/functions/_shared/call-claude.ts`.

---

## 2026-04-21 — BUG — Onboarding org creation : 3 bugs en cascade (RESOLVED)

**Contexte** : après la migration Supabase, la création d'organisation pendant l'onboarding échouait avec "new row violates row-level security policy for table organizations". Symptôme côté UI : impossible de passer l'étape "Parlez-nous de vous" (scene org).

**Décision / Fait** : 3 bugs distincts découverts en cascade pendant le debug, tous patchés dans `fix-organizations-rls.sql` :

1. **GRANTs manquants** (fix initial) — la role `authenticated` n'avait aucun privilège sur les tables `public.*`. Fix : GRANT SELECT/INSERT/UPDATE/DELETE à authenticated + default privileges.

2. **Catch-22 enforce_role_hierarchy** — le trigger `handle_new_organization` (AFTER INSERT) tentait d'ajouter le créateur comme 'owner' dans `organization_members`, mais le trigger BEFORE `enforce_role_hierarchy` bloquait : "Only owners can assign the owner role". Or personne n'est owner d'une org qui vient d'être créée. Fix : ajout d'une clause bootstrap dans `enforce_role_hierarchy` — laisser passer si c'est le tout premier membre de l'org ET que le user = created_by de l'org.

3. **UNIQUE constraint manquante sur ai_credit_balances** — la fonction `sync_credit_balance_from_subscription` fait `ON CONFLICT (organization_id) DO UPDATE` mais la contrainte UNIQUE n'existait pas → cascade de triggers cassée à la création d'org. Fix : `ADD CONSTRAINT ... UNIQUE (organization_id)`.

4. **Race condition sur members_select / RETURNING** — `INSERT ... RETURNING *` via supabase-js évaluait `is_org_member(auth.uid(), id)` pour le RETURNING, mais à un moment où le trigger AFTER n'avait pas encore inséré le user dans `organization_members` (ou visibility glitch PostgREST). Résultat : erreur RLS bien que l'INSERT ait réussi. Fix : étendre `members_select` pour accepter aussi `created_by = auth.uid()` — sémantiquement normal (le créateur doit pouvoir voir sa propre org).

**Raison** : le schéma importé depuis Lovable avait des triggers et policies qui supposaient implicitement des grants/conventions Supabase que l'import n'a pas transférés.

**Impact** :
- `fix-organizations-rls.sql` : 4 sections + vérification post-fix DO block, idempotent (rejouable).
- DB prod : policies/constraints/trigger fn mis à jour.
- `LOGBOOK.md` + `CLAUDE.md` : doc.

**Bug #5 — UNIQUE constraints perdues à l'import Lovable** : 8 autres tables avaient le même problème (contraintes UNIQUE disparues), bloquant les upserts client (`SceneProfile` onboarding, `ConnectorSettings`, `useJobCandidateStatus`, `useMemberLinkedInAccounts`, etc.). Fix : loop DO block dans `fix-organizations-rls.sql` qui ajoute idempotemment les UNIQUE sur `profiles`, `connector_instances`, `chat_categories`, `job_candidate_status`, `member_email_accounts`, `member_linkedin_accounts`, `member_quotas`, `message_analysis_cache` (+ celles déjà patchées).

**Reste à faire** :
- [x] Valider l'onboarding complet jusqu'au dashboard (testé OK 2026-04-21 soir).
- [x] Transformé en migration datée : `supabase/migrations/20260421180000_grants_bootstrap_owner_uniques.sql`, marquée `applied` en remote via `supabase migration repair`.

**Refs** : commits `00acc732` + `bb9b1ec1` (bug #5 UNIQUE constraints) + commit de consolidation. Migration : `20260421180000_grants_bootstrap_owner_uniques.sql`.

---

## 2026-04-20 — DECISION — Package Claude Code consolidé livré

**Contexte** : 25 fichiers (CLAUDE.md + 15 skills + settings + 4 guides + LOGBOOK + PROMPTS + routines) prêts à être déposés dans le repo Konekt AI Platform.
**Décision** : structure finale adoptée, plus de versions parallèles.
**Raison** : éviter la dérive documentaire et les règles contradictoires entre fichiers.
**Impact** : `CLAUDE.md`, `.claude/settings.json`, `skills/*.md` remplacent toute version antérieure.
**Reste à faire** :
- [ ] Déposer le package dans le repo
- [ ] Tester /go sur une feature réelle
- [ ] Ajuster PROMPTS.md après 2 semaines d'usage
**Refs** : conversation du 2026-04-20.

---

## Règles d'usage

1. **Une ligne suffit si c'est tout ce qui est vrai.** Pas d'étirement artificiel.
2. **Pas de PII client dans LOGBOOK.md.** Noms de candidats, emails, téléphones interdits. Remplacer par des IDs.
3. **Les `BUG` ouverts restent en haut** jusqu'à fermeture (flag `[RESOLVED]` dans le titre + date de résolution).
4. **Chaque `SHIP` référence le commit SHA et la cible** (staging ou prod).
5. **Relecture hebdo** : lundi matin, parcourir les 7 derniers jours. Ce qui est `[ ]` depuis 7+ jours → soit fait, soit fermé, soit escaladé.

---

## Anti-patterns à éviter

- ❌ `J'ai implémenté la feature X` → le verbe à la 1ère personne n'ajoute rien.
- ✅ `SPEC — Feature X : scope, contrats, limites`.

- ❌ Entry de 10 paragraphes avec code inline → mettre le code dans le repo, lier le commit.
- ✅ Entry de 5 bullets + `Refs: <SHA>`.

- ❌ `INSIGHT — Claude Code est cool` → vide.
- ✅ `INSIGHT — Playwright échoue sur Safari mobile à cause de <raison précise>, workaround : <X>`.

---

*Ce fichier est lu par Claude Code en début de chaque conversation via la skill /status. Garder concis pour ne pas polluer le contexte.*
