# Sprint 1 — Critical Audit Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all CRITIQUE-severity findings from the security/stability audit — 8 independent fixes covering GDPR compliance, SQL injection, credential leaks, broken functions, deprecated AI models, and silent UX failures.

**Architecture:** Each task is a surgical fix to one edge function or component. No cross-dependencies between tasks — they can be done in any order. All changes are in existing files, no new files created.

**Tech Stack:** Deno edge functions (TypeScript), React 18, Supabase

---

### Task 1: Fix RGPD purge — wrong table name (D1)

**Files:**
- Modify: `supabase/functions/rgpd-purge/index.ts:56,75,97,114`

The function queries `candidate_job_status` but the actual table is `job_candidate_status`. GDPR purge is completely broken — no candidates are ever purged.

- [ ] **Step 1: Fix table name on line 56 (stale candidates query)**

Replace:
```typescript
        .from("candidate_job_status")
```
With:
```typescript
        .from("job_candidate_status")
```

- [ ] **Step 2: Fix table name on line 75 (stale candidates delete)**

Replace:
```typescript
          .from("candidate_job_status")
```
With:
```typescript
          .from("job_candidate_status")
```

- [ ] **Step 3: Fix table name on line 97 (refused candidates query)**

Replace:
```typescript
        .from("candidate_job_status")
```
With:
```typescript
        .from("job_candidate_status")
```

- [ ] **Step 4: Fix table name on line 114 (refused candidates delete)**

Replace:
```typescript
          .from("candidate_job_status")
```
With:
```typescript
          .from("job_candidate_status")
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/rgpd-purge/index.ts
git commit -m "fix(rgpd-purge): use correct table name job_candidate_status

The function was querying non-existent table 'candidate_job_status'.
GDPR purge was completely non-functional — no candidates were ever purged."
```

---

### Task 2: Fix normalizeProfileData missing brace (U1)

**Files:**
- Modify: `supabase/functions/unipile-search/index.ts:1741,1791-1795`

The `normalizeProfileData` function (starts line 1662) is missing a closing brace after the `projects` block. This causes `handleEndorseSkill` to be nested inside it (inaccessible from the main switch), and the orphaned lines 1791-1795 (`return result; }`) to be dangling.

- [ ] **Step 1: Close the projects if-block AND the function before handleEndorseSkill**

Replace line 1741 (which currently only closes the `if` block):
```typescript
}
```
With (close the `if` block, add contact_info comment, return result, AND close the function):
```typescript
  }

  // Ensure contact_info is preserved
  // provider_id -> keep for reference
  
  return result;
}
```

- [ ] **Step 2: Remove the orphaned tail at lines 1791-1795**

Delete these lines (they are now duplicated by the code added in step 1):
```typescript
  // Ensure contact_info is preserved
  // provider_id → keep for reference
  
  return result;
}
```

- [ ] **Step 3: Verify syntax by checking the file parses**

Run: `deno check supabase/functions/unipile-search/index.ts 2>&1 | head -5` (or just visually verify the brace structure is correct)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/unipile-search/index.ts
git commit -m "fix(unipile-search): close normalizeProfileData before handleEndorseSkill

Missing brace caused handleEndorseSkill to be nested inside
normalizeProfileData, making it inaccessible from the main switch case.
The endorse_skill action would throw ReferenceError at runtime."
```

---

### Task 3: Fix double https:// in Unipile URLs (U2)

**Files:**
- Modify: `supabase/functions/generate-outreach-message/index.ts:233`

The `resolveUnipileCredentials` shared module returns `dsn` with `https://` prefix. Line 233 wraps it again with `https://`, producing `https://https://xxx.unipile.com/...`.

- [ ] **Step 1: Fix the URL construction**

On line 233, replace:
```typescript
    const url = `https://${creds.dsn}/api/v1/users/${encodeURIComponent(profileId)}/posts?account_id=${encodeURIComponent(accountId)}&limit=${maxPosts}`;
```
With:
```typescript
    const baseDsn = creds.dsn.startsWith('http') ? creds.dsn : `https://${creds.dsn}`;
    const url = `${baseDsn}/api/v1/users/${encodeURIComponent(profileId)}/posts?account_id=${encodeURIComponent(accountId)}&limit=${maxPosts}`;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/generate-outreach-message/index.ts
git commit -m "fix(generate-outreach-message): prevent double https:// in Unipile URLs

resolveUnipileCredentials returns dsn with https:// prefix, but the code
was wrapping it again. Broke LinkedIn post fetching for orgs with custom
Unipile credentials."
```

---

### Task 4: Update all deprecated AI model IDs (AI1-AI7)

**Files:**
- Modify: `supabase/functions/generate-outreach-message/index.ts:377,381`
- Modify: `supabase/functions/generate-search-filters/index.ts:172`
- Modify: `supabase/functions/generate-reply-suggestions/index.ts:587,668`
- Modify: `supabase/functions/nurturing-analyzer/index.ts:920`
- Modify: `supabase/functions/auto-analyze-message/index.ts:235`
- Modify: `supabase/functions/enrich-vivier-contacts/index.ts:426`
- Modify: `supabase/functions/refine-search-filters/index.ts:61`
- Modify: `supabase/functions/search-agent-chat/index.ts:454`
- Modify: `supabase/functions/chat-filter-assistant/index.ts:159`
- Modify: `supabase/functions/n8n-create-workflow/index.ts:294`

All occurrences of `claude-sonnet-4-20250514` must become `claude-sonnet-4-6`.
The one occurrence of `claude-3-7-sonnet-latest` must become `claude-sonnet-4-6`.

- [ ] **Step 1: Replace in generate-outreach-message (2 occurrences)**

Line 377 — replace:
```typescript
    let _resolvedAnthropicModel = "claude-sonnet-4-20250514";
```
With:
```typescript
    let _resolvedAnthropicModel = "claude-sonnet-4-6";
```

Line 381 — replace:
```typescript
      _resolvedAnthropicModel = resolved.startsWith("claude-") ? resolved : "claude-sonnet-4-20250514";
```
With:
```typescript
      _resolvedAnthropicModel = resolved.startsWith("claude-") ? resolved : "claude-sonnet-4-6";
```

- [ ] **Step 2: Replace in generate-search-filters**

Line 172 — replace:
```typescript
  let resolvedModel = "claude-sonnet-4-20250514";
```
With:
```typescript
  let resolvedModel = "claude-sonnet-4-6";
```

- [ ] **Step 3: Replace in generate-reply-suggestions (2 occurrences)**

Line 587 — replace:
```typescript
        model: "claude-sonnet-4-20250514",
```
With:
```typescript
        model: "claude-sonnet-4-6",
```

Line 668 — replace:
```typescript
        model: "claude-sonnet-4-20250514",
```
With:
```typescript
        model: "claude-sonnet-4-6",
```

- [ ] **Step 4: Replace in nurturing-analyzer**

Line 920 — replace:
```typescript
        model: "claude-sonnet-4-20250514",
```
With:
```typescript
        model: "claude-sonnet-4-6",
```

- [ ] **Step 5: Replace in auto-analyze-message**

Line 235 — replace:
```typescript
          model: "claude-sonnet-4-20250514",
```
With:
```typescript
          model: "claude-sonnet-4-6",
```

- [ ] **Step 6: Replace in enrich-vivier-contacts**

Line 426 — replace:
```typescript
          model: "claude-sonnet-4-20250514",
```
With:
```typescript
          model: "claude-sonnet-4-6",
```

- [ ] **Step 7: Replace in refine-search-filters**

Line 61 — replace:
```typescript
  let resolvedModel = "claude-sonnet-4-20250514";
```
With:
```typescript
  let resolvedModel = "claude-sonnet-4-6";
```

- [ ] **Step 8: Replace in search-agent-chat**

Line 454 — replace:
```typescript
    let resolvedModel = "claude-sonnet-4-20250514";
```
With:
```typescript
    let resolvedModel = "claude-sonnet-4-6";
```

- [ ] **Step 9: Replace in chat-filter-assistant**

Line 159 — replace:
```typescript
  let resolvedModel = "claude-sonnet-4-20250514";
```
With:
```typescript
  let resolvedModel = "claude-sonnet-4-6";
```

- [ ] **Step 10: Replace in n8n-create-workflow (invalid model)**

Line 294 — replace:
```typescript
            model: "claude-3-7-sonnet-latest",
```
With:
```typescript
            model: "claude-sonnet-4-6",
```

- [ ] **Step 11: Verify no deprecated IDs remain**

Run:
```bash
grep -rn "claude-sonnet-4-20250514\|claude-3-7-sonnet" supabase/functions/ --include="*.ts"
```
Expected: 0 matches (or only matches in comments/docs).

- [ ] **Step 12: Commit**

```bash
git add supabase/functions/generate-outreach-message/index.ts \
       supabase/functions/generate-search-filters/index.ts \
       supabase/functions/generate-reply-suggestions/index.ts \
       supabase/functions/nurturing-analyzer/index.ts \
       supabase/functions/auto-analyze-message/index.ts \
       supabase/functions/enrich-vivier-contacts/index.ts \
       supabase/functions/refine-search-filters/index.ts \
       supabase/functions/search-agent-chat/index.ts \
       supabase/functions/chat-filter-assistant/index.ts \
       supabase/functions/n8n-create-workflow/index.ts
git commit -m "fix(ai): update all deprecated model IDs to claude-sonnet-4-6

Replaced 10 occurrences of claude-sonnet-4-20250514 and 1 occurrence of
invalid claude-3-7-sonnet-latest across 10 edge functions."
```

---

### Task 5: Fix SQL injection in pdl-search (S4)

**Files:**
- Modify: `supabase/functions/pdl-search/index.ts:44-127`

User-supplied values are interpolated directly into SQL strings via template literals. PDL's SQL API uses its own query syntax (not Postgres), but the injection risk remains — an attacker can break out of string literals to alter the query logic.

- [ ] **Step 1: Add a sanitization function at the top of the file (after line 9)**

After line 9 (`const PDL_BASE = ...`), add:
```typescript

// Sanitize user input for PDL SQL queries: escape single quotes and strip dangerous chars
function sanitizePdl(value: string): string {
  return value.replace(/'/g, "''").replace(/[;\\]/g, '').slice(0, 200);
}
```

- [ ] **Step 2: Apply sanitizePdl to all string interpolations in conditions**

Replace the conditions block (lines 44-127) with sanitized versions. Every occurrence of `${body.xxx}` and `${t}`, `${s}`, `${l}`, `${i}` inside SQL strings must be wrapped with `sanitizePdl()`.

Key changes (apply to ALL similar patterns):

Line 46-47 — replace:
```typescript
      if (titles.length === 1) conditions.push(`job_title LIKE '%${titles[0]}%'`);
      else conditions.push(`(${titles.map((t: string) => `job_title LIKE '%${t}%'`).join(' OR ')})`);
```
With:
```typescript
      if (titles.length === 1) conditions.push(`job_title LIKE '%${sanitizePdl(titles[0])}%'`);
      else conditions.push(`(${titles.map((t: string) => `job_title LIKE '%${sanitizePdl(t)}%'`).join(' OR ')})`);
```

Line 49 — replace:
```typescript
    if (body.job_title_role) conditions.push(`job_title_role='${body.job_title_role}'`);
```
With:
```typescript
    if (body.job_title_role) conditions.push(`job_title_role='${sanitizePdl(body.job_title_role)}'`);
```

Apply the same `sanitizePdl()` wrapping to ALL remaining `body.xxx` interpolations in lines 50-127:
- `body.job_title_sub_role` (line 50)
- `body.job_title_class` (line 51)
- `body.job_title_levels` items (lines 53-54)
- `body.job_company_name` (line 58)
- `body.job_company_industry` (line 59)
- `body.job_company_size` (line 60)
- `body.job_company_type` (line 61)
- `body.job_company_ticker` (line 62)
- `body.job_company_inferred_revenue` (line 69)
- `body.job_company_location_country` (line 79)
- `body.job_company_location_region` (line 80)
- `body.job_company_location_locality` (line 81)
- `body.location_country` (line 84)
- `body.location_continent` (line 85)
- `body.location_region` (line 86)
- `body.location_metro` (line 87)
- `body.location_locality` (line 88)
- `body.skills` items (line 92)
- `body.inferred_salary` (line 105)
- `body.industry` (line 106)
- `body.education_school` (line 108)
- `body.education_degree` (line 109)
- `body.education_major` (line 110)
- `body.languages` items (line 114)
- `body.certifications` (line 118)
- `body.interests` items (line 123)
- `body.summary` (line 127)

- [ ] **Step 3: Also add fetchWithTimeout for the PDL API call**

Line 149 — replace:
```typescript
    const pdlResponse = await fetch(`${PDL_BASE}/person/search`, {
```
With:
```typescript
    const pdlResponse = await fetchWithTimeout(`${PDL_BASE}/person/search`, {
```

And add the `fetchWithTimeout` helper after `sanitizePdl` (if not already present):
```typescript
function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/pdl-search/index.ts
git commit -m "fix(pdl-search): sanitize all user inputs against SQL injection

User-supplied values were interpolated directly into PDL SQL queries.
Added sanitizePdl() to escape quotes and strip dangerous characters.
Also added fetchWithTimeout for the API call."
```

---

### Task 6: Remove Deepgram master key fallback (S5)

**Files:**
- Modify: `supabase/functions/deepgram-temp-key/index.ts:76-82`

When `DEEPGRAM_PROJECT_ID` is not set, the function returns the master API key to the client.

- [ ] **Step 1: Replace the fallback with an error response**

Replace lines 76-82:
```typescript
    // Fallback: return the API key directly (for WebSocket auth)
    // WARNING: This exposes the master key — set DEEPGRAM_PROJECT_ID to use temp keys
    console.warn('[deepgram-temp-key] DEEPGRAM_PROJECT_ID not set — returning master key (insecure)');
    return new Response(
      JSON.stringify({ key: DEEPGRAM_API_KEY }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
```
With:
```typescript
    // DEEPGRAM_PROJECT_ID is required for secure temp key generation
    console.error('[deepgram-temp-key] DEEPGRAM_PROJECT_ID not configured — refusing to expose master key');
    return new Response(
      JSON.stringify({ error: "DEEPGRAM_PROJECT_ID not configured. Cannot generate temporary key." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/deepgram-temp-key/index.ts
git commit -m "fix(deepgram-temp-key): refuse to expose master API key

Previously fell back to returning the master Deepgram API key to the
client when DEEPGRAM_PROJECT_ID was not set. Now returns a 500 error
instead."
```

---

### Task 7: Fix mutable global credentials (E2-E4)

**Files:**
- Modify: `supabase/functions/auto-analyze-message/index.ts:11-16,22-39`
- Modify: `supabase/functions/check-invitation-status/index.ts:10-14,129-136`
- Modify: `supabase/functions/backfill-calendly/index.ts:12`

Module-level `let` variables for API keys/DSNs are reassigned per-request. In Deno Deploy, the module scope persists across concurrent requests, causing credential bleed between orgs.

- [ ] **Step 1: Fix auto-analyze-message — make credentials immutable at module level**

Replace lines 10-16:
```typescript
// Per-org credentials — resolved at request time, env vars as fallback
let UNIPILE_API_KEY = Deno.env.get("UNIPILE_API_KEY");
let UNIPILE_DSN = Deno.env.get("UNIPILE_DSN");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
let NOTION_API_KEY = Deno.env.get("NOTION_API_KEY");
let CANDIDATS_DATABASE_ID = Deno.env.get("NOTION_CANDIDATS_DB_ID")!;
let SHORTLIST_DATABASE_ID = Deno.env.get("NOTION_SHORTLIST_DB_ID")!;
```
With:
```typescript
// Env fallbacks — NEVER reassigned. Per-org credentials resolved per-request.
const ENV_UNIPILE_API_KEY = Deno.env.get("UNIPILE_API_KEY");
const ENV_UNIPILE_DSN = Deno.env.get("UNIPILE_DSN");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ENV_NOTION_API_KEY = Deno.env.get("NOTION_API_KEY");
const ENV_CANDIDATS_DATABASE_ID = Deno.env.get("NOTION_CANDIDATS_DB_ID")!;
const ENV_SHORTLIST_DATABASE_ID = Deno.env.get("NOTION_SHORTLIST_DB_ID")!;
```

Then replace `resolveOrgCredentials` (lines 22-39) to return credentials instead of mutating globals:
```typescript
interface OrgCreds {
  unipileApiKey: string | undefined;
  unipileDsn: string | undefined;
  notionApiKey: string | undefined;
  candidatsDbId: string;
  shortlistDbId: string;
}

async function resolveOrgCredentials(organizationId?: string): Promise<OrgCreds> {
  const defaults: OrgCreds = {
    unipileApiKey: ENV_UNIPILE_API_KEY,
    unipileDsn: ENV_UNIPILE_DSN,
    notionApiKey: ENV_NOTION_API_KEY,
    candidatsDbId: ENV_CANDIDATS_DATABASE_ID,
    shortlistDbId: ENV_SHORTLIST_DATABASE_ID,
  };
  if (!organizationId) return defaults;
  try {
    const { resolveUnipileCredentials, resolveNotionCredentials } = await import("../_shared/resolve-org-credentials.ts");
    const uCreds = await resolveUnipileCredentials(organizationId, supabase);
    if (uCreds) {
      defaults.unipileApiKey = uCreds.apiKey;
      defaults.unipileDsn = uCreds.dsn.replace(/^https?:\/\//, '');
    }
    const nCreds = await resolveNotionCredentials(organizationId, supabase);
    if (nCreds) {
      defaults.notionApiKey = nCreds.apiKey;
      if (nCreds.candidatsDbId) defaults.candidatsDbId = nCreds.candidatsDbId;
      if (nCreds.shortlistDbId) defaults.shortlistDbId = nCreds.shortlistDbId;
    }
  } catch (e) {
    console.warn('[auto-analyze] Org credential resolution failed, using env:', e);
  }
  return defaults;
}
```

Then update the call site in the handler to use the returned object and pass it through to functions that need credentials (search for usages of `UNIPILE_API_KEY`, `UNIPILE_DSN`, `NOTION_API_KEY`, `CANDIDATS_DATABASE_ID`, `SHORTLIST_DATABASE_ID` in the file and replace with `creds.unipileApiKey`, `creds.unipileDsn`, etc.).

- [ ] **Step 2: Fix check-invitation-status — same pattern**

Replace lines 10-14:
```typescript
// Unipile credentials resolved per-org at request time (see Deno.serve handler)
let UNIPILE_API_KEY: string | null = Deno.env.get('UNIPILE_API_KEY') || null;
let UNIPILE_DSN: string = '';
const rawDsn = Deno.env.get('UNIPILE_DSN') || '';
const envDsn = rawDsn.startsWith('http') ? rawDsn : `https://${rawDsn}`;
UNIPILE_DSN = envDsn;
```
With:
```typescript
// Env fallbacks — NEVER reassigned. Per-org credentials resolved per-request.
const ENV_UNIPILE_API_KEY: string | null = Deno.env.get('UNIPILE_API_KEY') || null;
const rawDsn = Deno.env.get('UNIPILE_DSN') || '';
const ENV_UNIPILE_DSN: string = rawDsn.startsWith('http') ? rawDsn : `https://${rawDsn}`;
```

Then update the credential resolution block (lines 129-136) to store results in local variables instead of mutating globals:
```typescript
    let unipileApiKey = ENV_UNIPILE_API_KEY;
    let unipileDsn = ENV_UNIPILE_DSN;
    try {
      const { resolveUnipileCredentials, resolveOrgIdFromUser } = await import("../_shared/resolve-org-credentials.ts");
      const orgId = await resolveOrgIdFromUser(user.id, supabase);
      const creds = await resolveUnipileCredentials(orgId, supabase);
      if (creds) {
        unipileApiKey = creds.apiKey;
        unipileDsn = creds.dsn;
      }
    } catch (e) {
      console.warn('[check-invitation] Org credential resolution failed, using env:', e);
    }
```

Then replace all usages of `UNIPILE_API_KEY` and `UNIPILE_DSN` in the rest of the handler with `unipileApiKey` and `unipileDsn`.

- [ ] **Step 3: Fix backfill-calendly**

Replace line 12:
```typescript
let calendlyApiKey: string | undefined;
```
With:
```typescript
// Resolved per-request inside handler — never stored at module level
```

Then in the handler, declare `calendlyApiKey` as a local variable where `resolveOrgCredentials` is called.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/auto-analyze-message/index.ts \
       supabase/functions/check-invitation-status/index.ts \
       supabase/functions/backfill-calendly/index.ts
git commit -m "fix(edge-functions): eliminate mutable global credentials

Module-level let variables for API keys were reassigned per-request.
In Deno Deploy, module scope persists across concurrent requests,
causing credential bleed between organizations. Now all credentials
are resolved into request-scoped local variables."
```

---

### Task 8: Fix AcceptMissionInvite missing .catch() (SE1)

**Files:**
- Modify: `src/pages/AcceptMissionInvite.tsx:16-23`

The `accept(token).then(...)` has no `.catch()`. If the accept call rejects, the promise rejection is unhandled and the user stays stuck on "loading" forever.

- [ ] **Step 1: Add .catch() to the accept call**

Replace lines 16-23:
```typescript
    accept(token).then((pId) => {
      if (pId) {
        setProjectId(pId);
        setStatus('success');
      } else {
        setStatus('error');
      }
    });
```
With:
```typescript
    accept(token).then((pId) => {
      if (pId) {
        setProjectId(pId);
        setStatus('success');
      } else {
        setStatus('error');
      }
    }).catch(() => {
      setStatus('error');
    });
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/pages/AcceptMissionInvite.tsx
git commit -m "fix(AcceptMissionInvite): add .catch() to prevent infinite loading

If accept() rejected, the promise was unhandled and the user stayed
stuck on the loading spinner forever with no error message."
```

---

### Final Verification

- [ ] **Run full type check**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Run production build**

```bash
npx vite build
```
Expected: Build succeeds
