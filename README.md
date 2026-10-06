# Konekt

Konekt est le poste de travail du chasseur de têtes : du brief au pipeline de candidats, la recherche et la prise de contact se font sur LinkedIn, dans l'outil, en français. Il s'adresse aux cabinets de recrutement, aux recruteurs indépendants et aux équipes internes qui font du sourcing sortant.

## Pile technique

- Frontend : Vite, React 18, TypeScript, Tailwind CSS, shadcn/ui, React Query, React Router.
- Backend : Supabase (Postgres avec RLS, Auth, Storage) et edge functions Deno dans `supabase/functions`.
- Hébergement : le frontend est déployé sur Vercel à partir de la branche `main`.
- Tests : Playwright pour les tests end-to-end, `node --test` pour les tests de sécurité de l'agent.

## Structure du dépôt

```
src/pages/               pages routées (Dashboard, Missions, Pipeline, Inbox, Settings...)
src/components/          composants React, par domaine (missions, outreach, candidates, settings...)
src/hooks/               hooks métier (useSourcingProjects, useLinkedInSearch, useOrganization...)
src/lib/                 utilitaires et règles transverses (featureGates, helpers)
src/integrations/        client Supabase et types générés depuis le schéma
supabase/functions/      edge functions Deno (une par dossier, code partagé dans _shared/)
supabase/migrations/     migrations SQL versionnées, appliquées dans l'ordre
e2e/                     tests Playwright (flows UI, tests API sur les edge functions et la RLS)
tests/agent/             tests unitaires des garde-fous de l'agent IA
extensions/chrome/       extension Chrome (badges pipeline et ajout rapide depuis LinkedIn)
docs/                    notes d'architecture, audits et revues produit
```

## Démarrage en local

Prérequis : Node.js 20 ou 22 et npm.

```sh
npm install
```

Créer un fichier `.env` à la racine avec les variables du projet Supabase à cibler :

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<clé publique>
```

Variables optionnelles : `VITE_SENTRY_DSN`, `VITE_PLAUSIBLE_DOMAIN`, `VITE_PLAUSIBLE_SRC`.

```sh
npm run dev
```

L'application est servie sur http://localhost:8080.

## Scripts npm

| Script | Rôle |
|--------|------|
| `npm run dev` | serveur de développement Vite |
| `npm run build` | build de production |
| `npm run build:dev` | build en mode développement |
| `npm run preview` | sert le build localement |
| `npm run lint` | ESLint sur tout le dépôt |
| `npm run test:agent` | tests des garde-fous de l'agent IA (`tests/agent/*.test.mjs`) |
| `npm run test:e2e` | suite Playwright complète |
| `npm run test:e2e:critical` | tests tagués `@critical` |
| `npm run test:e2e:api` | projet `api` seulement (edge functions et RLS, sans navigateur) |
| `npm run test:e2e:ui` | Playwright en mode interactif |
| `npm run test:e2e:install` | installe le navigateur Chromium pour Playwright |
| `npm run test:e2e:report` | ouvre le dernier rapport HTML |

## Contrôles

Avant de proposer une modification :

```sh
npx tsc --noEmit -p tsconfig.app.json
npx eslint .
npx vite build
npm run test:agent
```

Le type-check et le lint fonctionnent en mode cliquet : la CI compare le nombre d'erreurs de la PR avec celui de `main` sur le même runner et refuse toute augmentation. Le build de production est bloquant. Le `tsconfig.json` racine est de type solution et ne vérifie aucun fichier : toujours passer `-p tsconfig.app.json`.

### Tests end-to-end

Les tests Playwright tournent contre un environnement Supabase de test, jamais contre la production (`e2e/helpers/guard-prod.ts` refuse de démarrer si l'URL pointe vers le projet de production). Variables lues par `e2e/helpers/env.ts` et `playwright.config.ts` :

| Variable | Rôle |
|----------|------|
| `E2E_BASE_URL` | URL du frontend à tester (défaut : http://localhost:8080, le serveur Vite est lancé automatiquement sinon) |
| `E2E_SUPABASE_URL` | URL du projet Supabase de test (staging ou `supabase start`) |
| `E2E_SUPABASE_ANON_KEY` | clé anon de test |
| `E2E_SUPABASE_SERVICE_ROLE_KEY` | clé service role de test (seed et nettoyage des données) |
| `E2E_SUPABASE_PROJECT_REF` | ref du projet, déduite de l'URL si absente |
| `E2E_RUN_LIVE` | `1` pour inclure les tests `@live` qui appellent les services externes |

Projets Playwright : `setup` (authentification et seed), `chromium-desktop`, `mobile-safari` (specs `@mobile`) et `api`.

## Déploiement

- Frontend : chaque push sur `main` déclenche un déploiement Vercel. Le fichier `vercel.json` gère les rewrites de l'application monopage.
- Edge functions : `.github/workflows/deploy-edge-functions.yml` déploie sur push `main` les fonctions modifiées sous `supabase/functions/**`. Un déclenchement manuel accepte un nom de fonction, une liste ou `all`. Secret requis : `SUPABASE_ACCESS_TOKEN`.
- Migrations SQL : `.github/workflows/deploy-migrations.yml` applique `supabase db push` sur push `main` quand `supabase/migrations/**` change. Le déclenchement manuel propose `dry_run` et `repair_tracking` (réparation de la table de suivi, sans rejouer de DDL). Secrets requis : `SUPABASE_ACCESS_TOKEN` et `SUPABASE_DB_PASSWORD`.
- CI : `.github/workflows/ci.yml` (build, type-check, lint, tests agent, unicité des versions de migration) et `.github/workflows/e2e.yml` (tests `@critical` et `@smoke` sur chaque PR, suite complète chaque nuit) tournent sur les PR vers `main`.

Toute modification de schéma passe par un fichier dans `supabase/migrations/` avec un horodatage unique. Voir `CLAUDE.md` pour les règles détaillées.

## Sécurité

- Toutes les tables applicatives sont protégées par RLS ; les edge functions vérifient l'authentification et l'appartenance à l'organisation avant d'agir.
- Aucun secret dans le dépôt : les clés des services tiers sont des secrets Supabase (edge functions) ou GitHub (workflows) ; le frontend ne reçoit que la clé publique.
- Les noms des fournisseurs techniques (connexion LinkedIn, enrichissement, IA, envoi d'emails) n'apparaissent jamais dans une chaîne visible par l'utilisateur. Les seules exceptions sont les pages légales `/privacy` et `/privacy-extension`.
- Les tests end-to-end refusent de s'exécuter contre le projet de production.
