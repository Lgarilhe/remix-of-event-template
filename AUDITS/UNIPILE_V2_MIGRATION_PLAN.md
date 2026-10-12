# Plan de migration Unipile API v1 → v2 — Konekt

> Rédigé le 2026-07-20 (branche `claude/unipile-v2-migration-m1d5gj`).
> Source de vérité API v2 : spec OpenAPI officiel embarqué dans le SDK `@unipile/sdk@2.21.0`
> (npm, publié 2026-07-13) + docs https://developer.unipile.com/v2.0/docs/welcome.
> Cartographie v1 du code : voir aussi `AUDITS/EDGE_FUNCTIONS_UNIPILE_AUDIT_2026-06-10.md`.

## État au 2026-10-12 (remplace les sections « fait dans ce commit », « checklist d'activation » et « reste à faire » ci-dessous, gardées pour l'historique)

> La stratégie « strangler » (v1 par défaut, v2 en option) est abandonnée. Le code de la branche `ccr-6c73a178-thbl61` n'utilise plus que l'API v2, sans repli. La branche **n'est pas fusionnée** : sa fusion déploie un code qui n'accepte que les identifiants `acc_...` et casse la messagerie tant que les secrets et la conversion ne sont pas faits. Déroulement complet, pour le propriétaire : `docs/unipile-v2-bascule.md`. Architecture : `docs/unipile-v2-architecture.md`.

**Fait** (commits `7c1e042`, `1cbb8ec`, `1bcdac6`, `67c8953`, `9c1f537`, puis la vague 4c jusqu'à `8269b17` ; relevé dans le code le 2026-10-12)
- Étapes A (comptes et connexion), B (messagerie, InMails, invitations, e-mails) et C (profils, recherche par licence) : toutes les fonctions passent par le client unique `supabase/functions/_shared/unipile/`. `_shared/unipile-v2.ts` est supprimé. Aucun `/api/v1`, `UNIPILE_DSN` ni `fetch` direct vers le prestataire (garde `tests/c1/unipile-client.test.mjs`).
- Étape D (nettoyage) : faite pour le code (résolveur d'identifiants par organisation supprimé, section DSN de `CLAUDE.md` réécrite). **Reste** : colonnes `organization_integrations.unipile_*`, secrets `UNIPILE_API_KEY` et `UNIPILE_DSN`, anciennes notifications chez le prestataire (voir ci-dessous).
- Notifications : un seul point de réception v2 (17 événements), jeton `?v2_token=`, dédoublonnage sur le type brut et l'identifiant d'événement, journal des livraisons et rejeu.
- Connexion : lien hébergé sur un domaine à la marque (`UNIPILE_HOSTED_DOMAIN`), table `connection_attempts`, page de retour, connexion directe écrite mais éteinte (`CONNECTION_NATIVE_ENABLED`).
- Outil de bascule des identifiants : fonction `unipile-migration`, page `/settings/admin/bascule`, migration `20261012051307_provider_account_id_remap.sql` (conversion par compte, sauvegarde, annulation), audits SQL câblés dans `e2e.yml`. Le plan prévoyait une fenêtre à deux identifiants : elle n'a pas été construite.
- Nouveautés : recherche à partir d'une adresse collée, projets Recruiter, choix du contrat, invitations envoyées avec retrait, journal de livraisons. Lecture d'agenda : module client seulement, aucune fonction.
- Tests : faux prestataire v2 (`e2e/local-stack/vendor-mock.mjs`), 39 specs d'API portées (`e2e/api/`). Dernière exécution complète (environ 22 minutes) : 552 réussis, 1 échec, 1 non joué, 0 violation du faux prestataire. L'échec était le test « au plus 15 étapes invisibles... » de `seq-engine-1.spec.ts`, causé par le double comptage d'une visite de profil (architecture, partie 11, point 1), corrigé au commit `6c1598f` ; ce test seul, rejoué le 2026-10-12 après la correction, est vert (0 violation). L'exécution complète n'a pas été refaite depuis la correction, et le test non joué non plus. Aucun test supprimé, ignoré ou affaibli pendant le port. Non joués : les projets Playwright de l'interface (aucun navigateur dans l'environnement).
- Revue indépendante du port des tests : deux changements de comportement à faire confirmer par le propriétaire, repris dans le guide (partie 5) : une réponse e-mail sur une boîte reliée à aucune organisation est acquittée sans clore d'inscription (ligne 18, elle clôturait avant par le repli sur le compte d'inscription), et un compte LinkedIn relié à personne ne peut plus être rattaché que par un administrateur de la plateforme (ligne 4).

**Relevé du tableau de bord du prestataire (2026-10-12, fait à la main par le propriétaire, lecture seule ; rien n'est confirmé par le code)**
- Trois applications. « Dashboard / Development » : 0 compte, 0 notification, 3 clés de service (« test » 02/06/2026, « Migration claude code » 21/07/2026, « Notion mcp » 26/07/2026), habillage de la page de connexion déjà réglé (nom Konekt, logo, #000000, forme Pill, police Roboto). « Dashboard / Production » : 0 compte, rien de configuré, réglages par défaut. **« Konekt app / Production » : l'application réelle**, 4 comptes (LinkedIn Laurent GARILHE opérationnel, Outlook l.garilhe@konekt.fr opérationnel, LinkedIn Guillaume Valladier à authentifier, un numéro WhatsApp à authentifier sans ligne dans la base de Konekt), 4 points de réception actifs et sans nom (trois vers l'hôte n8n du propriétaire, un vers le projet Supabase de Konekt avec 23 événements, liste plus ancienne que les 17 du code), clés de service « n8n », « Linkedin - Unipile », « Notion - mcp », « Jarvis », clés de niveau compte « konekt-edge-prod » (deux, 24/09/2026) et trois clés Outlook (05/10/2026), habillage aux réglages par défaut (nom et logo vides, #000000, forme Rounded, police system-ui).
- Aucun domaine personnalisé vérifié nulle part ; liens d'aide, de confidentialité et de conditions vides partout.
- La base de production de Konekt liste 5 comptes LinkedIn et 1 boîte e-mail : environ 3 comptes LinkedIn de Konekt manquent dans l'application v2.
- Conséquences, détaillées dans `docs/unipile-v2-bascule.md` : application à utiliser et contrôle de la clé posée (le propriétaire ne crée ni ne supprime de clé), habillage à recopier de Development vers « Konekt app / Production » avec les trois liens, deux options de lancement de l'adresse de la page (domaine vérifié, ou d'abord adresse du prestataire avec `CONNECTION_ALLOW_VENDOR_HOSTED_LINK=1`, choix temporaire), mise à jour du point de réception existant par `register` sans toucher aux trois points n8n, contrôle obligatoire de la fonction `jarvis-whatsapp` (hors dépôt) avant tout retrait de `UNIPILE_API_KEY` et `UNIPILE_DSN`, comptes à reconnecter (les deux affichés et environ 3 LinkedIn absents), numéro WhatsApp hors Konekt.

**Reste à faire**
1. Essai avec une vraie clé v2, hors production : aucun test de contrat réel n'existe. Liste des points à confirmer : `docs/unipile-v2-architecture.md`, partie 10 (formats d'identifiants de personnes, corps d'erreur, contenus de notifications, continuité des identifiants de conversation et de message, projets Recruiter, étapes de connexion directe...).
2. Page de connexion : recopier l'habillage de Development vers « Konekt app / Production » et renseigner les trois liens ; choisir l'option A (adresse du prestataire avec l'habillage, `CONNECTION_ALLOW_VENDOR_HOSTED_LINK=1`, temporaire) ou B (domaine vérifié : enregistrement DNS, vérification chez le prestataire, secret `UNIPILE_HOSTED_DOMAIN`) ; contrôle des yeux de ce que montre la page (la mise en page ne se modifie pas depuis le code). Si l'option A est gardée, corriger les commentaires du code qui la disent réservée aux tests.
3. Secrets : `UNIPILE_V2_API_KEY` (probablement déjà posé : à contrôler par le nombre de comptes que la page de bascule voit, 4 attendus, sans créer ni supprimer de clé), `UNIPILE_V2_WEBHOOK_TOKEN`, `UNIPILE_HOSTED_DOMAIN` (option B) ou `CONNECTION_ALLOW_VENDOR_HOSTED_LINK` (option A), `KONEKT_PLATFORM_ADMIN_USER_IDS`.
4. Mise en production, dans l'ordre du guide : moteurs en pause, fusion, notifications (mise à jour du point de réception existant de Konekt), vérification, comptes absents du service (environ 3 LinkedIn de Konekt, plus Guillaume Valladier à reconnecter), simulation, conversion, reprise des moteurs, surveillance de 24 h, retrait des anciennes notifications puis des anciens secrets, ces derniers seulement après le contrôle de `jarvis-whatsapp`.
5. Décisions produit ouvertes (22 ouvertes et 1 réglée, tableau de la partie 5 du guide) : retrait d'une invitation et étape d'attente, recherche Recruiter par projet, solde et signature d'InMail par licence, rattachement d'un compte non relié (réservé aux administrateurs de la plateforme), reconnexion depuis l'extension, adresse de support, agents de sourcing à recalibrer, propositions de l'assistant en attente, identifiants de conversation non convertis, lectures de l'équipe, filtres non représentables, historiques Outlook, définition d'une réponse, annuaire des entreprises, état « partiel », limites v2, réponse e-mail sur une boîte reliée à aucune organisation, compte supprimé chez le prestataire, rejeu des notifications sans limite ni trace durable, report sans plafond des InMails d'un compte dégradé, conversion partielle non bloquante, enrichissement toujours en pause. Réglée : le plafond de vues (ligne 17).
6. Défauts connus à corriger (architecture, partie 11) : `filters_dropped` jamais affiché ; texte de l'extension devenu faux ; code mort de reconnexion de l'extension ; tests Deno hors CI ; retour de connexion perdu après une session expirée (`ProtectedRoute`) ; libellé anglais « Hiring Project (ID) » ; source de registre `manual_invitations` qui repousse les InMails de 5 minutes ; cache négatif des résolveurs d'identifiants d'organisation (antérieur à la v2) ; garde du courrier envoyé depuis un alias. Corrigé : la double comptée d'une visite de profil (`6c1598f`).
7. Plus tard : suppression des colonnes `organization_integrations.unipile_*`, fermeture définitive de l'ancien tableau de bord (pas avant le contrôle de `jarvis-whatsapp` et des workflows n8n du propriétaire, qui appellent l'API du prestataire avec leur propre clé et sont hors du périmètre de la bascule), passage de l'option A à l'option B pour l'adresse de la page de connexion, connexion directe et connexion Google/Microsoft avec les applications propres de Konekt (décision sur la confidentialité des mots de passe LinkedIn saisis dans Konekt).

## Contexte & état des lieux

> Section historique, état au 2026-07-20.

- **Côté plateforme Unipile : migré.** Compte v2 créé (Dashboard V2), données migrées.
- **Côté code Konekt : 100 % v1 au 2026-07-20 (n'est plus vrai sur la branche, voir « État au 2026-10-12 »).** `/api/v1` est codé en dur dans ~40 fichiers d'edge
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
| `new_relation` | `relation.new` (`relation.request.accept` retiré par Unipile, absent du SDK 2.48.0) | ✅ aliasé |
| `message_received` / `new_message` | `message.new` | ✅ aliasé |
| `mail_received` / `new_email` | `email.new` | ✅ aliasé |
| `account_connected` (hosted auth, state dans `name`) | `account.add` / `account.reconnect` (state dans champ `state`) | ✅ aliasé + fallback `state` |
| `account_status_updated` (status dans payload) | `account.status.running` / `.degraded` / `.partial` (status dans le NOM de l'event ; `.paused` retiré par Unipile) | ✅ aliasé, status imposé par le nom (`running`→`OK`, `degraded`→`DEGRADED`, `partial`→`PARTIAL`) |
| — | `account.locked` / `account.unlocked` (drapeau `is_locked`) | ✅ handlers dédiés : `LOCKED` sans écraser `CREDENTIALS`/`ERROR`, retour à `OK` seulement depuis `LOCKED` (2026-09-24) |
| `account_disconnected` | `account.status.disconnected`, `account.remove` | ✅ aliasé |
| `account_error` | `account.status.errored` | ✅ aliasé |
| `mail_opened` (email_tracking) | `tracking.open` | ⚠️ non traité (tombe en `default` log — comme en v1) |
| — (nouveaux) | `message.receipt.read`, `message.receipt.delivery`, `message.reaction.new`, `email.new.bounce`, `tracking.click`, `account.initial_sync.*`, `chat.update/delete` | 🎁 opportunités produit (read receipts séquences, bounces → suppression list, sync UX) |

⚠️ **Les payloads v2 n'ont pas pu être validés** (docs bloquées depuis l'environnement de
dev, le SDK ne couvre que le REST). Les handlers v1 sont tolérants multi-format, mais il
faudra **observer les logs des premiers events v2 réels** (`v2_origin:` dans les logs de
`unipile-webhook`) et ajuster le parsing si besoin.

## Fait dans ce commit (socle) [historique, remplacé]

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

> Mise à jour du 2026-10-12 : le relevé fait à la main par le propriétaire (voir « État au 2026-10-12 ») remplace cet inventaire. Il ne contient plus de doublon Outlook ; Guillaume Valladier, absent en juillet, est présent et à authentifier ; un numéro WhatsApp à authentifier est présent sans ligne dans la base de Konekt. Tiago BRITO n'est pas cité dans le relevé d'octobre. La page de bascule (`/settings/admin/bascule`) recalcule le rapprochement réel. Le tableau ci-dessous est gardé pour l'historique.

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

Notes (mises à jour 2026-07-21 après vérifications complémentaires) :
- **Recruiter : RÉSOLU le 2026-07-21.** En v2 chaque produit LinkedIn (classic /
  recruiter / sales_navigator / company) se connecte séparément, et la migration n'avait
  activé que classic+company. Fix appliqué : lien de reconnexion hébergé généré via
  `POST /v2/auth/link` avec `config.linkedin.products = ["classic","recruiter","company"]`
  (⚠️ sans ce champ, le wizard ne propose QUE les produits déjà connectés), flow complété
  par Laurent, contrat **KONEKT-RPS** (`RECRUITER_269193796`) sélectionné. Vérifié
  fonctionnellement : `POST /v2/{acc}/linkedin/recruiter/search/people` renvoie de vrais
  profils `product: "recruiter"` en visibilité full. Notes : (1) la métadonnée
  `products_connection_status` du compte peut rester en retard sur l'état réel — se fier
  aux appels fonctionnels ; (2) recruiter et sales_navigator sont EXCLUSIFS sur un même
  compte en v2 ; (3) les liens hosted auth sont à usage/instance unique — toujours
  regénérer plutôt que réutiliser.
- **Correction mapping Outlook** : le doublon supprimé par Laurent (2026-07-21) était
  `acc_01kxnygmxwencssf1vz63t7ntk` — celui dont le `v1_account_id` (`BJMqT1aKSBerrkX8lbO1lQ`)
  correspondait à la ligne `member_email_accounts`. Le survivant est
  `acc_01kxnygk59e8q8299hkqz5ty42` (même boîte l.garilhe@konekt.fr, running, mais
  `v1_account_id` = `8_Dq-UL0...` inconnu de la base). → Au cutover, mapper l'Outlook
  **par adresse email**, pas par metadata : `BJMqT1aKSBerrkX8lbO1lQ` →
  `acc_01kxnygk59e8q8299hkqz5ty42`.
- ⚠️ Ne PAS remapper les IDs en base tant que les fonctions v1 tournent (elles utilisent
  les IDs v1). Stratégie transition : table de correspondance `v1_id → v2_id` consommée
  par les fonctions migrées, puis UPDATE final des colonnes `*_account_id` au cutover.

## Checklist d'activation (actions Laurent) [historique, remplacée par `docs/unipile-v2-bascule.md`]

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

## Ordre de bascule recommandé [historique : étapes A à D faites dans le code, voir « État au 2026-10-12 »]

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

## Garde-fous [historique : `_shared/unipile-v2.ts` n'existe plus ; la règle « jamais d'URL à la main » est tenue par `tests/c1/unipile-client.test.mjs`]

- Ne PAS mélanger clé v1 et endpoints v2 (401 garanti). Ne PAS écraser
  `UNIPILE_API_KEY`/`UNIPILE_DSN` tant que des fonctions v1 tournent.
- Chaque fonction migrée : passer par `_shared/unipile-v2.ts`, jamais d'URL à la main.
- Vendor branding : « Unipile » ne doit jamais apparaître côté UI (règle CLAUDE.md).
- QA (`.claude/skills/qa.md`) obligatoire avant merge de chaque étape — edge functions
  critiques + flow client final touchés.
