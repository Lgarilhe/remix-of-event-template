/**
 * Enrich a candidate's contact info (email, phone) via Apollo People Match API.
 * Uses LinkedIn URL to find the person and returns personal emails + phone numbers.
 */

import { requireAuth, verifyOrgMembership } from "../_shared/require-auth.ts";
import { resolveApolloCredentials } from "../_shared/resolve-org-credentials.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const APOLLO_BASE = "https://api.apollo.io";

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = await requireAuth(req, corsHeaders);

    const body = await req.json();
    const { linkedin_url, first_name, last_name, organization_id } = body;

    if (!linkedin_url && (!first_name || !last_name)) {
      return new Response(
        JSON.stringify({ error: "linkedin_url or first_name+last_name required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create admin client early for org membership check
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!
    );

    // Verify org membership (skip for service_role calls)
    if (organization_id && auth.userId) {
      const isMember = await verifyOrgMembership(admin, auth.userId, organization_id);
      if (!isMember) {
        return new Response(
          JSON.stringify({ error: "Forbidden" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    let apolloApiKey: string | null = null;

    if (organization_id) {
      try {
        const creds = await resolveApolloCredentials(organization_id, admin);
        if (creds) apolloApiKey = creds.apiKey;
      } catch {
        // fallback to env
      }
    }

    if (!apolloApiKey) {
      apolloApiKey = Deno.env.get("APOLLO_API_KEY") || null;
    }

    if (!apolloApiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "APOLLO_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build Apollo People Match payload
    const matchPayload: Record<string, any> = {
      reveal_personal_emails: true,
      reveal_phone_number: true,
    };

    if (linkedin_url) {
      matchPayload.linkedin_url = linkedin_url;
    }
    if (first_name) matchPayload.first_name = first_name;
    if (last_name) matchPayload.last_name = last_name;
    if (body.company_name) matchPayload.organization_name = body.company_name;

    console.log("[enrich-contact] Matching:", JSON.stringify(matchPayload));

    const apolloResponse = await fetchWithTimeout(`${APOLLO_BASE}/v1/people/match`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apolloApiKey,
      },
      body: JSON.stringify(matchPayload),
    });

    if (!apolloResponse.ok) {
      const errText = await apolloResponse.text();
      console.error("[enrich-contact] Apollo error:", apolloResponse.status, errText);
      return new Response(
        JSON.stringify({ success: false, error: `Apollo API error: ${apolloResponse.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apolloData = await apolloResponse.json();
    const person = apolloData.person;

    if (!person) {
      return new Response(
        JSON.stringify({ success: true, found: false, emails: [], phones: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract personal emails (filter out professional ones)
    const personalEmails: string[] = [];
    const professionalEmails: string[] = [];

    if (person.email) {
      // The main email from Apollo
      professionalEmails.push(person.email);
    }

    // Personal emails from reveal
    if (person.personal_emails && Array.isArray(person.personal_emails)) {
      personalEmails.push(...person.personal_emails);
    }

    // Phone numbers
    const phones: Array<{ number: string; type: string }> = [];
    if (person.phone_numbers && Array.isArray(person.phone_numbers)) {
      for (const ph of person.phone_numbers) {
        const num = ph.sanitized_number || ph.raw_number || ph.number;
        if (num) {
          phones.push({
            number: num,
            type: ph.type || "unknown",
          });
        }
      }
    }

    // Also check direct_phone / mobile_phone fields
    if (person.phone && !phones.find((p) => p.number === person.phone)) {
      phones.push({ number: person.phone, type: "direct" });
    }

    return new Response(
      JSON.stringify({
        success: true,
        found: true,
        personal_emails: personalEmails,
        professional_emails: professionalEmails,
        phones,
        apollo_id: person.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[enrich-contact] Error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
