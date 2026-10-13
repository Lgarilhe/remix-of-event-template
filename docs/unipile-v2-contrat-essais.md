# Essais de contrat avec le vrai service (12 octobre 2026)

Compte rendu des essais de la partie 10 de `docs/unipile-v2-architecture.md`, joués contre l'API réelle (`https://api.unipile.com/v2`) avec la clé d'essai de l'application « Development » (0 compte relié). Aucun compte relié, aucun message envoyé. Une quarantaine d'appels sur 100 permis. Ni clé, ni jeton, ni secret n'est reproduit ici ni dans les fixtures.

Verdicts : confirmé (le service fait ce que le code suppose), différent (le service fait autre chose), non concluant (l'essai n'a pas permis de trancher).

## Écart avec la consigne

La consigne demandait des ressources sur `https://example.invalid/...`. Le service refuse un point de réception dont le nom d'hôte ne se résout pas (400, « Webhook endpoint URL hostname could not be resolved »). Les deux points de réception d'essai ont donc été créés sur `https://example.com/essai-contrat-konekt`. Sans compte relié, aucun événement ne pouvait y être livré. Les deux ont été supprimés (réponse `{"success":true}`), et la liste des points de réception est revenue vide.

## Résultats par ligne

| # | Hypothèse | Réponse réelle | Verdict |
|---|---|---|---|
| 5 (fin) | `classifyError` classe par statut ; corps d'erreur de forme supposée | Compte `acc_` inexistant : 404, `api/resource_not_found`, titre « Account not found ». Corps invalide : 400, `api/invalid_parameters`, titre « Invalid body », avec un champ `detail` qui nomme la propriété manquante. Paramètre mal formé : 400, titre « Invalid params ». Trop de requêtes : 429, `api/too_many_requests`, « Please retry later. », avec `Retry-After` en secondes. Tous les corps portent `req_id`, égal à l'en-tête `X-Request-Id`. Classement par `classifyError` : `not_found`, `validation`, `rate_limited`. | Confirmé pour le classement. Forme des corps différente de `error-presets.json` (voir plus bas). Les autres cas de la ligne (mauvais mot de passe, cookie, code, limite hebdomadaire, conversation en lecture seule, plus de crédits InMail) exigent un compte : non joués. |
| 6 | Contenu des notifications autres que `message.new` | Aucune livraison possible sans compte. Le service accepte `relation.new` et `account.add` comme événements d'un point de réception, et refuse un événement hors liste (400, « must be equal to one of the allowed values »). | Non concluant pour le contenu. Confirmé pour la liste fermée d'événements. |
| 8 | Signature de livraison non utilisée, le jeton de l'adresse suffit | La création d'un point de réception rend un champ `secret` (préfixe `wes_`), rendu aussi par la liste. Le client le retire déjà (`redactEndpoint`). | Différent : le service fournit un secret de signature. Le nom de l'en-tête de signature d'une livraison n'a pas pu être observé (aucune livraison). À étudier avant de décider de le vérifier. |
| 17 | Étapes de la connexion directe | Exige un compte et des identifiants réels : non joué. Le lien hébergé (ligne 18) répond 200. | Non concluant |
| 18 | Contenu de la page hébergée | `POST /v2/auth/link` (avec `expires_on`, `providers`, `redirect_uri`, `state`, sans `domain`) rend 200, `{"object":"HostedAuthLink","link":"https://auth.unipile.com/?token=..."}`. Le réseau de la session refuse l'hôte `auth.unipile.com` (403 du relais), la page n'a pas pu être ouverte. | Non concluant. Constat acquis : sans le champ `domain`, l'adresse du lien est sur le domaine du prestataire. Contrôle de la page à faire par le propriétaire, ou hôte à autoriser dans l'environnement (voir plus bas). |
| 19 | Limites de débit | Non demandée dans cette série. Relevé en passant : la création d'un point de réception répond avec `X-Ratelimit-Limit: 10` et `X-Ratelimit-Reset: 60` (10 par minute), une requête invalide comprise ; `POST /auth/link` annonce 30 par minute. Les lectures ne portent pas ces en-têtes. | Partiel |
| 20 | Le filtre `event_id` est-il honoré ? Rétention du journal | `GET /webhooks/conversations/` sans `endpoint_id` : 400, « must have required property 'endpoint_id' » (confirmé obligatoire). Avec `endpoint_id` : 200, liste vide. Avec `event_id` inconnu : 200, liste vide, pas d'erreur. `POST /webhooks/events/evt_inexistant0000/replay` : 404, « Event not found ». | `endpoint_id` obligatoire : confirmé. `event_id` accepté sans erreur, mais un filtre honoré ne se distingue pas d'un journal vide : non concluant. Rétention : non concluant. |
| 23 | Reprise d'un point de réception existant au `register` | Deux `POST /webhooks/endpoints/` avec la même adresse créent deux points distincts (deux identifiants `we_`), sans erreur. `PATCH` met à jour sur place (même identifiant, événements modifiés). `DELETE` rend `{"success":true}`. | Confirmé : le service ne reprend rien de lui-même, la reprise dépend entièrement de `planEndpointSync` et de la mise à jour sur place. Le premier `register` en production ne doublera pas le point existant seulement si son adresse (hôte et chemin) est identique : toujours à vérifier avec l'adresse réelle. |
| 24 | Clé d'application entière | `GET /v2/accounts/` répond 200, `{"object":"Accounts","data":[],"has_more":false}`. Les points de réception de l'application sont visibles et portent `application_id`. | Confirmé pour une clé d'application (0 compte, point de réception d'application visibles). Une clé de niveau compte n'a pas été essayée. |

## Erreurs sans clé valide (relevé précédent)

Même forme de corps (`object`, `status`, `type`, `title`, `req_id`). Sans clé : 401, `api/missing_authorization`. Clé fausse : 401, `api/invalid_credentials`, y compris sur un `acc_` inexistant (la clé est contrôlée avant la recherche du compte). Route inconnue : 404, `api/resource_not_found`, « Route Not Found », avant le contrôle de la clé. Les `req_id` de ce relevé n'ont pas été conservés.

## Fixtures et test

`tests/fixtures/unipile-v2/real-errors.json` rassemble ces réponses réelles (quinze). Le test de `supabase/functions/_shared/unipile/errors.test.ts` les relit : `classifyError` rend `auth` pour les 401, `not_found` pour les 404, `validation` pour les 400 et `rate_limited` pour le 429 ; `code` égale le `type` en minuscules ; le message affiché ne nomme ni le prestataire ni la clé. Il passe sans modifier le code.

Les corps de `error-presets.json` (forme `errors/...`) restent une supposition qui diffère du réel : le vrai `type` est `api/...` et `detail` est une phrase de validation. Ils ne sont pas remplacés ici : 403 et 422 n'ont pas été observés, seuls 400, 401, 404 et 429 l'ont été. Aucun correctif du client n'a été nécessaire, aucun écart ne change un classement.

## Non joué : exige un compte

Lignes 1 à 4, 7, 9 à 16, 21, 22, 25 et 26, ainsi que la fin de la ligne 5 (mauvais mot de passe, cookie, code, intention expirée, déjà connecté ailleurs, déjà en relation, déjà invité, limite hebdomadaire, conversation en lecture seule, plus de crédits InMail). Elles demandent un compte LinkedIn, une messagerie ou un numéro relié à l'application Development.

## À faire par le propriétaire

1. Supprimer la clé d'essai : tableau de bord du prestataire, application « Development », page « API Keys ».
2. Retirer la ligne du secret dans les réglages de l'environnement de la session.
3. Pour la ligne 18, soit ouvrir lui-même un lien de connexion hébergé et noter ce qui s'affiche (nom du prestataire, logo, textes, liens), soit autoriser l'hôte `auth.unipile.com` dans l'accès réseau de l'environnement.
