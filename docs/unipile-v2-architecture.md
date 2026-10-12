# Connexion LinkedIn, WhatsApp et e-mail par l'API v2 : architecture

Public : développeurs. Pour le déroulement de la mise en production, voir `docs/unipile-v2-bascule.md`. Le prestataire est Unipile ; son nom ne s'écrit jamais dans un texte lu par un utilisateur (règle « Branding » de `CLAUDE.md`).
Version décrite : branche `ccr-6c73a178-thbl61`, état du 12 octobre 2026. Référence de l'ancien code : commit `61049f0`.

Tout ce qui suit a été relu dans les fichiers. Rien n'a été confronté à un vrai serveur v2 (aucune clé disponible). Les points à confirmer avec une clé sont réunis en partie 10.

## 1. Vue d'ensemble

- API v2 seule : `https://api.unipile.com/v2`, constante `UNIPILE_BASE_URL` de `_shared/unipile/config.ts`, aucune surcharge. Une seule clé pour toute l'application (`UNIPILE_V2_API_KEY`). Plus de clé ni de DSN par organisation.
- Le client partagé `supabase/functions/_shared/unipile/` est l'unique chemin vers le prestataire. Les fonctions lui passent un identifiant de compte `acc_...` et reçoivent des formes Konekt (les anciennes formes du site restent valides, le site change peu).
- L'isolation entre organisations ne repose plus sur des clés distinctes : elle repose sur `assertAccountOwnedByOrg` (partie 4) et sur les lectures de liaisons.
- La conversion des identifiants stockés (ancien format vers `acc_...`) est faite par une fonction réservée aux administrateurs de la plateforme (partie 7).

Écarts avec le plan de départ (relevés dans le code) : pas de fenêtre à deux identifiants ; pas de variable `UNIPILE_V2_BASE_URL` ; 17 événements de notification souscrits (sur 40 connus) ; la lecture d'agenda n'a qu'un module client (`calendar.ts`), aucune fonction ne l'utilise ; les colonnes `organization_integrations.unipile_*` ne sont pas supprimées ; pas de limiteur global de débit dans le transport (seulement le repli sur 429).

## 2. Le client partagé

Un seul point d'entrée : `import { ... } from '../_shared/unipile/index.ts'`. `testing.ts` et `setTransportDefaults` (de `http.ts`) n'y sont pas exportés, volontairement (garde `UCLI-5b`, `UCLI-6`).

| Module | Contrat |
|---|---|
| `config.ts` | `getUnipileConfig()` lit `UNIPILE_V2_API_KEY` à chaque appel, sans cache. Clé absente : `UnipileConfigError` (genre `config`), jamais un repli. `isUnipileConfigured()` ne lève pas. `hostedDomain()` lit `UNIPILE_HOSTED_DOMAIN` (nom d'hôte seul, schéma et barre finale tolérés, valeur invalide : erreur). |
| `http.ts` | Seul module qui appelle `fetch` vers le prestataire (`unipileFetch`, `unipileJson`, `unipileVoid`, `unipileDeleteJson`). En-tête `X-API-KEY`, délai de 15 s (30 s si `heavy`). Au plus 2 reprises, budget de 10 s, `Retry-After` suivi jusqu'à 5 s, seulement pour les requêtes idempotentes (GET, PUT, PATCH, DELETE, POST marqué `idempotent`) sur erreur réseau, délai, 429, 502, 503, 504. Une requête non idempotente (message, demande de relation, e-mail, ouverture de conversation) n'est jamais reprise : délai, erreur réseau, 408, 5xx ou 2xx illisible donnent `outcome: 'uncertain'`. Un 429 ou un autre 4xx est un refus (`error`). |
| `errors.ts` | `UnipileError` (genre fermé, message français neutre, données de diagnostic non énumérables). `classifyError`, `userSafeMessage`, `describeForLog`, `errorKindOf`, `isUnipileError`. Voir partie 3. |
| `pagination.ts` | `collect` / `parsePage` : trois modes (curseur, décalage et total, `has_more`). Plafonds durs : 50 pages et 5 000 éléments. |
| `ids.ts` | `isV2AccountId` (`^acc_[A-Za-z0-9_-]+$`), `assertV2AccountId` (lève `OutdatedAccountIdError`, genre `account_disconnected`), `buildAccountMap` (index `metadata.v1_account_id` et adresse e-mail, liste ambiguë), `accountPath`, `normalizeMessageId(s)` (nul, chaîne ou tableau), `userRef` (nom court, identifiant du prestataire ou adresse), `chatRef`, `chatPath`. |
| `status.ts` | `mapAccountStatus` : running vers `OK`, disconnected vers `CREDENTIALS`, errored vers `ERROR`, degraded vers `DEGRADED`, partial vers `PARTIAL`, verrouillé vers `LOCKED` (sauf `CREDENTIALS`). Inconnu : `ERROR`, jamais `OK`. `isSendable` vrai seulement pour `OK`. `isReconnectable` : `CREDENTIALS`, `PARTIAL`, `ERROR`. `mapAccountRemoved` : `account.remove` n'est pas une déconnexion récupérable (délier et arrêter les envois). |
| `guard.ts` | `assertAccountOwnedByOrg`, `findAccountOwnership`, `AccountNotOwnedError` (genre `forbidden`). Voir partie 4. |
| `accounts.ts` | Liste, lecture, mise à jour, suppression de compte ; `createHostedLink` (envoie toujours le domaine configuré), `createAuthIntent`, `submitCheckpoint`, `requestCheckpoint`, `resendCheckpoint`, `parseAuthStep`. |
| `webhooks.ts` | `KNOWN_TRIGGER_EVENTS` (40), `V2_TRIGGER_EVENTS` (17 souscrits), `EVENT_ALIASES`, `flattenEnvelope`, `resolveWebhookToken`, `verifyWebhookRequest`, gestion des points de réception (`listAllEndpoints`, `createEndpoint`, `patchEndpoint`, `deleteEndpoint`, `planEndpointSync`), `listDeliveries`, `replayEvent`. Voir partie 6. |
| `messaging.ts` | Conversations, messages, ouverture de conversation. `startChat` / `sendMessage` rendent un `SendOutcome` : `sent` (identifiants normalisés), `uncertain`, ou `refused` (avec le genre d'erreur). InMail par licence choisie par l'appelant. Le compte est toujours passé explicitement : une conversation v2 ne porte pas de compte. |
| `users.ts` | `getProfile` (sections à la demande), `visitProfile` (la visite est un appel explicite, avec le jeton rendu par `notifyVisitToken` ; lire un profil ne compte pas comme visite), relations, demandes de relation (envoi, liste des envoyées, retrait), publications, société. |
| `linkedin.ts` | Recherche par licence (Classic, Recruiter, Sales Navigator, chacune avec son corps), paramètres de recherche, `resolveSearchUrl` (analyse pure d'une adresse collée), crédits InMail (clé `classic`, pas `premium`), contrats et choix du contrat, projets Recruiter. |
| `email.ts`, `calendar.ts` | Envoi et lecture d'e-mails (fils par `thread_id`, `inReplyToOf`), lecture d'agenda (non utilisée). |
| `normalize/*` | `toKonektProfile`, `toKonektSearchResults`, filtres Konekt vers les trois corps de licence, `toKonektChat/Message/Email`, `toKonektAccount`, `toKonektInmailCredits`. Les champs manquants deviennent `null`, jamais une exception. L'emplacement du titre du profil est lu à plusieurs chemins (`HEADLINE_PATHS`). |
| `testing.ts` | `withMockTransport`, fixtures. Importé par les `*.test.ts` seulement. |

Le client n'écrit jamais en base. La persistance reste chez l'appelant.

## 3. Genres d'erreur et ce qui atteint l'utilisateur

Genres (`ErrorKind`) : `auth`, `forbidden`, `not_found`, `rate_limited`, `validation`, `account_disconnected`, `account_degraded`, `provider_limit`, `uncertain`, `server`, `network`, `config`.

- La spécification ne définit aucun corps d'erreur. `classifyError` regarde le statut HTTP, puis des indices tolérants dans le corps (`error`, `message`, `code`, `type`, `detail`). Une forme inconnue donne `server`.
- `UnipileError.message` est toujours le texte français neutre de `userSafeMessage(kind)`. Le corps du prestataire, le chemin et l'identifiant de requête sont dans `error.debug` (non énumérable, absent du JSON et des copies par étalement), destinés à `console.error` via `describeForLog`.
- `error.name` vaut `ProviderError` (ou `ConfigError`, `AccountNotOwnedError`...) : `String(error)` ne nomme pas le prestataire.
- Les fonctions renvoient au navigateur `{ error: userSafeMessage(kind), error_code: kind }` ou un code Konekt (`feature_disabled`, `attempt_expired`, `already_linked_org`, `wrong_account`, `config`...). Le texte du prestataire n'est jamais rendu.
- Le moteur de séquences classe les échecs par `errorKindOf`, pas par le texte : `provider_limit` met le compte en pause pour la journée, `account_degraded` reporte de 6 h sans pause, `uncertain` n'est jamais compté comme envoyé et n'incrémente ni `retry_count` ni l'auto-pause.
- Garde : `UCLI-4` (aucun texte d'erreur ne nomme un prestataire), `tests/ux/connexion-copie.test.mjs`, `S4B-5`, `S6B-4`.

## 4. Flux de l'identifiant de compte et garde

Un compte relié est une ligne de `member_linkedin_accounts` (`linkedin_account_id`), `member_email_accounts` (`email_account_id`) ou `member_whatsapp_accounts` (`whatsapp_account_id`), chacune avec son `organization_id` et le membre titulaire.

1. La clé étant globale, une erreur d'identifiant agirait sur la session d'un autre locataire. Chaque fonction qui appelle le client avec un identifiant venu d'une requête le prouve d'abord relié à l'organisation de l'appelant : `assertAccountOwnedByOrg(admin, orgId, accountId, { kinds?, userId? })`. Un envoi à la demande d'un membre passe `userId` : le compte d'un collègue n'est jamais utilisé. Échec fermé : entrée vide ou erreur de lecture = refus.
2. Appelants : `unipile-search`, `unipile-accounts` (`ownership.ts`), `send-candidate-email`, `candidate-actions` (`transport.ts`), `run-agent-search`, `score-profile-job`, `auto-analyze-message`, `auto-categorize-chats`, `generate-outreach-message`, `_shared/agent-tools-mutations.ts`, `_shared/agent-tools-email.ts`, `_shared/profile-enrichment.ts`.
3. À la frontière du client, tout identifiant passe `assertV2AccountId`. Un ancien identifiant n'atteint jamais le prestataire. Dans `process-sequences`, il met l'inscription en pause (`account_disconnected`) avec un message de journal neutre ; la pause se lève à la reconnexion.
4. Le récepteur de notifications ignore (200) un événement dont l'identifiant de compte n'est pas `acc_...` (`ignored: invalid_account_id`).
5. Règles propres à `unipile-search` (`account-rules.ts`) : `send_message` et `withdraw_invitation` sont réservées au titulaire du compte ; les lectures (conversations, messages, invitations envoyées) restent ouvertes à toute l'organisation (décision à confirmer, partie 5 du guide).
6. `claim_linkedin_account` n'accepte plus un compte relié à personne, sauf pour un administrateur de la plateforme (`KONEKT_PLATFORM_ADMIN_USER_IDS`).

## 5. Connexion d'un compte

Actions de `unipile-accounts` (`connection.ts`, `connection-steps.ts`) : `connection_capabilities`, `connection_start`, `connection_checkpoint`, `connection_resend`, `connection_status`, `connection_cancel`, plus les anciens noms `hosted_auth_link`, `connect_cookie`, `connect_credentials`, `solve_checkpoint` qui passent par le même code.

- Table `connection_attempts` (migration `20261011204248`, colonne de retour `20261012005001`) : une ligne par tentative (organisation, membre, canal, mode `hosted|native`, statut, `intent_id`, compte obtenu, genre d'erreur, expiration à 30 minutes). Son `id` est le `state` envoyé au prestataire : seule piste qui relie un événement à un membre et à une organisation. Une seule tentative `pending` par membre et par canal (index unique partiel) : un nouveau départ annule la précédente. Écrite par la clé de service seulement ; purge horaire par la tâche `purge-connection-attempts` (tentatives échues en `expired`, puis suppression après 24 h).
- Le navigateur ne fournit jamais l'utilisateur, l'organisation ni l'adresse de retour. L'adresse de retour est `APP_URL` + `/settings/account/connections/retour`.
- Mode hébergé (par défaut, et repli) : `createHostedLink` avec `domain` = `UNIPILE_HOSTED_DOMAIN`. Sans domaine, la fonction répond `config` (la page afficherait le prestataire), sauf `CONNECTION_ALLOW_VENDOR_HOSTED_LINK=1` (tests locaux). Le lien rendu doit avoir exactement ce domaine (`isExpectedHostedLink`), sinon refus. `connection_capabilities` rend `hosted.available` selon la clé et le domaine.
- Mode direct : derrière `CONNECTION_NATIVE_ENABLED === '1'` (serveur) **et** l'interrupteur local `konekt.connection-native` (`?connection-native=1|0`, `src/lib/connectionBeta.ts`). Éteint : `feature_disabled`. LinkedIn (identifiant, cookie), WhatsApp (QR, code d'association), IMAP, points de contrôle (`parseAuthStep`). Les identifiants servent à un seul appel et ne sont ni journalisés, ni stockés, ni rendus. Frein par membre (`check_rate_limit`), fermé en cas de lecture impossible.
- Fin de connexion : `claimForAttempt` (`_shared/connection-claim.ts`), un seul code pour le récepteur (`account.add` / `account.reconnect` porte `state`) et pour le direct. Le premier qui passe marque la tentative `completed` (écriture conditionnelle sur `pending`) ; le second voit `replayed` et ne touche rien. Résultats : `claimed`, `replayed`, `refused`, `failed` (avec avis au membre), `error` (5xx, le prestataire rejoue). Changer de compte arrête les envois de l'ancien (`stopLinkedInAccountSending`).
- États de compte stockés : `OK`, `CREDENTIALS`, `ERROR`, `DEGRADED`, `PARTIAL`, `LOCKED` (la migration élargit une contrainte éventuelle sur `account_status`).
- Textes : `src/lib/connectionCopy.ts`, jamais le nom du prestataire (`mentionsVendor`).

## 6. Récepteur de notifications

`unipile-webhook` (réception), `unipile-manage-webhooks` (gestion), `sequence-webhooks-handler` (suivi natif des e-mails de séquence).

- Authentification : `?v2_token=` dans l'adresse (le point de réception ne prend aucun en-tête personnalisé). Jeton attendu : `UNIPILE_V2_WEBHOOK_TOKEN` s'il est posé, sinon dérivé par HMAC de `UNIPILE_WEBHOOK_SECRET`. Aucun des deux : 503. Jeton absent ou faux : 401. Comparaison par empreintes SHA-256, ne fuit pas la longueur. Le jeton n'est jamais journalisé ni rendu au navigateur (`redactWebhookUrl`). Aucune signature de livraison du prestataire n'est vérifiée.
- Enveloppe v2 : `{ id: 'evt_...', type, created_at, account_id, account_name, account_provider, application_id, payload }`. `flattenEnvelope` la met à plat (`event`, `v2_event`, `account_id`, `event_id`, plus les clés par type) ; un corps qui n'est pas une enveloppe v2 est ignoré (200). Pour `email.new` il garde l'expéditeur, `in_reply_to` et `thread_id`.
- Dédoublonnage : `record_webhook_event` (table `webhook_event_log`) avec la clé `type v2 brut` + `evt_...` (jamais le nom de handler, qui confondrait `account.status.running`, `degraded` et `partial`). Sans `evt_`, repli sur le compte, une référence de la charge et la minute. Un échec de traitement répond 500 et purge la clé pour que la reprise du prestataire traite l'événement ; si la purge échoue aussi, la ligne est marquée `processing_failed` et réclamée au rejeu. La ligne de dédoublonnage vit 30 jours.
- Tâches : `unipile-manage-webhooks` répond à `list`, `register`, `delete`, `list_deliveries`, `replay_event`. `register` est idempotent : un seul point de réception pour le récepteur, mis à jour sur place (même identifiant, jeton réécrit, événements voulus, actif), doublons supprimés ensuite. `register` et `delete` : réservés aux identifiants de `KONEKT_PLATFORM_ADMIN_USER_IDS` quand le secret existe, sinon propriétaire ou administrateur d'organisation. `list_deliveries` et `replay_event` : fermés à tous quand le secret est absent. Un rejeu est refusé si l'événement a déjà reçu une réponse 2xx (`already_received`).
- Journaux : jamais le contenu d'un message. Clés structurelles seulement.

## 7. Outil de bascule des identifiants

- **Fonction `unipile-migration`** (`supabase/functions/unipile-migration/`). Porte : `KONEKT_PLATFORM_ADMIN_USER_IDS`, fermée si la liste est absente (`gate.ts`), contrôlée avant la lecture du corps. Actions : `access`, `readiness`, `remap_preview`, `remap_apply` (mot `BASCULER`, empreinte du plan), `remap_rollback` (mot `ANNULER`, numéro de lot). CORS : liste d'origines de `_shared/cors.ts`. Aucune réponse ne rend un identifiant de compte entier (quatre derniers caractères, libellés masqués).
- **Plan** (`plan.ts`) : rapproche les comptes des tables `member_*_accounts` (et `member_calendar_accounts`) de la liste du service. Correspondance par `metadata.v1_account_id`, ou par adresse pour une messagerie. Jamais de supposition : un compte absent, ambigu ou d'un autre type reste `unmapped`. L'empreinte SHA-256 du plan (type, ancien et nouvel identifiant) est rendue par la simulation et redemandée par la conversion : si les comptes ont changé entre-temps, refus (`plan_changed`).
- **Contrôles** (`readiness.ts`) : clé, service joignable, domaine, point de réception (17 événements), clé de réception (dédiée, dérivée, absente), liste d'administrateurs, connexion directe, anciennes clés, outils installés, rapprochement des comptes.
- **Conversion** : migration `20261012051307_provider_account_id_remap.sql`. Tables fermées `account_id_remap` (lot, ancien, nouvel identifiant) et `account_id_remap_backup` (une ligne par valeur réécrite). Fonctions : `provider_account_id_columns()` (registre unique des colonnes), `provider_account_id_usage(p_old)`, `remap_provider_account_id(p_batch, p_old, p_new, p_kind, p_applied_by)`, `rollback_provider_account_id_remap(p_batch)`, `provider_account_id_orphans(p_limit)`. Toutes en `SECURITY DEFINER`, `EXECUTE` retiré à `PUBLIC`, `anon`, `authenticated`. Une transaction par compte. Ordre des écritures prouvé par `account_remap_audit.sql` : les inscriptions de séquences avant les tables de liaison (sinon le déclencheur `sequence_enrollments_check_sender_owner_update` refuse). Colonnes réécrites : voir le registre ; hors registre, à dessein : `webhook_event_log`, `search_failure_log`, `notifications.metadata`, `agent_tool_executions`, `connection_attempts`. Identifiants de conversation, de fil et de message : non convertis.
- **Pas de fenêtre à deux identifiants.** Après la conversion, aucune fonction ni aucun déclencheur ne reconnaît un ancien identifiant. Les moteurs planifiés restent donc en pause de la fusion jusqu'à la fin de la conversion (guide, partie 6).
- **Pas de limite de temps SQL.** Pour une table très grande, la conversion par le serveur peut atteindre le délai de l'API. Repli, dans l'éditeur SQL : `select public.remap_provider_account_id('<uuid de lot>'::uuid, '<ancien>', 'acc_...', 'linkedin', null);` et `select public.rollback_provider_account_id_remap('<uuid de lot>'::uuid);`. Un compte reconnecté (nouvel identifiant sans `v1_account_id`) peut aussi se convertir ainsi.
- **Page** : `/settings/admin/bascule` (`src/pages/AdminBascule.tsx`, `src/components/settings/admin/`). Cachée : aucune entrée de navigation. Textes dans `basculeCopy.ts`.
- **Requête de contrôle** : `supabase/tests/provider_id_columns_check.sql`, lecture seule, à lancer dans l'éditeur SQL de production avant la bascule (colonnes, fonctions, policies et déclencheurs qui lisent un identifiant de compte).
- **Audits SQL** : `supabase/tests/account_remap_audit.sql`, `connection_attempts_audit.sql` (câblés dans `.github/workflows/e2e.yml`, avec un appel anonyme réel qui doit répondre 401 / 42501).
- **Complétude** : `account_remap_audit.sql` échoue si une nouvelle colonne `%account_id%` du schéma public n'est ni dans le registre ni dans la liste justifiée de l'audit.

## 8. Harnais de test

### Faux prestataire v2

`e2e/local-stack/vendor-mock.mjs` (port 54340). Il ne sert que l'API v2 : hôte `api.unipile.com`, clé `e2e-test-key`, chemins `/v2/{acc_...}/...`, `/v2/accounts`, `/v2/auth/*`, `/v2/webhooks/*`. `functions-server.ts` réécrit tout `fetch` vers un hôte autre que `127.0.0.1` ou `localhost` vers ce faux serveur. Un appel `/api/v1` répond 599 et devient une violation `v1_call` ; un mauvais hôte, une mauvaise clé, un identifiant hors `acc_...`, une route inconnue (501) ou un corps hors contrat (422) sont consignés de même. Surface de contrôle (`/__log`, `/__violations`, `/__mode`, `/__fire`, `/__deliveries`, `/__auth_script`) : voir `e2e/local-stack/README.md`. Les corps d'erreur de `tests/fixtures/unipile-v2/error-presets.json` portent le nom du prestataire à dessein, pour prouver qu'il ne remonte jamais.

Ce que la spécification ne dit pas (corps d'erreur, identifiants de conversation et de message, clés des produits d'un compte) est inventé dans le faux serveur et marqué « supposé » dans le code.

### Lancer la pile locale et les specs

Prérequis : Docker, `psql`, Node, Deno (ou `npx deno`).

```bash
bash e2e/local-stack/up.sh                    # rejouable ; base, auth, REST, fonctions, faux prestataire
set -a; . /tmp/konekt-e2e-stack/env; set +a   # clés et URLs de la pile
npx playwright test e2e/api/<spec>.spec.ts --project=api --no-deps --workers=1 --retries=0 --reporter=list
node e2e/local-stack/check-violations.mjs     # après chaque série
bash e2e/local-stack/down.sh                  # --reset supprime aussi la base
```

- `--workers=1` : l'état du faux prestataire est global (`DELETE /__log` l'efface pour tous). Ne lancez pas deux séries en parallèle sur la même pile.
- `functions-server.ts` garde chaque handler et ses modules en mémoire après la première requête : relancez `up.sh` après toute modification sous `supabase/functions/**` (y compris `_shared/`), sinon la spec tourne sur l'ancien code.
- `check-violations.mjs` est obligatoire après `playwright` : une fonction qui avale un 599 ou un 501 ne fait échouer aucun test.
- `E2E_OMIT_WEBHOOK_SECRET=1 bash e2e/local-stack/up.sh` démarre sans `UNIPILE_WEBHOOK_SECRET` (cas du jeton dédié seul).
- Variables des fonctions locales : `UNIPILE_V2_API_KEY=e2e-test-key`, `UNIPILE_V2_WEBHOOK_TOKEN`, `UNIPILE_HOSTED_DOMAIN`, `UNIPILE_WEBHOOK_SECRET`. `UNIPILE_API_KEY` et `UNIPILE_DSN` sont retirées de l'environnement par `up.sh` et par `functions-server.ts`.

### Tests Deno

```bash
deno test --no-check --allow-env --import-map=e2e/local-stack/import_map.json supabase/functions/_shared/unipile/
deno test --no-check --allow-env --import-map=e2e/local-stack/import_map.json supabase/functions/unipile-migration/
```

`--allow-read` (et `--allow-write` pour `process-sequences/engine.test.ts`) selon le test.

### Contrôle de types Deno dans une copie propre

Un dossier `node_modules` à la racine fait résoudre `@supabase/supabase-js` depuis npm par Deno : il rapporte alors des centaines de fausses erreurs de types. Contrôlez les points d'entrée dans une copie sans `node_modules` :

```bash
git worktree add --detach /tmp/clean HEAD
# copier dans /tmp/clean les fichiers modifiés (git diff HEAD --name-only) et les nouveaux fichiers
cd /tmp/clean && deno check --import-map=e2e/local-stack/import_map.json supabase/functions/<fonction>/index.ts
git worktree remove --force /tmp/clean
```

Même dans une copie propre, les fonctions qui importent `credit-guard`, `settle-credits`, `subscription-gate`, `resolve-org-credentials` ou `linkedin-quotas` rapportent des erreurs de types liées à `supabase-js` résolu depuis npm (écart avec `esm.sh?no-check`). La référence est le nombre d'erreurs du commit de base, pas zéro. Le plan d'import mappe `supabase-js@2.50.0` vers un paquet npm qui peut manquer : `resolve-pedigree-directory` échoue alors avec « Could not find a matching package » (même sur `61049f0`) ; mappez vers `2.75.1` localement pour contrôler.

### CI

Seul `.github/workflows/candidate-actions.yml` exécute du Deno : `transport.test.ts`, `agent-tools-email.test.ts`, `agent-tools-mutations.provider.test.ts`, et `deno check` de deux fichiers. Les tests Deno de `_shared/unipile/`, de `unipile-accounts`, `unipile-webhook`, `unipile-manage-webhooks`, `unipile-search`, `unipile-migration` et `process-sequences/engine.test.ts` ne sont dans aucun workflow (relevé par recherche dans `.github/workflows/*.yml`). `e2e.yml` rejoue les audits SQL de la conversion et des tentatives de connexion sur une base neuve.

## 9. Gardes statiques

Tests Node qui lisent les sources (lancés par `npm run test:c1`, `test:ux`, `test:agent`) :

| Fichier | Ce qu'il interdit ou impose |
|---|---|
| `tests/c1/unipile-client.test.mjs` | Le dossier du client est lu en entier ; seul `http.ts` appelle `fetch` ; aucun `/api/v1`, `UNIPILE_DSN` ni `resolveUnipileCredentials` ; aucun import de `supabase-js` dans le client ; aucun texte d'erreur ne nomme un prestataire ; le barrel exporte tout. |
| `tests/c1/unipile-sequences-sortie.test.mjs` | Envois de séquence : aucun reste de l'ancienne API, aucun `fetch` direct, ordre des contrôles de la file d'InMails, `DEGRADED`/`PARTIAL`/`LOCKED` reportent sans pause, un envoi incertain n'est jamais compté envoyé. |
| `tests/c1/unipile-profils-enrichissement.test.mjs` (PE-*), `tests/c1/unipile-fonctions-annexes.test.mjs` (S6B-*) | Idem pour profils et enrichissement, puis pour les fonctions annexes (analyse, catégorisation, filtres, annuaire) : client commun seul, compte prouvé relié avant la lecture. Export, purge et effacement RGPD n'appellent pas le prestataire. |
| `tests/c1/assistant-provider-v2.test.mjs`, `tests/c1/unipile-search-v2.test.mjs` (UNS-*), `tests/agent/unipile-search-*.test.mjs` | Assistant et recherche : aucun reste de l'ancienne API, un seul import (le client commun), compte du membre prouvé et jamais le premier compte de l'organisation, aucune chaîne du prestataire dans ce que lit le modèle ou l'utilisateur. |
| `tests/c1/account-remap.test.mjs` | Une seule migration de bascule, registre identique à la requête de contrôle, inscriptions avant liaisons, tables fermées, transaction unique, porte administrateur avant toute lecture, confirmation avant lecture, empreinte du plan, aucun identifiant rendu en entier, aucun tiret long. |
| `tests/c1/fonctions-config.test.mjs`, `tests/c1/c1-fonctions.test.mjs` | Chaque fonction a sa section `[functions.<nom>]` avec `verify_jwt = false` (dont `unipile-migration`). |
| `tests/ux/unipile-v2-webhooks.test.mjs`, `tests/ux/unipile-v2-front-*.test.mjs` | Récepteur : jeton seul accepté, ancien en-tête non lu, dédoublonnage ; front : appels et formes de réponse. |
| `tests/ux/connexion-*.test.mjs`, `tests/ux/admin-bascule.test.mjs` | Écrans de connexion et de bascule : aucun texte de serveur affiché tel quel, aucun nom de prestataire, états. |
| `tests/ux/vendor-mock-v2.test.mjs`, `e2e/local-stack/vendor-mock-contract.test.mjs` | Le faux prestataire respecte le contrat de la spécification. |

Les suites `tests/c1`, `tests/ux` et `tests/agent` ont deux échecs connus indépendants de la bascule : `fond-accueil.test.mjs` (« cartes texturées ») et `seq-audit-f4b.test.mjs` (SEQ-145 / SEQ-227, messagerie).

## 10. Ce qu'un essai avec une vraie clé doit confirmer

Aucun test de contrat contre le vrai service n'existe dans le dépôt (recherche du 12 octobre : aucun fichier). Liste à jouer sur un environnement hors production, avant la fusion. Un résultat différent de l'hypothèse se corrige dans `normalize/*`, `errors.ts` ou la fonction concernée.

| # | À confirmer | Hypothèse actuelle |
|---|---|---|
| 1 | Formes de `{user_id}` acceptées dans les chemins et dans `users_ids` : nom court, identifiant du prestataire (`ACo...`, `AE...`), adresse du profil | `userRef` essaie le nom court, puis l'identifiant. Un refus de validation ou un 404 déclenche l'essai suivant. |
| 2 | `User.id` v2 égale-t-il à l'ancien identifiant de personne stocké dans `job_candidate_status.candidate_id` (94 % d'identifiants `AE...`) ? | Non garanti. Les rapprochements d'identité passent aussi par le nom court et l'adresse. |
| 3 | Identifiants de conversation, de fil et de message après migration du compte : mêmes valeurs qu'en v1 ? | Non convertis. Repli : retrouver la conversation par le candidat. |
| 4 | Boîtes de réception (inbox) et licence de chaque inbox pour Recruiter et Sales Navigator ; `POST chats/send` sans inbox accepté pour LinkedIn ? | Le code prend l'unique inbox active, ou celle dont le nom évoque la licence, sinon envoie sans inbox, avec un essai sans inbox en cas de refus de validation ou de 404. |
| 5 | Corps et codes d'erreur réels : mauvais mot de passe, mauvais cookie, mauvais code, intention expirée, déjà connecté ailleurs, déjà en relation, déjà invité, limite hebdomadaire, conversation en lecture seule, plus de crédits InMail | `classifyError` par statut ; les détections `content_too_large`, `account_disconnected`, `/credit/` et la reconnaissance de « existing relation » dans `inviteRejectionSkipReason` (`_shared/sequence-send-rules.ts`) sont des suppositions. |
| 6 | Contenu réel des notifications autres que `message.new` (`relation.new`, `account.add`, `account.status.*`, `email.new`, reçus de lecture, réactions) et clé `state` de `account.add` | Lecture défensive à partir de la spécification. |
| 7 | `email.new` est-il émis pour un e-mail envoyé ? Le message RFC (`message_id`) est-il rendu par l'envoi ? | La garde « propre e-mail » dépend de `member_email_accounts.email_address` (déduite du nom du compte). Le rapprochement des réponses par `In-Reply-To` suppose que l'on stocke l'identifiant RFC. |
| 8 | Signature de livraison des notifications | Non utilisée : le jeton de l'adresse est la seule preuve. |
| 9 | Un compte sans produit Recruiter : réponse de `POST recruiter/search/parameters` | Toute erreur arrête la sonde ; le message pour validation ou forbidden est générique. |
| 10 | Identifiants de projet Recruiter (`GET recruiter/projects`) acceptés par le filtre `project.include[].id` de la recherche de personnes ? | Non prouvé. Si faux, lister les projets par `get_parameters` de type `PROJECT`. |
| 11 | Mêmes identifiants de recherche (entreprises, écoles) entre Classic et Recruiter ; identifiants Sales Navigator égaux à ceux des paramètres de recherche | Non prouvé (1 402 entreprises, 24 écoles, 35 écoles écrites en dur). À échantillonner avant tout `resolve-pedigree-directory` forcé. |
| 12 | Où se trouve le titre du profil (`headline`) ; sérialisation de `with_sections` ; téléphone et e-mail rendus pour un tiers | Plusieurs chemins lus (`HEADLINE_PATHS`), avertissement une fois par exécution. |
| 13 | Adresse de photo v2 : toujours sur `media.licdn.com` avec `e=` ? | Sinon toute nouvelle photo finit « ignorée (origine) » ; élargir `_shared/candidate-photo.ts`, `src/lib/pictureUrl.ts` et les regex SQL de `candidate_picture_should_replace` / `refresh_candidate_pictures`. La liste d'origines n'a pas été élargie (protection SSRF). |
| 14 | Clés de `metadata.products_connection_status` ; sens exact de `is_locked`, de `PARTIAL` et de `DEGRADED` | Le code ne lit pas ces clés (licence dérivée des contrats). Recruiter Lite ne se distingue pas de Recruiter (supposition sur le nom du contrat). Recruiter et Sales Navigator sont exclusifs et demandent un `select` avant une recherche de l'autre produit. |
| 15 | `notify_visit_token` toujours présent ? Un profil lu enregistre-t-il une visite ? | Une visite est un appel explicite ; sans jeton la visite est ignorée avec un message. Un pas de visite compte deux lignes du registre (`profile_visit` et lecture). |
| 16 | Un candidat qui a bloqué le compte répond-il 403 ? Une conversation sans historique (`has_history=false`) doit-elle être ignorée ? | 403 traité comme avant ; aucune conversation écartée. |
| 17 | Étapes de connexion directe : QR, validation dans l'application, écran de choix de contrat, consentement, CAPTCHA ; l'identifiant d'intention est-il l'identifiant final du compte ? | Seuls les types prouvés par les tests ; les autres retombent sur le lien hébergé. |
| 18 | Contenu de la page hébergée : logo, nom, textes | Non modifiable par le code ; contrôle manuel du propriétaire (guide, partie 4.3). |
| 19 | Limites de débit par clé (aucune documentée, la clé est commune à tous les locataires) | Repli sur 429 seulement, pas de limiteur global. |
| 20 | Rétention du journal de livraisons chez le prestataire ; le filtre `event_id` est-il honoré ? | Le code ne s'y fie pas : il relit les tentatives et filtre lui-même. |
| 21 | Un ancien identifiant de compte fonctionne-t-il encore en v2 ? Le prestataire honore-t-il l'ancienne API après la conversion (retour en arrière) ? | On suppose que non pour la v2 (tout est converti). Le retour en arrière suppose que oui pour la v1 : à vérifier avant la bascule. |
| 22 | Extension Chrome : `connect_cookie` accepté pour un compte existant ? | Répond un message neutre ; la reconnexion depuis l'extension est inactive. |
| 23 | Reprise d'un `we_` (point de réception) existant lors du premier `register` en production | Le `register` met à jour sur place le point de réception qui a la même adresse. |

Le service est en phase bêta côté prestataire (plan de juillet, `AUDITS/UNIPILE_V2_MIGRATION_PLAN.md`) : un changement de contrat se corrige par un seul module (`normalize/*`, `errors.ts`, `webhooks.ts`) et par les fixtures de `tests/fixtures/unipile-v2/`.
