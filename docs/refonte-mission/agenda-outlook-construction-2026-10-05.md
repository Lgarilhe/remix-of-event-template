# Lot I3, étape 2 : Outlook en lecture. Plan de construction

Proposition du 5 octobre 2026, à valider avant tout code. Elle prolonge le cadrage « Lot agenda » (document partagé avec le fondateur) et le lot I3 de `complement-equipe-marketplace-integrations.md` (tableau des lots, section 5.2).

Objectif : un recruteur relie son agenda Outlook dans Mon compte, Connexions. Ses entretiens avec un candidat connu arrivent seuls dans la zone « Événements à venir » et dans « Entretiens aujourd'hui ». Un entretien déplacé ou annulé dans Outlook se met à jour sans geste.

## 1. Périmètre

Dans cette étape :
- relier un agenda Outlook (un par personne), le dissocier, voir son état ;
- lire les événements de l'agenda, les rapprocher d'un candidat, écrire une séance de qualification ;
- suivre les changements (déplacement, annulation, suppression) ;
- effacement RGPD, export et purge des séances.

Hors de cette étape : Google (même code, branché plus tard), écriture dans l'agenda (« Planifier dans votre agenda », créneaux libres), changement d'étape du candidat ou arrêt de ses séquences, retrait de Calendly (étape 5 du découpage).

## 2. Choix proposés

| Sujet | Choix proposé | Raison |
|---|---|---|
| Lien événement et séance | Deux colonnes sur `qualification_sessions` (`calendar_account_id`, `external_event_id`) avec un index unique | Une seule table concernée. La table générique `external_refs` du plan sert aussi l'ATS : on la crée quand ce lot arrive |
| Origine d'une séance | Colonne `source` : `manual`, `agenda`, `invitation`, `booking` (valeurs du plan, ligne `qualification_sessions`) | Distinguer ce que Konekt a lu de ce qu'on a saisi. Les séances Calendly existantes passent à `booking` |
| Agendas lus | Les agendas dont la personne est propriétaire (`is_owned_by_user`), pas les agendas partagés | Un agenda partagé ferait remonter les événements d'un collègue en double |
| Fenêtre lue | De J-7 à J+30 | J-7 est déjà la fenêtre de « Comptes rendus à faire ». J+30 est une proposition |
| Source de vérité | Une relecture périodique de la fenêtre, toutes les 10 minutes. La notification d'Unipile sert à relancer la relecture du compte concerné | La forme exacte des notifications `calendar.event.*` n'a pas été vue. Le plan n'en dépend pas |
| Titre de l'événement | Jamais gardé : `event_name` reste vide pour une séance venue de l'agenda | Règle du plan : le titre n'est gardé que si Konekt a écrit l'événement. L'écran affiche déjà `candidate_name` en premier |
| Effets sur le candidat | Aucun : ni étape « entretien », ni arrêt de séquence | `calendly-webhook` le faisait parce que la réservation venait d'un lien envoyé par Konekt. Un événement d'agenda peut être n'importe quelle réunion. À rouvrir après usage |
| Dissocier | Supprime le compte côté service de connexion et la ligne, garde les séances déjà créées | L'historique des entretiens reste lisible |

## 3. Vue d'ensemble

1. La personne clique « Relier mon agenda Outlook » (carte « Agenda » dans Connexions).
2. `calendar-accounts` (action `link`) demande à Unipile v2 un lien de connexion limité à l'agenda, avec un `state` signé, et enregistre au passage, si besoin, l'endpoint de notification (section 5.3).
3. La personne autorise sur l'écran Microsoft, puis revient sur Konekt avec `account_id`, `provider` et `state` dans l'adresse.
4. La carte appelle `calendar-accounts` (action `complete`) : le `state` est vérifié, le compte est relu chez Unipile, la ligne `member_calendar_accounts` est écrite.
5. `calendar-sync` relit les événements du compte (à la liaison, à chaque notification, toutes les 10 minutes), les rapproche des candidats et écrit ou met à jour les séances.
6. `useUpcomingInterviews` et `useTodoInterviews` lisent déjà `qualification_sessions` : rien à changer côté barre latérale.

## 4. Données

Une migration, nommée avec `date -u +%Y%m%d%H%M%S` et vérifiée contre `origin/main` (règle 3 de CLAUDE.md). Elle doit rejouer sur une base vide (règle 6) : la production vient de `MIGRATION_CLEAN.sql`, où `qualification_sessions` n'a que les policies `org_members_all` et `service_role_all`.

Esquisse (à affiner à l'écriture) :

```sql
CREATE TABLE IF NOT EXISTS public.member_calendar_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('outlook', 'google')),
  account_id text NOT NULL,                 -- acc_... côté service de connexion v2
  email_address text,
  status text NOT NULL DEFAULT 'running',   -- reflet de l'état du compte
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, account_id),
  UNIQUE (organization_id, user_id, provider)
);

ALTER TABLE public.qualification_sessions
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS calendar_account_id uuid REFERENCES public.member_calendar_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_event_id text;
-- source IN ('manual','agenda','invitation','booking') ; calendly_event_id non nul => 'booking'
CREATE UNIQUE INDEX ... ON public.qualification_sessions (calendar_account_id, external_event_id)
  WHERE calendar_account_id IS NOT NULL AND external_event_id IS NOT NULL;
CREATE INDEX ... ON public.qualification_sessions (organization_id, event_start_at);
```

Écrite dans la demande A (`20261006164408_agenda_outlook_base.sql`) avec deux écarts de l'esquisse : pas de colonne `write_enabled` (l'agenda n'est que lu, la colonne viendra avec l'écriture) et des bornes de longueur sur `account_id`, `email_address`, `status` et `last_error`. La tâche planifiée n'y est pas : elle vient avec la demande B.

Accès de `member_calendar_accounts`, sur le patron de la migration des photos (`20261005121536_photos_candidats_copie_privee.sql`) : RLS active, `REVOKE ALL` à `PUBLIC`, `anon` et `authenticated`, puis `GRANT SELECT` à `authenticated` et `ALL` à `service_role`. Une policy de lecture : la personne lit sa ligne, un propriétaire ou administrateur lit celles de l'organisation (`get_org_role`, comme `member_linkedin_accounts`). Le navigateur n'écrit jamais : tout passe par les fonctions. Déclencheur `update_updated_at_column` comme les autres tables.

Audit `supabase/tests/calendar_accounts_audit.sql`, inscrit dans `.github/workflows/e2e.yml` : une personne lit sa ligne et pas celle d'un collègue (hors administrateur), une autre organisation ne lit rien, `anon` ne lit ni n'écrit, `authenticated` ne peut ni insérer ni modifier. `rls_and_definer_audit.sql` doit rester vert.

## 5. Fonctions serveur

Conventions de CLAUDE.md : `requireAuth` et `verifyOrgMembership`, `fetchWithTimeout` (15 s), filtre d'organisation sur toute écriture, identifiants jamais dans des variables globales modifiables. `resolveUnipileV2Credentials` et `unipileV2Fetch` existent déjà dans `_shared/unipile-v2.ts` : on les réutilise, sans les modifier.

### 5.1 Module partagé `_shared/calendar-events.ts` (sans accès réseau ni base)

Fonctions pures, testées sans Deno :
- `eventToSessionPatch(event, ctx)` : transforme un événement Unipile en champs de séance (tableau ci-dessous) ;
- `pickCandidateEmails(event, ctx)` : adresses des participants à tester (section 6) ;
- `nextStatus(current, event)` : statut après lecture, jamais de recul de `completed`, changement seulement depuis `scheduled` ou `in_progress` (même garde que `calendly-webhook`).

| Champ de la séance | Valeur |
|---|---|
| `organization_id` | organisation du compte relié |
| `created_by`, `manager_id` | propriétaire du compte (c'est le filtre « moi » des deux hooks de la barre latérale) |
| `source`, `calendar_account_id`, `external_event_id` | `agenda`, ligne du compte, `id` de l'événement |
| `event_start_at`, `event_end_at` | `start.date_time` et `end.date_time` en UTC |
| `event_location` | `conference.url`, sinon `location` (l'écran n'affiche « Rejoindre » que pour http ou https) |
| `event_name` | vide |
| `candidate_name`, `candidate_profile_id`, `candidate_linkedin_url`, `candidate_headline` | lus sur la ligne `job_candidate_status` du candidat rapproché |
| `invitee_email` | l'adresse du participant rapproché (sert à l'effacement RGPD) |
| `project_id`, `job_id`, `job_title`, `client_name` | mission trouvée par `resolveMeetingMission`, vides si aucune ou plusieurs |
| `status` | `scheduled`, ou `cancelled` si l'événement est annulé, supprimé, refusé par le propriétaire, ou n'a plus le candidat parmi ses participants |

Ignorés : événements « toute la journée », événements récurrents (en première version), événements sans participant extérieur.

### 5.2 `calendar-sync` (clé de service, aucune session utilisateur)

Trois portes d'entrée, trois authentifications :
- notification d'Unipile : jeton `?v2_token=` comparé par `timingSafeEqual` avec `resolveV2WebhookToken()`, comme `unipile-webhook` ;
- tâche planifiée toutes les 10 minutes : en-tête `PROCESS_SEQUENCES_SECRET`, comme `capture-candidate-photos`, créée par `cron.schedule` dans la migration (patron de la migration des photos) ;
- liaison d'un compte : appel interne depuis `calendar-accounts` avec la clé de service.

Pour chaque compte concerné : liste des agendas, filtre sur ceux dont la personne est propriétaire, liste des événements de la fenêtre (pagination par `next_cursor`), puis pour chaque événement le rapprochement et l'écriture. Une notification pour un compte inconnu répond 200 sans rien faire. L'écriture est un upsert sur l'index unique `(calendar_account_id, external_event_id)`, filtré par l'organisation du compte, et ne touche jamais `notes`, `verdict` ni `scoring_summary`. Une erreur sur un événement n'arrête pas les autres. L'état du compte (`status`, `last_synced_at`, `last_error`) est mis à jour à chaque passage.

### 5.3 `calendar-accounts` (session utilisateur)

Actions :
- `status` : `{ configured, accounts }`. `configured` vaut `isUnipileV2Configured()`. La carte se cache si la clé v2 manque (aucun drapeau lisible par le navigateur n'existe aujourd'hui) ;
- `link` : crée le lien via `POST /v2/auth/link` avec `providers: 'outlook'`, `redirect_uri` vers `/settings/account/connections`, un `state` `user:…|org:…|exp:…|sig:…` signé en HMAC avec `UNIPILE_WEBHOOK_SECRET`, et `config.outlook.oauth_scope` limité à l'agenda en lecture. Pour une reconnexion, le corps porte `account_id`. Enregistre au passage l'endpoint de notification (3 événements `calendar.event.new`, `calendar.event.update`, `calendar.event.delete`, URL `calendar-sync?v2_token=…`), seulement s'il n'existe pas déjà. Un échec ici n'empêche pas la liaison : la relecture périodique suffit ;
- `complete` : reçoit `account_id`, `provider` et `state`. Vérifie la signature et l'expiration du `state`, que son utilisateur et son organisation sont ceux du jeton, relit `GET /v2/accounts/{id}` (compte existant, fournisseur Outlook, état), puis écrit la ligne. Refus si ce compte est déjà relié à une autre personne ;
- `unlink` : `DELETE /v2/accounts/{id}`, puis suppression de la ligne.

Il n'y a aucune étape manuelle côté plateforme : la leçon de Calendly (abonnement jamais créé, personne ne pouvait le faire) est de ne rien exiger qu'aucun écran ne permette.

## 6. Rapprochement événement et candidat

Règle du plan : jamais sur un nom, seulement sur un identifiant exact normalisé. Ici, l'adresse e-mail.

1. Adresses à tester : celles des participants, en minuscules, sans le propriétaire de l'agenda, sans les ressources (salles), sans les adresses des membres de l'organisation. `get_org_member_emails` ne convient pas : elle contrôle `auth.uid()` et son droit d'exécution est retiré à `service_role`. La synchronisation lit les membres dans `organization_members`, puis leurs adresses par `auth.admin.getUserById` (une fois par passage et par organisation).
2. Recherche dans l'organisation : `candidate_contacts.email`, `candidate_enrichments.contact_email`. `job_candidate_status` n'a pas de colonne e-mail (seulement `linkedin_profile_data`).
3. Un seul candidat trouvé : rapproché. Aucun : l'événement est ignoré. Plusieurs candidats différents : ignoré et journalisé.
4. Mission : `candidateRef` puis `resolveMeetingMission` (déjà utilisés par `calendly-webhook`, lecture seule). Introuvable ou ambiguë : la séance est écrite sans mission, comme le fait Calendly aujourd'hui.

Limite connue : un candidat dont Konekt ne connaît pas l'adresse n'est jamais rapproché. À mesurer avant le code (section 9, point 4).

## 7. Écrans

- `ConnectionsSection` (`src/components/settings/shell/sections.tsx`) : une carte `MyCalendarAccount`, ancre `calendar`, après `MyEmailAccount`.
- États de la carte : cachée si `configured` est faux ; « Relier mon agenda Outlook » ; relié (adresse, état, dernière lecture, « Reconnecter » si déconnecté, « Dissocier » avec confirmation `AlertDialog`).
- Retour de la connexion : même onglet (pas `window.open` comme la boîte e-mail, qui attend ensuite 5 minutes de sondage). `settingsRoutes.ts` lit déjà `notion_oauth` et `notion_error` : on ajoute `account_id` et `state` sur le même patron, la carte appelle `complete`, puis nettoie l'adresse.
- Hook `useMemberCalendarAccounts` : lecture seule par la RLS, clé React Query `['member-calendar-accounts', orgId]`. Les écritures passent par `calendar-accounts`.
- Textes en français. Le nom du prestataire de connexion n'apparaît jamais à l'écran (règle de marque de CLAUDE.md) ; « Outlook » est permis.

## 8. RGPD et sécurité

- Écart existant, constaté en lisant le code : `qualification_sessions` n'est ni dans `recordGdprErasure` (`_shared/get-or-fetch-contact.ts`), ni dans `rgpd-purge`, ni dans `export-org-data`. Les séances créées par Calendly ont déjà ce défaut. Cette étape l'ajoute pour les deux sources : nouvelle étape numérotée dans `recordGdprErasure` (séances du candidat par organisation, identifiant, adresse du profil et `invitee_email`), ligne dans `rgpd-purge` (en « compte seulement » par défaut, comme le reste), table ajoutée à `export-org-data`, et mise à jour de la ligne RGPD de CLAUDE.md. Défaut proposé : supprimer les séances du candidat plutôt que les anonymiser, car elles portent son nom et son adresse.
- `member_calendar_accounts` contient l'adresse du recruteur : ajoutée à l'export, supprimée avec l'organisation (cascade).
- Le compte relié ne peut pas être celui d'une autre personne : unicité `(organization_id, account_id)` et vérification du `state` signé.
- Autorisation demandée à Microsoft : agenda en lecture seulement. Le test du 5 octobre a montré qu'une connexion normale donne aussi la messagerie et les contacts : c'est ce qu'on évite ici.
- La page `/privacy` doit décrire ce qui est lu (événements avec un candidat connu) et ce qui est gardé (début, fin, lien de visio, statut, candidat).

## 9. Ce qui reste à vérifier

Bloquant pour écrire le code :
1. `UNIPILE_V2_API_KEY` est-il dans les secrets de production ? Sans lui, la fonction `calendar-accounts` répond `configured: false` et la carte reste cachée.
2. Noms exacts des autorisations pour un agenda en lecture seule. Le test du 5 octobre a donné `Calendars.Read`, `Calendars.Read.Shared`, `Calendars.ReadWrite`, `Calendars.ReadWrite.Shared`. À vérifier sur un vrai écran de consentement avec `oauth_scope`.
3. `redirect_uri` : l'application Unipile v2 accepte-t-elle l'adresse de Konekt ?
4. Combien de candidats ont une adresse connue (`candidate_contacts`, `candidate_enrichments`) ? Cela fixe le taux de rapprochement. Requête de comptage à faire jouer par le fondateur ou avec son accord.

Non bloquant :
5. Forme des notifications `calendar.event.*` : le plan n'en dépend pas, on ajoutera l'identifiant de compte si la notification le porte.
6. Prix par agenda relié (le plan attend ce prix avant de lancer le lot).
7. Version bêta de la v2 : changements possibles. L'agenda est écrit directement sur la v2 (`unipile-v2.ts`), sans migrer le reste de l'application.
8. Après la reconnexion du 5 octobre, l'identifiant du compte Outlook de test est `acc_01m46d…`, différent de celui du plan de migration : à reporter au moment de la bascule v1 vers v2.

## 10. Tests

- Module pur : `tests/ux/calendar-events.test.mjs` (esbuild, patron de `calendly-annulation.test.mjs`). Cas : événement annulé, déplacé, refusé, sans participant extérieur, deux candidats pour une adresse, mission ambiguë, jamais de recul de `completed`. Ajouté au job `build` de `ci.yml` (le job `agent-safety` n'installe pas les dépendances).
- Fonction `calendar-sync` : même technique, avec une base en mémoire qui journalise les écritures. Vérifie le filtre d'organisation sur chaque écriture, l'idempotence (deux lectures du même événement ne créent qu'une séance) et l'ignorance d'un compte inconnu.
- Garde statique `tests/c1/calendar-fonctions.test.mjs` (sans dépendance, ajouté à `agent-safety`) : filtres d'organisation, aucun nom de prestataire dans les textes de la carte, étape RGPD présente, aucune écriture navigateur sur `member_calendar_accounts`.
- Audit SQL de la section 4, dans `e2e.yml`.
- Banc local (PR D, optionnelle) : `vendor-mock.mjs` n'a aucune route v2, et il ne lit l'identifiant de compte que dans la requête ou le corps, pas dans le chemin `/v2/{account_id}/…`. Il faut des routes `/v2/{id}/calendars` et `/v2/{id}/calendars/{cal}/events`, la lecture de l'identifiant dans le chemin, et `UNIPILE_V2_API_KEY` dans `up.sh`. Le spec `e2e/api/calendar-sync.spec.ts` appelle la fonction avec la clé de service. Les specs qui utilisent le moteur sont ignorés par la CI actuelle (`engineAvailable`) et n'ont pas pu tourner dans la session de rédaction (limite de téléchargement de Docker Hub).
- Essai réel, avec l'agenda Outlook du fondateur : voir les critères de la section 12.

## 11. Découpage en demandes de fusion

Chacune est déployable seule ; rien n'est visible avant la C.

| PR | Contenu | Visible ? |
|---|---|---|
| A. Base de données et RGPD | Migration (table, colonnes, index, RLS), étape RGPD, export, purge, audit SQL, lignes de CLAUDE.md | Non |
| B. Synchronisation | `_shared/calendar-events.ts`, `calendar-sync`, tâche planifiée, tests (module pur, fonction, garde statique), étapes de `ci.yml` | Non, aucun compte relié |
| C. Connexion et carte | `calendar-accounts`, `useMemberCalendarAccounts`, carte, retour de connexion dans `settingsRoutes.ts`, textes, CLAUDE.md | Oui, si la clé v2 est posée |
| D. Banc local | Routes v2 du faux prestataire, `up.sh`, spec e2e | Non |

Ordre : A, B, C. D peut venir à tout moment après B. Contrôles avant chaque fusion : `tsc` à la baseline, ESLint sans nouveau problème (le contrôle compare le nombre à `main`), `npm run test:c1` et les tests `ux` touchés, `vite build`.

## 12. Fait quand

Avec l'agenda Outlook du fondateur et un candidat de test dont l'adresse est connue :
1. « Relier mon agenda Outlook » aboutit : la carte affiche l'adresse et l'état « connecté ».
2. Un événement créé dans Outlook avec cette adresse apparaît dans « Événements à venir » en moins de 10 minutes, avec le lien « Rejoindre » s'il y a une visio.
3. Déplacé dans Outlook, il change d'heure dans Konekt. Annulé ou supprimé, il disparaît.
4. Un événement sans candidat connu n'écrit aucune ligne dans `qualification_sessions`.
5. « Dissocier » arrête la lecture et supprime le compte côté service de connexion.
6. L'effacement RGPD du candidat supprime ses séances, celles de l'agenda comme celles de Calendly.

## 13. Questions pour le fondateur

1. Table générique `external_refs` maintenant, ou les deux colonnes proposées ? Défaut : les deux colonnes.
2. Un événement d'agenda avec un candidat doit-il aussi passer le candidat à l'étape « entretien » et arrêter ses séquences, comme le faisait Calendly ? Défaut : non dans cette étape.
3. Agendas lus : propriétaire seulement, ou aussi les agendas partagés ? Défaut : propriétaire seulement.
4. Fenêtre J-7 à J+30 et relecture toutes les 10 minutes : à confirmer.
5. RGPD : supprimer ou anonymiser les séances d'un candidat effacé ? Défaut : supprimer.
