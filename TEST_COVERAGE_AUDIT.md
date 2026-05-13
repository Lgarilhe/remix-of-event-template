# TEST_COVERAGE_AUDIT.md

> Audit du **2026-05-13** — branche `claude/analyze-test-coverage-MwL2L`
> Périmètre : tout le repo `remix-of-event-template` (frontend Vite/React + 84 edge functions Supabase).

---

## TL;DR

La couverture de tests est **quasi inexistante et partiellement cassée**.

- **1 fichier de tests unitaires** (`src/__tests__/aiCredits.test.ts`) qui importe `vitest`… mais `vitest` n'est **pas installé** (`package.json` ne le liste pas, absent de `package-lock.json` et `bun.lock`). Ce test **ne peut pas s'exécuter** en l'état.
- **3 specs Playwright** (`e2e/auth.spec.ts`, `landing.spec.ts`, `protected-routes.spec.ts`) — ne couvrent que l'affichage du formulaire de login, le titre du landing, et la redirection vers `/auth` pour 5 routes protégées. **Aucun flow produit testé.**
- **84 edge functions, 0 test.** Y compris les fonctions critiques pour la facturation (`settle-credits` shared, `stripe-webhook`, `create-checkout-session`), l'auth (`require-auth` shared, `accept-invitation`), et le moteur de recherche (`unipile-search`, `score-profile-job`, `generate-search-filters`).
- **Aucune job CI** ne lance de tests. `.github/workflows/` contient uniquement `deploy-edge-functions.yml` et `deploy-migrations.yml`. Le seul filet de sécurité avant commit est le hook local `npx tsc --noEmit && npx vite build` (CLAUDE.md) — du **type-check + build**, pas du test.
- **Pas de reporting de coverage**, pas de seuil minimum, pas de tests de régression sur les bugs documentés (cache `missionSearchCache`, deferred location, transformation AI→LinkedInFiltersState…).

En résumé : le repo a un type-check rigoureux et un déploiement automatisé, mais **rien ne vérifie le comportement runtime du code avant qu'il atteigne la prod**. Les régressions sont attrapées par les utilisateurs.

---

## État actuel — l'existant

### Tests présents

| Fichier | Type | Lignes | Statut |
|---|---|---|---|
| `src/__tests__/aiCredits.test.ts` | unit (vitest) | 230 | **CASSÉ** — `vitest` non installé |
| `e2e/auth.spec.ts` | Playwright | 33 | OK |
| `e2e/landing.spec.ts` | Playwright | 16 | OK |
| `e2e/protected-routes.spec.ts` | Playwright | 15 | OK |

### Tooling

- **Playwright** : installé, configuré (`playwright.config.ts`), 3 scripts npm (`test:e2e`, `test:e2e:ui`, `test:e2e:install`). Le webserver lance `npm run dev` sur port 8080.
- **Vitest** : référencé dans le code mais **non listé en dépendance**. Le fichier `aiCredits.test.ts` documente `npx vitest run src/__tests__/aiCredits.test.ts` — qui échouera tant que le package n'est pas ajouté.
- **Coverage** : non configuré (ni Vitest c8/istanbul, ni Playwright `--reporter=html` exploité pour la couverture).
- **CI** : aucun job ne lance ni `playwright test`, ni `vitest run`, ni `npx tsc --noEmit`. Le check pré-commit local est tout ce qui existe.
- **pgTAP / tests SQL** : absent. Aucune validation des RLS, des triggers, ou des contraintes d'intégrité.

---

## Gaps critiques (par ordre de risque)

### 🔴 P0 — Money & sécurité

Ces zones manipulent de l'argent, des credentials ou les permissions. Une régression silencieuse = facturation incorrecte, fuite de données entre tenants, ou bypass d'auth.

| Zone | Fichier | Pourquoi c'est P0 | Type de test |
|---|---|---|---|
| Settlement de crédits IA | `supabase/functions/_shared/settle-credits.ts` | Marge sur 30+ fonctions ; `estimateCredits()` est testé mais pas le settlement réel (transaction Supabase, idempotence, rollback) | Unit + integration (Supabase local) |
| Auth + multi-tenant | `supabase/functions/_shared/require-auth.ts` (`requireAuth`, `verifyOrgMembership`) | Toutes les edge functions s'appuient dessus. Pas un seul test du chemin "user d'une autre org tape sur organization_id ≠ le sien" | Unit + integration |
| Résolution credentials par org | `supabase/functions/_shared/resolve-org-credentials.ts` | CLAUDE.md alerte explicitement contre le "credential bleed between concurrent requests". Aucun test ne garantit qu'on ne fuit pas la clé Unipile d'une org vers une autre | Unit (mock Supabase) |
| Stripe webhook | `supabase/functions/stripe-webhook/` | Signature verification, idempotence des events Stripe, mise à jour des subscriptions. Bug ici = utilisateur facturé sans accès, ou inversement | Integration |
| Checkout | `supabase/functions/create-checkout-session/` | Construit l'URL Stripe + `APP_URL`. Régression URL = redirection cassée après paiement | Unit |
| `settle-credits` floors | `src/types/aiCredits.ts` | Partiellement testé (10 assertions sur `estimateCredits` + `resolveModel`) MAIS le test ne peut pas tourner → la garantie de marge n'est plus active | **D'abord installer vitest** |

### 🔴 P0 — Branding leaks (règle CLAUDE.md)

CLAUDE.md exige explicitement : « **vendor names NEVER user-facing** » — `Unipile`, `Apollo`, `PDL`, `People Data Labs` ne doivent jamais apparaître en UI (sauf `/privacy` et `/privacy-extension`). La règle dit même : « Before merging any UI change : grep for `Unipile`, `Apollo`, `PDL`, `People Data Labs` in user-visible strings ».

**5 fichiers `.tsx` mentionnent encore ces noms** (à confirmer s'ils sont leak ou non) :
- `src/components/ui/ChannelIcon.tsx`
- `src/components/outreach/MessagesInbox.tsx`
- `src/components/outreach/LinkedInFilters.tsx`
- `src/components/outreach/SequenceDiagnostic.tsx`
- `src/components/outreach/WebhookManager.tsx`

→ **Un seul test statique** (parse JSX, scan les `>...<` text nodes et les props `placeholder`/`label`/`title`) suffit à transformer cette règle d'un grep manuel en un gardien automatique. Coût : ~50 LOC.

### 🟠 P1 — Logique pure non testée, fortement couplée à des bugs récents

Ce sont des fonctions pures, faciles à tester, qui ont déjà cassé en prod ou qui sont marquées comme « complexes » dans CLAUDE.md.

| Zone | Fichier | Risque concret |
|---|---|---|
| Transformation AI → `LinkedInFiltersState` | `src/hooks/useLinkedInSearch.ts` lignes 266-306 | Deux formats coexistent (CLAUDE.md : "Two filter formats coexist") ; un mauvais mapping = recherche LinkedIn vide silencieusement |
| Apollo filter mapping | `supabase/functions/_shared/pdl-mapping.ts` + ex-`mapFiltersToApollo` | Tableau de mapping ~14 cas dans CLAUDE.md : seniority, headcount A-I → ranges, parsing K/M/B, cap 200 / 500 chars. Zéro test |
| `featureGates.ts` | `src/lib/featureGates.ts` | Prospection = agency-only ; un faux positif expose une feature vendor à un client. Pas de test |
| `templatePlaceholders.ts` | `src/lib/templatePlaceholders.ts` | Substitution de variables dans les messages envoyés aux candidats — si on échappe mal `{{firstName}}`, le candidat reçoit du Liquid brut ou un nom inversé |
| `deepMerge.ts` | `src/lib/deepMerge.ts` | Util réutilisé partout, classique source de bugs (arrays, null vs undefined, prototype pollution) |
| `sequenceCompatibility.ts` | `src/lib/sequenceCompatibility.ts` | Détermine si une séquence est valide pour un compte LinkedIn (Classic vs Recruiter vs Sales Nav) — mauvais résultat = message non envoyé ou erreur Unipile silencieuse |
| `linkedinUtils.ts` | `src/lib/linkedinUtils.ts` | Parsing/normalisation URL LinkedIn ; régression = dedup cassé en base |
| `companyClassification.ts` | `src/lib/companyClassification.ts` | Heuristiques de classification (probablement seuils de headcount / revenue) |
| `stringUtils.ts` | `src/lib/stringUtils.ts` | Pareil — util pur, tests triviaux |

Tous ces fichiers sont **purs** ou quasi purs : ils prennent des inputs typés et retournent un output. C'est le ratio coût/valeur le plus favorable pour des tests unitaires.

### 🟠 P1 — Hooks complexes documentés comme « dangereux »

CLAUDE.md alerte explicitement sur ces zones (« CRITICAL — most complex part », « DANGER », « Gotcha »). Aucune n'a de test.

| Hook | Lignes | Pourquoi tester |
|---|---|---|
| `useLinkedInSearch.ts` | 534 (CLAUDE.md) | State machine la plus complexe ; cache `missionSearchCache` qui « écrase tout sauf `selectedJob` » ; déjà 1 bug fix documenté (line 218 guard) |
| `useLinkedInSearchActions.ts` | 807 | Exécution recherche + pagination + retry `multiple_sessions` (3x avec backoff 0/6s/15s) |
| `useLinkedInScoring.ts` | 1208 | Batch LLM 3 vagues × 10 profils — facile de perdre un wave ou de double-compter les crédits |
| `useMessagesInbox.ts` | 1906 | Plus gros fichier du repo après les types Supabase auto-gen. Mark-read, dedup chats sur 3 folders (INBOX_LINKEDIN_CLASSIC + RECRUITER + INBOX) |
| `useMissionProcess.ts` | — | Étapes d'entretien + reordering via « temp negative order values » (CLAUDE.md). Bug classique de UNIQUE constraint |

Les tests doivent être de type **state-machine / reducer tests** (faciles : on isole le reducer, on lui injecte des actions, on vérifie le `state`), pas du DOM rendering — ce qui reste très peu coûteux.

### 🟡 P2 — E2E produit (Playwright)

Les 3 specs existantes testent le strict minimum. Les **personas Konekt** sont définis dans le skill `qa.md` (Guillaume / Claire / Théo / Sophie) — autant de scénarios à écrire :

| Flow | Persona | Pourquoi |
|---|---|---|
| Création de mission + brief (BriefWizard 5 étapes) | Guillaume | Cœur du produit |
| Lancer une recherche LinkedIn + scoring batch | Claire | Le moteur le plus complexe ; régression visible immédiatement |
| Inviter un freelance + accepter via `/mission-invite/:token` | Sophie | Auth flow + tokens — facile à régresser |
| Pipeline kanban : déplacer un candidat de colonne | Théo | DnD + RLS sur `job_candidate_status` |
| Onboarding : créer une org (couvre le bootstrap RLS du `2026-04-21`) | Tous | Bug RLS déjà résolu, mais non gardé par un test |
| Settings deep links (`?tab=billing` etc.) | Tous | Régression simple à introduire |

Recommandé : 1 spec par flow critique, scénario "happy path" uniquement au début (l'objectif est d'attraper les régressions, pas de tout couvrir).

### 🟡 P2 — Edge functions individuelles

84 edge functions sans test. On ne va pas tout couvrir, mais 5 méritent au minimum un test d'intégration local Supabase (`supabase functions serve` + invoke avec un JWT mocké) :

1. `score-profile-job` — batch LLM, gestion des erreurs partielles, settlement crédits
2. `generate-search-filters` — output structuré attendu par le frontend
3. `unipile-search` — wrapper sur l'API Unipile, retry `multiple_sessions`, truncation `CONTENT_TOO_LARGE`
4. `process-sequences` — cron-driven, idempotence critique, auth via `PROCESS_SEQUENCES_SECRET`
5. `stripe-webhook` — déjà mentionné en P0

### 🟡 P2 — RLS et SQL

Aucun test pgTAP, aucun test des migrations. Avec le fix RLS du `2026-04-21` (grant SELECT/INSERT/UPDATE/DELETE à `authenticated` sur ~10 tables), c'est le genre de régression qui peut revenir silencieusement à la prochaine migration mal écrite.

Minimum viable : 3-4 tests pgTAP qui vérifient :
- User d'org A ne peut pas SELECT sur les rows org B (sur `sourcing_projects`, `job_candidate_status`, `outreach_sequences`)
- Les GRANTs `authenticated` sont bien présents sur les tables critiques
- Le trigger `enforce_role_hierarchy` ne bloque pas le bootstrap owner

---

## Recommandations — par ordre d'exécution

### Étape 1 — Débloquer (1h)

1. **Installer Vitest** : `bun add -d vitest @vitest/coverage-v8` (ou npm equivalent).
2. Ajouter `"test": "vitest run"` et `"test:watch": "vitest"` dans `package.json scripts`.
3. Vérifier que `src/__tests__/aiCredits.test.ts` passe.
4. Ajouter une **job CI GitHub Actions** `tests.yml` qui lance `npm run test && npm run test:e2e` sur chaque PR.

Sans ces 4 points, **aucun test ajouté ne sera réellement protégé** — on régresse silencieusement à la première PR oubliée.

### Étape 2 — Quick wins purs (1 journée)

Ces tests sont triviaux et à très haute valeur. Ils transforment des fonctions « bien écrites mais fragiles » en briques garanties.

- `src/lib/deepMerge.test.ts` — 8-10 cas (null, undefined, arrays, nested, prototype pollution)
- `src/lib/templatePlaceholders.test.ts` — substitution, échappement, variables manquantes
- `src/lib/sequenceCompatibility.test.ts` — matrice license × action
- `src/lib/linkedinUtils.test.ts` — normalisation URL (`/in/foo/`, `/in/foo?bar`, `linkedin.com/in/foo`)
- `src/lib/featureGates.test.ts` — matrice org-type × feature
- `supabase/functions/_shared/pdl-mapping.test.ts` — chaque ligne du mapping CLAUDE.md = 1 test (~14 tests)

Budget réaliste : ~150 LOC de tests, attrape 80 % des régressions silencieuses futures.

### Étape 3 — Reducer / state-machine tests (2-3 jours)

- Extraire les **reducers** de `useLinkedInSearch`, `useLinkedInScoring`, `useMessagesInbox` (s'ils ne le sont pas déjà — `useLinkedInSearch` mentionne explicitement `searchReducer` et `viewReducer`).
- Les tester en isolation : `reducer(state, action) → expected state`.
- Couvrir au minimum la transformation AI→LinkedInFiltersState (lignes 266-306 de `useLinkedInSearch.ts`) car CLAUDE.md la flagge comme zone à bug.

### Étape 4 — Edge functions critiques (3-5 jours)

- Mettre en place `supabase functions serve` + un harnais de test Deno (`Deno.test`).
- Tester `_shared/require-auth.ts` (auth + cross-org membership) — 4-5 tests suffisent.
- Tester `_shared/settle-credits.ts` (idempotence, rollback, calcul correct).
- Tester `stripe-webhook` (signature, idempotence des events).

### Étape 5 — E2E flow produits (continu)

- 1 spec Playwright par persona / flow critique listé en P2.
- Garder ces tests **résilients** : `getByRole` + `data-testid` sur les éléments clés plutôt que des regex de texte qui cassent à chaque refactor i18n.

### Étape 6 — RLS pgTAP (1 journée)

- Ajouter `supabase/tests/` avec quelques `*.pgtap.sql`.
- Lancer via `supabase test db --linked` dans la CI.

### Étape 7 — Coverage & gating

- Configurer `vitest --coverage` + reporter HTML.
- Définir un seuil **minimal** au départ (ex. 30 % statements sur `src/lib/`) et le monter par paliers — un seuil trop haut bloque tout et finit désactivé.

---

## Quick wins de l'ordre du test statique

Pas besoin d'un framework de test pour gagner immédiatement :

1. **Lint rule "no vendor leaks"** : custom ESLint rule (ou simple test Vitest qui parse les `.tsx`) qui interdit les literals `"Unipile"`, `"Apollo"`, `"PDL"`, `"People Data Labs"` dans le JSX (sauf fichiers whitelistés `Privacy.tsx`, `PrivacyExtension.tsx`).
2. **Test de structure des secrets** : un test qui parse `supabase/functions/_shared/*.ts` et vérifie qu'aucun nouveau `Deno.env.get("SOMETHING")` n'apparaît sans avoir été documenté dans CLAUDE.md → garde le tableau des secrets à jour.
3. **Test de présence des conventions d'edge functions** : que chaque `index.ts` d'edge function utilise `requireAuth` et `fetchWithTimeout` (conventions MANDATORY de CLAUDE.md).

---

## Synthèse — où mettre l'effort en premier

Si on n'a qu'un sprint :

1. **Installer vitest + CI job** (étape 1) — 1h. **Bloquant pour le reste.**
2. **Quick wins purs sur `src/lib/` et `_shared/pdl-mapping`** (étape 2) — 1 jour. Ratio coût/valeur imbattable.
3. **Lint rule branding leaks** — 2h. Élimine une classe entière de régressions.
4. **2 E2E Playwright** : création mission + recherche LinkedIn (étape 5 partielle) — 1 jour. Couvre 60 % des régressions critiques visibles client.
5. **Test `require-auth` + `verifyOrgMembership`** (étape 4 partielle) — 4h. Garde la frontière multi-tenant.

Total : ~3-4 jours pour passer de "0 garde-fou" à "les pires régressions sont attrapées avant la prod".
