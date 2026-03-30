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
