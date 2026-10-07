# Actions proposées selon le contexte candidat

La messagerie et les fiches candidat doivent proposer la prochaine action utile à partir des échanges, de l’avancement dans une mission, des entretiens et du travail de l’équipe. Le recruteur voit le motif, les sources datées, le responsable proposé et une échéance modifiable avant de créer une tâche. Les messages restent des brouillons à relire.

## Première version

La démo `/inbox?demo=1` illustre trois situations : préparer un échange confirmé avec un sujet issu d’une publication LinkedIn fictive, se coordonner avec un collègue qui attend déjà une information du manager, et clarifier un critère non évalué dans une scorecard. Les propositions, sources complémentaires et tâches sont fictives, écrites pour cet aperçu, conservées en mémoire. Créer, terminer ou écarter une tâche ne touche aucun service. La fiche fictive et le contexte de la messagerie partagent le même état.

Le moteur réel reste à brancher. Cette proposition reprend les procédures Notion actuelles ; les intégrations décrites pour Notion et n8n ne prouvent pas leur disponibilité dans l’app.

## Actions à proposer

| Situation vérifiée | Proposition | Ce qui évite une mauvaise action |
| --- | --- | --- |
| Réponse avec une question ou une pièce demandée | Répondre ou préparer la pièce | Lire les échanges suivants et la tâche portée par un collègue avant de proposer |
| Entretien confirmé et préparation à faire | Préparer le brief et les questions | Vérifier la date actuelle, l’étape, les comptes rendus précédents et la préparation existante |
| Entretien passé sans retour candidat ou manager | Recueillir le retour manquant | Distinguer les deux retours ; une scorecard existante ne signifie pas que les deux sont recueillis |
| Scorecard avec critère non évalué ou avis contradictoires | Clarifier ce point à l’entretien suivant | Montrer les avis et leurs auteurs, sans moyenner les notes ni décider du sort du candidat |
| Retour manager explicite pour poursuivre | Organiser l’étape suivante | Ne pas proposer un nouvel entretien si un rendez-vous existe déjà |
| Manager sans réponse au-delà de sa cadence | Préparer sa relance et tenir le candidat informé | Lire la règle client et le dernier contact de toute l’équipe ; ne pas promettre une date de réponse client |
| CV, portfolio, références ou disponibilités attendus | Demander l’élément manquant | Vérifier qu’il n’est pas arrivé depuis et rappeler le besoin concret |
| Candidat annonçant une offre concurrente avec échéance | Faire un point avec le responsable du mandat | Citer l’échéance exprimée ; ne pas négocier ou inventer une offre |
| Candidat indisponible jusqu’à une date annoncée | Proposer un rappel à cette date | Suspendre les relances sur le même motif en attendant |

Les cadences viennent de la règle client et de la compétence concernée. Pour les relances de silence, la procédure actuelle prévoit deux relances maximum, à J+3 et J+7. Le contrôle des candidats actifs sans échange utilise sept jours ouvrés. Le retour manager sur présentation se suit sous 48 heures ouvrées, sauf cadence client. Ne pas fusionner ces règles en un seuil universel de cinq jours. Les dates relatives utilisent le fuseau de l’organisation et distinguent une date métier promise d’une échéance de tâche suggérée.

## Sources métier

Les [Consignes Agent IA](https://app.notion.com/p/4ccaf5bf38da4fe1ae0a438a03feb05a), mises à jour le 6 octobre 2026, fixent les règles générales et l’attribution à la personne qui porte l’action. Le [socle des compétences](https://app.notion.com/p/fe7409589c4744ff88c4d5cb476d1540) renvoie aux procédures. Les pages de [calage d’entretiens](https://app.notion.com/p/678e869c774f4e379138768fca1b711b), [débrief à chaud](https://app.notion.com/p/db14c72a082143d3b5bef06927955a71) et [relances candidat](https://app.notion.com/p/1112d0e50807410f827f1d994058bb08) détaillent les déclencheurs et leurs limites.

La [spec post-appel de février](https://app.notion.com/p/825ffcdf3dc046a0841275673c43dc17) fournit des exemples utiles. Ses raccourcis de refus, d’archivage et d’attribution ne remplacent pas les procédures actuelles : le débrief d’octobre prévoit notamment un appel pour annoncer un refus, et le responsable doit venir de la source ou être confirmé. La [fermeture des tâches par événement](https://app.notion.com/p/e080434a03c1405bb72b8121d33e7da6) reste explicitement une spécification ; sa création automatique de tâches et ses fermetures ne font pas partie de cette première version.

## Contexte à assembler

Un lecteur partagé assemble un contexte candidat pour une mission précise, utilisé par la messagerie, les fiches mission et pipeline, et la page Tâches. Il comprend le profil existant, le brief, les critères, l’étape et les décisions explicites, les échanges et engagements, les rendez-vous, chaque évaluation et compte rendu accessible, les tâches ouvertes et les interventions de l’équipe.

Chaque élément garde son identifiant durable, son type, sa date métier, sa date de collecte, sa version, son auteur, sa mission, sa visibilité et un lien vers la source. Les identifiants candidat sont rapprochés avec les alias et l’URL LinkedIn normalisée ; un nom seul ou un téléphone partagé ne suffit pas à fusionner deux personnes. Une interaction sur une autre mission conserve son rattachement et ne devient pas un retour sur la mission ouverte.

Chaque source expose trois états : chargement, disponible, indisponible. Une lecture en erreur, une page non chargée ou un canal non connecté ne signifie jamais « aucun message », « aucun entretien » ou « aucun compte rendu ». Les suggestions qui reposent sur une absence exigent une lecture complète et assez récente. Si la source nécessaire est inconnue, suspendre la proposition et permettre une nouvelle lecture.

## Entretiens et scorecards

Conserver séparément, pour chaque entretien et étape du process, la grille et les commentaires de chaque évaluateur, les comptes rendus candidat et manager, les verbatims utiles et les points à confirmer. Distinguer brouillon, résultat IA et retour humain validé. Une question restée ouverte devient un sujet pour l’étape suivante ; un avis divergent devient une clarification. Une note globale n’avance jamais le pipeline et ne vaut jamais décision du manager.

La migration `20261006144618_scorecard_live_lot1_rattachement.sql` prévoit `project_id` et `process_step_id` pour les évaluations, ainsi que `evaluation_id` et `qualification_session_id` pour les séances de coaching. Les créations dans `ScorecardTab.tsx` et `LiveCoachingPanel.tsx` n’alimentent pas encore ces rattachements. Avant le moteur réel, compléter ces écritures et les types générés. Les données historiques dont le rattachement reste ambigu apparaissent comme telles et ne ferment pas une tâche de débrief d’un entretien précis.

Les appels disposent déjà de synthèses structurées dans `phone_call_insights`, avec faits et `next_steps` contenant action, responsable et date. Les utiliser comme propositions sourcées, puis vérifier l’identité du candidat, l’auteur et la mission. Le nom ou l’email d’un agent téléphonique ne devient pas automatiquement un identifiant de membre.

## Coordination entre recruteurs

Afficher le responsable de la candidature, les autres intervenants, leur dernier contact et les tâches qu’ils portent. Si une relance vient d’être faite, la supprimer des suggestions encore à accepter ou expliquer l’attente. Si un collègue porte déjà l’action, proposer de consulter ou compléter la tâche existante. Le créateur de la tâche et son responsable sont deux personnes possibles, donc deux champs distincts.

Les données partagées de la mission suivent les droits de l’app. Les autres missions ne contribuent que si l’utilisateur peut les consulter. Les règles Notion permettant à l’équipe Konekt de travailler sur tous les clients ne modifient pas les autorisations actuelles de l’app. Une boîte personnelle d’un collègue ne s’ouvre pas par défaut : définir ce qui est partagé, par qui et à quel niveau avant d’élargir la lecture. Garder le compte personnel pour toute réponse.

`mission_conversations` fournit surtout les références et dates des conversations, pas leur texte intégral. Les messages de `useCandidateMessages` restent personnels, et les collaborateurs ont une lecture limitée de certains liens. Le fil d’activité conserve actuellement peu d’attribution pour les séquences et réservations. Le moteur d’équipe demande donc une provenance complète et une politique de partage explicite avant de pouvoir affirmer avoir lu toutes les interactions.

## Publications LinkedIn et API V2

La documentation officielle prévoit les [publications créées ou partagées par un utilisateur](https://developer.unipile.com/v2.0/reference/getpostslist), ainsi que les commentaires et réactions dans la [matrice des capacités](https://developer.unipile.com/v2.0/docs/list-provider-features). L’accès dépend du fournisseur, du compte connecté et de ce qu’il peut consulter ; ce n’est pas une garantie de collecte exhaustive.

La route V2 est `GET /v2/{account_id}/users/{user_id}/posts`. La [migration de l’API Users](https://developer.unipile.com/v2.0/docs/migration-users-api) change aussi les identifiants, champs du profil et curseurs. L’app récupère déjà certains posts par `get_user_posts` en V1, pour l’enrichissement et les séquences. Son usage V2 actuel concerne les webhooks. Il faut adapter et tester ces lecteurs avant d’annoncer une migration complète.

Conserver identifiant, URL, date et texte du post pour pouvoir le citer. Une publication professionnelle peut suggérer un sujet d’entretien ou contextualiser un message ; un like ou un post ne prouve ni disponibilité, ni recherche d’emploi, ni motivation. Aucun enrichissement massif à l’ouverture du chat : privilégier les données déjà recueillies et une actualisation explicite, avec quotas, cache et état de fraîcheur.

## Moteur et validation

Les règles vérifient les préconditions métier, dates, droits, doublons et décisions. L’IA extrait les engagements et questions dans les sources autorisées, puis rédige les propositions. Elle doit renvoyer les références qui justifient chaque action ; les textes externes sont des données, jamais des instructions à exécuter. Une source sans preuve suffisante donne une proposition à clarifier ou aucune proposition.

Afficher au plus trois propositions prioritaires par candidat : engagement avec échéance ou réponse attendue, entretien imminent ou retour manquant, puis préparation et suivi. La carte contient le verbe d’action, le motif concret, les sources consultables avec leurs logos, le responsable proposé, la mission et l’échéance. Le recruteur peut modifier, créer, reporter ou écarter. L’absence de proposition est un résultat valide.

Le serveur relit les sources et les tâches au moment de l’acceptation. Il vérifie l’organisation, l’accès à la mission, l’identité et les droits du responsable, puis crée ou retrouve une tâche dans une opération atomique. Une clé métier commune aux recruteurs associe organisation, candidat, mission, type d’action et objet concerné. Deux acceptations simultanées ne créent qu’une tâche active. Une source nouvelle peut faire évoluer la proposition ; un refus ne réapparaît pas sur la même version inchangée.

Les caches comprennent utilisateur, organisation, candidat, mission et périmètre de partage. Un changement d’organisation efface les propositions locales et une réponse tardive ne remplit pas le nouveau contexte. La création d’une tâche ne valide ni un envoi, ni un changement d’étape. Tout brouillon garde une relecture et un geste d’envoi distinct.

## Ordre de branchement

1. Fiabiliser les rattachements des entretiens, évaluations et rapports ; ajouter la provenance des actions d’équipe et leurs permissions.
2. Étendre `candidate_reminders` avec la mission interne, le responsable distinct du créateur, les références de provenance et une déduplication atomique. Prévoir un état durable des propositions acceptées, reportées ou écartées. Aujourd’hui, `job_id` ne remplace pas `project_id`, et le précontrôle de doublon ne protège pas deux créations simultanées.
3. Remplacer les faux positifs de `useAutoTaskSuggestions` : vérifier réellement les rapports, écarter les rendez-vous annulés et lire le dernier échange avant une relance. Partager le lecteur de contexte et le moteur entre les vues.
4. Brancher d’abord préparation, débrief, question sans réponse et élément attendu sur les sources déjà fiables. Ajouter ensuite coordination multicanal et signaux LinkedIn, avec tests d’adaptateur V2 et quotas.

## Critères de validation du moteur réel

- Une tâche de débrief n’apparaît pas si le retour demandé est déjà enregistré ; un rendez-vous annulé ne génère pas de préparation.
- Une nouvelle réponse ou l’intervention d’un collègue invalide la relance devenue inutile, sans prétendre que toutes les tâches de ce candidat sont terminées.
- Une scorecard avec critère inconnu génère une question, sans inventer une note ni une décision.
- Deux recruteurs acceptant la même proposition retrouvent une seule tâche et le même responsable.
- Un candidat engagé sur deux missions garde des propositions distinctes et des sources correctement rattachées.
- Un utilisateur sans droit sur une source ne voit ni son contenu, ni un résumé qui le révèle.
- Une panne ou une collecte partielle n’est pas traitée comme une absence ; un changement d’organisation ou de compte n’expose pas l’ancien contexte.
- Reporter ou écarter reste durable, et aucune proposition ne crée un message, une invitation ou un changement de statut sans le geste correspondant.
