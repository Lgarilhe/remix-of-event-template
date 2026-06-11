# e2e Konekt — guide rapide

Suite Playwright. Architecture et stratégie complètes : `AUDITS/QA_PLAYWRIGHT_PLAN_2026-06-11.md`.

## Lancer en local

Il faut un environnement Supabase de **test** (jamais la prod). Le plus simple :

```bash
# 1. Stack Supabase locale (Postgres + Auth + edge runtime + RLS identiques à la prod)
supabase start
supabase status -o env   # récupère API_URL / ANON_KEY / SERVICE_ROLE_KEY

# 2. Variables e2e (exemple avec la stack locale)
export E2E_SUPABASE_URL="http://127.0.0.1:54321"
export E2E_SUPABASE_ANON_KEY="<anon de supabase status>"
export E2E_SUPABASE_SERVICE_ROLE_KEY="<service_role de supabase status>"
export E2E_BASE_URL="http://localhost:8080"
export E2E_ALLOW_SEEDING=1     # confirme que la cible est jetable

# 3. Front pointant vers la même stack
VITE_SUPABASE_URL="$E2E_SUPABASE_URL" VITE_SUPABASE_PUBLISHABLE_KEY="$E2E_SUPABASE_ANON_KEY" npm run dev -- --port 8080

# 4. Tests
npm run test:e2e                 # tout (hors @live)
npm run test:e2e:critical        # @critical seulement
npm run test:e2e:api             # API directe (RLS, quota gate)
npm run test:e2e:ui              # mode interactif
```

## Garde-fous

- `guard-prod.ts` **refuse** de tourner si la cible ressemble à la prod (`crckfywoyjxkawathdff`)
  ou si `E2E_ALLOW_SEEDING` n'est pas à `1`.
- Les vendors (Unipile, Apollo, Anthropic) sont **mockés** par défaut (`mockVendors`). La suite
  réelle est taguée `@live` et exclue sauf `E2E_RUN_LIVE=1`.

## Tags

`@critical` (bloquant CI) · `@smoke` · `@mobile` · `@live` (vrais vendors, nightly).

## Structure

```
e2e/
├── global.setup.ts      # crée 4 orgs/users de référence + storageState par rôle
├── fixtures/            # test étendu : mockVendors, org jetable, asRole()
├── helpers/             # env, garde-prod, client admin Supabase, registry des rôles
├── mocks/               # payloads vendors figés
├── api/                 # tests d'API directs : rls.spec, quota-gate.spec
├── flows/               # specs UI : multi-tenant, sourcing, smoke authed
└── mobile.spec.ts       # iPhone 13 (persona Sophie)
```

## Agents Playwright (génération assistée)

Voir `AUDITS/QA_PLAYWRIGHT_PLAN_2026-06-11.md` §5. En bref :

```bash
npx playwright init-agents --loop=claude   # définitions planner/generator/healer
claude mcp add playwright npx '@playwright/mcp@latest'
```

Le **Planner** explore l'app et écrit un plan Markdown dans `e2e/specs/`, le **Generator** le
transforme en specs, le **Healer** répare — mais ne masque jamais un vrai bug (il remonte un
finding plutôt que de neutraliser une assertion).
