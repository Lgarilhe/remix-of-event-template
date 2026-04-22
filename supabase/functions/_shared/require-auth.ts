/**
 * Shared authentication helper for edge functions.
 * Validates JWT tokens from the Authorization header.
 * Allows service_role key passthrough for internal/cron calls.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;

export interface AuthResult {
  /** Authenticated user ID (null for service_role calls) */
  userId: string | null;
  /** How the caller was authenticated */
  method: "jwt" | "service_role";
}

/**
 * Validate the request's Authorization header.
 * Accepts:
 *   1. service_role key → returns { userId: null, method: 'service_role' }
 *   2. Valid user JWT → returns { userId: '...', method: 'jwt' }
 * Throws a Response (401) if neither is valid.
 */
export async function requireAuth(
  req: Request,
  corsHeaders: Record<string, string>
): Promise<AuthResult> {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (!token) {
    throw new Response(
      JSON.stringify({ error: "Missing authorization header" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 1. Service role passthrough
  if (token === SUPABASE_SERVICE_ROLE_KEY) {
    return { userId: null, method: "service_role" };
  }

  // 2. Validate user JWT — pass token explicitly so Supabase validates it
  // against the auth server (works with ES256 / RS256 / HS256 alike).
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: { user }, error } = await (authClient as any).auth.getUser(token);

  if (error || !user) {
    console.error("[requireAuth] getUser failed:", { error: error?.message, hasUser: !!user });
    throw new Response(
      JSON.stringify({ error: "Unauthorized", detail: error?.message }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return { userId: user.id, method: "jwt" };
}

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

/**
 * One-stop helper for edge functions that act on a specific organization.
 *
 * Usage:
 *   const { userId, organizationId, adminClient } = await requireOrgAccess(req, body, corsHeaders);
 *
 * Resolution order:
 *   1. If body.organization_id is provided, verify the user is a member of that org.
 *      → prevents IDOR (user A trying to act on org B by sending B's id in body)
 *   2. Else, fall back to profiles.active_organization_id from the user's profile.
 *   3. If neither resolves, throws a 400 Response.
 *
 * Throws a Response (401/403/400) on any failure — call sites should `try/catch` and
 * return the thrown Response directly.
 */
export async function requireOrgAccess(
  req: Request,
  body: Record<string, unknown> | null,
  corsHeaders: Record<string, string>,
): Promise<{
  userId: string;
  organizationId: string;
  adminClient: ReturnType<typeof createClient>;
}> {
  const auth = await requireAuth(req, corsHeaders);
  if (!auth.userId) {
    // service_role tokens are not allowed for org-scoped endpoints (would bypass RLS isolation)
    throw new Response(
      JSON.stringify({ error: "User authentication required (service_role not allowed)" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const userId = auth.userId;

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Try body first, then profile fallback
  let organizationId: string | null = null;
  const bodyOrgId = body && typeof body.organization_id === "string" ? body.organization_id : null;

  if (bodyOrgId) {
    const isMember = await verifyOrgMembership(adminClient, userId, bodyOrgId);
    if (!isMember) {
      throw new Response(
        JSON.stringify({ error: "Forbidden — you are not a member of this organization" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    organizationId = bodyOrgId;
  } else {
    // Fallback: resolve from profile
    const { data: profile } = await (adminClient as any)
      .from("profiles")
      .select("active_organization_id")
      .eq("user_id", userId)
      .maybeSingle();
    organizationId = profile?.active_organization_id ?? null;
  }

  if (!organizationId) {
    throw new Response(
      JSON.stringify({ error: "No active organization for this user" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return { userId, organizationId, adminClient };
}
