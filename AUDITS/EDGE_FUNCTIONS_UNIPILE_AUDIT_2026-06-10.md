# Audit edge functions + intégration Unipile — 2026-06-10

Périmètre : les **86 edge functions** du repo (audit individuel, checklist auth / multi-tenant /
timeouts / crédits IA / erreurs / quotas LinkedIn), audit transversal de l'intégration Unipile
(call sites, quotas, gestion d'erreurs, webhooks), **cross-check des endpoints contre la
référence API officielle Unipile** (via MCP), et **logs de production live** (Supabase).

Méthode : 6 agents d'audit parallèles + vérification manuelle de chaque finding critique.
4 faux positifs d'agents ont été écartés après vérification directe (notés en fin de document).

---

## Verdict global

L'intégration Unipile est **saine et conforme** : tous les endpoints utilisés existent dans
l'API officielle avec les bonnes méthodes, le quota gate couvre ~95 % des actions LinkedIn,
les webhooks sont sécurisés et dédupliqués. **MAIS les logs de production révèlent 2 crons
en échec permanent** (sans lien avec les migrations d'aujourd'hui — les erreurs leur sont
antérieures), et l'audit a confirmé **14 fonctions IA qui ne décomptent jamais les crédits**.

---

## 🔴 P0 — Incidents live découverts dans les logs de production

### 1. `process-scheduled-actions` → 401 à CHAQUE exécution du cron (toutes les minutes)

Diagnostic : la fonction est **absente de `supabase/config.toml`** (86 fonctions ont une entrée
`verify_jwt = false`, pas celle-ci) → défaut `verify_jwt = true` → le gateway Supabase exige un
JWT valide et **rejette la requête du cron avant même d'exécuter le code** (le cron envoie
`Bearer <PROCESS_SEQUENCES_SECRET>` via `invoke_process_scheduled_actions()`, qui n'est pas un JWT).

**Impact : les actions programmées par l'agent (relances planifiées) ne s'exécutent plus du tout.**

Fix : ajouter dans `config.toml` :
```toml
[functions.process-scheduled-actions]
verify_jwt = false
```
puis `supabase functions deploy process-scheduled-actions --project-ref crckfywoyjxkawathdff`.
(L'auth applicative interne — secret cron — est déjà correcte dans le code, lignes 64-77.)

### 2. `process-inmail-queue` → 400 à CHAQUE exécution du cron (toutes les minutes)

Diagnostic : le cron appelle `action=process`, mais ce chemin commence par `validateUser()`
(`process-inmail-queue/index.ts:276`) qui exige un **JWT utilisateur** (`auth.getUser(token)`).
Le secret cron n'est pas un JWT user → throw « Authentication failed » → catch global → 400.

**Impact : la file InMail n'est jamais traitée par le cron.** Les InMails programmés ne partent
que si un client (browser de l'user) déclenche le process — les envois hors-session n'ont
jamais lieu.

Fix (choix produit) : soit accepter le secret cron sur `action=process` et itérer sur les users
ayant des items dus (en respectant business hours + quota par user, déjà codés), soit supprimer
le cron `invoke_process_inmail_queue` si le traitement par session user est le design voulu
(et arrêter le bruit 400/min dans les logs).

---

## 🟠 P1 — Findings transversaux confirmés

### 3. 14 fonctions IA n'appellent JAMAIS `settleCredits` (violation convention CLAUDE.md)

`callClaudeCompat` (helper `_shared/call-claude.ts`) ne settle PAS les crédits — il retourne
seulement les tokens d'usage, le caller doit settler. Vérifié : ces fonctions appellent Claude
sans aucun settle/deduct/tracking :

`ai-chat-completion`, `analyze-linkedin-profile`, `analyze-response`, `audit-employer-brand`,
`auto-categorize-chats`, `detect-profile-fraud`, `enrich-company`, `fetch-notion-jobs`,
`generate-call-report`, `generate-recruiter-bio`, `live-coach`, `process-debrief`,
`retrieve-context`, `screen-candidate`.

**Impact : coût Anthropic consommé sans décompte des crédits orgs** (fuite de facturation +
quotas clients non appliqués sur ces actions). Fix : ajouter le pattern
`extractAIParams`/`settleCredits` après chaque appel (17 fonctions le font déjà correctement).

### 4. `endorse_skill` non couvert par le quota gate LinkedIn

`unipile-search/index.ts:318` (case) + `:2045` (POST `/linkedin/profile/endorse`) : action
**visible** sur LinkedIn, exécutée sans `enforceLinkedInAction` (le mapping ligne 254-258 ne
couvre que search/profile_view/message/inmail) et jamais comptée dans le ledger.
Fix : ajouter un type `endorse` au gate, ou retirer la feature.

### 5. Fallback credentials ENV = risque cross-org sur le workspace Unipile partagé

`resolveUnipileCredentials` retombe sur `UNIPILE_API_KEY`/`UNIPILE_DSN` globaux quand l'org n'a
pas de credentials propres. Tant que plusieurs orgs partagent ce workspace Unipile :
- **`unipile-search` ne vérifie pas que `account_id` appartient à l'org du caller** (la
  membership org est vérifiée lignes 197-203, mais pas la propriété du compte vs
  `member_linkedin_accounts`) → un user authentifié pourrait chercher/écrire avec le compte
  LinkedIn d'une autre org en devinant un `account_id`.
- **`unipile-manage-webhooks` action `delete`** : `webhook_id` du body supprimé sans vérifier
  l'appartenance (`unipile-manage-webhooks/index.ts:244-250`).

Fix : vérifier `account_id` ∈ `member_linkedin_accounts` de l'org avant toute action ; pour les
webhooks, vérifier l'appartenance avant delete. (Avec des credentials strictement per-org, le
risque disparaît mécaniquement — l'API key ne voit que son workspace.)

### 6. Flags temporaires hard-codés sans garde-fou de date

- `WARMUP_MODE = true` (`_shared/linkedin-quotas.ts:48`) — caps réduits (20 actions/j,
  40 visites/j, 50 recherches/j, 15 InMails/j, 30 invites/sem au lieu de 80/100/100/40/100).
  Commentaire : « repasser à false vers le 2026-06-16 ». **Dans 6 jours — à ne pas oublier**
  (sourcing à capacité réduite sinon).
- `ENRICHMENT_PAUSED = true` (`process-enrichment-queue/index.ts:33`) — pause intentionnelle
  (conflit session Recruiter, commit 24f5e4b). La queue d'enrichment s'accumule pendant ce temps.

Recommandation : remplacer par une date d'expiration (`WARMUP_UNTIL = '2026-06-16'`) ou une
entrée `internal_config`, pour que la reprise soit automatique ou au moins alertée.

---

## ✅ Intégration Unipile — conformité vérifiée (via référence API MCP)

### Endpoints : 17/17 conformes (path + méthode)

| Code | Référence officielle | OK |
|---|---|---|
| POST `/linkedin/search` | POST Perform LinkedIn search | ✅ |
| GET `/linkedin/search/parameters` | GET | ✅ |
| GET `/users/{id}` | GET Retrieve a profile | ✅ |
| GET `/users/{id}/posts` | GET List all posts | ✅ |
| POST `/users/invite` (message tronqué à 300 chars = limite LinkedIn) | POST Send an invitation | ✅ |
| GET `/users/invite/sent` | GET List invitations sent | ✅ |
| GET/POST `/chats`, GET `/chats/{id}`, GET/POST `/chats/{id}/messages` | idem | ✅ |
| GET `/chats/{id}/sync` | GET Synchronize a conversation | ✅ |
| PATCH `/chats/{id}` (mark as read) | PATCH Perform an action on a chat | ✅ |
| GET `/chat_attendees/{id}`, GET `/chat_attendees/{id}/chats` | idem | ✅ |
| GET `/linkedin/inmail_balance` | GET Get inmail credit balance | ✅ |
| POST `/linkedin/profile/endorse` | POST Endorse a skill | ✅ (mais non gaté, cf. P1.4) |
| POST `/hosted/accounts/link` | POST Connect (hosted auth) | ✅ |
| GET `/accounts`, GET/PATCH `/accounts/{id}` | idem | ✅ |
| GET/POST/DELETE `/webhooks` | idem | ✅ |

### Quotas : couverture du gate `enforceLinkedInAction`

| Source d'action | Gate | Réf |
|---|---|---|
| Recherche manuelle (unipile-search) | ✅ mode `manual`, buffer 5 % | index.ts:253-279 |
| Vue de profil manuelle | ✅ | idem |
| Message / InMail manuel (inbox) | ✅ | idem |
| Séquences (process-sequences) | ✅ + check `inmail_balance` fail-closed avant envoi | :1744-1773 |
| File InMail (process-inmail-queue) | ✅ + max 3 InMails/cycle anti-burst | :361-407 |
| Enrichment background (profile_view) | ✅ (worker actuellement pausé) | profile-enrichment:236-262 |
| Outils agent (send message) | ✅ | agent-tools-mutations:1928 |
| Endorse skill | ❌ **seul trou** | cf. P1.4 |

Le ledger est incrémenté de façon **optimiste** (avant l'appel Unipile) : un envoi qui échoue
consomme quand même du quota. C'est le sens **sûr** pour le risque de ban (surcompte → blocage
plus tôt), au prix d'un léger gaspillage de quota les jours à erreurs.

### Connexion live

Pas d'appel direct à l'API Unipile possible depuis cet environnement (la clé `X-API-KEY` est un
secret Supabase, non exposé ici — c'est normal). Signaux indirects des logs prod (40 dernières
minutes) : `unipile-accounts` 200, `unipile-webhook` 200 (events reçus et traités),
`process-sequences` 200 en continu → **la connexion Unipile est fonctionnelle en prod**.
Aucun 429/rate-limit Unipile observé dans la fenêtre.

### Gestion d'erreurs Unipile (asymétries non bloquantes)

- 429 : retry/toast (unipile-search ✅), reschedule +30 min (inmail-queue ✅), fail-closed (sequences ✅) — incohérent mais chaque comportement est défendable dans son contexte.
- `multiple_sessions` : retry 3× (0/6/15 s) dans unipile-search ; **pas de retry dans process-sequences**.
- `CONTENT_TOO_LARGE` : auto-truncate dans unipile-search ; pas de handler dans process-sequences.
- Statut compte `CREDENTIALS` : vérifié avant envoi dans inmail-queue ; pas dans unipile-search.

Recommandation : centraliser dans un helper `_shared/unipile-error-handler.ts`.

---

## Audit par fonction — synthèse (86 fonctions)

**~60 fonctions ✅** sans finding. Les ⚠️ notables (vérifiés ou plausibles, hors items déjà cités) :

| Fonction | Finding |
|---|---|
| sequence-send-email:295 | Erreur Microsoft Graph renvoyée brute au client (sanitizer à étendre) |
| submit-application:234 | Erreur Notion brute renvoyée au client |
| update-notion-job:201 | `Notion API error: {status} — {body}` renvoyé au client (vendor + détails internes) |
| update-candidate-stage:113 | Erreur Notion parfois brute au client |
| get-enrichment-status:118 | Fallback direct provider si row absente — préférer fail-closed (enumeration `request_id`) |
| generate-recruiter-bio:21 | Auth manuelle au lieu de `requireAuth` (fonctionne, mais hors pattern) |
| ai-credits:119 | `.single()` au lieu de `.maybeSingle()` sur le solde (crash si org absente de la table) |
| nurturing-analyzer:327 | Lecture des opportunities d'autres users de l'org via service-role (à confirmer si voulu) |
| run-agent-search:139 | Pas de check de propriété sur `conversationId` (ok si RLS sur agent_conversations) |
| n8n-create-workflow | `N8N_API_KEY` global, pas de scoping org sur les workflows créés |
| client-portal-data:66 | Update fire-and-forget sans `.catch()` |

**Sains et vérifiés directement** (échantillon) : webhooks tous signés fail-closed (Stripe HMAC,
Calendly HMAC + tolérance 5 min, Svix, Aircall token, sequence-webhooks constant-time),
`extension-token` (288 bits, hash-only), CRUD séquences correctement org-scopés,
`export-org-data` (membership + rôle admin/owner exigés), `rgpd-purge` (service-role only).

---

## Faux positifs d'agents écartés (vérifiés à la main)

1. « `unipile-search` : quota bypass sur send_message » — **faux**, le gate couvre
   search/profile_view/message/inmail (lignes 253-279).
2. « `export-org-data` : IDOR critique sans verifyOrgMembership » — **faux**, membership + rôle
   admin/owner vérifiés (lignes 60-73).
3. « `score-profile-job` : organization_id du body sans verifyOrgMembership » — **faux**, la
   fonction ne prend pas d'organization_id du body (requireAuth + rate-limit, org résolu du user).
4. « Tous les appels Anthropic settlent les crédits » (audit du matin) — **faux dans l'autre
   sens** : 14 fonctions ne settlent pas (cf. P1.3).

---

## Addendum 2 — vérification approfondie séquences/quotas (2026-06-10, soir)

Passe de re-vérification manuelle suite aux questions « tout est bien branché ? » :

- **Quotas — 4 chemins d'envoi, 1 seul gate, vérifié ligne par ligne** : séquences
  (`process-sequences:1758`), InMail queue (`:407`), actions manuelles (`unipile-search:263`,
  skip si `isInternal` = comparaison stricte au service_role key), outil agent
  (`checkLinkedInQuota` + ledger source `agent_tool` ; le call interne unipile-search n'est
  pas re-gaté → pas de double comptage). `executeScheduledAction` re-exécute le tool complet
  → les actions différées re-passent le gate à l'exécution. `scan-recruiter-linkedin` ne lit
  que `/users/me` (pas d'action visible, pas de gate nécessaire). Faux positifs agents
  confirmés : le « bypass send_message » et l'« IDOR account_id » n'existent pas
  (`resolveSendingAccount` vérifie user+org, agent-tools-mutations:1789).

- **Séquences — claim atomique déjà en place** (CAS `scheduled→sending` + lock 10 min +
  re-check enrollment post-envoi). **Bug réel trouvé et corrigé** : le janitor de recovery
  des steps bloqués en `sending` re-planifiait aveuglément les actions **LinkedIn visibles**
  (3 retries) alors qu'il vérifie les emails via le tracking — un message Unipile parti
  juste avant un crash était re-envoyé au candidat. Fix : une action visible bloquée passe
  en `failed` avec raison explicite (relance manuelle), seules les actions invisibles
  (profile_visit, check_connection, wait_connection) et les emails restent retryables.

## Addendum — remédiations appliquées (2026-06-10, soir)

- **P0.1 ✅** : `verify_jwt = false` ajouté à `config.toml` pour les 3 fonctions manquantes,
  redéployées — le cron `process-scheduled-actions` est repassé de 401 à 200 (vérifié logs prod).
- **P1.3 ✅** : nouveau helper `_shared/settle-usage.ts` (`settleClaudeUsage` : résolution org
  depuis le user + `settleCredits`, erreurs avalées) branché sur les **14 fonctions** qui
  appelaient Claude sans décompte — 21 call sites au total (enrich-company en avait 7, pas 4).
- **P1.4 ✅** : `endorse_skill` gaté — type `endorse` ajouté à `LinkedInActionType`, mapping dans
  unipile-search, et migration `20260610150000_endorse_in_visible_cap.sql` qui le compte dans le
  cap journalier d'actions visibles.
- **P1.6 ✅ (partiel)** : `WARMUP_MODE` est maintenant date-gaté (`Date.now() < 2026-06-16`) —
  expiration automatique, plus de risque d'oubli. `ENRICHMENT_PAUSED` reste un flag manuel
  (la reprise nécessite le fix de sérialisation par compte, décision à part).
- **Restent ouverts** : cron InMail (P0.2, décision produit), vérification de propriété
  `account_id`/`webhook_id` (P1.5), sanitizer erreurs Notion/Graph (P2).

## Plan d'action priorisé

1. **`config.toml` + redeploy `process-scheduled-actions`** (P0.1 — one-liner, débloque les actions agent).
2. **Décision sur le cron InMail** (P0.2 — fix auth cron ou suppression du cron).
3. **`settleCredits` dans les 14 fonctions IA** (P1.3 — fuite de facturation).
4. **Gate sur `endorse_skill`** + vérif propriété `account_id`/`webhook_id` (P1.4, P1.5).
5. **15/06 : penser à `WARMUP_MODE=false`** (et décider de la reprise de l'enrichment) (P1.6).
6. Sanitizer d'erreurs vendor sur les 4 fonctions Notion/Graph (P2).
