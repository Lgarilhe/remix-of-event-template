/**
 * Edge function: Create Stripe Checkout Session
 *
 * Supports two modes:
 * 1. Credit pack purchase (one-time payment)
 * 2. Subscription upgrade (recurring)
 *
 * After successful payment, the stripe-webhook edge function handles
 * credit allocation and subscription updates.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

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

// Credit pack definitions (must match frontend CREDIT_PACKS)
const CREDIT_PACKS: Record<string, { credits: number; price_cents: number }> = {
  pack_400: { credits: 400, price_cents: 1200 },
  pack_1500: { credits: 1500, price_cents: 3900 },
  pack_5000: { credits: 5000, price_cents: 11900 },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    if (!STRIPE_SECRET_KEY) {
      return json({ error: "Stripe not configured" }, 500);
    }

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const { mode, pack_id, price_id, organization_id, success_url, cancel_url } = body as {
      mode: "credit_pack" | "subscription";
      pack_id?: string;
      price_id?: string;
      organization_id: string;
      success_url?: string;
      cancel_url?: string;
    };

    if (!organization_id) {
      return json({ error: "organization_id required" }, 400);
    }

    // Verify membership
    const { data: membership } = await adminClient
      .from("organization_members")
      .select("role")
      .eq("organization_id", organization_id)
      .eq("user_id", user.id)
      .single();

    if (!membership) {
      return json({ error: "Forbidden" }, 403);
    }

    // Get or create Stripe customer
    let stripeCustomerId: string | null = null;

    const { data: sub } = await adminClient
      .from("organization_subscriptions")
      .select("stripe_customer_id")
      .eq("organization_id", organization_id)
      .single();

    stripeCustomerId = sub?.stripe_customer_id || null;

    if (!stripeCustomerId) {
      // Get org info for customer creation
      const { data: org } = await adminClient
        .from("organizations")
        .select("name")
        .eq("id", organization_id)
        .single();

      // Create Stripe customer
      const customerRes = await fetchWithTimeout("https://api.stripe.com/v1/customers", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          email: user.email || "",
          name: org?.name || "",
          "metadata[organization_id]": organization_id,
          "metadata[user_id]": user.id,
        }),
      });

      if (!customerRes.ok) {
        const err = await customerRes.text();
        console.error("[create-checkout] Stripe customer creation failed:", err);
        return json({ error: "Failed to create Stripe customer" }, 500);
      }

      const customer = await customerRes.json();
      stripeCustomerId = customer.id;

      // Save customer ID
      const { error: upsertError } = await adminClient
        .from("organization_subscriptions")
        .upsert({
          organization_id,
          stripe_customer_id: stripeCustomerId,
          status: sub ? undefined : "free",
          plan_id: sub ? undefined : "free",
          billing_cycle: sub ? undefined : "monthly",
        }, { onConflict: "organization_id" });

      if (upsertError) {
        console.error("[create-checkout] Failed to save Stripe customer ID", { error: upsertError, organization_id, stripeCustomerId });
        return json({ error: "Failed to save payment configuration" }, 500);
      }
    }

    // Build base URLs
    const appUrl = Deno.env.get("APP_URL") || "https://app.konekt.io";
    const defaultSuccessUrl = `${appUrl}/settings?tab=credits&checkout=success`;
    const defaultCancelUrl = `${appUrl}/settings?tab=credits&checkout=cancel`;

    // ── Mode: Credit Pack Purchase ──────────────────────────────
    if (mode === "credit_pack") {
      if (!pack_id || !CREDIT_PACKS[pack_id]) {
        return json({ error: "Invalid pack_id" }, 400);
      }

      const pack = CREDIT_PACKS[pack_id];

      const sessionRes = await fetchWithTimeout("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          customer: stripeCustomerId!,
          mode: "payment",
          "line_items[0][price_data][currency]": "eur",
          "line_items[0][price_data][unit_amount]": String(pack.price_cents),
          "line_items[0][price_data][product_data][name]": `${pack.credits} crédits IA Konekt`,
          "line_items[0][price_data][product_data][description]": `Pack de ${pack.credits} crédits IA`,
          "line_items[0][quantity]": "1",
          "metadata[type]": "credit_pack",
          "metadata[pack_id]": pack_id,
          "metadata[credits]": String(pack.credits),
          "metadata[organization_id]": organization_id,
          "metadata[user_id]": user.id,
          success_url: success_url || defaultSuccessUrl,
          cancel_url: cancel_url || defaultCancelUrl,
        }),
      });

      if (!sessionRes.ok) {
        const err = await sessionRes.text();
        console.error("[create-checkout] Session creation failed:", err);
        return json({ error: "Failed to create checkout session" }, 500);
      }

      const session = await sessionRes.json();
      return json({ url: session.url, session_id: session.id });
    }

    // ── Mode: Subscription ──────────────────────────────────────
    if (mode === "subscription") {
      if (!price_id) {
        return json({ error: "price_id required for subscription" }, 400);
      }

      const sessionRes = await fetchWithTimeout("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          customer: stripeCustomerId!,
          mode: "subscription",
          "line_items[0][price]": price_id,
          "line_items[0][quantity]": "1",
          "metadata[type]": "subscription",
          "metadata[organization_id]": organization_id,
          "metadata[user_id]": user.id,
          success_url: success_url || `${appUrl}/settings?tab=billing&checkout=success`,
          cancel_url: cancel_url || `${appUrl}/settings?tab=billing&checkout=cancel`,
        }),
      });

      if (!sessionRes.ok) {
        const err = await sessionRes.text();
        console.error("[create-checkout] Subscription session failed:", err);
        return json({ error: "Failed to create checkout session" }, 500);
      }

      const session = await sessionRes.json();
      return json({ url: session.url, session_id: session.id });
    }

    return json({ error: "Invalid mode. Use 'credit_pack' or 'subscription'" }, 400);
  } catch (err) {
    console.error("[create-checkout-session] Error:", err);
    return json({ error: err.message }, 500);
  }
});
