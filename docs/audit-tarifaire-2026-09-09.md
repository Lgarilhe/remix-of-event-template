# Audit tarifaire : 9 septembre 2026

Grille auditée avant l'ouverture de la bêta et avant le premier encaissement.
Six angles, 55 constats bruts, 21 retenus après trois réfutateurs par constat.
Les chiffres de coût viennent de la production, pas d'une estimation.

## 1. Réponse courte

L'intelligence artificielle n'est pas le sujet. Elle coûte au maximum 8 % du
prix d'un abonnement, et les packs de crédits sortent à 87 % de marge. La
rentabilité de Konekt se joue entièrement sur trois lignes que la grille ne
regarde pas : l'enrichissement de contact, la connexion LinkedIn facturée au
mois, et le coaching en direct dont la facturation est cassée.

Deux défauts sont des bugs vérifiés, pas des choix de tarif. Ils sont décrits en
section 4 et méritent d'être corrigés avant l'ouverture.

## 2. Ce que coûte un crédit, mesuré

Sur 876 transactions dont le coût est correctement enregistré, portant 3 349
crédits et 3,20 millions de jetons :

| Mesure | Valeur |
|---|---|
| Coût moyen d'un crédit | 0,003364 $ |
| Jetons par crédit | 955 |
| Répartition entrée / sortie | 84 % / 16 % |

Le pire cas théorique, si toute la consommation basculait sur le modèle de
référence à pleine charge, est d'environ 0,005 $ par crédit. Les calculs qui
suivent retiennent la mesure et signalent le pire cas quand il change la
conclusion.

Marge sur les packs vendus à l'acte, au coût mesuré converti à 1,08 dollar par
euro :

| Pack | Prix | Prix du crédit | Marge |
|---|---|---|---|
| 400 crédits | 12 € | 0,0300 € | 89,6 % |
| 1 500 crédits | 39 € | 0,0260 € | 88,0 % |
| 5 000 crédits | 119 € | 0,0238 € | 86,9 % |

Coût des crédits inclus dans chaque plan, si l'organisation les consomme tous :

| Plan | Prix | Crédits inclus | Coût IA | Part du prix |
|---|---|---|---|---|
| Solo | 59 € | 500 | 1,56 € | 2,6 % |
| Cabinet | 139 € | 2 000 | 6,23 € | 4,5 % |
| Entreprise | 189 € | 5 000 | 15,58 € | 8,2 % |

Les multiplicateurs par modèle sont justes à 5 et 8 % près, en faveur de Konekt.
Rien à corriger de ce côté.

## 3. Le vrai point d'exposition

Le forfait de contacts enrichis est la seule ligne dont le coût unitaire est
inconnu et potentiellement élevé. Voici le prix par contact à partir duquel
chaque plan décroche, pour une organisation d'un siège qui consomme tout son
forfait, en ignorant les recherches base :

| Plan | Contacts inclus | Prix par contact pour rester à 70 % de marge | Seuil de perte |
|---|---|---|---|
| Solo | 50 | 0,32 € | 1,15 € |
| Cabinet | 200 | 0,18 € | 0,66 € |
| Entreprise | 500 | 0,08 € | 0,35 € |

Entreprise est quatre fois plus contraint que Solo. La raison est arithmétique :
de Cabinet à Entreprise, le prix monte de 36 % pendant que les contacts inclus
montent de 150 %. Le plan le plus cher est le plus fragile.

Les repères connus du dépôt situent l'enrichissement entre 0,016 $ chez un
fournisseur français bon marché et 0,28 $ pour un couple email et téléphone chez
un fournisseur haut de gamme. À 0,05 € par contact, les trois plans passent
au-dessus de 72 % de marge. À 0,26 €, Entreprise tombe à 17 %.

## 4. Les deux bugs

### Le coaching en direct facture cinq à douze fois ce qu'il annonce

Le catalogue nomme l'action « Coaching live (par minute) » avec un plancher de
5 crédits. Le débit a lieu à chaque appel, pas à chaque minute. Le navigateur
appelle la fonction dès que 80 caractères de parole se sont accumulés, à chaque
fin de phrase détectée, et à défaut toutes les 12 secondes
(`LiveCoachingPanel.tsx:120` et `:365-410`).

Au strict minimum, cinq appels par minute, soit 25 crédits par minute au lieu de
5. Un entretien de 45 minutes coûte donc au moins 1 125 crédits, et bien
davantage si le candidat parle. Le forfait Cabinet en compte 2 000 par mois : deux
entretiens coachés épuisent le mois d'un cabinet.

Ce défaut joue contre le client. Il videra son solde en une séance et en tiendra
Konekt pour responsable.

Correctif : accumuler le temps écoulé côté serveur par session et ne débiter
qu'au franchissement d'une minute entière, les appels intermédiaires ne débitant
rien.

### La Base Konekt reste plafonnée à 10 recherches pour un client qui paie

`get_base_konekt_state` et `reserve_base_konekt_included` ramènent le forfait à
10 recherches dès que le statut vaut `trialing`
(`20260907053655_base_konekt_activation.sql:207` et `:342`), sans vérifier qu'un
abonnement est en place. Or un abonnement souscrit pendant l'essai garde le
statut `trialing` chez le prestataire de paiement jusqu'à la date de fin.

Un cabinet qui paie le 12 septembre garde donc 10 recherches au lieu des 100
qu'il achète, jusqu'au 21. C'est exactement le défaut corrigé ce matin sur les
sièges, au même endroit logique.

Correctif : ajouter `AND stripe_subscription_id IS NULL` aux deux tests.

## 5. Les incohérences de grille

**Le prix est par siège, les forfaits sont par organisation.** Un cabinet de dix
personnes paie 1 390 € par mois et reçoit les mêmes 2 000 crédits et 200 contacts
qu'un cabinet d'une personne. Soit 200 crédits et 20 contacts par recruteur.
C'est excellent pour la marge et intenable commercialement : le client le verra
au premier mois. Deux issues, multiplier les forfaits par le nombre de sièges
facturés, ou assumer un forfait d'organisation et le dire clairement sur la page
tarifs.

**Le prix marginal du crédit s'inverse entre les deux marches.** De Solo à
Cabinet, 80 € de plus achètent 1 500 crédits, soit 0,053 € le crédit. De Cabinet
à Entreprise, 50 € de plus en achètent 3 000, soit 0,017 €. La seconde marche
vend le crédit trois fois moins cher que la première, et moins cher que le plus
gros pack. Un client Cabinet à court de crédits a intérêt à passer Entreprise
plutôt qu'à acheter des packs, ce qui lui offre au passage 300 contacts de plus.
C'est le chemin qui coûte le plus cher à Konekt.

**Un téléphone consomme la même unité de forfait qu'un email.** Le barème à
l'acte les sépare, 1 crédit contre 10. Le forfait les confond
(`enrich-candidate-contact/index.ts`, en-tête : « Un email = 1, un téléphone =
1 »). Un client averti dépense ses 200 unités en numéros de mobile, l'article que
Konekt valorise dix fois plus. Décompter le téléphone 10 unités aligne le forfait
sur le barème.

**Le suivi de marge est aveugle là où le risque est.** Les cinq actions qui
appellent un fournisseur externe enregistrent un coût de zéro, parce que le coût
est calculé à partir des jetons et qu'elles n'en consomment aucun. Vérifié en
production : 44 crédits de fiches complètes, 29 d'aperçus, 10 de téléphone, tous
à 0,0000 $. Plus une organisation déplace sa consommation vers l'enrichissement
et la base de données, plus son coût réel monte et plus le coût enregistré tend
vers zéro. Aucun tableau de bord de marge n'est exploitable tant que le prix
contractuel des deux fournisseurs n'est pas posé en constante et transmis au
règlement.

**L'essai cède un mois de forfait pour quatorze jours.** L'essai Cabinet ouvre
2 000 crédits, 200 contacts et dix sièges. Le compteur de contacts se réinitialise
au mois civil : un essai à cheval sur deux mois ouvre 400 unités. Et rien ne
coupe les comptes LinkedIn connectés quand l'organisation retombe sur le plan
gratuit, alors que c'est la seule ligne à coût fixe mensuel.

## 6. Ce qu'il me manque pour conclure

Quatre prix que je ne peux pas déduire du dépôt et qui décident de tout :

1. Le prix par contact enrichi facturé par le fournisseur, séparément pour un
   email et pour un mobile.
2. Le prix d'un crédit chez le fournisseur de base de données, sachant qu'une
   page d'aperçu en consomme deux et que la première page d'une recherche neuve
   en consomme quatre.
3. Le prix mensuel par compte LinkedIn connecté chez le service de connexion.
4. Les factures mensuelles d'hébergement, base de données et frontal.

Avec ces quatre nombres, la marge de chaque plan devient un calcul, pas une
fourchette.

## 7. Ordre de marche proposé

1. Corriger la facturation du coaching en direct. C'est le seul défaut qui puisse
   faire partir un client en colère dès la première semaine.
2. Corriger le plafond de recherches pour un essai payé, en même temps.
3. Poser les prix fournisseurs en constante et les transmettre au règlement, pour
   que la marge devienne mesurable.
4. Décompter le téléphone 10 unités du forfait de contacts.
5. Décider entre forfait par siège et forfait par organisation, et l'écrire sur
   la page tarifs.
6. Revoir la marche Cabinet vers Entreprise, dont le prix marginal du crédit est
   plus bas que celui des packs.

Les points 1 et 2 sont des correctifs de quelques lignes. Le reste demande une
décision commerciale, pas du code.
