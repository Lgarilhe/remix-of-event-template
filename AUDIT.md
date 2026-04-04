# Audit technique du projet Skalr

_Audit automatique — 2026-04-04_

---

## 1. TODOs et FIXMEs

| Fichier | Ligne | Commentaire |
|---------|-------|-------------|
| `src/hooks/useConnectors.ts` | 199 | `TODO: invoke connector-sync edge function` — fonctionnalité non implémentée |
| `supabase/functions/stripe-webhook/index.ts` | 385 | `TODO: Send email notification to client` — notification manquante |

Seulement 2 TODO trouvés. Aucun FIXME, HACK, WORKAROUND, XXX dans la codebase.

---

## 2. Fichiers critiquement volumineux (>800 lignes)

| Fichier | Lignes | Risque |
|---------|--------|--------|
| `src/integrations/supabase/types.ts` | 5 151 | Auto-généré, OK |
| `supabase/functions/process-sequences/index.ts` | 2 926 | Monolithe, devrait être découpé |
| `supabase/functions/score-profile-job/index.ts` | 2 346 | Monolithe |
| `supabase/functions/enrich-company/index.ts` | 1 908 | Monolithe |
| `supabase/functions/unipile-search/index.ts` | 1 795 | Monolithe |
| `src/components/prospection/VivierList.tsx` | 1 729 | Composant massif |
| `src/hooks/useMessagesInbox.ts` | 1 604 | Hook très complexe |
| `src/components/outreach/SequenceBuilder.tsx` | 1 310 | Composant massif |
| `src/components/agent/AgentMessageBubble.tsx` | 1 199 | |
| `src/components/outreach/EnrollmentPreviewModal.tsx` | 1 190 | |
| `src/components/outreach/projects/CreateProjectModal.tsx` | 1 133 | |
| `src/components/ats/ScorecardTab.tsx` | 1 111 | |
| `supabase/functions/unipile-accounts/index.ts` | 1 072 | |
| `supabase/functions/fetch-notion-jobs/index.ts` | 1 071 | |
| `src/components/ats/ATSDashboard.tsx` | 1 064 | |
| `src/components/outreach/search/SearchResultsPanel.tsx` | 1 044 | |
| `src/components/outreach/LinkedInSearch.tsx` | 1 043 | |

**Total : 488 fichiers TS/TSX, 137 292 lignes.**

---

## 3. Type safety — Assertions dangereuses

### `as any` / `as unknown` (50+ instances)

**Les plus critiques :**

| Fichier | Lignes | Contexte |
|---------|--------|----------|
| `ScorecardTab.tsx` | 209-213, 239-277, 365 | Données d'évaluation non typées |
| `LiveCoachingPanel.tsx` | 102, 141, 274, 293, 296 | Résultats AI non typés |
| `LinkedInResultCard.tsx` | 138, 140 | Champs profil manquants du type |
| `ATSDashboard.tsx` | 159-160 | Propriété `accent` non typée |
| `WorkflowAddNode.tsx` | 12 | `data as unknown as AddNodeData` |
| `WorkflowStepNode.tsx` | 52 | `data as unknown as StepNodeData` |
| `ScoringCard.tsx` | 32 | `as any[]` sur dimensions |

### @ts-nocheck

| Fichier | Raison |
|---------|--------|
| `supabase/functions/add-to-shortlist/index.ts` | `// @ts-nocheck serve import removed` — checking désactivé sur tout le fichier |

---

## 4. Erreurs silencieuses (catch vides)

15+ catch blocks qui avalent les erreurs sans les tracer :

| Fichier | Ligne | Contexte |
|---------|-------|----------|
| `ATSDashboard.tsx` | 182, 240 | Parsing de dates |
| `LiveCoachingPanel.tsx` | 288, 851 | Copie clipboard, fetch |
| `AgentMessageBubble.tsx` | 23, 50 | JSON parse |
| `CreateProjectModal.tsx` | 109, 371 | URL validation |
| `LinkedInAccountManager.tsx` | 24 | Config parse |
| `VivierList.tsx` | 1123 | Donnée invalide |
| `ProspectResults.tsx` | 30, 68 | Enrichissement |
| `CandidateHistoryPanel.tsx` | 264 | Historique |

**Recommandation :** Remplacer les `catch {}` par `catch (e) { console.warn(...) }` au minimum, ou mieux, par du reporting Sentry.

---

## 5. Console.log/warn en production

30+ instances de logging laissées dans le code de production :

**Les plus verbeux :**
- `SearchResultsPanel.tsx` : 5 `console.log` de debug sur les enrichissements (lignes 565-573)
- `ScorecardTab.tsx` : 4 `console.warn`/`console.error`
- `LiveCoachingPanel.tsx` : 6 logging statements
- `JobSelector.tsx` : `console.log('[JobSelector] Hydrating job...')`

---

## 6. Magic numbers et timeouts non documentés

### Timeouts arbitraires (workarounds probables)

| Fichier | Valeur | Contexte |
|---------|--------|----------|
| `ScorecardTab.tsx` | 3000ms | Auto-save timeout |
| `LiveCoachingPanel.tsx` | 12000ms | `COACH_INTERVAL_MS` — intervalle de coaching |
| `LiveCoachingPanel.tsx` | 1500ms | `utterance_end_ms` pour Deepgram |
| `JobCard.tsx` | 100ms | Délai animation |
| `AgentThinkingDisplay.tsx` | 1000ms | Collapse délai |
| `OutreachMessageModal.tsx` | 2000ms | Reset "copié" |
| `CreateProjectModal.tsx` | 100ms | Délai avant scan |
| `fetch-aircall/index.ts` | 1100ms | Rate limiting entre requêtes paginées |
| `backfill-knowledge-lake/index.ts` | 5000ms | Délai entre batches |
| `ai-chat-completion/index.ts` | 2000ms | Retry delay |
| `generate-reply-suggestions/index.ts` | 15000ms | Abort timeout |

### Random jitter (anti-détection / rate limiting)

| Fichier | Pattern |
|---------|---------|
| `process-inmail-queue/index.ts` | Random 0-30min offset, heures 8h-10h random |
| `process-sequences/index.ts` | Random 0-10s jitter entre actions |
| `run-agent-search/index.ts` | Backoff 5s-30s avec `Math.pow(2, attempt)` |

### Exponential backoff (10+ implémentations indépendantes)

Pattern dupliqué dans : `notify-notion`, `fetch-notion-schema`, `fetch-notion-jobs`, `add-to-shortlist`, `update-notion-job`, `fetch-airtable`, `score-profile-job`, `generate-search-filters`, `_shared/ai-config.ts`.

**Recommandation :** Centraliser dans un utilitaire `retryWithBackoff()` dans `_shared/`.

---

## 7. Suppressions ESLint

| Fichier | Rule supprimée | Raison documentée ? |
|---------|----------------|---------------------|
| `LinkedInSearch.tsx:99` | `react-hooks/exhaustive-deps` | Non |
| `useAirtableMatch.ts` | `react-hooks/exhaustive-deps` | Non |
| `App.tsx` | `react-hooks/exhaustive-deps` | Non |
| `useSavedFilterPresets.ts` | `@typescript-eslint/no-explicit-any` | Non |

---

## 8. Patterns récurrents NON documentés dans CLAUDE.md

### 8.1 Pattern d'invocation d'edge functions (3 wrappers)

```
invokeEdgeFunction  — wrapper générique avec org_id auto-injecté, timeout 55s
invokeUnipile       — wrapper Unipile avec retry sur erreurs réseau
invokeWithCredits   — wrapper avec vérification de crédits pré/post
```

**Non documenté :** la hiérarchie de ces wrappers et quand utiliser lequel.

### 8.2 Pattern d'erreur transient vs définitif

```
authSession.ts définit:
- isDefinitiveInvalidSessionError() → JWT, missing claims, expired, 401
- isTransientValidationError() → network, timeout, fetch failures
```

Utilisé dans `authSession`, `invokeUnipile`, `invokeEdgeFunction`. **Non documenté dans CLAUDE.md.**

### 8.3 Pattern React Query

```
STALE_TIME = 30min (useATSData, d'autres hooks), 5min (useSourcingProjects)
GC_TIME = 60min
refetchOnWindowFocus = false
Pagination manuelle pour >1000 items (PAGE_SIZE = 1000, boucle de fetch)
Optimistic updates avec rollback dans useATSData
```

**Non documenté.** Un développeur pourrait utiliser des valeurs incohérentes.

### 8.4 Pattern d'authentification

```
1. withTimeout(4000ms) pour toutes les opérations auth
2. Classification transient/définitif de l'erreur
3. clearCorruptedTokens() si erreur définitive
4. ProtectedRoute → useAuthReady() → spinner → redirect /auth
```

**Non documenté.**

### 8.5 Pattern de debounce avec useRef

```javascript
const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
debounceRef.current[key] = setTimeout(() => { ... }, delay);
```

Utilisé dans `LinkedInFilters`, `useLinkedInSearch`, `MissionBrief`. **Pas de helper partagé, pattern dupliqué.**

### 8.6 Pattern de persistence dual (localStorage + DB)

`useModelPreference` : écriture localStorage immédiate + sync DB fire-and-forget. **Non documenté, risque de désync.**

### 8.7 Polling intervals

| Contexte | Intervalle | Fichier |
|----------|-----------|---------|
| Messages inbox | 30s + 5s | `useMessagesInbox.ts` |
| LinkedIn accounts health check | 5min | `LinkedInAccountsContext.tsx` |
| Email account check | Variable | `MyEmailAccount.tsx` |

**Non documenté.** Risque de surcharge API si plusieurs onglets ouverts.

### 8.8 Valeurs françaises hardcodées

- `ATSDashboard.tsx` : stages `'Répondu'`, `'Gagné'`, `'Nouveau'`
- Toasts et messages d'erreur en français dans `invokeEdgeFunction`, `invokeUnipile`
- **Pas d'i18n**, tout est en dur. **Non documenté.**

### 8.9 ID generation avec Date.now()

```javascript
// BriefWizard.tsx:599
id: `crit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
```

Pattern fragile pour la génération d'IDs. `crypto.randomUUID()` serait plus sûr.

### 8.10 Unsafe list keys

`VivierList.tsx:1058` utilise l'index de tableau comme clé React (`key={i}`) au lieu d'un ID stable.

---

## 9. Fonctionnalités non implémentées / stubs

| Fichier | Ce qui manque |
|---------|---------------|
| `useConnectors.ts:199` | `connector-sync` edge function jamais appelée |
| `stripe-webhook/index.ts:385` | Notification email client pas envoyée |
| `process-email-queue/index.ts:21` | Retry désactivé ("won't help") |

---

## 10. Sécurité

| Risque | Fichier | Détail |
|--------|---------|--------|
| Clé master exposée | `deepgram-temp-key/index.ts:76` | WARNING dans le code : la master key Deepgram est exposée si `DEEPGRAM_PROJECT_ID` non configuré |
| @ts-nocheck | `add-to-shortlist/index.ts` | Vérification TypeScript désactivée |

---

## 11. Ce qui DEVRAIT être ajouté au CLAUDE.md

### Sections manquantes recommandées :

1. **Edge Function Wrappers** — Documenter `invokeEdgeFunction` vs `invokeUnipile` vs `invokeWithCredits` et quand utiliser chacun
2. **Error Classification Pattern** — Transient vs définitif (`authSession.ts`)
3. **React Query Conventions** — Stale times, GC times, pagination >1000 items, optimistic updates
4. **Auth Flow** — `withTimeout(4000ms)`, `clearCorruptedTokens`, `ProtectedRoute` guard
5. **Polling Intervals** — Liste des intervalles actifs et risque multi-onglet
6. **i18n** — Mentionner explicitement que les strings sont en français, pas d'i18n
7. **Exponential Backoff** — 10+ implémentations indépendantes, standardiser
8. **Edge Functions manquantes** — `connector-sync` (référencé mais inexistant)
9. **Debounce Pattern** — Le pattern useRef utilisé partout
10. **Console Logging Policy** — Définir ce qui est acceptable en prod

### Mises à jour de sections existantes :

- **Code Map > Edge Functions** : Ajouter `live-coach`, `deepgram-temp-key`, `fetch-aircall`, `enrich-vivier-contacts`, `backfill-knowledge-lake`, `run-agent-search`, `notify-notion`, `fetch-notion-*`, `update-notion-job`, `fetch-airtable` (tous absents)
- **Common Pitfalls** : Ajouter les `as any` dans ScorecardTab/LiveCoachingPanel, les catch vides, le warning Deepgram
- **Key Hooks** : Ajouter `useConnectors`, `useMessagesInbox`, `useModelPreference`, `useATSData`, `useSavedFilterPresets`, `useAirtableMatch`
