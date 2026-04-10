# Skill: Create a Supabase Edge Function

When the user asks to create or scaffold a new edge function, follow these conventions extracted from the Skalr codebase.

## Skeleton

```typescript
// supabase/functions/{function-name}/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
type SupabaseClient = ReturnType<typeof createClient>;
import { requireAuth } from "../_shared/require-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Auth
    let auth;
    try {
      auth = await requireAuth(req, corsHeaders);
    } catch (authResponse) {
      return authResponse as Response;
    }
    const userId = auth.userId;

    // 2. Parse body
    const body = await req.json();
    const { organization_id, ...params } = body;

    // 3. Validate required fields
    if (!organization_id) {
      return json({ error: "organization_id is required" }, 400);
    }

    // 4. Service client (bypasses RLS)
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 5. Business logic here...

    return json({ success: true });
  } catch (err) {
    console.error("[function-name]", err);
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
```

## Mandatory patterns

1. **Auth**: Always use `requireAuth(req, corsHeaders)` from `../_shared/require-auth.ts`. Wrap in try/catch because it throws a Response on failure.
2. **CORS**: Always handle `OPTIONS` preflight first. Use the full `corsHeaders` object (includes all Supabase client headers).
3. **Multi-tenant**: Always accept `organization_id` in the request body. Use it to scope all DB queries and resolve per-org credentials.
4. **Credential resolution**: For external APIs (Unipile, Apollo, Anthropic, etc.), use `resolveXxxCredentials(organization_id, admin)` from `../_shared/resolve-org-credentials.ts` — falls back to env vars automatically.
5. **fetchWithTimeout**: Use `fetchWithTimeout(url, options, 15000)` for all external HTTP calls (default 15s). Never use bare `fetch()` for external APIs.
6. **Service client**: Use `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` for DB writes — this bypasses RLS. Name it `admin` or `svc`.
7. **Error responses**: Always return JSON with `{ error: "message" }` and appropriate HTTP status. Use the `json()` helper.
8. **Console logging**: Prefix all logs with `[function-name]` for grep-ability in Supabase logs.
9. **Timeout budget**: Edge functions have 60s max on Supabase. Plan batch operations to fit within this.

## When the function calls an external LLM (Anthropic)

```typescript
import { resolveAnthropicCredentials } from "../_shared/resolve-org-credentials.ts";

// Inside handler:
const anthropicCreds = await resolveAnthropicCredentials(organization_id, admin);
const ANTHROPIC_API_KEY = anthropicCreds?.apiKey || Deno.env.get("ANTHROPIC_API_KEY");
if (!ANTHROPIC_API_KEY) {
  return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);
}

const llmResponse = await fetchWithTimeout(
  "https://api.anthropic.com/v1/messages",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  },
  30000 // 30s for LLM calls
);
```

## When the function writes to the database

Always check for errors on Supabase writes:
```typescript
const { data, error } = await admin
  .from("table_name")
  .insert({ organization_id, created_by: userId, ...fields })
  .select()
  .single();

if (error) {
  console.error("[function-name] DB insert failed:", error);
  return json({ error: "Failed to save" }, 500);
}
```

## Rate limiting (optional, for user-facing AI calls)

```typescript
const { data: allowed } = await admin.rpc('check_rate_limit', {
  p_user_id: userId,
  p_action: 'my_action_name',
  p_max_requests: 20,
  p_window_seconds: 60,
});
if (allowed === false) {
  return json({ error: "Rate limit exceeded" }, 429);
}
```

## Deployment reminder

Edge functions are NOT auto-deployed by Lovable. After creating/modifying:
```bash
supabase functions deploy {function-name}
```
