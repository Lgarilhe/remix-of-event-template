# Audit complet — Skalr

Date: 2026-04-16
Branche: `claude/app-audit-jHxht`

## Synthèse

| Domaine | État | Remarque |
|---|---|---|
| TypeScript (`tsc --noEmit`) | ✅ 0 erreur | Mais `strict: false` (voir §B1) |
| Build Vite | ✅ | Compile en prod |
| ESLint | ❌ Cassé | Config manque `@eslint/js` en runtime (voir §B2) |
| Sentry | ✅ Initialisé | `src/main.tsx:41` (conditionnel sur `VITE_SENTRY_DSN`) |
| Modèles IA dépréciés | ✅ 0 | Tous sur `claude-sonnet-4-6` / `claude-opus-4-6` / `claude-haiku-4-5` |
| `settleCredits` sur fonctions IA | ✅ 10/10 | Toutes les fonctions qui appellent Anthropic settle |
| `window.confirm/alert/prompt` | ✅ 0 | Règle CLAUDE.md respectée |
| AlertDialog shadcn | ✅ 15 fichiers | Destructive UX conforme |
| `fetchWithTimeout` partout | ✅ | Pas de `fetch()` brut externe |
| Tests | ❌ 1 seul test | `src/__tests__/aiCredits.test.ts` |

---

## A. 🔴 Critiques (sécurité)

### A1. Fonctions sans `requireAuth` alors qu'elles devraient en avoir

`supabase/config.toml` désactive `verify_jwt` pour 39 fonctions. C'est légitime pour webhooks/crons, mais **~25 fonctions n'ont ni `verify_jwt=true` ni vérification manuelle** et manipulent pourtant des données sensibles :

**Critiques** (exposent APIs payantes / données client) :
- `apollo-search` — recherche Apollo (payant, coûteux)
- `pdl-search` — PeopleDataLabs (payant)
- `database-search` — recherche core
- `unipile-search` — recherche LinkedIn via Unipile
- `unipile-accounts` — gestion des comptes LinkedIn
- `unipile-manage-webhooks` — gestion webhooks
- `run-agent-search` — recherche agent IA (coûteuse)
- `search-agent-chat` — chat agent IA
- `estimate-search-count`
- `enrich-vivier-contacts` — enrichissement
- `fetch-airtable`, `fetch-aircall`
- `fetch-notion-candidates`, `fetch-notion-jobs`, `fetch-notion-schema`
- `scan-career-pages`, `scan-recruiter-linkedin`
- `update-candidate-stage`, `update-notion-job`
- `send-team-invitation` — **permettrait à n'importe qui d'envoyer des invitations**
- `send-transactional-email` — **permettrait à n'importe qui d'envoyer des emails**
- `sequence-send-email`
- `notify-notion`
- `n8n-create-workflow`
- `generate-recruiter-bio`
- `audit-employer-brand`
- `add-to-shortlist`
- `preview-transactional-email`

**Action** : ajouter `await requireAuth(req, corsHeaders)` en tête du handler pour chaque fonction non-webhook/non-cron.

### A2. Vérification d'appartenance à l'organisation manquante

Plusieurs fonctions acceptent `organization_id` dans le body sans appeler `verifyOrgMembership` :

- `unipile-search` — lit/écrit pour une org
- `unipile-accounts` — gère les comptes Unipile d'une org
- `process-sequences` — traite les séquences d'une org
- `add-to-shortlist` — ajoute à une shortlist d'org

Risque : un utilisateur authentifié peut manipuler des données d'autres orgs en modifiant le body. **Action** : ajouter `verifyOrgMembership(admin, auth.userId, organization_id)` après `requireAuth`.

### A3. Duplication de `resolveUnipileCredentials` (4 copies)

4 fichiers redéfinissent la fonction au lieu d'importer depuis `_shared/resolve-org-credentials.ts` :

- `supabase/functions/unipile-search/index.ts:118`
- `supabase/functions/unipile-accounts/index.ts:20`
- `supabase/functions/unipile-manage-webhooks/index.ts:48`
- `supabase/functions/scan-recruiter-linkedin/index.ts:89`

Chaque copie normalise le DSN différemment. Risque : bug de double `https://` ou divergence. **Action** : tout router vers la version `_shared` (qui gère déjà `normalizeDsn`).

---

## B. 🟠 Qualité de code

### B1. TypeScript en mode lax
`tsconfig.app.json` :
```jsonc
"strict": false,
"noImplicitAny": false,
"strictNullChecks": false,   // tsconfig.json
"noUnusedLocals": false,
"noUnusedParameters": false,
```
**655 occurrences de `: any` / `as any`** dans 128 fichiers. Top offenders :
- `src/components/prospection/VivierList.tsx` — 33
- `src/hooks/useLinkedInScoring.ts` — 41
- `src/components/outreach/AutoFillFiltersButton.tsx` — 19
- `src/hooks/useCandidateFullProfile.ts` — 18
- `src/components/outreach/LinkedInSearch.tsx` — 18
- `src/components/outreach/result-card/ProfileDetailSheet.tsx` — 17

**Action** : activer progressivement `strictNullChecks`. Ajouter `npx tsc --noEmit` en pre-commit hook.

### B2. ESLint cassé en runtime
`npx eslint .` échoue :
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@eslint/js'
```
Paquet pourtant déclaré dans `devDependencies`. Ré-installer les deps (`bun install` ou `npm ci`) corrige, mais à vérifier en CI.

### B3. Composants et fonctions obèses

Front (top 5 hors `types.ts` généré) :
| Fichier | Lignes |
|---|---|
| `src/components/prospection/VivierList.tsx` | 2 362 |
| `src/hooks/useMessagesInbox.ts` | 1 604 |
| `src/components/outreach/SequenceBuilder.tsx` | 1 310 |
| `src/components/agent/AgentMessageBubble.tsx` | 1 199 |
| `src/components/outreach/EnrollmentPreviewModal.tsx` | 1 190 |

Edge functions (top 5) :
| Fichier | Lignes |
|---|---|
| `supabase/functions/process-sequences/index.ts` | 2 994 |
| `supabase/functions/score-profile-job/index.ts` | 2 346 |
| `supabase/functions/enrich-company/index.ts` | 1 908 |
| `supabase/functions/unipile-search/index.ts` | 1 878 |
| `supabase/functions/unipile-accounts/index.ts` | 1 072 |

39 composants dépassent 500 lignes au total. **Action** : extraire des sous-modules. Prioriser `VivierList`, `useMessagesInbox`, `process-sequences`.

### B4. useEffect avec deps objet (risque de boucle)
- `src/hooks/useLinkedInSearch.ts` lignes ~341 et ~449 : dep `activeProject?.filters_snapshot` (objet JSON) — nouvelle référence à chaque update du mission/filtres ⇒ re-fire.

**Action** : remplacer par une version sérialisée (`JSON.stringify(...)`) ou un hash/`updated_at`.

### B5. Fragmentation accès Supabase/backend
- **393 appels** `.from()` / `.rpc()` dans **106 fichiers** frontend — gros éparpillement.
- **18 fichiers** construisent directement des URL `fetch()` vers `/functions/v1/` avec `import.meta.env.VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` (ex : `hooks/useNotionCandidates.ts:41`, `pages/Unsubscribe.tsx:17`, `pages/ClientPortal.tsx:51`, `components/portal/PortalCandidateScoring.tsx:62`).

**Action** : router via `src/lib/invokeEdgeFunction.ts` déjà existant. Ajouter une lint rule interdisant les `fetch()` directs vers `/functions/v1/`.

### B6. Accessibilité — boutons icon-only sans `aria-label`
Spot-check : `src/components/outreach/LinkedInSearch.tsx`, `MissionBentoDashboard.tsx` — plusieurs boutons icon-only sans `aria-label`. Lecteurs d'écran muets. **Action** : audit a11y dédié.

### B7. Headers CORS absents sur quelques fonctions
- `process-email-queue/index.ts` — pas de `corsHeaders`
- `process-inmail-queue/index.ts` — pas de `corsHeaders`
- `backfill-knowledge-lake/index.ts` — minimal

OK pour des endpoints purement internes (cron), mais à documenter.

---

## C. 🟡 Observations

- **175 migrations SQL** — bonne discipline, mais un squash faciliterait le setup d'un environnement dev frais.
- **1 seul test** (`aiCredits.test.ts`) pour un produit de cette taille — couverture quasi nulle. Priorités de tests : `useLinkedInSearch`, `score-profile-job`, `settleCredits`, `missionSearchCache` (cache en mémoire qui écrase l'état).
- **Pas de hook pre-commit** pour `tsc` / `eslint` — dépend de la discipline.
- **217 `console.log`** dans 80 fichiers — neutralisés en prod par `vite.config.ts:drop: ["console"]`, non critique.
- **React Query** config saine (`staleTime: 2 min`, pas de refetch au focus, bypass retry 401/403).
- **Code splitting** propre : toutes les pages lourdes sont en `lazy()` (`src/App.tsx:22-42`).
- **Sentry** : sample rates raisonnables (`replaysOnErrorSampleRate: 0.5`).

---

## D. ✅ Ce qui est solide

- Architecture multi-tenant propre dans **27 fonctions** (`requireAuth` + `verifyOrgMembership`).
- **10/10** fonctions qui appellent Anthropic font un `settleCredits` — pas de fuite de crédits.
- **0** `fetch()` brut externe dans les edge functions — tout est en `fetchWithTimeout`.
- **0** ID de modèle déprécié (`claude-sonnet-4-20250514` etc.) dans le code de prod.
- Pas de secrets hardcodés côté frontend.
- `normalizeDsn()` dans `_shared/resolve-org-credentials.ts` — bon format Unipile.
- `ErrorBoundary` monté au root + Sentry capture les mutations error.
- Design system conforme : `AlertDialog` shadcn partout, aucun `window.confirm`.
- Routes protégées : toutes passent par `ProtectedRoute` + `OrganizationGuard`.

---

## E. Plan d'action recommandé (priorisé)

1. **🔴 Sécurité** — ajouter `requireAuth` dans les ~25 fonctions listées en A1. Commencer par `send-team-invitation`, `send-transactional-email`, `apollo-search`, `pdl-search`, `unipile-*`.
2. **🔴 Multi-tenant** — ajouter `verifyOrgMembership` dans les 4 fonctions listées en A2.
3. **🟠 Dédup** — consolider les 4 `resolveUnipileCredentials` locaux vers `_shared` (A3).
4. **🟠 Lint** — réparer `npx eslint .` (re-install de deps ou lockfile).
5. **🟠 React** — corriger la dep objet `filters_snapshot` dans `useLinkedInSearch.ts` (B4).
6. **🟠 TS strict** — activer `strictNullChecks` dans `tsconfig.app.json`, traiter les erreurs au fil de l'eau.
7. **🟡 Tests** — viser un test par hook/edge critique (`useLinkedInSearch`, `useLinkedInScoring`, `score-profile-job`, `process-sequences`).
8. **🟡 Refactor** — découper `VivierList.tsx` (2 362 l), `useMessagesInbox.ts` (1 604 l), `process-sequences/index.ts` (2 994 l).
9. **🟡 A11y** — passe d'accessibilité sur `LinkedInSearch` et `MissionBentoDashboard`.
10. **🟡 DX** — pre-commit hook : `tsc --noEmit` + `eslint --max-warnings 0`.
