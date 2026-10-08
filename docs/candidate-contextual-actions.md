# Actions proposées selon le contexte candidat

La messagerie et les fiches candidat doivent proposer du travail concret déjà préparé à partir des échanges, de l’avancement dans une mission, des entretiens et du travail de l’équipe. En deux ou trois clics, le recruteur doit pouvoir relire et modifier un brief, un message ou des changements dans l’app, puis valider les effets annoncés. Créer une tâche n’est utile que lorsque du travail doit réellement être différé.

## Parcours réel

La messagerie habituelle (`/inbox`, sans `demo=1`) et l’onglet Interactions des fiches mission/pipeline utilisent `candidate-actions`. « Préparer les actions » assemble le contexte autorisé, affiche le coût prévu selon les réglages de rédaction puis génère au plus trois propositions. Ouvrir le candidat et consulter les propositions existantes ne lance pas de génération payante.

La réponse du modèle utilise l’outil de données fermé `prepare_candidate_actions`, sans exécution. Les consignes de rédaction concernent seulement les textes candidat, jamais la structure JSON. Un ancien retour JSON brut ou un bloc JSON unique reste accepté après les mêmes validations ; une réponse tronquée, une cible inventée ou un autre outil est refusé. Une erreur de lecture se réessaie sans appel IA ; une nouvelle préparation reste volontaire et affiche son coût. Les sources non applicables ne sont pas présentées comme des pannes : les vrais échecs de lecture, limites d’historique et ambiguïtés restent visibles.

Les effets exécutables sont : envoyer un message au candidat via son compte personnel LinkedIn, Gmail/Outlook ou WhatsApp ; envoyer une demande ciblée à un membre identifié de l’équipe par e-mail ; enregistrer un brief, des questions ou un suivi dans les Notes de la fiche ; publier un commentaire avec mentions dans la mission. Chaque contenu est relu et modifiable. La confirmation nomme les envois et les enregistrements ; chaque effet conserve son propre résultat durable. Les tâches automatiques, changements d’étape et créations d’événements calendrier restent hors de ce parcours.

Les propositions et textes modifiés persistent dans `candidate_action_plans` et `candidate_action_effects`. Un changement de source ou de destinataire impose une nouvelle préparation. Une clé métier indépendante du recruteur réserve chaque effet : deux validations ne dupliquent pas le même envoi ou document. Une reprise exécute seulement les effets restants. Un résultat d’envoi inconnu reste bloqué et demande de vérifier la boîte ou la conversation ; il n’est jamais renvoyé automatiquement.

Les e-mails et messages WhatsApp identifiés sont conservés dans `candidate_action_messages`, indépendamment de l’état d’une séquence. Les réponses à une demande d’équipe sont rattachées par le fil ou l’identifiant de réponse, jamais par le seul nom du collègue. Le fil candidat et la coordination d’équipe restent distincts. Les brouillons et messages entrants d’une boîte personnelle restent privés ; les envois réalisés et les données de mission sont partagés selon les droits existants. L’export et l’effacement incluent ces nouvelles données.

Les canaux disponibles proviennent des comptes personnels reliés dans **Paramètres → Mon compte → Connexions**. Les associations e-mail et WhatsApp sont enregistrées par le serveur après un retour de connexion signé ; le navigateur ne peut ni revendiquer un identifiant de compte ni modifier son propriétaire ou son statut. WhatsApp dispose d’une connexion par QR code, d’une reconnexion et d’une déconnexion personnelles. Aucun compte de collègue ne sert à envoyer à sa place. Les coordonnées, le compte d’envoi, les droits, les exclusions et les limites du canal sont revérifiés lors de la validation et de l’exécution.

## Aperçu fictif

La démo `/inbox?demo=1` illustre trois ensembles d’effets :

- **Camille : préparer l’entretien confirmé.** Enregistrer un brief et des questions à partir du profil, des échanges et d’une publication LinkedIn fictive. Le rendez-vous existe déjà : aucune nouvelle réservation n’est créée.
- **Alex : coordonner sa réponse avec Guillaume.** Préparer une réponse Outlook à Alex, une demande Outlook à Guillaume et un commentaire d’équipe avec `@Guillaume`. Guillaume ayant déjà sollicité le manager, la demande lui propose de partager le retour. Les deux emails relus et le commentaire sont appliqués dans la simulation ; les précisions manquantes ne sont pas inventées. Une suite distincte reste en attente : compléter la réponse à Alex après réception des informations.
- **Maya : clarifier son expérience B2B.** Enregistrer des questions pour la scorecard et envoyer un email Gmail ciblé dans la simulation. Le critère reste non évalué : préparer une question ne lui attribue pas une note.

Le chat s’ouvre sur les échanges récents. Une seule « Prochaine action » suit l’historique, avec un titre et un motif court. Le parcours est **Préparer → aperçu éditable de tous les effets → validation explicite**, avec un bouton qui nomme le résultat, par exemple « Enregistrer et envoyer ». « Pourquoi ? » donne accès aux sources datées avec leurs logos ; les extraits complets se déplient à la demande. Le panneau latéral conserve le suivi et le profil du candidat.

L’aperçu présente d’abord les textes complets, les destinataires et les emplacements d’enregistrement, avec un récapitulatif des effets. « Modifier » ouvre uniquement le champ choisi ; le clavier ne s’ouvre pas à l’arrivée dans l’aperçu. « Annuler » conserve la proposition et les brouillons ; « Ignorer la suggestion » reste dans le détail des sources. Après validation, un statut confirme les résultats dans le chat et la fiche, et « Voir le résultat » permet de relire les contenus appliqués.

Chaque effet dispose d’une carte opaque avec une bordure contrastée. Un bandeau distingue le service, le destinataire, l’adresse et l’objet du texte à relire ; les documents montrent leur emplacement d’enregistrement. Les sources et la suite conditionnelle ont leurs propres cartes. L’en-tête et la validation restent fixes, seul le contenu central défile. L’aperçu utilise davantage la largeur sur ordinateur et garde des marges sur mobile, dans les deux thèmes.

Les propositions et sources complémentaires sont fictives, écrites pour cet aperçu, sans génération IA ni appel serveur. Les documents préparés, les commentaires et les résultats sont visibles dans l’onglet Actions de la fiche fictive ; les messages simulés rejoignent le même fil d’interactions. La messagerie et la fiche partagent les brouillons et l’état des effets par candidat. Fermer ou annuler l’aperçu ne produit aucun effet ; une validation n’exécute chaque effet qu’une fois. Les essais restent en mémoire et quitter la démo les efface.

Les envois au candidat et ceux à l’équipe portent un périmètre explicite. Les messages d’équipe simulés apparaissent dans « Coordination avec l’équipe », partagé entre le chat et l’onglet Interactions de la fiche. Ils restent hors des événements du candidat utilisés pour ses coordonnées et ses bulles. La suite conditionnelle est annoncée mais n’est pas exécutée : cette démo ne simule pas la réception du retour ni le déclenchement d’un nouveau plan.

## Actions liées et suites selon les réponses

Une proposition peut associer plusieurs effets immédiats : informer le candidat, demander une précision à un manager ou à un collègue identifié, puis consigner le suivi dans la fiche. L’aperçu distingue chaque destinataire, le contenu qui lui est destiné, le canal et les modifications dans l’app. Une demande déjà portée par un collègue passe par lui pour éviter une seconde sollicitation du manager.

Les actions qui dépendent d’une réponse restent en attente d’un événement précis. Par exemple, après réception des précisions du manager, proposer une réponse complète au candidat ; si le retour ouvre une question, préparer une nouvelle demande ciblée ; si un rendez-vous est confirmé, préparer son brief. La réception seule ne vaut pas décision : le moteur réel devra rapprocher le retour de la bonne demande et mission, relire les événements intervenus depuis, écarter les doublons et proposer un nouvel aperçu à valider. Les commentaires et échanges d’équipe conservent leur visibilité et ne deviennent pas automatiquement du contenu pour le candidat.

Le moteur réel utilise les sources et effets décrits ci-dessus. Les procédures Notion ont alimenté la conception ; leurs intégrations Notion et n8n ne constituent pas des canaux d’exécution de ce parcours.

## Actions à proposer

| Situation vérifiée | Proposition | Ce qui évite une mauvaise action |
| --- | --- | --- |
| Réponse avec une question ou une pièce demandée | Préparer la réponse ou la pièce, puis l’envoi après relecture | Lire les échanges suivants et le travail porté par un collègue avant de proposer |
| Entretien confirmé et préparation à faire | Préparer le brief et les questions | Vérifier la date actuelle, l’étape, les comptes rendus précédents et la préparation existante |
| Entretien passé sans retour candidat ou manager | Recueillir le retour manquant | Distinguer les deux retours ; une scorecard existante ne signifie pas que les deux sont recueillis |
| Scorecard avec critère non évalué ou avis contradictoires | Préparer et enregistrer les questions, puis demander les précisions utiles | Montrer les avis et leurs auteurs, sans moyenner les notes ni décider du sort du candidat |
| Retour manager explicite pour poursuivre | Organiser l’étape suivante | Ne pas proposer un nouvel entretien si un rendez-vous existe déjà |
| Manager sans réponse au-delà de sa cadence | Préparer sa relance et tenir le candidat informé | Lire la règle client et le dernier contact de toute l’équipe ; ne pas promettre une date de réponse client |
| CV, portfolio, références ou disponibilités attendus | Préparer la demande ciblée et son envoi | Vérifier qu’il n’est pas arrivé depuis et rappeler le besoin concret |
| Candidat annonçant une offre concurrente avec échéance | Faire un point avec le responsable du mandat | Citer l’échéance exprimée ; ne pas négocier ou inventer une offre |
| Candidat indisponible jusqu’à une date annoncée | Proposer un rappel à cette date | Suspendre les relances sur le même motif en attendant |

Les cadences viennent de la règle client et de la compétence concernée. Pour les relances de silence, la procédure actuelle prévoit deux relances maximum, à J+3 et J+7. Le contrôle des candidats actifs sans échange utilise sept jours ouvrés. Le retour manager sur présentation se suit sous 48 heures ouvrées, sauf cadence client. Ne pas fusionner ces règles en un seuil universel de cinq jours. Les dates relatives utilisent le fuseau de l’organisation et distinguent une date métier promise d’une échéance suggérée pour un travail différé.

## Sources métier

Les [Consignes Agent IA](https://app.notion.com/p/4ccaf5bf38da4fe1ae0a438a03feb05a), mises à jour le 6 octobre 2026, fixent les règles générales et l’attribution à la personne qui porte l’action. Le [socle des compétences](https://app.notion.com/p/fe7409589c4744ff88c4d5cb476d1540) renvoie aux procédures. Les pages de [calage d’entretiens](https://app.notion.com/p/678e869c774f4e379138768fca1b711b), [débrief à chaud](https://app.notion.com/p/db14c72a082143d3b5bef06927955a71) et [relances candidat](https://app.notion.com/p/1112d0e50807410f827f1d994058bb08) détaillent les déclencheurs et leurs limites.

La [spec post-appel de février](https://app.notion.com/p/825ffcdf3dc046a0841275673c43dc17) fournit des exemples utiles. Ses raccourcis de refus, d’archivage et d’attribution ne remplacent pas les procédures actuelles : le débrief d’octobre prévoit notamment un appel pour annoncer un refus, et le responsable doit venir de la source ou être confirmé. La [fermeture des tâches par événement](https://app.notion.com/p/e080434a03c1405bb72b8121d33e7da6) reste explicitement une spécification ; sa création automatique de tâches et ses fermetures ne font pas partie de cette première version.

## Contexte à assembler

Un lecteur partagé assemble un contexte candidat pour une mission précise, utilisé par la messagerie et les fiches mission et pipeline, ainsi que par la page Tâches pour le travail différé. Il comprend le profil existant, le brief, les critères, l’étape et les décisions explicites, les échanges et engagements, les rendez-vous, chaque évaluation et compte rendu accessible, les documents préparés, les effets déjà exécutés, les tâches ouvertes et les interventions de l’équipe.

Chaque élément garde son identifiant durable, son type, sa date métier, sa date de collecte, sa version, son auteur, sa mission, sa visibilité et un lien vers la source. Les identifiants candidat sont rapprochés avec les alias et l’URL LinkedIn normalisée ; un nom seul ou un téléphone partagé ne suffit pas à fusionner deux personnes. Une interaction sur une autre mission conserve son rattachement et ne devient pas un retour sur la mission ouverte.

Chaque source expose trois états : chargement, disponible, indisponible. Une lecture en erreur, une page non chargée ou un canal non connecté ne signifie jamais « aucun message », « aucun entretien » ou « aucun compte rendu ». Les suggestions qui reposent sur une absence exigent une lecture complète et assez récente. Si la source nécessaire est inconnue, suspendre la proposition et permettre une nouvelle lecture.

## Entretiens et scorecards

Conserver séparément, pour chaque entretien et étape du process, la grille et les commentaires de chaque évaluateur, les comptes rendus candidat et manager, les verbatims utiles et les points à confirmer. Distinguer brouillon, résultat IA et retour humain validé. Une question restée ouverte devient un sujet pour l’étape suivante ; un avis divergent devient une clarification. Une note globale n’avance jamais le pipeline et ne vaut jamais décision du manager.

La migration `20261006144618_scorecard_live_lot1_rattachement.sql` prévoit `project_id` et `process_step_id` pour les évaluations, ainsi que `evaluation_id` et `qualification_session_id` pour les séances de coaching. Les créations dans `ScorecardTab.tsx`, `LiveCoachingPanel.tsx` et `ScorecardFullPage.tsx` alimentent maintenant ces rattachements lorsqu’ils sont vérifiés. Les données historiques dont le rattachement reste ambigu apparaissent comme telles et ne prouvent pas le débrief d’un entretien précis.

Les appels disposent déjà de synthèses structurées dans `phone_call_insights`. Ils restent exclus du lecteur actuel : `phone_calls` n’a pas de rattachement candidat fiable et un numéro seul ne suffit pas. Les comptes rendus du coaching, les scorecards et les sessions de qualification correctement rattachés sont lus séparément. Le nom ou l’email d’un agent téléphonique ne devient pas automatiquement un identifiant de membre.

## Coordination entre recruteurs

Afficher le responsable de la candidature, les autres intervenants, leur dernier contact et le travail qu’ils portent. Si une relance vient d’être faite, la supprimer des suggestions encore à accepter ou expliquer l’attente. Si un collègue porte déjà l’action, préparer un commentaire avec mention ou compléter le travail existant avant de contacter à nouveau le candidat. Le créateur d’un document ou d’une tâche et son responsable sont deux personnes possibles, donc deux champs distincts.

Les données partagées de la mission suivent les droits de l’app. Les autres missions ne contribuent que si l’utilisateur peut les consulter. Les règles Notion permettant à l’équipe Konekt de travailler sur tous les clients ne modifient pas les autorisations actuelles de l’app. Une boîte personnelle d’un collègue ne s’ouvre pas par défaut : définir ce qui est partagé, par qui et à quel niveau avant d’élargir la lecture. Garder le compte personnel pour toute réponse.

`mission_conversations` fournit surtout les références et dates des conversations, pas leur texte intégral. Les messages de `useCandidateMessages` restent personnels, et les collaborateurs ont une lecture limitée de certains liens. Le fil d’activité conserve actuellement peu d’attribution pour les séquences et réservations. Le moteur d’équipe demande donc une provenance complète et une politique de partage explicite avant de pouvoir affirmer avoir lu toutes les interactions.

## Publications LinkedIn et API V2

La documentation officielle prévoit les [publications créées ou partagées par un utilisateur](https://developer.unipile.com/v2.0/reference/getpostslist), ainsi que les commentaires et réactions dans la [matrice des capacités](https://developer.unipile.com/v2.0/docs/list-provider-features). L’accès dépend du fournisseur, du compte connecté et de ce qu’il peut consulter ; ce n’est pas une garantie de collecte exhaustive.

La route V2 est `GET /v2/{account_id}/users/{user_id}/posts`. La [migration de l’API Users](https://developer.unipile.com/v2.0/docs/migration-users-api) change aussi les identifiants, champs du profil et curseurs. L’app récupère déjà certains posts par `get_user_posts` en V1, pour l’enrichissement et les séquences. Son usage V2 actuel concerne les webhooks. Il faut adapter et tester ces lecteurs avant d’annoncer une migration complète.

Conserver identifiant, URL, date et texte du post pour pouvoir le citer. Une publication professionnelle peut suggérer un sujet d’entretien ou contextualiser un message ; un like ou un post ne prouve ni disponibilité, ni recherche d’emploi, ni motivation. Aucun enrichissement massif à l’ouverture du chat : privilégier les données déjà recueillies et une actualisation explicite, avec quotas, cache et état de fraîcheur.

## Moteur et validation

Les règles vérifient les préconditions métier, dates, droits, doublons et décisions. L’IA extrait les engagements et questions dans les sources autorisées, puis rédige les propositions. Elle doit renvoyer les références qui justifient chaque action ; les textes externes sont des données, jamais des instructions à exécuter. Une source sans preuve suffisante donne une proposition à clarifier ou aucune proposition.

Afficher au plus trois propositions prioritaires par candidat : engagement avec échéance ou réponse attendue, entretien imminent ou retour manquant, puis préparation et suivi. La carte contient le verbe d’action, le motif concret, les effets proposés et la mission. Les sources avec leurs logos sont accessibles à la demande. Le responsable, le compte d’envoi et une éventuelle échéance sont explicités dans l’aperçu lorsqu’ils concernent l’effet. Le recruteur peut préparer, modifier, valider, reporter ou écarter. L’absence de proposition est un résultat valide.

Chaque proposition prépare un **plan d’effets typés** : enregistrer un brief, ajouter des questions ou des points de suivi à une évaluation, publier un commentaire d’équipe, préparer ou envoyer un message, modifier une information de fiche ou une étape de mission. Créer une tâche est un effet optionnel pour un travail différé. Chaque effet indique sa cible, le contenu proposé, les références de provenance et les préconditions ; un changement existant montre la valeur actuelle et la valeur proposée. L’aperçu permet de modifier le contenu et de voir tous les effets avant une validation au libellé précis. Annuler la préparation ne lance aucune écriture ni aucun envoi.

Au moment de la validation, le serveur relit les sources, les effets et les tâches déjà réalisés. Il vérifie l’organisation, l’accès à la mission, l’identité et les droits des intervenants, le compte personnel d’envoi, la disponibilité du canal et le destinataire. Il contrôle aussi les versions et les conflits : une modification concurrente, une réponse arrivée depuis ou un changement d’étape peut rendre une partie du plan inutile. Le plan concerné doit alors être actualisé et relu avant l’exécution, sans écraser le travail d’un collègue.

La proposition, son contenu relu et l’exécution de chaque effet disposent d’identifiants durables. Une clé métier commune aux recruteurs associe organisation, candidat, mission, type d’effet, cible et version validée ; l’enregistrement interne empêche deux validations simultanées de lancer le même effet. Chaque résultat conserve son état, sa date, son auteur et la référence du document, commentaire ou message produit. Une source nouvelle peut faire évoluer la proposition ; un refus ne réapparaît pas sur la même version inchangée.

Un ensemble mêlant écritures internes et envoi externe n’est pas une transaction atomique. Le moteur expose les effets réussis, échoués ou dont le résultat est encore inconnu et permet de reprendre seulement ce qui reste à faire. Il utilise l’idempotence du fournisseur lorsqu’elle existe ; après un délai d’envoi sans réponse, il vérifie le reçu ou l’historique avant de réessayer. Aucun envoi réussi ni document déjà enregistré n’est rejoué lors de la reprise, et aucune réussite globale n’est annoncée si un effet a échoué ou reste inconnu.

Les caches comprennent utilisateur, organisation, candidat, mission et périmètre de partage. Un changement d’organisation efface les propositions locales et une réponse tardive ne remplit pas le nouveau contexte. Tout message garde un aperçu éditable et une validation qui nomme explicitement l’envoi ; la validation d’un enregistrement seul n’autorise ni envoi, ni invitation, ni changement d’étape. Les modifications de mission passent par les gestes métier existants et leurs contrôles, jamais par une écriture directe de statut.

## Ordre de branchement

1. Fiabiliser les rattachements des entretiens, évaluations et rapports ; ajouter la provenance des actions d’équipe et leurs permissions.
2. Prévoir un état durable des propositions, des plans relus et des résultats par effet, avec déduplication interne, contrôles de version et reprise partielle. Pour les tâches optionnelles, compléter `candidate_reminders` avec la mission interne, le responsable distinct du créateur et les références de provenance : `job_id` ne remplace pas `project_id`, et un précontrôle de doublon ne protège pas deux créations simultanées.
3. Partager le lecteur de contexte et le moteur entre les vues. Corriger les faux positifs actuellement portés par `useAutoTaskSuggestions` : vérifier réellement les rapports, écarter les rendez-vous annulés et lire le dernier échange avant une relance. Ces vérifications doivent servir à préparer l’effet utile, sans créer systématiquement une tâche.
4. Brancher d’abord les aperçus éditables et les effets de préparation, débrief, réponse et demande ciblée sur les sources et gestes déjà fiables. Ajouter ensuite coordination multicanal et signaux LinkedIn, avec tests d’adaptateur V2 et quotas. Programmer un entretien dans l’app ne prouve pas qu’une invitation externe a été envoyée : chaque effet d’invitation ou de calendrier doit avoir son propre résultat vérifié.

## Critères de validation du moteur réel

- Une demande de débrief n’apparaît pas si le retour demandé est déjà enregistré ; un rendez-vous annulé ne génère pas de préparation.
- Une nouvelle réponse ou l’intervention d’un collègue invalide la relance devenue inutile, sans prétendre que toutes les tâches de ce candidat sont terminées.
- Une scorecard avec critère inconnu génère une question, sans inventer une note ni une décision.
- Préparer produit un aperçu modifiable de tous les effets ; annuler le laisse sans effet et les brouillons restent cohérents entre chat et fiche.
- Deux recruteurs validant le même effet retrouvent une seule exécution et le résultat correspondant ; une double validation ne duplique ni document ni message.
- Une modification concurrente de la cible ou une nouvelle interaction fait relire le plan concerné avant toute écriture.
- Un envoi en échec après un enregistrement réussi montre les deux résultats séparément ; reprendre ne recrée pas le document et ne rejoue pas les autres effets réussis. Un résultat d’envoi inconnu est vérifié avant tout nouvel essai.
- Un candidat engagé sur deux missions garde des propositions distinctes et des sources correctement rattachées.
- Un utilisateur sans droit sur une source ne voit ni son contenu, ni un résumé qui le révèle.
- Une panne ou une collecte partielle n’est pas traitée comme une absence ; un changement d’organisation ou de compte n’expose pas l’ancien contexte.
- Reporter ou écarter reste durable, et aucun message, invitation ou changement de statut n’est exécuté sans validation explicite de cet effet. Une tâche n’est créée que pour du travail réellement différé.
