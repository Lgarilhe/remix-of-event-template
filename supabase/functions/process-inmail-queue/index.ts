// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { enforceLinkedInAction, recordUsageSignal, parseUsagePct } from "../_shared/linkedin-quotas.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Timeout wrapper for all external fetch calls (Unipile, Anthropic, Notion)
function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Sérialisation par compte (même garde-fou que process-enrichment-queue) :
// ne jamais envoyer depuis un compte utilisé interactivement (recherche /
// inbox manuelles = linkedin_action_log.source manual_*) dans les 5 dernières
// minutes. Un envoi concurrent sur un compte Recruiter mono-session peut
// déclencher multiple_sessions (cf. LOGBOOK 2026-07-06).
const INTERACTIVE_COOLDOWN_MS = 5 * 60 * 1000;

interface InMailQueueItem {
  id: string;
  account_id: string;
  recipient_profile_id: string;
  recipient_name: string | null;
  subject: string;
  message: string;
  status: string;
  scheduled_at: string | null;
  user_timezone: string;
  created_by: string;
  network_distance: number | null; // 1=1st degree, 2=2nd degree, 3=3rd degree
}

// Check if current time is within business hours for the given timezone.
// Conformité LinkedIn (warning #260513-007211) : les plages horaires sont
// configurables par user via member_quotas (cf. migration 20260513220000).
// Defaults : 8h-19h (compatible avec l'ancien comportement).
function isWithinBusinessHours(timezone: string, startHour = 8, endHour = 19): boolean {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const hour = parseInt(formatter.format(now), 10);

    return hour >= startHour && hour < endHour;
  } catch (e) {
    console.error("Error checking business hours:", e);
    // Default to Paris timezone if invalid
    const now = new Date();
    const parisHour = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" })).getHours();
    return parisHour >= startHour && parisHour < endHour;
  }
}

// Get a random delay between 1-2 minutes in milliseconds
function getRandomDelay(): number {
  const minMinutes = 1;
  const maxMinutes = 2;
  const minMs = minMinutes * 60 * 1000;
  const maxMs = maxMinutes * 60 * 1000;
  return Math.floor(Math.random() * (maxMs - minMs) + minMs);
}

// Calculate next scheduled time with human-like variation
function calculateNextScheduledTime(timezone: string, startHour = 8, endHour = 19): Date {
  const now = new Date();
  const delay = getRandomDelay();
  let nextTime = new Date(now.getTime() + delay);

  // Check if next time is still within business hours
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const nextHour = parseInt(formatter.format(nextTime), 10);

    // If outside business hours, schedule for next day at startHour + random offset
    if (nextHour >= endHour || nextHour < startHour) {
      // Get tomorrow at startHour in the user's timezone
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + (nextHour >= endHour ? 1 : 0));

      // Add random offset between 0-30 minutes after startHour
      const randomOffset = Math.floor(Math.random() * 30 * 60 * 1000);

      // Convert to target timezone's startHour
      const targetDate = new Date(tomorrow.toLocaleString("en-US", { timeZone: timezone }));
      targetDate.setHours(startHour, 0, 0, 0);
      nextTime = new Date(targetDate.getTime() + randomOffset);
    }
  } catch (e) {
    console.error("Error calculating next scheduled time:", e);
  }

  return nextTime;
}

// Load per-user quotas from member_quotas. Used to enforce business hours
// and timezone configured by the user (cf. migration 20260513220000).
// deno-lint-ignore no-explicit-any
async function loadUserQuotas(supabase: any, userId: string): Promise<{ startHour: number; endHour: number; timezone: string }> {
  const defaults = { startHour: 8, endHour: 19, timezone: 'Europe/Paris' };
  if (!userId) return defaults;
  try {
    const { data } = await supabase
      .from('member_quotas')
      .select('business_hours_start, business_hours_end, timezone')
      .eq('user_id', userId)
      .maybeSingle();
    if (!data) return defaults;
    return {
      startHour: data.business_hours_start ?? defaults.startHour,
      endHour: data.business_hours_end ?? defaults.endHour,
      timezone: data.timezone ?? defaults.timezone,
    };
  } catch (e) {
    console.warn(`[loadUserQuotas] failed for user ${userId}, using defaults:`, e);
    return defaults;
  }
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Service role client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Resolve Unipile credentials from org_integrations with env fallback
    let unipileApiKey: string | undefined;
    let unipileDsn: string | undefined;
    // We'll resolve after auth when we have the user ID

    const { action, items, user_timezone, item_ids } = await req.json();

    // Helper function to validate user from auth header
    const validateUser = async () => {
      const authHeader = req.headers.get("authorization");
      if (!authHeader) {
        throw new Error("Missing authorization header");
      }

      const token = authHeader.replace("Bearer ", "");
      
      // Create a client with the user's token to validate them
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      });
      
      const { data: { user }, error: authError } = await (userClient as any).auth.getUser(token);
      
      if (authError || !user) {
        console.error("Auth error:", authError);
        throw new Error("Authentication failed");
      }
      
      // Resolve Unipile credentials for this user's org
      if (!unipileApiKey || !unipileDsn) {
        try {
          const { resolveUnipileCredentials, resolveOrgIdFromUser } = await import("../_shared/resolve-org-credentials.ts");
          const orgId = await resolveOrgIdFromUser(user.id, supabase);
          const creds = await resolveUnipileCredentials(orgId, supabase);
          if (creds) {
            unipileApiKey = creds.apiKey;
            unipileDsn = creds.dsn.replace(/^https?:\/\//, '');
          }
        } catch (e) {
          console.warn('[process-inmail-queue] Org credential resolution failed:', e);
        }
        if (!unipileApiKey) unipileApiKey = Deno.env.get("UNIPILE_API_KEY");
        if (!unipileDsn) unipileDsn = Deno.env.get("UNIPILE_DSN");
        if (!unipileApiKey || !unipileDsn) throw new Error("Missing Unipile configuration");
      }
      
      return user;
    };

    // Action: queue - Add items to the queue
    if (action === "queue") {
      if (!items || !Array.isArray(items) || items.length === 0) {
        throw new Error("No items to queue");
      }

      const user = await validateUser();

      // Load user's configured business hours + timezone (default 8h-19h Paris)
      const userQuotas = await loadUserQuotas(supabase, user.id);
      const timezone = user_timezone || userQuotas.timezone;
      const startHour = userQuotas.startHour;
      const endHour = userQuotas.endHour;
      const now = new Date();

      // Schedule items with staggered times
      const queuedItems = items.map((item: any, index: number) => {
        // Calculate scheduled time: first item soon, others staggered
        let scheduledAt: Date;

        if (index === 0 && isWithinBusinessHours(timezone, startHour, endHour)) {
          // First item: send in 1-2 minutes if within business hours
          scheduledAt = new Date(now.getTime() + Math.floor(Math.random() * 60000) + 60000);
        } else {
          // Calculate cumulative delay for each item
          let cumulativeDelay = 0;
          for (let i = 0; i <= index; i++) {
            cumulativeDelay += getRandomDelay();
          }
          scheduledAt = new Date(now.getTime() + cumulativeDelay);
        }

        // Ensure it's within business hours
        const formatter = new Intl.DateTimeFormat("en-US", {
          timeZone: timezone,
          hour: "numeric",
          hour12: false,
        });
        const scheduledHour = parseInt(formatter.format(scheduledAt), 10);

        if (scheduledHour >= endHour || scheduledHour < startHour) {
          // Reschedule to next business day
          const nextDay = new Date(scheduledAt);
          if (scheduledHour >= endHour) {
            nextDay.setDate(nextDay.getDate() + 1);
          }
          nextDay.setHours(startHour + Math.floor(Math.random() * 2), Math.floor(Math.random() * 60), 0, 0);
          scheduledAt = nextDay;
        }

        return {
          account_id: item.account_id,
          recipient_profile_id: item.recipient_profile_id,
          recipient_name: item.recipient_name || null,
          recipient_headline: item.recipient_headline || null,
          subject: item.subject,
          message: item.message,
          status: "scheduled",
          scheduled_at: scheduledAt.toISOString(),
          user_timezone: timezone,
          created_by: user.id,
          network_distance: item.network_distance || null,
        };
      });

      const { data, error } = await supabase
        .from("inmail_queue")
        .insert(queuedItems)
        .select();

      if (error) throw error;

      return new Response(
        JSON.stringify({
          success: true,
          queued: data?.length || 0,
          message: `${data?.length || 0} InMails scheduled for sending`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Action: process - Process pending items (called by cron or manually)
    if (action === "process") {
      // Mode cron (pg_cron → invoke_process_inmail_queue, Bearer = secret interne
      // ou service key) : on traite les items dus de TOUS les users — c'est le
      // chemin nominal d'envoi des InMails planifiés. Mode manuel (UI, JWT user) :
      // comportement historique, scopé aux items du caller. Avant ce correctif le
      // cron passait par validateUser() → 400 à chaque cycle de 3 min, les InMails
      // planifiés ne partaient donc JAMAIS d'eux-mêmes (LOGBOOK 2026-07-06).
      const rawBearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
      const cronSecret = Deno.env.get("PROCESS_SEQUENCES_SECRET");
      const isCronCall = !!rawBearer && (rawBearer === cronSecret || rawBearer === supabaseServiceKey);

      let scopedUserId: string | null = null;
      if (!isCronCall) {
        const user = await validateUser();
        scopedUserId = user.id;
      }

      // Quotas (heures ouvrées + timezone) et credentials LinkedIn résolus PAR
      // user propriétaire de l'item (multi-user en mode cron), cachés par run.
      const quotasCache = new Map<string, { startHour: number; endHour: number; timezone: string }>();
      const getQuotasFor = async (userId: string) => {
        if (!quotasCache.has(userId)) quotasCache.set(userId, await loadUserQuotas(supabase, userId));
        return quotasCache.get(userId)!;
      };
      const credsCache = new Map<string, { apiKey: string; dsn: string } | null>();
      const getCredsFor = async (userId: string) => {
        // Mode manuel : validateUser() a déjà résolu les credentials de l'org du caller.
        if (unipileApiKey && unipileDsn) return { apiKey: unipileApiKey, dsn: unipileDsn };
        if (credsCache.has(userId)) return credsCache.get(userId)!;
        let resolved: { apiKey: string; dsn: string } | null = null;
        try {
          const { resolveUnipileCredentials, resolveOrgIdFromUser } = await import("../_shared/resolve-org-credentials.ts");
          const orgId = await resolveOrgIdFromUser(userId, supabase);
          const creds = await resolveUnipileCredentials(orgId, supabase);
          if (creds) resolved = { apiKey: creds.apiKey, dsn: creds.dsn.replace(/^https?:\/\//, "") };
        } catch (e) {
          console.warn("[process-inmail-queue] org credential resolution failed:", e);
        }
        if (!resolved) {
          const envKey = Deno.env.get("UNIPILE_API_KEY");
          const envDsn = Deno.env.get("UNIPILE_DSN");
          if (envKey && envDsn) resolved = { apiKey: envKey, dsn: envDsn };
        }
        credsCache.set(userId, resolved);
        return resolved;
      };

      const now = new Date();

      // Get items that are scheduled and ready to send.
      // Conformité LinkedIn (warning #260513-007211) : on limite à 3 InMails/cycle
      // pour rester cohérent avec MAX_VISIBLE_PER_CYCLE de process-sequences et
      // éviter les "bursts" détectables (50 InMails en 5min = pattern bot).
      const MAX_INMAILS_PER_CYCLE = 3;
      let pendingQuery = supabase
        .from("inmail_queue")
        .select("*")
        .in("status", ["scheduled", "pending"])
        .lte("scheduled_at", now.toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(MAX_INMAILS_PER_CYCLE);
      if (scopedUserId) pendingQuery = pendingQuery.eq("created_by", scopedUserId);
      const { data: pendingItems, error: fetchError } = await pendingQuery;

      if (fetchError) throw fetchError;

      if (!pendingItems || pendingItems.length === 0) {
        return new Response(
          JSON.stringify({ success: true, processed: 0, message: "No items to process" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const results: { id: string; success: boolean; error?: string }[] = [];

      for (const item of pendingItems as InMailQueueItem[]) {
        // Check if we're within business hours (per-user configurable via member_quotas)
        const itemQuotas = await getQuotasFor(item.created_by);
        const itemTz = item.user_timezone || itemQuotas.timezone;
        if (!isWithinBusinessHours(itemTz, itemQuotas.startHour, itemQuotas.endHour)) {
          // Reschedule for next business hours
          const nextScheduled = calculateNextScheduledTime(itemTz, itemQuotas.startHour, itemQuotas.endHour);
          await supabase
            .from("inmail_queue")
            .update({ scheduled_at: nextScheduled.toISOString() })
            .eq("id", item.id);

          results.push({ id: item.id, success: false, error: "Outside business hours, rescheduled" });
          continue;
        }

        // Conformité LinkedIn (warning #260513-007211) : vérifier le statut
        // du compte LinkedIn AVANT d'envoyer. Si le compte est CREDENTIALS /
        // ERROR / STOPPED, on ne peut pas envoyer — on reschedule à +1h plutôt
        // que de tenter et accumuler des erreurs côté Unipile (pattern bot).
        try {
          const { data: acctRow } = await supabase
            .from('member_linkedin_accounts')
            .select('account_status')
            .eq('linkedin_account_id', item.account_id)
            .maybeSingle();
          const status = acctRow?.account_status;
          if (status && status !== 'OK') {
            console.warn(`[process-inmail-queue] account ${item.account_id} status=${status} — rescheduling +1h`);
            await supabase
              .from('inmail_queue')
              .update({
                status: 'scheduled',
                scheduled_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                error_message: `Compte LinkedIn non disponible (statut: ${status})`,
              })
              .eq('id', item.id);
            results.push({ id: item.id, success: false, error: `account status: ${status}` });
            continue;
          }
        } catch (statusErr) {
          // Si on ne peut pas lire le statut, on log mais on continue
          // (fallback : Unipile rejettera de toute façon si le compte est down)
          console.warn(`[process-inmail-queue] could not read account_status for ${item.account_id}:`, statusErr);
        }

        // Sérialisation par compte : compte utilisé interactivement il y a
        // moins de INTERACTIVE_COOLDOWN_MS → on reporte l'envoi, l'usage
        // manuel a toujours priorité (un envoi concurrent sur un compte
        // Recruiter mono-session peut déclencher multiple_sessions).
        const { data: recentManual } = await supabase
          .from("linkedin_action_log")
          .select("id")
          .eq("account_id", item.account_id)
          .like("source", "manual%")
          .gte("created_at", new Date(Date.now() - INTERACTIVE_COOLDOWN_MS).toISOString())
          .limit(1);
        if (recentManual && recentManual.length > 0) {
          await supabase
            .from("inmail_queue")
            .update({
              status: "scheduled",
              scheduled_at: new Date(Date.now() + INTERACTIVE_COOLDOWN_MS).toISOString(),
              error_message: "Compte LinkedIn en cours d'utilisation — envoi reporté",
            })
            .eq("id", item.id);
          results.push({ id: item.id, success: false, error: "account in interactive use, rescheduled" });
          continue;
        }

        // Credentials LinkedIn de l'org propriétaire de l'item (cache par run).
        const creds = await getCredsFor(item.created_by);
        if (!creds) {
          await supabase
            .from("inmail_queue")
            .update({
              status: "scheduled",
              scheduled_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
              error_message: "Configuration LinkedIn indisponible (re-essai dans 1h)",
            })
            .eq("id", item.id);
          results.push({ id: item.id, success: false, error: "no credentials" });
          continue;
        }

        // Conformité LinkedIn : pour les InMails (degree 2+) on vérifie le
        // solde Recruiter/Premium AVANT d'envoyer. Si solde = 0 ou check fail,
        // on reschedule à +4h (fail-CLOSED) — éviter d'envoyer des InMails en
        // aveugle qui retourneront 400 et créent un pattern d'erreurs détectable.
        const isFirstDegreeMsg = item.network_distance === 1;
        if (!isFirstDegreeMsg) {
          try {
            const balRes = await fetchWithTimeout(
              `https://${creds.dsn}/api/v1/linkedin/inmail_balance?account_id=${encodeURIComponent(item.account_id)}`,
              { headers: { "X-API-KEY": creds.apiKey } }
            );
            if (!balRes.ok) {
              throw new Error(`balance check HTTP ${balRes.status}`);
            }
            const bal = await balRes.json();
            const credits =
              (typeof bal.recruiter === "number" ? bal.recruiter : 0) +
              (typeof bal.premium === "number" ? bal.premium : 0) +
              (typeof bal.sales_navigator === "number" ? bal.sales_navigator : 0);
            if (credits <= 0) {
              console.warn(`[process-inmail-queue] InMail balance = 0 for account ${item.account_id} — pausing item +4h`);
              await supabase
                .from("inmail_queue")
                .update({
                  status: "scheduled",
                  scheduled_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
                  error_message: "Crédits InMail épuisés (re-essai dans 4h)",
                })
                .eq("id", item.id);
              results.push({ id: item.id, success: false, error: "InMail balance = 0" });
              continue;
            }
          } catch (balErr) {
            // fail-CLOSED : si le check fail, on reschedule à +30min plutôt
            // que d'envoyer en aveugle (pourrait être un compte déconnecté)
            console.error(`[process-inmail-queue] InMail balance check failed (fail-closed):`, balErr);
            await supabase
              .from("inmail_queue")
              .update({
                status: "scheduled",
                scheduled_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                error_message: balErr instanceof Error ? balErr.message : "balance check failed",
              })
              .eq("id", item.id);
            results.push({ id: item.id, success: false, error: "balance check failed" });
            continue;
          }
        }

        // ─── Gate quota unifié (ledger partagé) ─────────────────────────
        // Conformité #260513-007211 : les InMails/messages de la file autonome
        // comptent désormais dans le MÊME plafond journalier que les séquences.
        // Avant ce correctif, ce chemin ignorait totalement le cap → fuite.
        {
          const gate = await enforceLinkedInAction(supabase, {
            accountId: item.account_id,
            actionType: isFirstDegreeMsg ? 'message' : 'inmail',
            userId: item.created_by,
            source: 'inmail_queue',
          });
          if (!gate.allowed) {
            // Limites "dures" (pause fournisseur / hebdo) → back-off plus long.
            const backoffMs = (gate.scope === 'provider_pause' || gate.scope === 'weekly_invite')
              ? 6 * 60 * 60 * 1000
              : 60 * 60 * 1000;
            await supabase
              .from("inmail_queue")
              .update({
                status: "scheduled",
                scheduled_at: new Date(Date.now() + backoffMs).toISOString(),
                error_message: gate.reason || "Quota LinkedIn atteint",
              })
              .eq("id", item.id);
            results.push({ id: item.id, success: false, error: gate.reason || "quota" });
            continue;
          }
        }

        // Mark as sending
        await supabase
          .from("inmail_queue")
          .update({ status: "sending" })
          .eq("id", item.id);

        try {
          // Determine message type based on network distance
          // 1st degree = direct message, 2nd/3rd degree = InMail
          const isFirstDegree = isFirstDegreeMsg;
          
          // Validate profile ID format
          // Unipile expects provider_id in URN format for Recruiter: AE... or ACo... etc.
          // If it's a numeric ID, it's likely a Recruiter-internal member ID that won't work
          const profileId = item.recipient_profile_id;
          const isValidUrn = profileId && (
            profileId.startsWith('AE') || 
            profileId.startsWith('ACo') || 
            profileId.startsWith('ACw') || 
            profileId.startsWith('ADo')
          );
          
          console.log(`Profile ID validation for ${item.recipient_name}:`, {
            profileId,
            isValidUrn,
            networkDistance: item.network_distance,
            isFirstDegree,
          });
          
          if (!isValidUrn) {
            console.warn(`Invalid profile ID format for ${item.recipient_name}: ${profileId}. Expected URN format (AE..., ACo..., etc.)`);
          }
          
          const formData = new FormData();
          formData.append("account_id", item.account_id);
          formData.append("text", item.message);
          formData.append("attendees_ids", profileId);
          
          if (isFirstDegree) {
            // Direct message for 1st degree connections - no InMail needed
            console.log(`Sending direct message to ${item.recipient_name} (1st degree)`);
            formData.append("linkedin[api]", "recruiter");
            // No inmail flag = regular message
          } else {
            // InMail for 2nd/3rd degree connections
            console.log(`Sending InMail to ${item.recipient_name} (${item.network_distance || 'unknown'} degree)`);
            formData.append("linkedin[api]", "recruiter");
            formData.append("linkedin[inmail]", "true");
            formData.append("subject", item.subject);
          }

          console.log(`Sending to Unipile:`, {
            account_id: item.account_id,
            attendees_ids: profileId,
            isInMail: !isFirstDegree,
            subject: !isFirstDegree ? item.subject : undefined,
          });

          const response = await fetchWithTimeout(
            `https://${creds.dsn}/api/v1/chats`,
            {
              method: "POST",
              headers: {
                "X-API-KEY": creds.apiKey,
                "accept": "application/json",
              },
              body: formData,
            }
          );

          if (!response.ok) {
            const errorText = await response.text();
            // Provider hard-limit signals → pause the account for the day so
            // every send path backs off (conformité #260513-007211).
            if (/too_many_requests|limit_exceeded|cannot_resend_yet|cannot_resend_within_24hrs/i.test(errorText)) {
              await recordUsageSignal(supabase, item.account_id, 100, item.user_timezone);
            }
            throw new Error(`Unipile error: ${response.status} - ${errorText}`);
          }

          // Capture the provider usage % (LinkedIn signals how close we are to
          // its own limit) — proactively pauses the account at ≥90%.
          try {
            const okBody = await response.json();
            await recordUsageSignal(supabase, item.account_id, parseUsagePct(okBody), item.user_timezone);
          } catch { /* response body is optional */ }

          // Mark as sent
          await supabase
            .from("inmail_queue")
            .update({ 
              status: "sent", 
              sent_at: new Date().toISOString(),
              error_message: null,
            })
            .eq("id", item.id);

          results.push({ id: item.id, success: true });

          // Conformité LinkedIn : jitter 5-15s entre 2 envois dans le même
          // cycle (aligné sur process-sequences). Évite un pattern régulier
          // détectable (2s = trop court, ressemble à un bot).
          const microDelay = 5000 + Math.floor(Math.random() * 10000);
          await new Promise(resolve => setTimeout(resolve, microDelay));

        } catch (sendError) {
          const errorMessage = sendError instanceof Error ? sendError.message : "Unknown error";
          
          // Mark as failed
          await supabase
            .from("inmail_queue")
            .update({ 
              status: "failed", 
              error_message: errorMessage,
            })
            .eq("id", item.id);

          results.push({ id: item.id, success: false, error: errorMessage });
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          processed: results.length,
          results,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Action: status - Get queue status for current user
    if (action === "status") {
      const user = await validateUser();

      const { data: queueItems, error: fetchError } = await supabase
        .from("inmail_queue")
        .select("*")
        .eq("created_by", user.id)
        .order("created_at", { ascending: false })
        .limit(100);

      if (fetchError) throw fetchError;

      const stats = {
        pending: 0,
        scheduled: 0,
        sending: 0,
        sent: 0,
        failed: 0,
        cancelled: 0,
      };

      (queueItems || []).forEach((item: InMailQueueItem) => {
        if (item.status in stats) {
          stats[item.status as keyof typeof stats]++;
        }
      });

      return new Response(
        JSON.stringify({
          success: true,
          stats,
          items: queueItems,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Action: cancel - Cancel pending items
    if (action === "cancel") {
      const user = await validateUser();

      const { data, error } = await supabase
        .from("inmail_queue")
        .update({ status: "cancelled" })
        .eq("created_by", user.id)
        .in("id", item_ids)
        .in("status", ["pending", "scheduled"])
        .select();

      if (error) throw error;

      return new Response(
        JSON.stringify({
          success: true,
          cancelled: data?.length || 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    throw new Error(`Unknown action: ${action}`);

  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
