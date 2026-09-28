# Arbitrages de la refonte mission (27/09/2026)

Décisions du fondateur sur les 23 questions ouvertes de la conception (`conception.md`, section 15) et de son complément (`complement-equipe-marketplace-integrations.md`, section 7). Les décisions 9 et 10 ont été remplacées par le complément. Relevé fait depuis la page d’arbitrage (https://claude.ai/artifact/SHqwPZJeDbAd4qGiRAPt6H).

Écarts par rapport aux choix par défaut : **16** (retrait immédiat de l’écriture vers Notion), **11** (kanban par défaut dans le Pipeline), **22** (honoraires, à voir ensemble).

## Pour démarrer

### 16. Votre base Notion reçoit-elle encore des candidats ?

Quand : Avant les réparations de sécurité.

Aujourd'hui, les séquences et l'analyse des réponses écrivent dans la base Notion reliée par la clé commune de Konekt, quelle que soit l'organisation. Les réparations retirent cet usage.

Choix : **Autre choix**. Retrait immédiat : l'écriture vers Notion s'arrête.

Défaut écarté : Votre clé Notion passe dans les réglages de votre organisation avant le retrait. Plus tard, le Sourcing pourra importer votre base comme source de candidats.

### 17. Geler la Marketplace en attendant un pilote ?

Quand : Avec les réparations de sécurité.

La publication d'un poste et l'invitation de partenaires n'ont jamais servi : 0 mission publiée, 0 candidature. La liste des missions ouvertes enverrait le poste entier à tous les membres d'un cabinet partenaire dès sa validation ; aucun n'est validé aujourd'hui.

Choix : **Par défaut**. Publication et invitation de partenaires masquées jusqu'à la présentation de candidats (lot P2), construite avec le premier pilote. Aucun partenaire validé avant les réparations. La demande de partenariat en attente depuis le 08/09 reste en attente, et son auteur est prévenu. Les 3 missions en brouillon restent en brouillon.

### 15. Quand construire l'équipe et la Marketplace ?

Quand : Fixe l'ordre des travaux.

16 organisations sur 17 n'ont qu'un membre, et aucune mission n'a été confiée à un cabinet.

Choix : **Par défaut**. Tout de suite : réparations de sécurité, nettoyage, et liens des tâches et des mentions vers leur mission. Les fonctions d'équipe se construisent dès qu'une équipe est active : deux personnes qui agissent sur une même mission la même semaine, ou la première invitation d'un accès limité. La Marketplace attend un pilote nommé : une entreprise qui confie un poste et un partenaire qui accepte de le travailler dans Konekt.

### 20. Ce que l'équipe voit de la conversation d'un collègue

Quand : Avant la remise en ordre des chiffres (lot 0b).

Dès le lot 0b, chacun écrit depuis son propre compte, jamais depuis celui d'un collègue. La fiche d'un candidat contacté par un collègue montre alors sa conversation sous une forme à choisir ici.

Choix : **Par défaut**. Qui, quand, et l'extrait des messages rattachés à la mission. La conversation entière reste lisible par son titulaire seul.

### 24. WhatsApp

Quand : Avec le nettoyage, tout de suite.

Aucun message n'est jamais parti par l'étape WhatsApp de l'éditeur de séquences. Relier un compte WhatsApp personnel ferait passer toutes ses conversations, familiales comprises, par le prestataire de connexion et par Konekt.

Choix : **Par défaut**. Aucun compte WhatsApp personnel relié. Le bouton « WhatsApp » ouvre l'application, puis on note l'échange dans Konekt. L'étape WhatsApp quitte l'éditeur de séquences. Un envoi depuis Konekt ne viendrait qu'avec l'offre professionnelle officielle de WhatsApp, dans un lot à part.

### 3. Les 719 candidats déjà écartés

Quand : Avant la remise en ordre des chiffres (lot 0a).

719 candidats sont marqués « écarté » sans qu'on sache qui l'a décidé : une personne, ou la notation automatique.

Choix : **Par défaut**. Marqués « écartés par l'IA, à confirmer », réversibles, et exclus du taux « triés par vous ».

### 7. Arrêter le lot 3 de la barre latérale ?

Quand : Avant la nouvelle page mission.

Ce lot ajoutait à la mission un menu sur son nom, une rangée par phase, l'historique et des verrous. La nouvelle page mission supprime les phases et les verrous.

Choix : **Par défaut**. Oui : le lot 1 de la nouvelle page mission le remplace.

### 12. Allumer la mesure d'usage

Quand : Avant la nouvelle page mission.

Le suivi des clics existe dans le code mais reste éteint : il lui faut un site déclaré chez Plausible et la variable VITE_PLAUSIBLE_DOMAIN dans Vercel. Sans lui, on ne saura pas si la nouvelle page est utilisée.

Choix : **Par défaut**. La poser avant le lot 1. C'est une action de votre côté : je n'ai pas accès à Vercel.

## Avant la nouvelle page mission

### 1. La carte « Maintenant »

Quand : Avant tout développement de la page mission.

Le 20/05, vous aviez fait retirer le bloc « Étape suivante » : « l'user n'a pas besoin d'être guidé vers la prochaine étape de façon visuelle intrusive, il sait où il va ». La carte « Maintenant » en est une nouvelle version : elle pousse vers ce qu'une personne attend de vous, et se réduit à une ligne quand rien ne presse. Sur la maquette, vous avez trouvé l'expérience « vraiment top » : si cela vaut validation de la carte, gardez le défaut.

Choix : **Par défaut**. La garder, telle que sur la maquette.

### 2. Formule gratuite : un message individuel est-il permis ?

Quand : Avant le lot 3 (carte « Maintenant »), puis le lot 5.

Konekt permet déjà d'envoyer des messages un par un en formule gratuite. Seules les séquences sont fermées. Les 17 organisations sont en formule gratuite, et la carte « Maintenant » propose « Contacter » dès le lot 3.

Choix : **Par défaut**. Oui, un par un. La séquence est présentée comme l'option payante.

### 5. Les libellés de la mission

Quand : Lots 1 et 2.

Les phases disparaissent et deviennent de simples titres de groupe. « Analyses » devient « Bilan », « Prise de contact » devient un panneau.

Choix : **Par défaut**. Garder les titres de groupe « Sourcing et contact » et « Suivi », retirables ensuite.

### 6. Un clic sur une mission dans la barre latérale ouvre…

Quand : Lot 1.

Choix : **Par défaut**. La dernière vue visitée, comme aujourd'hui.

### 11. Liste ou kanban par défaut dans le Pipeline

Quand : Lot 2.

Choix : **Autre choix**. Le kanban.

Défaut écarté : La liste, et chaque personne garde son choix.

### 8. Les organisations sans type

Quand : Lot 3.

9 organisations sur 17 n'ont pas de type (entreprise, cabinet ou indépendant). L'app les met en lecture seule sans le leur dire.

Choix : **Par défaut**. Un message bloquant en tête de la carte « Maintenant », adressé au propriétaire, lui demande de choisir.

## Pour la suite de la mission

### 4. D'où vient la date des entretiens ?

Quand : Avant le lot 6, entretiens.

Un entretien planifié hors de Konekt n'existe pas pour Konekt tant que sa date n'est pas saisie. Le complément a revu cette décision : l'invitation par votre agenda s'ajoute quand un agenda est relié.

Choix : **Par défaut**. Sans agenda relié, un champ « Date de l'entretien » au passage en entretien. Avec un agenda relié, plus tard, l'invitation part de votre agenda.

### 19. L'avis d'un manager, et le prix d'un accès limité

Quand : Avant le lot 6, puis rôles d'équipe.

Aujourd'hui, un siège vaut 189 € par mois en formule Entreprise, et tous les rôles en prennent un.

Choix : **Par défaut**. L'avis se demande par un lien, sans compte ni siège. Un accès limité qui ne cherche ni ne contacte (aucun compte LinkedIn relié, aucune séquence) ne prend pas de siège.

### 21. L'e-mail dans la mission

Quand : Avant l'e-mail relié.

Aucun e-mail de prospection ne part aujourd'hui de Konekt. Avant ce lot, il faut connaître le coût de chaque boîte e-mail reliée.

Choix : **Par défaut**. Envoi depuis la boîte du membre, jamais depuis Konekt. Konekt garde les échanges avec les adresses connues de candidats. Avec l'interlocuteur du client, il ne garde que les fils ouverts depuis Konekt. Reprise de 90 jours d'historique, pour les candidats seulement. Pas de suivi d'ouverture par défaut. Lien de désinscription allumé. L'envoi individuel en gratuit suit la décision 2, si le coût par boîte le permet.

### 22. Suivre les honoraires sur toutes les missions pour un client ?

Quand : Après le lot 7.

Choix : **À voir ensemble**. À discuter avec le fondateur.

Défaut écarté : Oui. Les conditions avec le client se saisissent dans Cadrage. Au passage en « Embauché », Konekt demande la rémunération, la date de prise de poste, les honoraires, la fin de garantie et « placé par », avec la part de chacun. Ces données sont lisibles par les propriétaires, les administrateurs et les personnes nommées. Konekt suit, il n'encaisse rien.

### 13. L'assistant qui prépare le travail avant votre arrivée

Quand : Après la mesure d'usage.

Si l'assistant préparait seul le travail de la mission, il dépenserait des crédits sans qu'on sache s'ils servent. Les 17 organisations sont en formule gratuite, et l'assistant n'a eu qu'une conversation en 30 jours. La conception prévoit pour l'instant une préparation à la demande, sur un clic.

Choix : **Par défaut**. Après la mesure d'usage, avec un budget de crédits par mission et le respect des plafonds LinkedIn.

## Équipe, partenaires et outils du client

### 14. Où travaille un partenaire sur un poste confié ?

Quand : Au premier pilote Marketplace.

Choix : **Par défaut**. Chez lui, dans une mission liée, avec un geste « Présenter ». L'entreprise ne voit que les candidats présentés, et les partenaires ne se voient pas entre eux. L'espace créé pour un partenaire ne consomme pas son essai, et ses missions liées ne comptent pas dans son plafond.

### 18. Qui reçoit une réponse après une passation ?

Quand : Dès qu'une équipe est active.

Choix : **Par défaut**. Le responsable du candidat est désigné au premier contact. Après « Passer le suivi à… », les réponses vont au nouveau responsable, qui écrit depuis son compte avec les extraits de l'ancienne conversation. La case « Prévenir le candidat » est cochée : le message part de l'ancien compte en un clic.

### 23. Le logiciel de recrutement (ATS) du client

Quand : Au premier pilote ATS.

L'étude du 25/09 conclut que c'est faisable sur la plupart des points, avec des écarts par outil : Welcome to the Jungle sous condition d'accès, Bullhorn après une étude courte, couverture du connecteur à confirmer outil par outil. Elle ajoute douze décisions de détail (liste annoncée, e-mail et CV à l'envoi, offre commerciale…), que je vous présenterai avec le pilote.

Choix : **Par défaut**. Un connecteur unifié (Kombo), jamais nommé à l'écran. Konekt lit d'abord l'ATS sans y écrire. Pilote avec Teamtailor ou Flatchr, puis la liste des douze. Welcome to the Jungle après accord écrit de l'éditeur. Konekt ne propose un outil qu'après deux vérifications : le connecteur confirme le couvrir, et un test réussit. Une fois le candidat envoyé, l'ATS fait foi. L'étape où il arrive dans l'ATS se choisit au moment de l'envoi.

### 25. L'antériorité d'une présentation

Quand : Au premier pilote Marketplace.

Choix : **Par défaut**. La première présentation datée d'un candidat, pour ce poste, donne l'antériorité pendant 6 mois. « Déjà connu de l'entreprise » veut dire : contacté par elle depuis moins de 12 mois, en cours sur ce poste au stade « Contacté » ou au-delà, ou actif dans son ATS depuis moins de 12 mois. Konekt horodate et montre, il n'arbitre pas. Une présentation non suivie d'embauche est anonymisée 12 mois après la fin de l'antériorité.

## Remplacées

- 9. Le portail client pour une entreprise : remplacée par le champ « Qui recrute » de chaque mission.
- 10. Le mode chasse gardé dans Cadrage : remplacée par la décision 17.

## Précisions du fondateur, 28/09/2026

- **Notion (décision 16, élargie).** « Notion est un reliquat du début de la construction de l'app : il ne doit plus être de la partie, sauf pour l'intégration MCP, qui peut rester disponible comme intégration. » Tout ce qui touche Notion est retiré, sauf la connexion Notion de l'assistant (MCP).
- **Honoraires (décision 22).** « Konekt prend 20 % du deal. Le client met un pourcentage, et côté recruteur est visible son pourcentage à lui, déduit de notre commission. S'inspirer de Paraform. » Proposition détaillée et questions ouvertes : `honoraires-marketplace-2026-09-28.md`.
