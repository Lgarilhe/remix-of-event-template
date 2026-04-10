# Sprint 2 — Multi-Tenant Hardening

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock down multi-tenant isolation by adding org membership checks, fixing credential resolution in sequence processing, and tightening RLS policies.

**Architecture:** Create a shared `verifyOrgMembership` helper, then apply it to edge functions that accept `organization_id` from request body. Fix `process-sequences` to resolve Unipile credentials per-org. Add org-scoped RLS to tables with permissive policies.

**Tech Stack:** Deno edge functions (TypeScript), Supabase (PostgreSQL RLS), SQL migrations

---

### Task 1: Create shared verifyOrgMembership helper

**Files:**
- Modify: `supabase/functions/_shared/require-auth.ts`

Add a reusable org membership verification function to the existing auth shared module.

- [ ] **Step 1: Add verifyOrgMembership to require-auth.ts**

Append this function at the end of the file:

```typescript
/**
 * Verify that a user belongs to the given organization.
 * Returns true if membership confirmed, false otherwise.
 * Requires a service-role Supabase client (bypasses RLS).
 */
export async function verifyOrgMembership(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  organizationId: string
): Promise<boolean> {
  const { data } = await adminClient
    .from("organization_members")
    .select("id")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return !!data;
}
```

Make sure `createClient` is imported at the top of the file (it likely already is — check and add if needed):
```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/require-auth.ts
git commit -m "feat(auth): add shared verifyOrgMembership helper

Reusable function to verify a user belongs to a given organization.
Returns boolean, uses maybeSingle() for safety.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add org membership check to enrich-contact

**Files:**
- Modify: `supabase/functions/enrich-contact/index.ts`

This function takes `organization_id` from the request body and uses it to resolve Apollo API credentials. Without membership check, any authenticated user can use another org's Apollo key.

- [ ] **Step 1: Add membership check after auth and body parsing**

Read the file first. Find where `organization_id` is extracted from the body (around line 27) and where the admin client is created. After both are available, add:

```typescript
    // Verify org membership
    if (organization_id && auth.userId) {
      const { verifyOrgMembership } = await import("../_shared/require-auth.ts");
      const isMember = await verifyOrgMembership(admin, auth.userId, organization_id);
      if (!isMember) {
        return json({ error: "Forbidden" }, 403);
      }
    }
```

Place this BEFORE the credential resolution call (`resolveApolloCredentials`).

Note: If `auth.method === 'service_role'`, skip the membership check (service role calls are internal). The `requireAuth` helper already handles this — check if `auth.userId` is null for service_role calls.

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/enrich-contact/index.ts
git commit -m "fix(enrich-contact): verify org membership before credential resolution

Previously accepted organization_id from body without checking if the
user belongs to that org. An attacker could use another org's Apollo
API credentials.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Add org membership check to auto-analyze-message

**Files:**
- Modify: `supabase/functions/auto-analyze-message/index.ts`

This function takes `organization_id` from body and uses it for Unipile/Notion credential resolution AND credit billing. It has dual auth (JWT + service_role for webhooks).

- [ ] **Step 1: Add membership check after auth and body parsing**

Find where `organization_id` is extracted from the body (around line 312). After auth is validated and body is parsed, add:

```typescript
    // Verify org membership (skip for service_role — used by webhooks)
    if (organization_id && userId) {
      const { verifyOrgMembership } = await import("../_shared/require-auth.ts");
      const isMember = await verifyOrgMembership(supabase, userId, organization_id);
      if (!isMember) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }
```

The `userId` variable comes from the JWT auth path. When called via service_role (webhooks), `userId` will be null, so the check is naturally skipped.

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/auto-analyze-message/index.ts
git commit -m "fix(auto-analyze-message): verify org membership before credential resolution

Previously accepted organization_id from body without checking if the
user belongs to that org. Could use another org's Unipile/Notion creds
and bill credits to the wrong org.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Fix process-sequences to resolve Unipile credentials per-org

**Files:**
- Modify: `supabase/functions/process-sequences/index.ts`

This function uses global env var credentials for ALL organizations. Orgs with custom Unipile credentials are ignored — all sequence actions (messages, InMails, connection requests) go through the platform-level Unipile account.

The fix: resolve credentials per-enrollment using the enrollment's `organization_id`.

- [ ] **Step 1: Read the file to understand the credential usage pattern**

Read lines 1-25 (global vars) and lines 280-300 (where enrollment is accessed in the processing loop) to understand how to inject per-org credentials.

The key insight: each `enrollment` in the processing loop has an `organization_id` (via the `sequence_enrollments` table). We need to resolve Unipile credentials for that org before making API calls.

- [ ] **Step 2: Replace global Unipile constants with a per-org resolver**

At the top of the file (lines 11-13), change the global constants:

```typescript
const UNIPILE_API_KEY = Deno.env.get('UNIPILE_API_KEY');
const UNIPILE_DSN_RAW = (Deno.env.get('UNIPILE_DSN') || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const UNIPILE_DSN = `https://${UNIPILE_DSN_RAW}`;
```

To env fallback constants:

```typescript
const ENV_UNIPILE_API_KEY = Deno.env.get('UNIPILE_API_KEY');
const ENV_UNIPILE_DSN_RAW = (Deno.env.get('UNIPILE_DSN') || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const ENV_UNIPILE_DSN = `https://${ENV_UNIPILE_DSN_RAW}`;
```

- [ ] **Step 3: Add a per-org credential resolver function**

After the `fetchWithTimeout` definition, add:

```typescript
// Per-org Unipile credential resolution with env fallback
async function resolveUnipileCreds(orgId: string | undefined, supabaseClient: any): Promise<{ apiKey: string; dsn: string }> {
  const fallback = { apiKey: ENV_UNIPILE_API_KEY!, dsn: ENV_UNIPILE_DSN };
  if (!orgId) return fallback;
  try {
    const { resolveUnipileCredentials } = await import("../_shared/resolve-org-credentials.ts");
    const creds = await resolveUnipileCredentials(orgId, supabaseClient);
    if (creds) {
      const rawDsn = creds.dsn.replace(/^https?:\/\//, '').replace(/\/$/, '');
      return { apiKey: creds.apiKey, dsn: `https://${rawDsn}` };
    }
  } catch (e) {
    console.warn('[process-sequences] Org credential resolution failed, using env:', e);
  }
  return fallback;
}
```

- [ ] **Step 4: Update all Unipile API calls to use resolved credentials**

This is the most complex part. The file has many functions that use `UNIPILE_API_KEY` and `UNIPILE_DSN` directly: `getProfileInfo`, `resolveProfileIdForChat`, `checkForReplyAfterDate`, `resolveAttendeeIds`, `checkMessagesForReply`, `checkHasProspectReplied`, `checkQuotaForAction`, `executeStepAction`, `fetchRecentPostsForSequence`.

The approach: 
1. In `handleProcess`, after loading each enrollment, resolve credentials: `const uCreds = await resolveUnipileCreds(enrollment.organization_id, supabase);`
2. Pass `uCreds` (or `uCreds.apiKey` and `uCreds.dsn`) through to all functions that make Unipile API calls.
3. Update function signatures to accept `apiKey` and `dsn` parameters instead of reading globals.

**This is a large refactor.** Each function that calls Unipile needs its signature updated. Do it methodically:

For each function that uses `UNIPILE_API_KEY` or `UNIPILE_DSN`:
- Add `apiKey: string, dsn: string` parameters (or a `uCreds: { apiKey: string; dsn: string }` object)
- Replace `UNIPILE_API_KEY!` with `apiKey` and `UNIPILE_DSN` with `dsn`
- Update all call sites to pass the resolved credentials

Also update `handleCheckReplies`, `handleCheckTimeouts`, `handleCheckWaitEvents` — these need to resolve credentials per-enrollment too.

- [ ] **Step 5: Verify no global UNIPILE_API_KEY/UNIPILE_DSN usage remains**

```bash
grep -n "UNIPILE_API_KEY\b\|UNIPILE_DSN\b" supabase/functions/process-sequences/index.ts | grep -v "ENV_UNIPILE"
```
Expected: 0 matches (only ENV_UNIPILE_* should remain at module level).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/process-sequences/index.ts
git commit -m "fix(process-sequences): resolve Unipile credentials per-org

Previously used global env var credentials for ALL organizations.
Orgs with custom Unipile credentials were ignored. Now resolves
credentials per-enrollment using organization_id from the enrollment.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Add org-scoped RLS migration

**Files:**
- Create: `supabase/migrations/20260410120000_org_rls_hardening.sql`

Add org-scoped RLS to tables with overly permissive policies.

- [ ] **Step 1: Create the migration file**

```sql
-- Sprint 2: Multi-tenant RLS hardening
-- Fixes: airtable_glossary open SELECT, airtable_sync_meta open SELECT

-- ── 1. airtable_glossary: replace open SELECT with org-scoped policy ──

DROP POLICY IF EXISTS "Authenticated users can read glossary" ON public.airtable_glossary;

CREATE POLICY "Users can read own org glossary" ON public.airtable_glossary
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid()
    )
    OR organization_id IS NULL  -- legacy rows not yet backfilled
  );

-- ── 2. airtable_sync_meta: add organization_id and org-scoped policy ──

ALTER TABLE public.airtable_sync_meta
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);

DROP POLICY IF EXISTS "Authenticated users can read sync meta" ON public.airtable_sync_meta;

CREATE POLICY "Users can read own org sync meta" ON public.airtable_sync_meta
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid()
    )
    OR organization_id IS NULL  -- legacy rows not yet backfilled
  );

-- ── 3. Remove OR organization_id IS NULL from core sequence tables ──
-- These tables were backfilled in phase 2 migration. Safe to tighten now.
-- NOTE: Only do this for tables where we're confident all rows have org_id.
-- Check with: SELECT count(*) FROM table WHERE organization_id IS NULL;
-- If any NULLs remain, backfill first before running this.

-- Commented out until backfill is verified:
-- DROP POLICY IF EXISTS "..." ON public.sequence_enrollments;
-- CREATE POLICY "..." ON public.sequence_enrollments FOR SELECT USING (
--   organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
-- );
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260410120000_org_rls_hardening.sql
git commit -m "fix(rls): tighten org-scoped policies on airtable tables

- airtable_glossary: replace open SELECT with org-membership check
- airtable_sync_meta: add organization_id column + org-scoped SELECT
- Keep OR NULL fallback for legacy rows until backfill verified

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Final Verification

- [ ] **Run type check**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Push to main**

```bash
git push origin main
```
