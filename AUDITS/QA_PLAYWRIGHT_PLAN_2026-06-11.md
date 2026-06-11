# Plan de QA Playwright — Konekt (2026-06-11)

> Objectif : passer d'une couverture e2e symbolique (3 specs : landing, auth, routes protégées)
> à une **QA continue, déterministe et agentique** qui protège les flows critiques (sourcing
> LinkedIn, séquences, multi-tenant, crédits IA) avant chaque merge sur `main`.
>
> Ce plan articule **3 couches** : (1) un socle Playwright robuste, (2) une stratégie de données
> Supabase, (3) une boucle agentique Claude Code + Playwright Agents. Il prolonge le skill
> `/qa` (4 personas) qui reste la grille de lecture métier.

---

## 0. État des lieux

| Existant | Verdict |
|---|---|
| `playwright.config.ts` (chromium seul, webServer vite, trace on-first-retry) | ✅ base saine |
| `e2e/landing.spec.ts`, `auth.spec.ts`, `protected-routes.spec.ts` | ⚠️ smoke only, pas d'auth réelle |
| Skill `/qa` 4 personas (Guillaume/Claire/Théo/Sophie) | ✅ excellente grille métier, mais **exécutée à la main** |
| Aucun test des flows authentifiés (mission, sourcing, séquences, pipeline) | 🔴 angle mort total |
| Aucun mock des vendors (Unipile, Apollo, Anthropic) → tests non déterministes possibles | 🔴 |
| Pas de seed/téardown DB, pas de `storageState` | 🔴 |

Le cœur du risque (ce qu'on a corrigé cette semaine : quotas, double-envoi séquences, RLS,
crédits) **n'est couvert par aucun test automatique**. C'est la cible n°1.

---

## 1. Principes directeurs (best practices 2026)

1. **Fixtures plutôt que Page Objects lourds.** En 2026, les fixtures Playwright donnent la
   réutilisation et l'isolation sans la cérémonie des hiérarchies de classes. On crée des
   *fixtures* typées (`authedPage`, `org`, `seededMission`, `mockedUnipile`) injectées par test.
   Les Page Objects ne sont gardés que pour les écrans très riches (LinkedInSearch, BriefWizard).
2. **Isolation stricte.** Un contexte navigateur frais par test ; aucune dépendance d'ordre ;
   chaque test crée et nettoie ses propres données (org/user jetables).
3. **Déterminisme par défaut, réel en garde-fou.** Les vendors externes (Unipile, Apollo,
   Anthropic, Resend, Notion) sont **mockés via `page.route` / HAR** dans la suite principale —
   on teste *notre* logique, pas leurs serveurs. Une petite suite `@live` séparée tape les vrais
   services pour la confiance d'intégration (hors CI bloquant).
4. **Auth réelle via `storageState`.** On se connecte une fois par rôle en `globalSetup`
   (via l'API REST Supabase, pas l'UI), on sauvegarde l'état, on le réutilise — tests rapides.
5. **Tags + sharding.** `@smoke @critical @auth @mobile @live @flaky-watch` pour cibler ;
   sharding en CI, workers en local.
6. **Lisible = maintenable.** Locators par rôle/accessibilité (`getByRole`), jamais de CSS
   fragile ; assertions web-first (`toBeVisible`, auto-wait), zéro `waitForTimeout`.

---

## 2. Architecture cible du dossier `e2e/`

```
e2e/
├── fixtures/
│   ├── auth.fixture.ts        # authedPage par rôle (storageState), org/user jetables
│   ├── data.fixture.ts        # seededMission, seededSequence, seededCandidates (via admin client)
│   ├── network.fixture.ts     # mockUnipile / mockApollo / mockAnthropic (page.route + HAR)
│   └── index.ts               # `test` étendu qui compose toutes les fixtures
├── pages/                     # Page Objects pour les écrans riches uniquement
│   ├── LinkedInSearch.page.ts
│   ├── BriefWizard.page.ts
│   └── MissionWorkspace.page.ts
├── helpers/
│   ├── supabase-admin.ts      # service-role client : createOrg, createUser, deleteOrg, seed*
│   └── jwt.ts                 # forge un JWT user pour tests d'API directs
├── mocks/
│   ├── unipile/*.json         # réponses figées (search, get_profile, get_chats, inmail_balance)
│   ├── apollo/*.json
│   └── har/                   # HAR enregistrés pour scénarios complexes
├── specs/                     # plans Markdown produits par le Planner agent (voir §5)
├── flows/                     # les specs e2e, 1 fichier par flow métier
│   ├── auth.spec.ts           (existant, à enrichir)
│   ├── mission-create.spec.ts
│   ├── sourcing-linkedin.spec.ts
│   ├── sequences.spec.ts
│   ├── pipeline.spec.ts
│   ├── multi-tenant.spec.ts   (@critical sécurité)
│   ├── credits.spec.ts
│   └── mobile.spec.ts         (@mobile — persona Sophie)
└── api/                       # tests d'API directs sur les edge functions (sans navigateur)
    ├── quota-gate.spec.ts     # le gate quota LinkedIn unifié
    ├── rls.spec.ts            # RLS / SECURITY DEFINER revoke (régression du hardening)
    └── webhooks.spec.ts       # signatures stripe/unipile/calendly fail-closed
```

### `playwright.config.ts` — évolutions
- **Projects** : `setup` (globalSetup auth) → `chromium-desktop` → `mobile-safari` (iPhone 13,
  persona Sophie) → `api` (pas de navigateur, requête directe) → `live` (tag `@live`, exclu du CI bloquant).
- `globalSetup` : crée les orgs/users de référence + génère les `storageState` par rôle.
- `globalTeardown` : supprime les orgs jetables.
- Reporters CI : `html` + `blob` (pour merge des shards) + `github`.
- `expect.timeout` calibré, `trace: 'on-first-retry'`, `video: 'retain-on-failure'`.

---

## 3. Stratégie de données Supabase (le point dur)

Konekt est multi-tenant avec RLS partout — la QA doit créer des tenants isolés et jetables.

### 3.1 Auth sans UI (`globalSetup`)
- Utiliser le **service-role admin client** (`supabase.auth.admin.createUser`, email confirmé
  d'emblée) pour créer les users de test → pas de flow signup, pas d'email.
- Se connecter via l'**API REST** (`signInWithPassword`) → récupérer la session → écrire le
  `storageState` (localStorage `sb-*-auth-token`) dans `e2e/.auth/<role>.json`.
- **4 rôles de référence** alignés sur les personas + featureGates :

| storageState | org_type | Rôle org | Persona |
|---|---|---|---|
| `agency-owner.json` | `agency` | owner | Guillaume (accès `/prospection`) |
| `enterprise-admin.json` | `enterprise` | admin | Claire |
| `freelance.json` | `freelance` | collaborator | Sophie |
| `org-b-owner.json` | `agency` (autre org) | owner | Théo (cible cross-tenant) |

### 3.2 Seed par test (fixtures `data.fixture.ts`)
- Chaque test qui a besoin de données les crée via l'admin client **dans son org**, et les
  détruit en téardown (`org` scopé au test → `DELETE` cascade).
- Builders : `seedMission(orgId, {...})`, `seedSequence(missionId, steps)`,
  `seedCandidates(n)`, `seedLinkedInAccount(userId, status)`.
- **Jamais** de dépendance à des données prod ; **jamais** de données partagées entre tests
  parallèles (sinon flaky sous workers).

### 3.3 Cible : Supabase local vs projet de staging
- **Recommandé** : un projet Supabase **staging** dédié (ou `supabase start` local en CI) avec
  le **même schéma + mêmes migrations + mêmes RLS** que la prod. On ne teste jamais contre
  `konekt-production`.
- Les tests `api/rls.spec.ts` rejouent exactement le hardening de cette semaine : vérifier que
  `anon`/`authenticated` ne peuvent PAS exécuter `deduct_ai_credits`, `get_org_integration`,
  etc., et que `get_vivier_*` refuse une org `enterprise`.

---

## 4. Couverture par flow (mappée sur la Code Map + les personas)

Priorité = risque × fréquence. P0 d'abord.

### P0 — Sécurité & argent (régression interdite)
| Spec | Ce qu'on vérifie | Persona | Tag |
|---|---|---|---|
| `multi-tenant.spec.ts` | URL forge `/missions/:id` d'une autre org → bloqué ; `unipile-search` avec `account_id` d'une autre org → 403 ; `get_vivier_*` refuse enterprise | Théo | `@critical` |
| `api/rls.spec.ts` | les 44 fonctions SECURITY DEFINER non exécutables par anon/authenticated ; onboarding (création org) OK ; portail candidat token-scoped OK | Théo | `@critical` |
| `api/quota-gate.spec.ts` | les 4 chemins d'envoi (séquence, inmail, manuel, agent) passent par le gate ; cap journalier bloque à N ; warm-up clamp ; pas de double comptage ; `endorse` compté | Théo | `@critical` |
| `credits.spec.ts` | un appel IA (screen-candidate, enrich-company…) crée bien une transaction crédits ; solde décrémenté ; 402 si épuisé | Guillaume | `@critical` |

### P1 — Cœur métier
| Spec | Scénario | Persona |
|---|---|---|
| `mission-create.spec.ts` | BriefWizard 5 étapes → auto-save 800ms → `job_details` écrit ; voice dictation mock | Guillaume |
| `sourcing-linkedin.spec.ts` | recherche (Unipile mocké) → filtres AI→UI transformés → scoring batch → **tab switch préserve `missionSearchCache`** → retour sans perte d'état | Guillaume |
| `sequences.spec.ts` | créer séquence → enrôler 10 candidats → cron `process-sequences` (déclenché en test) → steps `sent` → **un crash simulé ne re-envoie PAS** (régression du fix #212) | Guillaume |
| `pipeline.spec.ts` | kanban : déplacer candidat entre colonnes → statut persisté ; noter ; planifier entretien | Claire |
| `qualification.spec.ts` | `/qualification/:id` flow chatbot scorecard de bout en bout sans terme technique visible | Claire |

### P2 — UX, mobile, accessibilité
| Spec | Scénario | Persona |
|---|---|---|
| `mobile.spec.ts` | iPhone 13 portrait : kanban swipe, MissionCopilot ne masque rien, cibles ≥ 44px, pas de débordement horizontal, Slow 4G < 3s | Sophie |
| `invite.spec.ts` | `/mission-invite/:token` accepté sur mobile → arrive sur MissionWorkspace | Sophie |
| `branding.spec.ts` | aucun nom vendor (Unipile/Apollo/PDL/Claude/Resend) visible dans toasts/labels/erreurs (sauf /privacy) | Claire |
| `a11y.spec.ts` | scan `@axe-core/playwright` sur les écrans clés (0 violation critique) | tous |

### Garde-fous transverses (dans chaque spec)
- Aucun `console.error` non attendu (listener qui fait échouer le test sur erreur réseau 5xx).
- Aucun terme technique user-facing (liste noire : RLS, webhook, edge function, cursor, snapshot…).
- Toute action destructive = AlertDialog shadcn, jamais `window.confirm`.

---

## 5. Boucle agentique Claude Code + Playwright Agents

Playwright v1.56+ ship 3 agents (Planner / Generator / Healer) qui pilotent un vrai navigateur
via le **Playwright MCP** — ils génèrent des locators à partir du DOM réel, pas d'hallucination.

### 5.1 Mise en place
```bash
npm i -D @playwright/test@latest          # ≥ 1.56 pour les agents
npx playwright install --with-deps chromium
npx playwright init-agents --loop=claude   # génère les définitions d'agents pour Claude Code
# Playwright MCP (navigateur piloté par Claude) :
claude mcp add playwright npx '@playwright/mcp@latest'
```
`init-agents` crée les définitions sous `.claude/agents/` (à régénérer à chaque update Playwright).

### 5.2 Le cycle (par flow)
1. **Planner** — explore l'app en navigateur réel et produit un plan Markdown dans `e2e/specs/`
   (happy path + erreurs + edge cases). On l'amorce avec le contexte métier : la Code Map du
   `CLAUDE.md`, les personas du skill `/qa`, et les credentials de test.
2. **Revue humaine** (Laurent / moi) du plan Markdown — c'est le point de contrôle : on valide
   les scénarios avant de générer du code. Peu coûteux, haute valeur.
3. **Generator** — transforme le plan en specs Playwright, en vérifiant chaque locator/assertion
   live dans le navigateur.
4. **Healer** — exécute la suite, lit console + réseau + snapshots, répare les tests cassés ou
   marque `skip` si la fonctionnalité est réellement cassée (→ signal de bug, pas de test).

### 5.3 Garde-fous agentiques (essentiels)
- Le Healer **ne doit jamais masquer un vrai bug** : un test qu'il n'arrive pas à faire passer
  parce que l'app est cassée doit remonter comme **finding**, pas comme `skip` silencieux. Règle
  dans la définition d'agent : « si la cause racine est applicative, ouvre un rapport, ne modifie
  pas l'assertion pour la faire passer ».
- Les agents tournent contre **staging mocké**, jamais contre la prod (pas d'envoi LinkedIn réel,
  pas de consommation de crédits réels).
- Les specs générées passent en **revue de diff** comme du code normal avant merge.

---

## 6. CI/CD

Nouveau workflow `.github/workflows/e2e.yml` :
- **Déclencheurs** : PR vers `main` (bloquant sur tags `@smoke @critical`), nightly (suite
  complète + `@live`), `workflow_dispatch`.
- **Étapes** : checkout → setup Supabase staging (ou `supabase start`) → applique migrations →
  `globalSetup` (auth + seed de base) → `playwright test --shard` (4 shards) → merge des
  rapports `blob` → upload `html` + traces des échecs.
- **Gating** : `@critical` (multi-tenant, RLS, quota, crédits) = **bloquant**. Le reste informatif
  au début, durci progressivement.
- Secrets CI : `SUPABASE_STAGING_URL`, `SUPABASE_STAGING_SERVICE_ROLE_KEY` — jamais les secrets prod.

---

## 7. Phasage proposé (incrémental, livrable à chaque étape)

| Phase | Livrable | Effort | Valeur |
|---|---|---|---|
| **1. Socle** | fixtures auth + storageState 4 rôles + helper admin Supabase + config multi-projects | ½–1 j | débloque tout le reste |
| **2. P0 sécurité/argent** | `multi-tenant`, `api/rls`, `api/quota-gate`, `credits` | 1–2 j | **protège les fixs de cette semaine contre la régression** |
| **3. P1 métier** | `sourcing-linkedin` (Unipile mocké), `sequences` (anti double-envoi), `mission-create`, `pipeline` | 2–3 j | cœur produit |
| **4. Agents** | `init-agents` + Playwright MCP + 1er cycle Planner→Generator→Healer sur un flow pilote | 1 j | accélère la génération des phases suivantes |
| **5. P2 + CI** | mobile, a11y, branding + workflow `e2e.yml` gating `@critical` | 1–2 j | filet permanent |

Phase 2 d'abord : ce sont les bugs qu'on vient de corriger (RLS, quotas, double-envoi) — sans
test, ils peuvent revenir au prochain refactor.

---

## 8. Définition de « QA réussie »
- `@critical` vert et bloquant en CI sur chaque PR.
- Tout flow P0/P1 a au moins un happy path + un cas d'erreur + un cas multi-tenant.
- Zéro `waitForTimeout`, zéro locator CSS fragile, zéro dépendance d'ordre.
- Les vendors externes mockés par défaut ; suite `@live` nightly pour la confiance d'intégration.
- Le skill `/qa` (4 personas) reste la grille de revue ; ce harness l'automatise.

---

---

## ⚠️ Finding majeur (2026-06-11) — le schéma n'est pas reconstructible depuis les migrations

La première mise en CI du harness a révélé que **`supabase start` ne peut pas reconstruire la
base à neuf** depuis `supabase/migrations/`. Trois classes de non-idempotence ont été corrigées
(policies recréées sans DROP → 42710 ; tables sans IF NOT EXISTS → 42P07 ; paramètre de fonction
renommé dans un CREATE OR REPLACE → 42P13), puis un blocage de fond :

**La table `connector_instances` est référencée (FK de `connector_sync_runs`,
`20260327110000_connector_framework.sql`) mais n'est créée par AUCUNE migration.** Elle existe
pourtant en prod (présente dans `src/integrations/supabase/types.ts`). Conclusion : le **schéma
de base importé depuis Lovable n'a jamais été capturé sous forme de migration** — le dossier
`migrations/` est incomplet. Invisible en prod (appliquées une à une + `repair_tracking`), mais
bloquant pour tout environnement neuf : CI e2e, onboarding dev, **disaster recovery**.

### Décision : cibler un Supabase de staging plutôt que rejouer l'historique
Le workflow `e2e.yml` supporte deux modes :
- **STAGING (recommandé)** : si les secrets `E2E_SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY` (projet
  de test ayant déjà le schéma) sont fournis, les tests tapent ce projet directement.
- **LOCAL** : fallback `supabase start` — restera cassé tant que le schéma de base n'est pas
  **baseliné** (`supabase db dump --schema public` d'un env sain → migration `00000000_baseline.sql`).

**Action requise (décision utilisateur)** : fournir un projet Supabase de staging (le plus rapide
pour voir tourner la suite) OU autoriser la génération d'un baseline depuis un dump. Les specs,
fixtures et agents sont prêts et tourneront tels quels contre une base au bon schéma.

---

## ✅ Résultat final (2026-06-11, 15h15) — harness VERT en CI

Run #19 : **16 passed / 1 skipped / 0 failed** (~16 s de tests). La suite `@critical|@smoke`
tourne sur chaque PR : stack Supabase locale reconstruite depuis les migrations, front buildé,
4 comptes personas provisionnés, tests navigateur + API.

**Couverture active** : isolation multi-tenant (URL forge, RLS cross-org), fonctions SECURITY
DEFINER révoquées (anon + authenticated), garde agency-only vivier, quota gate (cap visible,
endorse, dry-run, pause fournisseur), smokes par rôle (agency/enterprise/freelance/mobile).

**Findings sécurité déterrés par le harness lui-même** :
1. 🔴 `get_vivier_contacts/companies` avaient **6-7 signatures empilées** (overloads jamais
   DROPpées par les migrations historiques) — la garde agency-only de #207 ne protégeait que la
   dernière. Une org enterprise pouvait lire le vivier via une vieille signature. Fix :
   `20260611130000_drop_stale_vivier_overloads.sql` (drop dynamique de tout overload ≠ dernière
   signature) + test de non-régression qui rejoue l'attaque par signature.
2. ⚠️ La chaîne de migrations n'était pas rejouable sur base vierge (~15 commits de réparation :
   policies 42710, contraintes 42704/42710, fonction 42P13, tables Lovable jamais capturées,
   crons non tolérants, seeds data-dépendants). Désormais : **`supabase start` reconstruit la
   base de zéro** — CI, onboarding dev et disaster recovery redevenus possibles.

Limite connue du mode CI local : pas d'edge functions déployées (stack DB+Auth+REST) → les specs
qui en dépendent restent en mode staging (`E2E_SUPABASE_URL` secrets) ou `@live`.

---

### Sources (pratiques 2026)
- Playwright Test Agents (officiel) : https://playwright.dev/docs/test-agents
- Page Object Model : https://playwright.dev/docs/pom
- Mock APIs / HAR : https://playwright.dev/docs/mock
- Best practices 2026 : https://www.browserstack.com/guide/playwright-best-practices , https://getautonoma.com/blog/playwright-best-practices-2026
- Claude Code + Playwright MCP : https://testomat.io/blog/playwright-mcp-claude-code/ , https://shipyard.build/blog/playwright-agents-claude-code/
- Supabase e2e (auth/storageState/RLS) : https://supabase.com/blog/testing-for-vibe-coders-from-zero-to-production-confidence , https://supabase.com/docs/guides/database/testing
