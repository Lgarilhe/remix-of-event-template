# Sourcing guidé : recette avant ouverture aux testeurs

Le dashboard propose « Trouver des candidats ». Une nouvelle recherche ou une mission existante ouvre « Cadrer la recherche ». Les échanges complètent un brouillon du cadrage ; la recherche ne démarre qu’au clic sur « Valider et chercher ». Le même dialogue est disponible depuis le sourcing d’une mission et via « Ajuster avec l’assistant » après les résultats.

## Ce que le testeur peut faire

1. Décrire le poste depuis l’accueil, ou choisir une mission pour reprendre son cadrage complet.
2. Répondre aux questions de l’assistant. Modifier un champ directement, demander un retrait ou un ajout de critères, changer les niveaux Indispensable / Souhaité / Bonus et le caractère rédhibitoire.
3. Ajuster les cinq pondérations de notation. Le total doit être 100 %. Le poids influence la notation ; il ne transforme pas une information absente du profil en information vérifiée.
4. Choisir la source, valider, puis vérifier les filtres, les résultats et leur source. Le cadrage sauvegardé est aussi visible dans l’onglet Cadrage de la mission.
5. Ouvrir un profil, le noter si nécessaire, le retenir ou l’écarter. Les retenus rejoignent le Pipeline. Modifier les filtres ou la source puis relancer explicitement. Un simple retour dans le sourcing conserve les résultats sans nouvelle recherche.

Les champs du poste, les critères et les détails réutilisent les composants de Cadrage. Le chat reprend les enveloppes de messages et le composer de l’assistant existant ; la source utilise le SegmentedControl partagé. Les onglets existants donnent un accès direct au poste et aux critères, sans cacher l’action finale sous le formulaire. Aucun nouveau jeu de couleurs ni nouveau modèle de critères.

Une réponse non envoyée empêche la validation. Une sortie avec un brouillon modifié demande confirmation. Les champs restent verrouillés pendant un échange. Un échec conserve le texte ; une modification du cadrage par une autre session empêche son remplacement. La sauvegarde utilise une condition sur `updated_at`.

## Sans LinkedIn : périmètre réel

La Base Konekt recherche avec l’accès de l’organisation, sans compte LinkedIn et sans consommer le quota de ce compte. Elle doit être activée sur un forfait compatible, avoir un accès fournisseur configuré et disposer de recherches incluses ou de crédits. L’absence de compte LinkedIn ne suffit pas à garantir l’accès à cette base.

| Information ou action | Base Konekt | LinkedIn relié |
| --- | --- | --- |
| Nom, titre, entreprise, lieu, lien professionnel | Aperçu, selon les données collectées | Selon ce que le compte peut voir |
| Parcours, formations, résumé, compétences, photo | Fiche complète collectée à l’ouverture ; champs parfois absents, compétences parfois inférées | Profil détaillé, selon sa visibilité |
| Email ou téléphone | Enrichissement distinct, jamais garanti | Jamais garanti par la recherche |
| Messages et invitations LinkedIn | Compte LinkedIn relié nécessaire | Selon la licence, les autorisations et les quotas |
| Notation | Possible après récupération de la fiche complète ; crédits applicables | Possible sur les informations disponibles ; crédits applicables |

La localisation de la Base Konekt est un nom de lieu, conservé dans les filtres visibles sans résolution d’identifiant LinkedIn. La tranche d’expérience est appliquée au dataset complet par le serveur ; les cartes d’aperçu sans dates ne sont pas filtrées une deuxième fois au navigateur. Une action charge une page ; la suite reste un choix de l’utilisateur.

## Vérifications automatisées

- `tests/agent/guided-sourcing.test.mjs` : validation des tours, plages et pondérations, refus des credentials service et des organisations étrangères, garde de crédits avant appel, décompte même si la sortie du modèle est invalide, aucune écriture du brief côté fonction, lieux sans appel LinkedIn.
- `tests/agent/guided-sourcing-filter-reset.test.mjs` : lancement depuis un cadrage validé sans conserver les anciens lieux, compétences, entreprises ou exclusions ; affinage manuel conservé.
- `e2e/flows/guided-sourcing.spec.ts` : accueil et mission, sources reliée/non reliée, critères et pondérations réellement transmis à la génération, accès base absent, erreurs IA/sauvegarde, cadrage concurrent, protection du brouillon, lancement unique, refus d’un forfait incompatible, métadonnées des critères et du client conservées, description libre modifiable sans troncature, Échap dans les suggestions Client et critères vides.
- Dialogues à 1440, 390 et 320 px, plus comparaison dépliée à 1024 × 600 px sans chevauchement du composer et de la validation en clair et sombre, avec vérification de débordement et audit axe WCAG A/AA. Les captures sont des données fictives.
- `e2e/flows/sourcing-return.spec.ts` : résultats, notes, sélection, groupes, pagination, changements de contexte et retour depuis le Pipeline, sur les composants réels.

Les transports, la base et le modèle sont simulés aux frontières dans ces tests. Aucun compte, candidat ou crédit de production n’est modifié. Les tests ne valident pas la qualité du prompt avec le modèle réel ni l’accès actuel au fournisseur.

## Recette réelle nécessaire

1. Déployer `sourcing-interview` avec son entrée de configuration et la nouvelle action de crédits. Aucun changement de schéma. Une modification sous `_shared/` entraîne le redéploiement habituel des fonctions.
2. Dans un espace de test sur un forfait compatible, confirmer l’activation de la Base Konekt et son accès fournisseur. Contrôler les crédits, puis utiliser un utilisateur sans compte LinkedIn et chercher un poste précis dans un lieu précis.
3. Vérifier les champs effectivement reçus, l’ouverture de la fiche, les informations absentes, la notation et le décompte d’une page. Revenir dans le sourcing : aucune nouvelle consommation.
4. Refaire le parcours avec un compte LinkedIn de test et sa licence. Contrôler les filtres réellement représentables ; les limites de Classic, Sales Navigator et Recruiter ne sont pas interchangeables.
5. Faire deux ou trois échanges avec le modèle réel, dont un retrait de compétence et une demande de changement de pondération. Vérifier le cadrage enregistré et la recherche finale avant d’ouvrir aux recruteurs.

Vérification en lecture seule de production le 13 octobre 2026 : `sourcing-interview` n’est pas encore déployée ; aucune clé Base Konekt par organisation et aucune ligne `base_konekt_usage` retrouvées ; une organisation porte un historique d’activation. Le resolver peut aussi utiliser une clé globale serveur : cette vérification ne prouve ni son absence ni un accès opérationnel. Ne pas annoncer la recherche sans LinkedIn comme validée en conditions réelles avant la recette ci-dessus.
