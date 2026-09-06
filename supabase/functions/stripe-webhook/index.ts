/**
 * Edge function: Stripe Webhook Handler
 *
 * Handles:
 * - checkout.session.completed → Credit pack purchase (topup) or new subscription
 * - invoice.paid → Subscription renewal: status + current_period_* only (plan
 *   credits are reset lazily by ai-credits get_balance once period_end is past)
 * - customer.subscription.updated → Plan change: plan_id, status, billing_cycle,
 *   current_period_* (plan credits recomputed by the SQL trigger
 *   sync_credit_balance_from_subscription on plan_id change)
 * - customer.subscription.deleted → Cancellation → plan free, status canceled
 *   (credits recomputed by the same trigger)
 * - invoice.payment_failed → Notification (logged for now)
 *
 * Plan credits are never written here: subscription_plans.limits.ai_credits is
 * the single source of truth (migration 20260906181044).
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

// ─── Horodatages Stripe (secondes Unix) → ISO ──────────────────────────────

function stripeTsToIso(ts: unknown): string | null {
  return typeof ts === "number" && Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : null;
}

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
  const serviceKey = (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
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

          // IDEMPOTENCE : on insère d'ABORD la ligne d'achat, dont
          // stripe_session_id est UNIQUE (migration 20260715120000). Un event
          // Stripe rejoué (retry/redelivery) provoque une violation d'unicité
          // (23505) → on saute le crédit au lieu de le doubler. La ligne d'achat
          // sert de verrou : rien n'est crédité avant qu'elle soit posée.
          const { error: purchaseError } = await adminClient.from("credit_purchases").insert({
            organization_id: orgId,
            user_id: userId || null,
            pack_id: metadata.pack_id,
            credits,
            amount_cents: session.amount_total,
            currency: session.currency || "eur",
            stripe_session_id: session.id,
            stripe_payment_intent_id: session.payment_intent,
          });
          if (purchaseError) {
            if (purchaseError.code === "23505") {
              console.log(`[stripe-webhook] session ${session.id} déjà traitée — crédit ignoré (idempotence)`);
              break;
            }
            // Autre erreur : on NE crédite PAS (fail-closed). Sans la ligne
            // d'achat, l'idempotence n'est plus garantie → 500 pour que Stripe
            // retente ; un vrai double-crédit est pire qu'un retry.
            console.error("[stripe-webhook] credit_purchases insert failed — crédit annulé:", purchaseError);
            return json({ error: "credit_purchase insert failed" }, 500);
          }

          // Créditer le solde (après le verrou d'idempotence).
          const { data: bal } = await adminClient
            .from("ai_credit_balances")
            .select("plan_credits, topup_credits")
            .eq("organization_id", orgId)
            .single();

          const currentTopup = bal?.topup_credits ?? 0;
          const currentTotal = (bal?.plan_credits ?? 0) + (bal?.topup_credits ?? 0);

          const { error: balanceError } = await adminClient
            .from("ai_credit_balances")
            .upsert({
              organization_id: orgId,
              topup_credits: currentTopup + credits,
              credits_total: currentTotal + credits,
              updated_at: new Date().toISOString(),
            }, { onConflict: "organization_id" });
          if (balanceError) {
            // Achat enregistré mais solde non crédité → à réconcilier (loggé en
            // error pour alerte). Ne pas 500 : un retry sauterait via l'idempotence.
            console.error(`[stripe-webhook] SOLDE NON CRÉDITÉ pour org ${orgId} (achat ${session.id} enregistré) — à réconcilier:`, balanceError);
          }

          // Journaliser la transaction de crédit.
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
          .select("organization_id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (!sub) {
          console.warn("[stripe-webhook] No subscription found for customer:", customerId);
          break;
        }

        // Les crédits du plan ne sont pas touchés ici : le reset mensuel est fait
        // paresseusement par ai-credits (get_balance) quand period_end est dépassé.
        // Période lue sur la ligne d'abonnement non proratisée (une facture de
        // cycle peut porter des lignes de prorata d'un changement de plan).
        // Sans ligne exploitable, la période est laissée à
        // customer.subscription.updated ; jamais recalculée depuis now().
        const lines: any[] = invoice.lines?.data ?? [];
        const line = lines.find((l) => l?.proration !== true && (l?.type === "subscription" || l?.subscription)) ?? null;
        const periodStart = line?.period?.start ? stripeTsToIso(line.period.start) : null;
        const periodEnd = line?.period?.end ? stripeTsToIso(line.period.end) : null;

        await adminClient
          .from("organization_subscriptions")
          .update({
            status: "active",
            ...(periodStart ? { current_period_start: periodStart } : {}),
            ...(periodEnd ? { current_period_end: periodEnd } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq("organization_id", sub.organization_id);

        console.log(`[stripe-webhook] Renewal recorded for org ${sub.organization_id} (period ${periodStart} → ${periodEnd})`);
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

        const item = subscription.items?.data?.[0];

        // Plan : metadata.plan_id de l'abonnement si présent (et connu en base),
        // sinon correspondance par identifiant de prix Stripe comme avant.
        const metaPlanId =
          typeof subscription.metadata?.plan_id === "string" ? subscription.metadata.plan_id.trim() : "";
        const priceId = item?.price?.id;
        let newPlanId: string | null = null;

        if (metaPlanId) {
          const { data: plan } = await adminClient
            .from("subscription_plans")
            .select("id")
            .eq("id", metaPlanId)
            .eq("is_active", true)
            .single();

          if (plan) newPlanId = plan.id;
        }

        if (!newPlanId && priceId) {
          // Look up plan by stripe price ID
          const { data: plan } = await adminClient
            .from("subscription_plans")
            .select("id")
            .or(`stripe_price_id_monthly.eq.${priceId},stripe_price_id_yearly.eq.${priceId}`)
            .single();

          if (plan) newPlanId = plan.id;
        }

        if (!newPlanId) newPlanId = sub.plan_id;

        // Cycle de facturation depuis le prix récurrent (month → monthly, year → yearly).
        const interval = item?.price?.recurring?.interval;
        const billingCycle = interval === "month" ? "monthly" : interval === "year" ? "yearly" : null;

        // Période courante : au niveau de l'abonnement, sinon sur l'item
        // (versions d'API Stripe récentes).
        const periodStart = stripeTsToIso(subscription.current_period_start ?? item?.current_period_start);
        const periodEnd = stripeTsToIso(subscription.current_period_end ?? item?.current_period_end);

        await adminClient
          .from("organization_subscriptions")
          .update({
            plan_id: newPlanId,
            status: subscription.cancel_at_period_end ? "canceling" : "active",
            cancel_at_period_end: subscription.cancel_at_period_end || false,
            stripe_subscription_id: subscription.id,
            ...(billingCycle ? { billing_cycle: billingCycle } : {}),
            ...(periodStart ? { current_period_start: periodStart } : {}),
            ...(periodEnd ? { current_period_end: periodEnd } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq("organization_id", sub.organization_id);

        // Les crédits du plan sont recalculés par le trigger SQL
        // sync_credit_balance_from_subscription quand plan_id change.
        if (newPlanId !== sub.plan_id) {
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

        // Downgrade to free : les crédits du plan (topups conservés) sont recalculés
        // par le trigger SQL sync_credit_balance_from_subscription.
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
