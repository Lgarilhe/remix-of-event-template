# Test comparatif des bases de profils : Coresignal, Xverum, Crustdata

Préparé le 2026-09-25. Objectif : choisir le fournisseur de la Base Konekt (sourcing sans LinkedIn) sur des mesures, pas sur des grilles tarifaires lues sur le web.

## 1. Question posée

Pour un client Konekt sans LinkedIn, quel fournisseur donne le plus de bons candidats en France, avec des fiches assez riches pour le scoring IA, au coût le plus bas par candidat retenu, sous un contrat qui autorise l'usage par plusieurs clients ?

## 2. Les trois briefs

Les deux premiers reprennent les requêtes de l'essai Coresignal du 2026-07-08 (`docs/coresignal-integration-audit.md`, annexe), pour comparer avec un point connu.

| # | Poste | Critères communs aux trois fournisseurs | Référence juillet |
|---|---|---|---|
| B1 | Talent Acquisition Manager | titre actuel exact « Talent Acquisition Manager », pays France | 1 338 profils (Coresignal) |
| B2 | Développeur React senior | compétence React, ville Paris et alentours, 5 ans d'expérience ou plus | 13 857 profils avec React à Paris (Coresignal) |
| B3 | Responsable commercial B2B SaaS | titre actuel contenant « Sales » ou « Commercial » avec « Head », « Manager » ou « Responsable », secteur logiciel, région Auvergne-Rhône-Alpes | aucune |

B3 teste un profil plus rare hors Paris, là où les bases sont le plus souvent creuses.

## 3. Ce qu'on fait chez chaque fournisseur

Pour chaque brief, la même séquence :

1. Recherche : relever le nombre total de profils trouvés.
2. Aperçu : récupérer les 20 premiers profils (nom, titre, entreprise, lieu).
3. Fiches : récupérer la fiche détaillée des 10 premiers.
4. Relever les crédits consommés à chaque étape (solde avant et après).

Budget par fournisseur : 3 recherches, 3 pages d'aperçu, 30 fiches. Chez Coresignal : environ 660 crédits (recherche gratuite, 20 crédits par page d'aperçu, 20 par fiche).

Point d'attention : l'essai gratuit Coresignal est accordé une seule fois par domaine e-mail, et Konekt l'a déjà utilisé en juillet. Il faut demander des crédits de test au commercial (support@coresignal.com), en même temps que le devis sur mesure. Pour Xverum et Crustdata, demander un accès d'essai avec au moins 700 crédits ou l'équivalent.

## 4. Grille de mesure

| Critère | Comment le mesurer | Poids |
|---|---|---|
| Couverture | nombre de profils trouvés par brief | 15 % |
| Pertinence | sur les 20 profils de l'aperçu, un recruteur note chacun : 2 à contacter, 1 possible, 0 hors cible. Score sur 40 par brief | 30 % |
| Fraîcheur | sur les 10 fiches, part des postes actuels identiques au profil LinkedIn public (vérification manuelle) | 15 % |
| Richesse des fiches | sur les 10 fiches, présence de : descriptions d'expériences, compétences, formation, langues. Option : passer les fiches dans le scoring Konekt et comparer les scores obtenus | 15 % |
| Coût par candidat retenu | coût réel (crédits consommés × prix du crédit au plan nécessaire) divisé par le nombre de profils notés 2 | 15 % |
| Contrat | réponses écrites aux questions de la section 5 | 10 % |

Règle de décision : le fournisseur qui a le meilleur score pondéré gagne, sauf s'il échoue à une condition éliminatoire de la section 5.

## 5. Questions à poser par écrit à chaque fournisseur

Conditions éliminatoires (une réponse non conforme écarte le fournisseur) :

1. Peut-on afficher les profils à plusieurs clients d'une plateforme SaaS de recrutement ?
2. Peut-on garder une fiche en cache (durée ?) et la réutiliser pour un autre client, sans la repayer ?
3. Quelle entité signe le contrat, où sont hébergées les données, et un DPA avec clauses contractuelles types est-il fourni ?

Questions de prix :

4. Prix d'un contrat sur mesure pour environ 5 000 pages d'aperçu et 5 000 fiches par mois, France d'abord.
5. Prix d'achat d'un jeu de données complet France (profils salariés), mis à jour chaque mois.
6. Méthode de collecte des données, et garantie en cas de réclamation de LinkedIn ou d'un candidat.

## 6. Tableau de résultats (à remplir)

| | Coresignal | Xverum | Crustdata |
|---|---|---|---|
| B1 profils trouvés | | | |
| B2 profils trouvés | | | |
| B3 profils trouvés | | | |
| Pertinence (sur 120) | | | |
| Fraîcheur (sur 30 fiches) | | | |
| Richesse (sur 30 fiches) | | | |
| Crédits consommés | | | |
| Plan nécessaire et prix mensuel | | | |
| Coût par candidat retenu | | | |
| Conditions éliminatoires | | | |
| Score pondéré | | | |

## 7. Références

- Grille Coresignal lue le 2026-09-25 (page Pricing de docs.coresignal.com, fournie par capture) : aperçu multi-source 20 crédits par page de 20 résultats, fiche multi-source 20 crédits, recherche gratuite, aperçu disponible à partir du plan Pro (499 $ pour 35 000 crédits), Growth 1 000 $ pour 150 000, Premium 1 500 $ pour 1 000 000.
- Prix Xverum et Crustdata : non vérifiés à la source (extraits de recherche web), à confirmer par les devis.
- Barème Konekt actuel : 2 crédits la page, 2 crédits la fiche (`supabase/functions/_shared/ai-config.ts`, migration `20260907053655_base_konekt_activation.sql`).
