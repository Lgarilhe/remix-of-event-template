# Usage réel en production : équipe, marketplace, intégrations

Konekt, 24/09/2026. Rapport de mesure pour l'extension de la nouvelle page mission (équipe, marketplace, intégrations).

Fichier : `/tmp/claude-0/-home-user-remix-of-event-template/4b4fe983-b7dc-55e7-8194-3f9f5ececcae/scratchpad/mission-ux/extension/mesures-prod.md`

**Sources.** Les 44 requêtes déjà exécutées en lecture seule et leurs résultats : `mesures-compactes.txt` (lignes tronquées) et `mesures-brutes.txt` (résultats complets), même dossier. **Aucune requête SQL n'a été relancée pour ce rapport, aucun outil Supabase n'a été appelé.** Le dépôt a été lu sans modification, seulement pour interpréter certains chiffres (fichier:ligne cité à chaque fois). Les rapports voisins du même dossier (`lecture-equipe.md`, `lecture-marketplace.md`, `lecture-integrations.md`, `lecture-canaux.md`) donnent l'état du code ; ils sont cités par section quand je m'appuie sur eux.

**Numérotation.** « Q12 » désigne la 12e requête dans l'ordre de `mesures-compactes.txt` (même ordre dans `mesures-brutes.txt`). L'annexe A liste les 44 requêtes et ce que chacune mesure.

**Anonymisation.** `org_1` à `org_17` : rang de création de l'organisation (stable d'une requête à l'autre). `m1` à `m14` : rang de création des missions ; `s1` à `s7` : des recherches (stables). **`u1`, `u2`, `u3` ne sont PAS stables** : Q20 numérote par date de première conversation, Q39 et Q40 par nombre de lignes candidats. Le `u2` de Q20 (organisation `org_4`) n'est pas le `u2` de Q40 (organisation `org_1`).

---

## 0. En bref

1. **Une seule organisation travaille, et presque une seule personne.** 17 organisations, 13 personnes. Toutes les lignes candidats sont dans une organisation (Q38), `org_1`, et une personne en a créé 96,5 % (1 988 sur 2 061, Q40). La même organisation porte 12 des 14 missions (Q13), toutes créées par une seule personne.
2. **Le travail en équipe n'a presque jamais servi.** 16 organisations sur 17 n'ont qu'un membre (Q9). Sur `org_1` (3 membres), les deux autres ont chacun travaillé un seul jour (Q40). 3 commentaires, 1 mention jamais lue, 0 note, 0 attribution de candidat, 3 lignes d'équipe de mission (Q15, Q18, Q12).
3. **La marketplace n'a jamais servi.** 0 candidature, 0 mission publiée, 3 missions en brouillon, 1 demande d'adhésion en attente depuis le 08/09 (Q22, Q24).
4. **Le portail client est la seule collaboration externe qui a eu lieu** : 4 liens, 4 ouverts, un par mission, tous dans `org_1`, dernier accès le 16/07 (Q23). On ne sait pas qui les a ouverts.
5. **Aucune intégration client n'est configurée.** Registre de connecteurs vide alors que sa migration le remplit, tables de synchronisation absentes, 0 clé Notion, Calendly, Airtable, Aircall (Q25 à Q28). Seul Notion **pour l'assistant** vit : 1 connexion, utilisée le 24/09 (Q29).
6. **Un seul canal a vraiment servi : LinkedIn, à la main.** Les séquences n'ont jamais envoyé un message : 17 visites de profil, 13 invitations, puis plus rien depuis le 14/05 (Q34). 1 boîte e-mail reliée, 0 e-mail de prospection, 0 WhatsApp (Q31, Q33, Q35).
7. **L'assistant est la fonction la plus suivie après la recherche** : 100 conversations, 772 messages, 178 appels d'outils (Q20, Q21). Mais 0 conversation rattachée à une mission, et **les 15 envois LinkedIn proposés par l'assistant ont tous été refusés ou ont échoué** (Q21).
8. **Le travail réel s'arrête le 20/07/2026.** Dernière ligne candidat, dernier message rédigé, dernière notation : 20/07 (Q38, Q44). Depuis, seulement des gestes isolés les 08/09, 22/09 et 24/09. Les 11 essais ont expiré le 21/09 (Q19).

**Pour la conception** (détail en section 22) : la page mission doit d'abord servir une personne seule. Équipe, marketplace et intégrations n'ont aujourd'hui aucun usage à préserver ni à migrer, sauf le portail client. On peut les concevoir librement, mais aucune ne doit prendre de place sur l'écran Pipeline tant qu'elle n'a pas de premier usage réel.

---

## 1. Précautions de lecture

- **Petits nombres.** 17 organisations, 13 personnes. Un « 0 » veut dire « jamais utilisé », pas « peu utilisé ». Un pourcentage sur 14 missions ne vaut pas tendance.
- **Q2 et Q3 sont des estimations du moteur, fausses ici.** Q2 donne 0 ligne vivante pour `organizations`, `profiles` et `sourcing_projects` alors que Q9 compte 17 organisations. Q3 estime 691 messages de l'assistant pour 772 comptés (Q20). Je ne cite Q2 et Q3 que pour la liste des tables.
- **Q7 a échoué** (`freelance_mode` est du texte, pas un booléen). Q8 la remplace.
- **Q22, étiquette trompeuse.** Les 4 liens de portail sont classés « expired » parce que `expires_at` est vide : `NULL > now()` n'est pas vrai. Q23 montre `expires` à `null` sur les 4. Ils n'expirent donc jamais.
- **Q30, noms de colonnes en double.** La requête nomme deux colonnes `t` ; le JSON garde la seconde (le type d'organisation) et perd l'étiquette de ligne. Les 5 lignes se lisent dans l'ordre des `UNION ALL` : 1 connexion Notion, 1 serveur MCP, 3 lignes `organization_integrations`. Recoupé avec Q28 et Q29 (même nombre de lignes, mêmes dates).
- **`rate_limit_log` ne compte pas tout.** Une ligne par appel accepté, écrite par `check_rate_limit` (`20260313002353_e5613901-9b16-4bea-b821-486bf7a82972.sql:33-44`). Seules 26 fonctions l'appellent (recherche `p_action:` dans `supabase/functions`). Les webhooks, `process-sequences`, `search-agent-chat`, l'extension et le portail client n'y figurent pas. Certaines fonctions sautent le compte pour les appels internes (`unipile-search/index.ts:290`, `ingest-context/index.ts:178`).
- **`unipile_search` compte tous les appels de la fonction**, pas seulement les recherches : l'action (recherche, profil, conversations, envoi) est lue avant le compte et n'est pas enregistrée (`unipile-search/index.ts:272, 290-297`).
- **`ai_credits` compte surtout des lectures de solde**, pas de l'IA : le hook relit le solde au plus toutes les 60 secondes (`useAICredits.ts:27-44`). C'est un indicateur de présence dans l'application.
- **`candidate_evaluations.ai_generated` n'est jamais écrit à `true`** : aucun écrivain dans `src/` ni `supabase/functions/` ne le met à vrai (recherche `ai_generated`). Le « 0 grille IA » de Q16 ne dit donc rien.
- **Les dates de dernière activité** comptent aussi les essais du fondateur. Rien dans les données ne distingue un essai d'un usage réel.

---

## 2. Organisations et types

| Mesure | Valeur | Requête |
|---|---|---|
| Organisations | 17, créées du 21/04 au 16/07/2026 | Q8 |
| Type vide (`org_type` NULL) | **9** (créées du 06/05 au 16/07) | Q8 |
| `enterprise` | 4 | Q8 |
| `agency` | 2 (créées le 06/07) | Q8 |
| `freelance` | 2, toutes deux `freelance_mode = both` et `team_size` renseigné | Q8 |
| Organisations avec au moins une mission | **2** : `org_1` (enterprise, 12 missions dont 9 actives) et `org_16` (type vide, 2 missions) | Q13 |
| Organisations avec une recherche hors mission | 2 : `org_1` (6), `org_9` (1) | Q13 |
| Créateurs de missions par organisation | 1 dans chacune | Q13 |
| Missions avec un nom de client (`sourcing_projects.client_name`) | 8 sur 14 (6 dans `org_1`, 2 dans `org_16`) | Q13 |
| Missions avec un client dans le poste (`job_details.client.name`) | 6 sur 14 | Q14 |
| `recruitment_mode` du poste | absent 9, `internal` 4, `client` 1 | Q14 |
| Missions `internal` qui ont pourtant un nom de client | 3 sur 4 | Q14 |

**Ce que ça dit.**
- **Le type d'organisation ne permet pas de décider l'écran.** Plus de la moitié des organisations n'en ont pas (9 sur 17). Or la conception fait dépendre le panneau Client (« cabinet et indépendant ») et le mode chasse (« entreprises seulement ») de ce type (synthèse, sections 3.1 et 3.2).
- **`org_1` est typée « entreprise » mais travaille comme un cabinet** : la moitié de ses missions ont un client (6 sur 12, Q13) et c'est elle qui a créé les 4 liens de portail client (Q23).
- **« Géré en interne » ou « pour un client » n'est lisible nulle part.** Deux champs de client divergent (8 contre 6, Q13 et Q14), et 3 des 4 missions « internes » ont un client (Q14). `recruitment_mode` ne règle que le ton des messages (`lecture-marketplace.md` §5).

---

## 3. Membres et rôles

| Mesure | Valeur | Requête |
|---|---|---|
| Organisations à un seul membre | **16 sur 17** | Q9 |
| Organisation à plusieurs membres | `org_1` : 3 (1 propriétaire, 2 administrateurs) | Q9 |
| Rôle `member` | 0 partout | Q9 |
| Rôle `collaborator` | 0 partout | Q9 |
| Appartenances / personnes distinctes | 19 / 13 | Q10 |
| Personnes dans plusieurs organisations | 3, dont une dans 5 | Q10 |
| Profils | 13 | Q10 |
| `user_roles` (rôles plateforme) | 0 | Q10 |

**Ce que ça dit.** Les rôles `member` et `collaborator` n'ont jamais été donnés. Le seul cas d'équipe est 1 propriétaire et 2 administrateurs. Une personne dans 5 organisations ressemble à des comptes d'essai, sans preuve.

---

## 4. Équipes de mission et invitations

| Mesure | Valeur | Requête |
|---|---|---|
| Lignes `mission_team` | **3** : `m1` sourcer (30/04), `m5` lead (30/04), `m7` sourcer (20/05) | Q12 |
| Dont membres externes à l'organisation | 0 (les 3 sont membres de `org_1`) | Q12 |
| Dont rôle « freelance » | 0 | Q22 |
| Dont `permissions` renseigné | 0 | Q12 |
| Invitations d'organisation | 2, rôle admin, acceptées, `org_1`, du 28/04 au 18/05 | Q11 |
| Invitations de mission | 1, rôle freelance, en attente, envoyée le 08/09, non expirée | Q11 |
| E-mails d'invitation d'équipe (journal) | 10 lignes pour 2 invitations : 4 en attente, 3 envoyés, 2 échecs, 1 abandonné | Q35 |
| E-mails d'invitation de mission | 2 lignes (1 en attente, 1 envoyé), 08/09 | Q35 |

**Ce que ça dit.** L'équipe de mission n'a servi qu'à étiqueter deux collègues internes en avril et mai. Rien ne la lit pour répartir le travail (`lecture-equipe.md` §4 : rôle affiché seulement, `permissions` sans lecteur). La seule invitation d'un externe date du 08/09 et n'a pas été acceptée. Le journal des e-mails montre 2 échecs et 1 abandon pour 2 invitations d'équipe : l'invitation a eu du mal à partir.

---

## 5. Qui travaille sur les candidats

| Mesure | Valeur | Requête |
|---|---|---|
| Lignes candidats (`job_candidate_status`) | 2 061, **1 seule organisation**, 3 auteurs | Q38 |
| Auteur principal | 1 988 lignes (96,5 %), du 21/04 au 20/07, dont 32 contactés, ayant répondu ou retenus | Q40 |
| Deuxième auteur | 44 lignes, un seul jour (18/05), 0 avancée | Q40 |
| Troisième auteur | 29 lignes, un seul jour (28/04), 0 avancée | Q40 |
| Missions travaillées à deux | 2 sur 9 : `m1` (167 lignes) et `m6` (452 lignes) | Q39 |
| Missions de `org_16` avec candidats | 0 (toutes les lignes sont dans une seule organisation) | Q38, Q13 |
| Dernière ligne créée | 20/07/2026 | Q38 |

**Ce que ça dit.** Deux personnes n'ont jamais travaillé la même mission dans la durée. Le « plusieurs recruteurs sur une mission » est à concevoir sans modèle d'usage existant. `org_16` a créé 2 missions le 16/07 sans jamais y trouver un candidat ; elle n'a pas de compte LinkedIn relié (Q31).

---

## 6. Commentaires, notes, attributions, favoris

| Mesure | Valeur | Requête |
|---|---|---|
| Commentaires (`candidate_comments`) | 3, 1 auteur, dernier le 06/05 | Q15 |
| Dont avec mention | 1 | Q15 |
| Notes « Perso » (`candidate_notes`) | **0** | Q15 |
| Attributions de candidat (`candidate_assignments`) | **0** | Q15 |
| Attributions de mission (`job_assignments`) | 4, 2 personnes, dernière le 04/06 | Q15 |
| Rotation (`round_robin_state`) | 0 | Q15 |
| Missions épinglées (`job_favorites`) | 2, 1 personne, 24/09 | Q15 |
| CV déposés (`candidate_cvs`) | 1, 06/05 | Q15 |

**État du code** (d'après `lecture-equipe.md` §7 et §8) : commentaires et mentions branchés dans la fiche du `/pipeline` ; `candidate_notes` branché mais lisible par tous ; `candidate_assignments` écrit par un outil de l'assistant, lu par aucun écran ; `job_assignments` et `round_robin_state` sans lecteur ni écrivain.

**Ce que ça dit.** Les 4 lignes de `job_assignments` sont des restes : aucune ligne de code ne les écrit aujourd'hui. Les commentaires se sont arrêtés au 06/05. Rien à reprendre pour concevoir un fil de mission.

---

## 7. Évaluations

| Mesure | Valeur | Requête |
|---|---|---|
| Grilles (`candidate_evaluations`) | 12, 2 auteurs, 1 organisation, du 30/04 au 24/09 | Q15, Q16 |
| Rattachées à une mission (`job_id` = identifiant de mission) | **4 sur 12** | Q16 |
| Étape d'entretien (`interview_stage`) renseignée | **0 sur 12** | Q16 |

**Une hypothèse à vérifier.** Le portail client enregistre l'avis du client comme une grille, avec un auteur fictif `00000000-…` et `job_id` = la mission (`client-portal-data/index.ts:208-223`). Le 16/06, 2 grilles de 2 auteurs, toutes deux rattachées à une mission (Q16), le jour même où un lien de portail a été créé et ouvert (Q23). L'un des « 2 auteurs » est peut-être le portail. Non mesuré : il faudrait compter `created_by = '00000000-0000-0000-0000-000000000000'`.

**Ce que ça dit.** Les grilles ne sont presque jamais reliées à une mission ni à une étape. Le lot 6 (« grilles liées aux étapes », synthèse section 13) part de zéro, sans reprise.

---

## 8. Tâches

| Mesure | Valeur | Requête |
|---|---|---|
| Tâches (`candidate_reminders`) | 18, **1 seul auteur**, toutes terminées, 0 en retard | Q17 |
| Tâches manuelles « general » | 10, toutes créées le 06/05, toutes avec un candidat | Q17 |
| Suggestions acceptées (`auto_generated`) | 8 : relance 5 (07/05 au 24/09), débrief 2, préparation d'entretien 1 | Q17 |
| Tâches rattachées à une mission | **0** (10 ont un `job_id`, aucun ne désigne une mission) | Q17 |
| Tâches venues de l'extension | 0 | Q17, Q41 |

« `auto_generated` » ne veut pas dire créé par le serveur : c'est une suggestion de `/tasks` acceptée d'un clic (`Tasks.tsx:200-214` ; suggestions dans `useAutoTaskSuggestions.ts:153, 186, 256`).

**Ce que ça dit.** Les tâches ne sont ni confiées à quelqu'un, ni rattachées à une mission. Les 10 tâches créées le même jour ressemblent à un essai. Le « Plus tard » de la carte Maintenant n'a rien à reprendre des tâches existantes.

---

## 9. Notifications

| Mesure | Valeur | Requête |
|---|---|---|
| Notifications | 18 | Q18 |
| « Essai terminé » | 13, le 21/09, à 13 personnes de 11 organisations | Q18, Q19 |
| « Tâche de fond interrompue » | 3, le 15/07 | Q19 |
| « Scoring terminé » | 1, le 15/07 | Q19 |
| Mention d'un collègue | **1**, le 06/05, **jamais lue** | Q18, Q19 |
| Non lues | 13 sur 18 | Q18 |
| Notifications de marketplace, de réponse de candidat, d'équipe | 0 | Q19 |

**Ce que ça dit.** La seule notification d'une personne à une autre n'a jamais été ouverte. 72 % des notifications (13 sur 18) sont l'expiration de l'essai.

---

## 10. Conversations de l'assistant

| Mesure | Valeur | Requête |
|---|---|---|
| Conversations | 100 : 99 pour une personne de `org_1` (18/05 au 24/09), 1 pour une personne de `org_4` (06/07) | Q20 |
| Messages | 772 (766 + 6) | Q20 |
| Conversations rattachées à une mission (`project_id`) | **0 sur 100** | Q20 |
| Rattachées à un poste (`job_id`) | 1 | Q20 |
| Archivées | 0 | Q20 |
| Appels d'outils | **178** | Q21 |
| Lectures exécutées d'office | 133 (missions 27, candidats d'une mission 22, connaissances 12, fil LinkedIn 12, séquences 11, …) | Q21 |
| Actions exécutées après accord | 17 : filtres appliqués à une mission 11, mission créée 3, notation lancée 2, poste modifié 1 | Q21 |
| Refusées par l'utilisateur | 15 : **envoi LinkedIn 14**, recherche 1 | Q21 |
| Échecs | 13 : recherche de connaissances 7, prise de contact d'un candidat 5, envoi LinkedIn 1 | Q21 |
| Envois LinkedIn réussis via l'assistant | **0 sur 15 proposés** | Q21 |
| Outil « équipe » (`get_team_overview`) | 3 | Q21 |
| Outil « e-mails » (`search_email_threads`) | 1, le 16/07 | Q21 |

**Ce que ça dit.**
- L'assistant sert à **lire et préparer**, pas à agir. Les 14 refus d'envoi confirment la règle de la synthèse : l'assistant propose, ne décide jamais seul (section 0, phrase 4).
- Ce que la synthèse appelle « la conversation de cette mission » (panneau Assistant, lot 9) n'a aucun précédent : 0 conversation sur 100 porte une mission. Le rattachement a été ajouté le 23/09 (`usage-prod-mesures.txt`, Q12).
- Les outils externes passent aujourd'hui par l'assistant (section 13), mais très peu : 1 recherche d'e-mails en 178 appels.

---

## 11. Marketplace et mode chasse

| Mesure | Valeur | Requête |
|---|---|---|
| Missions en mode chasse (`hunt_mode`) | 3, toutes dans `org_1` | Q13 |
| Missions avec une trace de chasse | 4 : `m1` (sans statut, prime 15 %, 3 recruteurs), `m4` et `m7` (brouillon, vides), `m11` (brouillon, prime 17 %, 3 recruteurs, date limite 31/07 **dépassée**, modifiée le 22/09) | Q24 |
| Missions publiées | **0** (aucun statut autre que brouillon) | Q13, Q24 |
| Candidatures de cabinets (`hunt_applications`) | **0** | Q22 |
| Demandes d'adhésion (`feature_activations`) | 1, `marketplace_recruit`, en attente de validation depuis le 08/09, organisation `enterprise` | Q22, Q23 |
| Recruteurs externes dans une équipe de mission | 0 | Q22 |
| Profils publics : accroche / adresse publique / placements > 0 | 4 / 3 / **0** | Q22 |
| Tables `partner_circles`, `marketplace_partners` | absentes, **par construction** : la migration du cercle fermé n'en crée pas, elle passe par des fonctions et `feature_activations` (`20260907053654_marketplace_partner_circle.sql:249-1253`) | Q26 |

**État du code** (`lecture-marketplace.md` §0) : branché de la demande d'adhésion jusqu'à l'acceptation d'un cabinet ; rien après (pas de présentation à l'entreprise, pas d'honoraires, pas d'avis).

**Ce que ça dit.**
- **Ni le côté entreprise ni le côté cabinet n'a servi.** Il n'existe aucun partenaire validé, donc aucune mission ne peut être ouverte à un cabinet aujourd'hui.
- La demande d'adhésion vient d'une organisation `enterprise`, alors que l'adhésion est pensée pour les cabinets (`marketplace_recruit`). Même flou de type qu'en section 2.
- `m1` garde une prime sans mode chasse, `m11` une date limite dépassée : des réglages orphelins que l'écran actuel laisse traîner.

---

## 12. Portail client

| Mesure | Valeur | Requête |
|---|---|---|
| Liens de portail client | **4**, tous de `org_1` (enterprise), 1 mission chacun | Q22, Q23 |
| Ouverts au moins une fois | **4 sur 4** | Q23 |
| Création / dernier accès | 11/05 → 12/05 ; 20/05 → 20/05 ; 16/06 → 16/06 ; 15/07 → 16/07 | Q23 |
| Date d'expiration | aucune sur les 4 | Q23 |
| Portail candidat (`candidate_portal_tokens`) | 0 | Q22 |

**Ce que ça dit.** C'est la seule fonction tournée vers l'extérieur qui a servi, 4 fois, à raison d'un lien par mission. Chaque lien a été ouvert le jour même ou le lendemain. On ne sait pas si c'est le client ou le recruteur qui l'a ouvert (aucune trace de l'ouvreur). Le lot 8 (« un lien par client et mission ») correspond à l'usage observé. Les liens n'expirent jamais : à traiter dans ce lot.

---

## 13. Connecteurs et intégrations

| Mesure | Valeur | Requête |
|---|---|---|
| Catalogue de connecteurs (`connector_registry`) | **0 ligne**, alors que la migration en insère 8 (Bullhorn, Huntool, Jarvi, Notion, Airtable, Aircall, Calendly, LinkedIn Recruiter, `20260327110000_connector_framework.sql:134-144`) | Q25 |
| Connecteurs installés (`connector_instances`) | 0 | Q25 |
| Tables `connector_sync_runs`, `connector_entity_mappings`, `connector_field_mappings` | **absentes** en production, alors que la même migration les crée (`:50-132`) | Q26 |
| Migration `connector_framework` dans le suivi | marquée appliquée | Q27 |
| Tables `external_candidates`, `candidate_interactions` (import prévu) | absentes | Q26 |
| `organization_integrations` | 3 lignes (`org_1`, `org_5`, `org_16`) | Q28, Q30 |
| Intégrations marquées connectées (Aircall, Airtable, Calendly, Notion, LinkedIn) | **0** | Q28 |
| Clés propres saisies (Aircall, Airtable, Calendly, Notion, LinkedIn, Apollo, PDL, Anthropic, Coresignal) | **0** | Q28 |
| Base Konekt activée | 1 (`org_1`) | Q28, Q30 |
| Connexion Notion de l'assistant | **1** (`org_1`), depuis le 16/07, **utilisée le 24/09**, sans erreur | Q29, Q30 |
| Serveurs MCP de l'organisation | 1 (`org_1`), créé le 15/07, **désactivé** | Q29, Q30 |
| Cache Notion | 2 lignes | Q29 |
| Lignes Airtable (candidats, postes, notes, placements, synchro) | 0 | Q29 |

**Tracé ≠ exécuté.** La migration `connector_framework` figure dans le suivi (Q27) mais ni ses tables (Q26) ni son catalogue (Q25) ne sont en base. C'est cohérent avec la réparation du suivi qui a marqué des versions « appliquées » sans rejouer leur contenu (CLAUDE.md, runbook point 6). Conséquence : **une migration marquée appliquée ne prouve pas qu'un objet existe en production.** Toute conception qui s'appuie sur ces tables doit d'abord les recréer.

**Ce que ça dit.** Aucune intégration ne fait entrer ni sortir de donnée candidat pour un client. Les seuls usages vivants sont personnels et passent par l'assistant (Notion en lecture seule). Il n'y a rien à afficher dans une mission au titre des intégrations aujourd'hui, et rien à migrer.

---

## 14. Comptes e-mail, LinkedIn, WhatsApp

| Mesure | Valeur | Requête |
|---|---|---|
| Boîtes e-mail reliées | **1** (Outlook, `org_1`, état OK, reliée le 16/07) | Q31 |
| Comptes LinkedIn reliés | 3, tous dans `org_1`, tous OK ; 2 avec proxy par pays (derniers reliés le 18/05), 1 sans proxy (28/04) | Q31 |
| Organisations avec un compte LinkedIn | 1 sur 17 | Q31 |
| Table de comptes WhatsApp (`member_whatsapp_accounts`) | **absente** | Q26 |
| Étapes WhatsApp dans une séquence | 0 | Q33 |
| Événements de webhook enregistrés | 2 (service LinkedIn, type vide, 1 compte, 24/09) | Q32 |

**Ce que ça dit.** Chaque membre de `org_1` a son compte LinkedIn. Aucune autre organisation ne peut chercher ni contacter sur LinkedIn. WhatsApp n'existe qu'au niveau de la contrainte de l'éditeur de séquences (`20260401110000_whatsapp_channel.sql:5-31`), sans compte possible (`lecture-canaux.md` §2.3). Les tables `jarvis_*` de la migration `jarvis_whatsapp_foundation` servent un assistant personnel du fondateur, sans lien avec les candidats (`20260713153549_jarvis_whatsapp_foundation.sql:1-2`).

---

## 15. Séquences : étapes et exécutions par type

| Mesure | Valeur | Requête |
|---|---|---|
| Séquences | 2, **toutes inactives, aucune rattachée à une mission** | Q33 |
| Étapes | 17 : message 5, attente de réponse 3, attente de connexion 2, visite de profil 2, invitation 2, vérification de connexion 1, InMail 1, e-mail 1 | Q33 |
| Canal d'étape (`step_channel`) renseigné | 0 sur 17 | Q33 |
| Inscriptions | 17 : 15 en pause (sans motif), 2 « a répondu » | Q33 |
| Inscriptions avec e-mail / téléphone | 0 / 0 | Q33 |
| Exécutions | 64 : « envoyé » 47, sauté 13, annulé 4 ; canal vide sur toutes | Q33 |
| Visites de profil exécutées | 17 | Q34 |
| Vérifications de connexion | 17 (comptées « envoyé ») | Q34 |
| Invitations LinkedIn envoyées | **13** (+ 2 annulées) | Q34 |
| Attentes de connexion | 13 sautées | Q34 |
| **Messages envoyés par une séquence** | **0** (2 annulés) | Q34 |
| InMails ou e-mails envoyés par une séquence | 0 | Q34 |
| Période | du 07/05 au 14/05/2026, plus rien depuis | Q34 |

**Ce que ça dit.** Les séquences ont tourné une semaine en mai, pour une campagne (17 personnes), et n'ont jamais envoyé un message écrit. Sur les 47 « envoyés », 17 sont des vérifications, pas des envois. Le panneau Prise de contact (lot 5) conçu autour des séquences de la mission n'a aucune séquence de mission à afficher en production.

---

## 16. Messages et journaux

| Mesure | Valeur | Requête |
|---|---|---|
| Conversations classées dans la messagerie (`chat_categories`) | **52** : intéressé 23, pas intéressé 18, sans catégorie 6, à recontacter 5 ; du 29/04 au 20/07 | Q35 |
| InMails programmés envoyés (`inmail_queue`) | 4, le 30/06 | Q35 |
| Journal des actions LinkedIn | 8 : recherches manuelles 7 (08/09 au 24/09), message depuis la messagerie 1 (24/09) | Q35 |
| E-mails envoyés (`email_send_log`) | uniquement des invitations (12 lignes), aucun e-mail de prospection | Q35 |
| Suivi d'ouverture d'e-mail | 0 | Q35 |
| Adresses désinscrites | 0 | Q35 |
| Modèles de message / signatures | 2 / 4 | Q35 |
| Analyses de message en cache | 7 | Q35 |

**Ce que ça dit.** Le contact réel s'est fait à la main dans la messagerie LinkedIn : 52 conversations classées, contre 0 message de séquence. Le journal des actions LinkedIn ne commence que le 08/09 : il ne permet pas de compter les messages manuels d'avant. Les messages eux-mêmes restent chez le prestataire, aucune table ne les stocke (`lecture-canaux.md` §0, point 5).

---

## 17. Aircall, qualification et Calendly

| Mesure | Valeur | Requête |
|---|---|---|
| Appels Aircall | **0** | Q36 |
| Séances de coaching d'appel | 0 | Q36 |
| Entretiens (`qualification_sessions`) | 6, tous rattachés à une mission (`m2`, `m4` ×2, `m5` ×2, `m14`) | Q36, Q37 |
| Venus de Calendly | 2 (`m4`, `m5`), le 06/05 | Q37 |
| Statut | **6 sur 6 encore « prévu »**, dates toutes passées (dernière le 08/09) | Q36, Q37 |
| Avec verdict | **0** | Q36 |
| Avec résumé de notation | 0 | Q37 |
| Avec animateur désigné (`manager_id`) | 1 (`m14`, 08/09) | Q37 |
| Missions avec un lien de prise de rendez-vous | 1 | Q13 |
| Calendly configuré par une organisation | 0 | Q28 |
| Ancienne table `events` | 0 | Q36 |
| Fonctions de compte rendu d'appel et de coaching | 0 appel (compteurs `generate_call_report`, `live_coach` absents de Q42 ; `generate-call-report/index.ts:34`, `live-coach/index.ts:39`) | Q42 |

**Ce que ça dit.** Les 2 entretiens Calendly sont arrivés par le webhook de la plateforme, sans intégration posée par l'organisation. Personne ne clôt un entretien dans l'application : aucun verdict, aucun passage à « terminé ». La carte Maintenant (rangs 1 et 2 si la date est saisie, synthèse section 13, lot 3) verrait 6 entretiens « prévus » dans le passé : il faut un état « entretien passé sans verdict ».

---

## 18. Données importées

| Mesure | Valeur | Requête |
|---|---|---|
| Lignes candidats liées à Notion | **0 sur 2 061** | Q38 |
| Lignes avec étiquettes | 0 | Q38 |
| Lignes sans données de profil | 161 | Q38 |
| Lignes Airtable | 0 | Q29 |
| `candidate_profiles` | 0 | Q29 |
| Table d'import (`external_candidates`) | absente | Q26 |
| Blocs de mémoire de l'assistant (`knowledge_chunks`) | 3 521, 1 organisation, **0 venu d'un connecteur** | Q43 |
| Dont profils LinkedIn | 3 274, derniers le 19/05 | Q43 |
| Dont analyses de message | 136, jusqu'au 24/09 | Q43 |
| Dont documents déposés | 73, derniers le 16/07 | Q43 |
| Dont entretiens, missions, grilles, commentaires | 7, 6, 4, 3 | Q43 |

**Ce que ça dit.** Aucune donnée candidat n'est venue d'un outil externe. Tout ce qui est en base a été trouvé dans Konekt. La refonte peut changer le modèle des candidats sans reprise d'import. Les documents déposés (73 blocs, section 20) sont le seul apport externe, et ils servent seulement l'assistant.

---

## 19. Extension Chrome

| Mesure | Valeur | Requête |
|---|---|---|
| Jetons d'extension | 2, **tous deux révoqués, jamais utilisés** | Q41 |
| Tâches créées depuis l'extension | 0 | Q17, Q41 |

**Ce que ça dit.** L'extension n'a jamais été utilisée en production. La synthèse garde `status` et `pipeline_stage` remplis pendant la transition, entre autres parce que « l'extension Chrome lit les valeurs brutes » (section 3.3, règle « Compatibilité »). **Cette raison ne pèse rien aujourd'hui** ; seuls les deux déclencheurs de statistiques cités au même endroit justifient encore ces colonnes.

---

## 20. Enrichissement

| Mesure | Valeur | Requête |
|---|---|---|
| Demandes d'enrichissement | 18 : **8 terminées, 10 en attente depuis le 06/07** | Q41 |
| Couvertes par le forfait (`included`) | 0 | Q41 |
| Coordonnées saisies à la main (`candidate_contacts`) | 1 (06/05) | Q41 |
| Appels à l'enrichissement / relectures d'état | 23 / 122, 1 personne, jusqu'au 06/07 | Q42 |
| Crédits d'enrichissement | e-mail 4 opérations (4 crédits), téléphone 1 (10 crédits) | Q44 |
| Recherches Base Konekt | 57 appels, 1 personne, du 08/07 au 15/07 | Q42 |
| Crédits Base Konekt | aperçu 20 (29 crédits), collecte 22 (44 crédits) | Q44 |
| Fiche société à l'inscription (`enrich_company`) | 34 appels, **9 personnes** | Q42 |

`enrich_company` touche 9 personnes parce qu'il est appelé à l'inscription (`SceneOrganization.tsx:172`) et à la création de mission (`CreateProjectModal.tsx:377`).

**Ce que ça dit.** 10 demandes sur 18 sont restées en attente depuis 80 jours. La Base Konekt a servi une semaine, à une personne. Aucune coordonnée enrichie n'a servi à un envoi (0 inscription avec e-mail ou téléphone, Q33).

---

## 21. Usage des fonctions (`rate_limit_log`)

17 842 appels comptés sur 20 actions, du 21/04 au 24/09 (Q42). Le journal devait ne garder que 24 heures (`20260313002353_…sql:48-49`), mais il remonte au 21/04 : le nettoyage ne tourne pas, ce qui rend cette mesure possible.

| Action | Appels | Personnes | Période | Lecture |
|---|---|---|---|---|
| `unipile_search` | 11 117 | 3 | 21/04 → 24/09 | Tout appel au service LinkedIn (recherche, profil, messagerie, envoi) |
| `ai_credits` | 4 927 | **10** | 21/04 → 24/09 | Surtout des lectures de solde : présence dans l'application |
| `generate_embedding` | 470 | 1 | 30/04 → 20/07 | Mémoire de l'assistant |
| `generate_outreach` | 321 | 2 | 30/04 → 20/07 | Rédaction de messages |
| `analyze_response` | 272 | 2 | 28/04 → 24/09 | Analyse des réponses |
| `generate_reply_suggestions` | 219 | 2 | 28/04 → 24/09 | Réponses proposées |
| `score_profile` | 181 | 1 | 30/04 → 20/07 | Notation |
| `enrichment_status_poll` | 122 | 1 | 30/04 → 06/07 | |
| `coresignal_search` | 57 | 1 | 08/07 → 15/07 | Base Konekt |
| `generate_search_filters` | 42 | 1 | 21/04 → 24/09 | |
| `enrich_company` | 34 | 9 | 30/04 → 16/07 | Inscription |
| `generate_scorecard` | 28 | 1 | 05/05 → 24/09 | Grille par l'IA |
| `enrich_contact` | 23 | 1 | 27/04 → 06/07 | |
| `database_search` | 10 | 1 | 27/04 | Fonction supprimée depuis |
| `nl_filter_edit` | 6 | 1 | 15/07 | |
| `ingest_user_file` | 5 | 1 | 15/07 → 16/07 | Documents déposés |
| `refine_search_filters`, `detect_fraud` | 3, 3 | 1 | mai à juillet | |
| `send_transactional_email`, `apollo_search` | 1, 1 | 1 | 08/09, 06/05 | |

**Fonctions qui comptent leurs appels mais n'en ont aucun** : `run_agent_search` (`run-agent-search/index.ts:118-120`), `live_coach`, `generate_call_report`, `ai_chat_completion` (`ai-chat-completion/index.ts:29-31`), `retrieve_context`, `ingest_context` (appels internes non comptés), `rgpd_erase`. Réserve : on ne sait pas depuis quand chaque compteur existe.

**Point pour la conception.** Le lot 4 de la synthèse s'appuie sur `run-agent-search` pour créer les lignes de la tâche « chercher et noter » (section 13). **Aucun appel utilisateur de cette fonction n'est enregistré.** C'est un chemin jamais éprouvé en production, à tester comme du neuf.

---

## 22. Crédits IA (`ai_credit_transactions`)

1 050 opérations, 3 718 crédits, 25 actions, une seule organisation par action, au plus 2 personnes par action (Q44). Toutes sur le forfait (`source = plan`), sauf 2 dons de l'administrateur à 0 crédit.

| Action | Opérations | Crédits | Part | Dernière |
|---|---|---|---|---|
| Rédaction de message (`outreach_message`) | 318 | 1 353 | **36 %** | 20/07 |
| Calibrage de recherche de l'assistant (`agent_search_calibration`) | 301 | 1 268 | **34 %** | 15/07 |
| Notation (`scoring`) | 113 | 396 | 11 % | 20/07 |
| Conversation avec l'assistant (`agent_chat`) | 78 | 191 | 5 % | 24/09 |
| Analyse de réponse | 24 | 124 | 3 % | 24/09 |
| Génération de filtres | 38 | 79 | 2 % | 24/09 |
| Autres (19 actions) | 178 | 307 | 8 % | |

**Ce que ça dit.** Sept crédits sur dix vont à deux choses : **rédiger des messages de prise de contact** et **laisser l'assistant calibrer une recherche**. La rédaction est l'usage IA le plus régulier (318 fois, 2 personnes). Le geste « Contacter » avec rédaction depuis le poste (lot 5) touche donc l'usage IA principal. Le calibrage s'est concentré sur une période (dernier le 15/07) et a produit 3 notifications « Tâche de fond interrompue » le même jour (Q19).

---

## 23. Chronologie : quand l'usage s'arrête

| Activité | Dernière date | Requête |
|---|---|---|
| Exécution de séquence | 14/05 | Q34 |
| Commentaire d'équipe | 06/05 | Q15 |
| Attribution de mission (table morte) | 04/06 | Q15 |
| InMail programmé | 30/06 | Q35 |
| Enrichissement de contact | 06/07 | Q41 |
| Recherche Base Konekt | 15/07 | Q42 |
| Accès au portail client | 16/07 | Q23 |
| **Ligne candidat, rédaction de message, notation, classement de conversation** | **20/07** | Q38, Q44, Q35 |
| Création de mission, invitation d'un externe, demande d'adhésion marketplace, entretien | 08/09 | Q13, Q11, Q23, Q37 |
| Mission en mode chasse modifiée | 22/09 | Q24 |
| Conversation d'assistant, grille, tâche, épingle, Notion, recherche LinkedIn | 24/09 | Q20, Q16, Q17, Q15, Q29, Q35 |

**Ce que ça dit.** Le travail de recrutement s'arrête le 20/07. Les gestes de septembre touchent chaque fois des fonctions tout juste livrées (marketplace le 08/09, barre latérale et assistant le 24/09) : vraisemblablement des essais, sans preuve. Tous les essais gratuits ont expiré le 21/09 (Q19).

---

## 24. Ce que ces chiffres disent pour la conception

### 24.1 Ce qui est réellement utilisé

| Fonction | Preuve | Requête |
|---|---|---|
| Recherche LinkedIn | 11 117 appels, 3 personnes | Q42 |
| Tri et notation des profils | 2 061 lignes, 113 notations facturées | Q38, Q44 |
| Messagerie LinkedIn manuelle | 52 conversations classées | Q35 |
| Rédaction de messages par l'IA | 318 rédactions, 36 % des crédits | Q44 |
| Assistant (lecture et préparation) | 100 conversations, 133 lectures d'office | Q20, Q21 |
| Portail client | 4 liens, 4 ouverts | Q23 |

Tout cela est le fait d'**une organisation et, pour l'essentiel, d'une personne**.

### 24.2 Ce qui a servi une ou deux fois

Séquences (une campagne en mai, 0 message), InMails programmés (4), entretiens (6, jamais clos), grilles (12, 4 reliées à une mission), tâches (18, toutes d'une personne), Base Konekt (une semaine), enrichissement (18 demandes, 10 bloquées), connexion Notion de l'assistant (1), équipe de mission (3 étiquettes internes), commentaires (3).

### 24.3 Ce qui n'a jamais servi

Candidatures de marketplace, missions publiées, partenaires validés (Q22, Q24) ; recruteur externe dans une mission (Q12, Q22) ; attribution de candidat, notes « Perso », rotation (Q15) ; rôles `member` et `collaborator` (Q9) ; connecteurs ATS, catalogue, synchronisation (Q25, Q26) ; clés Notion, Calendly, Airtable, Aircall (Q28) ; appels Aircall, coaching, comptes rendus d'appel (Q36, Q42) ; e-mail de prospection, suivi d'ouverture (Q34, Q35) ; WhatsApp (Q26, Q33) ; extension Chrome (Q41) ; portail candidat (Q22) ; import de candidats (Q26, Q38) ; recherche de fond par l'assistant `run-agent-search` (Q42) ; serveur MCP (désactivé, Q29).

### 24.4 Conséquences pour la page mission

**Général.**
1. **Concevoir d'abord pour une personne seule.** 16 organisations sur 17 n'ont qu'un membre (Q9), et l'organisation à trois membres travaille à 96,5 % par une seule personne (Q40). Tout élément d'équipe (avatars, « confié à », fil d'équipe) doit disparaître quand l'organisation n'a qu'un membre, au lieu d'afficher un vide.
2. **Rien à reprendre pour l'équipe, la marketplace et les intégrations**, sauf 4 liens de portail (Q23). Les nouvelles tables peuvent être posées sans reprise de données. Seule précaution : la migration du cadre de connecteurs est marquée appliquée sans exister (Q26, Q27), donc repartir d'un fichier neuf qui rejoue sur une base vide (règle 6 du CLAUDE.md).
3. **Le type d'organisation ne suffit pas à choisir les écrans** (9 sur 17 vides, Q8 ; `org_1` « entreprise » travaille comme un cabinet, Q13, Q23). Le panneau Client et l'entrée « recruteurs externes » doivent dépendre de la mission (a-t-elle un client ? est-elle confiée ?), pas du seul type d'organisation. Cela demande **un champ explicite sur la mission**, puisque les deux champs de client divergent et que `recruitment_mode` contredit le client dans 3 cas sur 4 (Q13, Q14).

**Travail en équipe.**
4. **Aucun usage à protéger.** 3 lignes d'équipe, 0 externe, 1 mention jamais lue, 0 attribution (Q12, Q15, Q18). On peut refondre le modèle (responsable de mission, attribution d'un candidat) sans migration de contenu.
5. **Ne pas mettre l'équipe dans la carte Maintenant ni en tête du Pipeline.** Un rang « Relancer un collègue » n'aurait aucune donnée réelle. La section Équipe de Cadrage (lot 7) suffit tant qu'aucune organisation n'a deux personnes actives.

**Marketplace.**
6. **Laisser la marketplace dans Cadrage, section « Équipe et recruteurs externes »**, comme le prévoit déjà la synthèse (section 3.2, mode chasse). Aucune place sur l'écran Pipeline tant qu'une mission n'a pas reçu de première candidature. 0 candidature, 0 partenaire (Q22).
7. **Nettoyer les réglages orphelins** avant de les afficher : prime sans mode chasse (`m1`), date limite dépassée (`m11`) (Q24).

**Portail client.**
8. **Le panneau Client (lot 8) a une base réelle, petite** : un lien par mission, ouvert vite (Q23). Garder « un lien par client et mission », ajouter une expiration (aucune aujourd'hui) et savoir qui ouvre.

**Intégrations.**
9. **Pas de zone « intégrations » dans la mission.** Aucune donnée n'entre ni ne sort par un outil externe pour un client (Q25, Q28, Q38, Q43). Les seuls usages externes vivants passent par l'assistant (Notion, 1 recherche d'e-mails, Q21, Q29). Si la mission doit montrer une source externe, le premier candidat naturel est **Calendly vers l'entretien** (2 entretiens reçus, Q37), pas un ATS.
10. **Ne pas dessiner WhatsApp ni l'e-mail comme canaux de la mission pour l'instant.** 0 compte WhatsApp possible (Q26), 0 e-mail de prospection parti (Q34, Q35), 1 seule boîte reliée (Q31). Le geste « Contacter » doit partir du message LinkedIn manuel, le seul canal réellement utilisé (Q35), avec la rédaction par l'IA (Q44).
11. **Séquences : ne pas en faire le cœur du panneau Prise de contact.** 2 séquences, inactives, sans mission, aucun message envoyé (Q33, Q34). Le panneau doit être utile sans séquence.
12. **Entretiens : prévoir la clôture.** 6 entretiens « prévus » dans le passé, 0 verdict (Q36, Q37). La carte Maintenant doit savoir dire « entretien passé, verdict à saisir ».
13. **Assistant : le rattacher à la mission est un vrai changement, pas une reprise.** 0 conversation sur 100 porte une mission (Q20). Et l'assistant ne doit pas proposer l'envoi comme geste principal : 15 propositions, 0 envoi (Q21).
14. **Extension : la compatibilité n'est pas un frein.** 2 jetons révoqués, jamais utilisés (Q41).

---

## 25. Manques : ce que ces 44 requêtes ne disent pas

1. **Aucune mesure d'écran.** On ne sait pas quelles vues de la mission sont ouvertes (Vue d'ensemble, Brief, Pipeline…), ni combien de temps. C'est la décision 12 de la synthèse (« mesure d'usage branchée », lot 0c) ; tant qu'elle n'existe pas, les choix d'écran reposent sur les données écrites, pas sur les visites.
2. **Le service LinkedIn n'est pas ventilé** : 11 117 appels sans distinguer recherche, lecture de profil, messagerie et envoi (`unipile-search/index.ts:290-297`). Le nombre de messages LinkedIn envoyés à la main avant le 08/09 est inconnu (journal des actions trop récent, Q35 ; messages non stockés).
3. **Beaucoup de fonctions ne laissent aucune trace d'usage** : webhooks, `process-sequences`, `search-agent-chat`, `client-portal-data`, fonctions de l'extension (absentes de la liste des `p_action`).
4. **Qui ouvre le portail client** : ni adresse ni identité de l'ouvreur. Et le nombre d'avis clients enregistrés comme grilles n'est pas mesuré (compter `created_by = '00000000-0000-0000-0000-000000000000'` dans `candidate_evaluations`, section 7).
5. **Les personnes ne sont pas suivies d'une requête à l'autre** (numérotation `u` propre à chaque requête). On ne peut pas dire si la personne de 99 conversations est celle des 1 988 lignes, même si c'est probable (`org_1` dans les deux cas, Q20, Q38).
6. **Les crédits IA ne sont pas rattachés à une organisation nommée** (Q44 donne 1 organisation par action, pas laquelle).
7. **Les doublons de candidats par personne** (même candidat, même mission, deux auteurs) ne sont pas mesurés ici ; `lecture-equipe.md` §0 en compte 60.
8. **Aucune fréquence d'usage** : pas de décompte par semaine ni par personne. On a des premières et dernières dates, pas des séances.
9. **Les secrets de la plateforme ne sont pas lisibles** : impossible de savoir si le Notion de Konekt reçoit des écritures pour toutes les organisations (risque signalé par `lecture-integrations.md` §3).
10. **Q2 et Q3 (statistiques du moteur) sont inutilisables** : pour une taille de table fiable, il faut un `count(*)`.
11. **Aucune date de mise en service des compteurs** : un « 0 » sur `run_agent_search` ou `live_coach` peut venir d'un compteur ajouté tard.

---

## Annexe A. Les 44 requêtes

| N° | Ce qu'elle mesure |
|---|---|
| Q1 | Liste des 122 tables du schéma `public` |
| Q2 | Lignes vivantes par table, statistiques du moteur (non fiables ici) |
| Q3 | Taille et lignes estimées des tables non vides |
| Q4 | Colonnes de 30 tables d'équipe, marketplace, intégrations, séquences |
| Q5 | Colonnes de `sourcing_projects` |
| Q6 | Colonnes de 25 autres tables (candidats, journaux, crédits, profils) |
| Q7 | Organisations par type (échec : `freelance_mode` est du texte) |
| Q8 | Organisations par type, dates, mode indépendant, taille d'équipe |
| Q9 | Membres et rôles par organisation |
| Q10 | Appartenances, personnes, multi-organisations, profils, rôles plateforme |
| Q11 | Invitations d'organisation et de mission |
| Q12 | Lignes `mission_team` : rôle, droits, interne ou externe |
| Q13 | Missions et recherches par organisation : actives, créateurs, chasse, client, lien de rendez-vous |
| Q14 | `recruitment_mode` et client dans le poste |
| Q15 | Notes, commentaires, mentions, grilles, attributions, rotation, épingles, CV, entretiens |
| Q16 | Grilles par jour : IA, rattachement à une mission, auteurs, étape |
| Q17 | Tâches par catégorie : faites, en retard, mission, candidat, auteur |
| Q18 | Notifications par type : non lues, personnes, organisations |
| Q19 | Notifications par modèle de titre |
| Q20 | Conversations de l'assistant par personne : mission, poste, messages |
| Q21 | Appels d'outils de l'assistant par outil et statut |
| Q22 | Marketplace, équipe externe, profils publics, portails |
| Q23 | Détail des liens de portail et des demandes d'adhésion |
| Q24 | Missions avec traces de mode chasse |
| Q25 | Catalogue et instances de connecteurs |
| Q26 | Existence de 14 tables attendues (connecteurs, import, WhatsApp, partenaires, activité) |
| Q27 | Présence de 5 migrations dans le suivi |
| Q28 | `organization_integrations` : drapeaux et clés |
| Q29 | Notion OAuth, MCP, caches, tables Airtable, `candidate_profiles` |
| Q30 | Détail par organisation : Notion, MCP, intégrations |
| Q31 | Boîtes e-mail et comptes LinkedIn par organisation |
| Q32 | Journal des webhooks |
| Q33 | Étapes, exécutions, inscriptions, séquences |
| Q34 | Exécutions par type d'étape et statut |
| Q35 | Journaux LinkedIn et e-mail, InMails, catégories de conversation, modèles |
| Q36 | Aircall, coaching, entretiens, verdicts, anciens événements |
| Q37 | Détail des 6 entretiens |
| Q38 | Lignes candidats : Notion, mission, profil, auteurs, étiquettes |
| Q39 | Lignes candidats par mission et par auteur |
| Q40 | Lignes candidats par auteur : période, avancées |
| Q41 | Extension, coordonnées, enrichissements |
| Q42 | `rate_limit_log` par action |
| Q43 | Mémoire de l'assistant par source |
| Q44 | Crédits IA par action |
