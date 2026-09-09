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

## 6. Les prix fournisseurs, relevés le 9 septembre

Trois fournisseurs distincts, souvent confondus : le service de connexion
LinkedIn, le fournisseur de base de données qui alimente la Base Konekt, et le
fournisseur d'enrichissement de contact. Ce dernier n'est pas celui de la base de
données. Le code le montre : `enrich-candidate-contact/index.ts:41` appelle
`app.bettercontact.rocks`, `coresignal-search/index.ts:33` appelle
`api.coresignal.com`.

Les tarifs ci-dessous sont les prix publics affichés, relevés par recherche. Les
sites des trois fournisseurs sont bloqués par le proxy réseau de cette session,
je n'ai donc pas pu ouvrir leurs pages moi-même. À recouper avec vos factures
réelles, qui peuvent porter un tarif négocié.

### Connexion LinkedIn

49 € par mois jusqu'à dix comptes connectés, puis 5 € par compte, dégressif
jusqu'à 3 € au volume. Facturation au pic de comptes connectés sur trente jours,
sans coût par requête.

Soit environ 4,90 € par siège au premier palier. Rapporté au prix des plans :
8,3 % sur Solo, 3,5 % sur Cabinet, 2,6 % sur Entreprise. Cette ligne n'est pas un
problème, contrairement à ce que je craignais.

### Enrichissement de contact

Un email vérifié coûte 1 crédit, un mobile vérifié 10 crédits. C'est exactement
le rapport que Konekt a recopié dans ses propres planchers, ce qui confirme la
source. Les crédits ne sont débités que si la donnée est trouvée.

Grille : 49 $ pour 1 000 crédits, 149 $ pour 3 000, 199 $ pour 5 000, 399 $ pour
10 000. Soit **0,040 à 0,050 $ le crédit** aux volumes réalistes.

Konekt vend son crédit 0,0238 à 0,030 €, soit 0,026 à 0,032 $. La comparaison est
directe et sans appel :

| Article | Coût fournisseur | Prix de vente Konekt | Résultat |
|---|---|---|---|
| Un email | 0,040 à 0,050 $ | 0,026 à 0,032 $ | vendu à 55-80 % du coût |
| Un mobile | 0,40 à 0,50 $ | 0,26 à 0,32 $ | vendu à 55-80 % du coût |

L'enrichissement est donc vendu à perte à l'acte, sur les deux lignes. Le
commentaire « floor = coût réel » du catalogue est juste en nombre de crédits et
faux en argent : un crédit du fournisseur d'enrichissement coûte treize à quinze
fois ce que coûte un crédit Konekt dépensé en jetons, et les deux sont vendus au
même prix.

Sur les forfaits inclus, l'effet dépend entièrement du mélange email / mobile,
que rien ne borne puisque le forfait compte un mobile comme un email :

| Plan | Forfait dépensé en emails | Forfait dépensé en mobiles | Revenu |
|---|---|---|---|
| Cabinet, 200 unités | 9 $ | 90 $ | 150 $ |
| Entreprise, 500 unités | 22,50 $ | 225 $ | 204 $ |

Entreprise perd de l'argent avant même de compter l'IA, l'hébergement et la
connexion LinkedIn, dès lors que le client dépense son forfait en numéros de
mobile. Ce qu'il fera, puisque c'est l'article le plus utile et qu'il ne coûte
pas plus cher dans le forfait.

Décompter le mobile 10 unités, comme le fait déjà le barème à l'acte, ramène le
coût du forfait à 9 $ pour Cabinet et 22,50 $ pour Entreprise quel que soit le
mélange. C'est le correctif le plus rentable de tout cet audit, et il tient en
une ligne de comptage.

### Base de données

Le code appelle le point multi-source (`employee_multi_source`,
`coresignal-search/index.ts:34`), le plus cher de la gamme. La documentation
publique indique que les requêtes `search/es_dsl` sont gratuites, mais qu'un
aperçu multi-source coûte 20 crédits pour vingt résultats et qu'une collecte
multi-source coûte 20 crédits par profil. Les abonnements vont de 49 $ pour
2 500 crédits à 499 $ pour 35 000, soit **0,014 à 0,020 $ le crédit**.

Si ces chiffres sont exacts, une page d'aperçu et une fiche complète coûtent
chacune environ 0,28 à 0,40 $, quand Konekt les facture 2 crédits, soit 0,026 à
0,032 $. Le forfait inclus reviendrait alors à 28-40 $ par mois sur Cabinet et
84-120 $ sur Entreprise.

Je n'ai pas pu vérifier ce point, et c'est celui qui pèse le plus lourd après
l'enrichissement. Il est mesurable en cinq minutes : la fonction lit déjà l'
en-tête `x-credits-remaining` à chaque appel et le journalise
(`coresignal-search/index.ts:106` et `:473`). Une recherche et une fiche
révélées depuis l'application, journaux ouverts, donnent la consommation exacte.
Les seuls appels de production datent des 8 et 9 juillet, hors de la fenêtre de
journaux consultable.

### Ce qui reste inconnu

Les factures mensuelles d'hébergement, de base de données et de frontal. Elles
sont a priori fixes et faibles au regard du reste, mais elles n'entrent dans
aucun calcul ci-dessus.

## 6 bis. Marge par plan, avec les prix relevés

Pour une organisation d'un siège consommant tout son forfait, hors hébergement.
Le scénario favorable suppose un forfait dépensé en emails et une base de données
peu coûteuse ; le scénario défavorable, un forfait dépensé en mobiles et le tarif
multi-source de la base.

| Plan | Revenu | Favorable | Marge | Défavorable | Marge |
|---|---|---|---|---|---|
| Solo | 64 $ | 9 $ | 86 % | 29 $ | 54 % |
| Cabinet | 150 $ | 24 $ | 84 % | 135 $ | 10 % |
| Entreprise | 204 $ | 55 $ | 73 % | 347 $ | −70 % |

Détail du scénario défavorable sur Entreprise : 16,82 $ d'IA, 225 $
d'enrichissement dépensé en mobiles, 99,60 $ de base de données au tarif
multi-source, 5,29 $ de connexion LinkedIn.

L'écart entre les deux colonnes n'est pas un aléa d'usage : c'est un choix que la
grille laisse au client, sans le facturer.

## 7. Ordre de marche proposé

1. Décompter le mobile 10 unités du forfait de contacts, comme le fait déjà le
   barème à l'acte. Une ligne de comptage, et l'exposition d'Entreprise passe de
   225 $ à 22,50 $ par mois. C'est le geste le plus rentable de cet audit.
2. Corriger la facturation du coaching en direct. C'est le seul défaut qui puisse
   faire partir un client en colère dès la première semaine.
3. Corriger le plafond de recherches pour un essai payé, en même temps.
4. Mesurer la consommation réelle de la base de données : une recherche et une
   fiche depuis l'application, journaux ouverts, et lire `x-credits-remaining`.
   Cinq minutes, et le plus gros point d'incertitude tombe.
5. Remonter le prix de vente du crédit d'enrichissement au-dessus de son coût,
   ou changer de fournisseur. Vendu 0,026 à 0,032 $ pour un coût de 0,040 à
   0,050 $, il perd de l'argent à chaque appel hors forfait.
6. Poser les prix fournisseurs en constante et les transmettre au règlement, pour
   que la marge devienne mesurable au lieu d'être estimée.
7. Décider entre forfait par siège et forfait par organisation, et l'écrire sur
   la page tarifs.
8. Revoir la marche Cabinet vers Entreprise, dont le prix marginal du crédit est
   plus bas que celui des packs.

Les points 1, 2 et 3 sont des correctifs de quelques lignes. Le reste demande une
décision commerciale, pas du code.

## 8. Ce qui a été corrigé le 9 septembre

Migration `20260909164751` et deux fonctions edge, relus par une passe
contradictoire de vingt-cinq constats dont sept retenus, puis corrigés :

- Un mobile consomme dix unités de forfait, comme au barème à l'acte. Les écrans
  qui annonçaient des « contacts » disent maintenant des emails, avec
  l'équivalence mobile.
- Une demande en cours retient sa réservation dans le forfait
  (`candidate_enrichments.reserved_units`). Sans elle, un lot de cent mobiles
  passait entier avant que le compteur, qui ne voit que les demandes terminées,
  ne bouge.
- Pendant un essai non payé, le forfait tombe à vingt unités, compté sur la
  durée de l'essai et non sur le mois civil, et la date de remise à zéro
  annoncée suit la même fenêtre.
- Le plafond d'essai de la Base Konekt ne s'applique plus à une organisation qui
  a déjà payé.
- Le coaching en direct est facturé à la minute écoulée, réservée par une
  écriture conditionnelle avant d'être débitée, et le compteur part de la
  première analyse et non de l'ouverture du panneau.
- La cascade de recherche ne court-circuite plus l'appel payant quand elle ne
  couvre qu'une partie de la demande : un email en cache servait une demande de
  mobile, et le mobile devenait inaccessible trente jours.

Vérifié sur PostgreSQL 16 avec les fonctions réelles : lot de trente mobiles
borné à la réservation puis ramené à la consommation réelle, essai plafonné à
vingt, abonné pendant l'essai servi à cent recherches, report de coût
incrémental. Plus tsc, tests unitaires et build.

## 9. Le coût fournisseur, rendu mesurable

Le constat de la section 5 restait ouvert : les actions qui appellent un
fournisseur externe enregistrent un coût de zéro, parce que le coût se déduit
des jetons et qu'elles n'en consomment aucun. Quatre actions sont concernées, et
non cinq : la recherche web porte déjà son prix réel, un cent par requête.
Derrière ce symptôme commun, deux manques différents.

Pour l'enrichissement de contact, c'est le prix qui manquait, pas la quantité.
La réponse du fournisseur porte le nombre de crédits débités à chaque demande
terminée, et cette valeur était déjà écrite dans
`candidate_enrichments.credits_consumed` sans jamais servir au calcul du coût.
Le débit la reprend maintenant, répartie entre l'email et le mobile au prorata
de leurs poids de 1 et 10, multipliée par un prix unitaire lu dans le secret
`BETTERCONTACT_CREDIT_COST_USD`. Sans secret, 0,045 $, milieu du tarif public
relevé en section 6. Quand le fournisseur n'annonce aucune quantité, rien n'est
écrit : un blanc se voit, un chiffre inventé passe pour une mesure.

Pour la Base Konekt, c'est la quantité. Le catalogue suppose deux crédits
fournisseur par recherche, la documentation du point multi-source en annonce
vingt, et personne n'avait tranché : les seuls appels de production datent du
8 juillet, hors de portée des journaux. La réponse HTTP porte pourtant le solde
restant à chaque appel. Chaque ligne de `base_konekt_usage` garde désormais ce
solde et l'instant du relevé, et la vue `base_konekt_provider_cost` donne la
consommation d'une opération par différence entre deux relevés successifs.

Trois précautions vont dans le même sens, une case vide plutôt qu'un chiffre
faux. La mesure s'ordonne sur l'instant du relevé et non sur la création de la
ligne, qui précède l'appel quand l'opération est prise sur le forfait. Une ligne
sans relevé casse la chaîne au lieu de disparaître, sans quoi sa consommation
serait reversée sur l'opération suivante, qui paraîtrait deux fois plus chère.
Et comme la clé du fournisseur est partagée par défaut entre organisations, un
écart ne compte que si l'opération précédente, toutes organisations confondues,
vient de la même organisation.

La mesure se fait à l'usage, sans rien à lancer. Après deux recherches
consécutives depuis le même compte :

```sql
select action, provider_credits_read_at, provider_credits_consumed
from base_konekt_provider_cost
where provider_credits_consumed is not null
order by provider_credits_read_at desc;
```

Si un aperçu coûte vingt crédits et non deux, le prix de revient d'une page
passe de 0,04 $ à 0,40 $, et le forfait de cent recherches du plan Cabinet de
4 $ à 40 $ par mois. C'est la dernière inconnue capable de retourner les marges
de la section 6 bis. Tant qu'elle n'est pas levée, `coresignal_preview` et
`coresignal_collect` restent à zéro dans le grand livre des crédits : le prix
d'un crédit fournisseur s'y posera en constante une fois la quantité connue,
comme pour l'enrichissement.

Deux points restent hors de ce grand livre, sans être perdus. Une demande
d'enrichissement couverte par le forfait ne produit aucun débit, donc aucune
ligne de transaction, mais sa consommation est écrite sur la demande
elle-même : la dépense du forfait se lit en sommant `credits_consumed` sur
`candidate_enrichments`. Même chose pour un débit refusé faute de solde.

La relecture contradictoire de ce lot a par ailleurs sorti un défaut plus vieux,
sans rapport avec la mesure : deux sondages simultanés du même enrichissement
voyaient tous les deux une demande en cours et la facturaient chacun leur tour.
Le passage à « terminée » est maintenant réclamé par une écriture
conditionnelle, et seule la requête qui l'emporte débite.
