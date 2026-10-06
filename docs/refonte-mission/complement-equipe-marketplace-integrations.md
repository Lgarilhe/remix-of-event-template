# Équipe, partenaires, connexions : addendum à la conception de la page mission

Konekt, 24/09/2026. Addendum à `synthese.md` (même dossier parent). Il se lit seul : chaque notion utilisée est définie ici, une fois.

Fichier : `/tmp/claude-0/-home-user-remix-of-event-template/4b4fe983-b7dc-55e7-8194-3f9f5ececcae/scratchpad/mission-ux/extension/synthese-extension.md`

**Ce que demandait le fondateur.** Intégrer à la page mission validée sur maquette le travail en équipe, la marketplace (un poste géré en interne ou confié à des cabinets externes) et les intégrations (ATS, bases externes, e-mail, WhatsApp, autres outils), utilisées dans l'application et pas seulement branchées.

**Sources.** Abréviations utilisées partout :
- S : `synthese.md` (la conception retenue, sections citées « S §4.3 ») ;
- CE, CM, CI : `conception-equipe.md`, `conception-marketplace.md`, `conception-integrations.md` ;
- CU : `critique-usage.md` (points CU-B1 à CU-B5, CU-I1 à CU-I14) ; CF : `critique-faisabilite.md` (CF-B1 à CF-B6, CF-I1 à CF-I15) ;
- LE, LM, LI, LC : `lecture-equipe.md`, `lecture-marketplace.md`, `lecture-integrations.md`, `lecture-canaux.md` ; MP : `mesures-prod.md` ; MA : `marche.md` ; CR : `critique-etat-des-lieux.md` ;
- le dépôt `/home/user/remix-of-event-template` au commit 5882084, cité en `fichier:ligne` ; la maquette `maquette-mission/project/*.dc.html`.

**Méthode.** Lecture seule du dépôt. Aucune requête SQL, aucun outil Supabase, aucune commande git d'écriture. Chaque point bloquant des deux critiques a été relu dans le code avant d'être intégré ou écarté : l'annexe A donne la preuve de chacun. Les chiffres de production viennent de MP et S, non remesurés.

---

## 0. En une page

**Aujourd'hui.** En production, 16 organisations sur 17 n'ont qu'un membre, aucune mission n'a été confiée à un cabinet, aucun outil client n'est relié, et le seul canal qui a servi est LinkedIn, à la main (MP §0). Le code, lui, a déjà des fuites : les conversations de l'assistant sont lisibles par les collègues, le portail client montre tous les profils d'une mission, et une séquence écrirait les candidats de n'importe quelle organisation dans le Notion de Konekt (section 4). La conception doit donc réparer d'abord, puis servir l'usage cible sans rien ajouter à l'écran de qui travaille seul.

**Pour l'équipe.**
- Une ligne par candidat et par mission, au lieu d'une par personne. Chaque candidat contacté a un responsable nommé, chaque mission aussi.
- La carte « Maintenant » devient personnelle : chaque rang a un seul destinataire. Une réponse suit le candidat quand on en passe le suivi à un collègue.
- On écrit toujours depuis son propre compte. « Contacté par Julie Garnier le 12/09 » se lit avant chaque geste et se vérifie au moment de l'envoi.
- Le propriétaire voit, dans la liste des missions, ce qui traîne chez ses collègues. Un manager donne son avis par un lien, sans compte ni siège.

**Pour la marketplace, poste interne ou confié.**
- Chaque mission dit qui recrute : vous en interne, vous pour un client, des recruteurs partenaires, ou vous et des partenaires. Ce champ, et non le type d'organisation, décide de ce que l'écran montre.
- Un cabinet partenaire travaille chez lui, dans une mission liée qui ressemble à ses autres missions. Il ne transmet à l'entreprise que ce qu'il présente.
- « Présenter » est un seul geste, vers un client hors Konekt (lien) ou vers une entreprise sur Konekt (présentation datée et dédoublonnée). Les partenaires ne se voient jamais entre eux.
- Rien n'est ouvert au public avant qu'un pilote réel ne le demande : la publication et l'invitation de partenaires restent masquées jusque-là.

**Pour les intégrations.**
- Un journal des échanges par candidat, tous canaux, rempli au moment où l'échange a lieu. Il nourrit Maintenant, la fiche, l'anti-doublon et le Bilan.
- Les intégrations n'ajoutent aucun rang : elles donnent une source aux rangs existants (réponse par e-mail, entretien lu dans l'agenda, candidatures de l'ATS, connexion rompue).
- L'e-mail part de la boîte du membre, l'appel se note en un geste, l'ATS et les fichiers deviennent des sources du Sourcing. WhatsApp s'ouvre dans l'application WhatsApp et se note : pas de compte personnel relié à Konekt.
- Ce qui ment aujourd'hui (« Aucun appel », « Statut Airtable », promesses d'envoi) est débranché d'abord.

**Pour qui travaille seul, rien ne change.** Aucun élément d'équipe, de partenaire ou de connexion ne s'affiche tant que la source n'existe pas. La planche `Main.dc.html` reste l'écran exact de ce recruteur.

**Les trois gains.**
1. Plus aucune réponse perdue : la réponse va à celui qui suit le candidat, sur tous les canaux reliés, y compris après une passation ou pendant une absence.
2. Une entreprise reçoit dans son Pipeline les candidats de ses cabinets, datés et dédoublonnés, et chaque cabinet suit leur avancement et ses honoraires sans quitter sa mission.
3. Chaque outil relié rend un service visible dans la mission (un rang, une adresse d'envoi, un profil connu), et rien n'apparaît tant qu'il n'est pas relié.

**L'ordre, en une phrase.** Un lot de réparations court tout de suite (C1), les lots 0a à 0c enrichis de l'identité et du journal, les écrans de la synthèse, puis l'e-mail, les appels et l'agenda ; l'équipe et la marketplace attendent une mesure ou un pilote (section 5).

---

## 1. Les socles communs

Onze notions servent aux trois sujets. Chacune est définie ici et nulle part ailleurs.

### S1. Une personne, une identité

- Table `candidate_identities (organization_id, person_id, kind, value)`, unique sur `(organization_id, kind, value)`. `kind` vaut `linkedin_slug`, `linkedin_member_id`, `email`, `phone` ou `external`.
- Une fonction serveur `resolve_person(organisation, identifiants[])` rend la personne existante si l'un des identifiants coïncide, sinon en crée une.
- Pourquoi pas une seule colonne : l'anti-doublon actuel compare un ensemble de clés par profil (identifiant, `provider_id`, identifiant public, deux formes d'adresse, nom court de chacune, `src/lib/enrollmentDuplicates.ts:52-69`). Une colonne unique ne peut pas l'exprimer (CF-B1). Un profil de la Base Konekt garde l'identifiant de son fournisseur (CR C3).
- Deux personnes qui se révèlent identiques ne sont jamais fusionnées en silence : la fiche dit « Peut-être la même personne que Marc Moreau », et une personne décide. Aucun rapprochement sur un nom.
- Même règle pour tout : ligne de mission, coordonnées, journal, vivier importé, ATS, présentation d'un partenaire.

### S2. Une ligne par personne et par mission

- `job_candidate_status` devient unique sur `(project_id, person_id)`, au lieu de `(job_id, candidate_id, created_by)`. La ligne porte toujours l'organisation de la mission, jamais celle du navigateur.
- Deux fonctions changent l'étape (CF-I2) : `set_candidate_stage(ligne, étape)` pour le navigateur (acteur = la personne connectée, source « user », ligne visible par elle) ; `set_candidate_stage_internal(ligne, étape, source, acteur)` pour le serveur seulement, fermée à `anon` et `authenticated`. Un utilisateur ne peut donc pas écrire « ai » ou « ats » et fausser le Bilan.
- Toute création de ligne passe par `upsert_mission_candidate`. Aujourd'hui, 15 `upsert` et 2 insertions simples écrivent la table (annexe A), pas 8.
- La ligne peut porter plus tard un responsable (`owner_user_id`, lot E1) et une origine (`origin_kind` : `linkedin`, `base_konekt`, `import`, `ats`, `extension`, `manual`, `presentation` ; `origin_ref`), chacun posé par le lot qui s'en sert (CF-I3).

### S3. Qui répond de quoi, et la chaîne du destinataire

- La mission a un responsable (`sourcing_projects.owner_id`, défaut : son créateur). Avant le lot E1, c'est `created_by`.
- Un candidat n'a de responsable qu'à partir du premier contact : c'est la personne dont le compte a écrit, le titulaire de la conversation. Avant, un profil retenu relève du responsable de la mission (CU-B3). Titulaire et responsable ne divergent qu'après un « Passer le suivi à… » explicite.
- La chaîne, écrite une fois : d'abord la personne qui seule peut agir (titulaire d'un compte déconnecté, intervieweur, personne sollicitée, destinataire d'une tâche, propriétaire ou administrateur pour un outil de l'organisation ou des honoraires) ; puis le responsable du candidat ; puis le responsable de la mission. Pendant une absence déclarée, le remplaçant prend tout ce qui revenait à l'absent (lot E1).
- Après une passation, une réponse arrivée sur l'ancienne conversation va au nouveau responsable, avec « Répondre depuis votre compte » et les extraits de l'ancienne conversation au-dessus du texte. L'ancien titulaire n'a plus qu'une ligne d'Ensuite, et le candidat sort de son À traiter.
- Pour qui travaille seul, tout destinataire vaut « vous ».

### S4. Le journal des échanges

Trois tables, une lecture (CF-B4).
- `candidate_exchanges` : chaque échange avec une personne (invitation, message, InMail, e-mail, appel noté, rendez-vous, contact déclaré hors Konekt), avec canal, sens, membre, compte, mission, date, objet et extrait de 280 caractères au plus. Aucun rôle client ne la lit ni ne l'écrit directement.
- `candidate_threads` : l'index des conversations (titulaire, canal, mission, dates du premier et du dernier message), sans texte. C'est le « lien conversation et mission » de S §5.3.
- `mission_events` : les faits sans contenu (étape changée, lignes fusionnées, responsable changé, présentation, avis demandé, embauche), datés et signés, jamais modifiés.
- Une seule lecture du fil, pour l'écran et pour l'assistant : `get_candidate_feed(ligne)`. Une seule lecture de l'anti-doublon : `recent_contacts(personnes[])`.
- Rattachement à une mission. À l'envoi, depuis une mission, une fiche, la messagerie, une séquence, l'assistant : la conversation est inscrite avec sa mission. À la réception : la conversation connue donne la mission ; sinon l'identité parmi les lignes de l'organisation au stade « Contacté » ou au-delà ; une seule mission trouvée, l'échange s'y range ; plusieurs, il est « à rattacher » et aucune étape ne change avant le clic ; aucune, il reste au niveau de la personne. Jamais une ligne « À trier » ou « Retenu » ne monte en « A répondu » par une réception (S §3.3).
- Le texte complet d'une conversation n'est jamais stocké : il se lit en direct chez le fournisseur, par son titulaire.

### S5. L'identifiant externe

`external_refs` relie un objet Konekt (mission, ligne, entretien) à son équivalent dans un outil du client : outil, type, identifiant, adresse, état lu (« Entretien manager »), date du changement dans l'outil, date de notre dernière lecture, état de synchronisation et dernière erreur lisible. Une table pour tous les liens : poste et candidature d'un ATS, événement d'agenda. Le cadre `connector_*` actuel, marqué appliqué sans exister en production (MP §13), est supprimé.

### S6. Un seul geste « Présenter »

- Le même bouton, depuis la barre de sélection du Pipeline ou la fiche. Le panneau Client choisit la voie selon la mission.
- Client hors Konekt : un lien par client et par mission (S §5.5, lot 8).
- Entreprise sur Konekt (mission liée d'un partenaire) : une présentation directe par `submit_candidate`. Elle est datée par le serveur, dédoublonnée par S1, porte une priorité (première présentation, présenté avant par un autre, déjà connu de l'entreprise) et l'accord du candidat déclaré par le partenaire. Elle crée ou retrouve la ligne chez l'entreprise, avec son origine.
- Les deux voies posent le jalon `presented_at` et un événement `presented`. L'avis revient au rang 4.

### S7. Le champ « Qui recrute »

- `sourcing_projects.sourcing_mode` : `internal` « Vous, en interne » ; `client` « Vous, pour un client » ; `delegated` « Des recruteurs partenaires » ; `mixed` « Vous et des recruteurs partenaires ».
- Jamais demandé à la création : un client saisi donne « pour un client », sinon « en interne » (CU-I5). Les partenaires se choisissent dans Cadrage.
- Il décide : panneau Client (`client`, mission liée) ; panneau Partenaires et section Partenaires de Cadrage (`delegated`, `mixed`) ; ton des messages par défaut ; rangs qui existent pour la mission (section 2.1).
- Il remplace le type d'organisation pour ces choix : ce type est vide pour 9 organisations sur 17 (MP §2) et il change (CR C8). La décision 9 de la synthèse devient sans objet.
- Une mission liée est une mission `client` dont le client est l'entreprise qui a confié le poste.

### S8. Qui voit quoi

- Socle : l'organisation active, comme aujourd'hui (`get_user_org_id`, `20260903074500_rls_catchup_audit_critiques.sql:183-205`). Pas de lecture « toute appartenance » : `/pipeline` lit sans filtre d'organisation et mélangerait deux organisations pour les 3 personnes qui en ont plusieurs (`useATSData.ts:136-140`, MP §3, CF-B3).
- Quatre rôles : propriétaire, administrateur, membre, et « Accès limité » (valeur `collaborator` en base, libellé « Collaborateur externe » aujourd'hui). L'accès limité s'ajoute comme condition : il ne voit que les missions de son équipe.
- Mission confidentielle : une case, éteinte par défaut, qui limite la mission à son équipe et au propriétaire.
- Partenaire : une autre organisation. Il ne lit rien de l'entreprise (ni ligne, ni note, ni grille, ni coordonnée), seulement ses propres présentations, les messages de collaboration et le poste réduit que l'entreprise a choisi de partager.
- Deux seuils calculés sur les données, jamais sur le type d'organisation. Éléments de mission (initiales, « Les miens », ligne d'équipe, « Depuis votre passage », signatures) : au moins deux personnes actives sur la mission, c'est-à-dire qui suivent un candidat ou ont agi dans les 30 derniers jours. Gestes vers une personne (« Passer le suivi à… », « Demander un avis à… », mention) : l'organisation compte au moins deux personnes, accès limités compris, ou la mission a un partenaire. Un membre de l'équipe inactif ne déclenche rien : c'est pourquoi la planche validée, où Julie Garnier figure dans l'équipe sans avoir agi, reste inchangée.

### S9. Écrire depuis son compte, et ne pas contacter deux fois

- Un message LinkedIn ou un e-mail part toujours du compte de la personne qui clique. Exception : l'étape d'une séquence part du compte de la personne qui a inscrit, ou d'un compte dont le titulaire a coché l'accord de rotation. Le serveur le vérifie ; aujourd'hui il accepte n'importe quel compte de l'organisation (`unipile-search/index.ts:185-200, 330-345`).
- Une fenêtre de 90 jours, une source (`recent_contacts`, lue dans le journal), partout : résultats du Sourcing, tri un par un, en-tête de fiche, inscription en séquence (exclusion, dérogation propriétaire ou administrateur), message manuel (confirmation, sauf si vous suivez le candidat), inscription depuis la messagerie (aujourd'hui sans contrôle, CR C7), assistant, et au moment de l'envoi côté serveur.

### S10. L'aiguillage « Relancer »

Un seul bouton, « Relancer X », dont la voie dépend de qui doit répondre :
- un interlocuteur hors Konekt (le client d'un cabinet) : e-mail rédigé, envoyé depuis votre boîte si elle est reliée, sinon ouvert dans la messagerie de l'ordinateur (S §5.5) ;
- une entreprise sur Konekt (vous êtes son partenaire) : message de collaboration dans Konekt, repris dans le résumé quotidien par e-mail s'il n'est pas lu en un jour ouvré (file `enqueue_email`, CF-I15) ;
- un collègue qui a un compte : notification, qui devient son rang 7 ;
- une personne sans compte à qui l'on a demandé un avis par lien : e-mail de Konekt avec son lien ;
- si c'est vous qui devez répondre au partenaire : « Donner un avis à Cabinet Altide ».

### S11. Écritures sensibles et garde-fous

- Les gestes qui touchent une autre personne ou une autre organisation passent par des fonctions SQL `SECURITY DEFINER`, `search_path` vide, fermées à `anon`, qui prennent l'organisation de la mission.
- Toute table nouvelle a sa RLS dès sa création : les privilèges par défaut donnent la lecture à `anon` et l'écriture à `authenticated` (`20260421180000_grants_bootstrap_owner_uniques.sql:33-38`).
- Avant de poser une politique, toutes celles de la table sont retirées par une boucle sur `pg_policies`, parce que la production et une base neuve n'ont pas les mêmes noms (CLAUDE.md, règles 6 et 7).
- Une notification de personne à personne passe par une fonction qui vérifie que les deux peuvent voir la mission. Une notification « action » ne va qu'au destinataire du rang.

---

## 2. Écran par écran

Ce qui suit ne décrit que les différences avec S. Données : la distribution de la section 9.1.

### 2.1 Pipeline

#### La carte Maintenant : une seule table de rangs

CE, CM et CI ajoutaient une vingtaine de situations avec deux notations qui se confondaient (« 4 bis », « 4b ») et des ordres non tranchés (CU-B2, CF-I4). Voici la table unique, renumérotée en entiers. Trois groupes, comme S : ce qu'une personne attend de vous (un candidat, puis un client ou une entreprise, puis un collègue, puis vous-même), ce qui fait avancer la mission, ce qui la prépare. Le rang 0 passe avant tout ; les rangs 1 à 9 forment le premier groupe, 10 à 14 le deuxième, 15 à 17 le troisième.

| Rang | Situation | Phrase (exemple) | Bouton | Destinataire (S3) | Missions | Source, lot |
|---|---|---|---|---|---|---|
| 0 | Un blocage empêche l'action suivante | « Votre boîte e-mail est déconnectée : la réponse à Julien Roux ne peut pas partir. » | Reconnecter | Titulaire du compte ; propriétaire ou administrateur pour un outil de l'organisation ; membres du partenaire pour une fin de collaboration, une fois | Toutes | LinkedIn (lot 3) ; boîte, agenda (I1, I3) ; ATS (I6b) ; fin de collaboration (P1) |
| 1 | Entretien aujourd'hui | « Entretien avec Nadia David aujourd'hui à 14 h. » | Préparer l'entretien | Intervieweur s'il est membre, sinon responsable du candidat ; côté partenaire, qui a présenté | Toutes | Date saisie (lot 6) ; agenda (I3) ; date recopiée dans la présentation (P2) |
| 2 | Entretien passé sans verdict | « Notez l'entretien de Nadia David, aujourd'hui 14 h. » | Noter l'entretien | Idem | Toutes | Idem. 6 entretiens sur 6 restent « prévus » dans le passé (MP §17) |
| 3 | Un candidat a répondu | « Julien Roux vous a répondu par e-mail ce matin. » ; « Marc Moreau a répondu à Guillaume Martin. Il vous a passé le suivi ce matin. » | Répondre (même canal) | Responsable du candidat ; remplaçant pendant une absence | Toutes | LinkedIn (0b, lot 3) ; e-mail (I1) ; créneau choisi sur le lien de prise de rendez-vous (I3) ; échange à rattacher |
| 4 | Un client ou une entreprise a répondu | « Anne Leclerc a répondu à votre relance sur Camille Fontaine. » ; « Groupe Ardelle a écarté Nadège Colas : prétentions au-dessus de la fourchette. » ; « Groupe Ardelle veut recevoir Fabrice Tessier en Entretien usine. » | Lire ; Prévenir la candidate ; Proposer un créneau | Qui a présenté le candidat, sinon responsable de la mission | Pour un client, mission liée | Portail (lot 8) ; e-mail de l'interlocuteur (I1) ; décision de l'entreprise (P2) |
| 5 | Des partenaires attendent votre décision | « 3 candidats présentés par vos partenaires attendent votre avis. » ; « Un candidat de Vauban Conseil a été écarté dans Teamtailor : dites-le au partenaire, avec le motif. » | Examiner les 3 ; Prévenir le partenaire | Responsable de la mission | Avec partenaires | P2 ; I6b |
| 6 | Un partenaire vous écrit ou propose ses services | « Hugo Lemaire, recruteur indépendant, propose ses services sur ce poste. » ; « Cabinet Altide vous a écrit au sujet de Fabrice Tessier. » | Voir la proposition ; Répondre | Proposition : propriétaire et administrateurs ; message : responsable de la mission, ou qui a présenté côté partenaire | Avec partenaires, mission liée | P1, P2. `hunt_applications` existe mais la publication reste masquée (décision 17) |
| 7 | Un collègue attend quelque chose de vous | « Guillaume Martin vous a passé le suivi de Marc Moreau. » ; « Élise Vasseur vous demande votre avis sur Cédric Hoarau. » | Ouvrir ; Donner mon avis | La personne sollicitée | À deux personnes | E1 ; lot 6 |
| 8 | Tâche due aujourd'hui ou en retard | « Rappeler Thomas Lambert avant 17 h. » | Appeler | Destinataire de la tâche (vous, avant E3) | Toutes | P et I2 ; E3 |
| 9 | Proposition de l'assistant | Rang 5 de S | Relire | Auteur de la conversation | Toutes | Lot 9 |
| 10 | Sans nouvelles depuis plus de 5 jours après un entretien | « Camille Fontaine attend depuis 6 jours après l'entretien avec la directrice générale. » ; « Fabrice Tessier attend depuis 6 jours après l'entretien avec Denis Brunet. » | « Relancer X » selon S10 | Responsable du candidat ; qui a présenté (partenaire) ; responsable de la mission (entreprise, candidat présenté) | Toutes | `stage_entered_at` (0a) ; présentation (P2) |
| 11 | Retenus pas encore contactés | « 4 candidats retenus attendent un premier message. » | Contacter les 4 | Responsable de la mission | Toutes sauf « Des recruteurs partenaires » | 0a |
| 12 | Profils à trier | « 4 nouveaux profils notés, dont 1 recommandé. » ; « 5 candidatures reçues dans Teamtailor depuis lundi, à trier. » | Trier les 4 ; Noter et trier les 5 (au moins 10 crédits) | Auteur de la recherche, sinon responsable de la mission | Toutes | Lot 4 ; I6b |
| 13 | Relances prévues aujourd'hui | « 2 relances prévues aujourd'hui, dont 1 par e-mail. » | Relancer | Titulaire du compte qui enverra | Toutes | Lot 5 ; I1 |
| 14 | Honoraires à compléter ou à facturer | « Olivier Rousseau est embauché. Indiquez la rémunération retenue. » ; « 37 000 € HT à facturer à Groupe Hélios pour Olivier Rousseau. » | Compléter ; Marquer comme facturé | Propriétaire et administrateurs ; le responsable de la mission pour « Compléter » | Pour un client, avec partenaires, mission liée | H ; P3 |
| 15 | Rien ne cherche encore | « Le poste est décrit. Lancez une première recherche. » ; « Aucun partenaire ne travaille encore sur ce poste. » | Chercher des profils ; Inviter un partenaire | Responsable de la mission | Toutes | Lot 3 ; P1 |
| 16 | Poste vide | « Décrivez le poste pour commencer. » | Coller une fiche de poste | Responsable de la mission | Toutes | Lot 3 |
| 17 | Rien ne presse, sur votre part | « Rien ne presse. » ; « Rien pour vous. Julie Garnier a 1 réponse à traiter. » | Aucun | Vous | Toutes | Tous les rangs attendus pour ce type de mission couverts |

Correspondance avec S : 0 à 4 inchangés ; 5 devient 9 ; 6 devient 10 ; 7, 8, 9 deviennent 11, 12, 13 ; 10, 11, 12 deviennent 15, 16, 17. Nouveaux : 5, 6, 7, 8, 14.

Règles de plus :
- Un rang n'existe que pour les missions indiquées. Un rang propre aux partenaires ne compte pas dans la couverture d'une mission interne.
- « Pourquoi maintenant ? » nomme la source : « Événement de 14 h dans votre Google Agenda, avec nadia.david@gmail.com. » ; « E-mail reçu à 8 h 51 sur guillaume@altide.fr. » (CI §2.3).
- Couverture. « Rien ne presse » reste interdit tant qu'un rang attendu n'a pas de source (S §4.2). La ligne qui le dit ne parle d'un canal que si la mission l'utilise : « Les réponses par e-mail ne sont pas suivies » n'apparaît qu'après un e-mail envoyé ou déclaré sur un candidat de la mission, avec « Ne plus me le dire », par personne et par mission (CU-I10).
- Ensuite seulement, jamais en carte : une réponse reçue par un collègue, si vous suivez le candidat ou êtes responsable de la mission ; l'action d'un collègue en attente depuis plus de 2 jours ouvrés, pour le responsable de la mission, avec « Écrire à Marion » et « Reprendre » (CU-B4) ; « Présenter Mathis Carré ? » pour un partenaire (présenter reste son choix) ; une date limite des partenaires dans 3 jours ; « Olivier Rousseau embauché : clore la mission ? » ; un changement lu dans l'ATS. Au plus trois éléments, dont une ligne d'équipe.
- À traiter partage avec Maintenant les rangs 0, 3 et 9 (mêmes requêtes, S §12.1), plus les rangs 4 (côté partenaire), 5, 6 et 7, qui arrivent par une notification « action » adressée au seul destinataire. Les tâches (8) restent dans la rangée Tâches de la barre ; les honoraires (14) n'y entrent pas.
- « Plus tard » reste personnel et ne touche jamais le chiffre d'À traiter (S §4.2).

#### Ce qui s'ajoute sous la carte

- « Depuis votre passage », une ligne, seulement si d'autres personnes ont agi depuis votre dernière visite : « Depuis votre passage du 23/09 : Guillaume Martin vous a passé le suivi de Marc Moreau et a fait passer Pierre Bertrand en Entretien DG. Voir ces 2 candidats ». La date de visite vit dans le navigateur (`useMissionVisits.ts:12-20`) ; si elle manque, la ligne ne s'affiche pas.
- En ce moment ne change pas. Chez une entreprise avec des partenaires, pas de groupe « Présentations » : la section de la liste suffit (CU-I11).

#### La liste

- Aucune colonne nouvelle. La grille validée garde Candidat, Étape, Prochaine action, Depuis, Note (`Main.dc.html:279-280`).
- Le responsable : ses initiales dans une pastille après le nom (JG, GM), seulement au-dessus du seuil de S8.
- L'origine : sur la deuxième ligne, après l'entreprise, seulement si elle apporte quelque chose : « · Vivier Altide », « · Teamtailor », « · Cabinet Altide ». Rien pour LinkedIn ni pour la Base Konekt (CU-I10).
- Un seul menu « Afficher » à gauche de « Liste | Par étape » : Tous, Les miens, puis une entrée par origine quand la mission en compte deux. Le choix est mémorisé par personne ; la barre d'étapes suit le filtre.
- La prochaine action d'un collègue s'affiche en gris, avec son prénom : « Guillaume : relancer Anne Leclerc ». Seules vos actions sont en couleur.
- La barre de sélection gagne « Passer le suivi à… » (au-dessus du seuil de S8).
- Une ligne envoyée dans l'ATS affiche l'étape lue dans l'ATS, « Entretien manager (Teamtailor) », et sa prochaine action devient « Changer l'étape dans Teamtailor » (CU-I8).
- Pas de temps réel : relecture au retour sur l'onglet et après chaque geste.

#### Pipeline en équipe : Julie Garnier, membre de Cabinet Altide, 24/09 à 15 h

Même mission que `Main.dc.html`, quand Julie y travaille avec Guillaume. Guillaume a répondu à Marc Moreau à 10 h, lui a passé le suivi à 11 h ; Marc a répondu à 14 h 20 sur la conversation de Guillaume.

```
+- Barre ---------+ +-------------------------------------------------------------------------------+
| À traiter (3)   | | [=] Missions > Directeur financier v · Groupe Hélios  (o) Active            |
| Missions        | |     [ Pipeline ]  Sourcing  Cadrage                       Assistant   ...     |
| Assistant       | +-------------------------------------------------------------------------------+
|                 | | MAINTENANT                                                                    |
| Mission ouverte | | +---------------------------------------------------------------------------+ |
|  Directeur fin. | | | Marc Moreau a répondu à Guillaume Martin à 14 h 20             Note 80    | |
| Mes missions    | | | Il vous a passé le suivi ce matin : « Il est dispo la semaine prochaine,  | |
|  Responsable    | | | tu peux caler la qualif ? »                                               | |
|  paie           | | | « Merci. Julie peut m'appeler jeudi après 16 h. »                         | |
|  Responsable de | | | [ Répondre depuis votre compte ]          Pourquoi maintenant ?  Plus tard| |
|  production     | | +---------------------------------------------------------------------------+ |
|  (confiée)      | | Ensuite : Trier 4 profils de votre recherche du 23/09 · Sophie Dupont :       |
|                 | |           planifier la qualification                                          |
|                 | | Depuis votre passage du 23/09 : Guillaume Martin vous a passé le suivi de     |
|                 | | Marc Moreau et a fait passer Pierre Bertrand en Entretien DG.  Voir ces 2     |
|                 | |                                                                               |
|                 | | EN CE MOMENT                                                                  |
|                 | | Sourcing et contact : À trier 4 · Retenus 0 · Contactés 2 · A répondu 2       |
|                 | | Suivi : Qualification 3 · Entretien DG 2 · Cas pratique 2 · Embauché 1   Éc.3>|
|                 | | [ Afficher : Tous v ]    [ Liste | Par étape ]  Bilan  Prise de contact Client|
|                 | +-------------------------------------------------------------------------------+
|                 | | [ ] Candidat                  Étape          Prochaine action          Dep. Note|
|                 | | [ ] Marc Moreau (JG)          A répondu      Répondre (14 h 20)         1 j  80 |
|                 | | [ ] Sophie Dupont (JG)        A répondu      Planifier la qualification 0 j  71 |
|                 | | [ ] Camille Fontaine (GM)     Entretien DG   Guillaume : lire la réponse d'Anne 6 j 83|
|                 | | [ ] Isabelle Laurent (GM)     Qualification  Aucune action depuis 5 j   5 j  77 |
|                 | | [ ] Nadia David (GM)          Qualification  Guillaume : noter l'entretien 2 j 84|
|                 | | [ ] Claire Dubois (JG)        Contacté       Relance auto le 26/09      3 j  78 |
|                 | | [ ] Julien Roux (GM)          Contacté       Relance auto le 26/09      3 j  74 |
|                 | | ...                                                                          |
|                 | | --- À trier (4) · votre recherche du 23/09 ------------ [ Trier un par un ] ---|
+-----------------+ +-------------------------------------------------------------------------------+
```

Guillaume, au même moment, voit sa propre carte (« Notez l'entretien de Nadia David, aujourd'hui 14 h ») et une ligne d'équipe dans Ensuite : « Marc Moreau a répondu, Julie Garnier s'en occupe ».

#### Pipeline d'une entreprise avec des partenaires : Élise Vasseur, Groupe Ardelle

Mission « Responsable de production, usine de Lyon », « Vous et des recruteurs partenaires ». Élise en est responsable ; Marion Carpentier cherche en interne.

```
| [=] Missions > Responsable de production v · usine de Lyon   (o) Active                            |
|     [ Pipeline ]  Sourcing  Cadrage                                        Assistant   ...         |
| MAINTENANT                                                                                          |
| 3 candidats présentés par vos partenaires attendent votre avis                                      |
| Sébastien Perrin, Cabinet Altide, aujourd'hui · Karine Lemoine, Vauban Conseil, hier ·              |
| Yannick Ferrand, Vauban Conseil, le 21/09                                                           |
| [ Examiner les 3 ]                                           Pourquoi maintenant ?     Plus tard    |
| Ensuite : Hugo Lemaire propose ses services · Fabrice Tessier attend depuis 6 j après l'entretien   |
|           avec Denis Brunet · Marion Carpentier : 2 réponses sans suite depuis 3 j                  |
| EN CE MOMENT                                                                                        |
| Sourcing et contact : À trier 6 · Retenus 0 · Contactés 1 · A répondu 2                             |
| Suivi : Qualification 1 · Entretien usine 1 · Entretien DG 1 · Embauché 0             Écartés 2 >  |
| [ Afficher : Tous v ]                       [ Liste | Par étape ]  Bilan  Prise de contact  Partenaires (2) |
| --- Présentés, à examiner (3) ------------------------------------------ [ Examiner un par un ] -- |
|     Sébastien Perrin   Directeur d'usine adjoint, Tarkett · Cabinet Altide     aujourd'hui 11 h 02  |
|     Karine Lemoine     Responsable production, Valeo · Vauban Conseil          hier                 |
|     Yannick Ferrand    Responsable de fabrication, Danone · Vauban Conseil     le 21/09             |
| [ ] Candidat                     Étape            Prochaine action                    Depuis  Note  |
| [ ] Fabrice Tessier (EV)         Entretien usine  Relancer Denis Brunet               6 j     82    |
|     Responsable de production, Bel · Cabinet Altide                                                 |
| [ ] Cédric Hoarau (EV)           Entretien DG     Aucune action depuis 1 j            1 j     85    |
|     Directeur de production, Lactalis · Vauban Conseil                                              |
| [ ] Laurent Picard (MC)          A répondu        Marion : répondre (3 j)             3 j     79    |
| [ ] Samia Benhamou (MC)          A répondu        Marion : répondre (3 j)             3 j     76    |
| [ ] Romain Faure (MC)            Qualification    Aucune action depuis 3 j            3 j     81    |
| [ ] Élodie Arnaud (MC)           Contacté         Relance auto le 27/09               5 j     74    |
```

La barre d'outils remplace « Client » par « Partenaires (2) » : Élise est le client. Le Bilan se lit par origine, sur les jalons datés (S §3.3) : « Cabinet Altide : 3 présentés, 1 reçu en entretien, 1 écarté. Vauban Conseil : 4 présentés, 1 reçu en entretien, 1 déjà connu. Interne : 4 contactés, 3 ont répondu. »

**Examiner un par un** (mode de S §5.2) : le candidat, l'argumentaire du partenaire, la date et la priorité de la présentation, le parcours transmis, « Noter sur vos critères (au moins 2 crédits) ». Trois décisions : « Recevoir en entretien » (étape présélectionnée, plus « Qui organise ? le partenaire, par défaut, ou nous » et « Disponibilités de l'intervieweur », CU-I7) ; « Écarter » (motif, « partagé avec le partenaire » coché) ; « Plus tard ». Un message au partenaire, facultatif. Avec un ATS relié, « Recevoir en entretien » est aussi le moment où le candidat part dans l'ATS (CU-I8).

#### Pipeline d'un partenaire sur une mission liée : Julie Garnier, Cabinet Altide

```
| [=] Missions > Responsable de production v · Groupe Ardelle · confiée par Groupe Ardelle  (o) Active|
| MAINTENANT                                                                                          |
| Groupe Ardelle a écarté Nadège Colas, hier                                                          |
| « Prétentions au-dessus de notre fourchette. »                                                      |
| [ Prévenir Nadège Colas ]                                   Pourquoi maintenant ?     Plus tard     |
| Ensuite : Fabrice Tessier chez Groupe Ardelle depuis 6 j : relancer Élise Vasseur ·                 |
|           Présenter Mathis Carré ?                                                                  |
| EN CE MOMENT                                                                                        |
| Sourcing et contact : À trier 12 · Retenus 2 · Contactés 1 · A répondu 0                            |
| Chez vous : Qualification 1        Chez Groupe Ardelle : À l'examen 1 · Entretien usine 1 ·         |
|                                    Entretien DG 0 · Embauché 0                            Écartés 1 >|
| Candidat              Étape                                  Prochaine action          Depuis  Note  |
| Sébastien Perrin      Chez Groupe Ardelle · à l'examen       Présenté aujourd'hui      0 j     84    |
| Fabrice Tessier       Chez Groupe Ardelle · Entretien usine  Relancer Élise Vasseur    6 j     82    |
| Mathis Carré          Qualification                          Présenter à Groupe Ardelle ? 5 j  80    |
| Anthony Faivre        Contacté                               Relance auto le 26/09     3 j     73    |
```

Les étapes « Chez Groupe Ardelle » appartiennent à l'entreprise : ce n'est pas un verrou, l'action proposée est une relance, pas un déplacement. Si l'entreprise ne partage pas le nom de ses étapes : « Chez Groupe Ardelle · en entretien ». Si l'avancement ne répond pas : « Avancement chez Groupe Ardelle indisponible », jamais un zéro.

#### Pipeline avec des connexions : Guillaume Martin, 24/09 à 10 h

Gmail et Google Agenda reliés (CI §2.3, sans WhatsApp relié, décision 24). La carte prend le rang 1, Ensuite les réponses :

```
| Entretien avec Nadia David aujourd'hui à 14 h                                      Note 84        |
| Dans votre Google Agenda, avec nadia.david@gmail.com · visio                                       |
| [ Préparer l'entretien ]                                  Pourquoi maintenant ?     Plus tard      |
| Ensuite : Marc Moreau vous a répondu hier · Julien Roux vous a répondu par e-mail ·                |
|           Anne Leclerc a répondu sur Camille Fontaine                                             |
| Nadia David         Qualification   Entretien à 14 h (agenda)       2 j   84                        |
| Marc Moreau         A répondu       Répondre (LinkedIn, hier)       1 j   80                        |
| Julien Roux         A répondu       Répondre (e-mail, 8 h 51)       0 j   74                        |
| Camille Fontaine    Entretien DG    Lire la réponse d'Anne Leclerc  6 j   83                        |
| Thomas Lambert      Qualification   Rappeler avant 17 h             2 j   81                        |
|   Head of FP&A, Sodexo · Vivier Altide                                                             |
```

Sans agenda relié, la carte est celle de la maquette validée (Marc Moreau). Julien Roux passe « A répondu » parce que sa réponse arrive sur une conversation e-mail ouverte depuis la mission, et sa relance du 26/09 est annulée.

### 2.2 Liste des missions

La règle de Maintenant, devenue personnelle, ne doit pas cacher ce qui traîne chez les collègues (CU-B4). Au-dessus du seuil « deux personnes dans l'organisation » :
- la colonne « Prochaine action » montre l'action la plus urgente de la mission, quel que soit son destinataire, avec ses initiales et son âge ; les vôtres en couleur, les autres en gris ;
- un filtre « En attente depuis plus de 2 jours ouvrés », pour les propriétaires, administrateurs et responsables de mission. Aucun compte par personne, aucun classement ;
- une colonne et un filtre « Responsable » ;
- une mission liée porte « confiée par Groupe Ardelle » ; une mission avec partenaires, « 2 partenaires ».

```
Missions                     [ Responsable : Tous v ]  [ En attente depuis plus de 2 jours ouvrés (1) ]
Mission                               Resp.  Prochaine action                          Depuis
Directeur financier · Groupe Hélios   GM     Noter l'entretien de Nadia David          aujourd'hui
Responsable paie · Groupe Hélios      JG     JG · Aucune action depuis 4 j             4 j
Chef de projet data · Banque Delmas   KB     KB · 4 réponses sans suite                3 j
Contrôleur de gestion · Maison Arvel  KB     KB · Trier 12 profils                     1 j
Responsable de production             JG     JG · Prévenir Nadège Colas                1 j
  Groupe Ardelle · confiée par Groupe Ardelle
```

La même liste sert à suivre les honoraires : un filtre « Honoraires à facturer » (lot H), plutôt qu'un écran nouveau.

### 2.3 Fiche candidat

Quatre onglets, comme S §4.4 : Aperçu, Échanges, Évaluations, Profil. Aucun onglet ajouté.

**En tête, sous l'étape**, une ligne au plus par sujet, chacune seulement si sa source existe :
- « Suivi par Guillaume Martin · Passer le suivi à… » (au-dessus du seuil de S8) ; après une passation, le mot de passation une fois ;
- les coordonnées connues, avec leur source : « julien.roux.pro@gmail.com · trouvée le 23/09 · Écrire ». **Ce qui manque ne s'affiche pas ici** : ni « Téléphone inconnu », ni « Trouver » (en formule gratuite, l'enrichissement est fermé, `featureGates.ts:79`). Le manque se dit dans Contacter, là où l'on choisit le canal (CU-I10). Aujourd'hui la fiche de la mission reçoit `email: null, phone: null` en dur (`MissionPipeline.tsx:631-632`) ;
- « Contacté par Julie Garnier le 12/09 » (S9) ;
- « Ne plus contacter · a répondu STOP le 12/09 », qui remplace les boutons d'envoi (lot R) ;
- côté entreprise : « Présenté par Cabinet Altide (Julie Garnier) le 17/09, en premier · aussi présenté par Vauban Conseil le 22/09 » ;
- côté partenaire : « Chez Groupe Ardelle : Entretien usine depuis 6 j ».

**Aperçu.**
- « Vos notes » devient « Notes de l'équipe » au-dessus du seuil, avec mention « @ » par identifiant (lot E2). Les notes « Perso », lisibles par tous en réalité et absentes de la production, disparaissent (LE §8, MP §6).
- Tâches : « + Ajouter une tâche », « Pour : Vous v » quand l'organisation a deux personnes.
- « Dans Vivier Altide : fiche du 14/03/2024, « Bon profil, pas mobile à l'époque » » ; « Dans Teamtailor : candidature du 12/03/2025 au poste Acheteur projets, refusé à l'Entretien RH · à jour il y a 2 h ». Au plus trois lignes, aucune sans source reliée.
- Côté entreprise, pour un présenté : l'argumentaire, les décisions, et « Avis au partenaire » (verdict et texte, envoyés au seul partenaire de la présentation). Contacter directement ce candidat reste possible, avec : « Fabrice Tessier vous a été présenté par Cabinet Altide le 17/09. Le cabinet organise les échanges avec lui. »

**Échanges devient le journal** (S4), lu par `get_candidate_feed` :
- toutes les entrées, tous canaux, chacune avec son canal, son sens, son auteur et sa date ; bascule « Cette mission | Toutes » ;
- une conversation tenue par un collègue s'annonce en tête : « La conversation LinkedIn est sur le compte de Guillaume Martin. Vous voyez ici les extraits rattachés à cette mission. » (décision 20) ;
- en bas, un compositeur : « Répondre par ( E-mail | LinkedIn ) », le canal de la dernière réponse proposé d'abord ; un canal indisponible reste visible, grisé, avec sa raison ; « WhatsApp » ouvre l'application WhatsApp, puis « Noter l'échange » (décision 24) ;
- avec un agenda relié, trois créneaux libres proposés dans la réponse.

```
+-- Julien Roux ---------------------------------- 3 sur 12   ^  v   x --+
| Contrôleur financier groupe, OPmobility · Levallois-Perret · Note 74     |
| A répondu, ce matin, par e-mail                                          |
| [ Répondre ]  [ Étape suivante > ]                                       |
| julien.roux.pro@gmail.com · trouvée le 23/09              Écrire         |
| Aperçu · [Échanges] · Évaluations · Profil                               |
| [ Cette mission ]  Toutes                                                |
| 24/09 8 h 51   E-mail reçu sur guillaume@altide.fr                       |
|                « Merci Guillaume, je peux vous appeler vendredi matin ?  |
|                Je suis en déplacement jusqu'à jeudi. »                   |
| 24/09 8 h 51   Relance du 26/09 annulée : Julien a répondu               |
| 23/09 17 h 02  E-mail envoyé depuis guillaume@altide.fr                  |
|                Objet : Directeur financier, groupe industriel            |
| 23/09          Adresse e-mail trouvée                                    |
| 21/09          Message LinkedIn, « Approche Directeur financier », 2 sur 3|
| 19/09          Invitation LinkedIn acceptée, 1 sur 3                     |
| Répondre par  [ E-mail ]  LinkedIn   WhatsApp (numéro inconnu)           |
| [ Bonjour Julien, vendredi 11 h me convient. ...                     ]  |
| Créneaux libres : ven. 26/09 9 h 30 · 11 h · 14 h 30                     |
| Depuis guillaume@altide.fr        Rédiger avec l'assistant   [ Envoyer ]|
+--------------------------------------------------------------------------+
```

**Appeler et noter l'appel** (lot I2). « Appeler » est un lien `tel:`. Au retour, « Noter l'appel » s'ouvre sur place : résultat (Joint, Messagerie, Pas de réponse), note, rappel (une tâche pour soi, rang 8), étape (par `set_candidate_stage`). Un appel noté vaut « Déjà contacté ». C'est l'ajout le plus utile au recruteur seul (CU §1.3).

**Évaluations** : les grilles de toute l'équipe, rangées par étape d'entretien de la mission, avec une ligne de synthèse (« 2 avis : 1 favorable, 1 réservé »). « Demander un avis à… » accepte un membre ou une adresse e-mail (lot 6). Un accès limité ne voit les grilles des autres qu'après avoir rendu la sienne (CU-B5). Côté entreprise, les grilles internes ne sont jamais partagées avec un partenaire, sauf par un « Avis au partenaire » explicite.

**Profil** : une ligne « Origine de ce profil » (LinkedIn le 18/09, Vivier Altide le 02/09), avec leur fraîcheur.

### 2.4 Panneaux et fenêtres

Aucun panneau nouveau pour l'équipe ni pour les connexions. Un panneau nouveau pour les partenaires (« Partenaires »), et un panneau d'import dans le Sourcing (section 2.5).

**« Passer le suivi à… »**, fenêtre ancrée au bouton, dans la fiche et la barre de sélection :

```
+ Passer le suivi de Marc Moreau à… -----------------------------+
| (o) Julie Garnier       suit 2 candidats ici                   |
| ( ) Sarah Lopez         pas dans l'équipe : elle y sera ajoutée|
| ( ) Karim Benali        pas dans l'équipe : il y sera ajouté   |
| Un mot pour Julie (facultatif)                                 |
| [ Il est dispo la semaine prochaine, tu peux caler la qualif ?]|
| [x] Prévenir Marc Moreau                                       |
|     « Bonjour Marc, Julie Garnier, ma collègue, prend le       |
|       relais sur ce poste. Elle vous écrit très vite. »        |
|     Envoyé depuis votre compte LinkedIn.                       |
| Ses prochaines réponses iront à Julie.                         |
| [ Annuler ]                              [ Passer le suivi ]   |
+----------------------------------------------------------------+
```

Le message de relais est un envoi : il ne part qu'avec ce clic explicite (S §5.2). Le changement de responsable s'annule pendant quelques secondes ; le message, non.

**Prise de contact : le choix du canal** (structure au lot 5 avec LinkedIn seul, e-mail au lot I1).

```
+-- Contacter 2 candidats ------------------------------------ x --+
| Laure Michel · Nicolas Fournier                                   |
| CANAL                                                             |
| (o) LinkedIn    2 sur 2 · séquence « Approche Directeur           |
|                 financier », depuis votre compte                  |
| ( ) E-mail      1 sur 2 · depuis guillaume@altide.fr              |
|                 Nicolas Fournier : adresse inconnue.              |
|                 [ Trouver son adresse (1 crédit) ]                |
| APERÇU DU PREMIER MESSAGE, POUR NICOLAS FOURNIER                  |
| « Bonjour Nicolas, je recrute le directeur financier d'un groupe  |
|   industriel familial… »                                          |
| [ ] Je confirme les destinataires                      [ Lancer ] |
+-------------------------------------------------------------------+
```

- Chaque canal dit combien il atteint, depuis quel compte, et pourquoi il en manque. L'e-mail n'apparaît que si une boîte est reliée. « Trouver son adresse » n'apparaît que si la formule l'ouvre.
- Une séquence peut mêler les canaux ; l'aperçu dit, étape par étape, qui sera sauté.
- Une séquence de mission est partagée ; chaque inscription part du compte de la personne qui inscrit.
- Les exclus portent le nom de qui a contacté (S9).

**Client, deux variantes.**
- Client hors Konekt : le panneau validé (S §5.5), avec « Relancer » selon S10 et les conditions avec le client en bas pour les propriétaires et administrateurs (lot H).
- Client sur Konekt (mission liée, lot P2) :

```
+-- Groupe Ardelle · Responsable de production ------------ x --+
| Groupe Ardelle utilise Konekt : vos présentations lui          |
| arrivent directement. Interlocutrice : Élise Vasseur           |
| PRÉSENTER À GROUPE ARDELLE                                     |
| [x] Mathis Carré   Qualification · Note 80                     |
| Argumentaire, visible par Groupe Ardelle                       |
| [ Chef de production chez Sodiaal, 80 personnes en 3x8 ... ]   |
|                              [ Rédiger avec l'assistant ]      |
| Groupe Ardelle reçoit : nom, poste actuel, parcours, adresse   |
| LinkedIn, votre argumentaire.                                  |
| [ ] Joindre ses coordonnées     [ ] Joindre son CV             |
| [ ] Mathis Carré a accepté d'être présenté à Groupe Ardelle    |
|     (obligatoire)                                              |
| 18 % du fixe annuel · garantie 3 mois · antériorité 6 mois     |
| [ Présenter ]                                                  |
| AVIS REÇUS                                                     |
| Élise Vasseur sur Nadège Colas · 23/09 · écartée               |
| ÉCHANGES AVEC GROUPE ARDELLE                               >   |
| HONORAIRES   Visibles par Guillaume Martin et Sarah Lopez      |
+----------------------------------------------------------------+
```

Après l'envoi, la réponse du serveur, en clair : « Présenté le 24/09 à 15 h 12. Vous êtes le premier recruteur à présenter Mathis Carré pour ce poste. » ; ou « Ce candidat avait déjà été présenté pour ce poste. Votre présentation est enregistrée, sans priorité. » ; ou « Ce candidat est déjà connu de Groupe Ardelle. Votre présentation est enregistrée, sans priorité. » Ni le nom ni la date de l'autre partenaire.

**Partenaires** (entreprise, lot P1), dans la barre d'outils à la place de « Client » :

```
+-- Partenaires · Responsable de production -------------- x --+
| Vous et des recruteurs partenaires       Conditions dans Cadrage >|
| 18 % du fixe annuel · garantie 3 mois · antériorité 6 mois     |
| Présentations jusqu'au 31/10 · 2 partenaires sur 3 au plus     |
| PROPOSITION À EXAMINER                                         |
| Hugo Lemaire · recruteur indépendant, Lille · Marketplace      |
| « Directions de production agroalimentaire depuis 2015. »      |
| Nouveau sur la Marketplace         [ Accepter ]  [ Refuser ]   |
| PARTENAIRES SUR LE POSTE                                       |
| Cabinet Altide · invité, accepté le 08/09                    > |
|   3 présentés · 1 reçu en entretien · 1 à examiner · 1 écarté  |
| Vauban Conseil · Marketplace, accepté le 15/09               > |
|   4 présentés · 1 reçu en entretien · 2 à examiner · 1 déjà connu|
| Inviter un partenaire : section Partenaires de Cadrage     >   |
+----------------------------------------------------------------+
```

Les conditions et les montants ne s'affichent qu'aux propriétaires, administrateurs et au responsable de la mission ; les autres lisent « Des partenaires travaillent ce poste » (CU-I4, CF-I13). Un clic sur un partenaire ouvre, dans le même panneau, ses présentations, le fil « Échanges avec Cabinet Altide » et « Mettre fin à la collaboration » (AlertDialog).

**Assistant.** Il lit avec les droits de la personne qui lui parle, par la même règle que l'écran (S8 ; aujourd'hui il en applique une autre, `agent-tools-reads.ts:17-30, 115-150`). Ce qu'il trouve dans une boîte ou un Notion reste dans la conversation, sauf clic « Ranger sur Camille Fontaine », qui passe par la carte d'approbation existante et dit qui verra la note. L'outil de rangement est « jamais automatique ».

### 2.5 Sourcing

- « Chercher dans » en tête du panneau de filtres, pas au-dessus des résultats : « LinkedIn · Base Konekt · Vivier Altide 2 140 ». Affiché si l'organisation a au moins deux sources (CU-I10).
- « Votre vivier : 3 personnes correspondent · Voir » dans la ligne de résultats, seulement après une recherche et si le nombre est positif.
- Une mention au plus par résultat, sur l'identité de S1 : « Déjà dans la mission : A répondu » ; « Contactée par Julie Garnier le 12/09 (mission Responsable paie), sans réponse » ; « Dans Vivier Altide : … » ; « Dans Teamtailor : … » ; côté entreprise, « Présenté par Cabinet Altide le 17/09 ».
- Les décisions de toute l'équipe : le Sourcing lit les lignes de tous, pas seulement les miennes (`useJobCandidateStatus.ts:104-109`), et « Résultats du 23/09 · recherche de Julie Garnier » quand la recherche affichée est celle d'un collègue.
- Toujours votre compte LinkedIn. Un membre sans compte voit « Pour chercher des profils, reliez votre compte LinkedIn », et non plus les comptes de ses collègues (`useFilteredLinkedInAccounts.ts:27-32`).
- Importer un fichier : un panneau à droite, sans quitter le Sourcing (lot I5). Correspondance des colonnes proposée par les en-têtes ; « Où les ranger : dans le vivier de Cabinet Altide, ou réservé à cette mission » (réservé par défaut depuis une mission) ; ce que Konekt a trouvé (lignes avec une identité, dont déjà connues, et sans) ; « Vous êtes responsable de ces données. Konekt les garde au plus 24 mois sans activité. » Les personnes importées n'entrent pas dans le Pipeline : retenir l'une d'elles crée la ligne. Rien d'importé ne part vers l'IA sans un clic « Noter ». La liste des imports vit dans Paramètres > Outils.
- Budget d'encombrement de S §5.1 recompté sur le banc de captures avant le lot I5.

```
| Chercher dans : [ LinkedIn ]  Base Konekt  Vivier Altide 2 140        Importer un fichier    |
| Affiner : [ DAF groupe industriel, IFRS, LBO, Île-de-France            ]   Filtres (6)          |
| Résultats du 24/09 · 25 profils · Votre vivier : 3 personnes correspondent · Voir              |
| [ ] Laure Michel · Directeur administratif et financier, Legrand · Paris          Note 69      |
|     Recommandée · consolidation IFRS, équipe de 10+                                            |
| [ ] Aurélie Vincent · Responsable comptable, Fnac Darty · Ivry-sur-Seine          Note 58      |
|     Contactée par Julie Garnier le 12/09 (mission Responsable paie), sans réponse              |
| [ ] Nicolas Fournier · Directeur financier, Somfy · Cluses                        Note 62      |
|     Dans Vivier Altide : fiche du 14/03/2024, « Bon profil, pas mobile à l'époque »            |
| [ ] Marc Moreau · Directeur administratif et financier, Schneider Electric                     |
|     Déjà dans la mission : A répondu                                                           |
```

### 2.6 Cadrage

**Le poste** gagne deux lignes :
- « Qui recrute ? » (S7), quatre choix, pré-rempli ;
- « Conditions avec le client » (missions pour un client, lot H) : pourcentage ou forfait, base, garantie. Visibles des propriétaires, administrateurs et du responsable.

**Étapes d'entretien** : l'intervieweur se choisit parmi « un membre », « le responsable du candidat », « une personne hors Konekt » (nom et adresse e-mail, pour l'avis par lien du lot 6).

**Équipe et partenaires** remplace « Équipe et recruteurs externes » (S §5.6), avec une seule porte (CU-B1, CF-I5) :

```
ÉQUIPE ET PARTENAIRES
Responsable de la mission   (GM) Guillaume Martin                      [ Changer de responsable ]
Équipe                      (GM) Guillaume Martin   responsable
                            (JG) Julie Garnier      ne suit aucun candidat          Retirer
[ Inviter… ]  Une personne de Cabinet Altide · Une personne hors de Cabinet Altide (accès limité)
              · Un recruteur partenaire (cabinet ou indépendant)
[ ] Mission confidentielle : visible seulement de son équipe et du propriétaire
```

- Les rôles de mission Lead, Sourcer, Account Manager, Reviewer disparaissent : rien ne les lit (LE §4). Il reste « responsable » et « équipe ».
- « Un recruteur partenaire » fait passer « Qui recrute » à « Vous et des recruteurs partenaires » et ouvre la section Partenaires. Pour un cabinet ou un indépendant, c'est la co-traitance ; la base des conditions devient « part des honoraires facturés au client » (CU-I3). C'est la seule porte : le panneau Partenaires et une future page publique y renvoient.
- Pour qui est seul : « Responsable : vous » replié et « Inviter… ».
- « Modifié par Julie Garnier le 23/09 » sous le titre d'une section modifiée par un autre que vous (lot E2).

**Partenaires** (entreprise, visible en « Des recruteurs partenaires » et « Vous et des recruteurs partenaires », lot P1) :

```
PARTENAIRES
Conditions proposées. Elles s'appliquent aux prochains partenaires : Cabinet Altide et
Vauban Conseil gardent les leurs.
  Honoraires [ 18 ] % du [ fixe annuel v ]   Garantie [ 3 mois v ]   Antériorité [ 6 mois v ]
  Présentations jusqu'au [ 31/10/2026 ]      Partenaires au plus [ 3 ]
Ce que voient les partenaires                          | Aperçu : ce que lit un partenaire
  [x] Intitulé, contrat, lieu                          | Responsable de production
  [x] Critères                                         | Groupe agroalimentaire, 800 salariés
  [x] Noms des étapes d'entretien                      | Saint-Priest · CDI · 65 à 75 k€
  Rémunération  ( ) masquée (o) fourchette ( ) exacte  | Critères : management d'équipes
  Nom de l'entreprise ( ) dès l'annonce (o) après accord|  postées (indispensable) · ...
Jamais partagé : vos notes, vos candidats, vos consignes de messages, les autres partenaires.
[ Inviter un partenaire par e-mail ]     [ Publier sur la Marketplace ]  formule Entreprise
```

- Visible et modifiable par les propriétaires, administrateurs et le responsable. Les critères d'une mission confiée se modifient par eux seuls ; les partenaires reçoivent un seul avis groupé par jour avec « Recalculer » (CU-I4).
- Jusqu'au lot P2, les deux boutons sont masqués (décision 17).

**Mission liée, côté partenaire** : un bloc « Défini par Groupe Ardelle », en lecture (intitulé, contrat, lieu, rémunération selon le choix de l'entreprise, critères, étapes si partagées, conditions acceptées le 08/09), et ses propres blocs modifiables (« Vos messages » avec le rôle « Consultant du cabinet », ses notes, ses étapes avant présentation, son équipe). Le ton des messages suit l'expéditeur, pas l'entreprise (LM §5). « Se retirer de la mission » dans le menu « ... ».

**Mission liée à un ATS** (lot I6a) : « Lié à Teamtailor : Responsable achats (H/F), Lyon · réf. 1187 · à jour il y a 2 h · Ouvrir dans Teamtailor · Détacher de Teamtailor » ; « Candidatures reçues dans Teamtailor : les ajouter à À trier » (décochée par défaut) ; « Envoyer dans Teamtailor : au passage en entretien » ; la correspondance des étapes, proposée par les libellés et confirmée par une personne.

### 2.7 Création

Toujours « une fenêtre, un champ, une validation » (S §6), sans question nouvelle (CU-I5).
- Une seule ligne récapitulative dans « Voici ce que j'ai compris », modifiable : « Pour Groupe Hélios » ; « suivi par vous » seulement si l'organisation a au moins deux personnes.
- Avec un ATS relié, un lien replié « Partir d'un poste de Teamtailor », qui liste les postes publiés et grise celui déjà lié. Choisir un poste remplit le texte de l'annonce, puis passe par la même analyse. La mission naît liée (S5).
- Une mission liée ne se crée jamais à la main : elle naît de l'acceptation d'une invitation ou d'une proposition.

### 2.8 Barre latérale et messagerie

**À traiter** garde son chiffre unique :
- « Réponses » : LinkedIn et, au lot I1, e-mail, avec l'icône du canal, même règle (votre compte, 3 jours ouvrés) ;
- « De vos collègues » : suivi passé, avis demandé, mention (lot E1) ;
- « Vos partenaires » : présentations reçues (responsable de la mission), propositions et invitations (propriétaire et administrateurs), messages de collaboration, décision de l'entreprise (partenaire) ;
- les pannes : boîte ou agenda pour leur titulaire, ATS pour les propriétaires et administrateurs.

```
+----------------------------------+
| À traiter (3)  Missions  Assistant|
| RÉPONSES                          |
| [in] Marc Moreau        14 h 20   |
|      Directeur financier          |
| DE VOS COLLÈGUES                  |
| Guillaume Martin vous a passé     |
|   le suivi de Marc Moreau  11 h   |
| VOS PARTENAIRES                   |
| Groupe Ardelle a écarté           |
|   Nadège Colas            hier    |
|   Responsable de production       |
+----------------------------------+
```

**Missions** : « Mes missions » = celles dont je suis responsable ou membre de l'équipe (`owner_id` au lieu de `created_by`, `sidebarMissions.ts:264-276`). Une mission liée affiche le nom de l'entreprise et « confiée ». Plus de section « Missions partenaires » : une mission liée est une mission de l'organisation.

**Bas de barre** : l'entrée Marketplace suit le statut (organisation partenaire, ou entreprise qui publie), pas le type d'organisation (`SidebarBottomRow.tsx:43`).

**Messagerie** : au lot I1, une rangée « Tous · LinkedIn · E-mail », limitée aux conversations du registre dont vous êtes le titulaire, avec des candidats ou interlocuteurs connus. Elle ne devient pas une boîte e-mail. Le titre « Messagerie LinkedIn unifiée » (`Inbox.tsx:82`) change.

### 2.9 Paramètres

**Mon compte > Connexions** : une carte par canal personnel, qui dit ce qu'il change dans les missions.

```
LinkedIn        Relié · Guillaume Martin                                            Gérer
                Dans vos missions : recherche, messages, réponses dans Maintenant.
Boîte e-mail    Reliée · guillaume@altide.fr (Gmail)                                Gérer
                Envoyer depuis votre adresse, réponses dans la fiche et dans Maintenant,
                relances de vos clients. Konekt ne garde que les échanges avec vos
                candidats et les fils ouverts depuis Konekt avec vos interlocuteurs.
Agenda          Relié · Google Agenda de guillaume@altide.fr                        Gérer
                Vos entretiens dans Maintenant, invitations envoyées depuis la fiche,
                créneaux libres proposés dans vos réponses.
WhatsApp        « Écrire sur WhatsApp » ouvre l'application. Notez l'échange ensuite.
Téléphone       Rien à relier. « Appeler » ouvre votre téléphone ; notez l'appel.
[ ] Mes collègues peuvent envoyer les messages de leurs séquences depuis mon compte
Absent jusqu'au [ jj/mm ]   remplacé par [ Choisir v ]
```

**Mon organisation > Outils**, rubrique nouvelle qui reprend le bloc « outils » de Général (`GeneralSection.tsx:112`) ; propriétaire et administrateur en écriture, membres en lecture :

```
SOURCES DE CANDIDATS
Base Konekt      Activée                                                            Gérer
Vivier Altide    2 140 personnes · importé le 02/09 par Guillaume Martin
                 Mettre à jour · Supprimer
[ Importer un fichier ]
LOGICIEL DE RECRUTEMENT
Aucun relié.   [ Relier votre logiciel de recrutement ]  Teamtailor · Welcome to the Jungle · Flatchr
Dans vos missions : créer une mission depuis un poste, voir « Dans Teamtailor » sur un profil,
envoyer un candidat, suivre son étape et l'embauche.
Votre outil n'est pas dans la liste ?  Dites-le-nous
```

Chez Groupe Ardelle : « Teamtailor · relié le 15/09 par Élise Vasseur · à jour il y a 2 h · 1 240 personnes lues · Correspondance des étapes · Détacher ». Connexion interrompue : « Reconnecter », dans la carte même. « Dites-le-nous » enregistre l'outil demandé : c'est la mesure des connecteurs suivants.

**Mon organisation > Équipe** : chaque membre avec son rôle, l'état de ses comptes et le nombre de missions dont il est responsable ; le formulaire d'invitation décrit les rôles en une phrase (« Accès limité : seulement les missions où vous l'ajoutez ») ; « Retirer… » ouvre le départ d'un membre (lot E4) : successeur, ce qui lui est confié, ce qui s'arrête (envois, séquences mises en pause), ce qui reste sur son compte. Le départ enchaîne « Dissocier » (`unipile-accounts/index.ts:1045-1213`) avant le retrait de l'appartenance, sinon une réponse arrivée ensuite se perd (`unipile-webhook/index.ts:1286-1297`).

**Mon organisation > Général** : « Votre fiche sur la Marketplace » (partenaire : titre, présentation, spécialités, zones, page publique désactivée par défaut) ; « Recruter avec des partenaires » (entreprise : conditions par défaut). Lot P4.

### 2.10 Marketplace

Un seul nom, « Marketplace », libellé déjà décidé de la barre ; dans la mission, on parle de « recruteurs partenaires » (CU-I13).
- Jusqu'au lot P2 (décision 17) : la page montre l'adhésion et son état, rien d'autre. La demande en attente depuis le 08/09 reste en attente.
- Côté partenaire, ensuite : Missions à pourvoir (poste réduit, conditions, places ; nom de l'entreprise après accord si elle l'a choisi), Vos propositions, Missions confiées. Un membre ne propose pas : son bouton dit « Suggérer à Guillaume Martin ».
- Côté entreprise : « Vos partenaires », toutes missions, avec leurs présentations. Remplace `EnterpriseHuntMissions.tsx`.
- Honoraires : pas d'onglet propre à la Marketplace ; le filtre « Honoraires à facturer » de la liste des missions couvre toutes les missions, confiées ou non (lot H, CU-I3).

Vue de Hugo Lemaire, indépendant, après le lot P2 :

```
Marketplace        [ Missions à pourvoir ]  Vos propositions (1)  Missions confiées (0)
Responsable qualité
Groupe agroalimentaire, 800 salariés · nom communiqué après accord
Saint-Priest · CDI · 55 à 62 k€ · Management qualité en usine · Agroalimentaire
18 % du fixe annuel · garantie 3 mois · antériorité 6 mois · présentations jusqu'au 15/11
3 places sur 3                                                 [ Proposer vos services ]
```

« Vos propositions (1) » : Responsable de production, envoyée le 24/09, en attente.

### 2.11 Pages hors de la mission

**Invitation d'un partenaire reçue par un membre** (CU-I6). L'acceptation exige l'adresse de l'invité (`accept-mission-invitation/index.ts:80-81`) et engager un cabinet revient à son propriétaire ou administrateur :

```
Groupe Ardelle vous confie un poste
Élise Vasseur, responsable recrutement, vous propose de présenter des candidats pour :
Responsable de production · Saint-Priest · CDI · 65 à 75 k€
Conditions : 18 % du fixe annuel · garantie 3 mois · antériorité 6 mois · jusqu'au 31/10
Vous cherchez avec vos outils, dans une mission de votre espace. Vous présentez les candidats
de votre choix : Groupe Ardelle ne voit que ceux-là.
Accepter au nom de Cabinet Altide demande l'accord de Guillaume Martin, propriétaire.
[ Refuser ]                                              [ Demander son accord ]
```

Le propriétaire accepte d'un clic depuis À traiter, et le membre devient responsable de la mission liée. « Un nouvel espace pour votre cabinet » n'est proposé qu'à une personne qui n'appartient à aucun cabinet sur Konekt ; cet espace ne consomme pas l'essai unique de la personne (aujourd'hui toute création d'organisation l'ouvre, `20260906181806_p0_plans_trial_seats.sql:94-128`) et ses missions liées ne comptent pas dans le plafond de missions (`useQuotaGate.ts:31-37`).

**Donner mon avis, sans compte** (lot 6, CU-B5). Un lien personnel, par mission et par personne, sur le mécanisme du portail client, valable 30 jours :

```
Groupe Ardelle · Responsable de production · Entretien usine
Élise Vasseur vous demande votre avis sur Fabrice Tessier, rencontré le 18/09.
Fabrice Tessier · Responsable de production, Bel · Lons-le-Saunier
Management d'équipes postées   ( ) Oui ( ) En partie ( ) Non
Amélioration continue          ( ) Oui ( ) En partie ( ) Non
Agroalimentaire ou chimie      ( ) Oui ( ) En partie ( ) Non
Votre avis   ( ) Favorable  ( ) Réservé  ( ) Défavorable
[ Commentaire                                                  ]
[ Envoyer mon avis ]
```

La page ne montre ni les autres candidats, ni les autres grilles, ni le Cadrage. L'avis revient comme une grille signée « Denis Brunet, par lien ». Aucun siège.

### 2.12 Téléphone

Mêmes règles que S §7 : un seul élément fixe en bas, fiche et « un par un » plein écran.
- En équipe, la première puce est « Les miens » ; « Passer le suivi à… » est dans le menu « ... » de la fiche.
- Chez une entreprise, la carte « 3 candidats présentés » ouvre l'examen un par un plein écran, décisions au-dessus du pouce.
- « Appeler » ouvre le composeur ; au retour, « Noter l'appel » monte en feuille, déjà datée. « WhatsApp » ouvre l'application et dit : « Ce message ne sera pas enregistré dans Konekt. Notez-le après l'envoi. »

```
+--------------------------------+
| [=](3)  Directeur financier v  |
| [Pipeline] Sourcing  Cadrage   |
| MAINTENANT                     |
| Marc Moreau a répondu à        |
| Guillaume Martin à 14 h 20     |
| Pourquoi ?          Plus tard  |
| Ensuite : Trier 4 profils · 1 >|
| [Les miens] [Tous] [A répondu]>|
| Marc Moreau        (JG)    80  |
| A répondu · Répondre           |
| Sophie Dupont      (JG)    71  |
| A répondu · Planifier          |
| [ Répondre depuis votre compte]|
+--------------------------------+
```

---

## 3. Modèle de données et règles d'accès

### 3.1 Principes

1. Une identité (S1), une ligne par mission (S2), un journal (S4), un identifiant externe (S5). Aucune seconde copie d'un même fait.
2. Écritures sensibles par fonctions serveur, avec l'organisation de la mission (S11).
3. Une colonne se pose dans le lot qui s'en sert : une colonne nullable s'ajoute instantanément (CF-I3).
4. Retirer en deux temps : le code cesse de lire, puis une migration suivante supprime la table. Migrations et fonctions se déploient par deux workflows sans ordre entre eux (`deploy-migrations.yml`, `deploy-edge-functions.yml`, aucun `needs`), CF-B2, CF-I11.
5. Chaque fonction retirée demande `supabase functions delete <nom> --project-ref crckfywoyjxkawathdff` après fusion (CLAUDE.md).

### 3.2 Tables et colonnes

| Objet | Contenu | Lot |
|---|---|---|
| `candidate_identities` (nouvelle) | `organization_id`, `person_id`, `kind`, `value` ; unique `(organization_id, kind, value)` | 0a |
| `job_candidate_status` | `person_id` ; unique `(project_id, person_id)` en trois déploiements (section 5) ; `project_id NOT NULL` après vérification | 0a |
| | `owner_user_id` (responsable du candidat) | E1 |
| | `origin_kind`, `origin_ref` | I5, I6a, P2 ou I8, le premier livré |
| `candidate_contacts` | clé `(organization_id, person_id)` au lieu de `(organization_id, candidate_id)`, même méthode en trois temps | 0a |
| | `email_source`, `phone_source`, dates, `alt_emails`, `alt_phones` | I1 |
| | `do_not_contact_at`, `do_not_contact_by`, `do_not_contact_reason` | R |
| `mission_events` (nouvelle) | faits sans contenu : `stage_changed`, `lines_merged` (0a) ; `owner_changed`, `mission_owner_changed`, `team_added`, `team_removed` (E1) ; `brief_changed` (E2) ; `task_assigned`, `task_done` (E3) ; `evaluation_requested`, `evaluation_added` (6) ; `presented`, `partner_decision` (P2) ; `hired` (H). Aucun extrait. Aucune insertion par `authenticated` | 0a, puis chaque lot |
| `candidate_threads` (nouvelle) | titulaire, canal, compte, identifiant de conversation, mission, `mission_state` (`linked`, `to_attach`, `none`), `counterpart_kind` (`candidate`, `client_contact`), adresse ou numéro normalisés, dates. Deux index uniques partiels (CF-I14) | 0b |
| `candidate_exchanges` (nouvelle) | le journal (S4) ; `external_id` unique par `(organization_id, channel, external_id)`, pour qu'un événement rejoué n'écrive pas deux fois | 0b (LinkedIn, InMail), I1 (e-mail), I2 (appel), I3 (rendez-vous) |
| `sourcing_projects` | `owner_id` | E1 |
| | `sourcing_mode` | 7 |
| | `client_terms` (pourcentage ou forfait, base, garantie) | H |
| | `confidential` | C2 |
| | `partner_brief` (projection partagée), `hunt_published_at`, `mission_partner_id` (mission liée) | P1 |
| `member_absences` (nouvelle) | personne, organisation, jusqu'au, remplaçant | E1 |
| `member_linkedin_accounts`, `member_email_accounts` | `rotation_allowed` | E1 |
| `mission_team` | rôle `member` seulement ; `added_by`. Le rôle `freelance` et `permissions` (jamais lue) disparaissent | E1, P1 |
| `candidate_comments` | `project_id`, `edited_at`, `mentions` par identifiant | E2 |
| `candidate_reminders` | `project_id` (reprise des 10 tâches en `project:{id}`) | P |
| | `assigned_to`, rempli par un déclencheur `BEFORE INSERT` (une valeur par défaut ne peut pas lire une autre colonne, CF-I14) | E3 |
| `candidate_evaluations` | `project_id` | 0c |
| | `process_step_id`, `reviewer_kind` (membre ou lien) | 6 |
| `review_links` (nouvelle) | organisation, mission, étape, nom, adresse, empreinte du jeton, expiration, révocation | 6 |
| `qualification_sessions` | `process_step_id` (6), `source` (`manual`, `agenda`, `invitation`, `booking`) | 6, I3 |
| `placements` (nouvelle) | embauche attribuée : mission, ligne, présentation éventuelle, rémunération retenue, prise de poste, pourcentage et base copiés des conditions, montant, fin de garantie, « placé par » (personnes et parts), `fee_status` | H, puis P3 |
| `mission_partners` (nouvelle) | mission, organisation de l'entreprise, organisation partenaire (le partenaire est une organisation), mission liée, porte (`invitation`, `marketplace`), statut, conditions figées à l'acceptation, traçabilité | P1 |
| `mission_partner_terms` (nouvelle) | conditions proposées aux prochains partenaires, lisibles des seuls propriétaires, administrateurs et responsable (CF-I13) | P1 |
| `candidate_presentations` (nouvelle) | les deux côtés, identité, instantané transmis, argumentaire, coordonnées si cochées, accord déclaré, `submitted_at` serveur immuable, priorité, statut, étape vue par le partenaire, motif partagé ou non | P2 |
| `partner_messages` (nouvelle) | collaboration, présentation éventuelle, auteur et son organisation, type (`avis`, `message`, `relance`), verdict, texte, lu par côté. Ni modification ni suppression | P2 |
| `organizations` | `public_slug`, `public_page_enabled` ; fiche Marketplace déplacée de `profiles` vers l'organisation | P4 |
| `external_refs` (nouvelle) | S5 | I3, puis I6a |
| `member_calendar_accounts` (nouvelle) | personne, fournisseur, adresse, état, droit d'écriture | I3 |
| `sequence_enrollments` | `email_account_id` ; `email_used` et `phone_used` écrits au moment de l'envoi, pour trace | I1 |
| `imports`, `external_people` (nouvelles) | fichiers importés et index des bases de l'organisation (vivier, puis ATS). Aucun déclencheur d'indexation pour l'assistant | I5 |
| `integration_connections`, `integration_connection_secrets` (nouvelles) | outils de l'organisation ; jetons sans aucun droit client | I6a |
| `api_keys`, `webhook_endpoints`, `webhook_deliveries` (nouvelles) | automatisations | I7 |

### 3.3 Fonctions

`resolve_person` ; `upsert_mission_candidate` ; `set_candidate_stage` et `set_candidate_stage_internal` (S2 ; la seconde recopie l'étape dans la présentation) ; `get_candidate_feed` ; `recent_contacts` ; `get_mission_signals(mission)` (les rangs de la personne qui appelle) ; `declare_outside_contact` ; `attach_exchange` ; `log_call` ; `pass_candidate(lignes[], personne, mot, prévenir)` ; `change_mission_owner` ; `add_team_note` ; `request_evaluation` (membre ou lien) ; `submit_review_by_link` ; `offboard_member` ; `can_see_mission`, `can_see_candidate_line` ; `sync_partner_brief`, `get_open_missions` (qui remplace `get_open_hunt_missions`), `invite_partner`, `propose_to_mission`, `respond_to_partner`, `approve_partner_invitation` (propriétaire du cabinet), `end_partner`, `submit_candidate`, `withdraw_presentation`, `post_partner_message`, `record_hire` ; `erase_person` ; `start_import`, `delete_import` ; `link_ats_job`, `push_to_ats` ; `resolve_contact_for_send(ligne, canal)`. Toutes `SECURITY DEFINER`, `search_path` vide, fermées à `anon` et `PUBLIC` fonction par fonction.

Côté serveur, un module d'envoi e-mail sort de `agent-tools-mutations.ts:3793-3805` (choix de la boîte) pour servir la fiche, la relance client, les séquences et l'assistant.

### 3.4 Règles d'accès, en français précis

- Voir une mission : propriétaire, administrateur ou membre de l'organisation active de la mission, sauf mission confidentielle (son équipe et le propriétaire) ; un accès limité, seulement si la mission est dans son équipe. Personne d'autre, partenaire compris : un partenaire lit sa mission liée, jamais celle de l'entreprise.
- Modifier une mission : qui la voit, sauf un accès limité (Cadrage en lecture). Section Partenaires et conditions : propriétaire, administrateur, responsable. Supprimer ou archiver : propriétaire, administrateur ou responsable (aujourd'hui tout membre, `ProjectsListV2.tsx:735-738`). Changer de responsable : par fonction.
- Une ligne candidat : lue par qui voit la mission ; un accès limité ne lit que les lignes à partir de la première étape d'entretien, jamais « À trier » ni les écartés. Elle ne s'écrit que par les fonctions de S2 une fois le lot 0b fini (déclencheur de refus, S §3.3).
- Notes, grilles, profils, notes IA, coordonnées : jamais hors de l'organisation de leur ligne. Les politiques d'équipe de mission qui ouvraient ces tables à un externe, toutes missions confondues, disparaissent dans leurs deux familles de noms (production et base neuve, CM §3.2). Une grille se lit par qui voit sa mission (accès limité : après avoir rendu la sienne), se modifie par son auteur. Un avis par lien s'écrit par fonction avec le jeton.
- Coordonnées : propriétaire, administrateur ou membre de l'organisation active (aujourd'hui « toute appartenance », `20260506160000_candidate_alerts_contacts.sql:79-81`) ; accès limité : candidats de ses missions. L'opposition se pose par tout lecteur et ne se lève que par un propriétaire ou administrateur.
- Journal des échanges : aucun accès direct. `get_candidate_feed` rend le canal, le sens, l'auteur, la date et la mission à qui voit la ligne ; l'objet et l'extrait seulement à l'auteur ou au titulaire, ou si l'échange est rattaché à une mission visible. Pour un interlocuteur client, l'extrait ne va qu'à l'auteur et au responsable de la mission (CU-I12). `recent_contacts` rend qui, quand, quel canal, quelle mission, sans extrait, à tout propriétaire, administrateur ou membre ; à un accès limité pour ses missions.
- Notes d'équipe : lues par qui voit la mission ; modifiées par l'auteur ; supprimées par l'auteur ou un propriétaire ou administrateur.
- Tâches : lues par leur créateur, leur destinataire, et les propriétaires, administrateurs et membres ; un accès limité ne lit que les siennes.
- Conversation de l'assistant : son auteur seul, en lecture et en modification (aujourd'hui toute l'organisation, `MIGRATION_CLEAN.sql:2902-2911`).
- Notifications : du navigateur vers une autre personne, seulement une mention ; les autres types par fonctions. Aujourd'hui toute personne peut s'écrire à elle-même n'importe quel type (`20260906181044_p0_catchup_integrity_credits.sql:380-392`) : l'audit le dit ainsi.
- Envoyer : le compte doit être relié à la personne qui envoie (S9).
- Partenaires : `mission_partners` lue par les deux organisations ; engager, accepter une proposition, mettre fin : propriétaire ou administrateur de l'entreprise ; proposer, accepter une invitation : propriétaire ou administrateur du partenaire (un membre demande son accord). `candidate_presentations` lue par l'entreprise et le partenaire de cette présentation seulement ; `submitted_at`, identité, organisation et argumentaire immuables. `partner_messages` lus par les deux, écrits en son nom. `placements` lus par les propriétaires et administrateurs des deux côtés, le responsable côté entreprise et les personnes nommées dans « placé par ». Un partenaire suspendu ne propose ni ne présente plus sur une collaboration venue de la Marketplace (aujourd'hui suspendre ne coupe rien, LM §8).
- Index des bases, imports, outils, liens externes : lus par propriétaire, administrateur, membre ; un import réservé à une mission, par qui voit la mission. Écrits par fonctions. Jetons et secrets illisibles par tout rôle client.

### 3.5 Ce qui est supprimé

| Objet | Pourquoi | Lot |
|---|---|---|
| `submit-application` | Publique, sans jeton (`config.toml:211-212`), sans appelant, écrit dans le Notion de Konekt et journalise nom, e-mail, téléphone (`submit-application/index.ts:130-147`) | C1 |
| Replis sur les secrets Notion de la plateforme | Section 4, R1 | C1 |
| Aircall (webhook, `aircall_calls`, lecteurs, bloc « Aucun appel », promesse du guide audio) | 0 appel, appels sans organisation (LI §6) | I0 |
| Airtable (tables et lecteurs, bloc « Statut Airtable », badges, cascade d'enrichissement) | 0 ligne, plus d'écrivain (LI §7) | I0 |
| Synchronisation Notion par clé d'organisation, `useNotionJobs` et ses 7 écrans, onglet shortlist du `/pipeline`, badge « Déjà dans Notion », colonnes `notion_*`, `notion_api_cache` sous `to_regclass` | 0 organisation, appel toutes les 10 minutes pour rien (LI §4) | I0, après la décision 16 |
| `connector_registry`, `connector_instances` | Coquille vide, types divergents (LI §2.1) | I0 |
| Étape WhatsApp de l'éditeur de séquences | Jamais partie (LC §3.2) | I0 |
| `job_assignments`, `round_robin_state`, `candidate_assignments`, `mission_team.permissions`, rôles de mission | Sans lecteur (LE §7) | E1, 7 |
| Bascule des notes « Perso », puis `candidate_notes` | Publiques en réalité, 0 ligne | C2 |
| `hunt_applications`, `get_partner_missions`, partie externe de `get_mission_team_profiles`, `MissionHuntMode.tsx`, `EnterpriseHuntMissions.tsx`, `PartnerMissionsSection.tsx`, colonnes de réputation de `profiles` | Remplacés par P1 ; réputation sans écrivain (LM §1.1) | P1, P4 |
| `calendly-webhook`, `setup-calendly-webhook`, `backfill-calendly`, colonnes `calendly_*` | Remplacés par l'agenda (I3) | I3 |

### 3.6 Audits

- `rls_and_definer_audit.sql` (nouveau, C1) : toute table du schéma `public` a la RLS active ; aucune fonction `SECURITY DEFINER` n'est exécutable par `anon`.
- `partner_engagements_audit.sql` (C1 pour les contrôles sur les tables actuelles, P1 et P2 ensuite) : une entreprise E, deux partenaires A et B, une organisation tierce C. A ne lit ni ne modifie aucune ligne, note, grille, profil de E ; A ne lit rien de B ; A lit sa mission liée, pas celle de E ; A ne crée de ligne chez E que par `submit_candidate` ; E lit les présentations de A et B, jamais leurs lignes de sourcing ; C ne lit rien.
- `team_roles_audit.sql` (C2) : l'accès limité hors équipe ne lit rien ; dans l'équipe, il ne lit ni « À trier » ni écartés ; un membre ne supprime pas la mission d'un autre ; un membre ne lit pas la conversation d'assistant d'un collègue ; `mission_events` refuse `authenticated` ; notification vers une autre personne : mention seulement ; mission confidentielle.
- `integrations_audit.sql` (0b, complété en I1, I5, I6a) : journal, coordonnées, index, imports, outils et liens externes illisibles d'une autre organisation ; extrait refusé hors mission visible ; jetons illisibles ; opposition non levée par un membre.
- Chaque fichier est inscrit à la main dans `.github/workflows/e2e.yml` dans le lot qui le crée : le workflow liste chaque audit (`e2e.yml:109-142`). Les audits de cloisonnement sont aussi rejoués sur une copie de la production avant chaque lot de droits, puisque la production vient de `MIGRATION_CLEAN.sql`. Les 10 contrôles de `rls_two_orgs_audit.sql` restent verts.

---

## 4. Réparations immédiates

Séparées de la conception : elles valent quelle que soit la suite. Trois urgences : « cette semaine » (exposition réelle aujourd'hui, ou prérequis immédiat) ; « avant toute ouverture » (latent, à corriger avant de valider un partenaire, d'inviter un externe ou de relier un canal) ; « avec le lot » (corrigé par un lot déjà prévu). Chaque preuve a été relue (annexe A).

| N° | Défaut | Preuve | Exposition aujourd'hui | Réparation | Urgence, lot |
|---|---|---|---|---|---|
| R1 | Les séquences créent et modifient des fiches candidat dans le Notion de Konekt, pour toute organisation ; l'analyse des réponses part de la clé Notion de la plateforme ; la mise en shortlist retombe sur les bases Notion de la plateforme | `process-sequences/index.ts:22, 1430, 3487-3503, 1650-1668, 3770` ; `auto-analyze-message/index.ts:20-23, 38-45` ; `add-to-shortlist/index.ts:54-55` | Séquences inactives depuis le 14/05 ; l'analyse tourne à chaque réponse (136 analyses, MP §18), aujourd'hui pour une seule organisation. Bloquant pour le lot 5, qui remet les séquences au centre | Poser d'abord la clé du cabinet du fondateur dans les réglages de son organisation si elle sert (décision 16), puis retirer tout usage des secrets Notion de la plateforme | Cette semaine, C1 |
| R2 | `submit-application` est publique, écrit dans le Notion de Konekt, répond « succès » sans rien stocker et journalise nom, e-mail, téléphone | `config.toml:211-212` ; `submit-application/index.ts:15-17, 130-147` | Appelable par n'importe qui | Suppression, puis `supabase functions delete` | Cette semaine, C1 |
| R3 | Les conversations de l'assistant sont lisibles et modifiables par tout membre de l'organisation | `MIGRATION_CLEAN.sql:2902-2911` | Réelle : `org_1` a 3 membres et 99 conversations d'une personne (MP §10) | Lecture et modification par l'auteur seul | Cette semaine, C1 |
| R4 | Le portail client envoie toutes les lignes de la mission (profils à trier et écartés compris), noms inclus si la permission est donnée ; les liens n'expirent jamais | `client-portal-data/index.ts:105-113, 121-124, 61` ; MP §12 | Réelle : 4 liens ouverts, sans expiration | Seulement les candidats retenus ou au-delà, jamais les écartés ni « À trier », en attendant « seulement les présentés » du lot 8 ; expiration par défaut posée sur les liens existants | Cette semaine, C1 |
| R5 | Le webhook journalise l'adresse de l'expéditeur de chaque e-mail reçu non rattaché ; l'abonnement couvre tous les comptes | `unipile-webhook/index.ts:1458` ; `unipile-manage-webhooks/index.ts:56` | Réelle : 1 boîte Outlook reliée (MP §14) | Retirer ce journal ; dire dans `/privacy` que Konekt reçoit tout et ne garde que le rattaché | Cette semaine, C1 |
| R6 | La liste des missions ouvertes envoie le poste entier (interlocutrice, consignes, profils de calibration, nom du client) à tous les membres des organisations partenaires, contre le commentaire du même fichier | `20260907053654_marketplace_partner_circle.sql:319-323` contre `:507-512` | Latente : 0 partenaire validé, 1 demande en attente depuis le 08/09 | Projection sur liste blanche ; aucune validation de partenaire avant la livraison | Avant toute ouverture, C1 |
| R7 | Un externe de mission modifie l'étape des candidats de l'entreprise et ses grilles, et lit notes, grilles, profils et notes IA de l'entreprise sur toutes ses missions ; deux partenaires d'une même mission se voient | `20260903074500_rls_catchup_audit_critiques.sql:36-57, 65-96, 135-150` | Latente : 0 externe (MP §4) | Retrait de ces accès, dans les deux familles de noms, par boucle sur `pg_policies` | Avant toute ouverture, C1 |
| R8 | La notation réécrit le statut de toutes les lignes d'un candidat pour une mission, sans filtre d'organisation, en entretien compris | `score-profile-job/index.ts:2528-2548` | Réelle dans une organisation (S §3.3) ; latente entre organisations | Filtre par ligne et par organisation tout de suite ; la notation cesse d'écrire l'étape au lot 0b | Cette semaine (filtre), 0b |
| R9 | Relier un compte qui n'est ni une boîte e-mail ni LinkedIn (WhatsApp) écrase la liaison LinkedIn du membre | `unipile-webhook/index.ts:254-258, 524-567` | Latente : aucun écran ne relie WhatsApp | Refuser tout autre type, le journaliser sans donnée personnelle, et supprimer ce compte chez le prestataire | Avant toute ouverture, C1 |
| R10 | Le webhook d'agenda de la plateforme cherche le candidat sans filtre d'organisation, retombe sur « n'importe quel profil » et écrit l'étape | `calendly-webhook/index.ts:189-194, 234-241, 298-305` | Faible : 2 sessions, en mai | Limité à l'organisation de l'événement, sans repli, sans écriture d'étape ; retiré au lot I3 | Avant toute ouverture, C1 |
| R11 | Textes qui promettent un travail commun inexistant ; « Collaborateur externe » voit et supprime tout ; les consignes du mode cabinet disent « chez Konekt » | `MissionHuntMode.tsx:164, 490, 494` ; `PartnerCircleCard.tsx:181-182` ; `AcceptMissionInvite.tsx:43` ; `InviteMemberForm.tsx:57-59` ; `_shared/outreach-context.ts:83` | Trompeur, 0 personne concernée | Textes vrais ; « Collaborateur externe » retiré du formulaire jusqu'au lot C2 ; « chez » l'organisation de l'expéditeur | Cette semaine, C1 |
| R12 | `/privacy` ne cite pas le fournisseur d'embeddings, appelé par quatre fonctions | `src/pages/Privacy.tsx:115-125` ; CF-B6 | Obligation légale | Liste mise à jour, puis à chaque lot qui ajoute un sous-traitant | Cette semaine, C1 |
| R13 | Toute table nouvelle est lisible par `anon` si sa RLS manque ; les fonctions sont exécutables par défaut | `20260421180000_grants_bootstrap_owner_uniques.sql:28, 33-38` | Préventif | Audit générique dans la CI | Cette semaine, C1 |
| R14 | Un membre sans compte cherche et envoie depuis le compte d'un collègue ; la fiche lit et envoie depuis le compte de la dernière inscription ; le serveur accepte tout compte de l'organisation | `useFilteredLinkedInAccounts.ts:27-32` ; `useCandidateFullProfile.ts:163-176` ; `unipile-search/index.ts:185-200, 330-345` | Faible : chaque membre d'`org_1` a son compte | Toujours son propre compte, avec l'extrait du journal pour la conversation d'un collègue, livré le même jour pour ne rien rendre inaccessible | Avec le lot 0b |
| R15 | Une réponse e-mail passe « a répondu » et « Pré-qualif » dans toutes les missions de l'organisation | `unipile-webhook/index.ts:1494-1518` | Faible : 0 e-mail de prospection parti | Par `set_candidate_stage_internal`, mission de la conversation seulement | Avec le lot 0b |
| R16 | Une réponse sur un compte sans membre lié n'est notifiée à personne | `unipile-webhook/index.ts:1286-1297` | Faible | Adressée au responsable du candidat, sinon de la mission | Avec le lot 0b |
| R17 | La purge RGPD ne purge rien (statut nul sur une colonne obligatoire, statuts jamais écrits), n'est pas planifiée, et effacerait la mémoire de l'assistant d'autres organisations ; l'effacement ne couvre que l'enrichissement | `rgpd-purge/index.ts:57-62, 70-73, 99-103` ; aucune planification dans les migrations ; LC §9 | Légale | Lot R | Avant I1, I5, I6a, P2 |
| R18 | L'aperçu d'inscription fait payer un enrichissement « pour que les e-mails partent », alors qu'aucun e-mail ne part | `EnrollmentPreviewModal.tsx:1361, 1375` | Faible : formule gratuite pour tous | Promesse retirée (I0), vraie au lot I1 | Avec I0 |
| R19 | Une tâche créée depuis `/tasks` perd sa mission ; une tâche de fiche mène à « Mission introuvable » | `CreateTaskModal.tsx:181-198` ; `Tasks.tsx:476` | 0 tâche sur 18 avec un lien valide (MP §8) | `project_id` | Avec le lot P |

---

## 5. Lots

Tailles de S : P petit, M moyen, G grand, G+ plus que grand. Toute évolution de base passe par un fichier de migration qui rejoue sur une base vide ; deux lots de migration ne partent jamais en parallèle (CLAUDE.md, incidents des 14 et 15/07).

### 5.1 Lots de la synthèse qui changent

| Lot | Ce qui s'ajoute | Taille après |
|---|---|---|
| 0a | Comptages à la main d'abord (doublons d'auteur, 60 selon LE à source unique ; doublons de source, jamais mesurés). Identité (S1) ; ligne unique en trois déploiements : (1) fonctions d'écriture livrées et les 17 écrivains basculés, ancien index gardé ; (2) fusion des doublons avec un événement `lines_merged`, nouvelle unicité, `project_id NOT NULL` ; (3) ancien index retiré. Même méthode pour `candidate_contacts`. Deux fonctions d'étape (S2) ; `set_candidate_stage` refuse une ligne hors de l'organisation active. `mission_events` (faits de l'étape). Aucune colonne posée d'avance. La fusion réécrit aussi la référence souple de l'avis du portail (`client-portal-data/index.ts:180-221`) | G+ |
| 0b | `candidate_threads` et `candidate_exchanges` pour LinkedIn et InMail ; rattachement à l'envoi et à la réception (S4) ; envoi et lecture depuis son propre compte (R14) ; `recent_contacts` sur tous les chemins et au moment de l'envoi ; écrivain e-mail du webhook (R15) ; réponse sans membre lié adressée (R16) ; `declare_outside_contact` ; notation qui n'écrit plus l'étape. Notifications `new_message` partagées avec À traiter | G+ |
| 0c | `get_candidate_feed`, seule lecture du fil ; grilles de toute l'équipe lues par mission (`ScorecardTab.tsx:117-123`) | M |
| 1 | Redirection des liens `?tab=config` stockés dans les notifications de la Marketplace (`20260907053654_marketplace_partner_circle.sql:624-645`) | M |
| 2 | Coordonnées connues en tête de fiche ; Échanges lu dans le journal | G |
| 3 | La table unique des rangs (section 2.1), limitée aux rangs dont la source existe ; un destinataire par rang, sur la chaîne de S3 (`created_by` et titulaire de la conversation suffisent avant E1) ; « Rien ne presse » calculé sur votre part ; liste des missions sur l'action la plus urgente de la mission | M |
| 4 | Mentions du Sourcing (S9, S1) ; Sourcing qui lit les décisions de toute l'équipe ; « Chercher dans » ; Base Konekt dédoublonnée par identité | G |
| 5 | Structure du choix de canal (LinkedIn seul) ; confirmation d'un message manuel ; séquence partagée envoyée du compte de qui inscrit ; exclus nommés. Prérequis : R1 | G |
| 6 | Intervieweur par étape (membre, responsable du candidat, personne hors Konekt) ; avis par lien sans compte ; grilles par étape ; « Demander un avis à… » ; `qualification_sessions.source`. La décision 4 de S devient : sans agenda, le champ « Date de l'entretien » ; avec agenda (I3), l'invitation | G |
| 7 | « Qui recrute » déduit (S7) ; « Équipe et partenaires », une seule porte ; rôles de mission retirés ; « Conditions avec le client » ; le mode chasse quitte les Réglages provisoires (la section Partenaires le remplace, masquée jusqu'à P2) | G |
| 8 | Panneau Client selon « Qui recrute » ; relance selon S10 ; avis du portail au rang 4 | M |
| 9 | Assistant sur la même règle de visibilité que l'écran ; « Ranger sur le candidat », jamais automatique ; lecture des sources avec les droits de la personne | M |
| 10 | Puce « Les miens » ; « Passer le suivi à… » dans le menu ; « Appeler », « Noter l'appel », WhatsApp par l'application | M |

### 5.2 Lots nouveaux

| Lot | Ce que l'utilisateur voit | Contenu | Taille | Déclencheur |
|---|---|---|---|---|
| C1. Réparations | Des textes vrais ; le portail client ne montre plus les profils à trier ni les écartés | R1 à R13 ; publication et invitation de partenaires masquées (décision 17) ; audits générique et partenaire (contrôles sur les tables actuelles), inscrits dans `e2e.yml`. Un seul fichier de migration | M | Tout de suite, après la décision 16 |
| I0. Débrancher ce qui ment | Plus de « Aucun appel », « Statut Airtable », badges Notion, promesses d'envoi ; un Sourcing et une fiche plus légers | Retraits de la section 3.5 marqués I0 ; étape e-mail affichée « sautée pour l'instant » jusqu'à I1 ; ajout rapide et reconnexion de l'extension masqués. Code d'abord, migration de suppression après C1 | M | Tout de suite |
| P. Liens réparés | Une tâche mène à sa mission ; une mention mène à la fiche dans la mission | R19 ; lien de la mention (`CandidateCommentsTab.tsx:189`) | P | Tout de suite |
| R. Données personnelles | « Ne plus contacter » ; mention d'information à l'import et dans le premier message | `erase_person` sur toutes les tables, mémoire de l'assistant comprise, filtrée par organisation, avec une trace sans donnée personnelle ; purge réparée et planifiée ; opposition tous canaux lue par la recherche, les séquences et l'assistant ; `/privacy` à jour | M | Après le lot 3, avant I1, I5, I6a, P2 |
| I2. Appels notés | « Appeler », « Noter l'appel », rappel en tâche ; WhatsApp ouvert dans l'application puis noté | `log_call`, échange `phone`, tâche pour soi | P | Après les lots 2 et P |
| H. Embauche et honoraires | Au passage en « Embauché » d'une mission pour un client : rémunération, prise de poste, honoraires, fin de garantie, « placé par » ; rang 14 ; filtre « Honoraires à facturer » | `placements`, `client_terms`, `record_hire`. Konekt suit, n'encaisse rien | M | Après le lot 7 |
| I1. L'e-mail dans la mission | Écrire par e-mail ; réponses dans Maintenant, la fiche, À traiter, la messagerie ; relance client réelle ; étapes e-mail qui partent ; « Trouver son adresse » utile | Module d'envoi partagé ; adresse résolue à l'envoi ; `email_account_id` ; rattachement des e-mails entrants (adresses connues ; interlocuteur : fils ouverts depuis Konekt seulement) ; reprise de 90 jours pour les candidats seulement ; relève serveur de l'enrichissement (les 10 demandes en attente depuis le 06/07 soldées) ; désinscription allumée par défaut ; suivi d'ouverture en option. Recette complète | G | Après les lots 5 et R, prix par boîte reliée connu |
| I3. L'agenda | Entretiens de l'agenda aux rangs 1 et 2 ; « Planifier dans votre agenda » ; créneau choisi au rang 3 ; créneaux libres | `member_calendar_accounts`, lecture filtrée (événements avec un candidat connu, titre gardé seulement si Konekt l'a écrit), `external_refs`, retrait de l'agenda de la plateforme | M | Après le lot 6, couverture de l'agenda par le prestataire vérifiée (non prouvée, CF §1) |
| I5. Vos fichiers comme sources | « Importer un fichier » ; vivier dans « Chercher dans » ; « Dans votre vivier » | `imports`, `external_people`, dédoublonnage par S1, liste dans Outils | G | Après les lots 4 et R |
| C2. Rôles | « Accès limité » ; mission confidentielle ; suppression réservée | Accès limité comme condition sur les politiques par organisation ; `can_see_mission` ; assistant sur la même règle ; politiques héritées de `mission_team` retirées ; unicité des invitations de mission ; notes « Perso » retirées ; `team_roles_audit.sql` | G | Avec E1 |
| E1. Responsables et passation | Initiales, « Les miens », « Passer le suivi à… », « Changer de responsable », « De vos collègues », « Depuis votre passage », absence et remplaçant, accord de rotation, liste des missions avec initiales et filtre « En attente » | `owner_id`, `owner_user_id`, `pass_candidate`, notifications, `member_absences`, retraits de tables mortes | M | Mesure « équipe active » ou première invitation d'un accès limité |
| E2. Notes d'équipe | Notes de l'équipe avec « @ » ; fil signé ; « Modifié par » | `add_team_note`, `candidate_comments.project_id` | M | Après E1 et 0c |
| E3. Tâches pour quelqu'un | « Pour : Julie » ; `/tasks` « Pour moi · Pour les autres · Équipe » | `assigned_to` | P | Après E1 et P |
| E4. Départ d'un membre | La fenêtre de départ | `offboard_member` après « Dissocier ». Recette complète | M | Après E1 |
| P1. Confier un poste | L'entreprise invite un partenaire (puis publie) ; le partenaire retrouve le poste dans ses missions | Section 5.2 de CM, corrigée : conditions dans `mission_partner_terms`, projection `partner_brief` lue par un seul utilitaire serveur (CF-I12), invitation d'un membre avec accord de son propriétaire, espace sans essai consommé, missions liées hors plafond. Rangs 0, 6, 15. Audit partenaire complété | G | Pilote nommé (une entreprise, un partenaire), après 0a, 7, 8 et R |
| P2. Présenter et examiner | Le partenaire présente ; l'entreprise examine, décide, demande un avis, organise l'entretien ; le partenaire suit | `candidate_presentations`, `partner_messages`, `submit_candidate` ; rangs 1, 2 et 4 côté partenaire, 5, 6, 10 ; trois e-mails par `enqueue_email` (présentation reçue, avis reçu, invitation acceptée) | G | Avec P1 |
| P3. Honoraires des partenaires | Embauche attribuée entre présentateurs ; faits du partenaire ; Bilan par origine | Extension de H | P | Après P2 et H |
| P4. Marketplace | Propositions, fiche et page du partenaire, administration qui lit la demande et suspend vraiment | CM §5.2, P4 | M | 3 entreprises avec une collaboration active, ou 10 présentations par mois |
| I6a, I6b. ATS | Lecture : mission depuis un poste, « Dans Teamtailor », vivier de l'ATS ; puis écriture : « Envoyer dans Teamtailor », étape et embauche lues, candidatures au rang 12 | Connecteur unifié jamais nommé ; `integration_connections` ; l'ATS fait foi après l'envoi ; embauche lue dans l'ATS qui ouvre la fenêtre d'honoraires (CF-I15) | G, G | Pilote ATS, prix et contrat de sous-traitance, après R ; I6b après 4 semaines de lecture |
| I5b, I7, I8 | Base Notion ou Airtable reliée ; webhooks puis API ; extension réparée | CI §5.2 | M, M, P | 3 demandes ; 3 demandes ; 5 demandes |

### 5.3 Ordre conseillé

1. Décision 16, puis C1, I0 et P. C1 porte une seule migration ; la migration de suppression d'I0 part après.
2. Comptages à la main, puis 0a (trois déploiements), 0b, 0c. Chaque déploiement de 0a se répète sur une base reconstruite à neuf et sur une copie de la production.
3. Lots 1 et 2, puis I2, puis 3. La mission s'ouvre sur ses candidats ; l'appel noté sert le recruteur seul dès le lot 2.
4. R.
5. Lot 4 puis I5 ; lot 5 puis I1 (prix connu) ; **lot 6 puis I3** (agenda vérifié).
6. Lots 7, H, 8, 9, 10.
7. Sur mesure ou pilote : C2 avec E1, puis E2, E3, E4 ; P1 avec P2, puis P3, puis P4 ; I6a puis I6b ; I5b, I7, I8.

Aucune fonction ne devient inaccessible entre deux lots : ce que I0 retire est mort ou n'a jamais marché ; l'agenda de la plateforme vit jusqu'à I3 ; la relance client garde son brouillon jusqu'à I1 ; les notes restent dans la fiche actuelle jusqu'à E2 ; l'équipe de mission reste dans les Réglages provisoires jusqu'au lot 7 ; la publication et l'invitation de partenaires, qui n'ont jamais servi (0 candidature, 0 publication, MP §11), sont masquées par une décision explicite (17).

### 5.4 Ce qui attend une mesure ou un pilote

La mesure d'usage de S (décision 12, variable Vercel) doit être posée avant le lot 1.

| Chantier | Seuil |
|---|---|
| C2, E1 à E4 | « Équipe active » : au moins deux personnes ont chacune signé un événement sur une même mission dans une même semaine (lu dans `mission_events`), ou la première invitation d'un accès limité. Aujourd'hui aucune (MP §5) |
| Temps réel sur les lignes, e-mails par événement, fils de discussion, présence, Bilan par personne | Après E1, sur la même mesure |
| P1, P2, P3 | Un pilote nommé : une entreprise qui veut confier un poste et un partenaire qui accepte de le travailler dans Konekt |
| P4 | 3 entreprises avec une collaboration active, ou 10 présentations par mois ; faits publics d'un partenaire à partir de 3 embauches attribuées ; toute commission après 5 |
| I6a, I6b | Un pilote avec Teamtailor, Welcome to the Jungle ou Flatchr, ou 5 « Dites-le-nous » pour un même outil ; prix et contrat du connecteur ; I6b après 4 semaines de lecture |
| I1 | Pas de mesure : l'enrichissement est vendu aujourd'hui pour un envoi qui n'existe pas. Mais le prix par boîte reliée doit être connu |
| WhatsApp relié | Version professionnelle officielle seulement, lot à part : 5 demandes, et 3 organisations qui notent des échanges WhatsApp chaque semaine |
| Téléphonie reliée | 20 appels notés par semaine dans 2 organisations |
| I5b, I7, I8 | 3, 3 et 5 demandes |

---

## 6. Risques

1. L'identité rapproche trop ou pas assez. Parades : rapprochement exact sur des identifiants normalisés, jamais sur un nom ; « Peut-être la même personne » décidé par une personne ; comptages avant la migration.
2. Le changement de clé unique fait échouer les écritures pendant un déploiement. 17 écrivains, migrations et fonctions sans ordre de déploiement. Parade : trois déploiements, répétés sur base neuve et sur copie de production.
3. Une politique permissive survit et annule le cloisonnement. Deux familles de noms, privilèges par défaut ouverts. Parades : boucle sur `pg_policies`, audit générique, audits inscrits dans `e2e.yml`, rejoués sur une copie de la production.
4. Le webhook, fichier de plus de 1 500 lignes, est touché par 0b, R et I1. Parades : recette complète (`qa.md`), événements rejoués, unicité par `external_id`.
5. Vie privée des boîtes reliées. Le prestataire envoie au webhook tout le courrier entrant. Parades : ne garder que le rattaché, extrait de 280 caractères au plus, aucun journal d'adresses, `/privacy` qui le dit. Pas de WhatsApp personnel relié.
6. Coûts inconnus : boîte ou agenda relié par compte, connecteur d'ATS par client. Parade : chaque lot concerné attend son prix.
7. Construire pour personne. 1 organisation à plusieurs membres, 0 partenaire, 0 outil relié. Parades : C1 et les lots de S d'abord, le reste sur mesure ou pilote ; tout est invisible sans source.
8. Une carte Maintenant à 18 rangs devient moins lisible. Parades : trois groupes, un destinataire par rang, des rangs limités au type de mission, « Pourquoi maintenant ? » qui nomme la source. Si la mesure montre que Ensuite est plus cliqué que la carte, la règle est à revoir (S §14).
9. Deux copies d'un candidat entre deux organisations. Parades : accord déclaré avant présentation, chacun responsable de sa copie, `erase_person` qui couvre les présentations, anonymisation après l'antériorité plus 12 mois.
10. Konekt et l'ATS se contredisent. Parade : une règle écrite, Konekt avant l'entretien, l'ATS après l'envoi ; Konekt ne réécrit jamais une étape de l'ATS ; un écart ou une embauche lus dans l'ATS deviennent une action pour le responsable.
11. Le premier écran visible recule. Parades : C1 de taille M, 0a sans colonnes d'avance, équipe et marketplace hors du chemin.
12. L'écran du recruteur seul s'alourdit. Parades : seuils calculés sur les données (S8) ; `Main.dc.html` identique pour qui n'a rien relié ; budget du Sourcing recompté avant I5.

---

## 7. Décisions pour le fondateur

À la suite des 13 décisions de S. Chacune a un choix par défaut, appliqué si vous ne tranchez pas. Trois décisions de S changent : la 4 (entretiens, lot 6 ci-dessus), la 9 (portail selon le type : remplacée par « Qui recrute », le panneau Client suit la mission), la 10 (mode chasse gardé dans Cadrage : remplacée par la décision 17).

14. Où travaille un partenaire sur un poste confié. Par défaut : chez lui, dans une mission liée, avec un geste « Présenter » ; l'entreprise ne voit que les présentés ; les partenaires ne se voient pas ; l'espace créé pour un partenaire ne consomme pas l'essai de la personne et ses missions liées ne comptent pas dans le plafond. Autre choix : il écrit dans la mission de l'entreprise avec une colonne d'origine, ce qui révèle le Pipeline de l'entreprise et demande des politiques d'origine sur au moins six tables (CM §1.1).
15. Quand construire l'équipe et la marketplace. Par défaut : C1, I0, P tout de suite ; l'équipe (C2, E1 à E4) sur la mesure « équipe active » ou la première invitation d'un accès limité ; la marketplace (P1, P2) sur un pilote nommé. Autre choix : les construire sans attendre, ce qui retarde les écrans de S pour 16 organisations sur 17.
16. Votre base Notion reçoit-elle encore des candidats ? Aujourd'hui, les séquences et l'analyse des réponses écrivent dans le Notion rattaché aux secrets de la plateforme. Par défaut : votre clé passe dans les réglages de votre organisation avant que C1 ne retire ce repli, puis votre base s'importe comme source au lot I5. Autre choix : retrait immédiat, et l'écriture vers Notion s'arrête.
17. Marketplace gelée jusqu'au pilote. Par défaut : publication et invitation de partenaires masquées jusqu'au lot P2 ; aucune validation de partenaire avant C1 ; la demande en attente depuis le 08/09 reste en attente et son auteur est prévenu ; les 3 brouillons d'`org_1` restent en brouillon. Autre choix : laisser la publication ouverte, avec le texte « La présentation de candidats dans Konekt arrive avec la prochaine version ».
18. Qui reçoit une réponse après une passation. Par défaut : le responsable du candidat est posé au premier contact ; après « Passer le suivi à… », les réponses vont au nouveau responsable, qui écrit depuis son compte avec les extraits de l'ancienne conversation ; « Prévenir le candidat » est coché, envoyé depuis l'ancien compte sur un clic. Autre choix : les réponses restent au titulaire du compte, et la passation ne transmet que le suivi.
19. L'avis d'un manager et le prix d'un accès limité. Par défaut : l'avis se demande par un lien, sans compte ni siège (lot 6) ; un accès limité qui ne cherche ni ne contacte (aucun compte LinkedIn relié, aucune séquence) ne prend pas de siège. Aujourd'hui un siège vaut 189 € par mois en formule Entreprise (`20260906181806_p0_plans_trial_seats.sql:35-36`) et compte tous les rôles. Autre choix : tout accès limité paie un siège.
20. Ce que l'équipe voit d'une conversation tenue par un collègue. Par défaut : qui, quand, et l'extrait des messages rattachés à la mission ; la conversation entière reste lisible par son titulaire seul. Autres choix : lecture complète pour l'équipe ; ou seulement « Contacté par Julie le 12/09 ».
21. L'e-mail dans la mission. Par défaut : envoi depuis la boîte du membre, jamais depuis Konekt ; Konekt garde les échanges avec des adresses connues de candidats, et avec un interlocuteur seulement les fils ouverts depuis Konekt ; reprise de 90 jours pour les candidats seulement ; pas de pixel d'ouverture par défaut ; mention de désinscription allumée. L'envoi individuel suit la décision 2 de S (permis en formule gratuite) si le prix par boîte reliée le permet ; ce prix est connu avant I1.
22. Honoraires sur toutes les missions pour un client. Par défaut : oui, au lot H ; fenêtre d'embauche, conditions avec le client dans Cadrage, « placé par » avec des parts, lisible des propriétaires, administrateurs et personnes nommées ; Konekt suit et n'encaisse rien. Autre choix : honoraires seulement pour les partenaires de la Marketplace (P3).
23. Le logiciel de recrutement du client. Par défaut : un connecteur unifié européen, jamais nommé à l'écran, en lecture d'abord, sur pilote ; premiers outils Teamtailor, Welcome to the Jungle, Flatchr ; l'ATS fait foi après l'envoi, qui a lieu à « Recevoir en entretien » ; candidatures de l'ATS dans « À trier » décochées par défaut. Autre choix : un connecteur direct, si un seul outil domine les demandes.
24. WhatsApp. Par défaut : aucun compte WhatsApp personnel relié à Konekt ; « WhatsApp » ouvre l'application et l'échange se note ; l'étape WhatsApp quitte l'éditeur ; un envoi relié ne viendrait qu'avec la version professionnelle officielle, dans un lot à part. Autre choix : relier le compte personnel par QR code (CI), qui fait passer toutes ses conversations, familiales comprises, par le prestataire et le webhook (CF-I8).
25. Antériorité d'une présentation. Par défaut : la première présentation datée, pour ce poste, vaut 6 mois ; « déjà connu de l'entreprise » veut dire contacté par elle depuis moins de 12 mois, en cours sur ce poste au stade « Contacté » ou au-delà, ou actif dans son ATS depuis moins de 12 mois ; Konekt horodate et montre, il n'arbitre pas ; une présentation non suivie d'embauche est anonymisée après l'antériorité plus 12 mois. Autre choix : antériorité sur toute l'entreprise, 12 mois.

Choix par défaut appliqués sans décision, parce qu'ils suivent une règle déjà posée : « Accès limité » au lieu de « Collaborateur externe » ; « Passer le suivi à… » au lieu de « Confier à… » pour un candidat, « confier » restant réservé au poste confié ; « Marketplace » comme seul nom de la place ; l'accord de rotation, décoché par défaut ; la mission confidentielle, éteinte par défaut ; notifications de personne à personne dans l'application et le résumé quotidien, sans e-mail par événement.

---

## 8. Critiques écartées ou corrigées

Tout le reste des deux critiques est intégré (annexe B). Voici ce qui ne l'est pas, ou pas tel quel.

| Critique | Ce qui est écarté ou changé | Raison |
|---|---|---|
| CF-I6 : garder une colonne « Suivi » à deux personnes | La colonne | CU-I11 obtient la même information sans toucher la grille validée : initiales après le nom. La planche `Main.dc.html` reste identique |
| CU-I1 point 2 : poser d'avance dans 0a des colonnes vides (`owner_user_id`, `source_org_id`, `presentation_id`, `origin_kind`) | Le « d'avance » | Ajouter une colonne nullable est immédiat (CF-I3) ; les poser plus tôt charge 0a, qui retarde les seuls lots visibles pour 16 organisations sur 17 |
| CU-I14 point 2 : renommer les candidates Claire Dubois et Sophie Dupont sur les planches nouvelles | Le renommage | Ce sont des données de la planche validée reprises par cinq planches (`Main.dc.html:456, 458`, `MaintenantFormes`, `PanneauContact`, `Sourcing`, `Telephone`). On évite plutôt ces prénoms pour les personnes qui utilisent Konekt |
| CU-I14 point 3 : une rubrique « Une journée », deux planches par personne | Les dix planches | Le cahier est limité à 9 planches nouvelles ou fortement modifiées ; chaque planche porte une bascule de point de vue |
| CU-I10 point 5 : l'import dans Mon organisation > Outils, avec un simple raccourci | Le déplacement | La règle de S est « pas de nouvel écran si un panneau suffit » : le panneau d'import reste dans le Sourcing, là où naît le besoin. Outils garde la liste des imports. Ce qui est corrigé, c'est l'affirmation de CI « aucun panneau nouveau » |
| CU-I2 : l'absence et le remplaçant, tout de suite | Le calendrier | Intégrés, mais dans E1 : sur `org_1`, les deux autres auteurs ont travaillé un jour chacun (MP §5). Pas de congé à couvrir avant qu'une équipe travaille |
| CU-I9 : masquer aussi l'invitation d'un cabinet | Rien, mais nuancé | Retenu (décision 17). L'invitation de mission déjà envoyée le 08/09 n'est pas annulée : son auteur est prévenu |
| CF-B6 : lot R « avant I5, I6a et P2 » | Rien, mais placé | R vient après le lot 3, et aussi avant I1, qui dépend de l'opposition tous canaux. Il ne passe pas avant les lots 1 à 3 : le journal du lot 0b n'est tenu que par une organisation (CF-B6 le dit lui-même) |
| CE, hypothèse A (le partenaire écrit dans la mission de l'entreprise) | L'hypothèse | Les deux critiques et CI retiennent l'option B (CU-B1, CF-B3). Vérifié : l'assistant refuse une mission d'une autre organisation (`_shared/agent-tools-reads.ts:122`) et le compte LinkedIn d'un partenaire appartient à son organisation (`unipile-search/index.ts:186-200`) : avec A, ni l'assistant ni le lien conversation et mission ne marchent sans exception |
| CE : `org_role` « toute appartenance » | La règle | CF-B3, vérifié : `/pipeline` lit sans filtre d'organisation (`useATSData.ts:136-140`) et mélangerait deux organisations |
| CE : lot C de taille G avant 0a | Le périmètre | CF-I1 : C1 de taille M tout de suite, le reste avec E1. Restreindre l'accès limité touche les politiques de 51 tables pour un rôle que personne n'a (MP §3) |
| CE : E1 à E4 sans condition | La condition | CU-I1 : CE définit lui-même la mesure « équipe active » ; les trois chantiers suivent désormais la même règle de déclenchement |
| CE : 7 écritures directes plus `/pipeline` | Le compte | 15 `upsert` et 2 insertions, vérifié (annexe A) |
| CE, CM, CI : une colonne `candidate_key` | La colonne | CF-B1, vérifié : l'anti-doublon compare un ensemble de clés (`enrollmentDuplicates.ts:52-69`) |
| CE : `assigned_to … default created_by` ; contrôle « `notifications` refuse un type autre que `mention` venu du navigateur » | Deux erreurs de détail | CF-I14, vérifié : une valeur par défaut ne lit pas une autre colonne ; la politique actuelle laisse s'écrire à soi-même tout type (`20260906181044_p0_catchup_integrity_credits.sql:380-392`) |
| CE : `mission_events` avec extraits ; CI : les événements de message de CE « deviennent une vue » | Le double stockage | CF-B4 : une table ne peut pas être aussi une vue ; deux copies des extraits auraient deux règles d'accès. Une table d'échanges, une table de faits sans contenu |
| CM : question « Qui recrute » à la création si le type est vide | La question | CU-I5 : 9 organisations sur 17 recevraient une question de plus. Déduit, modifiable dans Cadrage |
| CM : espace de cabinet « en formule gratuite » | L'affirmation | CF-I7, vérifié : toute création d'organisation ouvre l'essai unique de la personne (`20260906181806_p0_plans_trial_seats.sql:94-128`). Choix explicite dans la décision 14 |
| CM : conditions sur `sourcing_projects`, cachées à l'écran pour un membre | Le lieu | CF-I13 : la RLS filtre des lignes, pas des colonnes. Les conditions vivent dans une table lisible des seuls propriétaires, administrateurs et responsable |
| CM : copie des champs partagés dans `job_details` de la mission liée, gardée par un déclencheur | Le mécanisme | CF-I12 : le Cadrage enregistre l'objet entier et chaque mise à jour relance l'indexation. La projection reste dans `partner_brief`, lue par un seul utilitaire serveur |
| CI : WhatsApp personnel relié par QR code (décision 6) | Le compte personnel relié | CF-I8, vérifié : la connexion proposée est un compte personnel (`unipile-accounts/index.ts:529-544`) ; toutes ses conversations passeraient par le prestataire. Décision 24 |
| CI : « Téléphone inconnu · Saisir · Trouver » en tête de fiche ; ligne « reliez votre boîte » dès qu'une adresse existe | L'affichage pour tous | CU-I10, vérifié : l'enrichissement est fermé en formule gratuite (`featureGates.ts:79`), soit pour les 17 organisations ; la fiche validée changerait sans connexion |
| CI : garder tous les e-mails avec un interlocuteur, avec une reprise de 90 jours | Le périmètre | CU-I12 : la correspondance commerciale (contrat, factures) deviendrait lisible par l'équipe. Seulement les fils ouverts depuis Konekt |

Deux constats des critiques ont été précisés en vérifiant :
- CF-B5 est plus large que dit : `add-to-shortlist` ne retombe sur les bases Notion de la plateforme que si l'organisation a sa propre clé sans ses bases (`add-to-shortlist/index.ts:44-55`) ; le cas grave est `process-sequences`, qui crée les fiches (`:3497-3502`).
- La ligne du fichier cité par CE pour le repli des comptes est la 31 (`useFilteredLinkedInAccounts.ts:31`, `if (!linkedAccountId) return allAccounts`), non la 32. Le constat tient.

---

## 9. Cahier de maquette

### 9.1 Une seule distribution

Date du jour : mercredi 24/09 (comme `BRIEF.md` §5). Jeudi 25/09, vendredi 26/09, lundi 29/09. Aucune personne qui utilise Konekt ne porte le prénom d'un candidat de la planche validée (pas de Claire, Sophie, Julien, Marc…).

**Cabinet Altide** (cabinet, formule Cabinet, 5 sièges sur 5). Base Konekt activée. « Vivier Altide.xlsx » importé le 02/09 par Guillaume Martin : 2 140 lignes, dont 1 912 avec un profil LinkedIn ou une adresse (212 déjà connues) et 228 sans.

| Personne | Rôle | Initiales | Outils reliés |
|---|---|---|---|
| Guillaume Martin | Propriétaire | GM | LinkedIn ; Gmail et Google Agenda, guillaume@altide.fr |
| Sarah Lopez | Administratrice | SL | LinkedIn |
| Julie Garnier | Membre | JG | LinkedIn ; Gmail et Google Agenda, julie@altide.fr |
| Karim Benali | Membre | KB | LinkedIn |
| Léa Chevalier | Membre | LC | Aucun compte LinkedIn |

Missions d'Altide :
- Directeur financier, client Groupe Hélios (hors Konekt), interlocutrice Anne Leclerc : les données de `Main.dc.html`, inchangées. Responsable Guillaume ; équipe Guillaume et Julie. Conditions avec le client : 20 % du fixe annuel, garantie 3 mois.
- Responsable paie, Groupe Hélios : responsable Julie, aucune action depuis 4 j.
- Chef de projet data, Banque Delmas : responsable Karim ; séquence « Approche data Delmas », 6 inscrits depuis le compte de Karim ; 4 réponses sans suite depuis 3 j.
- Contrôleur de gestion, Maison Arvel : responsable Karim ; 12 profils à trier.
- Responsable de production, mission liée, « confiée par Groupe Ardelle » : responsable Julie.

Directeur financier, **variante en équipe** (planche `EquipePipeline`), le même jour à 15 h :
- Guillaume suit : Camille Fontaine, Isabelle Laurent, Hélène Morel, Nadia David, Pierre Bertrand, Antoine Simon, Olivier Rousseau, Julien Roux, Thomas Lambert.
- Julie suit : Claire Dubois et Sophie Dupont (contactées le 20/09 depuis son compte, séquence « Approche Directeur financier »), et Marc Moreau depuis 11 h.
- 10 h : Guillaume répond à Marc. 11 h : il passe le suivi à Julie, mot « Il est dispo la semaine prochaine, tu peux caler la qualif ? », « Prévenir Marc » envoyé : « Bonjour Marc, Julie Garnier, ma collègue, prend le relais sur ce poste. Elle vous écrit très vite. » 14 h 20 : Marc répond sur la conversation de Guillaume : « Merci. Julie peut m'appeler jeudi après 16 h. »
- Sophie Dupont a répondu à Julie à 9 h 40 : « Merci pour votre message. Je peux échanger jeudi à 14 h. » ; Julie lui a répondu à 10 h 05.
- Les 4 profils à trier viennent de la recherche de Julie du 23/09. Dernière visite de Julie : 23/09 (Pierre Bertrand est passé en Entretien DG depuis).
- Aurélie Vincent : contactée par Julie le 12/09 pour la mission Responsable paie, sans réponse.

Directeur financier, **variante avec connexions** (planche `ConnexionsPipeline`), le même jour à 10 h, vue de Guillaume :
- Nadia David : entretien aujourd'hui 14 h, dans le Google Agenda de Guillaume, avec nadia.david@gmail.com, visio.
- Julien Roux : invitation acceptée le 19/09 (étape 1 sur 3), message LinkedIn le 21/09 (étape 2 sur 3), adresse julien.roux.pro@gmail.com trouvée le 23/09, e-mail de Guillaume le 23/09 à 17 h 02 (objet « Directeur financier, groupe industriel »), réponse le 24/09 à 8 h 51 : « Merci Guillaume, je peux vous appeler vendredi matin ? Je suis en déplacement jusqu'à jeudi. » Relance du 26/09 annulée. Téléphone inconnu.
- Camille Fontaine : relance à Anne Leclerc envoyée hier depuis guillaume@altide.fr ; réponse d'Anne à 9 h 40 : « Nous la recevons lundi, je vous confirme l'horaire demain. »
- Thomas Lambert : origine Vivier Altide (fiche du 14/03/2024), 06 41 27 88 15 ; appel hier à 18 h 10, messagerie ; tâche « Rappeler Thomas Lambert avant 17 h ».
- Laure Michel : adresse connue, trouvée le 20/09. Nicolas Fournier : dans Vivier Altide (« Bon profil, pas mobile à l'époque »), adresse inconnue.
- Vivier Altide, résultats de la source : Nicolas Fournier (aussi sur LinkedIn), Sylvie Caron (DAF, Groupe Savoy, Annecy, sans profil LinkedIn, e-mail connu), Hervé Dumas (Directeur financier, Poclain, Verberie, aussi sur LinkedIn).
- Olivier Rousseau, embauché aujourd'hui : rémunération retenue 185 000 €, prise de poste le 03/11/2026, 20 % = 37 000 € HT, garantie jusqu'au 03/02/2027, placé par Guillaume Martin.
- Camille Fontaine dans le Notion de Guillaume : page « Candidats 2024 », 03/04/2024, « Rencontrée pour Verallia. Mobilité Paris seulement. Préavis de 3 mois, négociable à 2. »
- Fichier d'import de démonstration : « Liste Groupe Hélios.xlsx », 42 lignes transmises par Anne Leclerc, 37 avec une identité (3 déjà connues), 5 sans ; rangement proposé : réservé à la mission.

**Groupe Ardelle** (entreprise, formule Entreprise ; groupe agroalimentaire, 800 salariés, Lyon). Teamtailor relié par Élise Vasseur le 15/09, 1 240 personnes lues, à jour il y a 2 h.

| Personne | Rôle | Initiales | Outils |
|---|---|---|---|
| Élise Vasseur | Propriétaire, responsable recrutement | EV | Outlook et agenda Outlook, elise.vasseur@ardelle.fr |
| Marion Carpentier | Membre, chargée de recrutement | MC | LinkedIn ; Outlook et agenda Outlook |
| Béatrice Hamon | Accès limité, directrice générale | BH | Agenda Outlook seulement |
| Denis Brunet | Sans compte, directeur de l'usine de Lyon | | Avis par lien |

Missions d'Ardelle :
- Responsable de production, usine de Lyon : « Vous et des recruteurs partenaires » ; responsable Élise ; équipe Élise, Marion, Béatrice. CDI, Saint-Priest, 65 à 75 k€ fixe. Critères : management d'équipes postées (indispensable), agroalimentaire ou chimie (indispensable), amélioration continue (souhaité), anglais (bonus). Étapes : Qualification (Marion Carpentier), Entretien usine (Denis Brunet, hors Konekt), Entretien DG (Béatrice Hamon). Conditions : 18 % du fixe annuel, garantie 3 mois, antériorité 6 mois, présentations jusqu'au 31/10, 3 partenaires au plus ; partagés : intitulé, contrat, lieu, critères, noms d'étapes, rémunération en fourchette, nom après accord.
  - Partenaires : Cabinet Altide (invitation envoyée à julie@altide.fr le 05/09, acceptée le 08/09 par Guillaume Martin à la demande de Julie) ; Vauban Conseil (Marketplace, accepté le 15/09). Proposition en attente : Hugo Lemaire, indépendant à Lille, le 24/09.
  - Présentés à examiner : Sébastien Perrin (Directeur d'usine adjoint, Tarkett, Lyon ; Altide, Julie Garnier, 24/09 à 11 h 02, première présentation ; argumentaire « Pilote 3 lignes en 3x8 et 120 personnes chez Tarkett. A conduit un projet TPM sur deux ans. Mobile sur Lyon, préavis de 2 mois. Attentes : 72 k€ fixe. » ; parcours Tarkett, Saint-Gobain, Michelin ; note 84) ; Karine Lemoine (Responsable production, Valeo, Villefranche-sur-Saône ; Vauban, 23/09 ; note 78) ; Yannick Ferrand (Responsable de fabrication, Danone, Bourgoin-Jallieu ; Vauban, 21/09 ; note 75).
  - En cours : Fabrice Tessier (Responsable de production, Bel, Lons-le-Saunier ; Altide, présenté le 17/09 ; Entretien usine le 18/09 avec Denis Brunet, avis demandé par lien le 18/09, pas rendu ; 6 j ; note 82) ; Cédric Hoarau (Directeur de production, Lactalis, Laval ; Vauban, présenté le 15/09 ; Entretien DG depuis 1 j ; note 85) ; Laurent Picard et Samia Benhamou (interne, Marion ; ont répondu il y a 3 j, sans suite ; notes 79 et 76) ; Romain Faure (Responsable de production, Seb, Selongey ; interne, contacté par Marion le 02/09 ; Qualification 3 j ; note 81 ; présenté aussi par Vauban le 22/09 : « déjà connu ») ; Élodie Arnaud (Responsable d'atelier, Andros ; interne ; Contactée 5 j, relance auto le 27/09 ; note 74).
  - À trier : 6 (recherche de Marion du 22/09). Écartés : Nadège Colas (Altide, écartée le 23/09, « Prétentions au-dessus de notre fourchette », motif partagé), Bruno Lefort (interne, trop junior).
  - Bilan par partenaire : Altide 3 présentés, 1 reçu en entretien, 1 à examiner, 1 écarté ; Vauban 4 présentés, 1 reçu en entretien, 2 à examiner, 1 déjà connu.
- Responsable des achats, site de Lyon : « Vous, en interne » ; responsable Marion ; créée le 16/09 depuis le poste Teamtailor « Responsable achats (H/F), Lyon · réf. 1187 », 14 candidatures. Étapes : Qualification (Marion ↔ Entretien RH), Entretien manager (Élise ↔ Entretien manager), Entretien DG (Béatrice ↔ à choisir). Candidatures dans « À trier » : cochées par Élise. Envoi au passage en entretien. Candidats : Damien Leroy (Acheteur senior, Seb, 86), envoyé dans Teamtailor le 22/09, passé en Entretien manager dans Teamtailor hier ; Laetitia Garcin (Responsable achats hors production, Plastic Omnium, 82), Qualification, entretien jeudi 25/09 à 10 h dans l'agenda de Marion ; Aline Roussel (Acheteuse famille, Legrand, 79), Qualification, envoi refusé par Teamtailor, « adresse e-mail manquante ». À trier : 5 candidatures Teamtailor depuis lundi (Kevin Morin, Sonia Perret, Bastien Giraud, Jérôme Vidal, Estelle Marchetti). Dans le Sourcing : Romain Chevallier, « Dans Teamtailor : candidature du 12/03/2025 au poste Acheteur projets, refusé à l'Entretien RH ».
- Responsable qualité, usine de Lyon : « Des recruteurs partenaires » ; CDI, 55 à 62 k€ ; publiée sur la Marketplace le 23/09, présentations jusqu'au 15/11 ; aucun partenaire, aucune proposition (rang 15).
- Autres postes Teamtailor : Technicien de maintenance (H/F), Lyon, publié le 03/09, 31 candidatures ; Contrôleur de gestion industriel (H/F), Lyon, publié le 18/09, 9 candidatures.

**Mission liée d'Altide, « Responsable de production · Groupe Ardelle »**, vue de Julie à 15 h : Sébastien Perrin (Chez Groupe Ardelle · à l'examen, présenté à 11 h 02) ; Fabrice Tessier (Chez Groupe Ardelle · Entretien usine, 6 j, « Relancer Élise Vasseur ») ; Nadège Colas (écartée par Groupe Ardelle hier, « Prévenir Nadège Colas ») ; Mathis Carré (Chef de production, Sodiaal, Qualification 5 j, note 80, « Présenter à Groupe Ardelle ? ») ; Anthony Faivre (Contacté, relance auto le 26/09, note 73) ; 12 à trier ; 2 retenus. Présenter Mathis Carré donne : « Présenté le 24/09 à 15 h 12. Vous êtes le premier recruteur à présenter Mathis Carré pour ce poste. »

**Vauban Conseil** (cabinet, sur la Marketplace depuis le 12/09) : Nathalie Brun (propriétaire), Thibault Masson (membre). **Hugo Lemaire** (indépendant, Lille, sur la Marketplace depuis le 20/09).

### 9.2 Planches modifiées

**`Cadrage.dc.html`** (fortement modifiée ; 1440 × 1560 portée à 1440 × 2000).
- Ce qui change. Le poste : « Qui recrute ? » en tête, « Vous, pour un client » coché ; « Conditions avec le client : 20 % du fixe annuel · garantie 3 mois ». Étapes : un sélecteur d'intervieweur par étape (Qualification : Guillaume Martin ; Entretien DG : « La directrice générale de Groupe Hélios, hors Konekt » avec un champ d'adresse facultatif ; Cas pratique : Anne Leclerc et la directrice générale). La section « Équipe et partenaires » remplace le bloc actuel (`Cadrage.dc.html:567-570`) : responsable Guillaume, Julie « ne suit aucun candidat », « Inviter… », case « Mission confidentielle ». Le mode chasse disparaît des Réglages provisoires.
- Cliquable. Les quatre choix de « Qui recrute » : « Vous et des recruteurs partenaires » ou « Des recruteurs partenaires » font apparaître la section Partenaires en variante co-traitance (« [ 40 ] % des honoraires facturés à Groupe Hélios », antériorité, date limite, « Ce que voient les partenaires » avec l'aperçu, « Inviter un partenaire par e-mail » ; pas de publication, réservée aux entreprises). « Inviter… » ouvre les trois choix (une personne d'Altide : Sarah Lopez, Karim Benali, Léa Chevalier ; une personne hors d'Altide ; un recruteur partenaire). « Changer de responsable » (fenêtre, mot facultatif). Le sélecteur d'intervieweur.
- Données : celles de `BRIEF.md` §5 et de la section 9.1.

**`MaintenantFormes.dc.html`** (fortement modifiée ; 1440 × 2300 portée à 1440 × 4400 ; non interactive, comme aujourd'hui).
- Ce qui change. Un bloc « La table des rangs » en tête : les 18 rangs, en trois groupes, en une ligne chacun (numéro, situation, destinataire). Puis un bloc « Nouvelles formes », une carte statique par forme, chacune avec sa ligne « Pourquoi maintenant ? » écrite :
  - rang 0 : « Votre boîte e-mail est déconnectée : la réponse à Julien Roux ne peut pas partir. » (Guillaume) ; « Teamtailor : connexion interrompue. 1 envoi attend. » (Élise) et sa ligne d'Ensuite chez Marion, « Teamtailor n'est plus relié : Élise Vasseur peut le reconnecter » ;
  - rang 1 lu dans l'agenda (Nadia David, 14 h) ; rang 2 après l'événement ;
  - rang 3 par e-mail (Julien Roux) ; rang 3 après passation (Julie, Marc Moreau) ; rang 3 « créneau choisi » (Marc Moreau, vendredi 26/09 à 11 h, « Passer en Qualification ») ;
  - rang 4 : réponse d'Anne Leclerc sur Camille Fontaine ; « Groupe Ardelle a écarté Nadège Colas » (« Prévenir Nadège Colas ») ; « Groupe Ardelle veut recevoir Fabrice Tessier en Entretien usine » (« Proposer un créneau ») ;
  - rang 5 : « 3 candidats présentés par vos partenaires attendent votre avis » (Élise) ;
  - rang 6 : « Hugo Lemaire, recruteur indépendant, propose ses services sur ce poste » ;
  - rang 7 : « Élise Vasseur vous demande votre avis sur Cédric Hoarau » (Béatrice Hamon) ;
  - rang 8 : « Rappeler Thomas Lambert avant 17 h » ;
  - rang 10, trois boutons selon S10 : « Relancer Anne Leclerc » (e-mail), « Relancer Élise Vasseur » (message dans Konekt), « Relancer Denis Brunet » (lien d'avis) ;
  - rang 12 : « 5 candidatures reçues dans Teamtailor depuis lundi, à trier » ;
  - rang 14 : « 37 000 € HT à facturer à Groupe Hélios pour Olivier Rousseau », et la fenêtre d'embauche statique (185 000 €, 03/11/2026, 20 %, garantie jusqu'au 03/02/2027, placé par Guillaume Martin) ;
  - rang 15 : « Aucun partenaire ne travaille encore sur ce poste » (Responsable qualité, Ardelle) ;
  - rang 17 : « Rien pour vous. Julie Garnier a 1 réponse à traiter. » ;
  - Ensuite avec une ligne d'équipe pour un responsable : « Marion Carpentier : 2 réponses sans suite depuis 3 j · Écrire à Marion · Reprendre » ;
  - la ligne de couverture e-mail, avec « Ne plus me le dire ».
- La forme existante « Nadia David a répondu à Julie Garnier » (`MaintenantFormes.dc.html:343`) devient « Sophie Dupont a répondu à Julie Garnier », cohérente avec la variante en équipe.

**Retouches légères**, non comptées :
- `Creation.dc.html` : dans « Voici ce que j'ai compris », une ligne « Pour Groupe Hélios [ Modifier ] ». Rien d'autre (organisation vue comme seule pour la création).
- `canvas.json` : positions (section 9.4), nouvelles notes.

**Planches inchangées** : `Main`, `FicheCandidat`, `PanneauContact`, `PanneauClient`, `TriUnParUn`, `ReponsesUnParUn`, `Sourcing`, `Neuve`, `Telephone`. Elles restent l'état d'un recruteur seul, sans connexion, pour un client hors Konekt : celui de 16 organisations sur 17.

### 9.3 Planches nouvelles

Toutes en thème sombre, avec l'en-tête, la barre latérale et les styles de `Main.dc.html` (`BRIEF.md` §1 à §4). Les fiches et panneaux sont dessinés dans la planche qui les ouvre, pas en fichiers séparés.

**1. `EquipePipeline.dc.html` · « Pipeline en équipe, vue de Julie Garnier »** (1440 × 900, interactive).
- Contenu : section 2.1 (maquette de Julie), barre latérale de Julie (À traiter 3 : « Marc Moreau 14 h 20 », « Guillaume Martin vous a passé le suivi de Marc Moreau », « Groupe Ardelle a écarté Nadège Colas » ; Missions : Directeur financier ouverte, Responsable paie, Responsable de production « confiée »).
- Cliquable :
  - menu « Afficher : Tous · Les miens 3 » (la liste et la barre d'étapes suivent, titre « En ce moment, vos candidats ») ;
  - « Voir ces 2 » de « Depuis votre passage » (la liste se réduit à Marc Moreau et Pierre Bertrand, la prochaine action montre le dernier geste : « Suivi passé par Guillaume · 11 h », « Entretien DG par Guillaume · 23/09 ») ;
  - clic sur Marc Moreau : fiche à droite avec « Suivi par vous depuis 11 h », le mot de passation, onglets Aperçu (notes de l'équipe : 16/09 Guillaume « Très à l'aise sur les clôtures IFRS. Préavis de 3 mois. », 24/09 Guillaume « @Julie Garnier je lui ai envoyé le lien, à toi. » ; champ « Ajouter une note pour l'équipe (@ pour mentionner) » : taper « @ » propose Guillaume, Sarah, Karim, Léa) et Échanges (fil signé, annonce « La conversation LinkedIn est sur le compte de Guillaume Martin », compositeur « Répondre depuis votre compte » avec les deux derniers extraits au-dessus) ;
  - « Répondre depuis votre compte » de la carte : compositeur, « Envoyer », puis la carte passe à « Trier 4 profils de votre recherche du 23/09 » ;
  - case de sélection sur Claire Dubois puis « Passer le suivi à… » : fenêtre de la section 2.4 (Guillaume, Sarah, Karim), mot, case « Prévenir Claire Dubois », annulation pendant 5 s ;
  - bascule « Vu par Guillaume Martin » en haut à droite : sa carte (« Notez l'entretien de Nadia David, aujourd'hui 14 h »), sa ligne d'Ensuite « Marc Moreau a répondu, Julie Garnier s'en occupe », initiales inversées ; un clic sur « Missions » du fil d'Ariane ouvre la liste des missions de la section 2.2, filtre « En attente depuis plus de 2 jours ouvrés (1) » qui ne garde que Chef de projet data.

**2. `ConnexionsPipeline.dc.html` · « Pipeline avec vos connexions »** (1440 × 900, interactive).
- Contenu : section 2.1 (maquette de Guillaume à 10 h, Gmail et Google Agenda reliés).
- Cliquable :
  - « Pourquoi maintenant ? » (« Événement de 14 h dans votre Google Agenda, avec nadia.david@gmail.com. ») ; « Plus tard » fait monter « Marc Moreau vous a répondu hier » ;
  - « Préparer l'entretien » : fiche de Nadia, Aperçu ;
  - Julien Roux (ligne ou élément d'Ensuite) : fiche sur Échanges (maquette de la section 2.3) ; bascule de canal (WhatsApp grisé « numéro inconnu ») ; clic sur un créneau libre l'insère dans le texte ; « Envoyer » ajoute l'échange en tête du fil ;
  - Thomas Lambert : fiche avec « Appeler » ; au clic, feuille « Noter l'appel » (Joint, Messagerie, Pas de réponse ; note ; rappel ; étape) ; « Enregistrer » ajoute l'appel au fil et coche la tâche « Rappeler avant 17 h » ;
  - Camille Fontaine : fiche sur la réponse d'Anne Leclerc ;
  - sélection de Laure Michel et Nicolas Fournier puis « Contacter » : panneau de choix du canal (section 2.4) ; « Trouver son adresse (1 crédit) » passe l'e-mail à 2 sur 2 après un court chargement ; case de confirmation puis « Lancer » ;
  - menu « Afficher » : Tous, Les miens, LinkedIn, Vivier Altide (Thomas Lambert seul).

**3. `EntreprisePartenaires.dc.html` · « Entreprise avec des partenaires, vue d'Élise Vasseur »** (1440 × 900, interactive).
- Contenu : section 2.1 (maquette d'Élise), barre latérale de Groupe Ardelle (Responsable de production ouverte, Responsable des achats, Responsable qualité).
- Cliquable :
  - « Examiner les 3 » : mode un par un sur place (Sébastien Perrin, Karine Lemoine, Yannick Ferrand ; « Recevoir en entretien » avec l'étape, « Qui organise ? » et les disponibilités ; « Écarter » avec motif et case « partagé » ; « Plus tard » ; message au partenaire ; compteur 1 sur 3 ; après le dernier : « Les 3 présentations sont traitées. Cabinet Altide et Vauban Conseil sont prévenus. ») ;
  - Fabrice Tessier : fiche d'un présenté (bloc « Présenté par Cabinet Altide (Julie Garnier) le 17/09, en premier », « Entretien usine avec Denis Brunet le 18/09 · avis demandé par lien, pas encore rendu · Relancer Denis Brunet », « Avis au partenaire » ; Évaluations : grille de Marion en Qualification, favorable ; Entretien usine en attente ; « Demander un avis à… » avec une adresse) ;
  - Romain Faure : fiche avec « Présenté aussi par Vauban Conseil le 22/09 · déjà connu : contacté par Marion Carpentier le 02/09 » ;
  - « Partenaires (2) » : panneau de la section 2.4 ; « Accepter » ou « Refuser » Hugo Lemaire (AlertDialog) ; clic sur Cabinet Altide : ses présentations, le fil, « Mettre fin à la collaboration » (AlertDialog) ;
  - menu « Afficher » : Tous, Les miens, Interne, Cabinet Altide, Vauban Conseil ;
  - « Bilan » : encart par origine (section 2.1) ;
  - onglet Cadrage : section Partenaires de la section 2.6 ; les cases de « Ce que voient les partenaires » mettent à jour l'aperçu ; changer le pourcentage affiche « S'applique aux prochains partenaires » ;
  - bascule « Vu par Denis Brunet, lien reçu par e-mail » : la page « Donner mon avis » de la section 2.11, « Envoyer mon avis », puis retour à Élise où l'avis apparaît dans la fiche de Fabrice ;
  - bascule « Vu par Béatrice Hamon, accès limité » : sa carte « Élise Vasseur vous demande votre avis sur Cédric Hoarau, après l'Entretien DG », une seule mission dans la barre, pas de section « Présentés », ni « À trier », ni écartés, Cadrage en lecture.

**4. `CabinetMissionConfiee.dc.html` · « Partenaire sur un poste confié, vue de Julie Garnier »** (1440 × 900, interactive).
- Contenu : section 2.1 (maquette de la mission liée) ; barre latérale d'Altide.
- Cliquable :
  - bascule « Invitation reçue le 05/09 » : page de la section 2.11 pour un membre, « Demander son accord » puis « Guillaume Martin a accepté le 08/09 · La mission Responsable de production est dans vos missions » ;
  - « Prévenir Nadège Colas » : message rédigé, modifiable, « Envoyer » ;
  - « Relancer Élise Vasseur » sur Fabrice Tessier : message de collaboration dans Konekt, « Envoyer » ;
  - « Client » dans la barre d'outils : panneau « client sur Konekt » de la section 2.4 ; cocher Mathis Carré ; « Rédiger avec l'assistant » remplit l'argumentaire ; la case d'accord est obligatoire (message si absente) ; « Présenter » fait passer sa ligne à « Chez Groupe Ardelle · à l'examen » ; un sélecteur « Réponse du serveur » montre les trois issues ;
  - onglet Cadrage : bloc « Défini par Groupe Ardelle » en lecture et blocs propres modifiables (« Vos messages » avec « Consultant du cabinet ») ;
  - bascule « Vu par Guillaume Martin » : les honoraires du panneau Client deviennent visibles (aucune embauche : « Vos honoraires apparaîtront ici après une embauche », jamais un zéro).

**5. `SourcingSources.dc.html` · « Sourcing : vos sources et vos contacts »** (1440 × 900, interactive).
- Contenu : section 2.5, Directeur financier, vue de Guillaume.
- Cliquable :
  - « Chercher dans » : LinkedIn, Base Konekt, Vivier Altide (la liste change ; sur le vivier, Nicolas Fournier « aussi sur LinkedIn », Sylvie Caron « sans profil LinkedIn », Hervé Dumas « aussi sur LinkedIn ») ;
  - « Votre vivier : 3 personnes correspondent · Voir » ;
  - « Retenir » sur Marc Moreau ouvre sa fiche (« déjà dans la mission ») ;
  - Aurélie Vincent, « Retenir » puis « Écrire » : fenêtre de confirmation « Julie Garnier l'a contactée le 12/09, pour la mission Responsable paie. Pas de réponse. » avec « Demander à Julie » (note d'équipe avec « @Julie Garnier » prérempli), « Écrire quand même », « Annuler » ;
  - « Importer un fichier » : panneau d'import avec « Liste Groupe Hélios.xlsx » (42 lignes) ; correspondance des colonnes modifiable ; « Où les ranger » (réservé à la mission, par défaut) ; « Importer 42 » montre la progression puis « 42 personnes réservées à Directeur financier. 3 rapprochées de profils déjà connus. ».

**6. `EntrepriseATS.dc.html` · « Entreprise avec son logiciel de recrutement, vue de Marion Carpentier »** (1440 × 900, interactive).
- Contenu : Pipeline de « Responsable des achats, site de Lyon » (en-tête « Teamtailor, à jour il y a 2 h » ; carte « 5 candidatures reçues dans Teamtailor depuis lundi, à trier » ; Ensuite « Envoi vers Teamtailor refusé pour Aline Roussel : ajoutez son adresse · Damien Leroy est passé en Entretien manager dans Teamtailor, hier » ; liste de la section 9.1).
- Cliquable :
  - « Noter et trier les 5 (au moins 10 crédits) » : une ligne de progression, puis le tri un par un sur Kevin Morin ;
  - Aline Roussel : fiche sur « Ajouter son adresse », puis « Envoyer dans Teamtailor » ;
  - Damien Leroy : étape « Entretien manager (Teamtailor) » ; « Étape suivante » ouvre « L'étape de ce candidat se suit dans Teamtailor. Changer l'étape dans Teamtailor » ;
  - Laetitia Garcin : « Entretien jeu. 25/09 à 10 h (agenda) » ;
  - onglet Cadrage : bloc Teamtailor de la section 2.6, correspondance des étapes modifiable, case des candidatures, « Détacher de Teamtailor » (AlertDialog) ;
  - bouton « Nouvelle mission » : fenêtre de création avec « Partir d'un poste de Teamtailor » replié ; le déplier liste les trois postes, « Responsable achats » grisé « déjà lié » ; « Technicien de maintenance » remplit le texte, puis « Voici ce que j'ai compris » avec « Lié à Teamtailor : Technicien de maintenance (H/F), réf. 1203 » ;
  - bascule « Connexion interrompue » : chez Marion, la ligne d'Ensuite « Teamtailor n'est plus relié : Élise Vasseur peut le reconnecter » ; bascule « Vu par Élise Vasseur » : le rang 0 avec « Reconnecter ».

**7. `ParametresOutils.dc.html` · « Paramètres : connexions, outils, équipe »** (1440 × 900, interactive).
- Contenu : coquille des Paramètres à deux portes ; trois rubriques de la section 2.9 : Mon compte > Connexions (Guillaume), Mon organisation > Outils, Mon organisation > Équipe (5 sièges sur 5).
- Cliquable :
  - Connexions : « Gérer » sur la boîte e-mail ; case d'accord de rotation ; « Absent jusqu'au » avec le choix du remplaçant (Julie Garnier) et la phrase « Pendant votre absence, vos réponses iront à Julie Garnier » ;
  - Outils : « Relier votre logiciel de recrutement » (choix Teamtailor, Welcome to the Jungle, Flatchr, puis « Connexion à Teamtailor… », puis la correspondance des étapes) ; « Dites-le-nous » (champ, « Merci, c'est noté ») ; « Supprimer » sur le vivier (AlertDialog : « Les 2 140 personnes sont supprimées. Les candidats déjà retenus restent dans leurs missions. ») ;
  - Équipe : formulaire d'invitation avec Administrateur, Membre, Accès limité décrits en une phrase ; « Retirer… » sur Karim Benali ouvre la fenêtre de départ (successeur Sarah Lopez ; 2 missions, 9 candidats, 3 tâches ; « Approche data Delmas », 6 inscrits mis en pause ; 4 conversations sans réponse restent sur son compte) ; « Retirer et confier à Sarah » ;
  - bascule « Vu par Élise Vasseur, Groupe Ardelle » : Outils avec Teamtailor relié (« relié le 15/09 par Élise Vasseur · à jour il y a 2 h · 1 240 personnes lues »), « Recruter avec des partenaires » (conditions par défaut : 18 %, fixe annuel, garantie 3 mois, antériorité 6 mois).

### 9.4 Place sur la toile (`canvas.json`)

- `Cadrage.dc.html` : h 2000. Les rubriques `r5` et `r6` et leurs planches descendent de 440 : `Creation` et `Neuve` à y 6196, `r5` à y 5896, `r6` à y 7196, `MaintenantFormes` à y 7496, h 4400.
- Nouvelle rubrique `r7`, « Équipe, partenaires et connexions », à y 12 200, maxW 2960.
- Rangée 1, y 12 500 : `EquipePipeline` (x 0), `ConnexionsPipeline` (x 1520).
- Rangée 2, y 13 800 : `EntreprisePartenaires` (x 0), `CabinetMissionConfiee` (x 1520).
- Rangée 3, y 15 100 : `SourcingSources` (x 0), `EntrepriseATS` (x 1520).
- Rangée 4, y 16 400 : `ParametresOutils` (x 0).
- `order` : les sept planches nouvelles après `MaintenantFormes`, dans l'ordre ci-dessus.
- Note bleue à x -620, y 12 500 : « Pour essayer : « Pipeline en équipe », vous êtes Julie Garnier ; ouvrez Marc Moreau, passez le suivi de Claire Dubois, basculez « Vu par Guillaume Martin ». Puis « Entreprise avec des partenaires » : « Examiner les 3 », « Partenaires », Fabrice Tessier, « Vu par Denis Brunet ». Puis « Partenaire sur un poste confié » : « Client », « Présenter ». Comparez avec « Pipeline » : la même mission pour qui travaille seul, sans connexion. »

### 9.5 Contrôles de rédaction

- Aucun nom de prestataire de Konekt à l'écran : ni le service de connexion LinkedIn et e-mail, ni le connecteur d'ATS, ni le fournisseur de coordonnées, ni celui de la Base Konekt, ni l'outil de prise de rendez-vous, ni le fournisseur d'IA. Permis : Gmail, Google Agenda, Outlook, agenda Outlook, WhatsApp, Teamtailor, Welcome to the Jungle, Flatchr, Notion, LinkedIn, Base Konekt, Marketplace.
- « Lien de prise de rendez-vous » pour le lien de réservation ; « l'assistant » pour l'IA.
- Aucun chiffre hors de la section 9.1. Aucun zéro là où la source manque : « Vos honoraires apparaîtront ici après une embauche ».
- Vouvoiement, phrases courtes, aucun tiret long, aucun emoji, les mots bannis de `BRIEF.md` §3. `python3 lint.py` sans erreur sur chaque planche.

---

## Annexe A. Vérifié dans le dépôt pour cet addendum (commit 5882084)

| Point | Verdict | Preuve |
|---|---|---|
| CF-B1 : une colonne ne peut porter l'anti-doublon | Confirmé | `src/lib/enrollmentDuplicates.ts:52-69` (ensemble de clés par profil) |
| CF-B2 : 15 `upsert` sur la clé par auteur | Confirmé | `useJobCandidateStatus.ts:249, 329, 399, 508, 580, 665, 771` ; `EnrollmentPreviewModal.tsx:560, 606` ; `SequenceEnrollModal.tsx:342` ; `ProfileDetailSheet.tsx:1132` ; `useMessagesInbox.ts:1132` ; `useATSData.ts:428` ; `add-to-shortlist/index.ts:223` ; `extension-quick-add/index.ts:110` |
| CF-B2 : migrations et fonctions sans ordre | Confirmé | `deploy-migrations.yml`, `deploy-edge-functions.yml` : aucun `needs` ni `workflow_run` |
| CF-B3 : organisation active, `/pipeline` sans filtre d'organisation | Confirmé | `20260903074500_rls_catchup_audit_critiques.sql:183-205` ; `useATSData.ts:136-140` |
| CF-B5 : séquences qui créent des fiches dans le Notion de la plateforme | Confirmé | `process-sequences/index.ts:22, 1430, 3487-3503, 1650-1668, 3770-3774` |
| CF-B5 : repli des bases Notion dans la mise en shortlist | Nuancé : seulement quand l'organisation a sa clé sans ses bases | `add-to-shortlist/index.ts:44-55` |
| CR C4 : clé Notion de la plateforme par défaut dans l'analyse des réponses | Confirmé | `auto-analyze-message/index.ts:20-23, 38-45` |
| CF-B6 : purge qui ne purge rien, non planifiée, mémoire effacée sans organisation | Confirmé | `rgpd-purge/index.ts:57-62, 70-73, 99-103` ; aucune occurrence `rgpd` dans `supabase/migrations` |
| CF-B6 : `/privacy` sans fournisseur d'embeddings | Confirmé | `src/pages/Privacy.tsx:115-125` |
| CU-B3 : réponses notifiées aux seuls membres liés ; aucune notification sans membre lié | Confirmé | `unipile-webhook/index.ts:1189-1198, 1286-1297` |
| CU-B5 : siège = toute ligne de membre ; 189 € par siège en Entreprise | Confirmé | `_shared/subscription-gate.ts:10-13` ; `20260906181806_p0_plans_trial_seats.sql:35-36` |
| CU-I6 : l'invitation exige l'adresse de l'invité | Confirmé | `accept-mission-invitation/index.ts:80-81` |
| CU-I10 : enrichissement fermé en formule gratuite | Confirmé | `src/lib/featureGates.ts:79` |
| CF-I7 : toute organisation créée ouvre l'essai unique de la personne | Confirmé | `20260906181806_p0_plans_trial_seats.sql:94-128` |
| CF-I7 : la mission liée compterait dans le plafond | Confirmé | `useQuotaGate.ts:31-37` |
| CF-I8 : `mail_received` pour tous les comptes ; adresse de l'expéditeur journalisée | Confirmé | `unipile-manage-webhooks/index.ts:56` ; `unipile-webhook/index.ts:1458` |
| CR C5 : tout compte non e-mail écrit comme LinkedIn | Confirmé | `unipile-webhook/index.ts:254-258, 524-567` |
| CF-I10 : privilèges par défaut ouverts ; audits listés à la main | Confirmé | `20260421180000_grants_bootstrap_owner_uniques.sql:28, 33-38` ; `.github/workflows/e2e.yml:109-142` |
| CF-I14 : une personne peut s'écrire tout type de notification | Confirmé | `20260906181044_p0_catchup_integrity_credits.sql:380-392` |
| CR C2 : un externe modifie les lignes et grilles de l'entreprise, lit ses notes toutes missions | Confirmé | `20260903074500_rls_catchup_audit_critiques.sql:36-57, 144-150` |
| CR C11 : la liste des missions ouvertes envoie le poste entier | Confirmé | `20260907053654_marketplace_partner_circle.sql:319-323` contre `:507-512` |
| CR C12 : la notation réécrit toutes les lignes d'un candidat pour une mission | Confirmé | `score-profile-job/index.ts:2528-2548` |
| LE §3 : conversations de l'assistant lisibles par l'organisation | Confirmé | `MIGRATION_CLEAN.sql:2902-2911` |
| S §5.5 : le portail envoie toutes les lignes ; liens sans expiration | Confirmé | `client-portal-data/index.ts:61, 105-113, 121-124` |
| LM §9 : `submit-application` publique | Confirmé | `supabase/config.toml:211-212` ; `submit-application/index.ts:130-147` |
| LI §5 : agenda de la plateforme sans filtre d'organisation | Confirmé | `calendly-webhook/index.ts:189-194, 234-241` |
| LE §10 : repli sur les comptes des collègues | Confirmé, ligne 31 | `useFilteredLinkedInAccounts.ts:27-32` ; `useCandidateFullProfile.ts:163-176` |
| LM §4 : textes de la marketplace | Confirmé | `MissionHuntMode.tsx:164, 490, 494` |
| Données de la maquette | Relu | `maquette-mission/project/Main.dc.html:447-466` ; `canvas.json` ; `BRIEF.md` §5 ; `Cadrage.dc.html:569` ; `MaintenantFormes.dc.html:343` |

## Annexe B. Où chaque critique est traitée

| Critique | Section |
|---|---|
| CU-B1 et CF-B3 : où travaille le partenaire | S7, S8, 2.1, 2.4, 3.4, 7 (décision 14), 8 |
| CU-B2 et CF-I4 : table des rangs | 2.1 |
| CU-B3 : passation | S3, 2.1, 2.4, 7 (décision 18) |
| CU-B4 : ce qui traîne chez les collègues | 2.1 (Ensuite), 2.2 |
| CU-B5 : managers et sièges | 2.3, 2.11, 3.4, 5.1 (lot 6), 7 (décision 19) |
| CU-I1 et CF-I1, CF-I3 : calendrier, lot C, 0a | 5.1, 5.2, 5.3, 8 |
| CU-I2 : absence | S3, 2.9, 5.2 (E1), 8 |
| CU-I3 : honoraires hors marketplace | 2.2, 2.6, 5.2 (H), 7 (décision 22) |
| CU-I4 et CF-I13 : droits, conditions, mission confidentielle | S8, 2.4, 2.6, 3.2, 3.4 |
| CU-I5 : création | S7, 2.7 |
| CU-I6 : invitation d'un membre | 2.11 |
| CU-I7 : qui organise l'entretien d'un présenté | 2.1 (examiner un par un), rang 4 |
| CU-I8 : Konekt et l'ATS | 2.1 (liste), 2.6, 6 (risque 10), 7 (décision 23) |
| CU-I9 : marketplace entre C et P2 | 2.10, 7 (décision 17) |
| CU-I10 : écran du recruteur seul | 2.1 (couverture), 2.3, 2.5, 8 |
| CU-I11 : disposition de la liste | 2.1 (liste), 8 |
| CU-I12 : e-mails de l'interlocuteur | 3.4, 7 (décision 21) |
| CU-I13 : libellés | S7, 2.10, 7 (fin) |
| CU-I14 : distribution | 9.1, 8 |
| CF-B1, CF-B2 : identité, clé unique | S1, S2, 5.1 (0a), 6 (risques 1 et 2) |
| CF-B4 : fil conçu deux fois | S4, 3.2, 8 |
| CF-B5 : Notion de la plateforme | 4 (R1), 7 (décision 16) |
| CF-B6 : données personnelles | 4 (R17), 5.2 (R) |
| CF-I2 : deux fonctions d'étape | S2 |
| CF-I5, CF-I6 : portes, origine | S2, 2.1, 2.6 |
| CF-I7 : espace du partenaire | 2.11, 7 (décision 14) |
| CF-I8 : boîtes et WhatsApp personnels | 4 (R5, R9), 7 (décision 24) |
| CF-I9 : coûts | 5.2 (I1, I3, I6a), 6 (risque 6) |
| CF-I10 : garde-fous | S11, 3.6, 4 (R13) |
| CF-I11 : ordre des retraits | 3.1 |
| CF-I12 : copie du poste | 5.2 (P1), 8 |
| CF-I14 : détails | 3.2, 3.4, 5.1 (0a), 8 |
| CF-I15 : dépendances et aiguillage | S10, 5.2 (I2, I6a) |
