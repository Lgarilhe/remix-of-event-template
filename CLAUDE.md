# CLAUDE.md — Rules & Code Map for Konekt

## 🧠 Discipline baseline — 5 principes (à appliquer par défaut)

Avant toute action de code, valider ces 5 principes :

1. **Think Before Coding** — Expliciter les hypothèses, surfacer les ambiguïtés plutôt que de deviner silencieusement. Si la demande est floue, **poser une question** au lieu de partir dans une direction.
2. **Simplicity First** — Code minimal sans features spéculatives ni abstractions inutiles. Trois lignes similaires valent mieux qu'une abstraction prématurée.
3. **Surgical Changes** — Modifier UNIQUEMENT ce qui est demandé. Pas de refactor opportunistes, pas de renames "tant qu'on y est", pas de cleanup non demandé. Le scope = ce qui a été demandé, point.
4. **Goal-Driven Execution** — Transformer la tâche en critères de succès vérifiables avant d'agir. "Comment je sais que c'est fini ?" doit avoir une réponse concrète.
5. **Mind the Context** — Sur les fichiers > 1000 lignes (process-sequences, score-profile-job, useMessagesInbox, unipile-search, enrich-company), toujours `Read` avec `offset/limit` ciblé sur la zone à modifier — jamais le fichier entier. Pour les recherches cross-codebase (1015 fichiers), déléguer à un sub-agent `Explore` plutôt que grep en série. Si la session dépasse ~40% de contexte ou 2h, proposer `/compact` avant de continuer un nouveau chantier (au-delà la qualité se dégrade — hallucinations, oublis).

Ces 5 principes l'emportent sur l'envie d'être proactif. Si tension entre "faire bien" et "faire ce qui est demandé" → faire ce qui est demandé.

---

## Stack & infrastructure (post-migration 2026-04-21)
- **Frontend** : Vite + React + TS, déployé sur **Vercel** (branche `main` auto-deploy)
  - Prod URL : https://konekt-app-navy.vercel.app
  - `vercel.json` gère les rewrites SPA (toutes les routes → `index.html`)
- **Backend** : Supabase self-managed project **konekt-production** (ref `crckfywoyjxkawathdff`, West EU Ireland)
  - Dashboard : https://supabase.com/dashboard/project/crckfywoyjxkawathdff
  - SQL editor : https://supabase.com/dashboard/project/crckfywoyjxkawathdff/sql
  - Edge functions : https://supabase.com/dashboard/project/crckfywoyjxkawathdff/functions
  - Auth URL config : https://supabase.com/dashboard/project/crckfywoyjxkawathdff/auth/url-configuration
- **Lovable est retiré** : plus de push automatique vers main depuis Lovable Cloud. Tout passe par commits Git → Vercel.

## Before modifying any file
1. **Read the FULL file** (or at minimum all imports + the function being changed)
2. **Search for all call sites** — grep for the function/component name to find who uses it
3. **Check for caches, memos, effects** — React state that might override your changes
4. **Check for race conditions** — useEffect dependency arrays, async timing
5. **Sync with main first** — `git fetch origin main && git rebase origin/main`

## Before committing
Les hooks pre-commit (`.claude/settings.json`) lancent **automatiquement** (⚠️ uniquement sur les `git commit` passés par l'outil Bash de Claude Code — un `git commit` humain ou un push direct les contourne ; le vrai filet obligatoire = CI de PR, à câbler) :
- `npx tsc --noEmit -p tsconfig.app.json` — **ratchet** : bloque si le nombre d'erreurs TS dépasse la baseline (32 au 2026-07-15, après merge de main + régénération de `types.ts` depuis le schéma prod). Résorber la dette puis abaisser la baseline. ⚠️ Ne PAS revenir à `npx tsc --noEmit` sans `-p` : le `tsconfig.json` racine est solution-style (`"files": []`) → vérifie 0 fichier (hook vacant). Les 32 erreurs restantes sont de vraies anomalies code/schéma (ex. `profiles` n'a pas de colonnes `full_name`/`email` mais le code les interroge ; type `SourcingProject` désynchronisé) — à corriger au cas par cas, ne PAS masquer par `as any`. Régénérer `types.ts` via `supabase gen types typescript --linked` (ne PAS laisser la sortie CLI polluer le fichier).
- `npx vite build` — bloque le commit si build prod échoue. ⚠️ esbuild strip les types → ce build ne type-check PAS (d'où le hook tsc ci-dessus).

Vérif manuelle à faire en plus : **pas d'imports orphelins** (grep pour les noms de composants/fonctions supprimés).

## Runbook hotfix prod
1. Fix en local sur une branche.
2. `npx tsc --noEmit && npx vite build` → doit passer.
3. Commit + push → PR ou merge direct sur `main`.
4. Vercel redéploie auto le frontend (~2min).
5. **Edge functions** : auto-déployées par `.github/workflows/deploy-edge-functions.yml` sur push `main` (depuis 2026-07). Hotfix manuel toujours possible : `supabase functions deploy <name> --project-ref crckfywoyjxkawathdff`.
6. **Migrations SQL** : auto-appliquées par `.github/workflows/deploy-migrations.yml` sur push `main` (paths `supabase/migrations/**`) via `supabase db push --linked`. ⚠️ Ce workflow a été cassé pendant des semaines (table de suivi remote `supabase_migrations.schema_migrations` désynchro — 6/219 versions trackées seulement → `db push` refuse : « Found local migration files to be inserted before the last migration on remote »). Réparé via l'input `repair_tracking=true` (break-glass, tracking-only). Si tu vois cette erreur : relancer le workflow en `workflow_dispatch` avec `repair_tracking=true`. Hotfix manuel toujours possible : `supabase db push --linked` (idempotent) ou SQL editor.
7. Rollback Vercel : Dashboard Vercel → Deployments → "Promote to Production" sur le deploy précédent.

### 🚨 Discipline migrations — règles ABSOLUES (incidents des 14-15/07/2026)

Deux sessions Claude en parallèle ont cassé le workflow de migrations 3 fois en 24h (collisions de versions, tracking désynchronisé). Pour ne JAMAIS reproduire :

1. **Toute migration passe par un fichier committé** dans `supabase/migrations/` — jamais de DDL direct via SQL editor ou MCP `apply_migration` sans fichier correspondant dans le repo.
2. **Si tu dois hotfixer en prod via MCP** (workflow cassé, urgence) : après application, **aligne la table de suivi sur la version du fichier du repo** — `UPDATE supabase_migrations.schema_migrations SET version = '<version du fichier>' WHERE name = '<name>'`. MCP `apply_migration` stampe son propre timestamp → sans cet alignement, le prochain `db push` refuse (« Remote migration versions not found in local migrations directory »).
3. **Timestamp unique obligatoire** : avant de créer un fichier, `ls supabase/migrations/ | grep <ta date>` ET `git fetch origin main && git ls-tree origin/main supabase/migrations/` — deux fichiers avec la même version cassent la CI e2e (duplicate key sur `schema_migrations_pkey`) et le push prod. Utilise `date -u +%Y%m%d%H%M%S` (heure réelle, pas un timestamp rond).
4. **Jamais** `supabase migration repair --status reverted` sur une version dont le fichier existe dans le repo — ça recrée l'erreur out-of-order au push suivant (le DDL reste appliqué mais le tracking l'oublie).
5. Diagnostic rapide d'une désynchro : comparer `select version from supabase_migrations.schema_migrations` avec `ls supabase/migrations/` — toute version présente d'un seul côté doit être réconciliée (fichier reconstruit depuis `statements`, ou tracking renommé), jamais ignorée.

---

## Architecture rules
- When in mission context (`activeProject` exists), the brief IS the job — never ask users to select a job
- `filters_snapshot` on `sourcing_projects` stores AI-generated search filters + suggestions
- `job_details` on `sourcing_projects` stores the brief data (JobDetails type from `src/types/jobDetails.ts`)
- The LinkedInSearch component has an internal cache (`missionSearchCache`) that can override hook state

## 🎯 Sourcing strategy (décision 2026-04-27, après audit Apollo+PDL+Lemlist+HeyReach)

**Sourcing PRIMAIRE = LinkedIn via Unipile** (100 % du moteur). Pas de "Base Konekt" externe pour la recherche.

Pourquoi :
- Apollo `mixed_people/api_search` masque `last_name` BY-DESIGN sur tous les plans → bulk_match (1 cr/profil) obligatoire
- Apollo viole les ToS avec une seule API key partagée multi-tenant SaaS (besoin contrat OEM custom $3K-75K/an)
- PDL Person Search facture chaque profil retourné (~$0.28 sur Pro) → modèle "browsing payant" insoutenable côté UX user
- LinkedIn (Unipile) = même pattern que Lemlist / HeyReach / Phantombuster : on utilise la session LinkedIn de l'user → noms visibles, skills/edu/langues complets, $0 par profil
- Tous les recruteurs cibles ont DÉJÀ LinkedIn (Recruiter $700/mois ou Sales Nav $80/mois) — c'est la norme du métier

Ce qui reste de la migration PDL (nettoyage du 2026-09-06) :
- `_shared/pdl-mapping.ts` et `resolvePDLCredentials` : SUPPRIMÉS (aucun appelant)
- `pdl_profile_cache` table + RLS : encore en base, sans lecteur ni écrivain
- `PDL_API_KEY` : plus lu par aucune fonction, inutile sur un nouvel environnement
- `database-search`, `pdl-search`, `apollo-search` edge functions : SUPPRIMÉES (le frontend n'appelle plus que `unipile-search` et `coresignal-search`)

Apollo/PDL futurs cas d'usage :
- **ENRICHMENT CIBLÉ** : récupérer email/phone d'un candidat shortlisté (1 crédit pour 1 candidat actionnable, ROI clair)
- **JAMAIS** comme source de browsing massif

Fournisseurs enrichment recommandés (ordre de préférence) :
1. **Dropcontact** 🇫🇷 — ~$24/mois pour 1500 enrichments = $0.016/profil — RGPD natif, qualité B2B FR/EU
2. **PDL Person Enrich** — $0.28/match groupé email+phone — déjà branché techniquement
3. **Apollo People Match** — viable seulement avec contrat OEM (sinon ToS violés)
- Hunter / Snov.io en options secondaires

## ⚠️ Branding — vendor names NEVER user-facing

**Critical rule** : the names of our backend providers must **never** appear in any UI text, toast, error message, tooltip, label, placeholder, or any string that an end-user can read.

This applies to (non-exhaustive) :
- **Unipile** (LinkedIn provider) → say "**LinkedIn**" or "service de connexion LinkedIn"
- **People Data Labs / PDL** (database provider) → say "**Base Konekt**"
- **Apollo / Apollo.io** (legacy database provider) → say "**Base Konekt**"
- **Brandfetch / Clearbit / Logo.dev** (logos) → no mention, just the result
- **Resend** (email infra) → "Konekt sender" or no mention
- **Anthropic / Claude** → "IA Konekt" or "assistant IA"

**Allowed exceptions** (legal obligation only) :
- Pages `/privacy` and `/privacy-extension` (RGPD art. 28 — sub-processor list)
- DPA / CGU PDFs (legal docs)

**Internal uses always allowed** :
- Variable names (`invokeUnipile`, `apolloData`)
- Edge function names (`unipile-accounts`, `pdl-search`, `apollo-search`)
- Type unions (`source: 'pdl' | 'apollo'`)
- Console logs (debug only, not surfaced to UI)
- Comments in code
- This `CLAUDE.md` and other internal docs

**Why** : (1) avoid vendor lock-in being visible to clients, (2) maintain Konekt branding, (3) keep migration freedom (we're already migrating Apollo→PDL), (4) clients shouldn't know our infra stack.

**Before merging any UI change** : grep for `Unipile`, `Apollo`, `PDL`, `People Data Labs` in user-visible strings (JSX text, toast/sonner messages, tooltips, labels, placeholders).

---

## Code Map

### Routes (src/App.tsx)
```
/dashboard               → Dashboard (stats + welcome CTA if no missions)
/missions                → Outreach page (liste des missions)
/missions/:id            → MissionWorkspace → MissionWorkspaceV2 (3 phases, sous-onglets via ?tab=)
/mission-invite/:token   → AcceptMissionInvite
/sourcing                → SourcingSearches (recherches hors mission)
/sourcing/:id            → SourcingSearchPage
/agents                  → AgentsPage
/pipeline                → ATS page (kanban/table/timeline/analytics)
/pipeline/scorecard/:candidateId → ScorecardFullPage (alias legacy /ats/scorecard/:candidateId)
/candidates              → Redirects to /pipeline
/inbox                   → Inbox
/calendar                → CalendarPage
/tasks                   → TasksPage
/marketplace             → Marketplace
/pricing                 → Pricing
/settings                → Settings (deep links: ?tab=general|presets|templates|account|team|connectors|integrations|billing|credits|agency|marketplace)
/qualification/:id       → Qualification session (deep-linked from modals)
Public (no AppLayout): / (landing), /auth, /onboarding (protected, no org guard), /portal/:token (CandidatePortal),
  /client/:token (ClientPortalV2), /r/:slug (RecruiterPublicProfile), /unsubscribe, /privacy, /privacy-extension
Legacy: /outreach → /missions, /ats → /pipeline
```

### Mission Flow
Un seul parcours mission : V2, 3 phases linéaires (`src/components/missions/v2/`). Plus de flag `mission_v2` ni de composants V1.
```
MissionWorkspace (src/pages/MissionWorkspace.tsx : loading / introuvable / rendu V2)
└── MissionWorkspaceV2       — PhaseStepper (3 phases) + sous-onglets, lus/écrits via ?tab=
    ├── Phase 1 « Cadrage »
    │   ├── MissionOverviewV2   — ?tab=overview (défaut)
    │   ├── MissionBriefV2      — ?tab=brief, édite job_details (readOnly si !hasFeature('edit_brief'))
    │   ├── MissionProcessV2    — ?tab=process, étapes d'entretien + équipe (briques partagées : missions/process/shared.tsx)
    │   └── MissionConfigV2     — ?tab=config, hunt mode (MissionHuntMode) + portail client (MissionClientPortal)
    ├── Phase 2 « Sourcing & Outreach »
    │   ├── MissionSourcing     — ?tab=sourcing → LinkedInSearch (search orchestrator, the most complex component)
    │   └── MissionOutreach     — ?tab=outreach, séquences + invitations
    └── Phase 3 « Pipeline »
        ├── MissionPipeline     — ?tab=pipeline, kanban candidats
        └── MissionInsights     — ?tab=insights, analytics
```
- Les sous-onglets se verrouillent selon `useMissionReadiness` (brief/process incomplets → phases 2 et 3 bloquées, toast « Complétez les étapes précédentes »).
- Deep links historiques `?tab=brief|process|config|sourcing|outreach|pipeline|insights` restent valides (mapping tab → phase dans MissionWorkspaceV2).

### Search & Sourcing Flow (CRITICAL — most complex part)
```
MissionSourcing
  → LinkedInSearch (orchestrator, manages cache)
    → useLinkedInSearch (hook, 534 lines)
       ├── searchReducer: filters, results, selectedJob, jobScores, cursor
       ├── viewReducer: statusFilter, showDismissed
       ├── Loads filters_snapshot → transforms AI format to LinkedInFiltersState
       ├── Creates synthetic job from brief: id="project:{projectId}"
       └── Deferred location resolution via pendingLocationRef
    → useLinkedInSearchActions (807 lines) — executes search via Unipile/database
    → useLinkedInScoring (823 lines) — batch AI scoring via score-profile-job
    → SearchFiltersPanel — filter UI + AutoFillFiltersButton
```

**Filter format transformation:**
- AI format (from edge function): `skills_keywords[]`, `location_keywords[]`, `role[].keywords`
- UI format (LinkedInFiltersState): `location[]`, `skills[]`, `role[]`, `calculated_experience_min`
- Transformation happens in `useLinkedInSearch` lines 266-306

### Data Model (key tables)
```
sourcing_projects          — missions (name, job_details, filters_snapshot, status, stats)
mission_process_steps      — interview steps per mission
mission_team               — team members per mission
mission_invitations        — freelancer invites with tokens
job_candidate_status       — candidate score/status per job
outreach_sequences         — message sequences
sequence_enrollments       — candidates in sequences
organizations              — org + subscription
organization_members       — member roles (admin/owner/collaborator)
profiles                   — user profiles
```

### Key Hooks
```
useSourcingProjects        — CRUD for sourcing_projects (React Query, 5min stale)
useMissionProcess          — process steps + team management
useMissionInvitations      — invite management
useLinkedInSearch          — search state machine (the big one)
useLinkedInSearchActions   — search execution + pagination
useLinkedInScoring         — batch AI scoring (3 parallel waves of 10)
useFilteredLinkedInAccounts — shared hook for account filtering
useOrganization            — org context + member role
useJobCandidateStatus      — candidate tracking per job
```

### Contexts
```
LinkedInAccountsContext     — LinkedIn accounts from Unipile (auto-reload, health check 5min)
AgentContext                — agent drawer state (open/close, modes: brief/process/sourcing/outreach)
OutreachSearchContext       — legacy global search (mostly replaced by useLinkedInSearch)
```

### Edge Functions (supabase/functions/)
```
Search & scoring:   unipile-search, coresignal-search, generate-search-filters, refine-search-filters, nl-filter-edit,
                    score-profile-job (batch LLM, 10 profiles/call), detect-profile-fraud, run-agent-search, search-agent-chat
AI / agent:         ai-chat-completion, ai-credits, agent-tool-action, agent-daily-digest, process-agent-tasks, text-action,
                    live-coach, deepgram-temp-key, generate-scorecard, generate-call-report, generate-client-competitors
Knowledge / RAG:    ingest-context, auto-ingest-context, ingest-user-file, retrieve-context, generate-embedding
Outreach & sequences: generate-outreach-message, generate-reply-suggestions, process-sequences, process-inmail-queue,
                    process-scheduled-actions, sequence-send-email, sequence-email-track, sequence-webhooks-handler
Inbox:              auto-analyze-message, auto-categorize-chats, analyze-response
Email transactionnel: send-transactional-email, process-email-queue, handle-email-suppression, handle-email-unsubscribe
Enrichment & sociétés: enrich-company, enrich-candidate-contact, get-enrichment-status, process-enrichment-queue,
                    resolve-pedigree-directory, refresh-pedigree-by-funding-stage
LinkedIn accounts:  unipile-accounts, unipile-webhook, unipile-manage-webhooks
Missions / pipeline: add-to-shortlist, update-candidate-stage, submit-application, client-portal-data,
                    accept-mission-invitation, accept-invitation, send-team-invitation
Notion:             fetch-notion-candidates, fetch-notion-jobs, notify-notion, update-notion-job, notion-mcp-oauth
Autres intégrations: stripe-webhook, create-checkout-session, aircall-webhook, calendly-webhook,
                    setup-calendly-webhook, backfill-calendly
Extension Chrome:   extension-token, extension-quick-add, extension-pipeline-status
RGPD / données:     export-org-data, rgpd-erase-contact, rgpd-purge
```
73 fonctions (2026-09-06). Supprimées lors des nettoyages : database-search, apollo-search, pdl-search, enrich-contact, enrich-vivier-contacts, puis le 2026-09-06 (aucun appelant) : analyze-linkedin-profile, backfill-knowledge-lake, chat-filter-assistant, estimate-search-count, fetch-aircall, fetch-airtable, fetch-notion-schema, n8n-create-workflow, nurturing-analyzer, preview-transactional-email, process-debrief, scan-career-pages, scrape-job-url, screen-candidate, sequence-snippets-crud, sequence-templates-crud, check-invitation-status, audit-employer-brand, generate-recruiter-bio, scan-recruiter-linkedin. Liste à jour : `ls supabase/functions/`.

---

## Supabase secrets (edge functions)

Configurer via dashboard : https://supabase.com/dashboard/project/crckfywoyjxkawathdff/settings/functions
ou CLI : `supabase secrets set --project-ref crckfywoyjxkawathdff KEY=value`.

### Auto-provisionnés par Supabase (ne pas toucher)
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `SUPABASE_PUBLISHABLE_KEY`.

### CRITICAL — à setter absolument, sinon fonctionnalités core cassées
| Secret | Utilisé par (principales) |
|--------|---------------------------|
| `ANTHROPIC_API_KEY` | **tous les appels AI** — le helper `_shared/call-claude.ts` est l'unique passerelle vers les LLM depuis la migration Lovable → Anthropic direct (2026-04-21). Ancien Lovable Gateway Gemini remplacé par Claude Haiku 4.5. Lu par 23 fonctions (2026-09-06) : ai-chat-completion, analyze-response, auto-analyze-message, auto-categorize-chats, detect-profile-fraud, enrich-company, fetch-notion-jobs, generate-call-report, generate-client-competitors, generate-outreach-message, generate-reply-suggestions, generate-scorecard, generate-search-filters, ingest-user-file, live-coach, nl-filter-edit, process-sequences, refine-search-filters, retrieve-context, score-profile-job, search-agent-chat, sequence-send-email, text-action |
| `OPENAI_API_KEY` | fetch-notion-jobs, generate-embedding, ingest-context, ingest-user-file, retrieve-context (embeddings seulement) |
| `UNIPILE_API_KEY` + `UNIPILE_DSN` | unipile-accounts, unipile-search, unipile-webhook, unipile-manage-webhooks + toutes les fonctions qui touchent LinkedIn (~15 au total) |
| `SB_SECRET_KEY` | clé service-role « nouveau format » : lue en priorité par `_shared/require-auth.ts` et par quasiment toutes les fonctions (`Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`). Si absente, repli sur `SUPABASE_SERVICE_ROLE_KEY` auto-provisionnée |
| `ALLOWED_ORIGINS` | `_shared/cors.ts` (allowlist CORS, séparée par des virgules ; défaut = prod Vercel + localhost si absente) |
| `NOTION_API_KEY` + `NOTION_CANDIDATS_DB_ID` + `NOTION_POSTES_DB_ID` + `NOTION_SHORTLIST_DB_ID` | add-to-shortlist, submit-application, process-sequences, auto-analyze-message, `_shared/resolve-org-credentials.ts` (repli env) |
| `STRIPE_SECRET_KEY` | create-checkout-session |
| `RESEND_API_KEY` | process-email-queue (envoi emails via Resend API) |

**Note importante** : `LOVABLE_API_KEY` est entièrement retiré depuis 2026-04-21 (AI + Email). Emails sont maintenant sur Resend. AI sur Anthropic direct.

### IMPORTANT — features secondaires
| Secret | Utilisé par |
|--------|-------------|
| `APOLLO_API_KEY` | enrich-company, refresh-pedigree-by-funding-stage (+ repli env dans `_shared/resolve-org-credentials.ts`) |
| `CORESIGNAL_API_KEY` | coresignal-search (via `resolveCoresignalCredentials` de `_shared/resolve-org-credentials.ts`) |
| `BETTERCONTACT_API_KEY` | enrich-candidate-contact, get-enrichment-status |
| `UNIPILE_V2_API_KEY` + `UNIPILE_V2_WEBHOOK_TOKEN` | `_shared/unipile-v2.ts` (importé par unipile-webhook, unipile-manage-webhooks) — API v2 activée seulement si la clé est posée |
| `STRIPE_WEBHOOK_SECRET` | stripe-webhook |
| `AIRCALL_WEBHOOK_TOKEN` | aircall-webhook |
| `CALENDLY_WEBHOOK_SIGNING_KEY` | calendly-webhook |
| `UNIPILE_WEBHOOK_SECRET` | unipile-webhook, unipile-manage-webhooks, unipile-accounts, sequence-webhooks-handler, `_shared/unipile-v2.ts` |
| `SEQUENCE_WEBHOOK_SECRET` | sequence-webhooks-handler |
| `PROCESS_SEQUENCES_SECRET` | auth des crons : process-sequences, process-email-queue, process-inmail-queue, process-scheduled-actions, process-agent-tasks, process-enrichment-queue, agent-daily-digest, refresh-pedigree-by-funding-stage, resolve-pedigree-directory |
| `KONEKT_PLATFORM_ADMIN_USER_IDS` | unipile-manage-webhooks (ids user séparés par des virgules ; sans ce secret, owner/admin de l'org suffit — SEC-031) |
| `NOTION_TOKEN_ENCRYPTION_KEY` | `_shared/notion-secret-crypto.ts` (chiffrement des tokens Notion ; importé par notion-mcp-oauth et `_shared/notion-mcp-connection.ts`) |
| `NOTION_ALLOWED_RETURN_ORIGINS` | notion-mcp-oauth (origines de retour OAuth autorisées) |
| `APP_URL` | create-checkout-session, notion-mcp-oauth, send-transactional-email, sequence-email-track, sequence-send-email, `_shared/agent-tools-mutations.ts` (= https://konekt-app-navy.vercel.app) |
| `EMAIL_SITE_NAME` + `EMAIL_SENDER_DOMAIN` + `EMAIL_FROM_DOMAIN` | send-transactional-email (défauts : « Konekt », `notify.konekt.fr`, `konekt.fr`) |
| `RESEND_WEBHOOK_SECRET` | handle-email-suppression (Svix signature verif, format `whsec_...`) |

### OPTIONAL — fallback/dev
`DEEPGRAM_API_KEY` + `DEEPGRAM_PROJECT_ID` (deepgram-temp-key), `PERPLEXITY_API_KEY` (enrich-company), `FIRECRAWL_API_KEY` (enrich-company).

`PDL_API_KEY`, `N8N_API_KEY`, `N8N_INSTANCE_URL` et `MICROSOFT_GRAPH_TOKEN` ne sont plus lus par aucune fonction depuis le nettoyage du 2026-09-06 : inutiles sur un nouvel environnement, à retirer des secrets existants à l'occasion.

## Supabase Auth config (URL allow-list)

À configurer manuellement dans le Dashboard (pas via `supabase config push` qui reset d'autres settings) :
https://supabase.com/dashboard/project/crckfywoyjxkawathdff/auth/url-configuration

- **Site URL** : `https://konekt-app-navy.vercel.app`
- **Redirect URLs** (additional) :
  - `https://konekt-app-navy.vercel.app/**`
  - `http://localhost:5173/**`
  - `http://localhost:8080/**`

## Gotcha RLS (fix du 2026-04-21)

Le schéma importé depuis Lovable n'avait PAS les GRANTs sur les tables public → erreur "permission denied for table organizations" lors de l'onboarding. Fix appliqué : migration `supabase/migrations/20260421180000_grants_bootstrap_owner_uniques.sql`, qui grant SELECT/INSERT/UPDATE/DELETE à `authenticated` + default privileges + fix bootstrap owner (enforce_role_hierarchy) + ajout UNIQUE constraints sur 10 tables (profiles, connector_instances, ai_credit_balances, organization_subscriptions, chat_categories, job_candidate_status, member_email_accounts, member_linkedin_accounts, member_quotas, message_analysis_cache) + extension `members_select` sur organizations pour inclure `created_by = auth.uid()`. Idempotente, rejouable.

---

## Critical State Patterns

### missionSearchCache (IN-MEMORY, survives re-mounts)
```
Map<"mission-sourcing:{projectId}", {
  filters, results, selectedJob, jobScores, sortByScore,
  statusFilter, showDismissed, selectedProfiles,
  scrollTop, scoringInstructions
}>
```
- Written on: tab switch away, filter change, search complete
- Hydrated on: tab re-entry (hydratedCacheKeyRef prevents double hydrate)
- **DANGER**: In mission context, cache restore SKIPS selectedJob (we fixed this) but still restores everything else

### Synthetic Job Creation
```
activeProject exists → useLinkedInSearch creates job from brief:
  id: "project:{projectId}"
  title: jd.title || activeProject.name
  skills: jd.skills_must_have + jd.skills_should_have
  description: jd.mission_description + jd.context
  bodyContent: evaluation_criteria (max 15, truncated to 2000 chars)
  mustHave/shouldHave/niceToHave: from brief skills
```
- Re-triggers on: `activeProject?.id` OR `activeProject?.job_details` change
- Cache restore does NOT override this (line 218 guard)

### Filter Loading from filters_snapshot
```
1. useLinkedInSearch detects AI format (has skills_keywords/location_keywords/role[].keywords)
2. Transforms to LinkedInFiltersState format
3. Stores pending location keyword in pendingLocationRef
4. When selectedAccount becomes available → resolves location to geo ID
```

---

## Edge Function Conventions (MANDATORY)

Every edge function MUST follow these patterns. See `.claude/skills/edge-function.md` for the full skeleton.

### Auth & Multi-tenant
```typescript
// 1. Auth — use requireAuth from shared module
import { requireAuth, verifyOrgMembership } from "../_shared/require-auth.ts";
const auth = await requireAuth(req, corsHeaders);

// 2. If organization_id comes from request body, VERIFY membership
if (organization_id && auth.userId) {
  const isMember = await verifyOrgMembership(admin, auth.userId, organization_id);
  if (!isMember) return json({ error: "Forbidden" }, 403);
}
```

### Credentials — NEVER use mutable globals
```typescript
// ❌ WRONG — credential bleed between concurrent requests
let UNIPILE_API_KEY = Deno.env.get("UNIPILE_API_KEY");

// ✅ CORRECT — immutable env fallbacks + per-request resolution
const ENV_UNIPILE_API_KEY = Deno.env.get("UNIPILE_API_KEY");
// In handler: resolve per-org, store in local variable
const creds = await resolveUnipileCreds(orgId, supabase);
```

### External HTTP calls — ALWAYS use fetchWithTimeout
```typescript
function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}
// Use 30s for LLM calls, 15s for everything else
```

### AI calls — ALWAYS settle credits
```typescript
import { extractAIParams, settleCredits } from "../_shared/settle-credits.ts";
// After every Anthropic API call:
await settleCredits(adminClient, {
  organizationId, userId, aiAction, modelId,
  tokensInput: response.usage.input_tokens,
  tokensOutput: response.usage.output_tokens,
  description,
});
```

### AI model IDs — current valid models
- `claude-sonnet-4-6` — default for all AI calls
- `claude-opus-4-6` — for complex reasoning (agent chat)
- `claude-haiku-4-5-20251001` — for fast/cheap tasks
- Resolve via `getAnthropicModelId()` from `_shared/ai-config.ts`
- **NEVER hardcode deprecated IDs** like `claude-sonnet-4-20250514`

### DSN format for Unipile
- `resolveUnipileCredentials()` returns dsn WITH `https://` prefix
- When constructing URLs: `const baseDsn = creds.dsn.startsWith('http') ? creds.dsn : \`https://${creds.dsn}\``
- NEVER do `https://${creds.dsn}` — causes double `https://`

---

## Frontend Conventions

### Feature gating
```typescript
import { hasFeature } from '@/lib/featureGates';
// hasFeature(orgType, feature) — fail-closed: returns false while orgType is null (org loading).
```
Matrice par type d'organisation (`enterprise` / `agency` / `freelance`) dans `src/lib/featureGates.ts`. Décision produit 2026-09 : **un freelance a les mêmes droits qu'un cabinet sur ses missions** (`create_missions`, `edit_brief`, `edit_process`, `sourcing`, `outreach`, `pipeline`, `client_portal`, `marketplace_browse`), **sauf** `team_management` (pas d'onglet Équipe) et `agency_settings` (pas de paramètres agence). `marketplace_publish` reste réservé aux entreprises. Les onglets de Settings (`canManageTeam`, `canAgencySettings`) et les `readOnly` de MissionBriefV2/MissionProcessV2 découlent de cette matrice.

### Destructive actions — ALWAYS use AlertDialog
```typescript
// ❌ WRONG — breaks design language
if (window.confirm('Supprimer ?')) { ... }

// ✅ CORRECT — use shadcn AlertDialog with French text
<AlertDialog>
  <AlertDialogContent>
    <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
    <AlertDialogDescription>Cette action est irréversible.</AlertDialogDescription>
    <AlertDialogFooter>
      <AlertDialogCancel>Annuler</AlertDialogCancel>
      <AlertDialogAction className="bg-destructive">Supprimer</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

### Promises — ALWAYS handle rejections
```typescript
// ❌ WRONG — user stuck on infinite spinner if reject
accept(token).then(handleSuccess);

// ✅ CORRECT
accept(token).then(handleSuccess).catch(() => setStatus('error'));
```

### useEffect — avoid object deps
```typescript
// ❌ WRONG — new object ref every render = infinite re-fire
}, [search, activeProject]);

// ✅ CORRECT — use primitive values or refs
}, [activeProject?.id, searchSource]);
```

---

## Common Pitfalls
- **useEffect deps**: use `activeProject?.id` not `activeProject` (object ref never changes)
- **missionSearchCache**: restores ALL state — any hook state changes can be overwritten on tab switch
- **Edge function timeout**: 60s on Supabase — batch LLM calls must fit within this
- **Vercel deploys from main** — must merge PR to main for changes to be visible (~2 min)
- **Edge functions are auto-deployed** by `.github/workflows/deploy-edge-functions.yml` on push to `main` (only the functions changed under `supabase/functions/**`; a `_shared/` change redeploys everything). Manual hotfix: `supabase functions deploy <name> --project-ref crckfywoyjxkawathdff`
- **Two filter formats coexist** — AI format vs LinkedInFiltersState, transformation in useLinkedInSearch
- **Step reordering**: uses temp negative order values to avoid UNIQUE constraint, then reassigns positive
- **Location deferred resolution**: if no LinkedIn account connected, location stays as keyword until account available
- **No /prospection route anymore** — the vivier/CRM page was removed; org-type gating lives in `featureGates.ts` (see Feature gating)
- **/candidates redirects to /pipeline** — one single entry point for candidates

---

## 🛠️ Skills disponibles & quand les utiliser

Les skills locaux du projet (`.claude/skills/`) doivent être invoqués selon le contexte :

| Skill | Quand l'invoquer |
|-------|------------------|
| `edge-function.md` | User demande de créer/scaffolder une nouvelle edge function Supabase |
| `migration.md` | User demande de créer une migration SQL (nouvelle table, ajout colonne, RLS, backfill) |
| `qa.md` | Avant tout merge vers `main`, OU quand l'user veut tester un flow (4 personas Guillaume/Claire/Théo/Sophie). **Obligatoire** si edge function critique, RLS, ou flow client final touché. |
| `systematic-debugging.md` | User dit "ça marche pas" / "bug bizarre" / race condition / RLS permission denied / "marche en local mais pas en prod" / état incohérent après tab switch |

Slash commands disponibles :
- `/deploy` — détecte les edge functions modifiées et donne les commandes deploy
- `/debug` — **natif Claude Code** : debug l'app Claude Code elle-même (logs, daemon), PAS le code Konekt → pour debugger le code, utiliser le skill `systematic-debugging.md`

---

## Apollo API (enrichment sociétés, pedigree)

Apollo n'est **plus une source de sourcing** (voir « Sourcing strategy ») : `database-search`, `apollo-search`, `mapFiltersToApollo`, `bulk_match` et `apolloToLinkedInProfile` n'existent plus. Ce qui reste :

- `APOLLO_API_KEY` en secret Supabase (repli env dans `_shared/resolve-org-credentials.ts`).
- **enrich-company** : `mixed_companies/search` + `organizations/enrich?domain=` (fiche société, effectifs, levée de fonds), `organizations/{id}/job_postings` (postes ouverts), `mixed_people/api_search` (contacts clés) et `news_articles/search` (signaux). `buildSignals()` dérive les badges (levée récente, croissance, recrutement) de la réponse.
- **refresh-pedigree-by-funding-stage** (cron) : `mixed_companies/search` par stade de levée pour rafraîchir les entrées `source='cron_apollo'` du référentiel pedigree.

Rappels API :
- Pas de syntaxe booléenne (AND/OR/NOT) ; `q_keywords` plafonné à 500 caractères, `q_organization_name` à 200.
- `total_entries` est au niveau racine de la réponse, pas dans `pagination`.
- 1 crédit par match sur `people/match` ; n'appeler que pour un candidat/contact actionnable, jamais en browsing.

---

## Unipile API (LinkedIn Integration)

### Architecture
```
Frontend (invokeUnipile) → unipile-search edge function → Unipile API → LinkedIn
```
- Credentials per-org in `organization_integrations` table (unipile_api_key, unipile_dsn)
- Fallback to env vars: `UNIPILE_API_KEY`, `UNIPILE_DSN`
- Base URL: `https://{DSN}/api/v1`
- Auth header: `X-API-KEY: {apiKey}`
- All fetch calls use 15s timeout

### LinkedIn API Types (Licenses)
| License | API Value | Features |
|---------|-----------|----------|
| Classic | `classic` | Basic search, limited filters, no skills/role filter |
| Recruiter | `recruiter` | Advanced search, Boolean keywords, role/skills/seniority, hiring projects, talent pools, spotlights |
| Sales Navigator | `sales_navigator` | Account search, company filters, groups, past roles |

### Main Actions (unipile-search edge function)

**search** — `POST /linkedin/search?account_id={id}`
- Accepts all LinkedIn filter params (keywords, location, role, skills, seniority, etc.)
- Returns `{ success, results: LinkedInProfile[], cursor, total }`
- Error `CONTENT_TOO_LARGE` if keywords >200 chars → auto-truncated
- Auto-retry 3x on `multiple_sessions` error (0ms, 6s, 15s delays)

**get_profile** — `GET /users/{profile_id}?account_id={id}`
- Returns full profile (work_experience, education, skills, summary)
- `profile_url` accepted as alternative → slug extracted
- Profile data normalized (dates, network distance, Boolean flags)

**get_parameters** — `GET /linkedin/search/parameters`
- Autocomplete for filter values (location, company, school, skills...)
- Params: `type`, `service` (RECRUITER/CLASSIC/SALES_NAVIGATOR), `keywords`
- Returns `{ items: [{id, title}] }`

**get_chats** — `GET /chats?account_id={id}`
- Fetches from 3 folders in parallel: INBOX_LINKEDIN_CLASSIC, INBOX_LINKEDIN_RECRUITER, INBOX
- Dedupes by chat ID, sorts newest first
- Returns `{ chats, cursors, cursor }`

**send_message** — `POST /chats/{chat_id}/messages` or `POST /chats` (new)
- Multipart form-data format
- InMail: set `is_inmail: true` + `subject` → uses `linkedin[api]: recruiter`

**get_messages** — `GET /chats/{chat_id}/messages`
- Returns `{ messages, cursor }`

### Webhook Events (unipile-webhook)
| Event | Action |
|-------|--------|
| `new_relation` | Update enrollment connection_status, resolve wait_connection step |
| `message_received` | Mark enrollment as replied, cancel pending steps, auto-analyze |
| `account_connected` | Update account_status → OK |
| `account_disconnected` | Update status → CREDENTIALS, notify user |

### Key Differences by License
| Filter | Classic | Recruiter | Sales Nav | Database |
|--------|---------|-----------|-----------|----------|
| keywords | ✅ | ✅ | ✅ | ✅ (cleaned) |
| location | IDs only | ID+priority+scope+radius | IDs | Names (normalized) |
| role/job_title | ❌ | ✅ Boolean keywords | ✅ | ✅ person_titles |
| skills | ❌ | ✅ ID+priority | ❌ | Text only |
| seniority | Basic mapping | Full mapping + role injection | Full mapping | Apollo mapping |
| company_keywords | ❌ | ✅ keywords+priority+scope | ❌ | ✅ q_organization_name |
| degree | ❌ | ✅ include/exclude | ❌ | ❌ |
| spotlight | ❌ | ✅ (OPEN_TO_WORK, ACTIVE_TALENT...) | ❌ | ❌ |

### Error Handling
- `429 RATE_LIMIT` → retry after 60s, toast "Trop de requêtes"
- `400 CONTENT_TOO_LARGE` → auto-truncate keywords
- `500 multiple_sessions` → auto-retry 3x
- Network errors → French humanized messages
- `CREDENTIALS` account status → prompt user to reconnect

### Deployment Warning
**Edge functions are auto-deployed** by `.github/workflows/deploy-edge-functions.yml` on push to `main` (changed functions only; `workflow_dispatch` accepts a name, a comma-separated list or `all`). Manual hotfix if needed:
```bash
supabase functions deploy --all --project-ref crckfywoyjxkawathdff
# Or individually:
supabase functions deploy <function-name> --project-ref crckfywoyjxkawathdff
```
**SQL migrations** auto-apply via `.github/workflows/deploy-migrations.yml` on push to `main` (paths `supabase/migrations/**`). This was broken for weeks by a remote tracking-table desync (only 6/219 versions tracked → `supabase db push` refuses with "Found local migration files to be inserted before the last migration on remote"). Recovery: re-run the workflow in `workflow_dispatch` with `repair_tracking=true` (break-glass — marks all local versions `applied` in the tracking table only, no DDL re-run, reversible). Manual application still works as a hotfix and is idempotent:
```bash
supabase db push --linked
```
