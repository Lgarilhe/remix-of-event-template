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
