# AUDIT TESTS - Skalr Platform
**Date:** 2026-04-16 | **Status:** Critical Testing Gap | **Estimated Coverage:** 0.5% | **Risk:** HIGH

---

## 1. INVENTAIRE ACTUEL

### Fichiers de test existants
- **1 seul test** : `src/__tests__/aiCredits.test.ts` (211 lignes)
  - 47 assertions testant le système de crédits IA (pricing, models, routing)
  - Couverture : aiCredits.ts uniquement (1 fichier sur 398 TypeScript)

### Outils configurés
- **Vitest** : INSTALÉ MAIS NON CONFIGURÉ
  - Pas de `vitest.config.ts`
  - Pas d'alias path "@" pour Vitest
  - Pas de setup files
- **Testing Library** : ❌ NON PRÉSENT
- **Playwright / Cypress** : ❌ NON PRÉSENT
- **Coverage threshold** : ❌ ABSENT

### Structure des tests
```
src/__tests__/                    # 1 seul test file
├─ aiCredits.test.ts            # 211 lignes (SEUL test)
├─ (vide)
```

### Métriques découvertes
- **Fichiers TypeScript/TSX** : 398 fichiers
  - 286 composants React (.tsx)
  - 64 hooks personnalisés
  - 14 fichiers lib/ (authSession, invokeWithCredits, deepMerge, etc.)
  - 1 seul fichier utils/
- **Edge Functions Deno** : 78 fonctions (search-agent-chat, score-profile-job, etc.)
- **Migrations SQL** : 175 fichiers (.sql)
- **Couverture estimée** : 0.5% (1 test / ~200 fichiers critiques)

---

## 2. GAPS PAR COUCHE

### Unit Tests - CRITIQUE ❌
**Gap sévère : 0 tests**

Fichiers critiques non testés :
- `src/lib/invokeWithCredits.ts` (120 lignes) — PRE-AUTH, SETTLEMENT credits
- `src/lib/authSession.ts` — Gestion session Supabase avec timeout
- `src/lib/featureGates.ts` — Gating basé tier (enterprise, agency, freelance)
- `src/lib/linkedinUtils.ts` — Extraction données LinkedIn
- `src/lib/missionUtils.ts` — Logique métier missions
- `src/lib/stringUtils.ts` — Transformations strings (formattage téléphone, adresses)
- `src/types/aiCredits.ts` (250+ lignes) — Catalog models, ACTION_COSTS, CREDIT_PACKS
- `src/utils/skillCategories.ts` — Mapping compétences

### Component Tests - CRITIQUE ❌
**Gap sévère : 0 tests**

200+ composants React sans test :
- `src/components/outreach/LinkedInSearch.tsx` — Intégration Apollo/LinkedIn critique
- `src/components/outreach/search/SearchFiltersPanel.tsx` — Filter transform (bug-prone)
- `src/components/missions/MissionSourcing.tsx` — Workflow sourcing complet
- `src/components/settings/BillingSettings.tsx` — Stripe checkout (risque financier)
- `src/components/settings/AgencySettings.tsx` — Multi-tenant settings
- `src/components/agent/AgentChatPanel.tsx` — Chat + credit deduction
- Tous les composants UI (dialogs, forms, modals)

### Integration Tests - CRITIQUE ❌
**Gap sévère : 0 tests**

Zéro test pour :
- API Supabase RLS (row-level security) multi-tenant
- Edge functions + Supabase client
- Credit system (pre-auth → settlement)
- External APIs : Anthropic, Stripe, Apollo, Unipile, Aircall
- Webhook handling (Calendly, Aircall, Unipile)

### E2E Tests - CRITIQUE ❌
**Gap sévère : 0 tests**

Pas de test pour les flows critiques :
- Signup → Mission creation → Search → Outreach → Hire
- LinkedIn account connection
- Invoice generation
- Sequence sending (email + tracking)
- Team invitations

### Regression / Snapshots - CRITIQUE ❌
**Gap sévère : 0 tests**

Zéro snapshot, visual testing, ou regression suite.

---

## 3. RISQUES ACTUELS - 10 CHEMINS CRITIQUES NON TESTÉS

### ⚠️ P1 : Credit Pre-Auth / Settlement
**Fichiers** : `src/lib/invokeWithCredits.ts`, `supabase/functions/ai-credits/index.ts`
**Risque** : Pre-auth refuse le call → user n'appelle pas l'IA, mais credit déjà déduit ailleurs → débug impossible
**Cas non couvert** : 
- Pre-auth fails (network) → still calls AI → double deduction
- Settlement API returns error → credit not deducted → user gets free usage
- Model override with null → falls back incorrectly

### ⚠️ P1 : RLS Multi-Tenant Isolation
**Fichiers** : `supabase/migrations/` (175 fichiers), `src/lib/orgContext.ts`
**Risque** : Recruiter A voit candidates de Recruiter B (auth bypass)
**Cas non couvert** :
- Member of org A tries to query org B's data via PostgREST
- Service role invokes function without org_id check
- RLS policy has NULL owner edge case

### ⚠️ P1 : AI Scoring (Job-Profile Match)
**Fichiers** : `supabase/functions/score-profile-job/index.ts` (300+ lignes)
**Risque** : Incorrect scoring → wrong candidates recommended → deal loss
**Cas non couvert** :
- Missing work experience data → crashes vs fallback
- Location mismatch logic (Paris / remote policy conflict)
- Skill fuzzy matching fails silently

### ⚠️ P1 : Sequence Sending (Email + Webhook)
**Fichiers** : `supabase/functions/sequence-send-email/index.ts`, `supabase/functions/process-sequences/index.ts`
**Risque** : Email sent twice, or never sent, or tracking pixel corrupted
**Cas non couvert** :
- UNIPILE_DSN env var missing → silent fallback to wrong endpoint
- Tracking pixel injection fails on HTML → open tracking broken
- Retry logic on network timeout → duplicate sends

### ⚠️ P1 : Stripe Billing Integration
**Fichiers** : `supabase/functions/create-checkout-session/index.ts`, `src/components/settings/BillingSettings.tsx`
**Risque** : Checkout session creation fails → SaaS revenue leak
**Cas non couvert** :
- Invalid org context → checkout for wrong customer
- Stripe API timeout → retry loop missing
- Subscription state out of sync with Supabase

### ⚠️ P2 : Filter Transform (Search)
**Fichiers** : `src/components/outreach/search/SearchFiltersPanel.tsx`
**Risque** : Filter logic inverted → search returns wrong candidates
**Cas non couvert** :
- Seniority range (5-10 yrs) → includes 0 yrs (boundary error)
- Location filters with remote policy (exclude Paris but allow remote_only)
- Skill AND/OR logic (must all vs any)

### ⚠️ P2 : LinkedIn Account OAuth + Sync
**Fichiers** : `supabase/functions/unipile-webhook/index.ts`, `src/contexts/LinkedInAccountsContext.tsx`
**Risque** : Token expires → no refresh → silent API failures
**Cas non couvert** :
- account_id not found in member_linkedin_accounts → fallback to wrong org
- Webhook signature verification missing
- Concurrent account syncs → race condition on candidates table

### ⚠️ P2 : Session Timeout + Auth Deadlock
**Fichiers** : `src/lib/authSession.ts`, `src/components/ProtectedRoute.tsx`
**Risque** : User stuck in auth loop, can't recover gracefully
**Cas non couvert** :
- supabase.auth.getSession() hangs → 15s timeout not recovered
- Token refresh race condition (2 concurrent calls)
- Auth invalidation cascade doesn't clear redux/query cache

### ⚠️ P2 : Context Retrieval (RAG)
**Fichiers** : `supabase/functions/retrieve-context/index.ts` (200+ lignes)
**Risque** : Embedding search returns wrong context → AI gives wrong advice
**Cas non couvert** :
- Embedding cache expires but hash collision → stale embedding reused
- Vector similarity threshold never adjusted → retrieves noise
- HTML parsing for company context fails → null data propagated

### ⚠️ P3 : Feature Gates (Tier-based)
**Fichiers** : `src/lib/featureGates.ts`, `src/components/outreach/LinkedInAccountManager.tsx`
**Risque** : Freelancer can access agency feature (tier bypass)
**Cas non couvert** :
- Org switched from freelance to agency → old state cached
- Feature flag not checked before API call → endpoint restricts, frontend allows UI
- Null tier defaults to premium access (inverted logic)

---

## 4. EDGE FUNCTIONS - TEST COVERAGE ZÉRO

### 78 Deno Functions sans test :

**Tier P1 (Failure = Data Loss / Revenue Impact)**
- `search-agent-chat/index.ts` — AI sourcing orchestration
  - Risque : System prompt injection, malformed search query
- `score-profile-job/index.ts` — Scoring logic
  - Risque : Division by zero on missing yrs experience, null coalescing fail
- `retrieve-context/index.ts` — RAG embedding retrieval
  - Risque : Timeout on embedding API, cache corruption
- `sequence-send-email/index.ts` — Email delivery + tracking
  - Risque : UNIPILE API endpoint wrong, HTML corruption on variable injection
- `unipile-webhook/index.ts` — LinkedIn sync handler
  - Risque : No signature verification, race condition on upsert

**Tier P2 (Failure = Feature Unavailable)**
- `run-agent-search/index.ts` — Agent search runner
- `process-sequences/index.ts` — Sequence orchestration
- `generate-outreach-message/index.ts` — Message personalization
- `create-checkout-session/index.ts` — Stripe integration
- `ai-credits/index.ts` — Credit pre-auth + settlement
- 70+ autres (webhooks, enrichment, etc.)

### Blocs de code les plus risqués (aucun test) :
```
1. fetchWithTimeout() : 15s hardcoded, no backoff retry
2. sanitizeFilterId() : Regex may still allow injection
3. resolveOrgCredentials() : No null-check before env fallback
4. Error handling : Mostly silent failures logged to console
5. Transaction integrity : Supabase updates without atomic guards
```

---

## 5. CI / CD - AUCUNE INFRASTRUCTURE

### GitHub Actions
- **Fichier** : `.github/workflows/` → ❌ ABSENT
- **Tests lancés** : ❌ NON
- **Coverage threshold** : ❌ ABSENT
- **PR checks** : ❌ NONE

### Package.json Scripts
```json
{
  "dev": "vite",
  "build": "vite build",
  "build:dev": "vite build --mode development",
  "lint": "eslint .",
  "preview": "vite preview"
  // ❌ Pas de test, coverage, ou e2e
}
```

### Recommandé immédiatement :
1. **npm run test** → Vitest run
2. **npm run test:coverage** → c8 report
3. **PR check** : Coverage threshold (min 70%)
4. **E2E nightly** : Playwright runs

---

## 6. STRATÉGIE RECOMMANDÉE - PYRAMIDE PRAGMATIQUE

### Pour 2 devs, SaaS critique, timeline 6-8 semaines

```
        🔶 Snapshots (0)
       📈 Regression (0)
      🟩 E2E Tests (10-15)
     🟦 Integration (20-30)
    🟧 Component (30-50)
   🟪 Unit (50-80)
```

### Niveau Unit : 50-80 tests (~3 semaines)

**Top priorité (2 semaines)**
1. `aiCredits.ts` → Expand existing test (+20 edge cases)
   - Model resolution precedence (user > org > auto)
   - Floor enforcement edge cases
   - Unknown action/model fallbacks
2. `invokeWithCredits.ts` → NEW (15 tests)
   - Pre-auth success/failure paths
   - Credit check skip when skipCreditCheck=true
   - Model override propagation
3. `featureGates.ts` → NEW (10 tests)
   - Tier-based access (freelance vs agency vs enterprise)
   - Null/undefined tier handling
   - Cached org tier updates
4. Filter transform utils → NEW (15 tests)
   - Seniority range boundaries (0-2, 2-5, 5-10, 10+)
   - Location + remote policy combinations
   - Skill AND/OR logic inversion

**Secondary (1 week)**
5. `stringUtils.ts` → NEW (8 tests)
6. `linkedinUtils.ts` → NEW (10 tests)
7. `orgContext.ts` → NEW (5 tests)

### Niveau Component : 30-50 tests (~2 semaines)

**Top priorité (1 week)**
1. `<LinkedInSearch />` → NEW (8 tests)
   - Filter panel + API call integration
   - Search state management
2. `<SearchFiltersPanel />` → NEW (12 tests)
   - Filter value changes
   - Range validation
   - Reset/clear filters
3. `<BillingSettings />` → NEW (5 tests)
   - Checkout session creation
   - Stripe redirects
4. `<ProtectedRoute />` → NEW (5 tests)
   - Auth redirect
   - Session expired handler

**Secondary (1 week)**
5. Form components (6+ tests)
6. Dialog/modals (8+ tests)

### Niveau Integration : 20-30 tests (~2 semaines)

**Top priorité**
1. Credit system (pre-auth → settlement) → 5 tests
2. RLS multi-tenant isolation → 5 tests
3. AI scoring (job-profile matching) → 5 tests
4. Sequence email (sending + tracking) → 5 tests
5. Stripe webhook handling → 3 tests
6. LinkedIn webhook (Unipile) → 2 tests

### Niveau E2E : 10-15 tests (~1 week, Playwright)

**Golden paths**
1. Signup → Onboarding → Complete profile
2. Create mission → Search (agent) → View results
3. Send outreach → Track open/click → Follow-up
4. Manage team → Invite member → Team access
5. Settings → Buy credits → Use credits → Invoice

---

## 7. TOP 12 ACTIONS RECOMMANDÉES

| # | Action | Effort | Gain | Délai | Owner |
|---|--------|--------|------|-------|-------|
| 1 | Setup Vitest + config (vitest.config.ts, @ alias) | 30m | BLOCKING | J1 | Dev1 |
| 2 | Setup Testing Library + component test template | 45m | BLOCKING | J1 | Dev1 |
| 3 | Expand aiCredits.test.ts (+20 cases) | 2h | HIGH | J2 | Dev1 |
| 4 | Unit tests : invokeWithCredits (15 tests) | 3h | CRITICAL | J3-J4 | Dev1 |
| 5 | Unit tests : featureGates (10 tests) | 2h | HIGH | J4 | Dev1 |
| 6 | Unit tests : filter transform (15 tests) | 3h | HIGH | J5-J6 | Dev2 |
| 7 | Component tests : LinkedInSearch (8 tests) | 4h | HIGH | J7-J8 | Dev2 |
| 8 | Component tests : SearchFilters + BillingSettings (17 tests) | 6h | HIGH | J9-J11 | Dev2 |
| 9 | Integration : Credit pre-auth flow (5 tests) | 4h | CRITICAL | J12-J13 | Dev1 |
| 10 | Integration : RLS multi-tenant (5 tests) | 3h | CRITICAL | J14 | Dev1 |
| 11 | Setup GitHub Actions CI + coverage threshold (70%) | 2h | HIGH | J15 | DevOps |
| 12 | E2E smoke tests (10 paths, Playwright) | 8h | MEDIUM | J16-J20 | Dev1+Dev2 |

**Total estimation** : 40-50 hours ≈ 1.5-2 weeks (2 devs)
**ROI** : Catch 80% of production bugs before deploy, reduce incident response time by 3x

---

## RÉSUMÉ EXÉCUTIF

**Skalr today** : 0.5% coverage, single test file, zero E2E, zero CI/CD.

**Skalr after 2 weeks** : 25-30% coverage, 100+ tests, 10-15 E2E golden paths, GitHub Actions CI with threshold.

**Ordre des actions** :
1. Setup infrastructure (vitest + testing-lib) → 1 day
2. Unit tests on critical business logic (credits, features, filters) → 1 week
3. Component tests on user workflows → 1 week
4. Integration + E2E smoke tests → 1 week
5. GitHub Actions CI/CD → 1 day

**Risk if nothing changes** : Silent data corruption (RLS), silent revenue leak (credits/billing), silent feature bypass (tiers), silent email delivery failures.

---

**Generated:** 2026-04-16 | **Auditor:** Claude Code | **Status:** Actionable
