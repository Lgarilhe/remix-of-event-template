/**
 * Edge function: Stripe Webhook Handler
 *
 * Handles:
 * - checkout.session.completed → Credit pack purchase (topup) or new subscription
 *   (the subscription is fetched from Stripe so that a replayed event always
 *   writes the current state: plan, cycle, seats, period)
 * - invoice.paid → Subscription renewal: current_period_* and back to 'active'
 *   when the organization was past_due (plan credits are reset lazily by
 *   ai-credits get_balance once period_end is past)
 * - customer.subscription.updated → Plan/seat change: plan_id, status, seats,
 *   billing_cycle, current_period_* (plan credits recomputed by the SQL trigger
 *   sync_credit_balance_from_subscription on plan_id change)
 * - customer.subscription.deleted → Cancellation → plan free, status canceled,
 *   seats 1 (credits recomputed by the same trigger)
 * - invoice.payment_failed → status past_due
 *
 * Plan credits are never written here: subscription_plans.limits.ai_credits is
 * the single source of truth (migration 20260906181044). Every handler is
 * idempotent (same event replayed = same row), and events for a subscription
 * that is no longer the organization's are ignored.
 *
 * Security: Verifies Stripe webhook signature.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

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
    const parts = signature.split(",").map((part) => part.trim());
    const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
    // Plusieurs signatures v1 pendant une rotation de secret : une seule doit correspondre.
    const sigs = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
    if (!timestamp || sigs.length === 0) return false;

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

    return sigs.some((sig) => constantTimeEqual(expectedHex, sig));
  } catch {
    return false;
  }
}

/** Comparaison à temps constant de deux chaînes hexadécimales. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Relit un abonnement chez Stripe (état courant, quel que soit l'ordre des événements). */
async function fetchStripeSubscription(subscriptionId: string): Promise<any | null> {
  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  if (!STRIPE_SECRET_KEY) {
    console.error("[stripe-webhook] STRIPE_SECRET_KEY not configured");
    return null;
  }
  const res = await fetchWithTimeout(
    `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } },
  );
  if (!res.ok) {
    const err = await res.text();
    console.error(`[stripe-webhook] Subscription fetch failed (${res.status}) for ${subscriptionId}:`, err);
    return null;
  }
  return await res.json();
}

// ─── Horodatages Stripe (secondes Unix) → ISO ──────────────────────────────

function stripeTsToIso(ts: unknown): string | null {
  return typeof ts === "number" && Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : null;
}

// ─── Lecture d'un objet Subscription Stripe ────────────────────────────────

/** Cycle de facturation depuis le prix récurrent (month → monthly, year → yearly). */
function billingCycleOf(subscription: any): "monthly" | "yearly" | null {
  const interval = subscription?.items?.data?.[0]?.price?.recurring?.interval;
  return interval === "month" ? "monthly" : interval === "year" ? "yearly" : null;
}

/** Sièges = quantité de la première ligne de l'abonnement (minimum 1). */
function seatsOf(subscription: any): number {
  const qty = subscription?.items?.data?.[0]?.quantity;
  return typeof qty === "number" && Number.isFinite(qty) && qty >= 1 ? Math.floor(qty) : 1;
}

/**
 * Période courante : au niveau de l'abonnement, sinon sur l'item (versions
 * d'API Stripe récentes).
 */
function periodOf(subscription: any): { start: string | null; end: string | null } {
  const item = subscription?.items?.data?.[0];
  return {
    start: stripeTsToIso(subscription?.current_period_start ?? item?.current_period_start),
    end: stripeTsToIso(subscription?.current_period_end ?? item?.current_period_end),
  };
}

/**
 * Statut interne depuis le statut Stripe. cancel_at_period_end prime
 * (l'abonnement reste actif jusqu'à la fin de période). Les statuts
 * transitoires non listés (incomplete, paused) laissent le statut en base.
 */
function statusOf(subscription: any): string | null {
  if (subscription?.cancel_at_period_end) return "canceling";
  switch (subscription?.status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "unpaid":
      return "unpaid";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return null;
  }
}

/** Identifiant d'abonnement d'une facture (ancien et nouveau format d'API). */
function invoiceSubscriptionId(invoice: any): string | null {
  const direct = invoice?.subscription;
  if (typeof direct === "string") return direct;
  if (direct && typeof direct.id === "string") return direct.id;
  const nested = invoice?.parent?.subscription_details?.subscription;
  if (typeof nested === "string") return nested;
  if (nested && typeof nested.id === "string") return nested.id;
  return null;
}

/**
 * Plan interne : metadata.plan_id de l'abonnement (puis de la session) s'il
 * est connu et actif en base, sinon correspondance par identifiant de prix
 * Stripe. null si rien ne correspond.
 */
async function resolvePlanId(
  adminClient: ReturnType<typeof createClient>,
  subscription: any,
  fallbackMetadata?: Record<string, unknown> | null,
): Promise<string | null> {
  const candidates = [subscription?.metadata?.plan_id, fallbackMetadata?.plan_id]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);

  for (const candidate of candidates) {
    const { data: plan } = await adminClient
      .from("subscription_plans")
      .select("id")
      .eq("id", candidate)
      .eq("is_active", true)
      .maybeSingle();
    if (plan) return plan.id;
  }

  const priceId = subscription?.items?.data?.[0]?.price?.id;
  if (typeof priceId === "string" && priceId) {
    const { data: plan } = await adminClient
      .from("subscription_plans")
      .select("id")
      .or(`stripe_price_id_monthly.eq.${priceId},stripe_price_id_yearly.eq.${priceId}`)
      .maybeSingle();
    if (plan) return plan.id;
  }

  return null;
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
        const orgId = metadata.organization_id || session.client_reference_id;
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

        // New subscription : l'abonnement est relu chez Stripe pour écrire son
        // état courant (plan, cycle, sièges, période). Un rejeu de l'événement
        // réécrit donc les mêmes valeurs.
        if (session.mode === "subscription" && session.subscription) {
          const subscriptionId =
            typeof session.subscription === "string" ? session.subscription : session.subscription?.id;

          const subscription = await fetchStripeSubscription(subscriptionId);
          if (!subscription) {
            return json({ error: "subscription fetch failed" }, 500);
          }

          // Rejeu tardif d'une session dont l'abonnement est déjà terminé, ou
          // organisation passée entre-temps sur un autre abonnement vivant.
          if (["canceled", "incomplete_expired"].includes(subscription.status)) {
            console.log(`[stripe-webhook] checkout replay for ended subscription ${subscriptionId} ignored`);
            break;
          }
          const { data: current } = await adminClient
            .from("organization_subscriptions")
            .select("stripe_subscription_id, status")
            .eq("organization_id", orgId)
            .maybeSingle();
          if (
            current?.stripe_subscription_id &&
            current.stripe_subscription_id !== subscriptionId &&
            !["canceled", "unpaid"].includes(current.status ?? "")
          ) {
            console.log(`[stripe-webhook] checkout for ${subscriptionId} ignored (org ${orgId} is on ${current.stripe_subscription_id})`);
            break;
          }

          const planId = await resolvePlanId(adminClient, subscription, metadata);
          if (!planId) {
            console.error(`[stripe-webhook] No plan resolved for subscription ${subscriptionId} (org ${orgId})`);
          }

          const billingCycle = billingCycleOf(subscription);
          const period = periodOf(subscription);
          const customerId =
            typeof session.customer === "string" ? session.customer : (session.customer?.id ?? subscription.customer);

          const { error: upsertError } = await adminClient
            .from("organization_subscriptions")
            .upsert({
              organization_id: orgId,
              ...(planId ? { plan_id: planId } : {}),
              status: statusOf(subscription) ?? "active",
              ...(billingCycle ? { billing_cycle: billingCycle } : {}),
              seats: seatsOf(subscription),
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              current_period_start: period.start,
              current_period_end: period.end,
              trial_ends_at: null,
              cancel_at_period_end: false,
              updated_at: new Date().toISOString(),
            }, { onConflict: "organization_id" });

          if (upsertError) {
            console.error(`[stripe-webhook] organization_subscriptions upsert failed for org ${orgId}:`, upsertError);
            return json({ error: "subscription upsert failed" }, 500);
          }

          console.log(`[stripe-webhook] Subscription ${subscriptionId} recorded for org ${orgId} (plan ${planId}, ${billingCycle}, ${seatsOf(subscription)} seats)`);
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
          .select("organization_id, status, stripe_subscription_id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (!sub) {
          console.warn("[stripe-webhook] No subscription found for customer:", customerId);
          break;
        }

        // Facture d'un abonnement qui n'est plus celui de l'organisation : ignorée.
        const invoiceSubId = invoiceSubscriptionId(invoice);
        if (invoiceSubId && sub.stripe_subscription_id && invoiceSubId !== sub.stripe_subscription_id) {
          console.log(`[stripe-webhook] invoice.paid for ${invoiceSubId} ignored (org ${sub.organization_id} is on ${sub.stripe_subscription_id})`);
          break;
        }

        // Les crédits du plan ne sont pas touchés ici : le reset mensuel est fait
        // paresseusement par ai-credits (get_balance) quand period_end est dépassé.
        // Période lue sur la ligne d'abonnement non proratisée (une facture de
        // cycle peut porter des lignes de prorata d'un changement de plan).
        // Sans ligne exploitable, la période est laissée à
        // customer.subscription.updated ; jamais recalculée depuis now().
        const lines: any[] = invoice.lines?.data ?? [];
        const line = lines.find((l) => {
          // Ancien format : type/subscription/proration au premier niveau ;
          // nouveau format (2025-03-31) : parent.subscription_item_details.
          const details = l?.parent?.subscription_item_details;
          const isSubLine = l?.type === "subscription" || !!l?.subscription || !!details;
          const isProration = l?.proration === true || details?.proration === true;
          return isSubLine && !isProration;
        }) ?? null;
        const periodStart = line?.period?.start ? stripeTsToIso(line.period.start) : null;
        const periodEnd = line?.period?.end ? stripeTsToIso(line.period.end) : null;

        // Le statut ne repasse à active que depuis past_due (un paiement
        // récupéré) ; canceling et les autres statuts sont conservés.
        const { error: renewalError } = await adminClient
          .from("organization_subscriptions")
          .update({
            ...(sub.status === "past_due" ? { status: "active" } : {}),
            ...(periodStart ? { current_period_start: periodStart } : {}),
            ...(periodEnd ? { current_period_end: periodEnd } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq("organization_id", sub.organization_id);
        if (renewalError) {
          console.error(`[stripe-webhook] invoice.paid update failed for org ${sub.organization_id}:`, renewalError);
          return json({ error: "subscription update failed" }, 500);
        }

        console.log(`[stripe-webhook] Renewal recorded for org ${sub.organization_id} (period ${periodStart} → ${periodEnd})`);
        break;
      }

      // ── Subscription updated (plan / seats / status change) ────
      case "customer.subscription.updated": {
        // Stripe ne garantit pas l'ordre de livraison : l'état appliqué est
        // relu chez Stripe, pas celui porté par l'événement.
        const eventSubscription = event.data.object;
        const customerId = eventSubscription.customer;
        const subscription = await fetchStripeSubscription(eventSubscription.id);
        if (!subscription) {
          return json({ error: "subscription fetch failed" }, 500);
        }

        const { data: sub } = await adminClient
          .from("organization_subscriptions")
          .select("organization_id, plan_id, stripe_subscription_id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (!sub) break;

        const status = statusOf(subscription);

        // Événement d'un abonnement qui n'est pas (ou plus) celui de
        // l'organisation : ignoré. Sans abonnement rattaché, seul un abonnement
        // encore vivant est pris (un ancien abonnement terminé rejoué ne doit
        // pas réécrire le plan).
        if (sub.stripe_subscription_id && sub.stripe_subscription_id !== subscription.id) {
          console.log(`[stripe-webhook] subscription.updated for ${subscription.id} ignored (org ${sub.organization_id} is on ${sub.stripe_subscription_id})`);
          break;
        }
        if (!sub.stripe_subscription_id && status === "canceled") {
          console.log(`[stripe-webhook] subscription.updated for ended ${subscription.id} ignored (org ${sub.organization_id} has no subscription)`);
          break;
        }

        const newPlanId = (await resolvePlanId(adminClient, subscription)) ?? sub.plan_id;
        const billingCycle = billingCycleOf(subscription);
        const period = periodOf(subscription);

        const { error: updateError } = await adminClient
          .from("organization_subscriptions")
          .update({
            plan_id: newPlanId,
            ...(status ? { status } : {}),
            cancel_at_period_end: subscription.cancel_at_period_end || false,
            seats: seatsOf(subscription),
            stripe_subscription_id: subscription.id,
            ...(billingCycle ? { billing_cycle: billingCycle } : {}),
            ...(period.start ? { current_period_start: period.start } : {}),
            ...(period.end ? { current_period_end: period.end } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq("organization_id", sub.organization_id);
        if (updateError) {
          console.error(`[stripe-webhook] subscription.updated update failed for org ${sub.organization_id}:`, updateError);
          return json({ error: "subscription update failed" }, 500);
        }

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
          .select("organization_id, stripe_subscription_id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (!sub) break;

        // Un ancien abonnement rejoué après une nouvelle souscription ne doit
        // pas rétrograder l'organisation.
        if (sub.stripe_subscription_id && sub.stripe_subscription_id !== subscription.id) {
          console.log(`[stripe-webhook] subscription.deleted for ${subscription.id} ignored (org ${sub.organization_id} is on ${sub.stripe_subscription_id})`);
          break;
        }

        // Downgrade to free : les crédits du plan (topups conservés) sont recalculés
        // par le trigger SQL sync_credit_balance_from_subscription.
        const { error: deleteError } = await adminClient
          .from("organization_subscriptions")
          .update({
            plan_id: "free",
            status: "canceled",
            seats: 1,
            stripe_subscription_id: null,
            cancel_at_period_end: false,
            updated_at: new Date().toISOString(),
          })
          .eq("organization_id", sub.organization_id);
        if (deleteError) {
          console.error(`[stripe-webhook] subscription.deleted update failed for org ${sub.organization_id}:`, deleteError);
          return json({ error: "subscription update failed" }, 500);
        }

        console.log(`[stripe-webhook] Subscription canceled for org ${sub.organization_id}, downgraded to free`);
        break;
      }

      // ── Payment failed ─────────────────────────────────────────
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        const invoiceSubId = invoiceSubscriptionId(invoice);
        console.warn(`[stripe-webhook] Payment failed for customer ${customerId}, invoice ${invoice.id}`);

        // Seules les factures de l'abonnement courant de l'organisation
        // passent le statut en past_due (jamais un paiement ponctuel, jamais
        // un ancien abonnement rejoué).
        if (!invoiceSubId) break;

        const { data: sub } = await adminClient
          .from("organization_subscriptions")
          .select("organization_id, stripe_subscription_id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (!sub || sub.stripe_subscription_id !== invoiceSubId) {
          console.log(`[stripe-webhook] payment_failed for ${invoiceSubId} ignored (no matching subscription for customer ${customerId})`);
          break;
        }

        const { error: failedError } = await adminClient
          .from("organization_subscriptions")
          .update({
            status: "past_due",
            updated_at: new Date().toISOString(),
          })
          .eq("organization_id", sub.organization_id)
          .eq("stripe_subscription_id", invoiceSubId);
        if (failedError) {
          console.error(`[stripe-webhook] payment_failed update failed for org ${sub.organization_id}:`, failedError);
          return json({ error: "subscription update failed" }, 500);
        }

        console.log(`[stripe-webhook] Org ${sub.organization_id} marked past_due`);
        break;
      }

      default:
        console.log(`[stripe-webhook] Unhandled event type: ${event.type}`);
    }

    return json({ received: true });
  } catch (err) {
    console.error(`[stripe-webhook] Error processing ${event.type}:`, err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
