# CLAUDE.md — Rules for this project

## Before modifying any file
1. **Read the FULL file** (or at minimum all imports + the function being changed)
2. **Search for all call sites** — grep for the function/component name to find who uses it
3. **Check for caches, memos, effects** — React state that might override your changes
4. **Check for race conditions** — useEffect dependency arrays, async timing

## Before committing
1. Run `npx tsc --noEmit` — zero errors required
2. Run `npx vite build` — must succeed
3. Verify no orphaned imports (grep for removed component/function names)

## Architecture rules
- When in mission context (`activeProject` exists), the brief IS the job — never ask users to select a job
- `filters_snapshot` on `sourcing_projects` stores AI-generated search filters
- `job_details` on `sourcing_projects` stores the brief data (JobDetails type)
- The LinkedInSearch component has an internal cache (`missionSearchCache`) that can override hook state — be aware of this when changing state flow

## Common pitfalls
- React useEffect dependencies: object references don't trigger re-runs, use specific fields (e.g., `activeProject?.id` not `activeProject`)
- The missionSearchCache in LinkedInSearch restores ALL state including selectedJob — any state changes in hooks can be overwritten by cache hydration
- Edge functions have a 60s timeout on Supabase — batch operations must complete within this
- Lovable deploys from `main` — changes must be merged to main to be visible
