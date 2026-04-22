# Master TODO — agrégation de tous les audits

Date : 2026-04-22
Sources : 19 fichiers d'audit dans `AUDITS/` + racine + `docs/rls-fix-plan.md`
Total estimé : ~138h dev (5 priorités)

Ce fichier est l'unique source de vérité pour le backlog. Si un TODO est résolu, supprime-le ou marque `[DONE]`. Si une nouvelle action sort d'un audit, ajoute-la ici.

---

## 🔴 Critique sécurité (à faire dans la semaine)

### S1. Webhooks sans vérification de signature → ~30min ⚠️ PARTIEL
- ❌ `sequence-webhooks-handler/index.ts` (450 lignes) : à analyser et signer
- ✅ `sequence-email-track/index.ts` : endpoint public (tracking pixel) — signature impossible sans casser les emails clients. Cap MAX_EVENTS_PER_TRACKING=100 déjà en place comme garde-fou. À renforcer avec rate limit par IP si abus constaté.
- `sequence-email-track/index.ts` : aucune verif (tracking pixel = facile à spoof, peut polluer les analytics)
- `sequence-webhooks-handler/index.ts` : fallback `UNIPILE_WEBHOOK_SECRET` mais pas obligatoire
- **Fix** : forcer la verif HMAC, refuser si secret absent. Pattern à reprendre de `handle-email-suppression` (Svix-style).
- Source : `AUDITS/SECURITY_DEEP_AUDIT.md` §4

### S2. IDOR sur 5 endpoints → ~2h ✅ AUDITÉ
Vérification 22/04 : les 5 endpoints ont DÉJÀ des checks `verifyOrgMembership` inline.
Helper standardisé `requireOrgAccess()` ajouté dans `_shared/require-auth.ts` pour les futurs endpoints.
Refacto progressif des 13 endpoints existants à scheduler (low priority).
- Source : `AUDITS/SECURITY_DEEP_AUDIT.md` §2

### S3. Rate limiting absent sur endpoints coûteux ✅ DONE
- ✅ `apollo-search` : 30 req/min/user
- ✅ `pdl-search` : 20 req/min/user
- ✅ `run-agent-search` : 10 req/min/user
- ✅ `unipile-search` : déjà en place (189: check_rate_limit)
- Source : `AUDITS/SECURITY_DEEP_AUDIT.md` §5

### S4. Sentry — fuite PII potentielle → ~30min
Le DSN Sentry est public (ok), mais le scope par défaut envoie `request.headers.cookie`, `request.body`, `user.email`. Pour un SaaS multi-tenant RGPD, scrub ces champs avant envoi.
- **Fix** : `Sentry.init({ beforeSend: scrubPII })` dans `src/main.tsx`.
- Source : `AUDITS/SECURITY_DEEP_AUDIT.md` §3 + `AUDIT_REPORT.md`

### S5. RLS — `portal_tokens` exposition `anon` ✅ DONE (migration 20260422140000)

### S6. CORS trop permissif sur edge functions ✅ HELPER CREE
Helper `_shared/cors.ts` créé avec :
- `buildCorsHeaders(req)` : echo l'origin si dans allowlist (default : prod + 2 localhost)
- `corsHeaders` legacy export pour compat (échantillon `*` ou prod par défaut)
- Env var `ALLOWED_ORIGINS` (comma-separated, ou `*` pour wildcard)

Migration progressive des 77 fonctions à scheduler (s/`const corsHeaders = {...}`/`import { buildCorsHeaders } from '../_shared/cors.ts'`/`).
- Source : `AUDITS/SECURITY_DEEP_AUDIT.md` §6

### S7. RLS phase 2 — 12 tables avec gaps ✅ DONE (migration 20260422140000)
Vérifié en prod : la majorité des USING(true) ont été fixés par migration 20260416. Les 2 derniers trous (`mission_invitations` lecture publique + `airtable_sync_meta`) sont fixés dans 20260422140000_rls_phase2_consolidation.sql.

### S8. Logs d'audit — manque d'historique → ~3h (gros)
Aucune table `audit_log` pour tracer les actions sensibles (suppression mission, modif config, accès portal). Obligation RGPD si on commercialise.
- **Fix** : table `audit_logs (org_id, user_id, action, resource_type, resource_id, payload, ip, user_agent, created_at)` + trigger sur tables sensibles.
- Source : `AUDITS/SECURITY_DEEP_AUDIT.md` §7

---

## 🟠 Quick wins (< 1h chacun, à enchaîner aujourd'hui)

### Q1. SEO — fix `index.html` placeholders Lovable → 5min
`<title>` = "Skalr" (3 mots). `<meta description>` = "Lovable Generated Project". `<html lang="en">` alors que landing FR. `og:title` = "figma-pixel-perfect-559". Twitter `@lovable_dev`.
- **Fix** : remplacer par valeurs réelles Konekt/Skalr en français.
- Source : `AUDITS/SEO_LANDING_AUDIT.md` §1

### Q2. SEO — `robots.txt` + `sitemap.xml` → 10min
robots.txt présent mais minimal. Pas de sitemap. Google + Bing ratent les pages publiques (Pricing, Privacy, etc.).
- **Fix** : générer sitemap statique (5 URLs publiques), ajouter `Sitemap:` dans robots.
- Source : `AUDITS/SEO_LANDING_AUDIT.md` §3

### Q3. Hide `web_search` stub tool de Claude → 5min
`web_search` dans `search-agent-chat/index.ts:370` retourne "not available". On l'expose à Claude mais il plante l'appel. Mieux : le retirer tant que pas implémenté (ou implémenter via Perplexity/Tavily — plus gros chantier).
- **Fix** : commenter la définition de `web_search` dans `sourcingTools` array.
- Source : `RAG_AGENT_AUDIT.md` §2

### Q4. Renommer `Admin.tsx` → `Settings.tsx` (déjà fait?) → 5min
La page principale settings est dans `src/pages/Settings.tsx` (vu via grep). Le nom "Admin" serait peut-être historique. À vérifier qu'aucun import legacy n'existe.
- Source : `FEATURE_AUDIT.md` (à valider)

### Q5. Lazy-load Recharts → 15min
`recharts` est importé globalement dans `ATSDashboard.tsx:9-11` (38KB gzipped chargé sur toutes les routes lazy). Wrap avec `React.lazy()` au niveau du dashboard.
- **Fix** : `const RechartsContent = React.lazy(() => import('./RechartsCharts'))` + Suspense fallback.
- Source : `AUDITS/PERF_FRONT_AUDIT.md` §1

### Q6. ESLint warnings — fix les `any` types isolés → 20min
~15 occurrences de `: any` sans raison (vs justifiées comme `as any` pour Supabase types). Ne casse rien mais alerte le linter.
- **Fix** : `npm run lint:fix` puis revue manuelle des warnings restants.
- Source : `AUDITS/TESTS_AUDIT.md` §3

### Q7. Optimisation image WebP → 15min
70 images dans `public/` au format png/jpg. Conversion WebP = -50 à -80 KB par page.
- **Fix** : script `npm run optimize-images` (sharp) à ajouter à `package.json`.
- Source : `AUDITS/PERF_FRONT_AUDIT.md` §1.3

### Q8. Favicon manquant → 5min
`index.html` n'a aucune balise `<link rel="icon">`. Le `vite.svg` par défaut s'affiche.
- **Fix** : ajouter favicon Konekt (existe déjà dans assets) + apple-touch-icon.
- Source : `AUDITS/SEO_LANDING_AUDIT.md` §1

### Q9. Fix `useLinkedInSearch` deps `useEffect` → 15min
`useEffect(() => { search(filters); }, [filters])` — `filters` est l'objet entier `INITIAL_FILTERS`. Re-run à chaque prop change. Solution : split en primitive deps (`filters.api`, `filters.location.id`...).
- Source : `AUDITS/PERF_FRONT_AUDIT.md` §2.a

### Q10. Web Analytics — GA4 ou Plausible → 20min
Aucune analytics côté front. Pas de tracking événements sourcing/onboarding/conversion. Pour piloter le produit en prod, indispensable.
- **Fix** : ajouter Plausible (RGPD-friendly, pas de cookies bannière) ou GA4.
- Source : `AUDITS/SEO_LANDING_AUDIT.md` §6 + `AUDIT_REPORT.md`

---

## 🟡 Important (1-4h chacun, sprint courant)

### I1. Refactor `search-agent-chat` (925 lignes) → 3h
Le fichier hardcode 3 modes (brief/process/sourcing/outreach) + tools + retrieval RAG. À découper :
- `_shared/agent-modes.ts` (system prompts par mode)
- `_shared/agent-rag.ts` (retrieval contextuel)
- `_shared/agent-tools-readonly.ts` (sourcingTools déplacés ici)
- `index.ts` réduit à l'orchestration
- Source : `RAG_AGENT_AUDIT.md` §2

### I2. Re-ranking Claude-as-reranker ✅ DONE
`retrieve-context` fetch désormais `limit*4` (max 30) puis rerank via Claude Haiku tool_use (rank_chunks 0-10). Filtre les < 3/10 (clairement non pertinents), trie par score, renvoie top `limit`. Toggle via `rerank: false` dans le body.

### I3. Dédoublonner les vues "candidat" → 2h
3 endroits différents affichent un candidat avec 3 layouts différents : `LinkedInResultCard`, `ProfileDetailSheet`, `CandidateDetailModal`. Harmoniser via composant unifié `CandidatePreview` avec variants `compact|expanded|modal`.
- Source : `AUDITS/DATA_MODEL_AUDIT.md` + `DESIGN_AUDIT.md`

### I4. Harmoniser les types Candidate → 2h
4 interfaces différentes : `LinkedInProfile`, `CandidateRow`, `JobCandidateStatus`, `EnrichedCandidate`. Définir un canonical `Candidate` dans `src/types/candidate.ts` + adapters.
- Source : `AUDITS/DATA_MODEL_AUDIT.md`

### I5. Consolider les hooks dupliqués → 3h
- `useAirtableMatch` + `useNotionMatch` → un seul `useCandidateMatch` (préparation sortie Airtable)
- `useCandidateHistory` + `useProfileActivity` → un seul `useCandidateActivity`
- `useFilteredResults` + `useFilteredLinkedInAccounts` → unifier
- Source : `AUDITS/DATA_MODEL_AUDIT.md`

### I6. Tests Playwright — étendre coverage → 4h
3 tests existent (auth, landing, protected-routes). Coverage actuel ~0.5 %. Cibles minimum :
- Onboarding complet
- Création mission
- Sourcing LinkedIn → score
- Outreach séquence
- Source : `AUDITS/TESTS_AUDIT.md`

### I7. Session recovery sur erreur 401 ✅ DONE
`invokeEdgeFunction` détecte les 401 → appelle `supabase.auth.refreshSession()` → retry une fois avec le nouveau token. Si le refresh échoue, l'erreur 401 remonte (l'user doit se reconnecter).

### I8. Error boundaries par section ✅ DONE
- `MissionWorkspace` : SectionErrorBoundary autour des 8 tabs (déjà fait dans le merge précédent)
- `AgentDrawer` : SectionErrorBoundary ajoutée dans App.tsx (un crash du chat ne plante plus l'app)
- Source : `AUDITS/PERF_FRONT_AUDIT.md` §5

### I9. Design tokens — virer les couleurs hardcoded ⚠️ TRACKING
Audit 22/04 : 25+ occurrences `bg-(teal|indigo|emerald|sky|cyan|rose|fuchsia|amber|lime)-NNN`. La plupart sont **contextuellement justifiées** (amber=warnings, emerald=success-temp).
Action : refacto au fur et à mesure des touches sur les fichiers concernés. Pas de bulk sed (risque de régression visuelle).
Cas critique fixé : `bg-teal-500` dans CardStatusBadges (badge Airtable) → `bg-success` lors du merge audit-sourcing-interface.
- Source : `DESIGN_AUDIT.md`

### I10. Réduire taille des composants obèses → 4h
- `VivierList.tsx` 2362 lignes
- `SequenceBuilder.tsx` 1310 lignes
- `AgentMessageBubble.tsx` 1199 lignes
- Cible : < 500 lignes/composant. Extraction sous-composants + hooks.
- Source : `AUDITS/PERF_FRONT_AUDIT.md` §2

### I11. A11Y — fixer les warnings axe-core évidents → 2h
- Boutons sans `aria-label` (icon-only buttons)
- Contrastes insuffisants (texte secondaire sur fond)
- Modals sans `aria-modal="true"` + focus trap
- Inputs sans `<label htmlFor>` associé
- Source : `AUDITS/A11Y_AUDIT.md`

### I12. Désactiver `web_search` proprement (Sprint 5 plan) → 3h
Au lieu de juste hide (Q3), implémenter via Perplexity Sonar ou Tavily. Cache 24h sur les requêtes identiques.
- Source : `RAG_AGENT_AUDIT.md` §8 Sprint 5

---

## 🔵 Gros chantiers (> 1 jour, sprints dédiés)

### B1. Sortie Airtable / Notion → 5-7 jours
Voir `AUDITS/AIRTABLE_REMOVAL_PLAN.md` (plan complet en 4 phases). Indispensable avant de scaler la commercialisation hors Konekt interne.

### B2. Sprint 4 — Upload fichier dans le chat → 2 jours
Endpoint `ingest-user-file` (PDF/DOCX/TXT max 10MB), parser `pdf-parse` + `mammoth`, chunk + embed dans `knowledge_chunks` avec `chunk_type='user_upload'` + `expires_at=+90j`. UI drag-drop dans `AgentDrawer`.
- Source : `RAG_AGENT_AUDIT.md` §8 Sprint 4

### B3. Sprint 5 — Live coaching entretien Deepgram → 3 jours
Brancher Deepgram (clé existe via `deepgram-temp-key`) au flux audio entretien → suggestions Claude live → scorecard auto-pré-remplie.
- Source : `RAG_AGENT_AUDIT.md` §6, §8 Sprint 5

### B4. Connecteurs configurables (Greenhouse, Lever, Workable, etc.) → 5-10 jours
Refonte `Settings → Integrations` : liste dynamique alimentée par `connector_registry`, chaque org active ses connecteurs avec credentials. Sync workers `sync-connector-{name}` par provider.
- Voir `AUDITS/AIRTABLE_REMOVAL_PLAN.md` Phase 2 pour le pattern.
- Source : `FEATURE_AUDIT.md` + `AUDIT_REPORT.md`

### B5. Onglet Calendrier (mission interview steps) → 3 jours
Pas d'UI calendrier. Les `mission_process_steps` existent mais pas de visualisation timeline. Brancher Google Calendar / Outlook Calendar via OAuth pour sync bidirectionnel.
- Source : `NAV_GAPS.md`

### B6. Onglet Tasks/TODO global → 2 jours
Pas de gestion de tâches globale. Manque évident : "rappel sur ce candidat", "préparer brief client X".
- Source : `NAV_GAPS.md` + `PRODUCT_COMPLETION.md`

### B7. Onglet Analytics → 3 jours
Dashboard ATS existe mais ratios/funnels manquants : taux conversion par étape, temps moyen entre stages, performance par sourceur.
- Source : `NAV_GAPS.md` + `PRODUCT_COMPLETION.md` + `COMPETITORS.md`

### B8. RGPD — droit à l'oubli + export data → 2 jours
`rgpd-purge` edge function existe mais pas exposée dans l'UI. `export-org-data` idem. UI Settings → "Mes données" pour download + delete account.
- Source : `AUDITS/SECURITY_DEEP_AUDIT.md` §8

### B9. Notifications in-app + push → 2 jours
Aucun système notif. Cible : "votre candidat X a répondu", "séquence Y a fini", "12 nouveaux profils correspondent à votre brief".
- Source : `NAV_GAPS.md` + `PRODUCT_COMPLETION.md`

### B10. Email deliverability — DKIM/SPF/DMARC + warmup → 1 jour
Avant envoi en masse via Resend, vérifier DNS records full + warmup automatique des domaines neufs.
- Source : `AUDITS/EMAIL_DELIVERABILITY_AUDIT.md`

---

## 🟢 Nice to have (si temps libre)

- **N1.** Knowledge sidebar (Notion-like) : lib réutilisable de prompts/templates par org
- **N2.** Activity feed unifié (timeline candidat: emails, calls, notes, stage changes)
- **N3.** Favorites / starred candidates
- **N4.** Source maps en prod pour debug Sentry
- **N5.** React Query optimisation (useSuspenseQuery, prefetch routes)
- **N6.** Listes de favoris partagées équipe
- **N7.** Airtable forms (legacy, à dé-prioriser vu sortie Airtable)
- **N8.** Structured data JSON-LD pour SEO landing
- **N9.** Storybook composants atomiques
- **N10.** Hook dev pour signaler les composants > 500 lignes en CI

---

## Roadmap d'exécution proposée

- **Cette semaine** : 🔴 sécurité (S1-S8) + 🟠 quick wins (Q1-Q10) = ~6h dev
- **Semaine 2** : 🟡 important sélectif (I1, I2, I7 d'abord — refactor agent + re-ranking + session recovery)
- **Semaine 3-4** : continuer 🟡 + démarrer B1 (sortie Airtable) en sprint dédié
- **Mois 2** : B2-B4 (upload, live coach, connecteurs)
- **Mois 3** : B5-B10 (UI features manquantes + RGPD)

---

## Comment ce fichier vit

- À chaque session de dev, ouvrir ce fichier en premier
- Rayer (`~~text~~`) ou marquer `[DONE - sha commit]` les TODO traités
- Quand un audit révèle un nouveau gap → l'ajouter ici (ne pas créer un nouveau fichier d'audit)
- Une fois par mois, faire le tri : virer les `[DONE]`, déprioriser les `nice to have` qui n'ont pas bougé
