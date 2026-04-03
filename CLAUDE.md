# CLAUDE.md — Rules & Code Map for Skalr

## Before modifying any file
1. **Read the FULL file** (or at minimum all imports + the function being changed)
2. **Search for all call sites** — grep for the function/component name to find who uses it
3. **Check for caches, memos, effects** — React state that might override your changes
4. **Check for race conditions** — useEffect dependency arrays, async timing
5. **Always sync with main first** — `git fetch origin main && git rebase origin/main` (Lovable pushes to main)

## Before committing
1. Run `npx tsc --noEmit` — zero errors required
2. Run `npx vite build` — must succeed
3. Verify no orphaned imports (grep for removed component/function names)

---

## Architecture rules
- When in mission context (`activeProject` exists), the brief IS the job — never ask users to select a job
- `filters_snapshot` on `sourcing_projects` stores AI-generated search filters + suggestions
- `job_details` on `sourcing_projects` stores the brief data (JobDetails type from `src/types/jobDetails.ts`)
- The LinkedInSearch component has an internal cache (`missionSearchCache`) that can override hook state

---

## Code Map

### Routes (src/App.tsx)
```
/missions                → Outreach page (ProjectsList)
/missions/:id            → MissionWorkspace (8 tabs: overview/brief/process/sourcing/outreach/pipeline/insights/config)
/mission-invite/:token   → AcceptMissionInvite
/pipeline                → ATS page
/inbox                   → MessagesInbox
/dashboard               → Dashboard
/settings                → Settings
Legacy: /outreach → /missions, /ats → /pipeline, /prospection → /missions?tab=prospection
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

## Common Pitfalls
- **useEffect deps**: use `activeProject?.id` not `activeProject` (object ref never changes)
- **missionSearchCache**: restores ALL state — any hook state changes can be overwritten on tab switch
- **Edge function timeout**: 60s on Supabase — batch LLM calls must fit within this
- **Lovable deploys from main** — must merge PR to main for changes to be visible
- **Two filter formats coexist** — AI format vs LinkedInFiltersState, transformation in useLinkedInSearch
- **Step reordering**: uses temp negative order values to avoid UNIQUE constraint, then reassigns positive
- **Location deferred resolution**: if no LinkedIn account connected, location stays as keyword until account available

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
supabase functions deploy database-search
supabase functions deploy score-profile-job
supabase functions deploy generate-search-filters
```
Or ask Lovable to redeploy. Without this, old code keeps running on Supabase.
