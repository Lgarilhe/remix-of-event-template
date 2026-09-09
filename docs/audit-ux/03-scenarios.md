# 03 — Scénarios de validation

Ces scénarios se passent après correction, dans un environnement de test, avec des données fictives et des envois simulés. Aucun candidat réel n'est contacté.

## Parcours complet de référence

Définir une mission, chercher, comprendre les résultats, sélectionner, préparer le contact, confirmer, traiter les réponses, suivre la progression.

Ce parcours se joue en entier, d'une traite, sans explication donnée à la personne qui le joue. Les hésitations comptent autant que les erreurs.

## Scénarios de fiabilité (lot 1)

| # | Scénario | Résultat attendu | Constat couvert |
|---|---|---|---|
| 1 | Shortlister un profil neuf et un profil déjà noté | Les deux ressortent dans le filtre Shortlist après rechargement | UX01 |
| 2 | Shortlister pendant une coupure réseau | Aucun message de succès, la sélection est conservée, une reprise est proposée | UX01b |
| 3 | Traiter un lot mêlant résultats de recherche et profils du vivier | Même nombre et mêmes personnes entre la sélection, le traitement et le bilan | UX02 |
| 4 | Enregistrer un brief sur une mission devenue inaccessible | Aucun succès affiché, la saisie reste récupérable | UX03 |
| 5 | Taper une réponse et changer de page en moins d'une demi-seconde | Le texte est retrouvé intégralement au retour | UX04 |
| 6 | Effacer entièrement un brouillon, quitter, revenir | Aucun ancien texte ne réapparaît | UX04 |
| 7 | Fermer une mission ou une séquence incomplète, puis rouvrir | Le brouillon est proposé, l'activation reste impossible tant qu'il manque des éléments | UX06 |
| 8 | Choisir une séquence depuis la messagerie, puis depuis le sourcing | Même préparation, même aperçu, aucun engagement au simple choix | UX05 |
| 9 | Ouvrir le choix de séquence sur téléphone, conversation ouverte | La liste est visible au-dessus de la conversation, utilisable au toucher et au clavier | UX07 |

## Scénarios de clarté (lot 2)

| # | Scénario | Résultat attendu | Constat couvert |
|---|---|---|---|
| 10 | Couper le réseau puis ouvrir la liste des recherches | Un échec de chargement, jamais « aucune recherche » ni « supprimée » | UX08 |
| 11 | Entrer dans la messagerie et ressortir sans ouvrir de conversation | Le compteur de non-lus est conservé | UX09 |
| 12 | Chercher une personne déjà connue sans explication préalable | La personne est trouvée sans essayer trois menus | UX10 |
| 13 | Aller de l'outreach au pipeline, puis revenir à la phase précédente | L'onglet quitté est restauré | UX11 |
| 14 | Chercher la plus ancienne de 25 séquences actives | Elle est trouvable et son contexte est identifiable | UX12 |
| 15 | Passer LinkedIn pendant l'installation | L'état final est honnête, la prochaine action est nommée | UX14 |
| 16 | Essai gratuit, puis mot de passe oublié, puis retour à la connexion | Le mode affiché correspond à chaque fois au bouton cliqué | UX15 |
| 17 | Parcourir le calendrier et les tâches au lecteur d'écran | Chaque champ est nommé, cliquer le libellé donne le focus | UX16 |

## Scénarios de travail intensif (lot 3)

| # | Scénario | Résultat attendu | Constat couvert |
|---|---|---|---|
| 18 | Créer une séquence, changer d'onglet, déplacer un candidat, au clavier seul | Aucune commande indispensable n'est hors d'atteinte | UX17 |
| 19 | Inverser une plage horaire de séquence, mettre les poids A/B à 99 % | L'erreur apparaît avant l'activation, un clic amène au champ | UX18 |
| 20 | Rejouer les écrans principaux en 390x844, 768x1024, 1440x900, puis zoom 200 % | Le composeur, les confirmations et les actions principales restent atteignables | UX19 |

## Observation avec de vrais recruteurs

À faire après le lot 2. Donner une tâche réelle, ne rien expliquer, noter les hésitations et les retours en arrière. Ces séances servent à trancher les priorités de confort, pas à confirmer les défauts déjà reproduits.
