# RLS Fix Plan — Phase 2 Security Hardening

**Date:** 2026-04-09
**Scope:** Replace remaining `USING(true)` and overly-permissive policies with proper org-scoping + freelance mission_team access.
**Constraint:** No changes to client portal (edge function with `service_role`).

---

## Summary of Current State

After Phase 1 migrations (20260306–20260409), most tables have org-scoped RLS. However:
- **4 tables** still have `USING(true)` SELECT policies that were never dropped
- **1 table** has a stale `USING(auth.role() = 'authenticated')` policy that bypasses org scoping
- **~20 tables** with org-scoped policies have `OR organization_id IS NULL` fallbacks that leak rows with no org
- **~15 tables** lack `mission_team` access paths, blocking freelancers assigned to missions

---

## Access Model

### Roles

| Role | Access Pattern |
|------|---------------|
| **Org member** (owner/admin/member) | All data where `organization_id = user's active org` |
| **Freelance on mission_team** | Only data linked to their assigned `project_id` via `mission_team` |
| **Public / anon** | Only `sourcing_projects` with `hunt_mode = true AND hunt_status = 'published'` |
| **Service role** | Unrestricted (edge functions) — no changes needed |

### Key Join Paths

```sql
-- User -> their org
SELECT om.organization_id FROM organization_members om WHERE om.user_id = auth.uid()

-- User -> org via cached helper (preferred, uses transaction cache)
public.get_user_org_id(auth.uid())

-- Freelance -> assigned projects
SELECT mt.project_id FROM mission_team mt WHERE mt.user_id = auth.uid()

-- Project -> org
SELECT sp.organization_id FROM sourcing_projects sp WHERE sp.id = :project_id
```

### Standard Policy Template

```sql
-- Org member access (most tables)
USING (
  organization_id IN (
    SELECT om.organization_id FROM organization_members om WHERE om.user_id = auth.uid()
  )
)

-- Mission-linked table (needs freelance access)
USING (
  organization_id IN (
    SELECT om.organization_id FROM organization_members om WHERE om.user_id = auth.uid()
  )
  OR project_id IN (
    SELECT mt.project_id FROM mission_team mt WHERE mt.user_id = auth.uid()
  )
)
```

---

## Part 1: Drop Remaining `USING(true)` Policies

### 1.1 `job_skills_cache` — "Anyone can read skills cache"

**Origin:** `20260127173902`
**Problem:** `USING(true)` — any user (including anon) can read all cached skills.
**Never dropped:** The `20260309170000` migration drops `"Anyone can view job skills cache"` (different name), so the original survives alongside the org-scoped policy.

**Fix:**
```sql
DROP POLICY IF EXISTS "Anyone can read skills cache" ON public.job_skills_cache;
```

The org-scoped "Org members can view job skills cache" from `20260309170000` already exists.

### 1.2 `events` — "Events are viewable by everyone"

**Origin:** `20251020114939`
**Problem:** `USING(true)` — fully public read. This is a legacy table from the original event template and is unused in Skalr.

**Fix:**
```sql
DROP POLICY IF EXISTS "Events are viewable by everyone" ON public.events;
-- If events are still queried, add:
-- CREATE POLICY "Authenticated users can view events"
--   ON public.events FOR SELECT TO authenticated
--   USING (auth.uid() = created_by);
```

### 1.3 `sequence_email_tracking` — "sequence_email_tracking_anon_select"

**Origin:** `20260331120000`, duplicated in `20260331215131` and `20260401040653`
**Problem:** `USING(true)` — anon can read all tracking rows.
**Rationale:** Originally designed for tracking pixel endpoints, but the actual tracking pixel endpoint should use `service_role` via edge function, not direct table access.

**Fix:**
```sql
DROP POLICY IF EXISTS "sequence_email_tracking_anon_select" ON public.sequence_email_tracking;
-- The "sequence_email_tracking_service_role" policy already handles edge function access.
-- If an edge function serves the tracking pixel, it already uses service_role.
```

### 1.4 `profiles` — "Anyone can read public recruiter profiles"

**Origin:** `20260324165613`
**Problem:** Not exactly `USING(true)` but allows any user (including anon) to read any profile where `public_slug IS NOT NULL AND recruiter_bio IS NOT NULL`. This is intentional for the public marketplace portfolio page.
**Status:** Keep as-is — this is the marketplace public profile feature. The exposed columns are intentionally public. The separate "Users can view own or same-org profiles" policy (from `20260313003144`) handles the private profile data correctly.

**No change needed.** Confirm the `profiles` view used by the portfolio page only exposes safe columns.

---

## Part 2: Fix Stale Permissive Policies

### 2.1 `job_profiles` — "Authenticated users can read"

**Origin:** `20260302174017`
**Problem:** `USING(auth.role() = 'authenticated')` — any authenticated user can read ALL job profiles regardless of org. The `20260309170000` migration added org-scoped policies but never dropped this one. Since Supabase PERMISSIVE policies are OR'd together, the old policy overrides the new one.

**Fix:**
```sql
DROP POLICY IF EXISTS "Authenticated users can read" ON public.job_profiles;
```

The org-scoped "Org members can view job profiles" from `20260309170000` already exists.

---

## Part 3: Remove `OR organization_id IS NULL` Fallbacks

**Problem:** Many tables have policies like:
```sql
USING (
  organization_id = get_user_org_id(auth.uid())
  OR (organization_id IS NULL AND created_by = auth.uid())
)
```

The `OR organization_id IS NULL` fallback was needed during the Phase 1 migration to avoid breaking existing data before backfill completed. Now that backfill has run, these fallbacks allow any row with `NULL organization_id` to be visible to its creator, bypassing org isolation.

**Approach:**
1. First verify backfill is complete: `SELECT count(*) FROM <table> WHERE organization_id IS NULL` for each table
2. For tables with 0 NULL rows: remove the fallback and add `NOT NULL` constraint
3. For tables with remaining NULLs: run backfill again, then constrain

### Tables to tighten (20 tables)

| # | Table | Current fallback | Action |
|---|-------|-----------------|--------|
| 1 | `sourcing_projects` | `OR (org IS NULL AND created_by = uid)` | Remove fallback, add `NOT NULL` |
| 2 | `search_history` | Same | Remove fallback, add `NOT NULL` |
| 3 | `job_candidate_status` | Same | Remove fallback, add `NOT NULL` |
| 4 | `outreach_sequences` | Same | Remove fallback, add `NOT NULL` |
| 5 | `saved_filter_presets` | Same | Remove fallback, add `NOT NULL` |
| 6 | `inmail_queue` | Same | Remove fallback, add `NOT NULL` |
| 7 | `qualification_sessions` | Same | Remove fallback, add `NOT NULL` |
| 8 | `candidate_evaluations` | Same | Remove fallback, add `NOT NULL` |
| 9 | `call_coaching_sessions` | Same | Remove fallback, add `NOT NULL` |
| 10 | `candidate_portal_tokens` | Same | Remove fallback, add `NOT NULL` |
| 11 | `candidate_notes` | Same | Remove fallback, add `NOT NULL` |
| 12 | `candidate_reminders` | Same | Remove fallback, add `NOT NULL` |
| 13 | `nurturing_opportunities` | Same | Remove fallback, add `NOT NULL` |
| 14 | `chat_categories` | Same | Remove fallback, add `NOT NULL` |
| 15 | `sequence_enrollments` | Same | Remove fallback, add `NOT NULL` |
| 16 | `candidate_profiles` | Same | Remove fallback, add `NOT NULL` |
| 17 | `match_scores` | Same | Remove fallback, add `NOT NULL` |
| 18 | `aircall_calls` | `OR organization_id IS NULL` (no created_by check!) | Remove fallback, add `NOT NULL` |
| 19 | `airtable_*` (11 tables) | Same as aircall_calls | Remove fallback, add `NOT NULL` |
| 20 | `job_profiles`, `job_skills_cache`, `sequence_analytics` | Same as aircall_calls | Remove fallback, add `NOT NULL` |

**Critical: Tables 18-20** have `OR organization_id IS NULL` **without** a `created_by` check, meaning ANY authenticated user can see rows with NULL org_id, not just the creator. These are the highest priority.

### Policy template after tightening

```sql
-- Before (current)
USING (
  organization_id = get_user_org_id(auth.uid())
  OR (organization_id IS NULL AND created_by = auth.uid())
)

-- After (target)
USING (
  organization_id IN (
    SELECT om.organization_id FROM organization_members om WHERE om.user_id = auth.uid()
  )
)
```

**Note:** We switch from `get_user_org_id()` (single active org) to `IN (SELECT ... FROM organization_members)` so a user in multiple orgs can access data from all their orgs, not just the active one.

---

## Part 4: Add Freelance `mission_team` Access Paths

Freelancers assigned to a mission via `mission_team` (role = 'freelance') currently can only see:
- `sourcing_projects` (via existing policy)
- `job_candidate_status` (via existing policy)

They **cannot** see related data they need to do their job. The following tables need mission_team SELECT policies.

### 4.1 `mission_process_steps`

**Why:** Freelancers need to see the interview process for missions they're assigned to.

```sql
CREATE POLICY "Mission team can view process steps"
  ON public.mission_process_steps FOR SELECT
  USING (
    project_id IN (
      SELECT mt.project_id FROM mission_team mt WHERE mt.user_id = auth.uid()
    )
  );
```

### 4.2 `candidate_notes`

**Why:** Freelancers need to read/write notes on candidates for their assigned projects.

```sql
-- SELECT: see notes for candidates on their project
CREATE POLICY "Mission team can view candidate notes"
  ON public.candidate_notes FOR SELECT
  USING (
    candidate_id IN (
      SELECT jcs.candidate_id FROM job_candidate_status jcs
      WHERE jcs.project_id IN (
        SELECT mt.project_id FROM mission_team mt WHERE mt.user_id = auth.uid()
      )
    )
  );

-- INSERT: create notes for candidates on their project
CREATE POLICY "Mission team can create candidate notes"
  ON public.candidate_notes FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND candidate_id IN (
      SELECT jcs.candidate_id FROM job_candidate_status jcs
      WHERE jcs.project_id IN (
        SELECT mt.project_id FROM mission_team mt WHERE mt.user_id = auth.uid()
      )
    )
  );
```

### 4.3 `candidate_evaluations`

**Why:** Freelancers submit candidate evaluations/scorecards.

```sql
CREATE POLICY "Mission team can view evaluations"
  ON public.candidate_evaluations FOR SELECT
  USING (
    candidate_id IN (
      SELECT jcs.candidate_id FROM job_candidate_status jcs
      WHERE jcs.project_id IN (
        SELECT mt.project_id FROM mission_team mt WHERE mt.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Mission team can create evaluations"
  ON public.candidate_evaluations FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND candidate_id IN (
      SELECT jcs.candidate_id FROM job_candidate_status jcs
      WHERE jcs.project_id IN (
        SELECT mt.project_id FROM mission_team mt WHERE mt.user_id = auth.uid()
      )
    )
  );
```

### 4.4 `candidate_comments`

**Why:** Freelancers participate in candidate discussions.

```sql
CREATE POLICY "Mission team can view candidate comments"
  ON public.candidate_comments FOR SELECT
  USING (
    candidate_id IN (
      SELECT jcs.candidate_id FROM job_candidate_status jcs
      WHERE jcs.project_id IN (
        SELECT mt.project_id FROM mission_team mt WHERE mt.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Mission team can create candidate comments"
  ON public.candidate_comments FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND candidate_id IN (
      SELECT jcs.candidate_id FROM job_candidate_status jcs
      WHERE jcs.project_id IN (
        SELECT mt.project_id FROM mission_team mt WHERE mt.user_id = auth.uid()
      )
    )
  );
```

### 4.5 `candidate_profiles`

**Why:** Freelancers need to see enriched profile data for candidates they're sourcing.

```sql
CREATE POLICY "Mission team can view candidate profiles"
  ON public.candidate_profiles FOR SELECT
  USING (
    candidate_id IN (
      SELECT jcs.candidate_id FROM job_candidate_status jcs
      WHERE jcs.project_id IN (
        SELECT mt.project_id FROM mission_team mt WHERE mt.user_id = auth.uid()
      )
    )
  );
```

### 4.6 `match_scores`

**Why:** Freelancers need to see AI scoring for candidates on their projects.

```sql
CREATE POLICY "Mission team can view match scores"
  ON public.match_scores FOR SELECT
  USING (
    job_id IN (
      SELECT 'project:' || mt.project_id::text FROM mission_team mt
      WHERE mt.user_id = auth.uid()
    )
    OR candidate_id IN (
      SELECT jcs.candidate_id FROM job_candidate_status jcs
      WHERE jcs.project_id IN (
        SELECT mt.project_id FROM mission_team mt WHERE mt.user_id = auth.uid()
      )
    )
  );
```

### 4.7 `outreach_sequences` (READ ONLY for freelancers)

**Why:** Freelancers need to see sequences linked to their project to understand outreach status. Access is limited to sequences linked to project candidates.

```sql
CREATE POLICY "Mission team can view project sequences"
  ON public.outreach_sequences FOR SELECT
  USING (
    id IN (
      SELECT se.sequence_id FROM sequence_enrollments se
      WHERE se.candidate_id IN (
        SELECT jcs.candidate_id FROM job_candidate_status jcs
        WHERE jcs.project_id IN (
          SELECT mt.project_id FROM mission_team mt WHERE mt.user_id = auth.uid()
        )
      )
    )
  );
```

### 4.8 Tables where freelancers should NOT have access

The following tables contain org-level data unrelated to specific missions. Freelancers should NOT access these:

- `organization_integrations` — org credentials
- `organization_members` — org membership (already properly scoped)
- `airtable_*` — legacy CRM imports (org-level)
- `aircall_calls` — org calls
- `knowledge_chunks` — org knowledge base
- `member_linkedin_accounts` — org LinkedIn accounts
- `member_email_accounts` — org email accounts
- `email_signatures` — org signatures
- `feature_activations` — org feature flags
- `organization_subscriptions` — billing
- `organization_credits` / `credit_transactions` — billing
- `agent_conversations` / `agent_messages` — org AI conversations
- `search_history` — org search history
- `saved_filter_presets` — org filter presets

---

## Part 5: Hunt Mode Marketplace Public Access

Published hunt missions must remain publicly visible for the marketplace.

### 5.1 `sourcing_projects` — public hunt SELECT

```sql
CREATE POLICY "Public can view published hunt missions"
  ON public.sourcing_projects FOR SELECT
  USING (
    hunt_mode = true AND hunt_status = 'published'
  );
```

This allows anon/authenticated users to browse the marketplace. Only published missions are exposed. The existing org-member and mission_team policies handle private access.

### 5.2 `hunt_applications` — already correct

The existing policy from `20260326090000` is correct:
```sql
USING (
  recruiter_user_id = auth.uid()
  OR project_id IN (SELECT sp.id FROM sourcing_projects sp WHERE sp.organization_id IN (...))
)
```
Recruiters see their own applications; org members see applications to their projects.

---

## Part 6: Helper Function Updates

### 6.1 Create `is_mission_team_member` helper

```sql
CREATE OR REPLACE FUNCTION public.is_mission_team_member(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM mission_team
    WHERE user_id = _user_id AND project_id = _project_id
  );
$$;
```

### 6.2 Create `get_user_mission_project_ids` helper

For efficient reuse in policies:
```sql
CREATE OR REPLACE FUNCTION public.get_user_mission_project_ids(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT project_id FROM mission_team WHERE user_id = _user_id;
$$;
```

---

## Migration Order

The migration should be executed as a single SQL file, in this order:

1. **Helper functions** (Part 6) — create first, used by policies
2. **Drop stale policies** (Parts 1 + 2) — remove USING(true) and stale permissive policies
3. **Backfill remaining NULLs** (Part 3 prerequisite) — ensure no rows have NULL org_id
4. **Tighten org policies** (Part 3) — remove OR NULL fallbacks, add NOT NULL constraints
5. **Add freelance policies** (Part 4) — mission_team SELECT/INSERT policies
6. **Add marketplace policy** (Part 5) — hunt mode public SELECT

### Pre-deployment checklist

- [ ] Run `SELECT table_name, count(*) FROM information_schema.columns ... WHERE organization_id IS NULL` to verify backfill completion
- [ ] Test with a freelance user: can see assigned project + candidates, cannot see other org data
- [ ] Test with org member: can see all org data across all projects
- [ ] Test marketplace: anon user can see published hunt missions, nothing else
- [ ] Test edge functions still work (they use `service_role`, unaffected by RLS)
- [ ] Run `npx tsc --noEmit` and `npx vite build` — zero errors

### Rollback

If issues arise, the migration can be rolled back by:
1. Re-creating the `OR organization_id IS NULL` fallbacks
2. The USING(true) drops are safe to leave — the org-scoped policies already exist

---

## Risk Assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| Drop USING(true) on `job_skills_cache` | Low — org-scoped policy exists | Verify edge functions use service_role |
| Drop USING(true) on `events` | Low — legacy table, unused | Verify no frontend queries |
| Drop USING(true) on `sequence_email_tracking` | Medium — tracking pixel endpoint | Verify tracking endpoint uses service_role edge function |
| Drop stale `job_profiles` policy | Low — org-scoped policy exists | Test job profile loading in search |
| Remove NULL fallbacks | Medium — if backfill incomplete, rows become invisible | Run backfill verification query first |
| Add NOT NULL constraints | Medium — if any code inserts without org_id, it will fail | Audit INSERT paths in frontend + edge functions |
| Add mission_team policies | Low — additive, no existing access removed | Test freelance user flow end-to-end |
| Add hunt marketplace policy | Low — additive, scoped to published hunts | Verify only published data exposed |

---

## Tables NOT Modified (already correct)

- `organizations` — properly scoped via `is_org_member()`
- `organization_members` — properly scoped + role hierarchy triggers
- `mission_team` — properly scoped via org member check on project
- `mission_invitations` — properly scoped (org + invitee email)
- `client_portal_tokens` — fixed in `20260409100000`, managed via edge function
- `organization_integrations` — properly scoped
- `member_linkedin_accounts` — properly scoped
- `member_email_accounts` — properly scoped
- `email_signatures` — properly scoped
- `knowledge_chunks` — properly scoped
- `enrichment_cache` — service_role only (no user policies)
- `email_send_log`, `email_send_state`, `suppressed_emails`, `email_unsubscribe_tokens` — service_role only
- `subscription_plans` — public read is correct (pricing page)
- `organization_subscriptions` — member read + service_role write
- `organization_credits`, `credit_transactions` — member read + service_role write
- `rate_limit_state` — service_role only
- `contact_submissions` — anon insert + admin read (contact form)
- `sequence_templates` — properly scoped by org
- `sequence_snippets` — properly scoped by org
- `process_templates` — properly scoped by org
- `message_snippets`, `message_templates` — properly scoped by org
- `notifications` — properly scoped by user_id
- `agent_conversations`, `agent_messages` — properly scoped by org
- `candidate_comments` — properly scoped by org (freelance access added in Part 4)
