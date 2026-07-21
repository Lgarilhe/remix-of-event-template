# Plan de migration Unipile API v1 → v2 — Konekt

> Rédigé le 2026-07-20 (branche `claude/unipile-v2-migration-m1d5gj`).
> Source de vérité API v2 : spec OpenAPI officiel embarqué dans le SDK `@unipile/sdk@2.21.0`
> (npm, publié 2026-07-13) + docs https://developer.unipile.com/v2.0/docs/welcome.
> Cartographie v1 du code : voir aussi `AUDITS/EDGE_FUNCTIONS_UNIPILE_AUDIT_2026-06-10.md`.

## Contexte & état des lieux

- **Côté plateforme Unipile : migré.** Compte v2 créé (Dashboard V2), données migrées.
- **Côté code Konekt : 100 % v1.** `/api/v1` est codé en dur dans ~40 fichiers d'edge
  functions ; l'app prod tourne toujours sur le compte v1 (vérifié 2026-07-20 : 3 comptes
  LinkedIn `OK`, webhooks v1 actifs, toutes les fonctions répondent 200).
- **La v2 est en BETA** : Unipile annonce des breaking changes possibles pendant la phase
  beta. Stratégie retenue : **strangler** — la v1 reste le chemin par défaut, la v2 est
  opt-in par fonction, activée par la présence du secret `UNIPILE_V2_API_KEY`.

## Différences structurelles v1 → v2

| Aspect | v1 | v2 |
|---|---|---|
| Base URL | `https://{DSN}/api/v1` (DSN par tenant, ex `api4.unipile.com:13443`) | `https://api.unipile.com/v2` (globale — **le DSN disparaît**) |
| Auth | `X-API-KEY` (clé v1) | `X-API-KEY` ou `Authorization: Bearer` (clé émise par le Dashboard V2, incompatible v1) |
| account_id | Query param `?account_id=` | Dans le path : `/v2/{account_id}/...` |
| Organisation | 1 compte = 1 DSN | Organization → Applications (séparation dev/prod possible) → API keys |
| Recherche LinkedIn | `POST /linkedin/search` unique, body `api: classic\|recruiter\|sales_navigator` | Endpoints dédiés par licence ET par type (voir tableau recherche) |
| Webhooks | 1 webhook par `source` (`messaging`, `users`, `account_status`, `email`, `email_tracking`), headers custom possibles | 1 endpoint app-level `/v2/webhooks/endpoints/` avec `trigger_events[]` unifié, filtre `account_ids[]`, **pas de headers custom** |
| Profil user | Objet plat (`work_experience`, etc.) | Champs génériques top-level + `specifics` par provider + **sections opt-in** via `?with_sections=linkedin_experience,…` |
| InMail | Multipart `linkedin[api]=recruiter` + `linkedin[inmail]=true` | JSON propre : `inmail: true` / `send_as: 'INMAIL'\|'EMAIL'` |
| Invitations | `POST /users/invite`, `GET /users/invite/sent\|received` | `POST/GET /v2/{account_id}/users/me/relation-requests` (+ `/{id}/accept`, `/{id}/cancel`) |
| Solde InMail | `GET /linkedin/inmail_balance` | `GET /v2/{account_id}/linkedin/inmail-credits` (détaillé par licence : premium / recruiter / sales nav) |

## Renommage des événements webhook

| v1 (reçu par `unipile-webhook`) | v2 | Statut Konekt |
|---|---|---|
| `new_relation` | `relation.new` + `relation.request.accept` | ✅ aliasé (ce commit) |
| `message_received` / `new_message` | `message.new` | ✅ aliasé |
| `mail_received` / `new_email` | `email.new` | ✅ aliasé |
| `account_connected` (hosted auth, state dans `name`) | `account.add` / `account.reconnect` (state dans champ `state`) | ✅ aliasé + fallback `state` |
| `account_status_updated` (status dans payload) | `account.status.running` / `.paused` (status dans le NOM de l'event) | ✅ aliasé, status injecté (`running`→`OK`, `paused`→`PAUSED`) |
| `account_disconnected` | `account.status.disconnected`, `account.remove` | ✅ aliasé |
| `account_error` | `account.status.errored` | ✅ aliasé |
| `mail_opened` (email_tracking) | `tracking.open` | ⚠️ non traité (tombe en `default` log — comme en v1) |
| — (nouveaux) | `message.receipt.read`, `message.receipt.delivery`, `message.reaction.new`, `email.new.bounce`, `tracking.click`, `account.initial_sync.*`, `chat.update/delete` | 🎁 opportunités produit (read receipts séquences, bounces → suppression list, sync UX) |

⚠️ **Les payloads v2 n'ont pas pu être validés** (docs bloquées depuis l'environnement de
dev, le SDK ne couvre que le REST). Les handlers v1 sont tolérants multi-format, mais il
faudra **observer les logs des premiers events v2 réels** (`v2_origin:` dans les logs de
`unipile-webhook`) et ajuster le parsing si besoin.

## Fait dans ce commit (socle, aucun impact tant que `UNIPILE_V2_API_KEY` n'est pas posé)

1. **`_shared/unipile-v2.ts`** — client centralisé : `UNIPILE_V2_BASE_URL`,
   `resolveUnipileV2Credentials()` (env-only pour l'instant, signature prête pour le
   per-org), `unipileV2Fetch()` (timeout 15 s), `V2_TRIGGER_EVENTS`,
   `deriveV2WebhookToken()`. **Toute fonction migrée DOIT passer par ce module** — ne
   jamais reconstruire l'URL à la main (leçon v1 : `/api/v1` dispersé sur 40 fichiers).
2. **`unipile-manage-webhooks`** — actions `list`/`register`/`delete` en v2 via body
   `{ api_version: 'v2' }`. `register` crée UN endpoint unifié avec tous les
   `V2_TRIGGER_EVENTS`, idempotent. Le secret webhook passe en query param dérivé
   (`?v2_token=HMAC(UNIPILE_WEBHOOK_SECRET)`) car la v2 n'accepte pas de headers custom.
3. **`unipile-webhook`** — accepte l'auth par `v2_token` (temps constant) et remappe les
   noms d'événements v2 sur les handlers v1 (table `V2_EVENT_ALIASES`). Le champ `state`
   (hosted auth v2) est accepté en fallback de `name`.

## Mapping réel constaté (2026-07-20, GET /v2/accounts/ sur l'app de production)

La migration Unipile a préservé la correspondance dans `metadata.v1_account_id` de chaque
compte v2 → **le remapping est déterministe**. Constat sur l'application v2 de production :

| Compte | ID v1 (en base Konekt) | ID v2 | Statut v2 |
|---|---|---|---|
| LinkedIn Laurent GARILHE | `U0Cfy5DeRuG6gHFSGUk5Sg` | `acc_01kxnygph1e4fbp1shppg85as3` | running |
| Outlook l.garilhe@konekt.fr | `BJMqT1aKSBerrkX8lbO1lQ` | `acc_01kxnygmxwencssf1vz63t7ntk` | running |
| Outlook (doublon, inconnu de Konekt) | `8_Dq-UL0TfmrWPPDLOTbTA` | `acc_01kxnygk59e8q8299hkqz5ty42` | running — à supprimer côté Dashboard V2 ? |
| WhatsApp +33675255464 | `1GXocJWEQGa-8VLe-ikPWQ` | `acc_01kxnyghw9encssf19qv7dpj02` | **disconnected** |
| LinkedIn Guillaume Valladier | `PUYMa3xqQxivuNbIC4N_PA` | **ABSENT de la v2** | à migrer/reconnecter |
| LinkedIn Tiago BRITO | `NBEk5nHpTxCX63LwzPS0lw` | **ABSENT de la v2** | à migrer/reconnecter |

Notes :
- Le LinkedIn de Laurent expose `products_connection_status: { classic: running, company:
  running }` — **pas de produit recruiter/sales_navigator listé**. À vérifier dans le
  Dashboard V2 si la licence Recruiter doit être (re)connectée (impacte la recherche
  Recruiter et les InMails).
- ⚠️ Ne PAS remapper les IDs en base tant que les fonctions v1 tournent (elles utilisent
  les IDs v1). Stratégie transition : table de correspondance `v1_id → v2_id` consommée
  par les fonctions migrées, puis UPDATE final des colonnes `*_account_id` au cutover.

## Checklist d'activation (actions Laurent)

1. Dashboard V2 → Application → API keys → créer une clé, puis :
   `supabase secrets set --project-ref crckfywoyjxkawathdff UNIPILE_V2_API_KEY=<clé>`
2. Vérifier le mapping des comptes : comparer `GET https://api.unipile.com/v2/accounts/`
   (clé v2) avec `select linkedin_account_id from member_linkedin_accounts` (3 comptes) et
   `member_email_accounts.email_account_id`. **Si les IDs v2 diffèrent des IDs v1**, il
   faut une migration de données (UPDATE des colonnes `*_account_id`) avant toute bascule —
   ces IDs sont utilisés partout (webhooks, séquences, recherche).
3. Enregistrer le webhook v2 : invoquer `unipile-manage-webhooks` avec
   `{ action: 'register', api_version: 'v2', organization_id: <org> }` (les webhooks v1
   restent en place tant que le compte v1 vit — les deux coexistent sans conflit grâce à
   la dédup par event_key).
4. Observer les logs `unipile-webhook` (`v2_origin:`) pour valider les payloads réels v2,
   ajuster le parsing si un format diffère.
5. Ensuite seulement : migrer les fonctions dans l'ordre ci-dessous.

## Ordre de bascule recommandé (reste à faire)

Chaque étape = une PR, testée avec la clé v2 réelle avant de passer à la suivante.

### Étape A — comptes & connexion (`unipile-accounts`, 20 actions)
| Action v1 | Endpoint v1 | Endpoint v2 |
|---|---|---|
| list accounts | `GET /accounts` | `GET /v2/accounts/` |
| get account | `GET /accounts/{id}` | `GET /v2/accounts/{account_id}` |
| hosted_auth_link | `POST /hosted/accounts/link` | `POST /v2/auth/link` (body `{ account_id }` pour reconnect ; state dédié ; options `global.wait_initial_sync`, `login_hint` ; voir aussi `POST /v2/auth/intent`) |
| connect_cookie / connect_credentials | `POST /accounts` | `POST /v2/accounts/` (native auth) |
| solve_checkpoint | `POST /accounts/checkpoint` | `POST /v2/auth/checkpoint` (+ `/request`, `/resend`) |
| disconnect | `DELETE /accounts/{id}` | `DELETE /v2/accounts/{account_id}` |
| inmail_balance | `GET /linkedin/inmail_balance` | `GET /v2/{account_id}/linkedin/inmail-credits` ⚠️ réponse par licence — adapter `useInMailBalance` |
| recruiter contracts | `GET /accounts/{id}` (connection_params) | `GET /v2/{account_id}/linkedin/contracts` (+ `/{contract_id}/select`) — enfin un endpoint dédié |
| update_proxy | `PATCH /accounts/{id}` | `PATCH /v2/accounts/{account_id}` |
| invitations received / handle | `GET /users/invite/received`, `POST /users/invite/received/{id}` | `GET /v2/{account_id}/users/me/relation-requests`, `POST .../{request_id}/accept` ou `/cancel` |
| add_reaction / delete_message / delete_chat | `POST /messages/{id}/reaction` etc. | `POST /v2/{account_id}/chats/{chat_id}/messages/{message_id}/reactions`, `DELETE .../messages/{message_id}`, `DELETE /v2/{account_id}/chats/{chat_id}` ⚠️ chat_id requis dans le path |
| attendee picture | `GET /chat_attendees/{id}/picture` | à confirmer (probablement via `GET /v2/{account_id}/users/{user_id}` + picture URLs) |

### Étape B — messaging (`unipile-search` actions chats/messages, `process-sequences`, `process-inmail-queue`, `auto-*`, `nurturing-analyzer`)
| Usage v1 | v2 |
|---|---|
| `GET /chats` (3 folders parallèles) | `GET /v2/{account_id}/chats` + nouveau concept **inboxes** : `GET /v2/{account_id}/inboxes` puis `/inboxes/{inbox_id}/chats` |
| `GET /chat_attendees/{apid}/chats` | `GET /v2/{account_id}/users/{user_id}/chat` (chat 1-to-1 direct) |
| `GET /chats/{id}/messages` | `GET /v2/{account_id}/chats/{chat_id}/messages` |
| `POST /chats/{id}/messages` (multipart) | `POST /v2/{account_id}/chats/{chat_id}/messages/send` (JSON) |
| `POST /chats` (nouveau chat, InMail via `linkedin[inmail]`) | `POST /v2/{account_id}/chats/send` — InMail : `inmail: true` / `send_as: 'INMAIL'` |
| `PATCH /chats/{id}` (mark_as_read) | `POST .../messages/{message_id}/read` / patch chat — à confirmer sur cas réel |
| `GET /chats/{id}/sync` | `GET /v2/{account_id}/threads/{thread_id}` ou resync compte — à confirmer |
| `POST /users/invite` (process-sequences L2749) | `POST /v2/{account_id}/users/me/relation-requests` |
| `GET /users/invite/sent` (check-invitation-status) | `GET /v2/{account_id}/users/me/relation-requests` (direction sent) |
| `POST /emails` (sequence-send-email, agent-tools) | `POST /v2/{account_id}/emails/send` — 🎁 options `tracking.open`/`tracking.click` natives |

### Étape C — profils & recherche (`unipile-search` action search/get_profile/get_parameters, `score-profile-job`, `screen-candidate`, `_shared/profile-enrichment.ts`, `_shared/profile-data.ts`, `resolve-pedigree-directory`, `generate-outreach-message`)
| Usage v1 | v2 |
|---|---|
| `GET /users/{id}?linkedin_api=recruiter` | `GET /v2/{account_id}/users/{user_id}?with_sections=linkedin_experience,linkedin_education,linkedin_skills,linkedin_languages,linkedin_certifications` ⚠️ objet restructuré : top-level générique + `specifics` + sections — réécrire la normalisation |
| `POST /linkedin/search` (api=classic) | `POST /v2/{account_id}/linkedin/search/people` (+ `/companies`, `/jobs`, `/posts`, search-from-URL) |
| `POST /linkedin/search` (api=recruiter) | `POST /v2/{account_id}/linkedin/recruiter/search/people` — 🎁 `save_search` (liée à un project), `load_saved_search` (`new_results_only`), `postal_code`+radius, préf `OPEN_TO_WORK` |
| `POST /linkedin/search` (api=sales_navigator) | `POST /v2/{account_id}/linkedin/sales-navigator/search/people` (+ `/companies`, lead-lists, account-lists) |
| `GET /linkedin/search/parameters` | `GET /v2/{account_id}/linkedin/{search\|recruiter/search\|sales-navigator/search}/parameters` (par licence) |
| `GET /users/{id}/posts` | `GET /v2/{account_id}/users/{user_id}/posts` |
| `POST /linkedin/profile/endorse` | `POST /v2/{account_id}/linkedin/member/{member_id}/endorse-skill` |

### Étape D — nettoyage
- Supprimer les branches v1 + `UNIPILE_API_KEY`/`UNIPILE_DSN`, colonnes
  `organization_integrations.unipile_dsn` (migration SQL), webhooks v1, résolveurs locaux
  dupliqués. Mettre à jour `CLAUDE.md` (gotcha DSN obsolète) et `n8n-create-workflow`
  (code n8n généré avec URL v1 en dur, L138-153).

## Opportunités produit v2 (post-migration)

- **Read receipts séquences** (`message.receipt.read`) — timing de relance, stats réelles.
- **Tracking email natif** (`tracking.open`/`tracking.click` sur `/emails/send`) + bounces.
- **Visite de profil** (`POST /v2/{account_id}/users/visit-profile`) — étape de warm-up.
- **Recruiter profond** : hiring projects CRUD, pipeline (`.../recruiter/projects/{id}/pipeline`),
  talent-pool search, candidats + CV téléchargeables.
- **Job postings** : créer/publier/clôturer des offres LinkedIn, récupérer candidats + CV.
- **Sales Navigator** : lead lists / account lists (lecture + save).
- **UX connexion** : `account.initial_sync.completed` + `wait_initial_sync` (hosted auth).

## Garde-fous

- Ne PAS mélanger clé v1 et endpoints v2 (401 garanti). Ne PAS écraser
  `UNIPILE_API_KEY`/`UNIPILE_DSN` tant que des fonctions v1 tournent.
- Chaque fonction migrée : passer par `_shared/unipile-v2.ts`, jamais d'URL à la main.
- Vendor branding : « Unipile » ne doit jamais apparaître côté UI (règle CLAUDE.md).
- QA (`.claude/skills/qa.md`) obligatoire avant merge de chaque étape — edge functions
  critiques + flow client final touchés.
