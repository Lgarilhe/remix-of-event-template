# Intégrations ATS : ce qui est faisable, par quelle voie, dans quel ordre

Rédigé le 25/09/2026, pour le fondateur.

La question : « Ce que tu as prévu avec ces intégrations sera-t-il possible, selon ce que prévoient les ATS dans leurs intégrations et leurs API ? Le but : proposer au départ au moins une dizaine d'intégrations avec les ATS les plus utilisés par les startups et les entreprises. »

Base de ce document :
- la matrice `ats/matrice.md` et les dix fiches du dossier `ats/` (marché, connecteurs unifiés, API g1 à g8) ;
- onze contre-vérifications faites le 25/09/2026, dont les corrections sont appliquées ici ;
- trois lectures ajoutées pour cette réponse : la documentation officielle de Bullhorn (source publiée sur GitHub) et trois relevés de prix des connecteurs.

Marques : **[V]** lu sur une page ou un dépôt officiel ; **[S]** source secondaire (connecteur tiers, copie, extrait de moteur de recherche) ; **[?]** incertain ou non trouvé. « [V archive] » : documentation officielle ancienne. Les numéros (s1, s2…) renvoient à la liste des sources, en fin de document, qui donne chaque adresse.

Limite de lecture, à garder en tête : les sites des éditeurs et des connecteurs étaient refusés par le proxy de la session, et le budget de recherche web était épuisé. Seuls GitHub, GitLab et les registres de paquets répondaient. Plusieurs cases reposent donc sur des archives, des copies ou des extraits. La section 5 dit comment les lever.

---

## L'essentiel en 10 points

1. **Oui, pour l'essentiel.** Ce que prévoit la conception passe par les API réelles des ATS de la liste. Un connecteur unifié ne donne jamais plus que l'API de l'ATS : chaque limite de l'éditeur vaut aussi à travers lui.
2. **Créer une mission depuis un poste (C1), lire les candidatures (C2) et envoyer un candidat (C5) marchent sur les dix**, avec des écarts : e-mail ou CV exigé selon l'outil, aucun identifiant renvoyé chez Flatchr, étape d'arrivée à régler.
3. **« Dans votre ATS » par profil LinkedIn (C3) n'existe dans aucun ATS ni connecteur.** Par e-mail, presque partout. Konekt doit tenir son propre index du vivier (`external_people`, lot I5).
4. **Les étapes et leurs changements (C4, C6) marchent, sauf deux cas.** Taleez ne donne que le nom de l'étape, sans motif de refus ni embauche. Welcome to the Jungle n'a pas de webhook : relecture au jour près. Partout ailleurs, les webhooks ne suffisent pas seuls : une relecture périodique est obligatoire.
5. **« À jour il y a 2 h » n'est garanti nulle part.** Afficher la fraîcheur réelle, lue chez le connecteur.
6. **Changer l'étape depuis Konekt (C7) est possible presque partout.** La conception ne s'en sert pas : ce choix ne coûte rien.
7. **Liste de lancement, douze outils** : Teamtailor, Flatchr, Taleez, Ashby, Lever, Greenhouse, Recruitee, Workable ; Welcome to the Jungle sous condition d'accès ; Bullhorn pour les cabinets, après une étude courte ; SmartRecruiters et Factorial sur demande.
8. **Voie : Kombo pour les douze au lancement.** Il les a tous dans sa liste, son écran de connexion existe en français, sa région par défaut est l'UE. Son prix n'est pas public : à obtenir. Alternative à prix public : Merge (650 $ par mois jusqu'à 10 clients reliés, puis 65 $ par client).
9. **Rien ne se promet à un client avant deux preuves** : la ligne « SUPPORTED » dans la matrice de couverture de Kombo, lisible avec une clé d'essai, et un test réussi sur un pilote.
10. **Obstacles d'accès** : Welcome to the Jungle (jeton demandé à l'éditeur, offres éligibles à confirmer) ; Lever et Greenhouse (accord partenaire en direct, levé par le connecteur) ; Flatchr (clé à renouveler chaque année) ; Bullhorn (connexion par OAuth seulement).

---

## 1. La réponse courte, capacité par capacité

### 1.1 Le verdict

| Capacité | Faisable ? | Sur les dix de la liste | Limites principales |
|---|---|---|---|
| **C1** Créer une mission depuis un poste | **Oui** | 10 sur 10 | Welcome to the Jungle ne donne pas le recruteur du poste [V archive s19]. Taleez ne liste pas les étapes du poste [S s23]. Bonus : Greenhouse et Lever publient leurs annonces sans aucune connexion (postes publiés seulement) [V s27 s30]. |
| **C2** Lire les candidatures d'un poste, avec CV | **Oui** | 10 sur 10, dont Taleez lent | Les adresses de CV expirent vite : 30 secondes chez Teamtailor [V archive s15], 7 jours chez Greenhouse [V s27]. Flatchr sert 1 CV par seconde et par entreprise [V s22]. Taleez se lit candidat par candidat, à 100 requêtes par minute [S s23]. Par Kombo, Welcome to the Jungle ne donne que le CV, ni lettre ni autre document [S s5]. |
| **C3** Retrouver une personne dans tout l'ATS | **Oui par e-mail, non par LinkedIn** | E-mail : presque partout ; LinkedIn : aucun | Aucun ATS ni connecteur ne filtre sur l'adresse LinkedIn [V s3 ; V archive s15 ; V s27]. Welcome to the Jungle exige un poste pour lister ses candidats [V archive s19]. Workable garde un enregistrement par poste [S s26]. Kombo garde une copie filtrable par e-mail et par nom exact [V s3]. Le premier remplissage de l'index est lent : Workable à 10 requêtes par 10 secondes [S s26], Teamtailor à 30 résultats par page [V archive s15]. |
| **C4** Étapes d'un poste et étape de chaque candidature | **Oui, sauf Taleez** | 9 sur 10 | Les étapes sont propres à chaque poste chez Teamtailor, Greenhouse, Workable, Ashby, Welcome to the Jungle [V archive s15 ; V s27 ; S s26 ; S s32 ; V archive s19]. Taleez ne donne que le nom de l'étape courante [S s23]. |
| **C5** Envoyer un candidat (personne, candidature, CV, note, source) | **Oui, avec écarts** | 10 sur 10 | E-mail obligatoire : Welcome to the Jungle [V archive s19], Workable [S s26]. CV obligatoire et aucun identifiant renvoyé : Flatchr [V s22]. Source à créer d'abord par le client : Ashby [S s32], Greenhouse [V s27]. Candidature arrivée en « Applied » à replacer : Recruitee [S s25]. Aucun objet « agence » générique, sauf Bullhorn (`JobSubmission`) [V s45] et Workday (hors liste) [S s40]. |
| **C6** Être prévenu des changements, refus avec motif, embauche | **Oui, par relecture ; webhooks en plus quand ils existent** | 10 sur 10 ; Welcome to the Jungle et Taleez en relecture seule | Motif de refus absent chez Taleez [S s23] et non documenté chez Welcome to the Jungle [V archive s19]. Embauche non signalée chez Taleez [S s23]. Par un connecteur, la fraîcheur est celle de sa synchronisation [S s6 ; V s10]. |
| **C7** Changer l'étape depuis Konekt | **Possible, non utilisé** | 7 par Kombo, 8 en direct ; jamais chez Taleez ; Bullhorn en direct non étudié | Kombo ne le cite pas pour Welcome to the Jungle, Flatchr, Taleez [S s2]. En direct, Flatchr et Welcome to the Jungle le permettent [V s22 ; V archive s19]. Taleez non [S s23]. Bullhorn en direct [?]. Aucun impact : la conception ne réécrit pas l'étape (décision 23). |
| **C8** Connexion par le client seul | **Oui, sauf Welcome to the Jungle** | 9 sur 10 | Welcome to the Jungle : jeton demandé à l'éditeur [V archive s19 ; S s20 ; S s12]. Clés qui expirent : Flatchr à 365 jours [V s22], Workable à la date choisie [S s26]. Recruitee : jeton lié à une personne [S s25]. Bullhorn : OAuth seulement en production [V s45]. |

### 1.2 Ce que cela veut dire pour la conception

- **Les six apports prévus pour l'ATS tiennent** (conception, section 2.17) : mission depuis un poste, « Dans Teamtailor », vivier de l'ATS dans le Sourcing, « Envoyer dans l'ATS », étape et embauche lues, candidatures reçues à trier.
- **Deux promesses sont à réécrire.** « Dans Teamtailor » par profil LinkedIn repose sur l'index de Konekt, pas sur l'ATS. « À jour il y a 2 h » devient la date réelle de la dernière lecture.
- **Quatre comportements changent selon l'outil** : l'e-mail exigé à l'envoi, le CV exigé ou refusé, l'étape d'arrivée, la source d'origine. Détail en section 4.
- **Les tailles de la synthèse restent** : I6a lecture G, I6b écriture G. La voie choisie change surtout le travail par outil (section 3).

### 1.3 Qui fait quoi, par Kombo sauf mention

| ATS | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Sources |
|---|---|---|---|---|---|---|---|---|---|
| Teamtailor | oui | oui | e-mail ; nom exact par la copie | oui | oui, sans e-mail possible | synchro ; webhooks du client sans relance | oui | clé Admin | s15 s16 s17 s2 s3 |
| Flatchr | oui | oui, CV lent | e-mail, nom, téléphone | oui, colonne « embauche » | CV obligatoire ; par Kombo à confirmer | webhooks posés par le client ; refus relus | direct seulement | clé de 365 jours | s22 s2 s13 |
| Taleez | oui | lent | e-mail | nom de l'étape seul | oui, identifiants renvoyés | relecture, sans motif | non | clé secrète | s23 s2 s13 |
| Ashby | oui | oui | e-mail, nom | oui | oui, dans l'étape choisie | webhooks créés par Konekt | oui | clé de l'administrateur | s32 s2 |
| Lever | oui | oui | index | oui | oui | webhooks créés par Konekt | oui | OAuth du connecteur | s30 s31 s4 |
| Greenhouse | oui | oui | e-mail | oui | oui | webhooks posés par le client, relancés | oui | par le connecteur (v3) | s27 s28 s29 |
| Recruitee | oui | oui | e-mail, nom, texte | oui | oui, à placer en « Sourced » | webhook d'étape posé par le client | oui | jeton personnel | s25 s2 |
| Workable | oui | oui | e-mail | oui | oui, e-mail exigé | webhooks créés par Konekt | oui | jeton qui expire | s26 s2 |
| Welcome to the Jungle | oui | oui ; par Kombo, CV seul | poste par poste | oui | oui, 5 champs obligatoires | relecture au jour près | direct seulement | **non** | s19 s20 s21 s5 s12 |
| Bullhorn | oui | oui | profils déjà présents | ? | oui (`JobSubmission`) | file d'événements relue | oui | OAuth ; administrateur | s45 s43 s14 s2 |
| SmartRecruiters | oui | oui | mot-clé | 9 statuts fixes | oui, e-mail exigé | webhooks créés par Konekt | oui | ? | s33 s4 s2 |
| Factorial | oui | oui | e-mail | oui, type normalisé | **sans CV** | webhooks créés par Konekt | oui (direct) | clé ou OAuth | s35 s2 |

---

## 2. Les douze ATS du lancement, dans l'ordre

**Comment l'ordre est fait.** Usage prouvé en France chez les clients visés par Konekt, puis certitude technique. Les chiffres de marché viennent d'extraits de moteur de recherche : aucune page n'a été lue en entier, et personne ne publie de part de marché pour la France [S s49]. Les huit premiers sont ouvrables sans accord avec l'éditeur. Le neuvième et le dixième ont un préalable. Les deux derniers viennent sur demande d'un client.

**Voie commune** : Kombo, jamais nommé à l'écran (règle de marque de Konekt). Voie directe notée quand elle est un repli crédible.

### 2.1 Teamtailor

- **Pourquoi.** Le plus présent en France, tous segments : pages carrière de plusieurs entités du Crédit Agricole, d'Etam, de Spiko ; Welcome to the Jungle recrute elle-même avec Teamtailor ; 12 000 entreprises dans le monde [V extraits s50].
- **Voie.** Kombo [V s1]. Plus tard, direct si Teamtailor domine les demandes : son programme partenaire ajoute une carte « résultat » sur la fiche du candidat et des webhooks posés automatiquement [V s18].
- **Marche dès le départ.** Postes avec texte, recruteur et étapes [V archive s15]. Candidatures avec CV [V archive s15]. Recherche par e-mail [V archive s15], par nom exact dans la copie de Kombo [V s3]. Étapes par poste, avec le type « Hired » pour l'embauche [V archive s15]. Envoi du candidat marqué « sourcé », sans e-mail si besoin, avec CV par adresse, note et étiquette [V archive s15] ; Kombo cite création, note, pièce jointe et changement d'étape [S s2].
- **Ne marche pas, ou pas encore.** Pas de recherche par nom ni par LinkedIn en direct [V archive s15]. À l'envoi, la candidature entre dans « Inbox » ; choisir l'étape à la création n'est pas documenté [?]. Refus avec motif par l'API non documenté [?]. Webhooks du client sans aucune relance depuis le 19/03/2026 [V s17]. Ne pas annoncer un refus avant la date `transparent_recruiting_visible_at` [V s17].
- **Obstacle d'accès.** Aucun. Un administrateur crée une clé « Admin » et la colle [V s16]. Cette clé lit tout le vivier [V archive s15]. Les webhooks d'entreprise sont une fonction à activer ; gratuite ou payante, inconnu [V s17 ; ?]. Région UE, Amérique du Nord ou Asie-Pacifique à retenir par client [V s18].

### 2.2 Flatchr

- **Pourquoi.** L'ATS français des PME : plus de 2 000 clients, relié à Welcome to the Jungle et à Hellowork [V extraits s51].
- **Voie.** Kombo par défaut. Direct en repli crédible : la documentation officielle est publique, en français, modifiée le 10/07/2026 [V s22].
- **Marche dès le départ.** Annonces avec contrat, salaire, télétravail [V s22]. Candidatures d'une offre avec CV [V s22]. Recherche par e-mail, nom, téléphone [V s22]. Colonnes du kanban, dont la colonne « embauche » [V s22]. Webhooks « nouveau candidat » et « déplacement » [V s22]. Refus relus : archivage avec motif (`reason`) [V s22].
- **Ne marche pas, ou pas encore.**
  - Envoi par Kombo : non établi. Un extrait place Flatchr dans la liste « créer une candidature » [S s2] ; la couverture en écriture, et celle du CV, n'ont pas été lues [?]. Kombo a bien deux accès directs à Flatchr, dont l'API de création de candidat [V s4].
  - En direct, l'envoi a trois contraintes [V s22]. Le poste se désigne par son `slug`. Le CV est obligatoire (`type` et `resume`) ; sur la route `/custom`, il ne l'est peut-être pas [?]. La réponse ne renvoie aucun identifiant : il se récupère ensuite par le webhook `new_applicant` (`applicant_id`) ou par la recherche (e-mail et offre).
  - Notes : route réservée à un jeton utilisateur, obtenu avec un mot de passe ; à exclure [V s22]. Un seul fichier à la création [V s22]. CV lus à 1 requête par seconde et par entreprise, limite posée le 28/05/2026 [V s22]. Webhooks réglés à la main par le client, sans signature, sans événement de refus [V s22]. Pas de recherche par LinkedIn [V s22]. Changer l'étape : direct oui, Kombo non [V s22 ; S s2].
- **Obstacle d'accès.** Un administrateur génère la clé et la clé entreprise [V s22 ; S s13]. La clé expire après 365 jours, Flatchr alerte 15 jours avant, le client la recrée à la main [V s22]. Flatchr demande de « valider l'adéquation » avec son interlocuteur avant toute mise en place [V s22]. Accès à l'API selon la formule du client : non documenté [?].

### 2.3 Taleez

- **Pourquoi.** L'autre ATS français des PME et ETI, fort en régions et chez les associations : plus de 700 clients [V extrait s52], relié à Lucca, Eurécia, ADP [S s52].
- **Voie.** Kombo [V s1 ; S s2].
- **Marche dès le départ.** Postes [S s23]. Envoi complet : candidature, CV en PDF, source (`initialReferrer`), recruteur, identifiants renvoyés [S s23]. Recherche par e-mail [S s23].
- **Ne marche pas, ou pas encore.** Aucune liste des étapes d'un poste : seulement le nom de l'étape courante et un indicateur `rejected` [S s23]. Pas de motif de refus, pas d'embauche explicite [S s23]. Pas de changement d'étape [S s23 ; S s2]. Candidatures lues candidat par candidat [S s23]. Webhooks : événements inconnus, et une création par l'API ne déclenche ni webhook ni automatisme [S s23]. Pièces jointes en PDF seulement [S s23].
- **Obstacle d'accès.** Aucun connu. Le client génère une clé secrète [S s23 ; S s13]. La spécification lue est une copie non datée (0.4.0) : à confirmer auprès de Taleez [S s23].

### 2.4 Ashby

- **Pourquoi.** L'ATS des scale-ups tech françaises les plus en vue : Alan, Pennylane, Mistral AI, Finary [V extraits s53].
- **Voie.** Kombo [V s1 ; S s2]. Direct simple plus tard : l'API la plus régulière du lot [S s32].
- **Marche dès le départ.** Postes, annonces, équipe de recrutement ; candidatures avec CV ; recherche par e-mail ou nom (100 résultats au plus) ; plan d'entretien par poste ; envoi directement dans l'étape choisie, e-mail facultatif ; webhooks d'étape, d'embauche et de mise à jour, que Konekt crée lui-même si le client coche le droit « API Keys » en écriture [S s32].
- **Ne marche pas, ou pas encore.** Pas de recherche par LinkedIn [S s32]. L'API ne crée pas de source : le client doit en préparer une [S s32]. Erreurs rendues en HTTP 200 avec `success: false` [S s32]. Débit non publié, partagé entre les intégrations du client [S s32]. Relances des webhooks non documentées [?].
- **Obstacle d'accès.** Aucun. Un administrateur crée la clé, droits choisis par module [S s32]. Bac à sable réservé aux partenaires acceptés [S s32].

### 2.5 Lever

- **Pourquoi.** Le choix des scale-ups françaises installées : Qonto, Contentsquare, Younited, Theodo, Jacquemus [V extraits s54].
- **Voie.** Kombo [V s4].
- **Marche dès le départ.** Annonces, candidats, CV, étapes, notes [V s30]. Webhooks créés par l'API (`candidateStageChange`, `candidateHired`) [V s30]. Refus : archivage avec motif [V s30]. Bac à sable officiel [V s30]. Kombo cite création, étape, refus, note, pièce jointe [S s2].
- **Ne marche pas, ou pas encore.** Pas de recherche par nom ; filtre par e-mail non vérifié [S s31 ; ?]. Étapes du compte ou du poste : non tranché [?]. Instance mondiale ou européenne à retenir par client [V s30] ; adresse de l'API européenne non vérifiée [?].
- **Obstacle d'accès.** En direct, l'OAuth exige une application enregistrée chez Lever [V s30]. Airbyte la dit réservée aux partenaires [S s31] ; Nango laisse ce point inconnu [S s31]. La clé d'API est destinée aux flux internes [S s31]. Par Kombo : OAuth avec les identifiants partenaires de Kombo par défaut, que Konekt peut remplacer par les siens [V s4] ; un administrateur Lever se connecte [S s14]. Que Konekt n'ait pas à entrer dans le programme de Lever est une déduction, non confirmée par Lever [?].

### 2.6 Greenhouse

- **Pourquoi.** Les entreprises internationales qui recrutent à Paris, et des françaises : Dataiku, Algolia, Decathlon Digital ; premier ATS des rapports G2 pour l'EMEA [V extraits s55].
- **Voie.** Kombo, variante `greenhousev3` [V s1].
- **Marche dès le départ.** Tout, en lecture comme en écriture, d'après la version 1 lue : postes avec équipe de recrutement, étapes par poste, candidatures, CV, envoi avec source, référent et étape de départ, notes, déplacement et refus avec motif [V s27]. Webhooks riches et signés, dont le refus avec motif et l'embauche, relancés 7 fois sur 15 heures [V s28]. Kombo cite création, étape, refus, note, pièce jointe [S s2].
- **Ne marche pas, ou pas encore.** Webhooks posés à la main par le client : aucun appel ne les crée en version 1 [V s28]. Recherche par e-mail seulement [V s27]. La source doit exister chez le client [V s27]. Champs personnalisés de candidature réservés aux comptes Enterprise [V s27]. Documentation de la version 3 non lue [?].
- **Obstacle d'accès.** Harvest v1 et v2 : retrait annoncé pour le 31/08/2026, toujours écrit au futur sur la page republiée le 10/09/2026 ; extinction effective non vérifiée [V s27 ; ?]. Tout connecteur doit être en v3. En direct, trois voies :
  - identifiant « Harvest V3 (OAuth) » créé par le client avec le partenaire « Custom » [S s29] ; Greenhouse prévient que les « Unlisted vendors » peuvent avoir un débit réduit [V s27] ; droit d'usage par un éditeur tiers inconnu [?] ;
  - OAuth partenaire : accord de partenariat signé [S s29] ;
  - Ingestion API, faite pour les outils de sourcing : réservée aux « sourcing partners », enregistrement auprès de l'équipe Partnerships, sans libre-service [V s28] ; accord signé [S s29].

### 2.7 Recruitee

- **Pourquoi.** L'ATS européen des entreprises de 50 à 1 000 salariés ; la France serait l'un de ses trois marchés [V extrait s56 ; ?] ; « plus de 250 entreprises en France » [S s56].
- **Voie.** Kombo [V s1 ; S s2].
- **Marche dès le départ.** Postes, candidatures groupées par étape, CV, recherche par e-mail, nom et plein texte, une seule fiche par personne avec toutes ses candidatures, envoi avec source nommée et note, webhook de changement d'étape, changement d'étape [S s25]. Kombo cite création, note, pièce jointe, étape, refus [S s2].
- **Ne marche pas, ou pas encore.** Dépôt du CV par une voie non documentée, en direct [S s25]. Une candidature créée arrive dans « Applied » : il faut la placer en « Sourced » [S s25]. Webhook d'étape posé à la main ; refus et embauche par relecture [S s25]. Débit inconnu [?]. La recherche avancée ignore sans erreur un filtre inconnu et renvoie alors toute la base [S s25]. Aucune page officielle lue.
- **Obstacle d'accès.** Jeton personnel, avec tous les droits de son auteur ; Konekt écrit au nom de cette personne ; la connexion tombe si elle part [S s25].

### 2.8 Workable

- **Pourquoi.** Très répandu chez les petites structures internationales : 35 000 entreprises dans le monde, et l'un des quatre ATS que Welcome to the Jungle a intégrés en profondeur [V extraits s57]. Peu d'indices de clients français [?].
- **Voie.** Kombo [V s1 ; S s2], ou direct : l'accès est ouvert au client [S s26].
- **Marche dès le départ.** D'après des réponses réelles enregistrées le 23/07/2026 [S s26] : postes avec description, contrat et salaire ; candidatures avec CV ; étapes par poste ; envoi en « Sourced » sans e-mail au candidat ; webhooks créés par Konekt ; motifs de refus, date d'embauche ; déplacement et refus.
- **Ne marche pas, ou pas encore.** E-mail exigé à l'envoi [S s26]. Un enregistrement candidat par poste : la personne se reconstruit par l'e-mail [S s26]. Pas de recherche par nom ni par LinkedIn ; le lien LinkedIn n'est que dans le détail [S s26]. Source « Konekt » non confirmée [?]. Débit de 10 requêtes par 10 secondes [S s26]. Webhook dédié au refus non vu [?].
- **Obstacle d'accès.** Aucun. Un administrateur crée un jeton à portées choisies, qui expire à la date qu'il fixe [S s26].

### 2.9 Welcome to the Jungle (sous condition)

- **Pourquoi.** La vitrine de l'écosystème startup français, avec son propre ATS. 4 500 ou 5 500 clients de la plateforme ; la part qui utilise l'ATS est inconnue [V extraits s50 ; ?].
- **Voie.** Kombo, sur pilote, après un accord écrit de l'éditeur.
- **Marche dès le départ, une fois le jeton obtenu.** Postes avec description, contrat, salaire, télétravail [V archive s19]. Étapes du poste [V archive s19]. Envoi d'un candidat sur un poste, avec CV (5 Mo), note et étape de départ [V archive s19].
- **Ne marche pas, ou pas encore.**
  - Cinq champs obligatoires à l'envoi : référence d'organisation, référence du poste, e-mail, prénom, nom [V archive s19]. Page de 2019, dépôt archivé le 20/06/2022 ; même point d'entrée et mêmes droits dans la documentation actuelle, lue par un tiers le 04/09/2026 [S s20]. Champs obligatoires actuels non lus [?].
  - Aucun webhook dans la documentation publique [S s20]. La demande de 2022 est restée sans réponse dans un dépôt archivé [V s21]. Un mécanisme interne d'envoi existe (objet `EventService` dans le schéma GraphQL), sans moyen public de le créer [S s20]. Les webhooks annoncés par Unified.to n'ont pas été vérifiés [? s11]. Donc : relecture, avec des filtres de date au jour près [V archive s19].
  - Motif de refus : aucun champ documenté [V archive s19 ; ?]. Lister les candidats exige un poste : pas de recherche globale en direct [V archive s19]. Par Kombo, lecture du CV seul [S s5]. Kombo n'a pas d'accès direct à cette API [V s4].
  - Le nouvel ATS « Welcome ATS » : rien de lu ne dit que cette API le couvre [? s20].
- **Obstacle d'accès.** Pas de libre-service, connecteur compris. Le client demande à Welcome to the Jungle un jeton avec la liste des droits voulus, et fournit sa « référence d'organisation » [V archive s19 ; S s20 ; S s12]. Même démarche par Kombo selon Juicebox [S s12] ; le guide de Kombo n'a pas été lu [?].
  - Offres éligibles : Pro+ et Master, citées par le guide de Kombo d'après Juicebox, à confirmer avec le chargé de compte [S s12]. Aucune source officielle ne réserve l'API à ces offres [?].
  - Droits à demander : `candidates_rw` pour lire tout le vivier ; `my_candidates_rw` ne voit que les candidats créés par le jeton, ce qui interdit C2 et C3 [V archive s19]. Il faudrait aussi `jobs_r`, `comments_w`, `documents_rw` pour le poste, la note et la pièce jointe (déduction) [?]. Les droits `su_*` sont réservés à un partenariat, a priori inutiles [S s20 ; ?].
  - Aucune limite de débit publiée [S s20].

### 2.10 Bullhorn (cabinets, après une étude courte)

- **Pourquoi.** Le seul CRM de cabinet à fort volume : plus de 10 000 cabinets dans le monde, un site et une offre en français [V extraits s58]. Pour un cabinet, c'est la source de son vivier (C3) et la destination de ses présentations.
- **Voie.** Kombo, ou Merge, qui le couvrent tous deux [S s43]. Trois variantes chez Kombo : `bullhorn`, `bullhornlogin`, `bullhorn4salesforce` [V s1].
- **Marche dès le départ.** Lu pour cette réponse dans la documentation officielle (source sur GitHub, dernier changement le 25/06/2026) [V s45] :
  - un modèle de cabinet natif : `JobSubmission`, « présentation formelle d'un candidat sur un poste », avec `source` et `status` ;
  - un champ `source` sur le candidat, aux valeurs configurables ;
  - une file d'événements créée par l'API (`PUT /event/subscription`, sur les candidats et les autres objets), que Konekt relit ;
  - par Kombo : création, étape, note, pièce jointe citées [S s2].
- **Ne marche pas, ou pas encore.** La file d'événements se relit : rien n'est poussé vers Konekt [V s45]. Débit : en cas de 429, attendre une seconde et relancer [V s45] ; plafond non publié [?]. Étapes, recherche, droits : non étudiés [?].
- **Obstacle d'accès.** En production, connexion par OAuth seulement : « the only supported login process in a production environment » [V s45]. En direct, il faut donc un identifiant d'application délivré par Bullhorn ; la procédure n'est pas dans le dépôt [?]. Par un connecteur, un administrateur Bullhorn se connecte [S s14].

### 2.11 SmartRecruiters (sur demande)

- **Pourquoi.** ETI internationales et grands comptes : 4 000 organisations, racheté par SAP le 11/09/2025 [V extraits s59] ; Decathlon cité [S s59].
- **Voie.** Kombo, qui accepte l'OAuth ou les identifiants du client [S s4].
- **Marche dès le départ.** D'après une spécification de 2023 : postes, candidatures, envoi, changement d'étape ; 9 statuts fixes, donc une correspondance préremplie ; webhooks créés par l'API et signés [S s33 ; V s33].
- **Ne marche pas, ou pas encore.** E-mail obligatoire à l'envoi [S s33]. Ajouter à un poste un candidat existant : non documenté [?]. Débit : 10 requêtes par seconde et une seule lecture simultanée des candidats, d'après une fiche non vérifiée [? s33].
- **Obstacle d'accès.** Qui peut créer la clé chez le client, et si l'OAuth est ouvert à tout éditeur : inconnu [?].

### 2.12 Factorial (sur demande)

- **Pourquoi.** SIRH avec ATS intégré : 13 000 entreprises, la France est son deuxième marché [S s60].
- **Voie.** Direct ou Kombo. L'API officielle est la plus propre du lot ; effort petit en direct [V s35].
- **Marche dès le départ.** Postes (sans recruteur), candidatures avec CV, recherche par e-mail, étapes par poste avec un type normalisé, webhooks créés par Konekt et relancés 20 fois en 48 heures, changement d'étape [V s35].
- **Ne marche pas, ou pas encore.** **Aucun CV ne part à l'envoi**, dans aucune version (2026-04-01, 2026-07-01, bêta 2026-10-01 publiée le 24/09/2026) [V s35]. Par Kombo, l'envoi du CV n'est pas démontré [?]. Si le poste exige un CV (`cv_requirement` à `mandatory`), le comportement de l'API est inconnu [?]. Palliatif : un lien vers la fiche Konekt dans une note ou la lettre ; jamais `ats/messages`, qui écrit au candidat [V s35].
- **Obstacle d'accès.** Aucun. Clé ou OAuth créés par le client [V s35].

### 2.13 Pas au lancement

| Outil | Pourquoi pas | Sources |
|---|---|---|
| Personio | Lecture par une API v2 en bêta ; envoi seulement sur un poste publié, e-mail obligatoire, sans note ; aucun webhook de recrutement trouvé | [V s34 ; S s34] |
| BambooHR | Pas de description de poste ni d'étapes par poste en lecture, aucun webhook ATS | [V s36] |
| Workday, SAP SuccessFactors | Grands comptes ; connexion lourde faite par l'administrateur du client | [S s40 s41] |
| Cegid Talentsoft | Kombo en bêta ouverte, « sans relation ni affiliation » avec Cegid | [S s7 s42] |
| DigitalRecruiters | Kombo en bêta fermée ; accès en direct par le support Cegid, avec le mot de passe d'un utilisateur | [S s7 s37] |
| Recruit CRM | Cabinets ; lecture et notes par Kombo, création non établie | [S s2 s43 ; ?] |
| Jobaffinity, Werecruit, Beetween, Buddi by hellowork | Aucune voie documentée ; absents de Kombo | [V s1 ; S s24 s38 s39 ; ? s44] |
| Jarvi, Leonar, HireSweet | Concurrents directs de Konekt | [S s49] |

---

## 3. La voie recommandée

### 3.1 Recommandation : Kombo pour les douze, avec un repli direct pour Flatchr

**Pourquoi Kombo.**
- Les douze outils sont dans sa liste officielle d'outils (SDK 1.3.8 du 23/09/2026) [V s1]. Cette liste prouve la présence d'un outil, pas sa couverture fonction par fonction [V s8].
- Écran de connexion en français, lien intégré valable 1 heure ou lien magique valable 1 an [V s1]. Merge ne propose que l'anglais et l'allemand [V s10].
- Région UE par défaut [V s47].
- La meilleure couverture des ATS français : Teamtailor, Welcome to the Jungle, Flatchr, Taleez, Talentsoft en bêta ouverte, DigitalRecruiters en bêta fermée [V s1 ; S s7].
- Lever passe par ses identifiants partenaires [V s4].
- Kombo garde une copie filtrable par e-mail et nom [V s3], ce qui aide C3 au départ.
- Issue normalisée de la candidature : `PENDING`, `HIRED`, `DECLINED`, avec motif et date du refus [V s3]. Utile à la fenêtre d'honoraires (CF-I15). Merge n'a pas de champ « embauché » [V s9].
- Appel direct à l'API de l'éditeur pour 215 API, quand le modèle commun ne suffit pas [V s4].

**Ses limites.**
- Prix non public [S s46].
- Couverture réelle par outil lisible seulement avec une clé d'API (`GET /tools/ats`), et seulement pour les outils activés dans l'environnement [V s8]. Seul le statut `SUPPORTED` vaut « oui » ; `NOT_IMPLEMENTED` et `UNKNOWN` valent « non promis » [V s8].
- Synchronisation périodique. Le SDK ne publie pas l'intervalle [V s6]. 3 heures par défaut, 24 heures si les webhooks de l'ATS sont actifs, d'après une page non relue [S s6]. Fréquence plus élevée sur l'offre Scale [S s46].

**Hébergement et RGPD.**
- Kombo Technologies GmbH, en Allemagne ; accord de sous-traitance du 01/04/2026 [S s47].
- Données de la région UE chez Google Cloud ; pays exacts non tranchés (Pays-Bas, Irlande, Allemagne cités) [S s47 ; ?]. ISO 27001 et SOC 2 Type II [S s47].
- Kombo stocke une copie des données de l'ATS [V s3]. C'est un sous-traitant de plus, à déclarer sur `/privacy` et dans le DPA de Konekt.
- Un réglage limite la copie aux candidatures créées par Konekt [V s3]. Il supprime alors « Dans votre ATS » (décision D8).
- L'index de Konekt reste dans sa propre base, hébergée en Irlande (projet konekt-production, CLAUDE.md).

**Repli direct pour Flatchr.** Si la matrice de Kombo ne donne pas l'envoi avec CV sur Flatchr en `SUPPORTED`, passer en direct pour ce seul outil. L'API officielle est publique et tout le parcours y passe [V s22].

**Connecteurs directs plus tard, seulement si un outil domine les demandes.** Teamtailor (programme partenaire, carte « résultat ») [V s18] ; Ashby (API régulière) [S s32] ; Greenhouse par l'Ingestion API, si un accord est signé [V s28].

### 3.2 Les autres voies, comparées

| | Kombo | Merge | Unified.to | Connecteurs directs |
|---|---|---|---|---|
| Couvre les douze | Oui, présence [V s1] ; couverture à lire [V s8] | Onze trouvés ; Factorial ATS non trouvé [S s9 ; ?] | Flatchr non trouvé [?] ; WTTJ par WelcomeKit [S s11] | Un par un |
| Écran de connexion en français | Oui [V s1] | Non (anglais, allemand) [V s10] | ? | À construire |
| Copie des données | Oui [V s3] | Oui ; UE à Stockholm [S s48] | Non [S s11] | Non |
| Fraîcheur | 3 h par défaut [S s6] | 24 h par défaut, jusqu'à 5 min sur les offres supérieures [V s10] | Direct ; webhooks virtuels [S s11] | Selon l'ATS |
| Embauche normalisée | `HIRED` [V s3] | À déduire de l'étape [V s9] | `hired_at` [V s11] | Selon l'ATS |
| Accès Lever sans programme | Oui [V s4] | ? | ? | Non |
| Prix | Non public [S s46] | Public [S s46] | Public [S s46] | Temps de développement |

### 3.3 Effort de construction côté Konekt

Tailles de la synthèse : P petit, M moyen, G grand.

| Chantier | Voie Kombo | Voie directe |
|---|---|---|
| Socle lecture I6a : connexions et secrets chiffrés, `external_refs` (S5), index `external_people`, relecture périodique et webhooks entrants, création depuis un poste, correspondance des étapes par poste, catalogue et « Dites-le-nous » | G | G, plus l'authentification de chaque outil |
| Socle écriture I6b : envoi idempotent, dédoublonnage par e-mail, CV en PDF, source et auteur, lecture des avertissements, étape, refus et embauche lus | G | G |
| Par outil : recette, guide de connexion, réglages (source, étape d'arrivée, e-mail) | P chacun, soit 12 P | M chacun (Ashby, Workable et Factorial plus près de P en lecture) ; Greenhouse G par la voie partenaire ; Bullhorn G probable [?] |
| Démarches partenaires | Aucune au lancement | Lever, Greenhouse, sans doute Bullhorn [V s30 s28 s45 ; S s29 s31] |
| Entretien | Porté par le connecteur | Un connecteur par outil, à suivre à chaque version (exemple : Greenhouse v1 vers v3 [V s27]) |
| Repli Flatchr direct, si besoin | M | (compris) |

En résumé : **G + G + 12 P par Kombo, contre G + G + une douzaine de M et des accords par la voie directe.**

### 3.4 Coût mensuel estimé du connecteur

| Clients reliés | Kombo | Merge, offre Launch | Unified.to | Direct |
|---|---|---|---|---|
| 10 | **À obtenir** | 650 $ | 750 $ (Grow) | 0 $ de connecteur |
| 50 | **À obtenir** | 3 250 $ | 750 $ (Grow) | 0 $ |
| 200 | **À obtenir** | 13 000 $ au tarif public ; contrat Professional probable [?] | 1 250 $ à 1 500 $ selon la source [?] | 0 $ |

- **Kombo** : forfait annuel de plateforme, plus un prix mensuel par client connecté ; intégrations inactives non facturées ; offre « Start » pour les jeunes sociétés ; preuve de concept gratuite annoncée [S s46]. Montants : à demander à l'équipe commerciale de Kombo (page tarifs), pour 10, 50 et 200 clients.
- **Merge** : 650 $ par mois jusqu'à 10 comptes reliés de production, puis 65 $ par compte ; relevé du 20/09/2026 [S s46]. Calcul : 650 + 40 × 65 = 3 250 $ ; 650 + 190 × 65 = 13 000 $. Que l'offre Launch accepte 200 comptes : [?].
- **Unified.to** : 750 $ par mois pour 750 000 appels, connexions illimitées [S s46]. L'offre suivante est donnée à 1 250 $ pour 1,25 million d'appels dans une copie, à 1 500 $ pour 2 millions dans un extrait [S s46 ; ?].
  - Estimation Konekt, hypothèses à vérifier : une relecture par heure et par client (environ 5 appels), plus 500 appels de recherche et d'envoi par mois, soit 4 000 à 5 000 appels par client et par mois.
  - 10 et 50 clients restent sous 750 000 appels ; 200 clients les dépassent (environ 1 million).
  - Unified.to ne garde pas de copie : Konekt doit tenir son index quand même [S s11].
- **Direct** : aucun frais de connecteur ; frais des programmes partenaires inconnus [?]. Le vrai coût est le développement et l'entretien (section 3.3).

---

## 4. Ce que la conception doit changer pour coller aux API

### 4.1 Fraîcheur et relecture

- **Remplacer « à jour il y a 2 h » par la date réelle de la dernière lecture** : « Teamtailor, lu il y a 3 h ». Chez Kombo, le webhook `sync-finished` donne cette date [V s6] ; chez Merge, `last_sync` et `next_sync_start` [V s10].
- **Toujours une relecture périodique, même avec des webhooks.** Teamtailor ne relance aucun envoi depuis le 19/03/2026 [V s17]. Merge ne fait que deux reprises, seulement sur erreur serveur [V s10]. Les relances d'Ashby sont inconnues [?]. Après un `data-changed` de Kombo, relire avec `updated_after` [V s6]. Accepter les doublons : la page « Best practices » de Teamtailor en prévoit [V s17].
- **Relecture seule** pour Welcome to the Jungle (au jour près [V archive s19]) et Taleez [S s23]. Le bouton « Synchroniser » appelle `triggerSync`, jamais en boucle [V s6].

### 4.2 « Dans votre ATS » (C3)

- L'index `external_people` est obligatoire : aucun ATS ne cherche par LinkedIn [V s3].
- Ordre de rapprochement : e-mail d'abord ; puis adresse LinkedIn normalisée, lue dans les réseaux sociaux du candidat (Kombo `social_media`) [V s3] ; le nom seul ne donne qu'une suggestion : « Peut-être dans Teamtailor : même nom, autre adresse. Vérifier. »
- Pendant le premier remplissage : « Lecture de votre vivier Teamtailor en cours : 4 200 personnes sur 12 000 », jamais un faux « absent ».
- Workable : proposer d'abord l'e-mail, le lien LinkedIn coûtant un appel par candidat [S s26].

### 4.3 Correspondance des étapes (C4)

- **Par poste**, donc par mission : Teamtailor, Greenhouse, Workable, Ashby, Welcome to the Jungle [V archive s15 ; V s27 ; S s26 ; S s32 ; V archive s19].
- **Préremplie** quand l'outil a des statuts fixes (SmartRecruiters) ou un type d'étape (Factorial, Teamtailor « Hired ») [S s33 ; V s35 ; V archive s15].
- **Impossible chez Taleez** : afficher seulement l'étape lue, « Entretien manager (Taleez) », sans correspondance ni passage automatique en « Embauché » [S s23].

### 4.4 « Envoyer dans l'ATS » (C5)

- **E-mail.** Obligatoire chez Welcome to the Jungle et Workable [V archive s19 ; S s26], et chez SmartRecruiters [S s33]. Facultatif chez Teamtailor (candidat sourcé), Greenhouse, Ashby, Recruitee, Lever [V archive s15 ; V s27 ; S s32 ; S s25 ; S s31]. Mais tous dédoublonnent par l'e-mail : voir la décision D3. Texte : « Envoyer dans Workable » grisé, « Ajoutez son adresse e-mail d'abord », avec un lien vers la recherche de coordonnées.
- **CV.**
  - Flatchr l'exige [V s22] ; Taleez n'accepte que le PDF [S s23]. Un profil LinkedIn n'a souvent pas de CV : Konekt produit un PDF du profil (décision D4). Texte : « Flatchr demande un CV : le PDF de son profil Konekt sera joint. »
  - Teamtailor et Welcome to the Jungle prennent le CV par une adresse publique [V archive s15 ; V archive s19] : Konekt expose une adresse signée de courte durée.
  - Factorial ne reçoit aucun CV [V s35]. Texte : « Factorial ne reçoit pas de CV par ce canal : le lien vers sa fiche Konekt est ajouté en note. »
- **Étape d'arrivée.** Placer l'étape au moment de l'envoi fait partie de l'envoi : ce n'est pas une réécriture, et cela reste compatible avec « l'ATS fait foi après l'envoi ».
  - Ashby dépose dans l'étape choisie [S s32].
  - Teamtailor dépose dans « Inbox » [V archive s15 ; ?].
  - Workable dépose dans « Sourced » [S s26].
  - Recruitee dépose dans « Applied », qu'il faut corriger en « Sourced », sinon la candidature compte comme reçue [S s25].
  - Réglage par mission, prérempli à la première étape de sourcing (décision D5).
- **Source et agence d'origine.** Aucun objet « agence » générique, sauf chez Bullhorn (`JobSubmission`) [V s45] et Workday (soumission d'agence, hors liste) [S s40].
  - Source à choisir parmi celles du client : Ashby [S s32], Greenhouse [V s27], Flatchr `source_id` [V s22].
  - Texte libre : Lever [S s31], Recruitee [S s25], Taleez [S s23].
  - Chez Kombo, le champ `source` est déprécié au profit d'une écriture automatique de la source, à régler dans la plupart des ATS ; `sourced_by` désigne un utilisateur de l'ATS [V s3].
  - L'écran de connexion demande donc : « Sous quelle source ranger les candidats envoyés par Konekt ? », avec la liste lue dans l'ATS. Pour un cabinet partenaire : sa source si elle existe, sinon une note (déjà prévu en conception, section 2.12).
- **Auteur visible dans l'ATS.** Recruitee écrit au nom du propriétaire du jeton [S s25], Workable au nom d'un `member_id` [S s26], Lever `perform_as` [V s30], Greenhouse `On-Behalf-Of` [V s27], Kombo `on_behalf_of_user_remote_id` [V s3]. Règle proposée : le membre de l'ATS qui a le même e-mail que l'utilisateur Konekt, sinon le compte de connexion.
- **Identifiant externe (S5).**
  - Flatchr ne renvoie pas d'identifiant : état « envoyé, identifiant en attente », puis rapprochement par webhook ou recherche [V s22].
  - SmartRecruiters désigne une candidature par le couple candidat et poste [S s33].
  - Workable : le « candidat » est déjà une candidature [S s26]. Recruitee : personne et candidature séparées [S s25].
  - `external_refs` doit accepter un identifiant composé. `integration_connections` garde la région (Teamtailor), l'instance (Lever), la version d'API (Greenhouse v3) [V s18 ; V s30 ; V s27].
- **Réponse lue avant « Envoyé ».** Chez Merge, un champ exigé par l'ATS revient en avertissement, pas en erreur [V s10]. Ne jamais afficher « Envoyé dans Teamtailor » sans avoir lu la réponse.

### 4.5 Refus et embauche (C6)

- **Refus avec motif** : disponible chez Greenhouse (dans le webhook) [V s28], Lever (archivage) [V s30], Ashby [S s32], Workable [S s26], Flatchr (relecture) [V s22], Teamtailor (relecture du motif) [V archive s15]. Absent chez Taleez [S s23] et non documenté chez Welcome to the Jungle [V archive s19]. Texte pour ces deux-là : « Écarté dans Taleez. Taleez ne transmet pas le motif. »
- **Teamtailor** : ne rien annoncer au partenaire ni au candidat avant `transparent_recruiting_visible_at` [V s17]. Cela touche la carte « Un candidat de Vauban Conseil a été écarté dans Teamtailor : dites-le au partenaire » (synthèse, rang 5).
- **Embauche et fenêtre d'honoraires (CF-I15).** Ouverture automatique seulement si l'embauche est lue avec certitude : `HIRED` chez Kombo [V s3], webhooks d'embauche chez Greenhouse, Lever, Ashby [V s28 ; V s30 ; S s32], `hired_at` chez Workable et Recruitee [S s26 s25], colonne « embauche » chez Flatchr [V s22]. Chez Taleez et Welcome to the Jungle : action « Confirmer l'embauche » pour le responsable [S s23 ; ? s19].

### 4.6 Connexion (C8)

- **Welcome to the Jungle** : pas de « Relier » en un clic. Un parcours « Demander l'accès à Welcome to the Jungle », avec la liste des droits à demander et la référence d'organisation à fournir [V archive s19 ; S s12].
- **Clés qui expirent** : Flatchr à 365 jours [V s22], Workable à la date choisie [S s26]. Prévenir 15 jours avant, puis rang 0 « Reconnecter ». Texte : « La clé Flatchr expire le 12/10 : créez-en une nouvelle dans Flatchr, puis collez-la ici. »
- **Recruitee** : « Créez le jeton depuis le compte qui doit apparaître comme auteur dans Recruitee. Si ce compte est supprimé, la connexion s'arrête. » [S s25]
- **Webhooks à poser par le client** (Teamtailor, Greenhouse, Flatchr, Recruitee) [V s17 ; V s28 ; V s22 ; S s25] : une étape guidée « Collez cette adresse, puis le secret », ou la relecture seule si le client ne le fait pas.

### 4.7 Dire la vérité à l'écran quand une capacité manque

- Règle existante, à appliquer outil par outil : un élément n'apparaît que si sa source existe (conception, section 2.2).
- Le catalogue des Paramètres dit, pour chaque outil, ce qu'il permet. Exemple : « Avec Taleez : étapes lues par leur nom, sans motif de refus ni embauche. »
- Une capacité absente ne s'affiche jamais comme un zéro ou une liste vide : « Taleez ne signale pas l'embauche », pas « 0 embauche ».

### 4.8 Décision 23, texte proposé

« Par défaut : Kombo, jamais nommé à l'écran, en lecture d'abord, sur pilote. Premiers outils : Teamtailor ou Flatchr pour le pilote, puis la liste des douze. Welcome to the Jungle après accord écrit de l'éditeur. Un outil n'est proposé qu'après son statut `SUPPORTED` dans la matrice du connecteur et un test réussi. L'ATS fait foi après l'envoi ; l'étape d'arrivée se choisit à l'envoi. Autre choix : un connecteur direct pour un outil qui domine les demandes, ou pour Flatchr si le connecteur n'envoie pas le CV. »

---

## 5. Les démarches à lancer, dans l'ordre

1. **Kombo, semaine 1 : essai et clé de test.** Appeler `GET /tools/ats` et exporter la couverture des douze outils et de ceux « sur demande » [V s8]. Lire pour chacun les notes d'API payante et d'exigence partenaire (`paid_api_details_markdown`, `partner_only_details_markdown`) [V s8]. Demander l'activation des outils en bêta si besoin [V s8].
2. **Kombo, semaine 1 : devis et contrat.** Prix pour 10, 50 et 200 clients reliés ; offre Start ; fréquence de synchronisation par offre ; DPA et liste des sous-traitants ; région exacte ; durée de conservation ; option « ne synchroniser que les candidatures créées » [S s46 s47 ; V s3].
3. **Kombo : cinq questions précises.** Envoi avec CV vers Flatchr ; procédure de connexion de Welcome to the Jungle et offres éligibles ; lecture des candidats de tous les postes Welcome to the Jungle, archivés compris ; CV vers Factorial ; Bullhorn (variante, étapes, événements).
4. **En parallèle, si le devis Kombo pèse** : ouvrir un compte Merge (clé de test et comptes fictifs [V s10]), pour comparer sur le même pilote.
5. **Pilote** : une entreprise sous Teamtailor ou Flatchr, ou 5 « Dites-le-nous » pour un même outil (condition déjà posée pour I6a).
6. **Welcome to the Jungle** : écrire à l'éditeur. Un outil de sourcing tiers peut-il obtenir un jeton pour ses clients ? Quels droits, quelles offres, quel délai ? L'API couvre-t-elle « Welcome ATS » ? Existe-t-il des webhooks ou un programme partenaire ? [? s20]
7. **Flatchr** (support@flatchr.io) : API incluse dans toutes les formules ? Identifiant renvoyé à la création ? Webhooks signés ? Accès au compte de démonstration ? [V s22 ; ?]
8. **Bullhorn** : étude courte de la documentation publique (étapes, recherche, droits, procédure d'identifiant OAuth) et un cabinet pilote sous Bullhorn [V s45 ; ?].
9. **Recette par outil**, dans le bac à sable du connecteur puis chez le pilote : connexion ; postes ; mission depuis un poste ; candidatures et CV ; recherche par e-mail ; durée de l'indexation du vivier ; envoi avec CV, source et note ; envoi d'un profil sans CV et sans e-mail ; doublon ; étape lue ; refus avec motif ; embauche ; déconnexion et reconnexion ; expiration de clé ; suppression côté ATS.
10. **Juridique** : DPA avec le connecteur ; `/privacy` mis à jour (liste des sous-traitants, seule page où le nom est permis) ; lot R avant I6a, comme prévu.
11. **Plus tard, si un outil domine** : programme partenaire Teamtailor (techpartnerships@teamtailor.com) [V s18] ; accord Greenhouse pour l'Ingestion API (partners@greenhouse.io) [V s28].

---

## 6. Les risques

| Risque | Pourquoi | Parade |
|---|---|---|
| La couverture réelle de Kombo est plus mince que prévu | La colonne Kombo repose sur des extraits de pages, peut-être tronqués [S s2] ; la matrice officielle exige une clé [V s8] | Démarche 1 avant tout engagement ; ne promettre que `SUPPORTED` |
| Le prix par client relié dépasse ce que l'option ATS rapporte | Prix non public [S s46] | Devis avant I6a ; ATS réservé aux offres payantes (décision D11) |
| Welcome to the Jungle ferme ou limite l'accès | Jeton délivré par l'éditeur ; offres éligibles peut-être limitées [S s12] ; l'éditeur vend aussi du sourcing | Pilote seulement après accord écrit ; ne pas le mettre en avant au lancement |
| La promesse de fraîcheur est fausse | Synchronisation de 3 h [S s6] ou 24 h [V s10] ; webhooks sans relance [V s17] | Fraîcheur réelle affichée (4.1) |
| Greenhouse change encore d'API | v1 et v2 retirées au profit de la v3 [V s27] | Passer par le connecteur ; version gardée dans la connexion |
| Accès direct Lever ou Greenhouse refusé | Accords partenaires [V s30 s28 ; S s29 s31] | Rester sur le connecteur pour ces deux outils |
| Connexions qui tombent en silence | Clés Flatchr et Workable qui expirent [V s22 ; S s26] ; jeton Recruitee lié à une personne [S s25] | Rappel avant échéance, rang 0 « Reconnecter » |
| Premier remplissage de l'index trop long | Workable 10 requêtes par 10 s [S s26] ; Flatchr 1 CV par seconde [V s22] | Remplissage en tâche de fond, état « lecture en cours » |
| Données du vivier chez deux sous-traitants | Copie chez Kombo [V s3] ; clés qui lisent tout le vivier [V archive s15 ; S s25] | DPA, `/privacy`, secrets chiffrés, aucun appel de suppression exposé, purge de l'index au détachement |
| Surprises en direct | Plusieurs outils lus dans des archives ou des copies (Teamtailor 2021, Welcome to the Jungle 2019 à 2022, Taleez 0.4.0, SmartRecruiters 2023) [V archive s15 s19 ; S s23 s33] | Connecteur d'abord ; recette sur pilote |
| Dépendance au connecteur | Un seul fournisseur pour douze outils | Modèle propre à Konekt (`external_refs`, `external_people`) ; connecteur jamais nommé ; Merge testé en parallèle |
| Clients hors liste | Buddi by hellowork a le plus gros volume déclaré en France, sans accès technique connu [? s44] | « Dites-le-nous » pour mesurer ; écrire aux éditeurs |
| Konekt et l'ATS se contredisent | Deux outils qui écrivent l'étape | Règle déjà posée : l'ATS fait foi après l'envoi ; C7 non utilisé |

---

## 7. Les décisions pour le fondateur

| # | Décision | Choix par défaut | Autre choix |
|---|---|---|---|
| D1 | Voie technique | Kombo pour les douze, sous réserve du devis et de la matrice de couverture | Merge, à prix public, écran en anglais ; ou direct pour un seul outil dominant |
| D2 | Liste annoncée au lancement | Huit outils « disponibles » (Teamtailor, Flatchr, Taleez, Ashby, Lever, Greenhouse, Recruitee, Workable) après recette ; Welcome to the Jungle « sur demande d'accès » ; Bullhorn pour les cabinets après étude ; SmartRecruiters et Factorial sur demande | Annoncer les douze d'un coup, au risque de promettre des cas non testés |
| D3 | E-mail à l'envoi | Exigé partout : tous les ATS dédoublonnent par l'e-mail | Exigé seulement là où l'ATS l'impose |
| D4 | Profil sans CV | Joindre le CV s'il existe, sinon un PDF du profil Konekt ; chez Factorial, un lien en note | Envoyer sans CV quand l'ATS l'accepte, bloquer vers Flatchr |
| D5 | Étape d'arrivée | Première étape de sourcing du poste, réglable par mission dans Cadrage | Toujours l'étape de départ par défaut de l'ATS |
| D6 | Changer l'étape depuis Konekt (C7) | Non : décision 23 maintenue | Oui plus tard, outil par outil, si des clients le demandent |
| D7 | Fraîcheur | Date réelle de la dernière lecture ; relecture horaire des missions liées ; offre Start du connecteur | Offre supérieure si les clients exigent moins d'une heure |
| D8 | Index du vivier (C3) | Indexer tout le vivier de l'ATS du client (e-mail, nom, LinkedIn) dans `external_people`, purgé au détachement | N'indexer que les candidats envoyés : moins de données, plus de « Dans votre ATS » |
| D9 | Welcome to the Jungle | Pilote avec un client éligible, après confirmation écrite de l'éditeur | Hors lancement |
| D10 | Cabinets | Bullhorn après étude, avec un cabinet pilote ; Recruit CRM sur demande | Attendre 3 « Dites-le-nous » de cabinets |
| D11 | Offre commerciale | ATS réservé aux offres payantes, pour que chaque client relié couvre son coût de connecteur | Inclus partout, coût absorbé |
| D12 | Programmes partenaires | Aucun au lancement ; Teamtailor quand 5 clients l'utilisent | Candidature Teamtailor tout de suite, pour la visibilité dans sa place de marché |

---

## Sources

Toutes lues le 25/09/2026, sauf mention. « Non lue » : page citée mais bloquée par le proxy.

| N° | Source | Marque |
|---|---|---|
| s1 | Kombo, SDK officiel 1.3.8 (publié le 23/09/2026), liste des outils (`IntegrationTool`), langues et durée du lien : https://github.com/kombohq/typescript-sdk/blob/v1.3.8/src/models/postconnectcreatelinkrequestbody.ts ; archive npm : https://registry.npmjs.org/@kombo-api/sdk/-/sdk-1.3.8.tgz ; métadonnées : https://registry.npmjs.org/@kombo-api%2fsdk | [V] |
| s2 | Kombo, pages d'endpoint (listes « disponible pour les intégrations suivantes », extraits peut-être tronqués) : https://docs.kombo.dev/ats/v1/post-candidates ; https://docs.kombo.dev/ats/v1/post-jobs-job-id-applications ; https://docs.kombo.dev/ats/v1/put-applications-application-id-stage ; https://docs.kombo.dev/ats/v1/post-applications-application-id-notes ; https://docs.kombo.dev/ats/v1/post-applications-application-id-reject ; https://docs.kombo.dev/ats/v1/post-candidates-candidate-id-attachments | [S] |
| s3 | Kombo, modèles, filtres et écriture : https://github.com/kombohq/typescript-sdk/blob/v1.3.8/src/models/getatsjobspositiveresponse.ts ; https://github.com/kombohq/typescript-sdk/blob/v1.3.8/src/models/getatsapplicationspositiveresponse.ts ; https://github.com/kombohq/typescript-sdk/blob/v1.3.8/src/models/operations/getatscandidates.ts ; https://github.com/kombohq/typescript-sdk/blob/v1.3.8/src/funcs/atsCreateApplication.ts ; https://github.com/kombohq/typescript-sdk/blob/v1.3.8/src/funcs/atsCreateCandidate.ts ; https://github.com/kombohq/typescript-sdk/blob/v1.3.8/src/models/postatsjobsjobidapplicationsrequestbody.ts ; https://github.com/kombohq/typescript-sdk/blob/v1.3.8/src/funcs/atsImportTrackedApplication.ts | [V] |
| s4 | Kombo, appels directs aux API des éditeurs (Lever : « this uses Kombo's partner credentials by default », l. 157 ; Flatchr `flatchr/api` et `flatchr/career` ; aucune ligne Welcome to the Jungle) : https://github.com/kombohq/typescript-sdk/blob/v1.3.8/src/funcs/generalSendPassthroughRequest.ts ; https://github.com/kombohq/typescript-sdk/blob/v1.3.8/src/sdk/general.ts | [V] |
| s5 | Kombo, page Welcome to the Jungle (« seul le CV du candidat peut être lu ») : https://www.kombo.dev/integrations/welcometothejungle | [S] |
| s6 | Kombo, synchronisation : « Kombo already performs periodic syncs », `triggerSync` : https://github.com/kombohq/typescript-sdk/blob/main/docs/sdks/general/README.md [V] ; webhooks `data-changed`, `sync-finished` : https://github.com/kombohq/typescript-sdk/blob/v1.3.8/src/models/datachangedwebhookpayload.ts [V] ; 3 h ou 24 h : https://docs.kombo.dev/ats/guides/upstream-webhooks [S, non relue] | [V] [S] |
| s7 | Kombo, bêtas : https://docs.kombo.dev/ats/connectors/digitalrecruiters (fermée) ; https://docs.kombo.dev/ats/connectors/talentsoft (ouverte) | [S] |
| s8 | Kombo, matrice de couverture derrière une clé (commit 598f469 du 23/09/2026) : https://github.com/kombohq/typescript-sdk/blob/598f469bf94c3c171ebf370b2d36b32f4372fd45/src/funcs/generalGetTools.ts ; https://github.com/kombohq/typescript-sdk/blob/598f469bf94c3c171ebf370b2d36b32f4372fd45/src/lib/security.ts ; https://github.com/kombohq/typescript-sdk/blob/598f469bf94c3c171ebf370b2d36b32f4372fd45/docs/models/gettoolscategorypositiveresponsetool.md ; https://github.com/kombohq/typescript-sdk/blob/598f469bf94c3c171ebf370b2d36b32f4372fd45/docs/models/gettoolscategorypositiveresponsewriteactioncoveragestatus.md ; https://github.com/kombohq/typescript-sdk/blob/598f469bf94c3c171ebf370b2d36b32f4372fd45/src/models/getintegrationsintegrationidpositiveresponse.ts | [V] |
| s9 | Merge, SDK 4.0.4 (24/07/2026), référence et modèle de candidature sans champ « embauché » : https://app.unpkg.com/@mergeapi/merge-node-client@4.0.4/files/reference.md ; https://app.unpkg.com/@mergeapi/merge-node-client@4.0.4/files/api/resources/ats/types/Application.d.ts [V] ; liste des intégrations : https://docs.merge.dev/merge-unified/ats/integrations/overview [S] | [V] [S] |
| s10 | Merge, dépôt officiel de consignes : fréquence « Daily » par défaut, réglée par le forfait (commit du 17/09/2026) : https://github.com/merge-api/merge-unified-skills/blob/main/skills/onboarding/SKILL.md ; jusqu'à 5 min sur les offres supérieures (commit du 04/09/2026) : https://github.com/merge-api/merge-unified-skills/blob/main/skills/implementing-link/references/platform-overview.md ; `next_sync_start` : https://github.com/merge-api/merge-unified-skills/blob/main/skills/post-connection-surface-sync-status/SKILL.md ; deux reprises seulement sur erreur serveur : https://github.com/merge-api/merge-unified-skills/blob/main/skills/sync-implement-webhooks/SKILL.md ; langues du lien (en, de) : https://app.unpkg.com/@mergeapi/merge-node-client@4.0.4/files/api/resources/ats/resources/linkToken/client/requests/EndUserDetailsRequest.d.ts | [V] |
| s11 | Unified.to : Welcome to the Jungle https://unified.to/integrations/jungle et https://unified.to/blog/correct_welcomekit_scopes_for_jungle_integration [S, extraits] ; billet de juin 2026, non lu : https://unified.to/blog/june_2026_product_update ; miroir sans mention de Welcome to the Jungle : https://raw.githubusercontent.com/api-evangelist/unified-to/HEAD/blogs/2026-06-30-june-2026-product-update.md [S] ; sans stockage : https://unified.to/gdpr [S] ; webhooks virtuels : https://docs.unified.to/concepts/virtual_webhooks [S] ; modèle de candidature avec `hired_at`, SDK 2.85.49 (21/09/2026) : https://app.unpkg.com/@unified-api/typescript-sdk@2.85.49/files/src/sdk/models/shared/atsapplication.ts [V] | [V] [S] [?] |
| s12 | Juicebox, guide Welcome to the Jungle (ajouté le 08/09/2026) : https://github.com/juiceboxwork/mintlify-docs/blob/main/help/ats-setup/welcome-to-the-jungle.mdx ; historique : https://github.com/juiceboxwork/mintlify-docs/commits/main/help/ats-setup/welcome-to-the-jungle.mdx | [S] |
| s13 | Juicebox, guides Flatchr et Taleez (08/09/2026) : https://github.com/juiceboxwork/mintlify-docs/blob/main/help/ats-setup/flatchr.mdx ; https://github.com/juiceboxwork/mintlify-docs/blob/main/help/ats-setup/taleez.mdx | [S] |
| s14 | Juicebox, guides Teamtailor, Lever, Greenhouse (modifié le 04/09/2026), Bullhorn : https://github.com/juiceboxwork/mintlify-docs/blob/main/help/ats-setup/teamtailor.mdx ; https://github.com/juiceboxwork/mintlify-docs/blob/main/help/ats-setup/lever.mdx ; https://github.com/juiceboxwork/mintlify-docs/blob/main/help/ats-setup/greenhouse.mdx ; https://github.com/juiceboxwork/mintlify-docs/blob/main/help/ats-setup/bullhorn.mdx | [S] |
| s15 | Teamtailor, API publique, archive officielle (dépôt archivé le 01/02/2021) : https://github.com/Teamtailor/docs ; https://github.com/Teamtailor/docs/blob/master/source/includes/_auth.md.erb ; https://github.com/Teamtailor/docs/blob/master/source/includes/candidates/_list.md.erb ; https://github.com/Teamtailor/docs/blob/master/source/includes/candidates/_index.md.erb ; https://github.com/Teamtailor/docs/blob/master/source/includes/job_applications/_create.md.erb ; https://github.com/Teamtailor/docs/blob/master/source/includes/stages/_index.md.erb ; https://github.com/Teamtailor/docs/blob/master/source/includes/_pagination.md.erb | [V archive] |
| s16 | Teamtailor, documentation actuelle (extraits) : https://docs.teamtailor.com/ ; clé « Admin » créée par un administrateur : https://support.teamtailor.com/en/articles/5963369-use-our-teamtailor-api | [V extraits] |
| s17 | Teamtailor, webhooks d'entreprise : événements https://github.com/Teamtailor/tt-partner-docs/blob/master/source/includes/company_webhooks/_event_types.md.erb ; « There is no retry mechanism at the moment » https://github.com/Teamtailor/tt-partner-docs/blob/master/source/includes/company_webhooks/_authentication.md.erb ; changement du 19/03/2026 https://github.com/Teamtailor/tt-partner-docs/commit/6edbfc1 et https://github.com/Teamtailor/tt-partner-docs/blob/master/source/includes/company_webhooks/_changelog.md.erb ; relances encore citées (16/04/2025) https://github.com/Teamtailor/tt-partner-docs/blob/master/source/includes/company_webhooks/_best_practices.md.erb ; activation https://github.com/Teamtailor/tt-partner-docs/blob/master/source/includes/company_webhooks/_setup.md.erb ; `transparent_recruiting_visible_at` https://github.com/Teamtailor/tt-partner-docs/blob/master/source/includes/company_webhooks/_payloads.md.erb ; « 3 relances », non relue : https://support.teamtailor.com/en/articles/8068954-company-webhooks | [V] ; centre d'aide [?] |
| s18 | Teamtailor, programme partenaire et régions : https://github.com/Teamtailor/tt-partner-docs/blob/master/source/includes/partners/_intro.md.erb ; carte « résultat » : https://github.com/Teamtailor/tt-partner-docs/blob/master/source/includes/partners/partner_results/_index.md.erb | [V] |
| s19 | Welcome to the Jungle, archive officielle (page candidats modifiée le 20/03/2019, dépôt archivé le 20/06/2022) : https://github.com/WTTJ/wk-api-docs/blob/master/source/index.html.md ; https://github.com/WTTJ/wk-api-docs/blob/master/source/includes/_candidates.md ; https://github.com/WTTJ/wk-api-docs/blob/master/source/includes/_jobs.md ; https://github.com/WTTJ/wk-api-docs/blob/master/source/includes/_faq.md ; https://github.com/WTTJ/wk-api-docs/commits/master/source/includes/_candidates.md | [V archive] |
| s20 | Welcome to the Jungle, documentation actuelle lue par API Evangelist le 04/09/2026 : https://raw.githubusercontent.com/api-evangelist/welcome-to-the-jungle/main/README.md ; https://raw.githubusercontent.com/api-evangelist/welcome-to-the-jungle/main/authentication/welcome-to-the-jungle-authentication.yml ; https://raw.githubusercontent.com/api-evangelist/welcome-to-the-jungle/main/scopes/welcome-to-the-jungle-scopes.yml ; https://raw.githubusercontent.com/api-evangelist/welcome-to-the-jungle/HEAD/conventions/welcome-to-the-jungle-conventions.yml ; https://raw.githubusercontent.com/api-evangelist/welcome-to-the-jungle/main/rate-limits/welcome-to-the-jungle-rate-limits.yml ; https://raw.githubusercontent.com/api-evangelist/welcome-to-the-jungle/HEAD/graphql/welcome-to-the-jungle.graphql ; documentation officielle non lue : https://developers.welcomekit.co/ ; produit « Welcome ATS » : https://solutions.welcometothejungle.com/en/ats | [S] ; officielle [?] |
| s21 | Welcome to the Jungle, demande de webhooks ouverte le 25/01/2022, sans réponse : https://github.com/WTTJ/wk-api-docs/issues/39 | [V] |
| s22 | Flatchr, source officielle de developers.flatchr.io (dernier commit b922bc79 du 10/07/2026) : https://gitlab.com/flatchr/public/docs ; https://gitlab.com/flatchr/public/docs/-/blob/main/docs/getting_started.md ; https://gitlab.com/flatchr/public/docs/-/blob/main/docs/QuickStart/Candidats/Creer_un_candidat.md (modifié le 25/06/2026) ; https://gitlab.com/flatchr/public/docs/-/blob/main/docs/QuickStart/Candidats/Recuperer_un_candidat.md ; https://gitlab.com/flatchr/public/docs/-/blob/main/docs/QuickStart/Candidats/Recuperer_CV.md (365 jours, 1 requête par seconde) ; https://gitlab.com/flatchr/public/docs/-/blob/main/docs/faq.md ; https://gitlab.com/flatchr/public/docs/-/blob/main/src/pages/webhooks.md ; https://gitlab.com/flatchr/public/docs/-/blob/main/docs/Referentiels/columns.md ; https://gitlab.com/flatchr/public/docs/-/blob/main/docs/QuickStart/Candidats/Deplacer_un_candidat.md ; https://gitlab.com/flatchr/public/docs/-/blob/main/docs/QuickStart/Commentaires/Creer_commentaire.md | [V] |
| s23 | Taleez, copie de la spécification 0.4.0, non datée : https://github.com/bump-sh/examples/blob/HEAD/apis/taleez-openapi-source.yaml ; fournisseur généré depuis `openapi.json` : https://github.com/Oppulence-Engineering/design-system/blob/HEAD/packages/integrations/src/server/providers/taleez/index.ts ; spécification officielle non lue : https://api.taleez.com/swagger-ui/index.html | [S] |
| s24 | Jobaffinity, paquet tiers : https://www.npmjs.com/package/@lssm-tech/integration.job-sources | [S] |
| s25 | Recruitee, code tiers : https://github.com/jnot807/recruitee-mcp/blob/main/client.js ; https://github.com/jnot807/recruitee-mcp/blob/main/README.md ; https://github.com/NangoHQ/nango/blob/master/docs/integrations/all/recruitee/connect.mdx ; https://github.com/wingbackapp/recruitee-round-robin-interview-service/blob/master/api/webhook.js ; https://github.com/PipedreamHQ/pipedream/blob/master/components/recruitee/actions/create-candidate/create-candidate.mjs | [S] |
| s26 | Workable, réponses réelles enregistrées le 23/07/2026 : https://github.com/NangoHQ/integration-templates/tree/main/integrations/workable/tests ; webhooks : https://github.com/NangoHQ/integration-templates/blob/main/integrations/workable/actions/create-subscription.ts ; jeton : https://github.com/StackOneHQ/hub-docs/blob/main/connection-guides/ats/workable.mdx | [S] |
| s27 | Greenhouse, Harvest (republiée le 10/09/2026 ; retrait de v1 et v2 annoncé pour le 31/08/2026 ; « Unlisted vendors may be subject to additional rate limits ») : https://developers.greenhouse.io/harvest.html, lue dans https://github.com/grnhse/greenhouse-api-docs/blob/gh-pages/harvest.html ; historique : https://github.com/grnhse/greenhouse-api-docs/commits/gh-pages ; Job Board API sans authentification : https://developers.greenhouse.io/job-board.html ; annonce du retrait : https://github.com/grnhse/greenhouse_io/blob/master/CHANGES.md | [V] |
| s28 | Greenhouse, Ingestion API (« sourcing partners ») et webhooks (7 relances en 15 h), sans bandeau de retrait : https://developers.greenhouse.io/candidate-ingestion.html ; https://developers.greenhouse.io/webhooks.html (lues dans le dépôt gh-pages) ; « no self-service mechanism », partners@greenhouse.io : https://github.com/grnhse/omniauth-greenhouse | [V] |
| s29 | Greenhouse v3, identifiant « Custom » et OAuth partenaire : Airbyte 1.3.0 du 24/09/2026 https://github.com/airbytehq/airbyte/blob/master/docs/integrations/sources/greenhouse.md ; https://github.com/NangoHQ/nango/blob/master/docs/api-integrations/greenhouse-harvest-oauth2-cc/connect.mdx ; accord signé : https://github.com/NangoHQ/nango/blob/master/docs/api-integrations/greenhouse-harvest-partner/how-to-register-your-own-greenhouse-harvest-partner-oauth-app.mdx | [S] |
| s30 | Lever, dépôts officiels (« Make sure you've registered for OAuth », bac à sable, Data API) : https://github.com/lever/integrator-resources/blob/main/README.md ; https://github.com/lever/integrator-resources/blob/main/DataAPIPostman/Lever-DataAPI-Collection.json ; https://github.com/lever/integrator-resources/blob/main/ExampleOAuthApp/.env ; annonces publiques et instance européenne : https://github.com/lever/postings-api/blob/master/README.md | [V] |
| s31 | Lever, secondaires : Airbyte (journal au 22/09/2026 ; OAuth réservé aux partenaires, clé pour flux internes) https://github.com/airbytehq/airbyte/blob/master/docs/integrations/sources/lever-hiring.md ; Nango (exigences de partenariat : inconnues) https://github.com/NangoHQ/nango/blob/master/docs/integrations/all/lever.mdx ; modèles : https://github.com/NangoHQ/integration-templates/tree/main/integrations/lever | [S] |
| s32 | Ashby, copies de la spécification officielle : https://github.com/api-evangelist/ashby/blob/main/openapi/_original/ashby-api-openapi.json ; https://github.com/ryanwaits/ashby-ts ; connexion : https://github.com/NangoHQ/nango/blob/master/docs/integrations/all/ashby/connect.mdx ; débit et droits : https://github.com/airbytehq/airbyte/blob/master/docs/integrations/sources/ashby.md ; bac à sable : https://github.com/ryanwaits/ashby-sandbox | [S] |
| s33 | SmartRecruiters, spécification de 2023 : https://rubygems.org/gems/open_api_smart_recruiters_sdk/versions/0.2.12 [S] ; démo officielle des webhooks : https://github.com/smartrecruiters/sr-webhooks-client [V] ; débit (fiche générée) : https://github.com/api-evangelist/smartrecruiters/blob/main/rate-limits/smartrecruiters-rate-limits.yml [?] | [S] [V] [?] |
| s34 | Personio, API Recruiting v1 : https://github.com/personio/api-docs/blob/master/personio-recruiting-api.yaml [V] ; v2 : https://www.npmjs.com/package/personio-mcp [S] | [V] [S] |
| s35 | Factorial, SDK officiels (commit 7eb4c11 du 23/09/2026) : https://github.com/factorialco/factorial-api-sdks/blob/main/typescript/src/generated/types.gen.ts ; webhooks : https://github.com/factorialco/factorial-api-sdks/blob/main/skills/factorial-api-sdks/reference/webhooks.md ; versions : https://registry.npmjs.org/@factorialco/api-client ; bêta 2026-10-01 : https://registry.npmjs.org/@factorialco/api-client/-/api-client-3.0.0-beta.2026100135.tgz | [V] |
| s36 | BambooHR, spécification officielle (27/04/2026) : https://github.com/BambooHR/bhr-api-php/blob/master/specs/public.yaml | [V] |
| s37 | DigitalRecruiters : https://github.com/Riminder/hrflow-connectors/blob/master/src/hrflow_connectors/v1/connectors/digitalrecruiters/warehouse.py ; https://github.com/juiceboxwork/mintlify-docs/blob/bf0a544ffff34b8b928c00543ad3decc2d621417/help/ats-setup/digital-recruiters.mdx | [S] |
| s38 | Werecruit : https://github.com/thermesmarins/tmsm-werecruit | [S] |
| s39 | Beetween : https://github.com/ever-jobs/ever-jobs/blob/574bd922f78ae9b7ba01ff4056e9d33cb2a330bc/.specify/specs/343-source-ats-beetween/plan.md | [S] |
| s40 | Workday (soumission d'agence) : https://github.com/purvangvasani/Python-web-scrapper/blob/main/operation/Recruiting/Recruiting.json ; https://github.com/metorial/metorial/blob/main/integrations/workday/docs/SPEC.md | [S] |
| s41 | SAP SuccessFactors : https://github.com/metorial/metorial/blob/main/integrations/sap-successfactors/docs/SPEC.md [S] ; outil de migration vers SmartRecruiters : https://github.com/SAP-samples/smartrecruiters-ai-recruiting-custom-agent/blob/main/SF_INTEGRATION_README.md [V] | [S] [V] |
| s42 | Cegid Talentsoft : https://github.com/betagouv/csplab/blob/main/docs/talentsoft_webhooks.md | [S] |
| s43 | Bullhorn et Recruit CRM chez les connecteurs : https://www.kombo.dev/integrations/bullhorn ; https://docs.merge.dev/merge-unified/ats/integrations/bullhorn ; https://unified.to/integrations/recruitcrm | [S] |
| s44 | Buddi by hellowork : https://recruteur.hellowork.com/ats ; https://www.hellowork-group.com/fr/actualites/hellowork-recruteur-devient-buddi-by-hellowork/ ; aucun connecteur trouvé | [V extraits] [?] |
| s45 | Bullhorn, documentation officielle de l'API REST, source de bullhorn.github.io/rest-api-docs (dernier commit b84dfe9 du 25/06/2026) : README https://github.com/bullhorn/rest-api-docs/blob/master/README.md ; connexion OAuth seule en production https://github.com/bullhorn/rest-api-docs/blob/master/source/includes/_login.md ; file d'événements https://github.com/bullhorn/rest-api-docs/blob/master/source/includes/_subscription.md ; `JobSubmission` https://github.com/bullhorn/rest-api-docs/blob/master/source/includes/entityref/_jobsubmission.md ; champ `source` du candidat https://github.com/bullhorn/rest-api-docs/blob/master/source/includes/entityref/_candidate.md ; 429 https://github.com/bullhorn/rest-api-docs/blob/master/source/includes/_errors.md ; site publié, non lu : https://bullhorn.github.io/rest-api-docs | [V] |
| s46 | Tarifs des connecteurs. Kombo (forfait annuel et prix par client connecté, intégrations inactives non facturées ; fiche générée le 04/05/2026, « not harvested from the provider ») : https://github.com/api-evangelist/kombo/blob/main/plans/kombo-plans-pricing.yml ; page officielle non lue : https://www.kombo.dev/pricing. Merge (relevé du 20/09/2026 sur la page officielle) : https://github.com/api-evangelist/merge/blob/main/plans/merge-plans-pricing.yml ; https://www.merge.dev/pricing/unified. Unified.to (fiche générée) : https://github.com/api-evangelist/unified-to/blob/main/plans/unified-to-plans-pricing.yml ; extrait : https://unified.to/pricing | [S] |
| s47 | Kombo, région UE par défaut : https://github.com/kombohq/typescript-sdk/blob/v1.3.8/src/lib/config.ts [V] ; DPA du 01/04/2026 : https://www.kombo.dev/legal/data-processing-agreement-2026-04-01.pdf [S] ; hébergement : https://docs.kombo.dev/data-residency-compliance [S] ; certifications : https://www.kombo.dev/security [S] | [V] [S] |
| s48 | Merge, environnement UE : https://app.unpkg.com/@mergeapi/merge-node-client@4.0.4/files/environments.d.ts [V] ; stockage à Stockholm : https://www.merge.dev/eu [S] | [V] [S] |
| s49 | Marché français, méthode et limites (extraits de moteur, aucune page lue en entier) : fiche `ats/marche-ats.md` ; Guide des ATS en France, janvier 2026 : https://lestalentsnarratifs.substack.com/p/le-guide-des-ats-en-france ; concurrents : https://www.jarvi.tech/en/ ; https://www.leonar.app/ ; https://www.hiresweet.com/fr/home---fr | [S] [V extraits] |
| s50 | Teamtailor et Welcome to the Jungle, usage : https://www.teamtailor.com/en-us/customers/ ; https://catitres.teamtailor.com/ ; https://etam.teamtailor.com/ ; https://spiko.teamtailor.com/jobs ; https://welcometothejungle.teamtailor.com/jobs ; https://solutions.welcometothejungle.com/lp/ats ; https://solutions.welcometothejungle.com/en/about-us ; https://solutions.welcometothejungle.com/en/compatibles-ats | [V extraits] |
| s51 | Flatchr, usage : https://www.flatchr.io/en/ ; https://www.flatchr.io/customers ; https://recruteur.hellowork.com/ats-partenaires | [V extraits] |
| s52 | Taleez, usage : https://taleez.com/ [V extrait] ; https://taleez.com/blog/meilleur-ats-logiciel-recrutement-france-comparatif [S] | [V extrait] [S] |
| s53 | Ashby, usage : https://www.ashbyhq.com/customers/alan ; https://jobs.ashbyhq.com/pennylane ; https://jobs.ashbyhq.com/mistral.ai ; https://jobs.ashbyhq.com/alan | [V extraits] |
| s54 | Lever, usage : https://jobs.lever.co/qonto ; https://jobs.lever.co/younited ; https://jobs.eu.lever.co/jacquemus | [V extraits] |
| s55 | Greenhouse, usage : https://job-boards.greenhouse.io/dataiku ; https://job-boards.greenhouse.io/decathlontechnology ; https://www.greenhouse.com/newsroom/greenhouse-ranked-best-ats-in-the-overall-enterprise-mid-market-and-emea-regional-g2-winter-2026-reports | [V extraits] |
| s56 | Recruitee, usage : https://recruitee.com/ [V extrait] ; https://www.blogdumoderateur.com/tools/tellent-recruitee/ [S] | [V extrait] [S] |
| s57 | Workable, usage : https://www.workable.com/about ; https://solutions.welcometothejungle.com/en/compatibles-ats | [V extraits] |
| s58 | Bullhorn, usage : https://www.bullhorn.com/ ; https://www.bullhorn.com/fr/ | [V extraits] |
| s59 | SmartRecruiters, usage : https://news.sap.com/2025/09/sap-completes-smartrecruiters-acquisition/ [V extrait] ; https://cvpass.fr/en/blog/entreprises-ats-france [S] | [V extrait] [S] |
| s60 | Factorial, usage : https://www.rhmatin.com/sirh/sirh-saas/sirh-pour-pme-les-projets-de-factorial-finance-a-hauteur-de-120-millions-de-dollars.html | [S] |

Documents internes cités : `mission-ux/extension/synthese-extension.md` (S5, section 2.6, décision 23, lots I6a et I6b) ; `mission-ux/extension/conception-integrations.md` (sections 2.2, 2.7, 2.12, 2.17) ; `mission-ux/extension/ats/matrice.md` et les fiches `ats/*.md`.
