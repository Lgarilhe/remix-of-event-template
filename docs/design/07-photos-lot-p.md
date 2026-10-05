# 07 · Lot P, la copie privée des photos des candidats

Plan du 5 octobre 2026, relu par deux relecteurs indépendants (exactitude contre le code, RGPD et produit) puis corrigé. Aucun code n'est écrit. Ce document dit quoi faire, dans quel ordre, comment vérifier chaque étape, et ce que le propriétaire doit trancher d'abord.

## 1. Ce que la production a montré

La décision de départ (`06-simplicite.md`) : les pastilles montrent les vraies photos des candidats, et Konekt en garde une petite copie privée, supprimée avec le candidat.

Les comptages du 5 octobre 2026 sur la base de production (lecture seule, aucun nom ni aucune adresse lus) changent la forme du lot.

Les adresses de photo expirent vite. LinkedIn signe chaque adresse avec une date d'expiration (paramètre `e=`). Sur 1 581 adresses stockées, 1 295 sont déjà expirées (82 %). Les 286 valides expirent toutes avant le 22 octobre 2026. À la création d'une ligne, il restait 20 jours de validité en médiane (de 7 à 112). Une copie ne peut donc pas partir « plus tard » des adresses déjà stockées : elle doit partir peu après la réception d'une adresse fraîche.

La plupart des candidats du Pipeline n'ont aucune adresse utilisable. Sur les 1 011 personnes distinctes du Pipeline (hors profils jamais ouverts), 35 ont une adresse valide, 391 n'ont qu'une adresse expirée et 585 n'en ont aucune. Hors écartés, il reste 275 personnes : 22 valides, 69 expirées, 184 sans adresse.

La copie sur sortie de « jamais ouvert » tombe souvent sur une adresse déjà morte. Sur 380 lignes du Pipeline qui ont une adresse, 103 (27 %) avaient une adresse déjà expirée à leur dernière écriture. Une ligne est notée 13 jours après sa création en médiane (322 heures) ; sur 624 lignes notées, 74 l'ont été le jour même.

Les visages mis en ligne le 5 octobre s'affichent donc pour ces quelques dizaines de personnes et pour toute adresse fraîche à venir ; ailleurs ce sont des initiales. L'affichage fonctionne : les données manquent. Le lot P y répond par une copie prise à temps. Une première étape (P-0b) alimente déjà la copie en gardant les adresses fraîches.

### Mesures du 5 octobre 2026

Les comptages « lignes » sont par (organisation, mission, candidat), comme la vue `mission_candidate_rows` ; les comptages « personnes » sont par (organisation, candidat), ce que la copie utilise.

| Mesure | Valeur |
|---|---|
| Lignes `job_candidate_status` | 2 429, une seule organisation |
| Personnes distinctes | 2 235 ; 2 228 adresses de profil distinctes |
| Forme de `candidate_id` | 2 322 de type Recruiter (`AEMAA…`), 82 numériques, 25 autres, aucun `ACoAA…`, aucun `linkedin:…` |
| Lignes avec adresse de photo | 1 581, toutes sur le domaine `licdn.com` |
| Adresses expirées / valides | 1 295 / 286 |
| Validité restante à la création de la ligne | médiane 20 jours, de 7 à 112 |
| Personnes du Pipeline (hors jamais ouverts) | 1 011 : 35 valides, 391 expirées, 585 sans adresse |
| Personnes du Pipeline hors écartés | 275 : 22 valides, 69 expirées, 184 sans adresse |
| Lignes du Pipeline par étape | 1 025 : à trier 234, retenu 23, contacté 18, a répondu 3, écarté 747 |
| Lignes actives (hors écartés) | 278 : 20 valides, 47 expirées, 211 sans adresse (à trier 176, retenu 17, contacté 16, a répondu 2) |
| Lignes écartées | 747 : 10 valides, 303 expirées, 434 sans adresse |
| Lignes jamais ouvertes | 1 326 : 256 valides, 897 expirées, 173 sans adresse |
| Lignes du Pipeline avec adresse, dont adresse déjà expirée à la dernière écriture | 380, dont 103 (27 %) |
| Délai entre création et dernière écriture d'une ligne notée | médiane 322 heures ; 74 notées le jour même sur 624 |
| Lignes créées en 30 jours | 368, dont 285 avec une adresse (77 %) |
| Profil LinkedIn enregistré | 9 ko en moyenne |
| Candidats avec conversation, avec inscription de séquence, InMails | 17, 17, 4 |
| Effacements dans le registre global ; inscriptions marquées effacées | 0 ; 0 |
| Tâches planifiées (`cron.job`) pour `rgpd-purge` ou le nettoyage du cache Coresignal | aucune |
| Clés étrangères de `job_candidate_status` en production | organisation et mission en `ON DELETE CASCADE`, étape d'entretien en `SET NULL` |
| Buckets existants | `candidate-cvs` (privé), `org-logos` et `event-images` (publics) ; pas de `coaching-audio` |
| Offre Supabase | Pro |

## 2. Ce que le code montre

- Aucune fonction serveur n'écrit `linkedin_profile_data`. Seul le navigateur l'écrit (`useJobCandidateStatus.ts`, `ProfileDetailSheet.tsx`). Les lignes créées par le serveur (assistant, `add-to-shortlist`, envoi de séquence ou d'InMail) n'ont donc jamais de photo.
- Quatre endroits perdent ou n'enregistrent jamais l'adresse :
  - `batchDiscover` (`useJobCandidateStatus.ts`) ignore les doublons : une ligne déjà en base ne reçoit jamais l'adresse fraîche d'une nouvelle recherche, qu'elle ait une adresse expirée ou aucune, et seule la petite image est écrite.
  - `ProfileDetailSheet.tsx` (lignes 518 à 521) remplace le profil de toutes les lignes du candidat par le profil brut ; sans photo dans ce profil, la clé disparaît.
  - `EnrollmentPreviewModal.tsx` et `AddToProjectButton.tsx` créent des lignes sans profil alors qu'ils ont le profil, photo comprise, en mémoire.
  - Avant le correctif du 4 octobre (PR #257), chaque notation effaçait l'adresse. Cela explique une grande part des 176 candidats À trier sans adresse.
- Aucun appel LinkedIn de fond n'est permis. Le worker d'enrichissement est éteint (`ENRICHMENT_PAUSED = true`, `process-enrichment-queue/index.ts`, décision du 7 juillet 2026 après l'avertissement LinkedIn #260513-007211). Les appels internes de `unipile-search` ne sont pas plafonnés par `profile_view`.
- L'effacement RGPD ne supprime aucune ligne candidat. `recordGdprErasure` (`_shared/get-or-fetch-contact.ts`) vide `reply_summary`, supprime les liens de conversation, arrête les séquences, mais laisse `linkedin_profile_data`, donc l'adresse de la photo, lisible. Un effacement limité à une organisation n'écrit pas dans `gdpr_erasures` : sa seule trace est le marqueur `gdpr_erased_at` des inscriptions de séquence, que `isCandidateErasedForOrg` lit. Une personne sans inscription n'a donc aucune trace d'effacement.
- `rgpd-purge` n'est planifiée nulle part et ne supprime rien sans `{"dry_run": false}`. Les durées annoncées sur `/privacy` (24 et 12 mois) ne sont donc pas appliquées aujourd'hui. Son étape audio vise un bucket `coaching-audio` qui n'existe pas en production.
- Une suppression SQL (purge, cascade d'une mission ou d'une organisation, confirmée en production) ne retire aucun fichier du stockage. Le bucket `candidate-cvs` a déjà ce défaut : ni l'effacement, ni la purge, ni l'export ne le couvrent.
- « Retirer de la mission » (`project_id` remis à vide) laisse la ligne en base, hors de la vue : elle compte comme une ligne de la personne.
- La pile e2e locale n'a pas de service de stockage (`storage-api` exclu de `e2e.yml`), et les tests `e2e/api` qui appellent des fonctions serveur ne tournent pas dans la CI (ils exigent `E2E_EDGE_FUNCTIONS=1`). La copie et l'effacement de fichiers ne se testent pas de bout en bout en CI.
- `export-org-data` lit `job_candidate_status` en `select *` limité à 10 000 lignes, sans signaler la troncature, et n'inclut aucun fichier.
- `/privacy` ne parle ni de photo ni de stockage de fichiers.

## 3. Choix de conception recommandés

| N° | Sujet | Recommandation |
|---|---|---|
| R1 | Modèle | Une table `candidate_photos`, une ligne par organisation et personne, partagée entre missions. Aucune colonne ajoutée à `job_candidate_status`. |
| R2 | Stockage | Bucket privé `candidate-photos`, chemin `{organization_id}/{uuid}.{ext}`, lecture par liens signés d'une heure demandés en lot. |
| R3 | Capture | Un déclencheur léger met la personne en file ; un worker copie depuis le CDN. Aucun téléchargement dans une requête d'utilisateur. |
| R4 | Source de l'adresse | La table porte l'adresse à copier (`source_url`) ; le worker ne relit pas `job_candidate_status`. Le déclencheur ne met pas en file une adresse déjà expirée. |
| R5 | Format | Garder la petite image reçue si elle fait 160 px ou moins et 40 ko ou moins ; sinon la réduire à 128 px en JPEG si une bibliothèque tient dans les fonctions (spike S2) ; sinon refuser. Plafond de 256 Kio sur le bucket. |
| R6 | Effacement | Une fonction SQL `erase_candidate_photos` laisse une trace d'effacement (ligne `erased`, sans adresse ni image) que le déclencheur respecte, supprime les copies, retire les deux clés d'adresse du profil. |
| R7 | Fichiers | Toute suppression de ligne ou de chemin inscrit les chemins dans une boîte d'envoi ; le worker la vide par l'API de stockage. Un balayage SQL quotidien rattrape les copies sans ligne candidat et les objets sans ligne. |
| R8 | Affichage | Copie, sinon adresse LinkedIn enregistrée, sinon initiales. `photo_path` en dernière colonne de la vue `mission_candidate_rows`. |
| R9 | LinkedIn | Aucun appel au compte LinkedIn. Le worker télécharge pourtant des images sur le domaine d'images de LinkedIn depuis un centre de données : c'est un téléchargement automatisé, à soumettre au juriste (question 4). |
| R10 | Options écartées | Images en base, bucket public, proxy par fonction, transformation d'image Supabase, copie de tous les résultats de recherche. Raisons en 4.7. |

## 4. Architecture

### 4.1 Données

Bucket `candidate-photos` : privé, 256 Kio au plus, types `image/jpeg`, `image/png`, `image/webp`. Chemin `{organization_id}/{uuid}.{ext}` avec un uuid neuf à chaque version, jamais l'identifiant du candidat dans le chemin (il peut valoir `linkedin:<slug>`).

Table `public.candidate_photos`, créée par migration :

| Colonne | Rôle |
|---|---|
| `id` | uuid, clé primaire |
| `organization_id` | uuid, clé étrangère vers `organizations`, `ON DELETE CASCADE` |
| `candidate_id` | texte, même identifiant que `job_candidate_status.candidate_id` |
| `linkedin_slug` | texte en minuscules, aide à l'effacement par adresse de profil |
| `status` | `pending`, `stored`, `failed` ou `erased` |
| `source` | `pipeline`, `backfill`, `shortlist`, `extension`, `messaging`, `sequence` |
| `source_url` | adresse à copier ; remise à NULL une fois la copie faite |
| `source_variant` | `small` (`profile_picture_url`) ou `large` (`profile_picture_url_large`) |
| `source_key` | hôte et chemin sans paramètres, pour voir qu'une photo a changé sans suivre la signature |
| `source_expires_at` | date lue dans le paramètre `e=` de l'adresse |
| `upload_path` | chemin réservé au moment de la réclamation, avant l'envoi du fichier |
| `storage_path`, `mime_type`, `byte_size`, `content_hash` | la copie (SHA-256 en hexadécimal) |
| `attempts`, `locked_at`, `next_attempt_at`, `last_error` | reprise ; `last_error` est un code court (`http_403`, `expired`, `too_large`, `bad_type`), jamais l'adresse |
| `captured_at`, `created_at`, `updated_at` | dates |

Contraintes : unicité de `(organization_id, candidate_id)` et de `storage_path` ; `status = 'stored'` exige chemin, type, taille et empreinte ; `status = 'erased'` exige que `source_url`, `upload_path` et `storage_path` soient NULL ; `candidate_id` rogné, de 1 à 512 caractères. Index partiel sur `next_attempt_at` pour `status = 'pending'`, index sur `(organization_id, linkedin_slug)`.

Une ligne `erased` reste en place : elle ne porte que l'identifiant et le slug, ni adresse ni image. Elle sert de trace pour que le déclencheur ne remette jamais la personne en file. Elle disparaît avec l'organisation (cascade).

Droits, dans cet ordre, car les privilèges par défaut du schéma donnent déjà `SELECT`, `INSERT`, `UPDATE` et `DELETE` à `authenticated` sur toute table neuve (`20260421180000`) :
- `REVOKE ALL` sur `candidate_photos` et `candidate_photo_removals` pour PUBLIC, `anon` et `authenticated`.
- RLS active sur les deux tables.
- Sur `candidate_photos` : une seule policy `SELECT` pour `authenticated`, limitée à l'organisation de l'appelant (`get_user_org_id`), et `GRANT SELECT (id, organization_id, candidate_id, status, storage_path, captured_at)` : `source_url`, `upload_path` et `last_error` restent fermés. La jointure de la vue `security_invoker` n'a besoin que de `organization_id`, `candidate_id` et `storage_path`.
- `GRANT ALL` à `service_role` ; rien pour `anon` ; aucune écriture pour `authenticated`.
- L'audit contrôle `has_column_privilege('authenticated', 'public.candidate_photos', 'source_url', 'SELECT')` faux et `has_table_privilege` faux (jamais d'appel d'une fonction refusée sous `SET ROLE`, règle de `CLAUDE.md`).

Table `public.candidate_photo_removals` : `storage_path` en clé primaire, date. Deux déclencheurs sur `candidate_photos` y inscrivent les chemins, `ON CONFLICT DO NOTHING`, seulement quand le chemin n'est pas NULL (une ligne `pending` ou `failed` n'en a pas, sans quoi la clé primaire ferait échouer la suppression) :
- `BEFORE DELETE` : `storage_path` et `upload_path` de la ligne supprimée. Il couvre la cascade d'une suppression d'organisation.
- `BEFORE UPDATE OF storage_path, upload_path` : l'ancien chemin quand il change ou devient NULL (remplacement d'une photo, effacement).

Le worker vide cette table par l'API de stockage, et une absence d'objet compte comme un succès. Un `DELETE` SQL sur `storage.objects` laisse le fichier et sa facturation, et la garde du schéma le bloque (`org_logos_storage_audit.sql`).

Policy de `storage.objects` : une seule, `SELECT` pour `authenticated`, `bucket_id = 'candidate-photos'` et premier dossier du chemin égal à l'organisation de l'appelant, comparé en texte (un cast `::uuid` lèverait sur un chemin quelconque, remarque de la migration `20260923095813`). Aucune policy d'écriture.

Vue : `photo_path` ajouté en dernière colonne de `mission_candidate_rows` par un `LEFT JOIN public.candidate_photos cp ON cp.organization_id = r.organization_id AND cp.candidate_id = r.candidate_id` placé après `rn = 1`, avec `cp.storage_path` (NULL pour une ligne `erased`). La vue reste `security_invoker`, la RLS de `candidate_photos` s'applique à l'appelant, le filtre sur `project_id` reste sous les fenêtres.

### 4.2 Capture

Un déclencheur `jcs_enqueue_candidate_photo` sur `job_candidate_status` : `AFTER INSERT` et `AFTER UPDATE OF linkedin_profile_data, status, score, decision_source, rejected_at, contacted_at, general_stage`. Il est `SECURITY DEFINER`, avec `search_path` fixé et `EXECUTE` retiré à PUBLIC et `anon`. Il est créé après la fonction d'effacement (P-3a), pas avant.

- Adresse lue : `profile_picture_url` en priorité, sinon `profile_picture_url_large` (même règle que l'affichage), avec `source_variant` en conséquence.
- Il sort sans rien faire s'il n'y a pas d'organisation, pas d'adresse `https` de 2 048 caractères au plus, ou si le paramètre `e=` est déjà passé (la personne attend une adresse fraîche : rien n'est compté comme un échec).
- Il sort aussi pour une ligne « jamais ouverte » telle que le déclencheur peut la voir : `status = 'discovered'`, score vide, aucune décision, aucun écart, aucun contact. La vue ajoute deux conditions (aucune inscription de séquence, aucun InMail) qu'un déclencheur sur cette table ne peut pas évaluer : une personne inscrite ou en file InMail dont la ligne reste « découverte » n'est copiée qu'à son passage à « Contacté », ou par le rattrapage P-5 qui lit la vue. Volume en production : 17 inscriptions, 4 InMails.
- Il sort enfin pour une ligne écartée (`general_stage = 'rejected'`), si le propriétaire retient cette règle (décision D1).
- Il écrit par `INSERT … ON CONFLICT (organization_id, candidate_id) DO UPDATE … WHERE`, avec trois garde-fous : jamais sur une ligne `erased` ; une ligne `pending` ou `failed` reçoit l'adresse la plus fraîche et repasse `pending` ; une ligne `stored` n'est remise en file que si la petite adresse change de chemin (`source_key`), jamais parce qu'une autre ligne ne porte que la grande. La ligne n'est pas réécrite si rien ne change.
- Tout le corps est dans un bloc `EXCEPTION WHEN OTHERS` qui journalise un avertissement. Un échec de mise en file ne fait jamais échouer une note, une recherche ou un envoi.
- Il ne fait aucun appel HTTP (le déclencheur d'ingestion `trigger_auto_ingest_context` en fait un par ligne) et n'écrit jamais dans `job_candidate_status`, donc ne touche ni `updated_at` (qui range le /pipeline et fixe la fenêtre de purge de 24 mois) ni l'ingestion.

Il couvre la notation, la retenue, les deux écritures de `ProfileDetailSheet` et les lignes créées avec profil par le navigateur. Il ne couvre pas les lignes créées sans profil par le serveur (assistant, `add-to-shortlist`, envoi, extension) : ce sont les captures de P-7, qui passent par une fonction d'enfilage et non par une photo écrite dans le profil (voir P-7).

### 4.3 Worker

Fonction `process-candidate-photos`, dans un dossier à elle (tout changement de `_shared/` redéploie les 70 fonctions, environ 37 minutes), avec sa section `[functions.process-candidate-photos] verify_jwt = false` dans `supabase/config.toml`. Authentification comme `process-agent-tasks` : jeton égal à `SB_SECRET_KEY` ou `PROCESS_SEQUENCES_SECRET`, `POST` seulement. Le module de garde `policy.mjs` vit dans le dossier de la fonction et non dans `_shared/` (convention des autres modules de politique) pour éviter un redéploiement général.

Chaque passage fait deux choses :
1. Toujours : vider `candidate_photo_removals` par l'API de stockage.
2. Si `candidate_photos_enabled` vaut `on` dans `internal_config` : copier des photos. La clé vaut `off` à la livraison, on l'active et on l'éteint sans déploiement. L'interrupteur ne gouverne que le téléchargement : la vidange de la boîte et le balayage restent actifs, car les effacements continuent d'y inscrire des chemins.

Cron chaque minute par `invoke_process_candidate_photos()`, qui lit `internal_config` (modèle `20260714121000_agent_daily_digest_cron.sql`, planification dans un bloc qui tolère l'absence de `pg_cron`).

Copie, ligne par ligne :
- `claim_candidate_photos(p_limit)` réserve des lignes `pending` dont `next_attempt_at` est échu (`FOR UPDATE SKIP LOCKED`), pose `locked_at`, avance `attempts`, écrit `upload_path` (le futur chemin, avant tout envoi, pour que toute suppression de la ligne l'inscrive dans la boîte). Une ligne dont `locked_at` a plus de 10 minutes est de nouveau réclamable (worker mort). `SECURITY INVOKER`, réservée à `service_role`.
- Contrôler la trace d'effacement : ligne `erased`, puis registre (`isCandidateErasedForOrg`, échec fermé : si le registre est illisible, reporter, ne jamais copier). Ce contrôle ne couvre que les candidats inscrits en séquence ou effacés globalement, plus les lignes `erased` posées par R6.
- Télécharger `source_url` sous garde, envoyer l'objet sur `upload_path`, puis mettre à jour la ligne `WHERE id = $1 AND status = 'pending' AND upload_path = $2` (`stored`, `storage_path`, empreinte, `source_url` remise à NULL). Si la mise à jour touche 0 ligne (la personne a été effacée pendant le téléchargement), supprimer l'objet envoyé ; la boîte d'envoi en garde de toute façon le chemin.
- Garde de téléchargement, dans `policy.mjs`, testé par Node : `https` seulement, hôte `media.licdn.com` ou terminé par `.licdn.com` (frontière au point), pas d'adresse IP, de port ni d'identifiants, 2 048 caractères au plus, `redirect: 'manual'` avec refus de toute réponse 3xx, aucun cookie, aucun `Authorization`, aucun `Referer`, délai de 8 s par `fetchWithTimeout`, 1 Mio au plus lu en flux (`Content-Length` peut mentir), type reconnu par les octets de tête (JPEG, PNG, WebP) et non par `Content-Type`, côtés de 4 096 px au plus.
- Format : l'image telle quelle si elle fait 160 px ou moins et 40 ko ou moins, sans calcul. Sinon réduction à 128 px en JPEG qualité 80 si le spike S2 trouve une bibliothèque ; sinon `failed` (`too_large`).
- Budget : cinq lignes par appel quand rien n'est réduit, 400 à 800 ms entre deux téléchargements, soit environ 300 par heure. Si une réduction est nécessaire, deux lignes par appel et une garde de temps avant d'en démarrer une : le temps de processeur de l'appel entier se mesure en S2 (2 s par requête, hors attente réseau).
- Reprise : erreur transitoire (réseau, délai, 429, 5xx) : report de 15 minutes doublé à chaque essai (plafond 6 heures), `failed` au cinquième échec. Réponse 403, 404 ou 410 : `failed` avec le code `expired`, sans nouvel essai. Une nouvelle adresse reçue par le déclencheur remet la ligne à `pending`.
- La panne du worker fait grossir la file et rien d'autre. Il n'appelle ni Unipile ni le compte LinkedIn.

Balayage : une fonction SQL `sweep_candidate_photos()`, planifiée chaque nuit par `pg_cron` et indépendante de l'interrupteur :
- supprime les lignes `candidate_photos` (hors `erased`) sans aucune ligne `job_candidate_status` pour (organisation, candidat), dont `updated_at` a plus de 24 heures (les déclencheurs de 4.1 inscrivent les chemins) ; une ligne « retirée de la mission » existe toujours et compte comme une ligne de la personne ;
- inscrit dans la boîte les objets du bucket (lus dans `storage.objects`, en lecture seule) qui n'ont ni ligne ni entrée de boîte et ont plus de 24 heures.

### 4.4 Lecture par le navigateur

- `src/lib/candidatePhotos.ts` signe par `createSignedUrls(paths, 3600)`, par lots de 100 chemins regroupés sur 30 ms (une requête pour une page de 50 lignes), garde chemin et échéance en mémoire, renouvelle 5 minutes avant l'échéance, et ne lève jamais d'erreur. Un hook `useCandidatePhotoUrl(path)` s'appuie sur `useSyncExternalStore`.
- `PersonAvatar` gagne une prop facultative `photoPath` ; sans elle, rendu identique à aujourd'hui (convention du dépôt : drapeau, défaut identique). Avec elle : initiales pendant la signature (aucune requête vers le CDN LinkedIn tant que la copie est attendue), puis la copie, puis l'adresse LinkedIn `src` si la copie échoue, puis les initiales. `AvatarStack` signe au plus 3 chemins par mission.
- Lecteurs à brancher : `MISSION_ROW_LIGHT_COLUMNS` (`v3/types.ts`) et `MissionCandidateRow.photoPath`, `MCR_DISPLAY_COLUMNS` et `ATSCandidate` (`useATSData.ts`), `useInterviewingPeople.ts`, puis `CandidateListRow`, `MissionBoard`, `CandidatePanelHeader`, `candidatePictureUrl`, `ATSCandidateCard`, `ATSTable`, `ATSTimeline`. Les colonnes `picture` et `picture_large` restent pour le repli.
- Le Sourcing en direct garde l'adresse renvoyée par la recherche (fraîche, non stockée). Le portail client n'a aucune photo et n'en aura pas sans `can_see_names`. Un membre d'équipe de mission d'une autre organisation lit la ligne mais pas la copie : il retombe sur l'adresse LinkedIn puis les initiales (3 lignes `mission_team` en production, marketplace gelée).
- Effet utile : un navigateur ne contacte plus le CDN LinkedIn pour les candidats copiés.

### 4.5 Effacement, purge, export

La fonction `erase_candidate_photos(p_organization_id, p_candidate_ids, p_slug)` est réservée à `service_role` (`SECURITY INVOKER`), créée par une migration de P-3a. Elle fait quatre choses dans une transaction :
1. Pose ou met à jour une ligne `erased` pour chaque identifiant et pour le slug du périmètre, en remettant `source_url`, `upload_path` et `storage_path` à NULL (les déclencheurs de 4.1 inscrivent les chemins dans la boîte).
2. Retire `profile_picture_url` et `profile_picture_url_large` du JSON `linkedin_profile_data` des lignes concernées (l'opérateur SQL `- 'clé'` : PostgREST ne sait pas le faire). Cet `UPDATE` passe par `update_job_candidate_status_updated_at` et par l'ingestion de `trg_auto_ingest_job_candidate_status` : c'est accepté pour ces seules lignes, puisqu'elles ne sont pas effacées elles-mêmes, et cela repousse leur fenêtre de purge de 24 mois.
3. Supprime la ligne du cache Coresignal de la personne dans le périmètre (`coresignal_profile_cache.profile_data` contient aussi l'adresse de la photo ; colonnes à vérifier en P-3a).
4. Renvoie les comptes (`deleted_photos`, lignes de profil nettoyées).

`recordGdprErasure` l'appelle en étape 10, après l'étape 9, avec le même ensemble `candidateIds` que l'étape 9 (identifiants des inscriptions retrouvées par e-mail ou par adresse de profil, slug, identifiants des lignes du pipeline). Limite héritée : un candidat sans inscription, effacé par e-mail seul, n'est pas retrouvé. Un effacement global (`p_organization_id` nul) agit dans toutes les organisations.

L'effacement n'empêche pas une nouvelle recherche de retrouver la personne ni d'écrire de nouveau son adresse dans le profil de sa ligne (c'est le comportement actuel) : il empêche la copie. Supprimer la ligne elle-même relève du lot R (`erase_person`).

| Événement | Aujourd'hui | À faire |
|---|---|---|
| Effacement à la demande, organisation ou global | `recordGdprErasure` ne touche ni le profil ni la photo | Étape 10 par `erase_candidate_photos`, avec ligne `erased`. |
| Nouvelle capture après effacement | aucun chemin ne consulte le registre | Le déclencheur ne remet jamais une ligne `erased` en file ; le worker contrôle aussi le registre. |
| Purge `inactive_24m` et `rejected_12m` | `rgpd_purge_candidate_rows` supprime les lignes, pas les fichiers | Le balayage de 4.3 supprime les copies sans ligne le lendemain. En « compte seulement » : `rgpd-purge` compte (`stats.photos_purged`) et ne supprime rien. Le test `tests/c1/lot0c-lectures.test.mjs` compte trois étapes sous `!dryRun` : s'il en gagne une quatrième, il s'ajuste. |
| Suppression d'une mission ou d'une organisation (CASCADE en production) | lignes supprimées, fichiers laissés | Balayage de 4.3 et boîte d'envoi (la cascade d'organisation supprime les lignes `candidate_photos`, le déclencheur inscrit les chemins). |
| Remplacement d'une photo | sans objet | Le déclencheur `BEFORE UPDATE` inscrit l'ancien chemin. |
| Départ d'un membre | les lignes appartiennent à l'organisation | Rien. |
| Fusion des doublons (lot 4) | `conception.md` : copie des lignes supprimées, « effacée par `recordGdprErasure` et purgée » | Cette copie garde `linkedin_profile_data`, donc l'adresse : l'étape 10 doit aussi la nettoyer. Ajouter le déclencheur d'enfilage à la liste des déclencheurs à couper pendant la fusion (précondition 8 de `conception.md`). Le lot 4 fait créer des lignes par `run-agent-search` : il devra écrire les deux adresses de photo (P-7). |
| Export d'organisation | adresse dans le JSON des lignes, pas de fichier | Ajouter les métadonnées de `candidate_photos` (ni adresse ni chemin, ni les lignes `erased`), un compteur dans `_meta` et un indicateur de troncature des 10 000 lignes. Fichiers : décision D6. |
| Autres exemplaires de l'adresse | cache Coresignal ; résultat d'outil de l'assistant (`agent-tools-reads.ts`, ligne 843) | Cache traité par `erase_candidate_photos` ; décider de retirer l'adresse du résultat d'outil (question 12). |

Durée de conservation : la copie suit la ligne de la personne qui vit le plus longtemps dans l'organisation, y compris une ligne retirée de la mission. Une personne écartée dont une autre ligne (une mission où elle est « jamais ouverte », par exemple) vit 24 mois garde donc sa photo jusqu'à la dernière ligne, au-delà des 12 mois annoncés pour les candidats refusés : à confirmer (décision D4). Le worker n'écrit jamais dans `job_candidate_status`, donc ne repousse pas la fenêtre de 24 mois, calculée sur `updated_at`. L'exception actuelle d'Embauché (jamais purgé) vaut aussi pour la photo.

### 4.6 Texte de confidentialité

Dans `src/pages/Privacy.tsx` : ajouter la photo de profil aux données traitées (section 2), une ligne dans le tableau `RETENTION` (durée de la ligne, supprimée avec elle), la mention d'un stockage de fichiers chez Supabase (région à confirmer), la date de mise à jour. Les durées annoncées de 24 et 12 mois ne sont pas appliquées tant que `rgpd-purge` n'est pas planifiée : la page ou la planification change (décision D3). `/privacy-extension` et `extensions/chrome/PRIVACY_POLICY.md` ne changent que si l'extension envoie la photo. Aucun nom de prestataire en dehors de ces pages. Ce texte est en ligne avant la première copie réelle.

### 4.7 Ce qui est écarté, et pourquoi

- Images en base (`bytea`). L'effacement serait transactionnel et la CI le testerait, mais une liste de 50 lignes porterait 300 ko d'images en base64, le /pipeline global 12 Mo, sans cache HTTP, et la base (193 Mo au 24 septembre, saturation du disque en septembre) grossirait de 300 Mo à 50 000 candidats. Si le propriétaire préfère la simplicité d'effacement au volume, c'est le repli à étudier.
- Bucket public avec nom non devinable. Une photo de personne lisible sans compte contredit « copie privée » et la règle C1 (aucune lecture anonyme).
- Proxy par fonction serveur. Une balise `img` n'envoie pas d'en-tête `Authorization`, et un /pipeline de 2 000 visages coûterait 2 000 invocations.
- Transformation d'image de Supabase à la lecture. Disponible en Pro mais facturée (environ 15 dollars par mois à 2 200 candidats, 250 à 50 000), inutile avec une copie déjà à la bonne taille.
- Copie de tous les résultats de recherche. Elle multiplierait les données personnelles stockées sans geste de l'utilisateur. Contrepartie : la notation arrive 13 jours après la création en médiane, et 27 % des adresses sont alors déjà expirées (décision D1 pour la variante « copier dès la découverte et supprimer à 30 jours »).

## 5. Rattrapage des candidats sans photo

Les mesures du 5 octobre fixent les limites :

| Voie | Candidats couverts | Coût LinkedIn | Avis |
|---|---|---|---|
| Copier les adresses déjà stockées | 286 valides, dont 35 personnes du Pipeline ; toutes expirées après le 22 octobre | nul | Abandonnée : elle exigerait que le worker tourne avant le 22 octobre, ce qui suppose P-1, P-2, P-3a, P-4 et les décisions en seize jours, pour 35 personnes. |
| Au fil de l'usage : fiche ouverte, nouvelle notation, nouvelle recherche | toute personne retrouvée | nul | Voie principale. P-0b la répare. |
| Séquences : adresse lue avant chaque envoi | candidats inscrits (17) | nul (lecture déjà faite et journalisée) | P-7. |
| Lecture de profil LinkedIn ciblée | 44 personnes Retenu, Contacté, A répondu ; 275 hors écartés | une `profile_view` par candidat, plafond de 100 par jour et par membre avec paliers de montée en charge | Décision D2. Compte déjà averti, worker d'enrichissement éteint. Si accordé : passer par `enforceLinkedInAction`, jamais par un appel interne de `unipile-search`, heures ouvrées, 10 par jour au plus. |
| Image de participant de messagerie (`get_attendee_picture`) | 17 candidats avec conversation | un appel Unipile par photo, sans passage par le plafond | Reporté. |
| Collecte Coresignal | 22 collectes en production | 2 crédits par fiche | Reporté. |

Aucune reprise par `UPDATE` de masse de `job_candidate_status` : elle bumperait `updated_at` (fenêtre de purge, ordre du /pipeline) et lancerait l'ingestion par ligne. Le rattrapage pousse dans `candidate_photos` par `INSERT … SELECT` lu dans la vue (`NOT is_unopened`), ce qui attrape aussi les personnes inscrites que le déclencheur ne voit pas.

Sans lecture de profil LinkedIn, la majorité des 585 personnes du Pipeline sans adresse reste en initiales tant qu'une recherche, une notation ou une ouverture de fiche n'apporte pas d'adresse fraîche.

## 6. Sous-lots

Ordre : P-0, P-0b, P-1, P-2, P-3a, P-3b, P-4, P-5, P-6, P-7. Le premier visage copié apparaît quand P-4 est activé, donc après P-1, P-2, P-3a et les décisions de la section 8. Jusque-là, P-0b entretient les adresses fraîches, visibles environ trois semaines.

Dans chaque sous-lot : migration, puis fonction, puis front. La migration (`deploy-migrations.yml`) et Vercel partent ensemble au push sur `main` sans ordre : un front qui lit `photo_path` ne se fusionne qu'après le succès du workflow de migrations de P-2, sinon toutes les listes de candidats échouent (colonne inconnue). Taille indicative entre parenthèses.

P-0, mesures, spikes, décisions (petit, aucun code livré).
- S1 : télécharger quelques adresses encore valides depuis une fonction Supabase, sans cookie ni `Referer`, et relever statut, type, taille en octets et en pixels, et la stabilité du chemin (`source_key`). Un échantillon de 20 adresses suffit, rien n'est stocké. Il télécharge de vraies photos de candidats sur le domaine d'images de LinkedIn : il demande l'accord du propriétaire.
  - Fait le 5 octobre 2026, avec l'accord du propriétaire. Le proxy du poste de développement refuse le CDN, donc les requêtes sont parties de la base de production (`pg_net`, sortie réseau de Supabase), tirées et lancées entièrement en SQL : aucune adresse n'a été lue par la session, et seules les lignes de réponse de l'essai ont été supprimées ensuite (3 à 8 octets de texte chacune, plage d'octets limitée à 0-4095).
  - Résultat : 25 adresses valides tirées au hasard (20 petites, 5 grandes, toutes sur `media.licdn.com`), sans cookie ni `Referer`, `Accept: image/*`, agent utilisateur par défaut des fonctions Supabase. 25 réponses sur 25 en 206, aucun refus, aucun délai dépassé, 24 JPEG et 1 PNG, `cache-control: public, max-age=86400`.
  - Poids des petites : 1,4 à 41 ko, médiane 5,3 ko, aucune au-dessus de 40 Kio. Dix portent `shrink_100_100` dans leur chemin (1,4 à 5,5 ko), deux `shrink_400_400` (33 à 38 ko), huit n'annoncent aucune taille (3 à 41 ko). Les grandes pèsent 25 à 131 ko, plus un PNG de 846 ko, ce qui est proche de la limite de 1 Mio de la garde de téléchargement.
  - Chemin (`source_key`) : pour les 71 candidats lus plusieurs fois avec des adresses différentes, le chemin est resté le même pour 64 (90 %) et a changé pour 7, ce qui correspond à une photo changée. Un seul hôte.
  - Limites : la sortie réseau de la base n'est pas celle des fonctions (autre adresse IP possible) ; les pixels réels ne sont pas mesurés (la taille n'est connue que par le chemin, quand il l'annonce) ; ni redirection ni rafale testées. Le premier lot du worker (P-4) sert de contrôle sur le vrai chemin, avec le plan B si une réponse 403 arrive.
  - Conséquence sur le format : la taille d'une petite image ne se déduit pas du chemin. La garde lit donc les octets de tête (JPEG, PNG) pour les côtés, sans bibliothèque, avant de décider entre « telle quelle » et réduction.
- Plan B si S1 échoue (le CDN refuse un centre de données) : la copie côté serveur ne marche pas. Repli : l'image binaire servie par le prestataire de messagerie (`get_attendee_picture`, 17 candidats), ou l'adresse lue par le moteur de séquences. Il faut alors revoir le lot avec le propriétaire.
- S2 : une bibliothèque de réduction d'image qui tient dans les fonctions (256 Mo, 2 s de processeur par requête, sans `sharp`) en moins de 300 ms ; mesurer le temps de processeur de l'appel entier. Sinon le repli de R5.
- S3 : `createSignedUrls` pour 200 chemins sous la policy par dossier (latence, limite de lot).
- S4 : `GET /chat_attendees/{id}/picture` accepte-t-il l'identifiant du candidat. Priorité basse.
- Fin : décisions de la section 8 écrites ici.

P-0b, garder les adresses fraîches (livré le 5 octobre 2026 : une petite migration et le navigateur).
- Une fonction de base, `refresh_candidate_pictures(p_job_ids, p_items)`, remplace l'adresse (petite et grande) dans `linkedin_profile_data` par fusion côté base. Un `UPDATE` du profil entier depuis le navigateur est écarté : il écraserait les champs qu'une autre page y a ajoutés. SECURITY INVOKER, `authenticated` et `service_role`, jamais `anon`. Lignes de l'appelant seulement (`created_by = auth.uid()`, comme la lecture du hook), profil déjà enregistré et de type objet seulement, 200 profils au plus.
- Règle de remplacement (`candidate_picture_should_replace`) : la nouvelle adresse est en https sur `licdn.com`, 2 048 caractères au plus, sans espace, pas échue dans moins d'un jour ; l'adresse enregistrée manque ou échoit dans moins de 3 jours ; la nouvelle échoit après l'ancienne. Une adresse enregistrée encore bonne n'est jamais touchée : aucune écriture, donc ni `updated_at` ni ingestion.
- `batchDiscover` envoie, avant son insertion, les adresses utilisables de la page (`src/lib/pictureUrl.ts`). Son insertion `ignoreDuplicates` ne change pas. La découverte enregistre aussi `profile_picture_url_large`. Un échec du rafraîchissement est journalisé et ne gêne pas la recherche.
- `ProfileDetailSheet.tsx` : le profil visité reprend la photo de la recherche quand il n'en porte pas (même règle que `keepStoredPictures`).
- `EnrollmentPreviewModal.tsx` et `AddToProjectButton.tsx` (prop `profile`, deux appelants) : une ligne créée porte le profil entier sérialisé (`serializeProfileForStorage`, exportée), jamais une photo seule. Une ligne dont `linkedin_profile_data` serait un profil mince deviendrait éligible à la notation de fond (`process-agent-tasks` exige ce champ non nul) et consommerait des crédits sur un profil vide.
- Coût mesuré en local (200 lignes à adresse échue) : 224 ms côté base, 200 appels `pg_net` d'ingestion en file (21 ko en moyenne, 4,2 Mo en tout). L'ingestion ne lit pas la photo : les empreintes de `ingest-context` ne changent pas, donc aucun recalcul d'embedding, seulement les appels. Même ordre de grandeur qu'un lot de notes. Une page de recherche touche au plus ses lignes à adresse échue ; ce nombre baisse à chaque passage.
- Vérification : `supabase/tests/candidate_pictures_audit.sql` (câblé dans `e2e.yml`, quatre mutations de la fonction détectées), `e2e/api/candidate-pictures.spec.ts` (appel par PostgREST, relecture par `mission_candidate_rows`), `tests/ux/photos-candidats.test.mjs` (huit tests de plus, en échec sur le code d'origine). Critère de réussite à relever après la mise en ligne : la part des lignes du Pipeline qui ont une adresse non expirée (3 % avant).
- Reste hors P-0b : l'entrée N12 de la liste blanche de `tests/c1/lot0b-ecrivains.test.mjs` reste vraie (l'insertion ne met jamais à jour une ligne existante) ; son libellé renvoie à la fonction. Les lignes d'un collègue ne sont rafraîchies que par les recherches de ce collègue.
- P-0b ne crée aucune copie : il ne dépend pas de la trace d'effacement.

P-1, modèle de données (moyen, migration seule, invisible).
- Bucket, tables `candidate_photos` et `candidate_photo_removals`, droits, policies, déclencheurs `BEFORE DELETE` et `BEFORE UPDATE`, fonctions pures (`candidate_photo_source_url`, `candidate_photo_source_key`), `claim_candidate_photos`, `sweep_candidate_photos`, contrôle final. Pas de déclencheur d'enfilage ici (il vient en P-3a) : rien ne s'accumule sans chemin d'effacement.
- Pas de reprise de données dans la migration (règle 6 : elle rejoue sur base vide).
- Vérification : `supabase/tests/candidate_photos_audit.sql` (nouveau, câblé dans `e2e.yml`), `rls_and_definer_audit.sql`, `rls_two_orgs_audit.sql`, rejeu sur base neuve, version de migration unique (`date -u +%Y%m%d%H%M%S`, après `20261004120948`), `types.ts` régénéré avec `tsc` sous 11, audit de stockage manuel.

P-2, colonne `photo_path` dans la vue (petit, migration séparée pour pouvoir revenir en arrière).
- Répéter `WITH (security_invoker = true)` (sinon la vue repasse en droits de son propriétaire et contourne la RLS), `NOTIFY pgrst, 'reload schema'`, régénérer `types.ts`.
- `get_mission_stage_counts` lit la vue par `SELECT c.*` dans un CTE matérialisé : `photo_path` y entre. Nommer d'emblée les colonnes du CTE pour que la jointure ne soit pas payée par les compteurs.
- Vérification : contrôles S1, S2 (liste de colonnes à mettre à jour) et S6 de `candidate_stage_readers_audit.sql` (S6 teste `has_table_privilege` sur chaque source : pour `candidate_photos`, qui n'a qu'un droit par colonne, utiliser `has_any_column_privilege`), bloc P1 de `mission_attention_audit.sql`, `EXPLAIN ANALYZE` de `get_mission_stage_counts` et de la lecture entière du /pipeline sur une copie de la production.

P-3a, effacement minimal et déclencheur (moyen à grand).
- Migration : `erase_candidate_photos`, puis le déclencheur d'enfilage `jcs_enqueue_candidate_photo`. `recordGdprErasure` étape 10 (changement de `_shared/get-or-fetch-contact.ts`, donc redéploiement général : regrouper dans cette seule PR).
- Vérification : audit SQL (effacement avec lignes `pending`, `failed`, `stored` ; un effacement n'efface pas l'autre organisation ; la ligne `erased` empêche la mise en file ; suppression d'organisation avec lignes `pending` ; échec avalé du déclencheur), test statique `tests/c1/lotP-photos.test.mjs`. Un test `e2e/api` avec la clé de service existe mais ne tourne pas en CI.

P-3b, purge, export (moyen).
- `rgpd-purge` (comptage des copies en « compte seulement »), `export-org-data` (métadonnées, compteur, troncature), en-têtes des fonctions. Avant le rattrapage P-5.

P-4, worker et planification (grand).
- Ordre : migration de la fonction `invoke_process_candidate_photos` et du cron, fonction `process-candidate-photos` (déployée automatiquement au push, vidange de la boîte et balayage actifs dès le départ), puis activation de `candidate_photos_enabled` sur un petit lot. Mise à jour de `CLAUDE.md` : 71 fonctions, tables, secret, interrupteur.
- Porte d'activation de la copie : P-3a livré ; `/privacy` mis à jour (4.6) ; réponses du juriste aux questions 1, 2, 4 et 5, ou décision écrite du propriétaire d'assumer le risque ; S1 réussi (fait le 5 octobre depuis la sortie réseau de la base, à confirmer depuis une fonction au premier lot).
- Vérification : tests Node de `policy.mjs` (hôte, redirection, taille, type, dimensions, flux plafonné, lecture de `e=`), essai sur quelques lignes (contrôle du statut renvoyé par le CDN à une fonction : un 403 déclenche le plan B), comptage des états, aucun appel Unipile dans les journaux, durée par exécution sous 60 s, une ligne supprimée voit son objet retiré même quand `candidate_photos_enabled` vaut `off`.

P-5, rattrapage (petit).
- `enqueue_candidate_photo_backfill(p_limit)` réservée à `service_role`, `INSERT … SELECT DISTINCT ON (organization_id, candidate_id)` lu dans la vue pour les personnes hors « jamais ouvert » ayant une adresse non expirée, `source = 'backfill'`. La lecture ciblée de profil dépend de la décision D2.
- Vérification : comptage avant et après, copies réussies, `failed` par code, stockage utilisé.

P-6, affichage (moyen, front).
- Section 4.4. Pré-requis : P-2 déployé, P-4 actif. Défaut identique à l'ancien rendu sans `photoPath`.
- Vérification : tests `tests/ux` et `tests/c1` adaptés, `tests/ux/lotP-photos-affichage.test.mjs` (lots, cache, échéance, chaîne de repli), e2e avec la signature simulée (`page.context().route('**/storage/v1/object/sign/candidate-photos**', …)`), `npx vite build`, `tsc` sous 11, cliquet de dette de design (`scripts/design/ratchet.mjs`), captures ordinateur et téléphone, une seule requête de signature par page de 50 lignes.

P-7, captures complémentaires (moyen, basse priorité).
- Une fonction `enqueue_candidate_photo(organization, candidate_id, slug, source, url)` réservée à `service_role`, appelée sous `try` (échec journalisé, jamais bloquant, forme de `recordManualSend`). Elle sert : au moteur de séquences (l'adresse est déjà lue par `readProfileForSend` avant chaque envoi, coût LinkedIn nul), à la messagerie (`enrichChat` lit déjà les détails de participant), à `add-to-shortlist` (appelée par `AddToPipelineModal`, qui doit passer `pictureUrl`), à `apply_mission_candidate_stage`, à `collect` de Coresignal, et au `run-agent-search` du lot 4.
- Jamais de profil mince écrit dans `linkedin_profile_data` pour ces lignes créées par le serveur (notation de fond, voir P-0b).
- Extension Chrome : nouvelle version à publier, sélecteur DOM fragile, aucun usage en production (2 jetons, tous révoqués) ; à faire en dernier, ou jamais.

## 7. Tests et CI

À adapter : `tests/ux/lot12-mission-beta.test.mjs`, `tests/ux/lot12-pipeline.test.mjs` (la regex `src={…pictureUrl}`), `tests/ux/lot12-panneaux.test.mjs`, `tests/ux/liste-missions.test.mjs` (comparaison stricte d'objets), `tests/c1/lot3-liste.test.mjs`, `tests/c1/lot0c4-pipeline.test.mjs`, `tests/c1/lot0c-lectures.test.mjs` (trois étapes sous `!dryRun`), `tests/c1/lot0b-ecrivains.test.mjs` (corps de `recordGdprErasure`, `export-org-data`, entrée N12), `supabase/tests/candidate_stage_readers_audit.sql` (S2 et S6), `e2e/flows/mission-v3.spec.ts` et `stage-0c-lectures.spec.ts`.

À ajouter : `supabase/tests/candidate_photos_audit.sql` (structure et droits par colonne, deux organisations, déclencheur dont l'échec avalé et le cas `erased`, boîte d'envoi, balayage, réclamation et verrou, suppression d'organisation avec lignes `pending` et `failed`, effacement simulé pendant une réclamation), `supabase/tests/candidate_photos_storage_audit.sql` (manuel comme `org_logos_storage_audit.sql`), `tests/c1/lotP-photos.test.mjs` (statique), `tests/ux/photo-fetch-policy.test.mjs`, `tests/ux/lotP-photos-affichage.test.mjs`, `e2e/api/candidate-photos.spec.ts` (local seulement).

Ce que la CI couvre : les audits SQL (`e2e.yml`) et les tests `node --test` (`ci.yml`). Chaque nouveau fichier `node --test` se liste à la main dans `ci.yml`, dans un job qui a `npm ci` (un test empaqueté avec esbuild va dans le job de build). Ce qu'elle ne couvre pas : le téléchargement réel, l'envoi dans le bucket, les liens signés, la suppression de fichiers et les tests `e2e/api` qui appellent des fonctions. Toute la logique testable va donc dans le SQL (audit) et dans les modules purs ; l'essai de bout en bout reste manuel.

## 8. Décisions à prendre

Chaque ligne est une question avec son effet. Les choix purement techniques (format de l'image, interrupteur, droits par colonne) sont dans les sections 3 et 4 et ne demandent pas de décision.

| N° | Question | Réponses et effet | Recommandation |
|---|---|---|---|
| D1 | Quelles personnes copier ? | (a) tout profil noté, trié, retenu, contacté ou inscrit, écartés compris : 1 011 personnes aujourd'hui ; (b) idem sans les écartés : 275 personnes, les écartés (747 lignes sur 1 025, dont l'auteur de l'écart est inconnu pour la plupart, `conception.md` F-I6) n'ont pas de copie ; (c) dès la découverte, avec suppression à 30 jours si la personne reste « jamais ouverte » : copie fraîche pour presque tous, mais jusqu'à 1 326 personnes de plus, jamais regardées, dont le visage est conservé 30 jours. | (b). La notation en masse fait sortir de « jamais ouvert » sans geste humain : le critère protège peu, (b) limite le volume. (c) donne le meilleur taux de succès (27 % d'adresses déjà expirées à la notation) et se discute avec le juriste (question 10). |
| D2 | Autoriser une lecture de profil LinkedIn pour rattraper les photos ? | Non : environ 585 personnes du Pipeline restent en initiales jusqu'à une nouvelle recherche, notation ou ouverture de fiche. Oui : une vue de profil par candidat, plafond de 100 par jour et par membre, sur un compte déjà averti par LinkedIn en mai. | Non en première version. Si oui : 44 candidats Retenu, Contacté, A répondu d'abord, 10 par jour, heures ouvrées, via `enforceLinkedInAction`. |
| D3 | Planifier la purge automatique (`rgpd-purge`) ? | Non : rien n'est supprimé sauf demande d'effacement, et `/privacy` annonce une purge qui n'a pas lieu. Oui : les durées annoncées (24 et 12 mois) s'appliquent, photos comprises. | Oui, après l'avis du juriste ; hors du lot P. Le balayage des copies orphelines du lot P ne dépend pas d'elle. |
| D4 | Combien de temps garder une photo ? | La durée de la ligne de la personne qui vit le plus longtemps dans l'organisation (24 mois sans activité, 12 mois après un écart). Une personne écartée dont une autre ligne vit 24 mois garde sa photo jusqu'à la dernière. Exception actuelle : Embauché n'est jamais purgé. | Cette durée ; l'exception Embauché à confirmer avec le juriste. |
| D5 | Activer la copie avant les réponses du juriste ? | Oui : la copie démarre plus tôt, sous la responsabilité du propriétaire. Non : la copie attend les réponses aux questions 1, 2, 4 et 5. | Non, sauf décision écrite du propriétaire. |
| D6 | Que contient l'export d'organisation pour les photos ? | Métadonnées seules (date, taille, empreinte), ou aussi des liens vers les fichiers. | Métadonnées seules en première version, sous réserve de la question 15. |
| D7 | Messagerie, extension Chrome, Coresignal dans la première version ? | Non : ces sources couvrent peu de monde (17 conversations, 0 usage de l'extension, 22 collectes). | Non (P-7). |
| D8 | Les membres d'équipe d'une autre organisation voient-ils la copie ? | Non : ils voient l'adresse LinkedIn tant qu'elle vit, puis les initiales (3 lignes en production, marketplace gelée). | Non. |
| D9 | Seconde vague de lecteurs (fiche scorecard, calendrier, tâches, accueil) dans le lot ? | Non : lot séparé après P-6. | Non. |
| D10 | Livrer P-0b maintenant, seul ? | Oui, livré le 5 octobre 2026 : il ne crée aucune copie et entretient les adresses fraîches (visibles environ trois semaines) ; il met à jour des lignes existantes, coût d'ingestion mesuré (voir P-0b). | Oui. |
| D11 | Traiter dans ce lot les trous d'effacement sans rapport avec la photo (`candidate_cvs` et ses fichiers, `knowledge_chunks`, notes, caches) ? | Non : lot R ; à signaler au juriste. | Non. |
| D12 | Retirer l'adresse de la photo du résultat d'outil de l'assistant (qui part chez un fournisseur d'IA) ? | Oui : une ligne dans `agent-tools-reads.ts`. Non : elle y reste. | Oui, avec la question 12. |

## 9. Risques

- Le CDN peut refuser une adresse IP de centre de données sans `Referer` ni cookie. S1 (5 octobre) a obtenu 25 réponses sur 25 depuis la sortie réseau de la base de production ; reste à le confirmer depuis une fonction au premier lot de P-4. Sans repli viable en cas de refus, le lot change.
- Les adresses expirent en quelques semaines et 27 % le sont déjà à la notation. Un worker qui tarde ou une file qui s'accumule perd des photos. La file se surveille par comptage d'états.
- Une réduction d'image peut dépasser 2 s de processeur par requête. Repli : la petite image telle quelle, ou refus.
- Le déclencheur s'ajoute à une table déjà chargée en déclencheurs (`stage_sync_from_legacy`, `stage_write_guard`, `updated_at`, ingestion). Son surcoût se mesure sur une base locale de 2 000 lignes avant la mise en ligne.
- La vue `mission_candidate_rows` sert les compteurs, la carte « Maintenant » et trois audits. La jointure s'y ajoute en dernière colonne, les colonnes du CTE de `get_mission_stage_counts` sont nommées, `EXPLAIN ANALYZE` avant fusion.
- Le stockage n'existe pas dans la CI e2e : une régression de policy de stockage ne se verrait qu'à l'audit manuel. La logique d'effacement est testée côté SQL pour cette raison.
- La migration et Vercel partent ensemble : un front qui lit `photo_path` avant la migration casse les listes.
- Un changement de `_shared/` redéploie toutes les fonctions. Regrouper P-3a en une PR.
- Un lien signé reste valable jusqu'à son terme (1 heure) après la suppression de la ligne ; supprimer l'objet le tue avec un décalage de cache pouvant atteindre une minute.
- La garde d'effacement du worker ne couvre que les candidats inscrits en séquence, effacés globalement ou marqués `erased` : un effacement d'organisation d'une personne sans inscription n'a de trace que la ligne `erased` posée par `erase_candidate_photos`. Aucun effacement n'a jamais été enregistré en production, le risque est aujourd'hui théorique.
- Des identifiants variés (82 numériques, 25 autres) peuvent donner deux copies à une même personne. Acceptable.
- Sur une base neuve, `project_id` est `ON DELETE SET NULL` et `organization_id` sans cascade, alors que la production cascade. La CI ne voit donc pas le balayage des orphelins : l'audit le simule.

## 10. Questions pour un juriste

Rôle et base légale
1. Konekt est sous-traitant pour les candidats. Une copie conservée d'une image, au lieu d'un lien vers LinkedIn, change-t-elle ce rôle ? Qui est responsable de traitement pour la copie ?
2. Sur quelle base légale le client conserve-t-il la photo d'un candidat sourcé ? Faut-il l'inscrire au contrat de sous-traitance et au registre des traitements ?
3. Une photo de visage conservée sans identification reste-t-elle une donnée ordinaire ? Quelle clause écrire pour qu'aucune reconnaissance faciale ne soit faite ?
4. Les conditions de LinkedIn, de la licence Recruiter et du prestataire de connexion permettent-elles de télécharger de façon automatisée les images du domaine d'images de LinkedIn et d'en garder une copie ? Même question pour les photos de la base de profils professionnels.

Information et droits
5. Quand les candidats sont-ils informés ? `/privacy` suffit-elle pour l'article 14, ou faut-il une mention dans le premier message ?
6. Droit d'opposition et d'effacement : délai, périmètre (une demande vaut-elle pour toutes les organisations ?), preuve d'identité. Supprimer la copie sans supprimer la ligne suffit-il ?
7. Quelle trace de l'effacement garder pour ne pas recapturer la photo ? La ligne `erased` (identifiant et slug, sans adresse ni image) est-elle admissible, et pour combien de temps ? Un effacement limité à une organisation n'écrit rien dans le registre global : est-ce suffisant ?

Minimisation, durée, exactitude
8. Quelle taille de copie est jugée proportionnée ?
9. La photo suit-elle la ligne (24 mois, 12 mois après un écart), ou doit-elle durer moins longtemps ? Que penser de l'exception Embauché sans limite, et d'une photo qui survit à une autre ligne de la même personne ?
10. Peut-on copier à la découverte, avec suppression à 30 jours pour les personnes jamais ouvertes ? Les photos de personnes sans ligne de pipeline (messagerie, invitations) peuvent-elles être copiées, et combien de temps ?
11. Une copie reste jusqu'à 24 mois alors que la personne peut changer de photo ou fermer son compte LinkedIn : comment répondre à l'exigence d'exactitude ?

Sous-traitants et transferts
12. Le stockage de fichiers de Supabase entre-t-il dans la mention « Supabase (AWS), UE (Irlande) » ? Quelle région pour les fichiers ? L'adresse de la photo apparaît dans le résultat d'outil de l'assistant, donc chez un fournisseur d'IA : faut-il l'en retirer ?
13. La liste des sous-traitants de `/privacy` est incomplète (OpenAI, Sentry, Vercel, Apollo, Perplexity, Firecrawl, Calendly, Aircall) : le lot P doit-il la corriger ?

Accès, portabilité, sauvegardes
14. La copie doit-elle figurer dans la réponse à une demande d'accès (article 15) ?
15. La photo vient de LinkedIn et non du candidat : entre-t-elle dans la portabilité (article 20) ?
16. Les sauvegardes de la base gardent les adresses et les lignes après un effacement : quelle durée est admise ?

Gouvernance
17. L'analyse d'impact et le registre des traitements sont-ils à mettre à jour ? Faut-il consigner la purge « compte seulement » comme une décision documentée tant qu'elle n'est pas planifiée ?

## 11. Ce qui n'a pas été vérifié

- Que l'expiration `e=` rende bien l'image inaccessible (déduit du paramètre, aucun appel au CDN n'a été fait) ; les côtés réels des images en pixels (S1 a mesuré les octets, pas les pixels) ; la stabilité du chemin d'une adresse à plus long terme (90 % de chemins identiques sur 71 candidats, S1). Le chiffre de 20 jours est la validité restante à la création de la ligne, pas la durée de vie d'une signature.
- Que le CDN réponde à l'adresse IP des fonctions Supabase : S1 l'a vérifié pour la sortie réseau de la base, pas pour le runtime des fonctions.
- Une bibliothèque de réduction d'image dans les fonctions (spike S2) ; la limite de taille d'un lot de `createSignedUrls` (spike S3).
- Que `GET /chat_attendees/{id}/picture` accepte l'identifiant du candidat (spike S4).
- Le coût du déclencheur sur la table en charge et de la jointure dans la vue : mesures à faire en P-1 et en P-2 (celui des mises à jour de P-0b est mesuré, voir P-0b).
- Les colonnes de `coresignal_profile_cache` pour retrouver une personne (à lire en P-3a).
- La région des fichiers de Supabase, et ce que le contrat de sous-traitance dit du stockage de fichiers.
- `add-to-shortlist` n'a qu'un appelant, `AddToPipelineModal` (monté par la messagerie) ; reste à savoir si la messagerie lui transmet une photo.
