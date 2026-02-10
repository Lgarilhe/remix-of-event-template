import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.75.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

// Check if current time is within business hours (8h-19h) for the given timezone
function isWithinBusinessHours(timezone: string): boolean {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const hour = parseInt(formatter.format(now), 10);
    
    // Business hours: 8h to 19h
    return hour >= 8 && hour < 19;
  } catch (e) {
    console.error("Error checking business hours:", e);
    // Default to Paris timezone if invalid
    const now = new Date();
    const parisHour = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" })).getHours();
    return parisHour >= 8 && parisHour < 19;
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
function calculateNextScheduledTime(timezone: string): Date {
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
    
    // If outside business hours, schedule for next day at 8h + random offset
    if (nextHour >= 19 || nextHour < 8) {
      // Get tomorrow at 8h in the user's timezone
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + (nextHour >= 19 ? 1 : 0));
      
      // Add random offset between 0-30 minutes after 8h
      const randomOffset = Math.floor(Math.random() * 30 * 60 * 1000);
      
      // Convert to target timezone's 8 AM
      const targetDate = new Date(tomorrow.toLocaleString("en-US", { timeZone: timezone }));
      targetDate.setHours(8, 0, 0, 0);
      nextTime = new Date(targetDate.getTime() + randomOffset);
    }
  } catch (e) {
    console.error("Error calculating next scheduled time:", e);
  }
  
  return nextTime;
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const unipileApiKey = Deno.env.get("UNIPILE_API_KEY");
    const unipileDsn = Deno.env.get("UNIPILE_DSN");

    if (!unipileApiKey || !unipileDsn) {
      throw new Error("Missing Unipile configuration");
    }

    // Service role client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
      
      const { data: { user }, error: authError } = await userClient.auth.getUser(token);
      
      if (authError || !user) {
        console.error("Auth error:", authError);
        throw new Error("Authentication failed");
      }
      
      return user;
    };

    // Action: queue - Add items to the queue
    if (action === "queue") {
      if (!items || !Array.isArray(items) || items.length === 0) {
        throw new Error("No items to queue");
      }

      const user = await validateUser();

      const timezone = user_timezone || "Europe/Paris";
      const now = new Date();
      
      // Schedule items with staggered times
      const queuedItems = items.map((item: any, index: number) => {
        // Calculate scheduled time: first item soon, others staggered
        let scheduledAt: Date;
        
        if (index === 0 && isWithinBusinessHours(timezone)) {
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
        
        if (scheduledHour >= 19 || scheduledHour < 8) {
          // Reschedule to next business day
          const nextDay = new Date(scheduledAt);
          if (scheduledHour >= 19) {
            nextDay.setDate(nextDay.getDate() + 1);
          }
          nextDay.setHours(8 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 60), 0, 0);
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
      const now = new Date();
      
      // Get items that are scheduled and ready to send
      const { data: pendingItems, error: fetchError } = await supabase
        .from("inmail_queue")
        .select("*")
        .in("status", ["scheduled", "pending"])
        .lte("scheduled_at", now.toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(5); // Process max 5 at a time

      if (fetchError) throw fetchError;

      if (!pendingItems || pendingItems.length === 0) {
        return new Response(
          JSON.stringify({ success: true, processed: 0, message: "No items to process" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const results: { id: string; success: boolean; error?: string }[] = [];

      for (const item of pendingItems as InMailQueueItem[]) {
        // Check if we're within business hours for this user's timezone
        if (!isWithinBusinessHours(item.user_timezone)) {
          // Reschedule for next business hours
          const nextScheduled = calculateNextScheduledTime(item.user_timezone);
          await supabase
            .from("inmail_queue")
            .update({ scheduled_at: nextScheduled.toISOString() })
            .eq("id", item.id);
          
          results.push({ id: item.id, success: false, error: "Outside business hours, rescheduled" });
          continue;
        }

        // Mark as sending
        await supabase
          .from("inmail_queue")
          .update({ status: "sending" })
          .eq("id", item.id);

        try {
          // Determine message type based on network distance
          // 1st degree = direct message, 2nd/3rd degree = InMail
          const isFirstDegree = item.network_distance === 1;
          
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
            formData.append("linkedin[subject]", item.subject);
          }

          console.log(`Sending to Unipile:`, {
            account_id: item.account_id,
            attendees_ids: profileId,
            isInMail: !isFirstDegree,
            subject: !isFirstDegree ? item.subject : undefined,
          });

          const response = await fetch(
            `https://${unipileDsn}/api/v1/chats`,
            {
              method: "POST",
              headers: {
                "X-API-KEY": unipileApiKey,
                "accept": "application/json",
              },
              body: formData,
            }
          );

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Unipile error: ${response.status} - ${errorText}`);
          }

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

          // Add human-like delay between sends (2-5 seconds)
          const microDelay = Math.floor(Math.random() * 3000) + 2000;
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
      // Try to get user, but allow anonymous access for status view
      let userId: string | null = null;
      try {
        const user = await validateUser();
        userId = user.id;
      } catch {
        // Allow unauthenticated status check - show recent items
      }

      const query = supabase
        .from("inmail_queue")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (userId) {
        query.eq("created_by", userId);
      }

      const { data: queueItems, error: fetchError } = await query;

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
