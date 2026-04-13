/**
 * Edge function: Stripe Webhook Handler
 *
 * Handles:
 * - checkout.session.completed → Credit pack purchase or new subscription
 * - invoice.paid → Subscription renewal (reset plan credits)
 * - customer.subscription.updated → Plan change
 * - customer.subscription.deleted → Cancellation → downgrade to Free
 * - invoice.payment_failed → Notification (logged for now)
 *
 * Security: Verifies Stripe webhook signature.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, stripe-signature",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── Stripe signature verification (HMAC-SHA256) ───────────────────────────

async function verifyStripeSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    const parts = signature.split(",").reduce((acc, part) => {
      const [key, value] = part.split("=");
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);

    const timestamp = parts["t"];
    const sig = parts["v1"];
    if (!timestamp || !sig) return false;

    // Check timestamp freshness (5 min tolerance)
    const age = Math.abs(Date.now() / 1000 - parseInt(timestamp));
    if (age > 300) return false;

    const signedPayload = `${timestamp}.${payload}`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const expectedSig = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(signedPayload)
    );
    const expectedHex = Array.from(new Uint8Array(expectedSig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return expectedHex === sig;
  } catch {
    return false;
  }
}

// ─── Plan credit mapping ────────────────────────────────────────────────────

const PLAN_CREDITS: Record<string, number> = {
  free: 50,
  pro: 3500,
  business: 9000,
  enterprise: 999999,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured");
    return json({ error: "Webhook not configured" }, 500);
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return json({ error: "Missing stripe-signature" }, 400);
  }

  const payload = await req.text();

  // Verify signature
  const isValid = await verifyStripeSignature(payload, signature, STRIPE_WEBHOOK_SECRET);
  if (!isValid) {
    console.error("[stripe-webhook] Invalid signature");
    return json({ error: "Invalid signature" }, 401);
  }

  const event = JSON.parse(payload);
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceKey);

  console.log(`[stripe-webhook] Processing event: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      // ── Checkout completed (credit pack or new subscription) ────
      case "checkout.session.completed": {
        const session = event.data.object;
        const metadata = session.metadata || {};
        const orgId = metadata.organization_id;
        const userId = metadata.user_id;

        if (!orgId) {
          console.warn("[stripe-webhook] No organization_id in session metadata");
          break;
        }

        // Credit pack purchase
        if (metadata.type === "credit_pack") {
          const credits = parseInt(metadata.credits || "0");
          if (credits <= 0) {
            console.error("[stripe-webhook] Invalid credits in metadata:", metadata.credits);
            break;
          }

          // Add topup credits
          const { data: bal } = await adminClient
            .from("ai_credit_balances")
            .select("topup_credits, credits_total")
            .eq("organization_id", orgId)
            .single();

          const currentTopup = bal?.topup_credits ?? 0;
          const currentTotal = bal?.credits_total ?? 0;

          await adminClient
            .from("ai_credit_balances")
            .upsert({
              organization_id: orgId,
              topup_credits: currentTopup + credits,
              credits_total: currentTotal + credits,
              updated_at: new Date().toISOString(),
            }, { onConflict: "organization_id" });

          // Log the purchase
          await adminClient.from("ai_credit_transactions").insert({
            organization_id: orgId,
            user_id: userId || null,
            action: "topup_purchase",
            amount: credits,
            credits_used: 0,
            tokens_input: 0,
            tokens_output: 0,
            model_id: "system",
            cost_usd: 0,
            source: "topup",
            balance_after: currentTotal + credits,
            description: `Achat pack ${metadata.pack_id}: +${credits} crédits`,
            metadata: {
              pack_id: metadata.pack_id,
              stripe_session_id: session.id,
              amount_total: session.amount_total,
            },
          });

          // Log credit purchase
          await adminClient.from("credit_purchases").insert({
            organization_id: orgId,
            user_id: userId || null,
            pack_id: metadata.pack_id,
            credits,
            amount_cents: session.amount_total,
            currency: session.currency || "eur",
            stripe_session_id: session.id,
            stripe_payment_intent_id: session.payment_intent,
          }).catch((e: unknown) => console.warn("[stripe-webhook] credit_purchases insert failed (table may not exist):", e));

          console.log(`[stripe-webhook] Added ${credits} topup credits for org ${orgId}`);
        }

        // New subscription
        if (metadata.type === "subscription" && session.subscription) {
          await adminClient
            .from("organization_subscriptions")
            .upsert({
              organization_id: orgId,
              stripe_subscription_id: session.subscription,
              stripe_customer_id: session.customer,
              status: "active",
              updated_at: new Date().toISOString(),
            }, { onConflict: "organization_id" });

          console.log(`[stripe-webhook] Subscription created for org ${orgId}`);
        }
        break;
      }

      // ── Invoice paid (subscription renewal) ────────────────────
      case "invoice.paid": {
        const invoice = event.data.object;
        if (invoice.billing_reason !== "subscription_cycle") break;

        const customerId = invoice.customer;

        // Find org by stripe_customer_id
        const { data: sub } = await adminClient
          .from("organization_subscriptions")
          .select("organization_id, plan_id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (!sub) {
          console.warn("[stripe-webhook] No subscription found for customer:", customerId);
          break;
        }

        // Reset plan credits
        const planCredits = PLAN_CREDITS[sub.plan_id] || PLAN_CREDITS.free;
        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        const { data: bal } = await adminClient
          .from("ai_credit_balances")
          .select("topup_credits")
          .eq("organization_id", sub.organization_id)
          .single();

        const topup = bal?.topup_credits ?? 0;

        await adminClient
          .from("ai_credit_balances")
          .upsert({
            organization_id: sub.organization_id,
            plan_credits: planCredits,
            topup_credits: topup,
            credits_total: planCredits + topup,
            period_start: now.toISOString(),
            period_end: periodEnd.toISOString(),
            updated_at: now.toISOString(),
          }, { onConflict: "organization_id" });

        // Update subscription period
        await adminClient
          .from("organization_subscriptions")
          .update({
            current_period_start: now.toISOString(),
            current_period_end: periodEnd.toISOString(),
            status: "active",
            updated_at: now.toISOString(),
          })
          .eq("organization_id", sub.organization_id);

        console.log(`[stripe-webhook] Reset plan credits for org ${sub.organization_id}: ${planCredits}`);
        break;
      }

      // ── Subscription updated (plan change) ─────────────────────
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        const { data: sub } = await adminClient
          .from("organization_subscriptions")
          .select("organization_id, plan_id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (!sub) break;

        // Determine new plan from Stripe price
        const priceId = subscription.items?.data?.[0]?.price?.id;
        let newPlanId = sub.plan_id;

        if (priceId) {
          // Look up plan by stripe price ID
          const { data: plan } = await adminClient
            .from("subscription_plans")
            .select("id")
            .or(`stripe_price_id_monthly.eq.${priceId},stripe_price_id_yearly.eq.${priceId}`)
            .single();

          if (plan) newPlanId = plan.id;
        }

        await adminClient
          .from("organization_subscriptions")
          .update({
            plan_id: newPlanId,
            status: subscription.cancel_at_period_end ? "canceling" : "active",
            cancel_at_period_end: subscription.cancel_at_period_end || false,
            stripe_subscription_id: subscription.id,
            updated_at: new Date().toISOString(),
          })
          .eq("organization_id", sub.organization_id);

        // If upgrade, immediately adjust plan credits
        if (newPlanId !== sub.plan_id) {
          const newCredits = PLAN_CREDITS[newPlanId] || PLAN_CREDITS.free;
          const { data: bal } = await adminClient
            .from("ai_credit_balances")
            .select("plan_credits, topup_credits")
            .eq("organization_id", sub.organization_id)
            .single();

          const topup = bal?.topup_credits ?? 0;
          // Only upgrade credits (don't reduce on downgrade mid-cycle)
          const finalPlanCredits = Math.max(bal?.plan_credits ?? 0, newCredits);

          await adminClient
            .from("ai_credit_balances")
            .update({
              plan_credits: finalPlanCredits,
              credits_total: finalPlanCredits + topup,
              updated_at: new Date().toISOString(),
            })
            .eq("organization_id", sub.organization_id);

          console.log(`[stripe-webhook] Plan changed to ${newPlanId} for org ${sub.organization_id}`);
        }
        break;
      }

      // ── Subscription deleted (cancellation) ────────────────────
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        const { data: sub } = await adminClient
          .from("organization_subscriptions")
          .select("organization_id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (!sub) break;

        // Downgrade to free
        await adminClient
          .from("organization_subscriptions")
          .update({
            plan_id: "free",
            status: "canceled",
            stripe_subscription_id: null,
            cancel_at_period_end: false,
            updated_at: new Date().toISOString(),
          })
          .eq("organization_id", sub.organization_id);

        // Set plan credits to free tier (keep topups)
        const freeCredits = PLAN_CREDITS.free;
        const { data: bal } = await adminClient
          .from("ai_credit_balances")
          .select("topup_credits")
          .eq("organization_id", sub.organization_id)
          .single();

        const topup = bal?.topup_credits ?? 0;
        await adminClient
          .from("ai_credit_balances")
          .update({
            plan_credits: freeCredits,
            credits_total: freeCredits + topup,
            updated_at: new Date().toISOString(),
          })
          .eq("organization_id", sub.organization_id);

        console.log(`[stripe-webhook] Subscription canceled for org ${sub.organization_id}, downgraded to free`);
        break;
      }

      // ── Payment failed ─────────────────────────────────────────
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        console.warn(`[stripe-webhook] Payment failed for customer ${invoice.customer}, invoice ${invoice.id}`);
        // TODO: Send email notification to client
        break;
      }

      default:
        console.log(`[stripe-webhook] Unhandled event type: ${event.type}`);
    }

    return json({ received: true });
  } catch (err) {
    console.error(`[stripe-webhook] Error processing ${event.type}:`, err);
    return json({ error: err.message }, 500);
  }
});
