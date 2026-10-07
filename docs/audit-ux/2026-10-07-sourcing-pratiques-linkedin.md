# Sourcing : pratiques LinkedIn, revue des process et conséquences pour Konekt

Complément du 7 octobre 2026 à [l'audit du sourcing](/workspace/remix-of-event-template/docs/audit-ux/2026-10-07-sourcing.md), sur le même commit `40ba9e6a`. Recherche documentaire, lecture de Notion et confrontation avec l'intégration existante. Aucun appel de recherche sur un compte LinkedIn réel, aucune modification de Notion ou du code applicatif.

**Conclusion : la méthode de l'équipe fournit une bonne base, mais sa traduction dans l'app ne conserve pas toujours l'intention du recruteur.** La priorité est de fiabiliser cette traduction, puis de mesurer la qualité sur des candidats évalués par l'équipe. Une requête très restrictive ou une note précise ne prouvent pas, à elles seules, la qualité du sourcing.

## Ce que l'équipe a effectivement discuté

La réunion qui correspond le mieux à la description est le [Point sales du 27 juillet 2026 à 11 h](https://app.notion.com/p/3a57e1816fb480288359fd06f7f2b3ba). Le [workflow de recrutement synthétisé après la réunion](https://app.notion.com/p/553cbb2970234c62b0e12f3f878ef680), modifié le 4 août, la cite explicitement.

Les pratiques décrites sont : un socle intitulés + booléen + zone géographique ; une recherche par code postal et rayon ; des variantes sans intitulé sur les postes difficiles ; l'exclusion du client et des sociétés interdites ; la prudence sur l'expérience totale, le niveau hiérarchique et les fonctions ; la priorité de contact aux Open to Work ; et l'historique de contact pour éviter de solliciter trop vite les mêmes personnes. Le « 80 % des recherches » du compte rendu est une estimation de l'équipe, pas un résultat mesuré.

Le délai de contact est discuté avec plusieurs valeurs. Le compte rendu retient deux à trois mois ; la méthode plus récente retient trois mois. L'exclusion de grandes villes étrangères est aussi décrite comme une astuce de terrain, avec le risque de perdre des candidats. Elle ne devrait pas devenir une règle automatique : il faut évaluer la mobilité, la présence requise et la langue de travail demandées par le mandat.

Trois documents internes, modifiés le 6 octobre, précisent la méthode :

- [Compétence : chercheur](https://app.notion.com/p/3a97e1816fb481a29a1afbd512c9ceb9) : angles intitulé, faire et contexte ; calibration sur dix profils ; diversification si les angles se recouvrent trop ; distinction entre erreur technique et absence de résultats.
- [Compétence : Scoreur](https://app.notion.com/p/60bdc40f206447f2993f7237d2a7626b) : adéquation, calibre et acceptabilité présentés séparément ; preuves par dimension ; faible confiance comme motif d'investigation ; renotation du lot si la grille change.
- [Sourcing LinkedIn : Guide & Filtres](https://app.notion.com/p/e84f6f53024749c1b9f22c8c811cf052) : compétence exercée plutôt que seulement déclarée ; diplôme comme repère ; résolution des entreprises et écoles ; disponibilité séparée de l'adéquation.

Ces pages apportent des pratiques internes, pas une validation formelle de tous leurs barèmes. Elles comportent encore des contradictions à résoudre dans la spécification produit.

## Les règles LinkedIn qui changent l'audit

| Sujet | Règle documentée | Conséquence pour Konekt |
|---|---|---|
| Logique des filtres | `CAN_HAVE` = OR, `MUST_HAVE` = AND, `DOESNT_HAVE` = NOT. [LinkedIn](https://www.linkedin.com/help/recruiter/answer/a406597) | Une alternative participe au filtrage. Une préférence de classement doit être représentée séparément. |
| Booléen | Opérateurs en majuscules, guillemets droits et parenthèses ; pas de joker `*`. [Syntaxe](https://www.linkedin.com/help/recruiter/answer/a524335) | Regrouper les synonymes avec OR et les exigences distinctes avec AND. Ne pas fabriquer de syntaxe propre à un autre outil. |
| Taille des requêtes | Sales Navigator limite à 15 opérateurs ; Recruiter/Lite n'ont pas de plafond du nombre d'opérateurs annoncé sur cette page ; le plafond Classic n'y est pas chiffré. [Limites](https://www.linkedin.com/help/recruiter/answer/a524411) | Ne pas supposer une limite universelle de 200 caractères ni inventer un nombre d'opérateurs pour Classic. Valider les contraintes réelles de l'API utilisée. |
| Expérience et séniorité | L'expérience totale se calcule depuis la première position, tous rôles et secteurs confondus ; la séniorité est dérivée du titre actuel. [Définitions](https://www.linkedin.com/help/linkedin/answer/a414428) | Ces champs sont des approximations. Ils ne mesurent pas directement les années de pratique d'une compétence. |
| Langue | La langue du profil et la langue parlée sont deux filtres différents. [Définitions](https://www.linkedin.com/help/linkedin/answer/a414428) | « Anglais courant » ne doit pas devenir « profil rédigé en anglais ». |
| Compétences | LinkedIn peut utiliser des compétences déclarées, du contenu de profil et des compétences inférées. [Compétences](https://www.linkedin.com/help/recruiter/answer/a593591) | Un résultat du filtre compétences fournit une piste ; il faut retrouver la pratique dans les missions et signaler les inférences. |
| Géographie et mobilité | Localisation actuelle et souhait de mobilité sont distincts ; un rayon par code postal permet d'affiner. Avec le filtre Remote, la localisation peut être ignorée. [Localisation](https://www.linkedin.com/help/recruiter/answer/a408667) | Préserver la portée et le rayon ; expliciter l'impact sur le bassin ; ne pas annuler la mobilité avec un postfiltre sur une chaîne de ville. |
| Type de lieu de travail | Le filtre Remote/Hybrid/On-site porte sur les préférences des membres Open to Work et restreint les résultats à cette population. [Workplace type](https://www.linkedin.com/help/recruiter/answer/a527316) | « Poste remote » ne justifie pas son activation par défaut : elle ferait disparaître des candidats passifs compatibles. |

Les entreprises et intitulés doivent également conserver leur portée actuelle/passée. Un refus de salariés actuels du client ne signifie pas automatiquement un refus de ses anciens salariés. La portée doit suivre la règle réelle du mandat, plutôt qu'un `CURRENT_OR_PAST` systématique.

L'[AI-Assisted Search de LinkedIn](https://www.linkedin.com/help/recruiter/answer/a1660341) distingue la conversion d'une demande en filtres de la recherche avancée par qualifications. Cette dernière dépend du produit et de la langue de l'interface. Elle n'établit pas que notre connecteur expose le même moteur. Les labels de correspondance LinkedIn ne constituent pas non plus une probabilité de réussite d'embauche à copier dans notre score.

## Méthode de filtrage recommandée

### Séparer recherche, classement et vérification

Pour chaque critère du brief, enregistrer son sens, sa portée, la preuve attendue et son traitement. Voici le contrat proposé pour l'app :

| Critère | Recherche | Classement / vérification |
|---|---|---|
| Famille de métiers | Alternatives d'intitulés dans l'angle intitulé ; aucun intitulé obligatoire dans l'angle faire. | Vérifier les responsabilités et les missions. |
| Compétence réellement indispensable | Facette native si disponible, ou expressions équivalentes documentées ; variantes de recherche si la mention est peu fiable. | Preuve d'utilisation, récence et profondeur ; absence de mention = à vérifier, pas contradiction établie. |
| Compétence souhaitée / soft skill | Aucun AND obligatoire dans la recherche générale. | Bonus explicable si pertinent ; question d'entretien pour les comportements non observables. |
| Expérience pertinente | Pas de borne dure par défaut fondée sur le diplôme ou l'expérience totale. Filtre approximatif possible si le recruteur le choisit. | Chronologie professionnelle pertinente, sans compter deux fois les périodes simultanées ; incertitude visible. |
| Localisation et présence | Zone, rayon, portée actuelle/mobilité selon le mandat et les capacités du compte. | Faisabilité du rythme de présence ; lieu actuel seul insuffisant en cas de mobilité ou remote. |
| Langue de travail | Langue parlée si disponible ; jamais substitution silencieuse par langue du profil. | Niveau déclaré, preuve disponible ou question à vérifier. |
| Entreprises / écoles | Entreprises alternatives dans l'angle contexte ; exclusions explicitement prévues par le mandat. École filtrante seulement si exigence justifiée du mandat. | Un parcours peut être un indice ; il ne démontre pas, seul, une compétence ou une langue. |
| Open to Work et activité | Vue ou variante de contact, accessible selon le compte ; conserver aussi une recherche ouverte aux passifs. | Priorité de contact séparée du score d'adéquation. |
| Contacts / candidatures existantes | Historique propre au mandat, au client et au périmètre d'équipe accessible. | Date, motif et possibilité de revoir un candidat ; distinguer contact récent et incompatibilité. |

Les travaux de [Glen Cathey sur les variantes de recherche](https://www.linkedin.com/business/talent/blog/talent-acquisition/sourcing-tactics-glen-cathey-uses-to-find-the-best-talent-on-linkedin) et la [checklist d'Irina Shamaeva](https://booleanstrings.com/2012/11/14/sourcing-checklist/) renforcent l'intérêt de distinguer indispensables et préférences, d'utiliser le vocabulaire des candidats et de chercher les personnes manquées par une première requête. Ce sont des retours de praticiens, parfois anciens, utiles pour la méthode ; ils ne prouvent pas un gain chiffré pour Konekt.

### Générer trois angles complémentaires

Exemple fictif : Backend Engineer Python dans un environnement SaaS B2B, avec présence régulière en Île-de-France, sans solliciter les salariés actuels du client.

| Angle | Construction proposée | Ce qu'il permet de retrouver |
|---|---|---|
| Intitulé | Famille `"Backend Engineer" OR "Backend Developer" OR "Développeur backend"`, compétence Python, zone compatible. | Les profils dont le titre décrit directement la cible. |
| Faire | Aucun filtre d'intitulé ; Python et un groupe alternatif lié aux missions, par exemple `API OR FastAPI OR Django` si ces termes correspondent au brief. | Les profils généralistes ou aux titres inhabituels qui ont exercé les bonnes missions. |
| Contexte | Entreprises SaaS B2B identifiées, en alternatives, portée actuelle/passée choisie ; indices techniques ou de missions. | Des environnements pertinents et des compétences transférables. |

Ce tableau décrit une intention de recherche, pas un payload à envoyer tel quel à tous les moteurs. Les sociétés doivent être résolues en entités fiables ; les scopes et champs doivent être compilés pour le contrat effectif. Les contraintes client restent communes aux trois angles. Les profils se dédupliquent par identité stable, avec conservation des angles qui les ont trouvés.

Le générateur doit choisir le vocabulaire réellement employé dans les profils : variantes françaises/anglaises, acronymes et appellations équivalentes pour les champs libres. Éviter de répéter inutilement ces variantes lorsqu'une facette native résout déjà le concept. Chaque groupe produit doit rester rattaché à un critère du brief ; aucune soft skill ou préférence ne doit devenir une exigence par simple ajout au texte booléen.

L'app devrait expliquer pourquoi chaque angle existe et permettre de comparer son apport en candidats pertinents. Le seuil interne de recouvrement de 40 % peut servir de point de départ, après définition de la mesure ; il n'est pas une norme démontrée. Les seuils internes de volume — notamment la « zone normale » de 150 à 800 — doivent aussi rester des repères à confronter au métier et au marché.

### Calibrer avant d'élargir

La salve de dix profils prévue dans Notion est un bon démarrage opérationnel. Inclure des profils issus des différents angles, des cas limites et des informations incomplètes, puis recueillir une décision et son motif. Ne pas calibrer uniquement sur les dix premières notes élevées du modèle.

Une contradiction répétée doit conduire à corriger la grille ou les filtres. Une modification de grille doit versionner le contexte et renoter le lot. Mesurer la précision des premiers résultats, les faux refus, le rappel sur un jeu annoté et le nombre de nouveaux profils pertinents par angle. Ce rappel ne prouve pas l'exhaustivité du marché LinkedIn. Suivre aussi le coût en résultats récupérés et les temps d'attente.

Le score doit exposer les preuves et les inconnues, avec une confiance distincte. La priorité de contact peut intégrer Open to Work ou l'historique, sans améliorer artificiellement l'adéquation au poste. Le bloc « calibre » interne demande une revue de ses critères avant implémentation : un signal de parcours ne doit pas devenir une présomption générale de compétence. Aucun barème universel ni seuil 65/70 ne devrait être adopté sans calibration.

## Contradictions internes à résoudre

| Sources | Contradiction | Décision produit recommandée |
|---|---|---|
| Guide & Filtres ; référentiel interne [Unipile Recruiter V2](https://app.notion.com/p/b633d47113cd46ec8886d103f1f49ee0) | L'école est dite non bloquante parce qu'en `CAN_HAVE`. Or la logique native est OR. | Séparer préférence de scoring et filtre « au moins une de ces écoles ». Corriger l'explication dans la spécification ; aucun changement Notion effectué ici. |
| Réunion de juillet ; Chercheur actuel | Éviter les filtres rigides d'XP, mais des règles plus récentes imposent encore des bornes. | Expérience pertinente évaluée sur le parcours ; filtre d'expérience totale explicite et facultatif, avec son caractère approximatif. |
| Guide & Filtres, au sein de la même page | Le diplôme est décrit comme un repère, puis comme moyen de valider l'expérience réelle. | Les expériences professionnelles constituent la base ; le diplôme complète la lecture et ne borne pas la carrière. |
| Scoreur ; implémentation actuelle | Grille et confiance séparées, renotation du lot ; seuil interne 70, seuil applicatif 65 et mélange IA/algorithme. | Choisir une grille versionnée et une explication fidèle au calcul ; calibrer les seuils sur des décisions humaines. |

## Écarts applicatifs prioritaires confirmés

Les points suivants sont établis par lecture des transformations du code, en complément des reproductions de l'audit initial. Ils ne constituent pas une mesure de fréquence en production.

| Priorité | Écart | Preuve locale et correction |
|---|---|---|
| P1 | **Alternative et préférence confondues.** `CAN_HAVE` est décrit comme « Nice to have » ; l'interface affiche « Souhaité ». Les écoles `CAN_HAVE` sont retirées, les écoles incluses avec `MUST_HAVE` sont converties en `CAN_HAVE`. | [Types](/workspace/remix-of-event-template/src/components/outreach/types.ts:10), [légende](/workspace/remix-of-event-template/src/components/outreach/search/FilterFacets.tsx:375), [écoles](/workspace/remix-of-event-template/src/hooks/useLinkedInSearchActions.ts:242). Créer deux concepts explicites : logique de recherche et préférence de classement. Le retrait d'une préférence de la requête peut être correct, mais ce comportement ne doit pas reposer sur un contresens du champ natif. |
| P1 | **Entreprises ciblées écrasées ; alternatives converties en AND.** Les IDs inclus deviennent `MUST_HAVE`, puis `company_keywords` peut remplacer tout le tableau. | [Conversion](/workspace/remix-of-event-template/supabase/functions/unipile-search/index.ts:721), [remplacement](/workspace/remix-of-event-template/supabase/functions/unipile-search/index.ts:750). Préserver les exclusions et exprimer explicitement « entreprise A OU B », avec leur portée. |
| P1 | **Mobilité et exclusions géographiques annulables après la recherche.** | [Postfiltre](/workspace/remix-of-event-template/src/hooks/useLinkedInSearchActions.ts:45). Conserver la sémantique native ; aucun rejet local par simple correspondance du lieu actuel lorsque le critère porte sur la mobilité. |
| P1 | **Clauses supprimées au-delà de 200 caractères sur tous les moteurs.** La coupe retire des groupes AND ou une fin d'expression ; le rééquilibrage syntaxique ne restaure pas le sens. | [Troncature](/workspace/remix-of-event-template/supabase/functions/unipile-search/index.ts:619). Valider une représentation structurée ; montrer la requête exécutée ; proposer des variantes si nécessaire, sans coupe silencieuse. |
| P2 | **Séniorité Recruiter remplacée par des mots de titre, parfois omise.** La présence d'un rôle obligatoire empêche l'ajout de ces mots. | [Adaptateur](/workspace/remix-of-event-template/src/hooks/useLinkedInSearchActions.ts:442). Si ce filtre est choisi, transmettre le champ natif compatible ou signaler le fallback ; ne pas le présenter comme équivalent à l'expérience pertinente. |
| P2 | **Cinq signaux Sales Navigator produits côté client mais non lus dans `handleSearch`.** | [Champs envoyés](/workspace/remix-of-event-template/src/hooks/useLinkedInSearchActions.ts:674). Vérifier leur contrat v1, puis les transmettre ou annoncer leur indisponibilité dans l'app. |
| P2 | **Capacités du contrat insuffisamment identifiées.** L'action de lecture de contrats renvoie un tableau vide et seulement des indicateurs génériques Premium. | [Compte](/workspace/remix-of-event-template/supabase/functions/unipile-accounts/index.ts:1295). Distinguer Lite, Recruiter complet et contrat actif avant de promettre des filtres. |
| P2 | **Résultats Recruiter/Sales Navigator traités comme pratiquement illimités.** Le client fixe le plafond à `999999`. | [Quotas](/workspace/remix-of-event-template/src/hooks/useUnipileQuota.ts:41). Séparer plafond par recherche, résultats récupérés par jour et nombre d'appels ; compter aussi les résultats ensuite rejetés localement. |

Les défauts P1 déjà relevés sur le contexte incomplet, les refus sur données inconnues, l'association des notes au mauvais ID et les scores périmés restent prioritaires. Une meilleure recherche ne compense pas une mauvaise décision de scoring.

## Ce que permet le connecteur, et ce qui reste à vérifier

L'app utilise l'API Unipile **v1**. Le [guide de recherche](https://developer.unipile.com/docs/linkedin-search) documente les paramètres et la recherche par URL LinkedIn. Les références **v2** indiquent les capacités actuelles, mais leurs paramètres ne doivent pas être copiés dans la v1 sans vérification : [migration](https://developer.unipile.com/v2.0/docs/migration-linkedin-api), [Recruiter](https://developer.unipile.com/v2.0/reference/performrecruiterpeoplesearch), [Sales Navigator](https://developer.unipile.com/v2.0/reference/performsalespeoplesearch).

Unipile documente aussi la [lecture des contrats v1](https://developer.unipile.com/reference/linkedincontroller_getavailablecontracts) et leur [sélection](https://developer.unipile.com/reference/linkedincontroller_selectcontract). L'absence de prise en charge dans l'app ne prouve donc pas une absence de capacité du fournisseur.

Selon [Unipile](https://developer.unipile.com/docs/provider-limits-and-restrictions), les recherches de personnes sont plafonnées à 1 000 résultats sur Classic et 2 500 sur Recruiter/Sales Navigator. Le fournisseur recommande également 1 000/2 500 résultats récupérés par jour, selon le moteur. Le plafond quotidien est une recommandation d'Unipile ; le plafond par recherche correspond à la limite de récupération rapportée pour LinkedIn. Un total affiché supérieur au plafond ne signifie pas que tous les profils sont récupérables avec la même requête.

Les [produits LinkedIn](https://www.linkedin.com/help/linkedin/answer/a417251) n'ont pas les mêmes filtres ni la même visibilité réseau. Les pages officielles sont même contradictoires sur les Spotlights de Lite : la comparaison générale les dit absents, la [page dédiée](https://www.linkedin.com/help/recruiter/answer/a414283) en décrit deux. La capacité effective du compte doit donc être vérifiée. Un profil masqué ou incomplet ne doit pas être pénalisé comme s'il avait un parcours moins pertinent.

## Validation nécessaire pour conclure

1. **Valider la compilation sans compte réel** : préserver OR/AND/NOT, les scopes et les exclusions ; distinguer préférences et filtres ; refuser une perte de clause ; indiquer chaque critère non appliqué.
2. **Comparer ensuite à LinkedIn natif, avec le même compte et contrat** : alternatives d'entreprises, écoles OR, exclusion géographique seule, mobilité, rôle actuel/passé, langue parlée, séniorité et requête longue. Utiliser l'URL native comme référence lorsque pertinente, sans présumer une stricte identité de classement entre moteurs.
3. **Calibrer avec l'équipe** : plusieurs mandats représentatifs et profils annotés, raisons de décision, informations inconnues ; comparer les trois angles et les faux refus avant de régler les poids.
4. **Finaliser l'UX sur ce contrat** : expliquer l'effet des filtres, distinguer critères préparés/appliqués, montrer l'angle et la requête effective à la demande, proposer une reprise des erreurs et conserver le contexte pendant les chargements.

La revue documentaire et la confrontation au code sont terminées. La pertinence réelle, la parité des recherches natives et la calibration restent à établir avec ces validations ; elles ne peuvent pas être certifiées par les seules sources et données simulées.
