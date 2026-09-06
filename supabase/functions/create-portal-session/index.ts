/**
 * Edge function: Create Stripe Billing Portal Session
 *
 * Opens the customer portal (payment method, invoices, cancellation) for the
 * organization's Stripe customer. Body: { organization_id }.
 * Reserved to owner/admin of the organization. Returns { url }.
 * 404 { error: "no_customer" } when the organization never reached checkout.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth, verifyOrgMembership } from "../_shared/require-auth.ts";

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    if (!STRIPE_SECRET_KEY) {
      return json({ error: "billing_not_configured" }, 500);
    }

    // Auth : utilisateur connecté obligatoire (pas d'appel service-role).
    let auth;
    try {
      auth = await requireAuth(req, corsHeaders);
    } catch (r) {
      return r as Response;
    }
    if (!auth.userId) {
      return json({ error: "User authentication required" }, 403);
    }
    const userId = auth.userId;

    const body = await req.json().catch(() => ({}));
    const organization_id = typeof body?.organization_id === "string" ? body.organization_id : "";
    if (!organization_id) {
      return json({ error: "organization_id required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    const isMember = await verifyOrgMembership(adminClient, userId, organization_id);
    if (!isMember) {
      return json({ error: "Forbidden" }, 403);
    }

    // Facturation = action sensible : réservée aux owner/admin de l'org.
    const { data: membership } = await adminClient
      .from("organization_members")
      .select("role")
      .eq("organization_id", organization_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return json({ error: "Seuls les administrateurs peuvent gérer la facturation" }, 403);
    }

    const { data: sub } = await adminClient
      .from("organization_subscriptions")
      .select("stripe_customer_id")
      .eq("organization_id", organization_id)
      .maybeSingle();

    const stripeCustomerId = sub?.stripe_customer_id || null;
    if (!stripeCustomerId) {
      return json({ error: "no_customer" }, 404);
    }

    const appUrl = Deno.env.get("APP_URL") || "https://konekt-app-navy.vercel.app";

    const portalRes = await fetchWithTimeout("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        customer: stripeCustomerId,
        return_url: `${appUrl}/settings?tab=billing`,
      }),
    });

    if (!portalRes.ok) {
      const err = await portalRes.text();
      console.error("[create-portal-session] Portal session creation failed:", err);
      return json({ error: "Failed to create portal session" }, 500);
    }

    const portal = await portalRes.json();
    return json({ url: portal.url });
  } catch (err) {
    console.error("[create-portal-session] Error:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
