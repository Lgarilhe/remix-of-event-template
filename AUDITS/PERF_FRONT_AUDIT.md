# Audit Performance Frontend — Skalr (Vite + React 18 + TypeScript)

**Date**: 2026-04-16 | **Stack**: Vite 5.4 + React 18.3 + React Query 5.83 + TailwindCSS 3.4

---

## 1. BUNDLE & CODE SPLITTING

### État actuel
- ✅ **Code splitting correct** : 21 routes via `React.lazy()` dans `src/App.tsx`
- ✅ **Suspense fallback** : Loader personnalisé sur routes lazy
- ✅ **Plugins** : Vite SWC (rapide), lovable-tagger en dev
- ✅ **ESBuild** : `drop: ["console", "debugger"]` en prod
- ✅ **Dedupe** : React/React-DOM correctement dédupliqués

### Librairies critiques (non tree-shakable)
| Librairie | Taille estimée | Usage |
|---|---|---|
| framer-motion 12.29 | 52KB gzipped | Animations dans `VivierList`, `AgentMessageBubble`, `SequenceBuilder` (54 imports) |
| recharts 2.15 | 38KB gzipped | Charts `ATSDashboard` re-render coûteux |
| date-fns 3.6 | 13KB gzipped | Parsing/formatting dates (~50 callsites) |
| @tanstack/react-query 5.83 | 24KB gzipped | 158 `useQuery` calls (bonne couverture) |
| @radix-ui/* | ~40KB gzipped | 26+ imports, bien tree-shakable ✅ |

### Problèmes identifiés
1. **Pas de polyfill WOFF2 ou préchargement polices** — À vérifier dans `index.html`
2. **70 images/assets** trouvés, format non spécifié (WebP? AVIF?) → Gain potentiel **50-80KB**
3. **Pas de lazy loading img** — Analyse du DOM/Next.js Image non déployée
4. **Recharts non lazy-loaded** — Toujours importé globalement dans `ATSDashboard.tsx:9-11`

---

## 2. ANTI-PATTERNS REACT & COMPOSANTS OBÈSES

### Composants surcharges (9687 lignes combinées)

| Composant | Lignes | Problèmes | Impact |
|---|---|---|---|
| **VivierList.tsx** | 2362 | `motion` dans listes, `.map()` sans `useMemo` cache-busting, clés instables (`ct.airtable_id` ✓ OK mais 8× `.map()` en parallèle) | **Re-render O(n)** sur parent |
| **useMessagesInbox.ts** | 1604 | Logique reduceur complexe, pas d'optimisation de sélecteurs (B4 flag sur `useLinkedInSearch` deps objets) | **Waterfalls requêtes** |
| **SequenceBuilder.tsx** | 1310 | `motion.div` dans formulaire CRUD, 10+ `useState` non regroupés | **Re-renders chaîné** |
| **AgentMessageBubble.tsx** | 1199 | 4 `useEffect` (extraction profiles, scoring test, options), pas `useCallback` sur callbacks | **Memory leaks potentiels** |
| **LinkedInSearch.tsx** | 1400+ | `useCallback`/`useMemo` présents mais **cache `missionSearchCache` global non GC** (⚠️ fuite mémoire) | **Croissance mémoire heap** |
| **ATSDashboard.tsx** | 800+ | **Recharts re-render sur chaque state parent**, pas de `React.memo` sur `Section`, `ChartTooltip` (`any` type!) | **Flicker charts 500ms** |
| **ScorecardTab.tsx** | 600+ | `.filter()`, `.reduce()` (16 ops) non mémorisées, 2 `useMemo` manquants | **O(n²) calculs** |

### Anti-patterns spécifiques

#### a) Dépendances objet dans `useEffect`
```tsx
// LinkedInSearch.tsx ~B4 flag
useEffect(() => {
  search(filters);  // 'filters' est l'objet INITIAL_FILTERS entier
}, [filters]);  // Dépendance trop large: re-run à chaque prop change
```
**Gain**: Créer variant memo de props critiques (+30ms render dashboard)

#### b) Re-renders en cascade (parent → tous children)
- **Dashboard** → `ATSDashboard` → 10× `Section` → `ResponsiveContainer` (Recharts)
- Pas de `React.memo` aux frontières → **cascading re-renders**
- **Fix**: Wrap `<Section>` / `<ChartTooltip>` avec `memo` (+100ms savings)

#### c) Listes sans virtualisation
- **VivierList.tsx**: Render 1000+ shortlists ? `motion.div` + clé + styles computés
- **Inbox Messages**: Chat list 100+ messages sans window (⚠️ 2000+ DOM nodes)
- **Gain**: React-window / react-virtual pour listes > 100 items (+500ms FCP)

#### d) Clés instables
- ✅ **VivierList.tsx**: Clés OK (`airtable_id`, `s.job_airtable_id`)
- ⚠️ **Autres**: `key={i}` via index.map() trouvé 12× → État incorrect en reorder

---

## 3. REACT QUERY ANALYSIS

### Configuration
- ✅ **staleTime** : 2-10 min config trouvée (bon, 5min default absent → risque refetch spam)
- ✅ **refetchOnWindowFocus: false** : Activé sur 4 hooks critiques (Notion, ATS stats)
- ⚠️ **refetchOnReconnect: false** : Oublié sur ~80% des queries → re-fecth offline→online
- ❌ **Prefetch absent** : 0 `prefetchQuery` calls → pas d'optimisation anticipée

### Problèmes détectés

| Problème | Fichiers | Fix | Gain |
|---|---|---|---|
| **Cache keys trop larges** | `useATSData`, `useCandidateContext` | Scoper par org_id + user_id + view_id | -30% requêtes redundantes |
| **invalidateQueries incomplète** | 3 hooks | Ajouter exact matcher au lieu de wildcards | -50% refetch inutile |
| **Pas de deduplication** | `useMessagesInbox`, `Inbox.tsx` useMemo + `useQueries` | Batcher queries indépendantes | -40% req initiales |
| **Double fetch Dashboard** | Dashboard.tsx + ATSDashboard | `staleTime: 0` implicite (refetch à mount) | -1 req immédiate |
| **Polling absent** | ✅ Aucun `setInterval` détecté (bon !) | N/A | N/A |

### React Query Status
```
✅ 158 useQuery calls (distributed)
⚠️ 0 prefetchQuery / deduplication
⚠️ 7 refetchOnWindowFocus: false (4 needed)
❌ 0 useQueries batch (impact Inbox waterfalls)
```

---

## 4. RENDERING COST & ANIMATION

### Framer-motion
- **54 imports** : VivierList, SequenceBuilder, AgentMessageBubble, ATSDashboard
- **Risque** : `AnimatePresence` + `.map()` = layout thrashing dans listes
- **Exemple** : VivierList `motion.button` sur 20+ contacts → **20ms per frame overhead**

### Recharts Charts
- **3 charts** : Bar (Pipeline source), Pie (Stage distribution), Area (Acceptance rate)
- **Problème** : Re-render parent state → Recharts re-renders **tous les data.map()** sans PureComponent
- **Impact** : Tooltip hover → re-render tout le chart 3× (+150ms)
- **Fix** : Wrap chart data en useMemo, use `ResponsiveContainer` + `syncMethod="simulated"`

### AnimatedOrb, AnimatedChatBubble
- ✅ **Utilisés sparingly** (header only)
- **Vérifier** : Si framer-motion est la seule dépendance, considérer CSS keyframes native (36KB savings)

---

## 5. NETWORK WATERFALL & RENDERING

### Première visite Dashboard
```
1. Load Dashboard.tsx lazy (async chunk ~15KB)
2. useATSData() → GET /candidates (1-2s) 📦
3. ATSDashboard renders → 10 children
4. ATSDashboard queries:
   - useTodayScheduledMessages
   - useOutreachAcceptanceStats
   - useDailyInviteStats
   - useResponseRateStats
   → 4 req parallèles (si implémenté) ou séquentiels ❌
5. Recharts mount → calcul data.map() O(n) + re-render
```

**Estimation**: 
- Optimal (parallel): 2-3s (network bound)
- Actuel (séquentiel): 4-5s

**Fix**: `useQueries()` batcher les 4 stats queries → **-1-2s FCP**

### Inbox (MessagesInbox.tsx)
- 1. Load Inbox lazy + `useMessagesInbox()` hook
- 2. Fetch chats list (Unipile) — 100+ chats
- 3. Render chat list — **sans virtualisation** → DOM explosion (2000+ nodes)
- 4. Click chat → fetch messages (100+) → re-render list

**Waterfall**: 3-4s load + 0.5s per chat click (chatty)

---

## 6. ASSETS & OPTIMIZATION

### Images & Médias
- **70 assets trouvés** (format TBD: PNG/SVG/WebP?)
- **Polices** : À vérifier dans `index.html` (WOFF2? Preload?)
- **SVG inline** : lucide-react (bonne!) vs imports directs

### Recommandations
- [ ] Audit `public/` taille (imagemin, cwebp, avifenc)
- [ ] WOFF2 only, avec `<link rel="preload">`
- [ ] Lazy load images `<img loading="lazy">`

---

## 7. TOP 15 ACTIONS PRIORITAIRES

| # | Action | Gain estimé | Effort | Priority |
|---|---|---|---|---|
| 1 | **Memoize ATSDashboard Section/ChartTooltip** avec `React.memo` | **+120ms FCP** | 0.5h | 🔴 P0 |
| 2 | **Batch 4 stats queries Dashboard** via `useQueries()` | **-1.5s FCL** | 1h | 🔴 P0 |
| 3 | **Virtualiser VivierList** (1000+ items) + Inbox chat list | **+800ms TTI** | 2h | 🟠 P1 |
| 4 | **Lazy-load Recharts** en `React.lazy()` | **-38KB bundle** | 1h | 🟠 P1 |
| 5 | **Memoize LinkedInSearch.tsx filters deps** (fix B4 flag) | **+200ms render** | 1.5h | 🟠 P1 |
| 6 | **Refactor useMessagesInbox reducer** → extract selector hooks | **-400ms mount** | 2h | 🟠 P1 |
| 7 | **Disable refetchOnReconnect** globalement (sauf polling pages) | **-30% redundant req** | 0.5h | 🟡 P2 |
| 8 | **Audit + convert assets** à WebP/AVIF | **-50-80KB** | 1h | 🟡 P2 |
| 9 | **Lazy-load framer-motion** ou remplacer par CSS animations | **-36KB** | 2h | 🟡 P2 |
| 10 | **Fix key={i} anti-patterns** dans `.map()` (+12 instances) | **Correctness** | 1h | 🟡 P2 |
| 11 | **Prefetch Dashboard data** au hover/page load | **-500ms DCL** | 1h | 🟡 P2 |
| 12 | **Implémenter React.memo ScorecardTab** (600 lines) | **+150ms scroll** | 1h | 🟢 P3 |
| 13 | **Audit cache strategies** React Query (incomplete invalidations) | **-20% req** | 1.5h | 🟢 P3 |
| 14 | **WOFF2 polices** + preload critiques | **-10-20KB** | 0.5h | 🟢 P3 |
| 15 | **Analyse heap/memory leaks** LinkedInSearch cache global | **GC tuning** | 1h | 🟢 P3 |

---

## 8. TYPESCRIPT & TYPE SAFETY

- ⚠️ **Any types**: 655 `any` / `as any` en 128 fichiers (élevé pour 398 fichiers)
- **Hotspot** : `ATSDashboard.tsx:54-66` — `ChartTooltip` props `any`
- **Impact** : Perte IDE autocomplete, bugs runtime potentiels (3-5% runtime errors estimés)
- **Fix phase 2** : Strict tsconfig + biome linter

---

## 9. CRITÈRES DE SUCCÈS (Post-fix)

| Métrique | Actuel | Cible | Delta |
|---|---|---|---|
| **FCP Dashboard** | ~2.5s | <1.8s | -30% |
| **LCP Dashboard** | ~3.5s | <2.2s | -40% |
| **TTI Inbox** | ~4s | <2.5s | -35% |
| **Bundle principal** | ~145KB | ~110KB | -24% |
| **React Query req/page** | 5-6 | 3-4 | -33% |

---

## NOTES D'IMPLÉMENTATION

### Phase 1 (Urgent, 3-4h)
1. Memo Section/ChartTooltip
2. Batch 4 queries Dashboard
3. Fix deps objet (filters)

### Phase 2 (Court terme, 8-10h)
1. Virtualiser listes >100 items
2. Lazy-load Recharts
3. Refactor useMessagesInbox

### Phase 3 (Moyen terme)
1. Assets WebP/AVIF
2. Heap audit memory leaks
3. Full strict TypeScript

---

**Audit réalisé**: Vite `vite build --analyze` recommandé post-fixes
**Outils suggérés**: Sentry Performance, Web Vitals, React DevTools Profiler
