# Lot 5f-2b : panneau Prise de contact et ContactFlow, questions avant d'écrire

Date : 12/10/2026. Auteur : Claude, à relire par Laurent. Ce document ne décrit pas du code livré : il fixe ce qui reste du lot 5f-2 après la règle Retenu (5f-2a) et pose les décisions à prendre avant de construire.

## Où en est le lot 5f

Sur la branche `claude/repository-audit-pcgg0y` (pas sur `main`, voir plus bas) :

- 5f-1, un seul chemin d'inscription (`enrollCandidates`), recetté en local ;
- 5f-2a, la règle Retenu (`retainCandidates`), avec un e2e qui échoue sans elle ;
- 5f-3, les invitations dans la messagerie, avec un e2e.

Reste du plan 5f-2 : l'onglet « Contactés », l'onglet « Séquences » réordonné, la pastille de « Prise de contact », ContactFlow et ses points d'entrée, « Retenir sans contacter ».

Le texte du plan (`lot5-plan.md`, 5f-2) cite une « spec-cible » (sections 2.6, 3.1 et 4) pour les textes des états vides et des erreurs. Ce fichier n'existe pas dans le dépôt (ni dans l'historique git, ni sur le disque). Sans lui, les textes et plusieurs règles ci-dessous sont des propositions de ma part.

## Pourquoi je m'arrête avant de construire

L'interrupteur `konekt.sequences-v2` est allumé par défaut depuis 5h : « sous drapeau » veut dire visible par tous au merge, avec seulement le secours `?sequences-v2=0`. ContactFlow remplacerait le menu « Séquence » du Pipeline, du Sourcing et de la fiche d'un Retenu pour tous les recruteurs. Les points ci-dessous changent ce que ces gens voient et envoient. Une mauvaise hypothèse se paie en envois ou en incompréhension, pas seulement en retouche de code.

## Découpage proposé

1. 5f-2b, « Contactés » et la pastille : lecture seule, sans risque d'envoi. Une ligne par candidat de la mission, en quatre groupes, avec les gestes de 5b qui existent déjà.
2. 5f-2c, ContactFlow depuis le Pipeline : sélection gardée au-dessus de l'écran, séquence choisie d'avance, groupes prêts, à compléter et exclus, aperçu, case des destinataires, « Inscrire N candidats ».
3. 5f-2d, les autres entrées : Sourcing de mission, fiche d'un Retenu, « Contacter les N » de Maintenant, page séquence, hors mission et messagerie.

Chaque étape s'arrête sur une recette locale et sur votre feu vert avant `main`.

## Décisions à prendre, avec ma proposition

1. Source et groupes de « Contactés ».
   Proposition : une ligne par candidat, la dernière inscription de la mission (id de la mission sous ses trois formes), plus les candidats à l'étape Contacté sans inscription (message écrit à la main). Groupes : « A répondu » (inscription répondue ou étape Répondu) ; « Bloqués » (en pause pour compte déconnecté, abonnement requis, plafond atteint, échec d'envoi, candidat injoignable, ou message rédigé par l'IA à relire) ; « En attente » (active, ou en pause manuelle, séquence en pause, auto-pause) ; « Sans suite » (terminée sans réponse, arrêtée, annulée, rebond), replié. Un collaborateur ne voit que ses inscriptions.

2. La pastille « 2 réponses » ou « 1 bloqué » du bouton « Prise de contact ».
   Proposition : les réponses viennent de `get_mission_attention` (réponses non traitées sur votre compte LinkedIn), les bloqués du groupe « Bloqués » ci-dessus. Jamais de zéro. Ce chiffre peut différer de « À traiter » dans la barre latérale, qui compte les notifications.

3. Que veut dire « à compléter » ?
   Proposition : un candidat sans lien de profil LinkedIn (laissé de côté aujourd'hui avec « N candidats sans profil LinkedIn ») et, pour une étape rédigée par l'IA, un candidat dont le message n'est pas encore généré ni relu.

4. Les raisons d'exclusion et leur dérogation.
   Proposition, dans cet ordre : déjà dans la séquence (aucune dérogation) ; profil effacé (aucune) ; contacté par un membre depuis moins de 90 jours (dérogation « Inscrire quand même », propriétaire et administrateur, comme aujourd'hui, avec le nom de qui l'a contacté) ; hors réseau ou déjà en relation avec une invitation seule (dérogation « Inclure quand même »). « InMail inutile » reste un avertissement, comme dans l'aperçu actuel.

5. Quelle est « la séquence de la mission » choisie d'avance ?
   Proposition : parmi les séquences actives et non vides qui appartiennent à la mission, la plus récente. Aucune : rien n'est présélectionné et la porte « Rédiger une séquence pour cette mission » s'affiche. Les séquences partagées (`project_id` vide) restent sous « Autres séquences de l'organisation ».

6. La jauge du plafond.
   Proposition : pour une première étape qui est une invitation, les invitations restantes de la semaine ; pour un message, les actions visibles restantes du jour. Texte du type « 38 invitations possibles cette semaine », avertissement quand N dépasse le reste, aucun « 0 / N ». Les seuils d'alerte reprennent ceux de la page des connexions (80 et 95 pour cent).

7. Où vit la sélection, et que montre un rechargement ?
   Proposition : la sélection du Pipeline monte dans l'état de la page mission, au-dessus de l'écran et du panneau. Elle se perd au rechargement ; `&contacter=1` sans sélection ouvre l'onglet « Contactés ». Une sélection de 400 retenus au plus, aperçu par pages de 10.

8. Texte du toast d'après inscription.
   Proposition : « N candidats inscrits dans la séquence X » avec « Ouvrir la séquence », sans « Annuler » (un premier envoi peut déjà être parti), puis les avertissements actuels (profil effacé, même personne, déjà passés, déjà dans la séquence).

9. Faut-il garder l'ancien menu « Séquence » dans le Pipeline et le Sourcing derrière le secours seulement, comme le plan le dit ?
   Oui dans ma proposition : `?sequences-v2=0` garde l'ancien parcours jusqu'au lot 5j.

## Ce que je ne peux pas décider seul

La spec-cible manquante : si elle existe ailleurs (maquette de 19 planches, espace de travail d'origine), il me faut ses sections 2.6, 3.1 et 4. Sinon, les réponses ci-dessus font office de spec.

## État de `main`

Le 12/10/2026, la poussée de 5f-1 sur `main` a été refusée par le contrôle des actions du poste de travail (« Production Deploy »), alors que vous aviez dit oui. Rien de 5f n'est sur `main`. Pour pousser, confirmez par une phrase explicite (« pousse 5f-1, 5f-2a et 5f-3 sur main »), ou ajoutez la règle d'autorisation dans les réglages Bash de Claude Code. La règle Retenu (5f-2a) change le Pipeline de tous au merge : voulu par le plan, à savoir avant de pousser.
