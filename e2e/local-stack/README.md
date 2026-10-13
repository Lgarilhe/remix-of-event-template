# Stack locale pour les tests e2e

`supabase start` ne tourne pas partout : le conteneur temps réel exige IPv6, et les registres d'images limitent les téléchargements anonymes. Ce dossier monte la même stack sans la CLI, avec en plus les edge functions et de faux prestataires. Il sert aux tests qui font tourner le moteur de séquences et les actions candidat pour de vrai.

## Ce qui tourne

| Service | Port | Source |
|---|---|---|
| Postgres 17 | 54322 | image `supabase/postgres` (celle de la CLI), migrations du dépôt rejouées avec le rôle `postgres` |
| Auth | 9999 | binaire de la release GitHub `supabase/auth` |
| API REST | 3000 | image `postgrest/postgrest` |
| Passerelle | 54321 | `gateway.mjs` : `/rest/v1`, `/auth/v1`, `/functions/v1` |
| Edge functions | 54331 | `functions-server.ts`, Deno, chargement à la demande |
| Faux prestataires | 54340 | `vendor-mock.mjs` |

Les tables du stockage sont créées vides à la main : le service de stockage n'est pas lancé.

## Aucun appel sortant

`functions-server.ts` redirige tout `fetch` vers un hôte autre que `127.0.0.1` ou `localhost` vers `vendor-mock.mjs` (chemin et requête conservés, hôte d'origine dans l'en-tête `x-original-host`). Le faux prestataire journalise chaque appel et répond par un succès : envoi de message, demande de relation, profil au premier degré, réponse de l'IA. Un test lit ce journal pour vérifier ce qui serait parti.

### LinkedIn : API v2 seulement

Le faux fournisseur LinkedIn ne parle que l'API v2 : hôte `api.unipile.com`, clé `X-API-KEY` (`e2e-test-key`), chemins `/v2/{acc_...}/...` pour un compte, `/v2/accounts`, `/v2/auth/*` et `/v2/webhooks/*` pour l'application. Les réponses suivent la spécification OpenAPI (identifiants `acc_` + 26 caractères, `ChatStarted` et `MessageSent` en 200, `RelationRequest` en 201, `message_id` chaîne, tableau ou nul). Ce que la spécification ne dit pas (corps d'erreur, identifiants de conversation, d'inbox et de message, clés des produits d'un compte) est inventé et marqué « supposé » dans le code.

Rien de l'ancienne API n'est servi. Un appel vers `/api/v1` répond 599 et est consigné comme violation `v1_call` ; un hôte `*unipile*` autre que `api.unipile.com`, une clé absente ou fausse, un identifiant de compte hors `acc_...`, une route v2 inconnue (501) et un corps hors contrat (422) sont consignés de même. Les chemins `/api/v1` d'autres fournisseurs ne comptent pas. `VENDOR_MOCK_STRICT_V1=0` consigne sans refuser.

Surface de contrôle (HTTP sur le port 54340) :

- `GET /__log?account_id=<compte>` : appels d'un compte, ce qui isole les tests entre eux. Chaque ligne porte `op` (operationId de la spécification), `api` (`v2`), `status` et, si le corps sort du contrat, `contract.violations` ;
- `DELETE /__log` : remet tout à zéro (journal, modes, violations, envois, comptes, points de contrôle, endpoints de webhook) ;
- `GET /__violations?account_id=<compte>&kind=<genre>` et `DELETE /__violations` : violations ;
- `POST /__mode` avec `{"<compte>": {...}}` : comportement d'un compte. `fail_send` (statut) fait échouer les envois de message, de demande de relation et d'e-mail ; `distance` règle `specifics.network_distance` du profil ; `licenses`, `inmail_credits`, `contracts`, `message_id_shape`, `status`, `locked`, `allow_when_locked`, `strict_accounts`, `any_visit_token`, `missing`, `invitation_pending`, `search_results`, `profile_sections` ; `routes` scripte des réponses (sélecteurs `op`, `method`, `path`, `url`, réglages `status`, `body`, `preset`, `headers`, `delay_ms`, `times`, `network_error`) ; `error` injecte une erreur (statut et corps libres, ou `preset`) sur toute la surface du compte ou sur certaines opérations. Les `preset` viennent de `tests/fixtures/unipile-v2/error-presets.json`, dont les corps portent le nom du fournisseur à dessein, pour vérifier qu'il ne remonte jamais à un utilisateur ;
- `POST /__fire` : fabrique une enveloppe de webhook v2 (`id` `evt_...`, `type`, `created_at`, `account_id`, `account_name`, `account_provider`, `application_id`, `payload`) et la poste sur `unipile-webhook` avec `?v2_token=`. Un `id` déjà utilisé rejoue le même événement. `retries` (et `retry_delay_ms`) rejoue la même enveloppe avec `first_attempt` faux tant que le récepteur répond 5xx, comme le fournisseur. Les charges par défaut sont celles de la seule capture réelle (`message.new`) ou de la spécification. `GET /__deliveries` rend les envois ;
- `POST /__auth_script` : points de contrôle de `/v2/auth/intent` (code reçu, double authentification, validation dans l'application, captcha, choix de contrat...), puis compte créé. Voir l'en-tête de `vendor-mock.mjs`.

Les helpers `e2e/helpers/sequence-engine.ts` (`mockCalls`, `callsOf`, `recipientOf`, `inmailOf`, `routes`, `v2`, `webhook`, `fireWebhook`, `mockViolations`) évitent d'écrire un chemin ou une clé de corps du fournisseur dans une spec.

Les imports `esm.sh` et `deno.land` des fonctions sont remplacés par leurs équivalents npm (`import_map.json`), parce que ces hôtes sont souvent bloqués dans les environnements de test.

Un compte retiré répond 404, un compte verrouillé ou déconnecté 403 (`allow_when_locked` pour lire malgré tout), un intent d'authentification non terminé n'est pas un compte, et le contrat refuse un paramètre de requête inconnu, une taille de page hors bornes, un jeton de visite que le compte n'a pas reçu d'un profil, un InMail après la création de la conversation, un suivi d'e-mail sans `html`.

Garde du faux prestataire : `node --test tests/ux/vendor-mock-v2.test.mjs e2e/local-stack/vendor-mock-contract.test.mjs` (démarre le faux prestataire sur un port libre, aucune pile requise).

Contrôle de fin de série : `node e2e/local-stack/check-violations.mjs` sort en erreur si le faux prestataire a consigné un appel de l'ancienne API (`v1_call`), un mauvais hôte, une mauvaise clé, un identifiant de compte hors `acc_...` ou une route inconnue (`unhandled`). Une fonction qui avale un 599 ou un 501 ne fait échouer aucun test : à lancer après `npx playwright test`.

## Utilisation

```bash
bash e2e/local-stack/up.sh                  # rejouable, ne refait que ce qui manque
set -a; . /tmp/konekt-e2e-stack/env; set +a
npm run dev -- --port 8080 &                # le front lit VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY
npx playwright test --project=api
npx playwright test --project=chromium-desktop
bash e2e/local-stack/down.sh                # --reset supprime aussi la base
```

Le fichier d'environnement pose `E2E_EDGE_FUNCTIONS=1`, `E2E_VENDOR_MOCK_URL`, `E2E_PROCESS_SEQUENCES_SECRET`, `E2E_UNIPILE_V2_API_KEY` et `E2E_UNIPILE_V2_WEBHOOK_TOKEN`. Sans ces variables, les tests qui en dépendent sont ignorés, et le motif affiché nomme celles qui manquent. Un fichier d'environnement écrit par une ancienne version de `up.sh` n'a pas le jeton v2 : relancer `up.sh`, puis relire le fichier (`set -a; . /tmp/konekt-e2e-stack/env; set +a`).

`E2E_OMIT_WEBHOOK_SECRET=1 bash e2e/local-stack/up.sh` démarre les fonctions sans `UNIPILE_WEBHOOK_SECRET`, avec le seul jeton v2 dédié (cas où le récepteur ne doit pas répondre 500 faute du secret historique).

Les fonctions reçoivent `UNIPILE_V2_API_KEY=e2e-test-key`, `UNIPILE_V2_WEBHOOK_TOKEN`, `UNIPILE_HOSTED_DOMAIN` et `UNIPILE_WEBHOOK_SECRET`. `UNIPILE_API_KEY` et `UNIPILE_DSN` ne sont plus posées, et `up.sh` comme `functions-server.ts` les retirent si le shell de l'appelant les exporte : une lecture oubliée de l'ancienne configuration doit échouer.

Le workflow `.github/workflows/candidate-actions.yml` lance cette stack sur les PR et les pushes vers `main` pour `e2e/api/candidate-actions.spec.ts`. Il reconstruit la base avec les migrations du dépôt, puis exécute les vrais handlers, avec Auth, RLS et RPC : brouillons persistants, validation explicite, envoi unique sous concurrence, résultat partiel, résultat inconnu sans renvoi, nouveau contexte, crédits et isolation entre recruteurs. Les envois et le modèle sont simulés par le faux prestataire. Ce contrôle refuse une suite ignorée ; il ne demande aucun secret de production. Les autres suites du moteur restent disponibles avec les commandes ci-dessus.

Prérequis : Docker, `psql`, Node, et Deno (ou `npx deno`). Les journaux et les pid sont dans `/tmp/konekt-e2e-stack` (variable `E2E_STACK_DIR`).
