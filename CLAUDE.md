# CLAUDE.md — Rules & Code Map for Konekt

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
1. Run `npx tsc --noEmit` — zero errors required
2. Run `npx vite build` — must succeed
3. Verify no orphaned imports (grep for removed component/function names)

## Runbook hotfix prod
1. Fix en local sur une branche.
2. `npx tsc --noEmit && npx vite build` → doit passer.
3. Commit + push → PR ou merge direct sur `main`.
4. Vercel redéploie auto le frontend (~2min).
5. **Edge functions** ne sont PAS auto-déployées : `supabase functions deploy <name> --project-ref crckfywoyjxkawathdff`.
6. **Migrations SQL** ne sont PAS auto-appliquées : `supabase db push --linked` ou `supabase db query --linked --file <file.sql>`.
7. Rollback Vercel : Dashboard Vercel → Deployments → "Promote to Production" sur le deploy précédent.

---

## Architecture rules
- When in mission context (`activeProject` exists), the brief IS the job — never ask users to select a job
- `filters_snapshot` on `sourcing_projects` stores AI-generated search filters + suggestions
- `job_details` on `sourcing_projects` stores the brief data (JobDetails type from `src/types/jobDetails.ts`)
- The LinkedInSearch component has an internal cache (`missionSearchCache`) that can override hook state

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
/missions                → Outreach page (ProjectsList)
/missions/:id            → MissionWorkspace (8 tabs: overview/brief/process/sourcing/outreach/pipeline/insights/config)
/mission-invite/:token   → AcceptMissionInvite
/pipeline                → ATS page (kanban/table/timeline/analytics)
/candidates              → Redirects to /pipeline
/prospection             → Vivier/CRM (agency-only, gated by featureGates)
/inbox                   → MessagesInbox
/settings                → Settings (deep links: ?tab=general|team|connectors|integrations|billing|credits|agency|marketplace)
/qualification/:id       → Qualification session (deep-linked from modals)
Legacy: /outreach → /missions, /ats → /pipeline
```

### Mission Flow
```
MissionWorkspace (tab router)
├── MissionBentoDashboard    — overview tab
├── MissionBrief             — edit job_details, auto-save debounced 800ms, voice dictation
│   └── BriefWizard          — 5-step form (814 lines, the biggest component)
├── MissionProcess           — interview steps + team management (788 lines)
├── MissionSourcing          — LinkedIn/database search toggle
│   └── LinkedInSearch       — search orchestrator (the most complex component)
├── MissionOutreach          — sequences + invitations
├── MissionPipeline          — kanban candidate view
├── MissionInsights          — analytics
├── MissionConfig            — hunt mode, client portal, notes
└── MissionCopilot           — fixed bottom bar with contextual guidance
```

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
Search:     generate-search-filters, score-profile-job, database-search, refine-search-filters
AI:         ai-chat-completion, generate-outreach-message, generate-reply-suggestions, screen-candidate
Scoring:    score-profile-job (batch LLM via callLLMBatch, 10 profiles/call)
Data:       enrich-contact, enrich-company, generate-embedding
Email:      send-transactional-email, process-email-queue, process-inmail-queue
Integrations: unipile-search, unipile-accounts, stripe-webhook, aircall-webhook, calendly-webhook
```
77 fonctions déployées sur konekt-production. Voir liste complète : `ls supabase/functions/`.

---

## Supabase secrets (edge functions)

Configurer via dashboard : https://supabase.com/dashboard/project/crckfywoyjxkawathdff/settings/functions
ou CLI : `supabase secrets set --project-ref crckfywoyjxkawathdff KEY=value`.

### Auto-provisionnés par Supabase (ne pas toucher)
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `SUPABASE_PUBLISHABLE_KEY`.

### CRITICAL — à setter absolument, sinon fonctionnalités core cassées
| Secret | Utilisé par (principales) |
|--------|---------------------------|
| `ANTHROPIC_API_KEY` | **tous les appels AI** — le helper `_shared/call-claude.ts` est l'unique passerelle vers les LLM depuis la migration Lovable → Anthropic direct (2026-04-21). Ancien Lovable Gateway Gemini remplacé par Claude Haiku 4.5. Utilisé par ~30 fonctions : ai-chat-completion, score-profile-job, generate-search-filters, refine-search-filters, generate-outreach-message, generate-reply-suggestions, nurturing-analyzer, search-agent-chat, chat-filter-assistant, auto-analyze-message, sequence-send-email, enrich-vivier-contacts, process-sequences, analyze-linkedin-profile, analyze-response, audit-employer-brand, auto-categorize-chats, detect-profile-fraud, enrich-company, fetch-notion-jobs, generate-call-report, generate-recruiter-bio, generate-scorecard, live-coach, process-debrief, screen-candidate, n8n-create-workflow |
| `OPENAI_API_KEY` | backfill-knowledge-lake, fetch-notion-jobs, generate-embedding, ingest-context, retrieve-context (embeddings seulement) |
| `UNIPILE_API_KEY` + `UNIPILE_DSN` | unipile-accounts, unipile-search, unipile-webhook, unipile-manage-webhooks + toutes les fonctions qui touchent LinkedIn (~15 au total) |
| `NOTION_API_KEY` + `NOTION_CANDIDATS_DB_ID` + `NOTION_POSTES_DB_ID` + `NOTION_SHORTLIST_DB_ID` | add-to-shortlist, submit-application, process-sequences, auto-analyze-message, screen-candidate, fetch-notion-* |
| `STRIPE_SECRET_KEY` | create-checkout-session |
| `RESEND_API_KEY` | process-email-queue (envoi emails via Resend API) |

**Note importante** : `LOVABLE_API_KEY` est entièrement retiré depuis 2026-04-21 (AI + Email). Emails sont maintenant sur Resend. AI sur Anthropic direct.

### IMPORTANT — features secondaires
| Secret | Utilisé par |
|--------|-------------|
| `APOLLO_API_KEY` | apollo-search, database-search, enrich-company, enrich-contact, enrich-vivier-contacts, scan-recruiter-linkedin |
| `PDL_API_KEY` | pdl-search |
| `STRIPE_WEBHOOK_SECRET` | stripe-webhook |
| `AIRCALL_WEBHOOK_TOKEN` | aircall-webhook |
| `CALENDLY_WEBHOOK_SIGNING_KEY` | calendly-webhook |
| `UNIPILE_WEBHOOK_SECRET` | unipile-webhook, unipile-manage-webhooks, sequence-webhooks-handler |
| `PROCESS_SEQUENCES_SECRET` | process-sequences (cron auth) |
| `APP_URL` | create-checkout-session (= https://konekt-app-navy.vercel.app) |
| `RESEND_WEBHOOK_SECRET` | handle-email-suppression (Svix signature verif, format `whsec_...`) |

### OPTIONAL — fallback/dev
`DEEPGRAM_API_KEY`, `DEEPGRAM_PROJECT_ID`, `PERPLEXITY_API_KEY`, `FIRECRAWL_API_KEY`, `N8N_API_KEY`, `N8N_INSTANCE_URL`, `MICROSOFT_GRAPH_TOKEN`.

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
// Prospection is agency-only. Check featureGates.ts for the full matrix.
```

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
- **Lovable deploys from main** — must merge PR to main for changes to be visible
- **Edge functions are NOT auto-deployed** — run `supabase functions deploy <name>` or `--all`
- **Two filter formats coexist** — AI format vs LinkedInFiltersState, transformation in useLinkedInSearch
- **Step reordering**: uses temp negative order values to avoid UNIQUE constraint, then reassigns positive
- **Location deferred resolution**: if no LinkedIn account connected, location stays as keyword until account available
- **Prospection** is agency-only (Konekt internal) — gated via `featureGates.ts`
- **/candidates redirects to /pipeline** — one single entry point for candidates

---

## Apollo API (Base Konekt)

### Architecture
```
Frontend (buildSearchParams) → database-search edge function (mapFiltersToApollo) → Apollo API
```
- Apollo API key stored in Supabase secrets as `APOLLO_API_KEY`
- Edge function `database-search` translates LinkedIn filter format to Apollo format
- **Edge functions must be manually redeployed** after code changes (Lovable only deploys frontend)

### Apollo Search Flow
```
1. mixed_people/api_search → returns basic metadata (name, title, company, city)
   - NO linkedin_url, NO employment_history, NO email
   - Returns pagination.total_entries at TOP LEVEL (not in pagination object)
   
2. people/bulk_match → enriches profiles (linkedin_url, employment_history, email, phone)
   - Consumes 1 credit per profile
   - Batch limit: 10 profiles per call
   - This is where linkedin_url becomes available

3. apolloToLinkedInProfile() → converts Apollo format to LinkedInProfile format
```

### Apollo Pagination
- Apollo returns `total_entries` at top level of response (NOT inside `pagination` object)
- `per_page` defaults to 25
- Paginate by sending `page: 2`, `page: 3`, etc.
- Calculate total pages: `Math.ceil(total_entries / per_page)`

### Apollo Filter Mapping (mapFiltersToApollo)
| LinkedIn Filter | Apollo Parameter | Notes |
|----------------|-----------------|-------|
| keywords (Boolean) | q_keywords | Boolean cleaned → simple terms |
| role[].keywords | person_titles | Split on OR, include_similar_titles=true |
| location[].name | person_locations | Must be simple "City, Country" format |
| seniority | person_seniorities | Map: 1=intern, 2=entry, 4=senior, 5=manager... |
| company_keywords | q_organization_name | DOESNT_HAVE excluded |
| industry | q_organization_keyword_tags | Text tags, not LinkedIn IDs |
| school | q_keywords (appended) | Names only, IDs skipped |
| function | person_departments | Map: engineering, sales, product... |
| company_headcount | organization_num_employees_ranges | Map A-I to "1,10", "11,50"... |
| db_revenue_min/max | revenue_range[min]/[max] | Parse K/M/B suffixes |
| db_funding_stage | organization_latest_funding_stage_cd | Seed, Series A/B/C... |
| db_company_domain | q_organization_domains_list | Array of domains |
| db_email_verified | contact_email_status: ["verified"] | Toggle |
| db_technologies | currently_using_any_of_technology_uids | Array |

### Apollo Limitations
- Does NOT support Boolean syntax (AND/OR/NOT) → cleaned to simple terms
- `person_locations` must be simple format ("Paris, France" not "Ville de Paris, Île-de-France, France")
- q_keywords + person_titles AND'd together → too many keywords = 0 results
- When person_titles present, reduce q_keywords to max 4 terms
- Cap q_organization_name to 200 chars (prevents "Value too long" error)
- Cap q_keywords to 500 chars

### Apollo Profile Enrichment & Unipile
- Apollo profiles have work_experience (via bulk_match) but NO summary ("À propos")
- Unipile enrichment should ONLY trigger if profile lacks work_experience
- If Unipile returns empty data, KEEP Apollo data (don't overwrite with empties)
- linkedin_url only available AFTER bulk_match enrichment (not from search results)

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
**Edge functions are NOT auto-deployed by Lovable.** After merging changes to edge functions:
```bash
supabase functions deploy --all
# Or individually:
supabase functions deploy <function-name>
```
**SQL migrations** also require manual application:
```bash
supabase db push
```
Without this, old code keeps running on Supabase.
