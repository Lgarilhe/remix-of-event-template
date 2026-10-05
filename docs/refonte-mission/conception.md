# La nouvelle page mission : conception retenue (version révisée)

Konekt, 24/09/2026. Synthèse de l'atelier « expérience mission » : un diagnostic, trois pistes rédigées sans se voir, trois juges (un recruteur exigeant, un regard « première visite et téléphone », un regard technique), puis **deux critiques de la synthèse** (usage réel, faisabilité), dont chaque point a été revérifié dans le code avant d'être intégré.

Fichier : `/tmp/claude-0/-home-user-remix-of-event-template/4b4fe983-b7dc-55e7-8194-3f9f5ececcae/scratchpad/mission-ux/synthese.md`

Sources : `diagnostic.md`, `piste-A.md`, `piste-B.md`, `piste-C.md`, `usage-prod-mesures.txt` (même dossier), le document de la barre latérale (`barre-lot56/design-doc.txt`), et le dépôt en lecture seule (commit 5882084, qui ne touche aucun fichier de mission depuis 99ec908). Rien n'a été modifié, ni dans le dépôt ni en base. « P1 » à « P10 » renvoient aux problèmes du diagnostic ; « U-B1 », « U-I3 »… à la critique d'usage ; « F-B1 », « F-I8 »… à la critique de faisabilité. L'annexe A dit où chaque critique est traitée.

---

## 0. En une page

**Ce qui ne va pas aujourd'hui, en quatre phrases.**
1. Les chiffres affichés sont faux, donc on cesse de les lire (P1).
2. Une mission s'ouvre sur son cadrage, alors que le travail du jour est ailleurs (P4).
3. Huit vues, trois phases verrouillées, trois barres de navigation et jusqu'à 61 boutons sur un écran (P5).
4. On trouve des profils, mais rien ne les amène jusqu'à un entretien : en production, 1 819 profils de mission, 19 contactés, 0 en entretien (diagnostic, section 3).

**Ce que nous proposons, en quatre phrases.**
1. Une mission s'ouvre sur ses candidats, avec en tête **une seule chose à faire maintenant** et un bouton pour la faire.
2. Trois écrans au lieu de huit vues : **Pipeline** (l'accueil), **Sourcing**, **Cadrage**. Plus de phases à déverrouiller.
3. Tout geste part d'un candidat : trier, contacter, répondre, faire avancer, présenter au client. Il se fait sur place, dans un panneau à droite, sans changer d'écran.
4. L'assistant connaît la mission, propose et rédige, mais ne décide jamais seul : ni écarter, ni envoyer, ni déplacer (garde-fou serveur à compléter, section 8).

**Avant toute chose : rendre les chiffres justes, et savoir d'où vient chaque signal.** La première version de cette synthèse le disait déjà. Les critiques ont montré que c'était beaucoup plus gros que prévu : au moins douze programmes écrivent l'étape d'un candidat, et plusieurs signaux de la carte « Maintenant » n'ont aujourd'hui aucune source (section 1.4). Le lot 0 est donc découpé en trois (0a, 0b, 0c), et la carte Maintenant ne sort qu'avec les signaux dont la source est prouvée.

---

## 1. D'où vient cette conception

### 1.1 Les notes

Chaque juge a noté cinq critères sur 5 (clarté, vitesse, guidage, faisabilité, audace). Total sur 75.

| Piste | Idée | Recruteur | Première visite | Technique | Total |
|---|---|---|---|---|---|
| A, le pipeline au centre | La mission s'ouvre sur la liste des candidats, une prochaine action par ligne | 21 | 17 | 19 | 57 |
| **B, un seul fil guidé** | La mission s'ouvre sur « Maintenant » : une seule action, un bouton | 19 | 21 | 21 | **61** |
| C, l'assistant fait, vous validez | La mission s'ouvre sur un fil de propositions préparées par l'assistant | 17 | 17 | 20 | 54 |

### 1.2 Le choix

**Base : la piste B**, la mieux notée. On garde son principe et son ossature :
- une carte « Maintenant » qui dit la prochaine chose à faire, avec « Pourquoi maintenant ? », « Plus tard » et une ligne « Ensuite » ;
- une règle de priorité fixe et explicable : d'abord ce qu'une personne attend de vous, puis ce qui fait avancer la mission, enfin ce qui la prépare ;
- plus de phases verrouillées, des adresses propres qui réparent le bouton Retour, les anciens liens redirigés ;
- le mode « un par un » pour trier et pour traiter les réponses ;
- les résultats du Sourcing relus en base, pour qu'il ne s'ouvre plus vide.

**Greffe principale, de A vers B : la liste des candidats passe sur l'accueil, sous la carte Maintenant.** Le juge recruteur reprochait à B un accueil sans aucun candidat. L'atelier Pipeline de B et l'écran d'accueil ne font donc plus qu'un, et l'accueil s'appelle **Pipeline**, le mot du métier que le document de la barre latérale voulait garder (`design-doc.txt:92`).

Les autres greffes sont signalées au fil du document par « (de A) », « (de B) », « (de C) ».

### 1.3 Ce qu'on a écarté pendant l'atelier, et pourquoi

| Idée écartée | Venue de | Raison |
|---|---|---|
| Renommer « Pipeline » en « Candidats » | A | Casse un libellé décidé pour un gain faible (juge recruteur) |
| L'accueil sans aucune liste de candidats | B | Cache les candidats au recruteur qui mène plusieurs missions |
| Le tri un par un comme seule voie | B | Trop lent sur 200 profils. La sélection groupée reste possible partout |
| La préparation automatique de fond par l'assistant | C (lot C7) | Consomme des crédits sans garantie d'usage : 17 organisations sur 17 en formule gratuite (Q14), une seule conversation avec l'assistant en 30 jours (`design-doc.txt:36`). Remplacée par une préparation à la demande |
| L'assistant qui met le tri « en attente » parce qu'il y a une embauche | C | L'IA déciderait de ce que le recruteur voit |
| « Suivre l'avis de l'assistant » pour écarter un lot | C | Réintroduit la décision par l'IA qu'on retire (P7). Gardé seulement pour retenir |
| Un deuxième onglet « À traiter » dans la mission | C | Même mot que l'onglet de la barre, pour un autre périmètre |
| Une nouvelle fonction serveur pour lire les PDF et Word | B | `ingest-user-file` le fait déjà (`supabase/functions/ingest-user-file/index.ts:1-16`), avec deux réserves vues en section 6 |

### 1.4 Ce que les critiques ont cassé

Les corrections les plus lourdes, en langage simple. Chacune a été vérifiée dans le code.

1. **« Coller une fiche, 4 clics, premier profil trié » ne pouvait pas marcher.** À la création, rien ne cherche ni ne note de profils côté serveur : la recherche tourne dans le navigateur, sur l'écran Sourcing (`useLinkedInSearchActions.ts:969-998`), et la notation part d'un bouton de cet écran (`SearchResultsPanel.tsx:623-641`). Arriver sur Pipeline après la création, c'était arriver devant rien. Il faut une tâche serveur « chercher et noter » (lot 4, avancé avant la création). Une partie existe déjà : un travail de fond qui note les profils d'une mission (`process-agent-tasks`, lancé par l'outil d'assistant `start_background_scoring`, `agent-tools-mutations.ts:4118`).
2. **« Une seule façon de changer l'étape » cachait douze écrivains.** Des webhooks, la messagerie, l'extension Chrome, l'agenda, les séquences et la notation elle-même écrivent le statut, chacun avec son vocabulaire. Deux exemples graves : une réponse LinkedIn fait passer le candidat en « A répondu » **dans toutes les missions de l'organisation**, y compris celles où on ne l'a jamais contacté (`unipile-webhook/index.ts:1096-1117`) ; et chaque nouvelle notation remet le statut à « noté » ou « écarté » quelle que soit l'étape du candidat (`score-profile-job/index.ts:2528, 2548`, trouvé en vérifiant les critiques). Le lot 0 devient trois lots, de taille « plus que G ».
3. **Les réponses des candidats, notre exemple phare, ne sont rattachées à aucune mission.** Une réponse n'est liée à une mission que si le candidat est inscrit à une séquence qui porte la mission (`unipile-webhook/index.ts:1234-1269`). En production, aucune séquence n'en porte (Q5), et les messages directs ne rattachent jamais rien. Il faut enregistrer, à chaque envoi, le lien entre la conversation et la mission.
4. **En formule gratuite, « Contacter » menait à un mur.** Les 17 organisations sont en gratuit, où les séquences sont interdites (`featureGates.ts:79`), alors que le serveur laisse partir un message individuel (`unipile-search/index.ts:417-418`). C'est une décision de votre ressort (section 15, décision 2).
5. **Le découpage laissait les séquences inaccessibles pendant quatre lots.** La vue Prise de contact est le seul endroit qui affiche les séquences et les invitations (`MissionOutreach.tsx:221, 231`). La retirer au lot 1 sans remplaçant avant le lot 5 cassait l'outil. Le lot 1 garde un accès provisoire.
6. **La carte Maintenant aurait menti par omission.** Sans source pour les réponses, les avis du client ou les entretiens, elle aurait dit « Rien ne presse » alors qu'un candidat attendait. Désormais, « Rien ne presse » est interdit tant qu'un signal n'est pas couvert, et la carte dit ce qu'elle ne surveille pas encore.
7. **Les entretiens n'ont presque pas de source.** Planifier un entretien dans Konekt n'envoie aucune invitation (`CreateEventModal.tsx:229`), la synchronisation d'agenda ne reconnaît qu'un type de rendez-vous, et la production compte 1 entretien en 30 jours. « 3 clics, entretien compris » était faux.
8. **Le ton des messages et le lien de rendez-vous ne pouvaient pas partir dans les Paramètres.** Ce sont des réglages de chaque mission (anonymiser le client, rôle de l'expéditeur), lus par quatre programmes serveur. Ils restent dans la mission, en Cadrage.
9. **La fiche candidat est partagée avec quatre écrans hors mission** (`/pipeline`, tableau de bord, recherche, fiche de poste). La refondre changeait ces écrans sans le dire. La mission aura son propre panneau.
10. **« Annuler l'envoi pendant quelques secondes » était une promesse impossible** : un message LinkedIn part tout de suite et ne se retire pas. L'annulation vaut pour le tri et les étapes, jamais pour un envoi.

---

## 2. Le principe, en trois phrases

1. **Une mission s'ouvre sur ce qui attend votre action.** En tête, une seule carte « Maintenant », choisie par une règle affichée ; dessous, les candidats en cours, chacun avec son étape et sa prochaine action.
2. **Tout geste part d'un candidat ou d'une sélection**, et se fait dans un panneau à droite ou en mode « un par un » : la liste reste sous les yeux, rien ne change de page.
3. **Le reste est à un clic, jamais en travers du chemin** : le Sourcing pour chercher en volume, le Cadrage pour décrire le poste. Aucun verrou, et chaque chiffre se lit dans la même source que la liste. **Un signal dont la source n'existe pas n'est jamais affiché comme un zéro.**

---

## 3. Structure de la mission

### 3.1 Trois écrans et quatre panneaux

```
/missions/:id                      Pipeline  (écran d'accueil par défaut)
/missions/:id/sourcing             Sourcing
/missions/:id/cadrage              Cadrage

Panneaux à droite, un seul ouvert à la fois, sans voile noir, inscrits dans l'adresse
(&panneau=...), donc refermés par le bouton Retour :
   Fiche candidat      Aperçu, Échanges, Évaluations, Profil
   Prise de contact    les séquences de la mission et les personnes contactées
   Client              portail, candidats présentés, avis reçus (cabinet et indépendant)
   Assistant           la conversation de cette mission
```

- **Trois onglets dans l'en-tête** : Pipeline, Sourcing, Cadrage. Ils remplacent le stepper de trois phases et la rangée de sous-onglets (`PhaseStepper.tsx`, `MissionWorkspaceV2.tsx:181-212`).
- **Aucun verrou.** Un écran sans objet s'ouvre sur un état vide qui dit pourquoi et propose l'action utile (section 9).
- **Le bouton Retour** revient à l'écran ou au panneau précédent. Aujourd'hui, tout changement de vue remplace l'historique (`replace: true`, `MissionWorkspaceV2.tsx:116`).
- **Les adresses en chemin demandent quatre retouches** (F-I1), sinon la barre latérale se trompe de mission et chaque onglet recharge la page :
  - déclarer la route `/missions/:id/*` (aujourd'hui seule `/missions/:id` existe, `App.tsx:169`) ;
  - dans la mise en page, donner une seule clé à toute la mission, comme pour `/settings` (`AppLayout.tsx:34`), sinon chaque onglet recrée la page, panneaux ouverts perdus ;
  - lire la vue dans le chemin, avec une correspondance non exacte, dans `MissionVisitTracker.tsx:26-27` et `MissionsPanel.tsx:29-30` qui lisent aujourd'hui `?tab=` ;
  - convertir les « dernières vues » déjà enregistrées (`useMissionVisits`).
- **Un seul panneau à la fois, mais la fiche ne s'efface pas pour l'assistant** (U-M2) : les trois demandes toutes prêtes depuis une fiche (« Préparer l'entretien », « Rédiger une relance », « Résumer pour le client ») affichent leur résultat dans l'onglet Aperçu de la fiche. Seule une conversation libre ouvre le panneau Assistant.

### 3.2 Où va chaque élément actuel

**Les vues.**

| Aujourd'hui | Demain | Pourquoi |
|---|---|---|
| Stepper de 3 phases et sous-onglets | **Disparaissent.** Trois onglets à plat | Les phases ne suivent pas le travail réel (P6). Leurs coches sont fausses (`PhaseStepper.tsx:48-52`) |
| Vue d'ensemble | **Disparaît.** Remplacée par la carte Maintenant et la barre d'étapes de Pipeline | Ses chiffres lisent des colonnes qui n'existent pas (`MissionOverviewV2.tsx:213-215`) |
| Brief | **Cadrage**, sections « Critères » et « Le poste » | Mêmes données, modifiées aux mêmes moments |
| Process | **Cadrage**, section « Étapes d'entretien » | Idem |
| Configuration | **Éclatée**, voir le tableau suivant. **Gardée entière en bas de Cadrage, sous « Réglages », jusqu'aux lots 7 et 8** | Fourre-tout de cinq domaines (P5). L'accès provisoire évite de perdre le portail client avant le lot 8 (F-B2) |
| Sourcing | **Sourcing**, allégé et avec un budget d'encombrement (section 5.1) | La recherche a besoin de toute la largeur |
| Prise de contact (Outreach) | **Le geste « Contacter »** et le **panneau Prise de contact**. **Du lot 1 au lot 5, le panneau affiche `SequencesList` et `InvitationsPanel` tels quels** | Seul endroit qui affiche séquences et invitations (`MissionOutreach.tsx:221, 231` ; `/outreach` redirige vers `/missions`, `App.tsx:179`) |
| Pipeline | **Pipeline**, devenu l'écran d'accueil | C'est le travail à faire |
| Analyses (Insights) | **Le bouton « Bilan »** de Pipeline | Deux « taux de contact » contradictoires, un taux à 200 %, une alerte fausse (P1) |

**Les morceaux de Configuration** (`MissionConfigV2.tsx:93-493`), au terme des lots 7 et 8.

| Élément | Demain |
|---|---|
| Nom de la mission, client | Cadrage > Le poste, saisis une seule fois (fin du doublon, P6) |
| Statut, archiver, dupliquer | Menu « ... » de l'en-tête. Archiver demande une confirmation (absente aujourd'hui, `MissionConfigV2.tsx:119-134`) |
| Ton des messages (mode de recrutement, rôle de l'expéditeur, anonymiser le client) et lien de prise de rendez-vous | **Restent propres à la mission**, dans Cadrage > Le poste, bloc « Vos messages » (F-I2). Ils sont stockés dans `job_details.outreach_config` (`MissionConfigV2.tsx:361-374`) et `calendly_link`, et lus par `process-sequences` (`:3717-3722`), `generate-outreach-message`, `generate-reply-suggestions` (`:165-171`) et `_shared/outreach-context.ts`. Une valeur par défaut au niveau de la personne ou de l'organisation viendra plus tard, avec une migration |
| Notes internes | Fusionnées avec « Contexte » dans Cadrage > Le poste |
| Portail client | Panneau Client, et action « Présenter au client » dans Pipeline (cabinet et indépendant) |
| Mode chasse | Cadrage > Équipe et recruteurs externes, pour les entreprises seulement. **Une seule porte** : l'entrée « Confier à des cabinets » du menu « ... » est retirée (F-I13) |

**Dans l'écran Sourcing, ce qui est retiré** (de B, confirmé par les trois juges) :
- le bandeau « Aller au brief », qui contredit « Générer & chercher » juste dessous (`MissionSourcing.tsx:104-125`) ;
- « Générer & chercher », qui lance sans validation (`SourcingFlow.tsx:149, 173-176`), remplacé par la fenêtre de revue des filtres ;
- `FilterWizard`, monté mais jamais ouvert (`LinkedInSearch.tsx:1385-1398`) ;
- la deuxième barre en langage naturel, le deuxième éditeur et le deuxième historique de la boîte « Avancé » (`SearchFiltersPanel.tsx:385-540`) ;
- les 8 pastilles de statut à emoji (`SearchResultsPanel.tsx:538-591`), remplacées par trois groupes : À trier, Retenus, Écartés ;
- **l'archivage automatique par l'IA, aux deux endroits où il existe** : dans le navigateur après notation (`useLinkedInScoring.ts:1262-1264`) et **côté serveur**, où la notation écrit « écarté » sous 60 (`score-profile-job/index.ts:2528`) ; plus la bascule seule du filtre (`useLinkedInScoring.ts:1300-1301`), la fenêtre de rapport qui recouvre la liste (`BatchScoringReport.tsx:94`) et la case désactivée d'un profil « skip » (`LinkedInResultCard.tsx:309-319`) ;
- **la douzaine de filtres rapides** de `SmartOverlays.tsx:100-200` (« Prêts à bouger », « Top écoles », « Hors ESN »…) quittent la zone des résultats pour le panneau de filtres (U-I5).

**Dans Prise de contact, ce qui part ailleurs, et quand :**
- « Invitations » (invitations LinkedIn reçues par le compte, toutes missions confondues, `InvitationsPanel.tsx:36-41`) : dans la messagerie, au lot 5. D'ici là, dans le panneau provisoire ;
- « Journal », « Analytics », « Diagnostic » : dans le détail de chaque séquence, au lot 5 ;
- « Envoyer tout » et les **modèles de séquence** (séquences sans mission, affichées aujourd'hui dans chaque mission, `SequencesList.tsx:169-172`) : dans un **écran « Séquences » au niveau de l'organisation**, au lot 5 (F-B2). « Envoyer tout » agit sur toute l'organisation (`SequencesList.tsx:128-157`) ;
- le bandeau « N candidats Go prêts » : retiré, il lit une table qui n'existe pas (`MissionOutreach.tsx:88`, Q6).

**Autres retraits :**
- la vidéo tutoriel ouverte d'office dans Pipeline (`MissionPipeline.tsx:531-540`) ;
- l'état vide et ses chiffres marketing écrits en dur (`EmptyMissionState.tsx:216-218`) ;
- le sélecteur de modèle « ~3 cr AUTO » à chaque message de l'assistant (`ModelPicker.tsx:83`) ;
- les champs qu'aucun code ne lit : `reference`, `voice_transcript`, et les champs de réunion du process (P6). **Les 4 champs de l'interlocuteur client du brief ne sont plus supprimés** : ils sont réduits à un seul interlocuteur (nom, e-mail) dans Cadrage > Le poste, qui sert aussi au portail et aux relances (U-I8, qui relevait la contradiction de la version précédente) ;
- les boutons qui promettent une IA absente : « Réoptimiser avec l'IA » (`MissionProcessV2.tsx:98-123`) et les promesses du Process sur les visios et le scoring adapté (`shared.tsx:353, 371`).

**Fichiers supprimés à terme** (après vérification des appelants) : `MissionOverviewV2.tsx`, `PhaseStepper.tsx`, `MissionInsights.tsx`, `MissionOutreach.tsx` (après le lot 5), `MissionConfigV2.tsx` (après les lots 7 et 8), `FilterWizard.tsx`, `EmptyMissionState.tsx`, `useMissionReadiness.ts`, et `computeNextStep` de `ProjectsListV2.tsx:73-130` (U-I4).

### 3.3 Une seule étape par candidat (le socle, révisé)

C'est la condition pour que tout le reste dise vrai. Aujourd'hui, un candidat écarté dans le tableau reste « Entretien RH » dans le kanban, et cinq vocabulaires d'étape coexistent (P2).

**Le modèle** (F-B1, U-I2, F-I6). Une lecture unique partagée par la mission et le `/pipeline` global est impossible telle quelle : le `/pipeline` a 10 étapes fixes (`useATSData.ts:50-61`), alors que dans une mission l'étape d'entretien est l'identifiant d'une étape propre à cette mission (`MissionPipeline.tsx:322-330`). D'où deux niveaux :

| Champ | Contenu |
|---|---|
| **Étape générale** (commune à toutes les missions) | À trier · Retenu · Contacté · A répondu · En entretien · Embauché · Écarté |
| **Étape d'entretien** (`process_step_id`) | L'étape de la mission quand l'étape générale est « En entretien », vide sinon |
| **Date d'entrée dans l'étape** (`stage_entered_at`) | Pour « depuis 6 j ». Conservée lors d'un réordonnancement des étapes, car `replace_process_steps` supprime puis réinsère les étapes et reclasse les candidats (`20260906084418_replace_process_steps_rpc.sql:68-124`) (F-M2) |
| **Origine de la décision** (`decision_source`) | `ai` ou `user` : distingue « écarté par l'IA, à confirmer » d'un écart décidé par le recruteur. Aujourd'hui les 719 écartés de production sont indiscernables (`useJobCandidateStatus.ts:283-330`, Q7) |
| **Jalons datés** | `contacted_at`, `replied_at`, `first_interview_at`, `presented_at`, `hired_at`, `rejected_at`, plus l'étape atteinte au moment de l'écart. Le Bilan se calcule sur ces dates, pas sur l'étape actuelle (U-I2) |

- **Le `/pipeline` global affiche l'étape générale ; la mission affiche l'étape d'entretien.**
- **« Présenté au client » est un jalon, pas une étape** : un candidat peut être présenté puis passer en entretien.
- **Les profils trouvés mais jamais ouverts ni notés restent dans le Sourcing.** En production, cela retire 885 lignes sur 1 819 du Pipeline (Q7).
- **L'identifiant de mission ne change pas** (F-B1). `project_id` est déjà renseigné sur 100 % des lignes par le déclencheur `resolve_jcs_project_id` (Q7). Toutes les lectures passent par `project_id`, y compris `ScorecardTab.tsx:197-202` qui cherche aujourd'hui par `job_id`. On **ne** convertit **pas** `job_id` : cela toucherait une dizaine d'occurrences de « project: » dans la recherche et la notation, la zone la plus fragile.

**Une seule façon de changer l'étape : une fonction SQL `set_candidate_stage(ligne, étape, source)`**, appelée par tous les programmes qui écrivent. Voici l'inventaire vérifié des écrivains actuels (U-B2, F-B1, plus un trouvé en vérifiant) :

| Écrivain | Ce qu'il fait aujourd'hui | Défaut |
|---|---|---|
| `MissionPipeline.tsx:336-351` | Toute étape inconnue devient « shortlisted » | Fait baisser « Contacté » |
| `unipile-webhook/index.ts:1096-1117` et `:1497-1513` | Passe en « replied » toutes les lignes du candidat dans l'organisation, y compris « discovered » et « scored » | Réponse affichée dans des missions où on ne l'a jamais contacté |
| `auto-analyze-message/index.ts:487-521` | Écrit « interested » ou « not_interested » et **écrase `recommendation`** par un résumé | Aucun filtre d'organisation ni de mission |
| `calendly-webhook/index.ts:298-305` | Écrit « qualification » et « Pré-qualif » | Candidat trouvé sans filtre d'organisation, ligne la plus récente (`:189-194`) |
| `process-sequences/index.ts:1196-1212` et `:1635-1647` | Passe en « replied » | Le second site n'a pas de filtre d'organisation |
| `add-to-shortlist/index.ts:217-218, 265-266` | Écrit « shortlisted » et « Pressenti » | Vocabulaire du `/pipeline` |
| `useMessagesInbox.ts:1120-1143` | Écrit « messaged » | |
| `ProfileDetailSheet.tsx:1123-1129` | Écrit « messaged » | |
| `extension-quick-add/index.ts:94-113` | Crée en « discovered » | |
| `CreateEventModal.tsx:186-199` | Crée en « shortlisted » / « Pressenti », avec un identifiant de candidat tiré au hasard (`:183-184`) | Candidat impossible à contacter ensuite |
| **`score-profile-job/index.ts:2528-2548`** | Chaque notation réécrit le statut en « scored » (60 et plus) ou « dismissed » (moins de 60), filtré par candidat et mission seulement | **Un candidat en entretien renoté repasse « noté » ou « écarté ». Non relevé par les critiques, trouvé en les vérifiant** |
| Outils de l'assistant (`agent-tools-mutations.ts:42-53`) | N'acceptent que les 10 étapes du `/pipeline` | Sixième vocabulaire |

Règles de la fonction :
- **Une écriture liée à une réponse ne touche que la mission de la conversation** (voir « lien conversation et mission », section 5.3), et seulement les lignes « Contacté » ou au-delà. **Jamais une ligne « À trier » ou « Retenu » ne monte en « A répondu ».**
- **La notation n'écrit que la note et sa raison**, jamais l'étape. Un profil sous le seuil reste « À trier » avec `decision_source = ai` et la suggestion « écarter ».
- **`recommendation` n'est plus jamais écrasé** par l'analyse d'un message : le résumé va dans son propre champ.
- **Compatibilité** : pendant la transition, `status` et `pipeline_stage` restent remplis par la fonction, parce que l'extension Chrome lit les valeurs brutes (`extension-pipeline-status/index.ts:1-10, 154-167`) et qu'elle ne se met pas à jour le même jour que le site, et parce que deux déclencheurs de statistiques comptent sur `status` (`20260702121429_sync_mission_stats_trigger.sql:47-50`, `20260504130000_shortlist_stats_trigger.sql:44-51`). Ces déclencheurs sont réécrits sur le nouveau modèle.
- **Un déclencheur de refus des écritures directes** n'est posé qu'une fois tous les écrivains migrés (fin du lot 0b), pour ne rien casser en route.
- **L'assistant ne change une étape qu'avec un clic** : `update_candidate_stage` est ajouté à la liste des outils jamais automatiques (`agent-tools.ts:127-133`). Aujourd'hui une organisation peut le passer en automatique, car il est classé `mutation_safe` (`agent-tools-mutations.ts:56-63`) et `resolveEffectivePolicy` l'autorise (`agent-tools.ts:165-173`) (F-I4).

---

## 4. L'écran d'accueil : Pipeline

### 4.1 Ordinateur, 1440 × 900, barre latérale dépliée

Données de la mission simulée du banc de captures (`banc/seed.mjs:51-130`) : « Directeur financier », client Groupe Hélios, interlocutrice Anne Leclerc, trois étapes d'entretien, la séquence « Approche Directeur financier », 40 profils. Noms, étapes, notes et durées viennent de ce jeu. Les textes des messages sont illustratifs. **Maquette révisée** : la colonne « Prochaine action » n'affiche que des règles de la section 4.3 ; une ligne sans règle dit « Aucune action depuis N j » (U-M6). La barre latérale ne déplie plus d'entrées pour la mission ouverte (U-M1).

```
+- Barre latérale -+ +------------------------------------------------------------------------------------------+
| À traiter (1)    | | [=]  Missions > Directeur financier v  · Groupe Hélios   (o) Active                        |
| Missions         | |      [ Pipeline ]  Sourcing  Cadrage                          Assistant    ...           | 48 px
| Assistant        | +------------------------------------------------------------------------------------------+
|                  | |  MAINTENANT                                                                              |
| > Directeur fin. | |  +------------------------------------------------------------------------------------+  |
|   (ouverte)      | |  | Marc Moreau vous a répondu hier                                        Note 80      |  |
| Épinglées        | |  | Directeur administratif et financier, Schneider Electric                            |  |
| Mes missions     | |  | « Bonjour, le poste m'intéresse, je suis disponible la semaine prochaine. »        |  |
|                  | |  |                                                                                    |  |
|                  | |  | [ Répondre ]                               Pourquoi maintenant ?     Plus tard      |  |
|                  | |  +------------------------------------------------------------------------------------+  |
|                  | |  Ensuite : Camille Fontaine sans nouvelles depuis 6 j · Trier 4 profils notés ·          |
|                  | |            Olivier Rousseau embauché : clore la mission ?                                 |
|                  | |                                                                                          |
|                  | |  EN CE MOMENT                                                                            |
|                  | |  Sourcing et contact : À trier 4 · Retenus 0 · Contactés 3 · A répondu 1                 |
|                  | |  Suivi : Qualification 3 · Entretien DG 2 · Cas pratique 2 · Embauché 1      Écartés 3 > |
|                  | |                                     [ Liste | Par étape ]  Bilan  Prise de contact  Client |
|                  | +------------------------------------------------------------------------------------------+
|                  | | [ ] Candidat                          Étape              Prochaine action        Depuis Note|
|                  | | [ ] Marc Moreau                       A répondu          Répondre (hier)          1 j    80 |
|                  | |     DAF, Schneider Electric                                                              |
|                  | | [ ] Camille Fontaine                  Entretien DG       Relancer Anne Leclerc     6 j    83 |
|                  | |     Directeur du contrôle de gestion, Verallia                                           |
|                  | | [ ] Isabelle Laurent                  Qualification      Aucune action depuis 5 j  5 j    77 |
|                  | | [ ] Hélène Morel                      Cas pratique       Aucune action depuis 4 j  4 j    86 |
|                  | | [ ] Nadia David                       Qualification      Aucune action depuis 2 j  2 j    84 |
|                  | | [ ] Thomas Lambert                    Qualification      Aucune action depuis 2 j  2 j    81 |
|                  | | [ ] Pierre Bertrand                   Entretien DG       Aucune action depuis 1 j  1 j    88 |
|                  | | [ ] Antoine Simon                     Cas pratique       Aucune action depuis 0 j  0 j    90 |
|                  | | [ ] Claire Dubois                     Contacté           Relance auto le 26/09     3 j    78 |
|                  | | [ ] Julien Roux                       Contacté           Relance auto le 26/09     3 j    74 |
|                  | | [ ] Sophie Dupont                     Contacté           Relance auto le 26/09     4 j    71 |
|                  | | [ ] Olivier Rousseau                  Embauché           -                         0 j    92 |
|                  | | --- À trier (4) --------------------------------------------- [ Trier un par un ] ----- |
|                  | |     Laure Michel 69 · Nicolas Fournier 62 · Aurélie Vincent 58 · Vincent Lefebvre 51  (replié)|
| Tâches  ...      | |                                                                                          |
+------------------+ +------------------------------------------------------------------------------------------+
```

Remarques sur la maquette :
- **« Marc Moreau vous a répondu »** suppose que la réponse est rattachée à la mission et arrive sur votre propre compte LinkedIn (section 4.3, rang 3). Dans le banc, Marc est inscrit à la séquence de la mission.
- **« Relance auto le 26/09 »** est une information tirée de la séquence, pas une action : elle ne monte jamais dans Maintenant.
- **« Relancer Anne Leclerc »** suppose que l'interlocutrice a une adresse e-mail en Cadrage (section 5.5).

### 4.2 Les zones, de haut en bas

**1. Un seul en-tête, 48 px** (de A et B).
- Il vit dans l'en-tête d'application, qui accepte déjà du contenu (`AppHeader.tsx:49, 61`) mais n'en reçoit aucun (`AppLayout.tsx:44`).
- On passe de 168 px de bandes empilées (P5) à 48 px, plus la barre d'étapes.
- **Le nom de la mission est un menu** : il ouvre la liste des autres missions et garde l'écran en cours. C'est le menu prévu au lot 3 de la barre latérale (`design-doc.txt:87`).
- **Le statut** est un menu à part (Active, En pause, Pourvue, Archivée).
- **« Assistant »** ouvre le panneau de l'assistant sur cette mission (section 8).
- **« ... »** : dupliquer, archiver (avec confirmation). Plus de « Confier à des cabinets » (une seule porte, en Cadrage).

**2. Maintenant** (de B).
- Une carte, une phrase, au plus trois lignes de contenu réel, **un seul bouton plein**.
- **La carte suit toujours la même forme** (de C) : le fait, avec les noms et les nombres ; ce que l'on propose ; la donnée qui le justifie. **Une carte sans justification ne s'affiche pas.**
- **« Pourquoi maintenant ? »** affiche la règle appliquée, en clair.
- **« Plus tard »** reporte au lendemain et fait monter l'action suivante. Le report est enregistré par personne (lot 3). **Il n'agit jamais sur le chiffre d'À traiter** de la barre (F-I11).
- **« Rien ne presse »** ne s'affiche que si **tous** les rangs sont couverts par une source (section 4.3, colonne « Source »). Sinon, la carte dit ce qu'elle ne surveille pas : « Rien d'autre à faire. Les réponses ne sont suivies que pour les conversations ouvertes depuis Konekt. » (F-B3).
- **« Prochain rendez-vous »** ne s'affiche que si un entretien daté existe (U-I1).

**3. Ensuite** (de B). Une ligne, au plus trois actions en attente, chacune cliquable.

**4. La barre d'étapes** (de A, avec les libellés de phase gardés).
- Titrée **« En ce moment »** : ce sont les effectifs actuels, pas des cumuls. Le Bilan dit « depuis le début » et « ont été contactés » (U-I2), pour ne jamais montrer deux nombres de « contactés » qui semblent se contredire.
- Deux groupes, titrés avec les noms de phase déjà décidés : « Sourcing et contact » et « Suivi ». Retirables sans autre changement (décision 5).
- Les étapes d'entretien viennent de la vraie liste de la mission (P1). Une étape à zéro reste affichée, en gris.
- **Les effectifs viennent d'une fonction de comptage côté serveur, par étape**, livrée avec le lot 0c : aujourd'hui `get_project_stats` compte par statut, pas par étape d'entretien (F-I10).
- **À droite, une ligne d'outils** : « Liste | Par étape » (le kanban actuel), « Bilan », « Prise de contact », « Client ».

**5. La liste des candidats en cours** (de A).
- Une ligne par candidat : étape, prochaine action, depuis combien de jours, note.
- **Tri par défaut** : la prochaine action la plus urgente, puis la note. **L'ordre est figé pendant la session** : une action ne fait pas sauter les lignes, et un lien « Actualiser l'ordre » apparaît quand l'ordre a changé (U-M3).
- **Un clic sur une ligne ouvre la fiche à droite**, sans voile. Aujourd'hui, les lignes du tableau ne s'ouvrent pas (`ProjectCandidatesTableEnhanced.tsx:448-451`).
- **Les profils à trier** forment une section repliée en bas, avec « Trier un par un ».
- **Les écartés** sont derrière « Écartés 3 > ».
- **Une sélection fait apparaître la barre d'actions groupées** : Contacter · Étape suivante · Présenter au client · Écarter.
- **Pagination par 50, en colonnes légères** (F-I10). Aujourd'hui `useProjectCandidates` charge tout, lourd profil LinkedIn compris, sans limite (`useSourcingProjects.ts:336-349`), et `supabase/config.toml` ne fixe pas `max_rows` : la limite par défaut de 1 000 lignes est à vérifier sur le projet, car une mission plus grosse serait tronquée sans le dire. Le modèle de colonnes légères existe (`LIGHT_COLUMNS`, `useJobCandidateStatus.ts:97`).

### 4.3 La règle de la prochaine action

Une seule règle, écrite une fois, sert à la fois à la carte Maintenant, à la colonne « Prochaine action » de chaque ligne **et à la liste des missions** (U-I4 : aujourd'hui `computeNextStep`, `ProjectsListV2.tsx:73-130`, suit l'ancienne règle, met le poste en premier et vise des vues qui disparaissent ; il est retiré au lot 0c, et la liste n'affiche aucune prochaine étape jusqu'au lot 3).

La colonne **« Source »** est nouvelle (F-B3) : elle dit d'où vient le signal, et à partir de quel lot il est fiable. Un rang sans source n'est pas affiché ; il empêche « Rien ne presse ».

| Rang | Situation | Phrase de Maintenant (exemple) | Bouton | Source, lot |
|---|---|---|---|---|
| 0 | Un blocage empêche l'action suivante : compte LinkedIn déconnecté, formule qui interdit l'envoi choisi, type d'organisation absent, droits | « Votre compte LinkedIn est déconnecté : les envois de cette mission sont en pause. » | Reconnecter (retour sur la mission) | État LinkedIn (`linkedinStatus.ts`), formule, type d'organisation. Lot 3. Le type absent se distingue du chargement : `hasFeature` renvoie aussi faux pendant le chargement (`featureGates.ts:48-53`), sinon le blocage clignote à chaque ouverture (F-M9) |
| 1 | Entretien aujourd'hui | « Entretien avec Nadia David à 10 h. » | Préparer l'entretien | Entretiens créés dans Konekt ou date saisie au passage en entretien (section 5.7). Sans nom d'étape tant que `qualification_sessions` n'a pas `process_step_id` (lot 6) |
| 2 | Entretien passé sans verdict | « Notez l'entretien de Pierre Bertrand, hier 14 h. » | Noter l'entretien | Idem |
| 3 | Réponse d'un candidat non traitée, **sur votre propre compte LinkedIn** | « Marc Moreau vous a répondu hier. » | Répondre | « Le dernier message de la conversation vient du candidat », conversation rattachée à la mission (section 5.3). Lot 0b pour le rattachement, lot 3 pour l'affichage. Les réponses reçues par un collègue s'affichent dans Ensuite, sans bouton : « Marc a répondu à Julie » (U-I3) |
| 4 | Avis du client reçu | « Anne Leclerc a donné son avis sur Camille Fontaine. » | Voir l'avis | Lot 8. Aujourd'hui l'avis est enregistré par ligne candidat (`client-portal-data/index.ts:208-221`) et la fiche du recruteur ne le lit pas |
| 5 | Proposition de l'assistant à valider sur cette mission | « L'assistant propose d'ajouter 2 critères au poste. » | Relire | Lot 9 : les conversations n'ont aujourd'hui aucune mission (0 sur 98, Q12) |
| 6 | Candidat en entretien sans nouvelles depuis plus de 5 jours | « Camille Fontaine attend depuis 6 jours après l'entretien avec la directrice générale. » | Relancer Anne Leclerc (cabinet), l'intervieweur de l'étape (entreprise), sinon « Ajouter l'interlocuteur » | Date d'entrée dans l'étape (lot 0a) |
| 7 | Retenus pas encore contactés | « 4 candidats retenus attendent un premier message. » | Contacter les 4, **ou en formule gratuite** « Écrire à Laure Michel (1 sur 4) » selon la décision 2 | Étapes (lot 0a). « Déjà contacté hors de Konekt » le fait sortir (section 4.4) |
| 8 | Profils notés à trier | « 4 nouveaux profils notés, dont 1 recommandé. » | Trier les 4 | Effectif « À trier » (lot 0a). C'est aussi lui qui pilote le point « nouveaux profils » de la barre (U-M5) |
| 9 | Relances prévues aujourd'hui | « 2 relances prévues aujourd'hui. » | Relancer | Séquences de la mission (lot 5) |
| 10 | Aucun profil, poste décrit | « Le poste est décrit. Lancez une première recherche. » | Chercher des profils | Lot 3 |
| 11 | Poste vide | « Décrivez le poste pour commencer. » | Coller une fiche de poste | Lot 3 |
| 12 | Rien d'autre, **tous les rangs couverts** | « Rien ne presse. » (+ prochain rendez-vous s'il existe) | (aucun) | |

Quatre principes :
- **Ce qu'une personne attend passe en premier** : candidat, client, collègue.
- **Le cadrage ne bloque rien, pas même la notation.** Aujourd'hui la notation refuse de partir sur un poste vide (« Brief incomplet », `useLinkedInScoring.ts:915-926`). Désormais, elle note sur l'intitulé et affiche « note provisoire » (U-B1). Le cadrage est suggéré en tête du tri (« Les notes seront plus justes avec 3 critères. Ajouter »).
- **Le blocage (rang 0) ne s'affiche que s'il empêche l'action suivante**, et **une seule fois** : un refus de formule n'est pas un mur qui revient chaque jour (U-B4).
- **Une action s'adresse à celui qui peut la faire** : une réponse, à la personne dont le compte LinkedIn l'a reçue (les notifications partent vers les membres liés au compte, `unipile-webhook/index.ts:1195-1198`) ; le reste, au propriétaire de la mission.

L'embauche d'Olivier Rousseau n'arrête rien : elle apparaît dans « Ensuite » (« clore la mission ? »).

### 4.4 La fiche candidat, à droite (de A)

```
+------ liste (rétrécie) -------------+ +-- Camille Fontaine ------------------------- x --+
| Marc Moreau      A répondu  ...     | | Directeur du contrôle de gestion, Verallia       |
|>Camille Fontaine Entretien DG ...   | | Paris · Note 83                                  |
| Isabelle Laurent Qualification ...  | |                                                  |
| ...                                 | | Entretien avec la directrice générale, depuis 6 j |
|                                     | | Présentée au client le 17/09                      |
|                                     | | [ Relancer Anne Leclerc ]  [ Étape suivante > ]   |
|                                     | |                                                  |
|                                     | | Pourquoi 83 : consolidation IFRS (oui), LBO (oui),|
|                                     | | équipe de plus de 10 personnes (non établi)       |
|                                     | |                                                  |
|                                     | | Aperçu · Échanges · Évaluations · Profil          |
+-------------------------------------+ +--------------------------------------------------+
```

- **Un panneau propre à la mission**, qui réutilise les onglets existants (F-I8). `ProfileDetailSheet` reste intact : il sert aussi la recherche (`SearchResultsPanel`), et par `CandidateDetailModal` le `/pipeline` global, le tableau de bord et la fiche de poste (`ATS.tsx`, `Dashboard.tsx`, `JobDetailSheet.tsx`).
- **En haut, toujours visibles** : l'étape, depuis quand, la prochaine action et un bouton principal qui dépend de l'étape.
- **La raison de la note, critère par critère, seulement si le poste a des critères structurés** (U-I6). Le détail par critère n'est produit que si le poste a des `evaluation_criteria` (`score-profile-job/index.ts:1764-1775`), soit 3 missions sur 14 en production (Q3). Sans critères : « Points forts » et « Réserves », sans prétendre à un détail par critère.
- **Note calculée avant une modification du poste** : marquée comme telle, avec « Recalculer » (section 5.6).
- **« Déjà contacté (téléphone, e-mail, LinkedIn) »** dans la fiche et dans le tri un par un (U-I7). Un contact fait hors de Konekt n'est aujourd'hui jamais pris en compte.
- **Écarter un candidat qui a répondu ou passé un entretien** propose « Prévenir le candidat », message rédigé, coché par défaut (U-M9).
- **Quatre onglets au lieu de neuf** (`CandidateDetailModal.tsx:322`) : Aperçu (notes, rappels, résultats des demandes à l'assistant), Échanges, Évaluations, Profil.
- **Changer d'étape ne ferme pas la fiche** (aujourd'hui oui, `MissionPipeline.tsx:651-654`). **Les flèches haut et bas** passent au candidat voisin. **Pas de voile noir** (`ui/sheet.tsx:22`).

---

## 5. Les autres écrans et panneaux

### 5.1 Sourcing

Le travail en volume : chercher, lire, trier par lots.

- **La recherche actuelle est gardée**, avec les retraits listés en 3.2.
- **Budget d'encombrement, mesuré sur le banc de captures** (U-I5) : au plus 12 contrôles au-dessus du premier résultat ; premier résultat à 250 px au plus en 1440 × 900, à 400 px au plus en 390 × 844 (il est aujourd'hui à 746 px sur téléphone, P5). Colonnes par défaut du tableau : nom, poste, note, raison.
- **Une mission déjà travaillée ne s'ouvre plus vide** (de B), avec deux précisions (U-M8, F-M6) :
  - chaque recherche reçoit un identifiant (`search_id`) inscrit sur les profils qu'elle a trouvés. Aujourd'hui `search_history` ne garde pas les résultats (`types.ts:5109`) et les profils n'ont pas d'identifiant de recherche : relire « les derniers résultats » mélangerait toutes les recherches passées (271 profils pour m6, Q8) ;
  - l'écran affiche « Résultats du 18/09 » et « Relancer pour voir la suite » (le curseur de pagination de la recherche ne se restaure pas) ;
  - **la base fait foi pour les profils, le cache en mémoire garde l'état de l'écran** (filtres, défilement, sélection).
- **Deux portes pour les filtres, pas neuf** : la barre « Affiner » en langage naturel, et le panneau de filtres.
- **Trois groupes de résultats** : À trier, Retenus, Écartés. Les profils que l'IA juge hors cible restent dans « À trier », marqués « l'IA suggère d'écarter ». Un bouton « Écarter les 5 suggestions de l'IA » laisse la décision au recruteur (de A).
- **Tri au clavier** (de A) : R pour retenir, E pour écarter (avec trois raisons au choix, de C), **P pour plus tard** (au lieu d'Espace, qui déclenchait le bouton gardant le focus, U-M7). Le focus quitte les boutons après chaque décision.
- **Noter** : bouton « Noter les 25 premiers (au moins 50 crédits) », le plancher étant de 2 crédits par notation (`aiCredits.ts:95`). La notation automatique sans clic n'est lancée qu'à la création, par le bouton qui l'annonce (section 6).
- **« Contacter » sur une sélection** ouvre le panneau Prise de contact, avec les séquences de cette mission. Aujourd'hui, le menu liste les 20 dernières séquences de toute l'organisation (`SequenceEnrollButton.tsx:69-74`).
- **Sans compte LinkedIn**, l'écran dit : « Pour chercher des profils, reliez votre compte LinkedIn. » La liaison ramène sur la mission (section 7 pour le téléphone).
- **Le même écran sert les recherches hors mission** (`/sourcing/:id`, `SourcingSearch.tsx:206`) (F-I9). Hors mission : pas de Cadrage, « Contacter » propose les séquences de l'organisation comme aujourd'hui, et les trois groupes s'appliquent aussi. Chaque lot qui touche le Sourcing recette les deux écrans.

### 5.2 Le mode « un par un » (de B)

Lancé depuis la carte Maintenant ou depuis « Trier un par un ». Il s'ouvre sur place : un élément à la fois, un compteur, trois décisions au plus. Échap ou Retour ramène à la liste (**l'adresse est remplacée, pas empilée**, pour que Retour quitte le mode au lieu de reculer profil par profil, U-M11).

**Tri :**
```
Directeur financier > Trier               1 sur 4                         Revenir (Échap)
------------------------------------------------------------------------------------------
Laure Michel · Directeur administratif et financier, Legrand · Paris       Note 69
Points forts : consolidation IFRS · équipe de 10+   Réserve : LBO non établi
Parcours : Legrand (DAF depuis 2019) · Responsable consolidation · Manager audit

[ Retenir (R) ]   [ Plus tard (P) ]   [ Écarter (E) : Trop junior · Hors zone · Autre ]
                                      [ Déjà contacté ]
```

**Réponses :**
```
Directeur financier > Réponses            1 sur 1                         Revenir (Échap)
------------------------------------------------------------------------------------------
Marc Moreau · DAF, Schneider Electric · Note 80
Contacté le 18/09 par « Approche Directeur financier », étape 2 sur 3
« Bonjour, le poste m'intéresse, je suis disponible la semaine prochaine. »
------------------------------------------------------------------------------------------
Réponse proposée (modifiable) :
« Bonjour Marc, merci pour votre retour. Je vous propose un premier échange en visio :
  vous pouvez choisir un créneau ici [lien de rendez-vous de la mission]. »

Après l'envoi : ( Entretien de qualification v )
[ Envoyer ]          [ Pas intéressé ]          [ Plus tard ]
```

- **Un envoi est toujours un « Envoyer » explicite, après lecture du message** (U-I9). Un message LinkedIn part tout de suite (`unipile-search/index.ts:417-418`) et ne se retire pas. **L'annulation de quelques secondes ne vaut que pour le tri et les changements d'étape.**
- **L'étape qui suit l'envoi est une puce présélectionnée et modifiable**, au lieu d'un long libellé « Envoyer et passer en… » (U-M12).
- **La réponse proposée** vient de `generate-reply-suggestions`. Elle propose **le lien de rendez-vous de la mission, pas des créneaux** : la fonction ne connaît que ce lien (`:159-164`) et n'a pas accès à l'agenda (F-M3). Sans lien : « Quelles sont vos disponibilités la semaine prochaine ? ».
- **Une décision fait tout ce qu'elle annonce** : envoyer, marquer la notification lue (même canal que la barre), faire avancer le candidat par `set_candidate_stage`. Puis l'élément suivant arrive.

### 5.3 Panneau Prise de contact, et lien entre conversation et mission

**Le lien conversation et mission** (U-B3, F-B3). C'est la pièce qui manquait pour que le rang 3 existe.
- **À chaque envoi fait depuis une mission, une fiche ou la messagerie**, on enregistre le lien entre la conversation LinkedIn (ou, à défaut, l'identifiant du profil) et la mission. Aujourd'hui seule l'inscription à une séquence qui porte la mission crée ce lien (`unipile-webhook/index.ts:1234-1269`), et aucune séquence n'en porte en production (Q5).
- **À la réception**, on résout d'abord par la conversation, puis par le profil parmi les lignes de l'organisation au stade « Contacté » ou au-delà (`job_candidate_status.candidate_id`).
- **Rattrapage** : les 17 inscriptions existantes pointent m6 par `job_id` (Q5) ; elles sont rattachées à m6.
- **Une réponse envoyée ailleurs (LinkedIn sur téléphone) efface le rang 3** : le webhook voit nos propres messages et marque déjà les notifications lues (`unipile-webhook/index.ts:953-957`, commit 4a6bcfd). La définition « le dernier message vient du candidat » en découle naturellement.
- **Un message envoyé hors de Konekt à un candidat « Retenu »** de la mission le fait passer en « Contacté » (U-I7).

**Le panneau :**
- **Les séquences de cette mission**, avec leurs inscrits et leurs réponses. Toute séquence créée depuis une mission le sera désormais.
- **La liste des personnes contactées** : en attente, a répondu, sans suite.
- **Contacter une sélection** :
  1. la séquence de la mission est déjà choisie ;
  2. s'il n'y en a pas, « Rédiger une séquence pour cette mission » la prépare à partir du poste (de C, **à la demande**, pas en fond) ;
  3. aperçu du premier message pour le premier candidat ;
  4. « Lancer ». Case « Je confirme les destinataires », reprise de la carte d'approbation existante.
- **En formule gratuite**, selon la décision 2 : soit le **mode un par un** (« Écrire à Laure Michel, 1 sur 4 », message rédigé et modifiable, « Envoyer »), la séquence étant présentée comme une option payante ; soit un refus annoncé une fois, sans retour quotidien.
- **Candidats non contactables** (F-M4) : `SequenceEnrollButton` exige des profils LinkedIn et le compte de l'utilisateur (`SequenceEnrollButton.tsx:35-43`). Les lignes du Pipeline sont converties par `atsCandidateToProfile.ts`, et les candidats créés à la main (identifiant tiré au hasard, `CreateEventModal.tsx:183-184`) sont exclus avec la raison.
- **Les contrôles actuels sont gardés** : doublons sur 90 jours, plafonds LinkedIn, droits de la formule (côté serveur).

### 5.4 Bilan (ex-Analyses)

Un encart qui s'ouvre au-dessus de la liste. Trois taux, **calculés sur les jalons datés** (section 3.3), chacun avec son calcul écrit :
- « 12 retenus sur 15 profils triés **par vous** » (les suggestions de l'IA non confirmées ne comptent pas, grâce à `decision_source`) ;
- « 12 **ont été contactés** sur 12 retenus » ;
- « 9 **ont répondu** sur 12 contactés ».

Titre : « Depuis le début de la mission ». Un candidat qui a répondu puis a été écarté reste compté comme ayant répondu (U-I2). Plus d'alerte « aucune recherche lancée » tant que la date de dernière recherche n'est pas enregistrée (`MissionInsights.tsx:120-135`, aucun écrivain, Q4).

### 5.5 Panneau Client (cabinet et indépendant)

- **« Présenter au client »** : on sélectionne des candidats, on voit l'aperçu exact de la page du client, puis on envoie **le lien de cette mission pour ce client**.
- **Un lien par couple client et mission** (F-I7). Aujourd'hui un lien sans liste de missions ouvre toutes les missions de l'organisation (`client-portal-data/index.ts:79-88`) : il exposerait les candidats d'autres clients. Les liens sans mission sont refusés à la création ; ceux qui existent sont listés avec un avertissement.
- **La page du client ne montre que les candidats présentés** (aujourd'hui toutes les lignes, écartés compris, `client-portal-data/index.ts:107-113`). **Elle vouvoie, et les étapes s'affichent en clair** (`ClientPortalV2.tsx:86-90`).
- **L'avis du client revient** sur la ligne du candidat et dans Maintenant (rang 4).
- **L'interlocuteur** (nom, e-mail) est celui de Cadrage > Le poste. **« Relancer »** ouvre un e-mail pré-rempli, envoyé par le compte e-mail du membre s'il est relié, sinon par la messagerie de l'ordinateur (U-I8). Sans adresse : « Ajouter l'interlocuteur ».
- **Les liens actifs sont listés et révocables**, y compris les 4 liens d'org_1 (Q10).
- **Une entreprise ne voit pas ce panneau**, sous réserve de la décision 9.

### 5.6 Cadrage

Une seule page, quatre sections, dans l'ordre d'impact :

1. **Critères.** **Un seul modèle** (F-I12) : chaque critère a un libellé, une importance (indispensable, souhaité, bonus) et une case « rédhibitoire ». Il est enregistré dans `evaluation_criteria` (poids 3, 2, 1 et `deal_breaker`, `jobDetails.ts:74-82`), que la notation sait lire (`score-profile-job/index.ts:1764-1775`). Les listes `skills_must_have` et `skills_should_have` (`jobDetails.ts:51-52`) en sont déduites à l'enregistrement, pour les lecteurs actuels. Aujourd'hui, seule la création par l'IA écrit des critères structurés (`CreateMissionV2.tsx:412-420`).
   - **Après une modification**, les notes existantes sont marquées « calculées avant la modification du poste » et un bouton propose « Recalculer 25 notes (au moins 50 crédits) ». Aujourd'hui, un profil déjà noté n'est jamais renoté (`useLinkedInScoring.ts:963-965`) (U-I6).
2. **Le poste** : intitulé, client, lieu et télétravail, contrat, rémunération, contexte (un seul texte libre), **interlocuteur (nom, e-mail)**, et le bloc **« Vos messages »** : mode de recrutement, rôle de l'expéditeur, anonymiser le client, lien de prise de rendez-vous.
3. **Étapes d'entretien** : la liste réelle, avec l'intervieweur (0 étape sur 29 en a un aujourd'hui, Q11). Supprimer une étape demande une confirmation qui dit combien de candidats s'y trouvent et où ils iront (aucune aujourd'hui, `shared.tsx:212`).
4. **Équipe et recruteurs externes** : membres de la mission, invitations par e-mail, et pour une entreprise le mode chasse. **La section suit les droits** (F-I13) : un indépendant n'a pas `team_management` (`featureGates.ts:37`), et les formules gratuite et solo n'ont pas `team` (`featureGates.ts:80-81`). Sans droit, la section disparaît (« un élément sans droit disparaît », `design-doc.txt:115`).
5. **Jusqu'aux lots 7 et 8 : « Réglages »**, qui reprend `MissionConfigV2` tel quel (F-B2).

Règles :
- **Un seul calcul de complétude**, sur les champs qui servent (intitulé, lieu, au moins 3 critères indispensables, une étape) (`MissionBriefV2.tsx:1083-1107` contre `missionUtils.ts:8-24`).
- **La dictée remplit les champs visibles** (`MissionBriefV2.tsx:234`).
- **La lecture seule est annoncée** par un bandeau qui donne la raison et le remède, et s'applique aussi aux étapes (`MissionProcessV2.tsx:250-260`).

### 5.7 Entretiens : d'où vient la date (nouveau, U-I1)

La carte Maintenant et la colonne « Prochaine action » parlent d'entretiens. Or :
- « Planifier » (`CreateEventModal`) ne fait qu'insérer une ligne (`CreateEventModal.tsx:229`) : aucune invitation, aucune synchronisation d'agenda ;
- la synchronisation d'agenda ne garde qu'un type de rendez-vous, écrit en dur (`design-doc.txt:166`), et ne reconnaît le candidat que par son adresse LinkedIn (`calendly-webhook/index.ts:179-194`) ;
- la production compte 1 entretien en 30 jours (`design-doc.txt:37`).

Le recruteur planifie dans Outlook ou Google. Deux voies, à trancher (décision 4) :
- **Par défaut : un champ.** Passer un candidat à une étape d'entretien demande « Date de l'entretien ? » (facultatif). Les rangs 1 et 2 se calculent sur cette date. Aucune intégration nouvelle.
- **Plus tard : une vraie invitation.** « Planifier » envoie une invitation (fichier .ics par le compte e-mail du membre, ou lien de rendez-vous) et crée la séance.

Dans les deux cas, `CreateEventModal` reçoit le candidat et la mission en propriétés (il n'accepte aujourd'hui que `open`, `onOpenChange` et `defaultDate`, `CreateEventModal.tsx:52-57`, F-I3), et son écriture de l'étape passe par `set_candidate_stage`. Sans date connue, aucun « Prochain rendez-vous » ne s'affiche.

---

## 6. Création de mission

Une fenêtre, un champ, une validation, et l'on arrive sur la mission avec une action.

```
+ Nouvelle mission ------------------------------------------------------------+
|  Collez la fiche de poste, déposez un fichier (PDF, Word, texte)              |
|  ou décrivez le poste en quelques lignes.                                     |
|  +------------------------------------------------------------------------+  |
|  | DAF pour un groupe industriel familial, 1 200 salariés, Paris, hybride, |  |
|  | 160 à 200 k€. LBO secondaire à préparer, consolidation IFRS…           |  |
|  +------------------------------------------------------------------------+  |
|  Client (facultatif)  [ Groupe Hélios            ]         [ Dicter ]         |
|                                                                               |
|  Remplir le poste moi-même                        [ Annuler ]  [ Continuer ]  |
+-------------------------------------------------------------------------------+
```

**1. Continuer.** Un écran « Voici ce que j'ai compris » s'ouvre (fusion de B et C) :
- le poste en 6 à 8 lignes : intitulé, client, lieu, séniorité, rémunération, 3 à 5 critères, chacun modifiable ou supprimable ;
- **deux ou trois questions** sur ce qui manque, à réponse en un geste (de C). **Coût caché relevé** (F-I12) : `generate-search-filters` ne produit aujourd'hui ni question ni liste de champs manquants ; il faut changer sa consigne et son format de sortie ;
- les filtres de recherche qui en découlent, repliés en dessous. **Autre coût caché** (F-M5) : la revue des filtres est une fenêtre (`FilterReviewModal`, montée seulement dans `MissionBriefV2.tsx:355`) ; on ne peut pas l'ouvrir dans la fenêtre de création, il faut en extraire le contenu ;
- deux boutons : **« Créer et lancer la recherche (au moins 50 crédits) »**, ou « Créer sans chercher ».

**2. Ce que fait « Créer et lancer la recherche »** (U-B1, nouveau). Une tâche serveur « chercher et noter » :
- **cherche** côté serveur. `run-agent-search` sait déjà chercher sur LinkedIn depuis le serveur (`run-agent-search/index.ts:449`) et noter (`:700`), mais n'enregistre aucun profil trouvé : il ne fait que lire `job_candidate_status` (`:242-246`), et la notation ne met à jour que des lignes existantes (`score-profile-job/index.ts:2548`). Il faut lui faire **créer les lignes « À trier »** avec leur `search_id` ;
- **note les 25 premiers** en réutilisant le travail de fond existant (`process-agent-tasks`, qui note les profils non notés d'une mission par petits lots et publie sa progression) ;
- **publie sa progression** : Maintenant dit « Recherche en cours : 12 profils notés sur 25. » puis « Trier les 25 profils. » ;
- **poste vide** (chemin « Remplir le poste moi-même » puis recherche) : note sur l'intitulé, « note provisoire ».
Cette tâche est au lot 4, qui passe donc avant le lot 7.

**3. Remplir le poste moi-même.** Ce lien est visible (de A). Aujourd'hui, la saisie manuelle est cachée derrière une flèche retour (`CreateMissionV2.tsx:581-589`). La mission s'ouvre sur Cadrage.

**4. Fichier déposé.** PDF et Word sont lus par `ingest-user-file`, avec trois retouches (F-I12) : afficher le coût de lecture d'un PDF (lu par l'IA) ; ne pas stocker d'extraits indexés pour 90 jours lors d'une création (`ingest-user-file/index.ts:8-10`) ; vouvoyer ses messages d'erreur (`:273, 276`). Aujourd'hui, la création n'accepte que TXT et MD (`CreateMissionV2.tsx:879`).

**Règles :**
- **On arrive toujours sur Pipeline**, jamais directement dans le Sourcing (`CreateMissionV2.tsx:430`).
- **L'intitulé et le client sont écrits là où tous les écrans les lisent** (`CreateMissionV2.tsx:545-549`, P6).
- **Modifier le texte après l'analyse invalide l'analyse** (`CreateMissionV2.tsx:278`).
- **Le plafond de la formule est annoncé avant la saisie** (`design-doc.txt:121`).
- **Les exemples parlent du métier de l'utilisateur** (`MissionBriefV2.tsx:857-911`).

**De la fiche collée au premier profil trié, recompté** : coller, « Continuer », « Créer et lancer la recherche », attendre la notation (de l'ordre de la minute, d'après les lots de 5 profils de `process-agent-tasks`), « Trier les 25 », une décision. **Un collage et 4 clics, à condition que la tâche serveur du lot 4 existe.** Sans elle, il faut aller dans Sourcing et cliquer « Noter » : 6 clics.

---

## 7. Sur téléphone (390 × 844)

```
+--------------------------------+
| [=](1)  Directeur financier v ...|  48 px : le menu garde le chiffre d'À traiter
+--------------------------------+
| [Pipeline] Sourcing  Cadrage   |  onglets de la mission
+--------------------------------+
| MAINTENANT                     |
| Marc Moreau vous a répondu     |
| « Le poste m'intéresse, je     |
|   suis disponible… »           |
| Pourquoi ?          Plus tard  |
|                                |
| Ensuite : Camille Fontaine,    |
| 6 j sans nouvelles · 2 autres >|
+--------------------------------+
| [Tous] [A répondu] [Qualif] >  |  étapes en puces, défilement horizontal
+--------------------------------+
| Marc Moreau                80  |
| A répondu · Répondre           |
| Camille Fontaine           83  |
| Entretien DG · Relancer        |
| …                              |
+--------------------------------+
| [ Répondre ]                   |  un seul élément fixe en bas, sous le pouce
+--------------------------------+
```

- **Le menu en haut à gauche garde le chiffre d'À traiter** (de A, `AppHeader.tsx:22-47`).
- **Un seul élément fixe en bas** : le bouton de la carte Maintenant, au-dessus de la future barre d'onglets du bas (`design-doc.txt:95, 181`).
- **« Reconnecter LinkedIn » ouvre la connexion dans le même onglet** (U-I10). Aujourd'hui, `window.open` est appelé après un appel réseau (`MyLinkedInAccount.tsx:116-125`), ce que les navigateurs mobiles bloquent souvent. **À vérifier sur un iPhone** ; la correction est de toute façon sûre : `location.assign` avec retour sur la mission (`success_redirect_url` est déjà accepté, `unipile-accounts/index.ts:585-586`). C'est la carte de rang 0, souvent la première vue.
- **La fiche candidat et le mode « un par un » occupent tout l'écran.** La barre de boutons se colle au-dessus du clavier quand on modifie un message (U-M12). **Aucun balayage obligatoire.**
- **Les messages éphémères se posent au-dessus du bouton fixe** (aujourd'hui en bas à droite, `App.tsx:150`, P7).
- **Sourcing sur téléphone** : lire, trier, « Affiner ». Les filtres avancés s'ouvrent dans une feuille.
- **Cadrage sur téléphone** : lecture et correction section par section.

---

## 8. L'assistant

**Il connaît la mission.**
- Ouvert depuis une mission, il reçoit la mission et son poste. Aujourd'hui, plusieurs chemins d'ouverture remettent la mission à vide (`AgentContext.tsx:97, 115, 128`).
- **Une conversation par personne et par mission**, rangée sous le nom de la mission dans l'onglet Assistant de la barre.

**Il s'ouvre à côté, pas par-dessus**, sans voile noir. Les trois demandes toutes prêtes d'une fiche affichent leur résultat dans la fiche (section 3.1).

**Ses propositions arrivent dans le travail** (de C) : au rang 5 de Maintenant et sur la ligne du candidat concerné, avec la carte d'approbation existante (`AgentToolApprovalCard.tsx:60-73`). **Aucune colonne à ajouter** (F-I5) : une proposition pointe sa conversation (`20260422100000_agent_tool_executions.sql:14`), qui a déjà une colonne `project_id`. Il suffit de la renseigner à l'ouverture depuis une mission (0 conversation sur 98 l'a aujourd'hui, Q12), puis de faire la jointure.

**Cinq endroits pour l'IA, au lieu de dix-sept** (de A, P7) : l'analyse de la fiche de poste, la revue des filtres, la note et sa raison, la rédaction (séquence, premier message, réponse, compte rendu), l'assistant de la mission.

**Il ne décide jamais seul, et le serveur le garantit.** Le garde-fou existe pour les envois (`agent-tools.ts:121-177`) mais pas pour tout :
- `update_candidate_stage` rejoint les outils jamais automatiques, au lot 0 (section 3.3, F-I4) ;
- la notation de fond (`start_background_scoring`, `agent-tools-mutations.ts:4118-4128`) peut elle aussi passer en automatique, et elle écarte aujourd'hui les profils sous 60 côté serveur. Le lot 0b supprime cet écart automatique ; l'outil reste soumis à approbation car il dépense des crédits.

**Un seul nom : « Assistant »** (`thread.tsx:55, 832, 878`). Il vouvoie, y compris dans ses consignes (`search-agent-chat/index.ts:785`).

---

## 9. États vides, chargement, erreur

Mêmes règles que la barre latérale livrée (`design-doc.txt:57, 115`) : trois états distincts, rien n'apparaît pour disparaître ensuite, **jamais un zéro inventé**.

| Situation | Ce qui s'affiche |
|---|---|
| **Chargement** | Les zones gardent leur place en blocs gris. Rien ne saute quand les données arrivent. Aucun blocage « type d'organisation » tant que l'organisation charge (F-M9) |
| **Une source ne répond pas** | Le rang concerné est « indisponible », jamais « 0 réponse ». « Impossible de vérifier les réponses pour l'instant. Réessayer. » |
| **Une source n'existe pas encore** (nouveau) | Pas de « Rien ne presse ». Une ligne dit ce qui n'est pas surveillé (section 4.2) |
| **Hors ligne** | Bandeau « Hors ligne, données de 9 h 42 », actions d'écriture grisées avec leur raison |
| **Mission neuve, sans candidat** (de A) | Trois cartes qui se cochent d'après les données : « Poste décrit », « Première recherche », « Séquence d'approche, facultatif ». Pendant la tâche « chercher et noter » : sa progression |
| **Aucun candidat en cours, mais des profils à trier** | « Aucun candidat retenu pour l'instant. 25 profils notés vous attendent. » Bouton : Trier les 25 |
| **Sans compte LinkedIn** | Pipeline et Cadrage fonctionnent. Sourcing et l'envoi disent pourquoi, avec « Relier LinkedIn ». 1 organisation sur 17 a un compte lié (Q13) : ce chemin doit être parfait |
| **Formule gratuite** | Selon la décision 2 : envoi individuel permis, séquence présentée comme payante ; ou envoi interdit, annoncé une fois |
| **Type d'organisation absent** | 9 organisations sur 17 (Q2), en lecture seule sans le savoir. Rang 0, adressé au propriétaire (décision 8) |
| **Lecture seule (droits)** | Bandeau en haut de Cadrage : la raison et à qui s'adresser (`MissionBriefV2.tsx:275-279`) |
| **Mission archivée** | Bandeau « Mission archivée le 12/09 », tout en lecture, bouton « Réactiver » |
| **Erreur d'une action** | La ligne revient à son état d'avant et le dit. Jamais de succès annoncé avant l'écriture (`MissionPipeline.tsx:430-433`) |

---

## 10. Les cinq gestes fréquents, avant et après (recomptés)

« Avant » : le chemin que le code impose aujourd'hui, repris du diagnostic et des pistes. Ce sont des estimations : aucune trace de clic n'existe en production (décision 12). « Après » : compté sur les maquettes, **avec la condition qui le rend vrai**.

| Geste | Avant | Clics avant | Après | Clics après | Condition |
|---|---|---|---|---|---|
| **1. Trier les nouveaux profils** | Passer en phase 2. Le Sourcing s'ouvre vide si la mémoire est perdue (`LinkedInSearch.tsx:953-960`) : relancer la recherche, puis « Scorer ». Puis case et action groupée par profil | 2 à 3 pour y accéder, une recherche relancée, puis 1 à 2 par profil | « Trier les 4 » dans Maintenant, puis une touche par profil | 1, puis 1 par profil | Profils notés en base (lot 4). Sinon « Noter » d'abord : +1 |
| **2. Contacter 3 retenus** | Depuis le Sourcing seulement, 3 cases, « Séquence », choix parmi toute l'organisation, relecture, confirmation. Sans séquence : 10 et plus | 6 à 7, 10 et plus sans séquence | « Contacter les 3 », séquence de la mission choisie, aperçu, « Lancer » | 3 (environ 5 sans séquence) | Formule payante. **En gratuit** (17 organisations sur 17) : un par un, 2 clics par candidat (« Envoyer », suivant), si la décision 2 le permet |
| **3. Traiter une réponse et décider** | Barre, messagerie, réponse, retour à la mission, phase 3, kanban, glisser la carte | 6 à 8, deux écrans | « Répondre » dans Maintenant, relire, « Envoyer » (étape présélectionnée) | 2, un écran | Conversation rattachée à la mission (lot 0b) et reçue sur votre compte |
| **4. Faire avancer un candidat et fixer l'entretien** | Kanban, retrouver la carte, la glisser. L'entretien se saisit dans l'Agenda. Changer l'étape depuis la fiche ferme la fiche | 3 plus une recherche visuelle, et l'entretien ailleurs | Clic sur la ligne, « Étape suivante », saisir la date | 2 clics et une date | **L'invitation part toujours de votre agenda** tant que la décision 4 n'a pas choisi l'invitation par Konekt |
| **5. Savoir où en est la mission, et présenter au client** | Vue d'ensemble aux chiffres faux. Analyses : 2 clics. Portail : Cadrage puis Configuration, écartés compris | 0 pour des chiffres faux, 4 et plus pour partager | Maintenant et la barre d'étapes, justes. Sélection, « Présenter au client », aperçu, « Envoyer le lien » | 0 pour savoir, 3 plus la sélection | Lot 0 pour les chiffres, lot 8 pour présenter |

Et **passer d'une mission à l'autre** en restant sur le même écran : 2 clics par le menu du nom de la mission.

---

## 11. Libellés

La refonte supprime et fusionne des vues. Elle touche donc aux libellés déjà décidés, comme la règle le permet.

| Libellé décidé | Sort | Détail |
|---|---|---|
| Phase « Cadrage » | **Gardé**, devient le nom d'un écran | Même sens |
| Phase « Sourcing et contact » | **Gardé comme titre de groupe** dans la barre d'étapes | Retirable sans autre changement |
| Phase « Suivi » | **Gardé comme titre de groupe** | Idem |
| Vue « Sourcing » | **Gardé**, écran | |
| Vue « Pipeline » | **Gardé**, devient l'écran d'accueil | `design-doc.txt:92` |
| Vue « Prise de contact » | **Gardé comme nom de panneau**, le geste s'appelle « Contacter » | La vue disparaît au lot 5, pas avant |
| Vue « Analyses » | **Disparaît**, remplacé par « Bilan » | Un encart |
| Vue d'ensemble, Brief, Process, Configuration | **Disparaissent** | Fondus dans Pipeline et Cadrage |

**Mots nouveaux** : « Maintenant », « Ensuite », « En ce moment », « Bilan », « Présenter au client », « Étapes d'entretien », « Critères », « Retenir », « Écarter », « Plus tard », « Déjà contacté », « Note » avec sa raison, « note provisoire ».

**Où se change la navigation** (corrigé, F-I1 et F-M8) : pas en un seul endroit. `src/lib/missionViews.ts` porte les libellés (il affiche encore « Sourcing & Outreach », « Outreach » et « Insights », `missionViews.ts:40-56`), mais la route (`App.tsx:169`), la clé de page (`AppLayout.tsx:34`), `MissionVisitTracker.tsx`, `MissionsPanel.tsx` et `MissionNavRow.tsx:160-184` (verrous et rangées par phase) lisent aussi les vues et doivent changer au lot 1.

**Règles de rédaction appliquées partout** (P10) : vouvoiement (portail client, consignes de l'assistant, messages d'erreur de `ingest-user-file` compris), français, ni tiret long ni emoji de décor, aucun nom de fournisseur (`VoiceDictation.tsx:121`), statuts jamais affichés en brut.

---

## 12. Articulation avec la barre latérale

### 12.1 La barre livrée (lots 5 et 6) : ce qui reste, ce qui change

| Élément de la barre | Reste | Change |
|---|---|---|
| Trois onglets À traiter, Missions, Assistant | Oui | |
| Un seul chiffre coloré (À traiter) | Oui | Maintenant n'a pas de compteur |
| Chevron d'une mission dans l'onglet Missions | | **Retiré** (U-M1) : les trois écrans sont dans l'en-tête de la mission, les redoubler dans la barre recrée la double navigation que le diagnostic combat. Plus de cadenas (`MissionNavRow.tsx:160-184`) |
| Clic sur le nom d'une mission : dernière vue visitée | Oui (décision 6) | Anciennes vues converties : Vue d'ensemble, Pipeline, Analyses et Prise de contact mènent à Pipeline ; Brief, Process et Configuration à Cadrage |
| Point « nouveaux profils depuis ma dernière visite » | Oui | **Piloté par l'effectif « À trier »**, la même notion que « Trier les N » (U-M5). Aujourd'hui il compare `stats_total_found` à la dernière visite (`MissionsPanel.tsx:72`) |
| À traiter : réponses, validations, panne LinkedIn | Oui | **Maintenant partage avec lui le rang 0 (panne LinkedIn : même lecture, `useLinkedInOutage`) ; le rang 3 est lu dans les liens conversation et mission (`get_mission_attention`, lot 3, 04/10/2026) et non dans les notifications, avec un plafond de 30 jours : le chiffre d'À traiter et la carte peuvent donc différer** ; le rang 5 viendra au lot 9. Les autres rangs sont propres à la mission. « Plus tard » ne touche jamais le chiffre d'À traiter (U-M4, F-I11) |
| Clic sur une réponse ou une validation dans À traiter | | Ouvre la mission sur cet élément en mode « un par un », quand l'élément est rattaché à une mission |
| Raccourcis | | **Rien à changer** : les raccourcis « G puis 1 à 8 » cités dans la version précédente n'existent pas. `GoShortcuts.tsx:11-19` ne gère que des lettres (F-M1) |

### 12.2 Le lot 3 de la barre, en préparation

Contenu prévu : « Menu du nom de la mission, une rangée par phase, historique, verrous qui expliquent, hauteur de page » (`design-doc.txt:175`). Rien n'en est encore dans le code.

| Morceau du lot 3 | Verdict |
|---|---|
| Menu du nom de la mission | **Reste valable, tel quel** |
| Une rangée groupée par phase | **Abandonné** |
| Historique : Retour revient à la vue précédente | **Reste valable, étendu** aux panneaux |
| Verrous qui expliquent | **Sans objet** |
| Hauteur de page (`MissionWorkspaceV2.tsx:149`) | **Reste valable** |
| Libellés mixtes | **À refaire selon la section 11** |

**Recommandation** : arrêter le lot 3 tel qu'il est défini, et le remplacer par le lot 1 ci-dessous.

---

## 13. Découpage en lots (révisé)

Chaque lot sert seul et se livre seul, **sans laisser de fonction inaccessible entre deux lots**. Tailles relatives : P petit, M moyen, G grand, G+ plus que grand. Pas d'estimation en jours. Toute évolution de base passe par un fichier de migration qui rejoue sur une base vide, et toute nouvelle table par l'audit de séparation entre organisations (règles du CLAUDE.md).

| Lot | Ce que l'utilisateur voit | Contenu | Taille |
|---|---|---|---|
| **0a. Le modèle** | Rien encore | Étape générale, `process_step_id`, `stage_entered_at`, `decision_source`, jalons datés ; fonction `set_candidate_stage` ; déclencheurs de statistiques réécrits ; reprise des données (sort des 719 écartés, décision 3) ; conservation de la date lors de `replace_process_steps` ; `update_candidate_stage` jamais automatique. Vérifier en production les contraintes sur le statut avant toute conversion | G |
| **0b. Les écrivains serveur** | Plus de « A répondu » dans une mission où l'on n'a pas écrit | Les douze écrivains de la section 3.3 passent par la fonction ; la notation n'écrit plus l'étape ni « écarté » ; `recommendation` n'est plus écrasé ; **lien conversation et mission** enregistré à chaque envoi, résolu à la réception, rattrapage des 17 inscriptions ; passage en « Contacté » sur un message envoyé hors Konekt ; colonnes de compatibilité pour l'extension ; puis déclencheur de refus des écritures directes. Recette complète (skill `qa.md`) : touche aux webhooks | G |
| **0c. Les lectures** | Les chiffres de la liste des missions et du Pipeline deviennent vrais | Livré en sous-lots (plan du lot 0c, 29/09). **0c-1** : vue `mission_candidate_rows` (une ligne par candidat et par mission, doublons réunis, drapeau « jamais ouvert ») ; fonction `get_mission_stage_counts` (effectifs par étape, cumuls « au total ») ; compteurs `stats_*` lus dans cette fonction (recalcul complet de la migration sans toucher `updated_at` ni indexer ; ensuite, un recalcul qui change un compteur réécrit la mission, `updated_at` et indexation, comme au lot 0a) ; `undo_candidate_stages` ; InMail répondu compté comme envoi ; `rgpd_purge_candidate_rows` ; libellés « au total » au tableau de bord, dans la Vue d'ensemble, les recherches et le résumé du matin. **0c-2** : outils de l'assistant sur la vue et la fonction de comptage ; purge RGPD réparée en « compte seulement » (décision 5 du plan 0c, ci-dessous). **0c-5** : mesure d'usage branchée (décision 12), adresses sans jeton. **0c-3** (livré le 04/10/2026, avant le lot 0b-5 : repli « ordre B » du plan 0c, tous les gestes passent par `set_candidate_stage(s)`) : écrans de mission sur la vue (kanban avec Retenu, profils jamais ouverts sortis, « Dans cette étape depuis N j ») ; liste des missions qui lit le poste (`useSourcingProjects.ts:101`) et **sans prochaine étape** (retrait de `computeNextStep`). **0c-4** (livré le 04/10/2026) : `/pipeline` sur l'étape générale, mêmes mots que la mission ; lectures par `project_id` (dont `ScorecardTab.tsx:558-564`) ; annulation qui remet l'état d'avant. Livrés avant 0b-5 (ordre B), les lots 0c-3 et 0c-4 font repartir la fenêtre de 5 jours ouvrés du lot 0b-5 à partir du 04/10/2026 : au plus tôt le 09/10/2026. Les écritures directes de l'étape se lisent dans `jcs_direct_write_log` (colonne `logged_at`, 48 h après la livraison ; `client_info` porte le build `konekt/<commit>`), le refus `STAGE_DIRECT_WRITE` n'existant qu'une fois le mode `refuse` posé par 0b-5. **0c-6** : retrait de `get_project_stats` et `get_multiple_project_stats`. La fin de l'archivage automatique dans le navigateur est livrée depuis le lot 0b-3 | M |
| **1. La nouvelle coquille** | Une seule bande d'en-tête, trois onglets, plus de phases ni de verrous, Retour qui marche | En-tête, menu du nom, trois écrans, route `/missions/:id/*`, clé de page unique, redirection des anciens `?tab=`, `MissionVisitTracker`, `MissionsPanel`, `MissionNavRow` (chevron retiré), conversion des dernières vues, états vides. Retrait de la Vue d'ensemble, du stepper, d'Analyses. **Accès provisoires** : panneau Prise de contact avec `SequencesList` et `InvitationsPanel` tels quels ; « Réglages » en bas de Cadrage avec `MissionConfigV2`. Remplace le lot 3 de la barre | M |
| **2. Le Pipeline** | La liste des candidats en cours, la barre d'étapes, la fiche à droite | Liste avec prochaine action (règle provisoire : étape et « Aucune action depuis N j »), ordre figé en session, sélection et actions groupées, kanban réparé (il enregistre avant d'annoncer), **panneau de fiche propre à la mission** (ProfileDetailSheet intact ; titres de `useCandidateFullProfile.ts` et contexte IA de `useCandidateContext.ts` lus par mission, reportés du lot 0c), Bilan sur les jalons, taux de passage du kanban refaits (retirés au lot 0c-3), pagination par 50 en colonnes légères | G |
| **3. Maintenant** | La carte « Maintenant », « Pourquoi ? », « Plus tard », « Ensuite » | **Seulement les rangs dont la source est prouvée à ce stade** : 0, 3 (conversations rattachées), 6, 7, 8, 10, 11 ; 1 et 2 si la date d'entretien est saisie. « Rien ne presse » interdit tant qu'un rang manque. Même règle pour la liste des missions. Report « Plus tard » enregistré. Reconnexion LinkedIn dans le même onglet sur téléphone. **Aucun appel au modèle**. *Livré le 04/10/2026 (branche, avant mise sur main)* : rangs 0, 3, 6, 7, 8, 10, 11 et un rang ajouté « profils trouvés, pas encore ouverts » (8b) ; « Reconnecter » mène aux connexions LinkedIn existantes, sans voie hébergée sur téléphone (conformité des licences Recruiter à trancher) ; « Plus tard » jusqu'à 6 h le lendemain, table `mission_action_snoozes`. *Allégé le 04/10/2026 (retour du propriétaire : « trop chargé, on comprend mal »)* : la carte garde une phrase, un bouton et deux liens ; la proposition, la règle, « Ensuite » (qui passe de la ligne sous la carte au panneau « Pourquoi maintenant ? ») et « Non suivi » ne s'ouvrent qu'à la demande ; puces d'étapes en une rangée, sans titres de groupe ni zéro affiché ; liste sans colonne « Depuis », avec le visage du candidat et la note en anneau (design simplifié, `docs/design/06-simplicite.md`). Le Cadrage et le Sourcing suivent les mêmes règles le même jour (sections sans cartes, contrôles discrets jusqu'au survol, puces d'état sans cadre, tableau aux colonnes réduites), puis l'en-tête de mission (logo du client, statut sans cadre, un seul « Réactiver ») et la liste des missions (logo, visages en entretien, aucun zéro écrit) | M |
| **4. Chercher, noter, trier** | La création arrive sur des profils notés ; le Sourcing ne s'ouvre plus vide ; le tri un par un | **Tâche serveur « chercher et noter »** (`run-agent-search` crée les lignes, `process-agent-tasks` note) ; `search_id` ; résultats relus en base (lot isolé et testé) ; mode « un par un » ; trois groupes et suggestions de l'IA ; note provisoire sur poste vide ; budget d'encombrement ; retraits de la section 3.2. Reportés du lot 0c : Sourcing lu par `project_id` pour toute l'organisation, avec la règle de la ligne canonique en fonction partagée ; pastilles du Sourcing sur l'étape générale ; bascule du filtre après notation ; notation de fond (`process-agent-tasks`) par `project_id` ; **fusion des doublons** puis clé unique `(organization_id, project_id, candidate_id)` (préconditions ci-dessous). **Recette sur `/missions/:id/sourcing` et `/sourcing/:id`** | G |
| **5. Contacter** | « Contacter » depuis n'importe quelle sélection ; les séquences de la mission | Panneau Prise de contact définitif, séquences rattachées, rédaction depuis le poste, chemin gratuit (décision 2), **écran « Séquences » de l'organisation** (modèles, « Envoyer tout », Journal, Analytics, Diagnostic), **invitations dans la messagerie**, retrait de la vue Prise de contact, rang 9. Reporté du lot 0c : l'inscription par `SequenceEnrollModal.tsx` pose Retenu, comme `EnrollmentPreviewModal.tsx`. Touche aux envois réels : recette complète | G |
| **6. Réponses et entretiens** | Répondre et faire avancer en un geste ; entretiens dans la mission | Mode « un par un » des réponses, réponse proposée avec lien de rendez-vous, date d'entretien (décision 4), `CreateEventModal` avec candidat et mission, `process_step_id` sur `qualification_sessions`, verdict, grilles liées aux étapes et visibles par l'équipe (`ScorecardTab.tsx:49-62, 122`), « Prévenir le candidat » | G |
| **7. Cadrage et création** | Une création en un champ ; un poste en une page, critères en tête | Cadrage en quatre sections, critères en un seul modèle, notes marquées après modification et « Recalculer », bloc « Vos messages », interlocuteur, section Équipe selon les droits, création avec « Voici ce que j'ai compris » (consigne de `generate-search-filters` modifiée, revue des filtres extraite de sa fenêtre), PDF et Word (coût affiché, sans stockage), fin de « Réglages » pour les éléments repris | G |
| **8. Client** | Présenter des candidats et récupérer l'avis dans la mission | Panneau Client, un lien par client et mission, refus des liens sans mission, page limitée aux présentés et vouvoyée, avis sur la ligne et au rang 4, relance par e-mail, fin de « Réglages » | M |
| **9. Assistant** | L'assistant connaît la mission et s'ouvre à côté | `project_id` renseigné sur les conversations ouvertes depuis une mission, jointure pour le rang 5, panneau sans voile, résultats des demandes dans la fiche, 5 points d'entrée IA, un seul nom. Reporté du lot 0c : lectures de `run-agent-search` et `retrieve-context` par `project_id` | M |
| **10. Téléphone** | La mission tient dans un téléphone | Bouton Maintenant fixe, fiche et « un par un » plein écran, barre au-dessus du clavier, messages éphémères déplacés. Après le lot 9 de la barre | M |
| **Transversal. Textes** | Un produit qui vouvoie et parle français | Dans chaque lot, plus une passe finale | P |

**Ordre conseillé**
1. **Lots 0a, 0b, 0c**, dans cet ordre. Ils corrigent des chiffres faux quelle que soit la suite.
2. **Lots 1 et 2 ensemble** : la mission s'ouvre sur ses candidats. Rien ne devient inaccessible grâce aux accès provisoires.
3. **Lot 3** : Maintenant, limité aux signaux prouvés.
4. **Lot 4, puis lot 5** : chercher, noter, trier, contacter. Le lot 4 passe avant le lot 7, dont la création dépend.
5. **Lots 6, 7, 8 et 9**, dans l'ordre que vous préférez.
6. **Lot 10** en dernier.

**Plus tard, seulement après mesure** : la préparation de fond par l'assistant, avec un budget de crédits par mission et le respect des plafonds LinkedIn.

**Hors refonte** (plan du lot 0c) : l'extension Chrome (`extension-pipeline-status` range encore par `status`). Deux jetons émis, tous révoqués, jamais utilisés : son sort se décidera à part.

**Sens des chiffres** (décision 1 du plan 0c) : sur la carte d'une mission et dans son kanban, un chiffre dit combien de candidats sont **en ce moment** à l'étape, sous le nom de l'étape. Partout ailleurs (tableau de bord, Vue d'ensemble, résumé du matin, recherches, tuiles du `/pipeline`), c'est un cumul depuis le début, écrit « au total ». Un profil trouvé par une recherche et jamais ouvert (ni noté, ni trié, ni contacté, ni inscrit) n'est pas dans le Pipeline : il reste au Sourcing et la carte affiche « N profils trouvés » (décision 2 du plan 0c).

**Effet ponctuel de 0c-1** : `stats_total_found` compte une ligne par candidat, doublons réunis ; il baisse donc pour les missions à doublons (77 groupes le 28/09). Le point « nouveaux profils » de la barre latérale, qui compare au total vu à la dernière visite, reste éteint pour ces missions jusqu'à la prochaine visite ou jusqu'à ce que le total dépasse l'ancien. Le point est repris au lot 1 (`MissionsPanel`).

**Purge des données candidats** (décision 5 du plan 0c) : la purge est réparée en « compte seulement » : sans `{"dry_run": false}` explicite, `rgpd-purge` ne supprime rien et journalise ce qu'elle supprimerait. Règles proposées, à confirmer après avis juridique avec la planification : ligne sans activité depuis 24 mois (sauf Embauché), ligne écartée depuis 12 mois ; commentaires, notes et avis restent hors de la purge.

**Préconditions de la fusion des doublons** (lot 4, reprises de la section 5.5 du plan 0c) :
1. Sourcing lu par `project_id` pour toute l'organisation, avec la règle de la ligne canonique de `mission_candidate_rows` en fonction pure partagée ;
2. `batchDiscover` sans ligne pour un candidat déjà présent dans la mission, quelle que soit la forme de `job_id` ou l'auteur ;
3. les dix sites `onConflict: 'job_id,candidate_id,created_by'` basculés (`useJobCandidateStatus.ts:305`, `:399`, `:555`, `:644`, `:737`, `:847`, `EnrollmentPreviewModal.tsx:838`, `useATSData.ts:514`, `extension-quick-add/index.ts:125`, migration du lot 0b `:614`, lignes relevées le 29/09) ;
4. report sur la ligne gardée des jalons les plus anciens, de la note et du motif ensemble (`score`, `recommendation`, `scoring_details`, `skip_reason`), de `reply_summary`, de l'identité, de `linkedin_profile_data` (exigé par le worker de notation) et des étiquettes réunies ;
5. références souples reportées : `candidate_evaluations` (par `job_candidate_status.id`), `candidate_comments`, `candidate_reminders`, `candidate_portal_tokens`, `candidate_assignments` (unicité `(organization_id, job_id, candidate_id)`) ;
6. copie des lignes supprimées, fermée, effacée par `recordGdprErasure` et purgée ;
7. index unique `(organization_id, project_id, candidate_id) WHERE project_id IS NOT NULL` ;
8. déclencheurs `updated_at` et d'indexation coupés pendant la fusion.

---

## 14. Risques principaux

1. **Un guidage faux est pire qu'un tableau faux.** Maintenant ne sort pas avant le lot 0, et n'affiche que les signaux dont la source est prouvée. Un entretien planifié hors de Konekt n'existe pour Maintenant que si sa date est saisie.
2. **Le lot 0 touche aux webhooks et à l'extension Chrome.** Une erreur fait passer des candidats dans de mauvaises étapes sans que personne ne clique. Recette complète, colonnes de compatibilité, et refus des écritures directes seulement à la fin.
3. **L'action unique peut agacer un recruteur expérimenté.** Parades : « Ensuite » cliquable, « Plus tard », la liste toujours visible, les raccourcis. Si la mesure montre que « Ensuite » est plus cliqué que le bouton principal, la règle d'ordre est à revoir.
4. **La règle d'ordre est déduite du métier, pas mesurée.** Elle reste simple, affichée et révisable.
5. **Le Sourcing reste l'écran le plus chargé.** Le budget d'encombrement le borne ; une refonte dédiée viendra après.
6. **Les lots 0b, 5 et 6 touchent aux envois réels** (plafonds LinkedIn, formule, doublons). Recette complète.
7. **La dépendance à LinkedIn.** Une seule organisation sur 17 a un compte lié. La liaison qui ramène sur la mission, y compris sur téléphone, doit fonctionner sans faille.
8. **La limite de lignes renvoyées par la base** (1 000 par défaut, non fixée dans `supabase/config.toml`) est à vérifier sur le projet avant le lot 2.
9. **Le coût en crédits de la notation automatique à la création** (au moins 50 crédits pour 25 profils) pèse sur des organisations en formule gratuite. Il est annoncé sur le bouton ; la mesure dira s'il freine la création.
10. **Le travail à plusieurs** : les réponses vont à la personne dont le compte a reçu le message, le reste au propriétaire de la mission. À affiner quand des équipes l'utiliseront.

---

## 15. Les décisions qui vous reviennent

Chaque décision a un choix par défaut, appliqué si vous ne tranchez pas.

1. **Revenir sur le retrait du bloc « Étape suivante ».** Vous l'aviez fait retirer le 20/05 : « l'user n'a pas besoin d'être guidé vers la prochaine étape de façon visuelle intrusive, il sait où il va » (`MissionOverviewV2.tsx:274-279`). Maintenant en est une nouvelle version, qui pousse vers ce qu'une personne attend de vous et se réduit à une ligne quand rien ne presse. **Par défaut : à valider sur la maquette avant tout développement.**
2. **Formule gratuite : un message individuel est-il permis ?** (nouveau, U-B4). Le serveur le permet déjà (`unipile-search/index.ts:417-418`) ; seules les séquences sont fermées (`featureGates.ts:79`). **Par défaut : oui**, en mode un par un, la séquence étant présentée comme l'option payante. Sinon, tout envoi est fermé en gratuit, y compris depuis la messagerie, et « Contacter » est annoncé une seule fois comme payant.
3. **Les 719 écartés existants** (nouveau, F-I6) : on ne sait pas qui les a écartés. **Par défaut : « écartés par l'IA, à confirmer »**, réversibles, exclus du taux « triés par vous ». Sinon : « source inconnue », laissés dans Écartés.
4. **La source des entretiens** (nouveau, U-I1). **Par défaut : un champ « Date de l'entretien ? »** au passage en entretien, sans intégration. Sinon : « Planifier » envoie une vraie invitation depuis Konekt (plus long, lot 6 plus gros).
5. **Les libellés** (section 11) : phases réduites à des titres de groupe, « Analyses » remplacé par « Bilan », « Prise de contact » devenu un panneau. **Par défaut : garder les titres « Sourcing et contact » et « Suivi »**, retirables ensuite.
6. **Clic sur une mission dans la barre** : **par défaut, la dernière vue visitée** (comportement actuel) ; sinon toujours Pipeline et sa carte Maintenant.
7. **Arrêter le lot 3 de la barre** tel qu'il est défini et le remplacer par le lot 1. **Par défaut : oui.**
8. **Organisations sans type** (9 sur 17, en lecture seule sans le savoir). **Par défaut : un blocage adressé au propriétaire** ; sinon un type par défaut.
9. **Portail client pour une entreprise** : la formule l'autorise, le type d'organisation l'interdit (`featureGates.ts:41, 79`). **Par défaut : réservé aux cabinets et indépendants**, org_1 garde la main pour révoquer ses 4 liens.
10. **Le mode chasse** (0 publication, 0 candidature, Q10). **Par défaut : gardé dans Cadrage pour les entreprises**, une seule porte.
11. **Liste ou kanban par défaut** dans Pipeline. **Par défaut : la liste**, choix mémorisé par personne.
12. **La mesure d'usage** : le suivi des clics existe (`src/lib/analytics.ts:64`) mais reste muet sans une variable à poser sur Vercel (`design-doc.txt:190`). **Par défaut : la poser avant le lot 1.**
13. **La préparation de fond par l'assistant.** **Par défaut : après la mesure.**

---

## 16. Critiques écartées ou corrigées

Tout le reste des deux critiques est intégré (annexe A). Voici ce qui ne l'est pas, ou pas tel quel, avec la raison vérifiée.

| Critique | Ce qui est écarté | Raison |
|---|---|---|
| U-B1 : « La notation est manuelle. Son seul déclencheur est le bouton » | L'exclusivité | Inexact : l'outil d'assistant `start_background_scoring` (`agent-tools-mutations.ts:4118-4128`) met en file une notation de fond traitée par `process-agent-tasks`, qui écrit les notes via `score-profile-job` (`:2506, 2528-2548`). La conclusion tient (la création n'amène pas de profils notés), mais la correction réutilise ce travail de fond au lieu d'étendre seulement `run-agent-search` |
| U-B1 : « Noter automatiquement les 25 premiers profils **de chaque recherche** » | L'automatisme sur chaque recherche | Dépenserait des crédits sans clic, ce que l'atelier a écarté pour la préparation de fond (section 1.3). Gardé à la création, sur un bouton qui annonce le coût ; ensuite, un bouton « Noter les 25 premiers » |
| U-B2 : interdire l'écriture directe « au lot 0 » par un déclencheur de refus | Le moment | Posé dès le début, il casserait l'extension Chrome et les 51 fichiers qui touchent la table avant leur migration. Posé à la fin du lot 0b |
| U-M4 : partager avec À traiter « les rangs 0 à 5 » | Les rangs 1, 2 et 4 | À traiter ne contient ni entretiens ni avis du client : son chiffre additionne panne LinkedIn, réponses, validations et notifications « action » (`src/lib/sidebarSignals.ts`). Partage limité aux rangs 0 (panne LinkedIn), 3 et 5, comme le demande F-I11 |
| U-M10 : garder le ton des messages et le lien de rendez-vous « par membre, modifiables par mission » | Le niveau « membre » | Ces réglages sont stockés par mission (`MissionConfigV2.tsx:361-374`, `calendly_link`) et en partie propres au client (anonymisation), comme l'établit F-I2. Un défaut par membre demanderait un nouveau stockage : reporté. Le repli de la messagerie sur le lien de n'importe quelle mission (`useMessagesInbox.ts:1522`) est bien retiré |
| U-I9 : option « file côté serveur avec 10 secondes de délai » | L'option | Nouvelle file et nouvel état à maintenir pour un gain faible. On garde l'« Envoyer » explicite après lecture |
| U-M1 : « pas de sous-entrées pour la mission ouverte » | Rien, la correction va plus loin | Le chevron est retiré pour toutes les missions : garder trois sous-entrées pour les autres missions seulement ajouterait une règle pour un gain d'un clic |
| U-I5 : « 12 à 13 surcouches » | Le mot | Ce sont des filtres rapides (`SmartOverlays.tsx:100-200`), pas des fenêtres. Le budget d'encombrement proposé est gardé tel quel |
| U-I10 : fenêtre bloquée sur téléphone | Rien, mais non prouvé | Pas testé sur un appareil. La correction (même onglet) est sûre et peu coûteuse, donc gardée |
| F-M7 : erreur du diagnostic (« `notifications` avec `project_id` ») | Rien | Juste : la table n'a que `metadata.project_id` (`types.ts`, table `notifications`). La synthèse n'en dépend plus ; `diagnostic.md` n'est pas réécrit ici |

**Deux constats de la version précédente sont aussi corrigés**, relevés en vérifiant :
- le risque « une réponse envoyée depuis le téléphone ne marque rien comme traité » est en partie dépassé : depuis le commit 4a6bcfd, le webhook marque lues les notifications de la conversation quand il voit notre propre message (`unipile-webhook/index.ts:953-957`). L'étape du candidat, elle, ne change pas ;
- la notation côté serveur écarte elle aussi les profils sous 60 (`score-profile-job/index.ts:2528`), en plus de l'archivage dans le navigateur. Les deux sont retirés.

---

## Annexe A. Où chaque critique est traitée

| Critique | Section |
|---|---|
| U-B1 chercher et noter | 1.4, 4.3 (principe 2), 6 (point 2), 13 (lot 4), 16 |
| U-B2 écrivains de l'étape | 3.3, 13 (lot 0b), 16 |
| U-B3 réponses rattachées | 1.4, 4.3 (rang 3), 5.3, 13 (lot 0b) |
| U-B4 formule gratuite | 1.4, 4.3 (rang 7), 5.3, 9, 10, 15 (décision 2) |
| U-I1 entretiens | 1.4, 5.7, 10, 15 (décision 4) |
| U-I2 deux nombres de contactés | 3.3 (jalons), 4.2 (« En ce moment »), 5.4 |
| U-I3 compte LinkedIn de la réponse | 4.3 (rang 3 et principe 4), 14 |
| U-I4 liste des missions | 3.2, 4.3, 13 (lots 0c et 3) |
| U-I5 surcharge du Sourcing | 3.2, 5.1 |
| U-I6 raison critère par critère | 4.4, 5.6 |
| U-I7 contact hors Konekt | 4.4, 5.3, 13 (lot 0b) |
| U-I8 interlocuteur | 3.2, 4.3 (rang 6), 5.5, 5.6 |
| U-I9 annulation d'un envoi | 1.4, 5.2, 16 |
| U-I10 reconnexion sur téléphone | 7, 13 (lot 3) |
| U-M1 à U-M12 | 12.1 (M1, M4, M5), 3.1 (M2), 4.2 (M3), 4.1 (M6), 5.1 (M7, M8), 4.4 (M9), 3.2 et 16 (M10), 5.2 (M11, M12), 7 (M12) |
| F-B1 lot 0 | 3.3, 13 (lots 0a, 0b, 0c) |
| F-B2 trous entre lots | 1.4, 3.2, 5.6, 13 (lots 1 et 5) |
| F-B3 sources de Maintenant | 1.4, 4.2, 4.3 (colonne Source), 9, 13 (lot 3) |
| F-I1 adresses en chemin | 3.1, 11, 13 (lot 1) |
| F-I2 ton et lien de rendez-vous | 1.4, 3.2, 5.6 |
| F-I3 `CreateEventModal` | 3.3, 5.7 |
| F-I4 assistant et étapes | 3.3, 8 |
| F-I5 rattachement des propositions | 8 |
| F-I6 origine de la décision | 3.3, 5.4, 15 (décision 3) |
| F-I7 portail sans mission | 5.5 |
| F-I8 fiche partagée | 1.4, 4.4, 13 (lot 2) |
| F-I9 Sourcing hors mission | 5.1, 13 (lot 4) |
| F-I10 pagination et comptages | 4.2, 14 |
| F-I11 Maintenant et À traiter | 4.2, 12.1 |
| F-I12 coûts de la création | 5.6, 6 |
| F-I13 droits dans Cadrage | 3.2, 5.6 |
| F-M1 à F-M9 | 12.1 (M1), 3.3 (M2), 5.2 (M3), 5.3 (M4), 6 (M5), 5.1 (M6), 16 (M7), 11 (M8), 4.3 et 9 (M9) |
