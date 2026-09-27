# Stack locale pour les tests e2e

`supabase start` ne tourne pas partout : le conteneur temps réel exige IPv6, et les registres d'images limitent les téléchargements anonymes. Ce dossier monte la même stack sans la CLI, avec en plus les edge functions et de faux prestataires. Il sert aux tests qui font tourner le moteur de séquences pour de vrai.

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

`functions-server.ts` redirige tout `fetch` vers un hôte autre que `127.0.0.1` ou `localhost` vers `vendor-mock.mjs`. Le faux prestataire journalise chaque appel et répond par un succès : envoi de message, invitation, profil au premier degré, réponse de l'IA. Un test lit ce journal pour vérifier ce qui serait parti :

- `GET /__log?account_id=<compte>` : appels d'un compte LinkedIn, ce qui isole les tests entre eux ;
- `POST /__mode` avec `{"<compte>": {"fail_send": 500}}` : fait échouer les envois de ce compte ;
- `DELETE /__log` : remet à zéro.

Les imports `esm.sh` et `deno.land` des fonctions sont remplacés par leurs équivalents npm (`import_map.json`), parce que ces hôtes sont souvent bloqués dans les environnements de test.

## Utilisation

```bash
bash e2e/local-stack/up.sh                  # rejouable, ne refait que ce qui manque
set -a; . /tmp/konekt-e2e-stack/env; set +a
npm run dev -- --port 8080 &                # le front lit VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY
npx playwright test --project=api
npx playwright test --project=chromium-desktop
bash e2e/local-stack/down.sh                # --reset supprime aussi la base
```

Le fichier d'environnement pose `E2E_EDGE_FUNCTIONS=1` et `E2E_VENDOR_MOCK_URL`. Sans ces variables, les tests qui en dépendent sont ignorés, comme dans la CI actuelle.

Prérequis : Docker, `psql`, Node, et Deno (ou `npx deno`). Les journaux et les pid sont dans `/tmp/konekt-e2e-stack` (variable `E2E_STACK_DIR`).
