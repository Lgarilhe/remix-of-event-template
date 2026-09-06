/**
 * Edge function: Create Stripe Checkout Session
 *
 * Supports two modes:
 * 1. Credit pack purchase (one-time payment)
 * 2. Subscription (recurring, per seat) : the plan is resolved server-side
 *    from subscription_plans and the price is built inline (price_data) unless
 *    a Stripe price id is set on the plan. Plan and billing cycle travel in the
 *    subscription metadata (read back by stripe-webhook).
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

const BILLING_CYCLES = ["monthly", "yearly"] as const;
type BillingCycle = (typeof BILLING_CYCLES)[number];

/**
 * Une URL de retour fournie par le client n'est acceptée que si elle pointe
 * sur l'application (APP_URL suivi de "/", "?" ou "#", ou APP_URL exactement) ;
 * sinon on retombe sur l'URL par défaut.
 */
function pickReturnUrl(candidate: unknown, appUrl: string, fallback: string): string {
  if (typeof candidate !== "string" || !candidate.startsWith(appUrl)) return fallback;
  const rest = candidate.slice(appUrl.length);
  return rest === "" || /^[/?#]/.test(rest) ? candidate : fallback;
}

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
    const serviceKey = (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const { mode, pack_id, plan_id, billing_cycle, organization_id, success_url, cancel_url } = body as {
      mode: "credit_pack" | "subscription";
      pack_id?: string;
      plan_id?: string;
      billing_cycle?: string;
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

    // Billing = action sensible : réservée aux owner/admin de l'org
    // (un simple membre ne doit pas pouvoir souscrire un abonnement).
    if (!["owner", "admin"].includes(membership.role)) {
      return json({ error: "Seuls les administrateurs peuvent gérer la facturation" }, 403);
    }

    // Get or create Stripe customer
    let stripeCustomerId: string | null = null;

    const { data: sub } = await adminClient
      .from("organization_subscriptions")
      .select("stripe_customer_id, stripe_subscription_id, status")
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

    // Build base URLs. Les URLs venant du corps ne sont acceptées que si elles
    // pointent sur l'application (voir pickReturnUrl).
    const appUrl = Deno.env.get("APP_URL") || "https://konekt-app-navy.vercel.app";
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
          success_url: pickReturnUrl(success_url, appUrl, defaultSuccessUrl),
          cancel_url: pickReturnUrl(cancel_url, appUrl, defaultCancelUrl),
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

    // ── Mode: Subscription (par siège) ─────────────────────────
    if (mode === "subscription") {
      if (!plan_id || typeof plan_id !== "string" || plan_id === "free") {
        return json({ error: "plan_id required for subscription" }, 400);
      }
      if (!BILLING_CYCLES.includes(billing_cycle as BillingCycle)) {
        return json({ error: "billing_cycle must be 'monthly' or 'yearly'" }, 400);
      }
      const cycle = billing_cycle as BillingCycle;

      // Un abonnement vivant existe déjà : le changement de plan et de sièges
      // passe par le portail (create-portal-session), jamais par un second
      // Checkout qui créerait un deuxième abonnement chez Stripe.
      if (sub?.stripe_subscription_id && !["canceled", "unpaid"].includes(sub.status ?? "")) {
        return json({
          code: "subscription_exists",
          error: "Vous avez déjà un abonnement. Modifiez-le depuis « Gérer l'abonnement ».",
        }, 409);
      }

      // Plan résolu côté serveur : jamais de prix venant du client.
      const { data: plan } = await adminClient
        .from("subscription_plans")
        .select("id, name, currency, price_monthly, price_yearly, stripe_price_id_monthly, stripe_price_id_yearly")
        .eq("id", plan_id)
        .eq("is_active", true)
        .neq("id", "free")
        .maybeSingle();

      if (!plan) {
        return json({ error: "Invalid plan_id" }, 400);
      }

      const stripePriceId = cycle === "monthly" ? plan.stripe_price_id_monthly : plan.stripe_price_id_yearly;
      const unitAmount = cycle === "monthly" ? plan.price_monthly : plan.price_yearly;
      if (!stripePriceId && (!Number.isInteger(unitAmount) || unitAmount <= 0)) {
        console.error("[create-checkout] Plan without usable price", { plan_id, cycle, unitAmount });
        return json({ error: "Invalid plan_id" }, 400);
      }

      // Un siège = une ligne de organization_members (tous rôles) ; une
      // invitation en attente réserve un siège (même règle que send-team-invitation).
      const { count: memberCount } = await adminClient
        .from("organization_members")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organization_id);
      const { count: pendingCount } = await adminClient
        .from("organization_invitations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organization_id)
        .eq("status", "pending");
      const quantity = Math.max(1, (memberCount ?? 0) + (pendingCount ?? 0));

      const params = new URLSearchParams({
        customer: stripeCustomerId!,
        mode: "subscription",
        client_reference_id: organization_id,
        allow_promotion_codes: "true",
        "line_items[0][quantity]": String(quantity),
        "metadata[type]": "subscription",
        "metadata[organization_id]": organization_id,
        "metadata[plan_id]": plan.id,
        "metadata[billing_cycle]": cycle,
        "metadata[user_id]": user.id,
        "subscription_data[metadata][type]": "subscription",
        "subscription_data[metadata][organization_id]": organization_id,
        "subscription_data[metadata][plan_id]": plan.id,
        "subscription_data[metadata][billing_cycle]": cycle,
        success_url: pickReturnUrl(success_url, appUrl, `${appUrl}/settings?tab=billing&checkout=success`),
        cancel_url: pickReturnUrl(cancel_url, appUrl, `${appUrl}/settings?tab=billing&checkout=cancel`),
      });

      if (stripePriceId) {
        params.set("line_items[0][price]", stripePriceId);
      } else {
        params.set("line_items[0][price_data][currency]", plan.currency || "eur");
        params.set("line_items[0][price_data][unit_amount]", String(unitAmount));
        params.set("line_items[0][price_data][recurring][interval]", cycle === "monthly" ? "month" : "year");
        params.set("line_items[0][price_data][product_data][name]", `Konekt ${plan.name}`);
        params.set("line_items[0][price_data][product_data][description]", "Par siège");
      }

      const sessionRes = await fetchWithTimeout("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
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
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
