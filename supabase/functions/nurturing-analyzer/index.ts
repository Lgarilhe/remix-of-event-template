import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Conversation {
  id: string;
  attendee_id: string;
  attendee_name?: string;
  attendee_headline?: string;
  attendee_profile_url?: string;
  last_message_at: string;
  last_message_text?: string;
  is_unread: boolean;
  messages?: Message[];
}

interface Message {
  text: string;
  is_sender: boolean;
  timestamp: string;
}

interface NurturingOpportunity {
  candidate_id: string;
  candidate_name: string | null;
  candidate_headline: string | null;
  candidate_profile_url: string | null;
  job_id: string | null;
  job_title: string | null;
  trigger_type: 'silence' | 'new_job_match' | 'stage_change' | 'intent_detected' | 'scheduled_followup';
  priority_score: number;
  analysis_context: Record<string, unknown>;
  last_message_at: string | null;
  days_since_contact: number | null;
  detected_intent: string | null;
  suggested_action: 'personalized_message' | 'job_alert' | 'call_proposal' | 'content_share' | 'followup';
  suggested_message: string | null;
  suggested_subject: string | null;
  linkedin_account_id: string;
  created_by: string;
}

type AnyRecord = Record<string, unknown>;

function isRecord(v: unknown): v is AnyRecord {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function firstString(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string") {
      const trimmed = c.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return null;
}

function extractArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value)) {
    const r = value as AnyRecord;
    if (Array.isArray(r.items)) return r.items;
    if (Array.isArray(r.results)) return r.results;
    if (isRecord(r.data)) {
      const d = r.data as AnyRecord;
      if (Array.isArray(d.items)) return d.items;
      if (Array.isArray(d.results)) return d.results;
    }
  }
  return [];
}

function findNonSelfAttendee(chat: AnyRecord): AnyRecord | null {
  const candidates = [
    ...extractArray(chat.attendees),
    ...extractArray(chat.participants),
    ...extractArray(chat.members),
    ...extractArray(chat.profiles),
  ].filter(isRecord);

  const nonSelf = candidates.find((a) => {
    const rec = a as AnyRecord;
    const isSelf = Boolean(
      rec.is_self ?? rec.isSelf ?? rec.self ?? rec.is_me ?? rec.isMe
    );
    return !isSelf;
  });

  return (nonSelf as AnyRecord) || null;
}

function guessProfileUrl(attendee: AnyRecord | null, attendeeId: string | null): string | null {
  if (!attendee) return null;

  const url = firstString(
    attendee.profile_url,
    attendee.profileUrl,
    attendee.public_profile_url,
    attendee.publicProfileUrl,
    attendee.linkedin_url,
    attendee.linkedinUrl,
  );
  if (url) return url;

  const publicIdentifier = firstString(
    attendee.public_identifier,
    attendee.publicIdentifier,
    attendee.vanity_name,
    attendee.vanityName,
    attendee.slug,
  );
  if (publicIdentifier) return `https://www.linkedin.com/in/${publicIdentifier}`;

  // Last resort: if Unipile gives a LinkedIn identifier (ACoAA...), we can't reliably
  // reconstruct a public URL, so we keep it null.
  void attendeeId;
  return null;
}

// Cadence rules by stage
const CADENCE_BY_STAGE: Record<string, { minDays: number; maxDays: number; priority: number }> = {
  'Pressenti': { minDays: 3, maxDays: 5, priority: 90 },
  'CV envoyé': { minDays: 5, maxDays: 7, priority: 80 },
  'ITW en cours': { minDays: 2, maxDays: 4, priority: 95 },
  'Offre': { minDays: 1, maxDays: 2, priority: 100 },
  'cold': { minDays: 14, maxDays: 21, priority: 40 },
  'default': { minDays: 7, maxDays: 10, priority: 50 },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, account_id, user_id, conversations, jobs } = body;

    const UNIPILE_API_KEY = Deno.env.get("UNIPILE_API_KEY");
    const UNIPILE_DSN = Deno.env.get("UNIPILE_DSN");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase configuration missing");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Action: Analyze conversations for nurturing opportunities
    if (action === 'analyze') {
      if (!UNIPILE_API_KEY || !UNIPILE_DSN || !LOVABLE_API_KEY) {
        throw new Error("API keys not configured");
      }

      if (!account_id || !user_id) {
        throw new Error("account_id and user_id are required");
      }

      console.log(`[nurturing-analyzer] Starting analysis for account ${account_id}`);

      // Fetch conversations from Unipile if not provided
      let conversationsToAnalyze = conversations || [];
      if (conversationsToAnalyze.length === 0) {
        console.log('[nurturing-analyzer] Fetching conversations from Unipile...');
        conversationsToAnalyze = await fetchUnipileConversations(account_id, UNIPILE_DSN, UNIPILE_API_KEY);
        console.log(`[nurturing-analyzer] Fetched ${conversationsToAnalyze.length} conversations`);
      }

      const opportunities: NurturingOpportunity[] = [];

      // Analyze conversations
      for (const conv of conversationsToAnalyze) {
        const opportunity = await analyzeConversation(
          conv,
          jobs || [],
          account_id,
          user_id,
          LOVABLE_API_KEY
        );
        if (opportunity) {
          opportunities.push(opportunity);
        }
      }

      console.log(`[nurturing-analyzer] Found ${opportunities.length} opportunities`);

      // Insert opportunities into database
      if (opportunities.length > 0) {
        // IMPORTANT:
        // Unipile can return multiple conversations for the same attendee within the same run,
        // which can produce duplicate (candidate_id, linkedin_account_id) rows.
        // A single UPSERT statement cannot contain duplicates for the conflict target
        // (it would trigger: "ON CONFLICT DO UPDATE command cannot affect row a second time").
        // So we dedupe here and keep the highest-priority opportunity per candidate/account.
        const dedupedMap = new Map<string, NurturingOpportunity>();
        for (const o of opportunities) {
          const key = `${o.candidate_id}::${o.linkedin_account_id}`;
          const existing = dedupedMap.get(key);
          if (!existing || o.priority_score > existing.priority_score) {
            dedupedMap.set(key, o);
          }
        }

        const deduped = Array.from(dedupedMap.values());
        if (deduped.length !== opportunities.length) {
          console.log(
            `[nurturing-analyzer] Deduped opportunities: ${opportunities.length} -> ${deduped.length}`,
          );
        }

        const { error: insertError } = await supabase
          .from('nurturing_opportunities')
          .upsert(
            deduped.map(o => ({
              ...o,
              status: 'pending',
            })),
            { onConflict: 'candidate_id,linkedin_account_id', ignoreDuplicates: false }
          );

        if (insertError) {
          console.error('Insert error:', insertError);
        }
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          analyzed: conversationsToAnalyze.length,
          opportunities: opportunities.length 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Action: Get pending opportunities for a user
    if (action === 'list') {
      if (!user_id) {
        throw new Error("user_id is required");
      }

      const { data, error } = await supabase
        .from('nurturing_opportunities')
        .select('*')
        .eq('created_by', user_id)
        .eq('status', 'pending')
        .order('priority_score', { ascending: false })
        .limit(50);

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, opportunities: data || [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Action: Update opportunity status
    if (action === 'update_status') {
      const { opportunity_id, status } = await req.json();
      
      if (!opportunity_id || !status) {
        throw new Error("opportunity_id and status are required");
      }

      const updateData: Record<string, unknown> = { status };
      if (status === 'sent') {
        updateData.sent_at = new Date().toISOString();
      }
      if (['approved', 'dismissed'].includes(status)) {
        updateData.reviewed_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('nurturing_opportunities')
        .update(updateData)
        .eq('id', opportunity_id);

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Action: Generate message for an opportunity
    if (action === 'generate_message') {
      const { opportunity_id } = await req.json();
      
      if (!opportunity_id || !LOVABLE_API_KEY) {
        throw new Error("opportunity_id and API key are required");
      }

      const { data: opportunity, error } = await supabase
        .from('nurturing_opportunities')
        .select('*')
        .eq('id', opportunity_id)
        .single();

      if (error || !opportunity) {
        throw new Error("Opportunity not found");
      }

      const message = await generateNurturingMessage(opportunity, LOVABLE_API_KEY);

      // Update opportunity with generated message
      await supabase
        .from('nurturing_opportunities')
        .update({ 
          suggested_message: message.message,
          suggested_subject: message.subject 
        })
        .eq('id', opportunity_id);

      return new Response(
        JSON.stringify({ success: true, message: message.message, subject: message.subject }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    throw new Error(`Unknown action: ${action}`);

  } catch (error) {
    console.error("Nurturing analyzer error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Fetch conversations from Unipile API
async function fetchUnipileConversations(
  accountId: string,
  dsn: string,
  apiKey: string
): Promise<Conversation[]> {
  try {
    const baseUrl = `https://${dsn}`;
    const folders = ['INBOX_LINKEDIN_CLASSIC', 'INBOX_LINKEDIN_RECRUITER'];
    const allConversations: Conversation[] = [];

    for (const folder of folders) {
      const url = `${baseUrl}/api/v1/chats?account_id=${accountId}&folder=${folder}&limit=100`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-KEY': apiKey,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        console.error(`[nurturing-analyzer] Unipile error for ${folder}: ${response.status}`);
        continue;
      }

      const data = await response.json();
      const chats = (data?.items || []) as Array<Record<string, unknown>>;

      // IMPORTANT: the list endpoint may not include full attendees info.
      // We try to extract minimal identifiers from the chat payload.
       for (const chatRaw of chats) {
         const chat = (isRecord(chatRaw) ? chatRaw : {}) as AnyRecord;
         const attendee = findNonSelfAttendee(chat);

         const attendeeId = firstString(
           attendee?.provider_id,
           attendee?.providerId,
           attendee?.id,
           attendee?.provider_user_id,
           attendee?.providerUserId,
           chat.attendee_provider_id,
           chat.attendeeProviderId,
           chat.attendee_id,
           chat.attendeeId,
           chat.provider_id,
           chat.providerId,
           chat.id,
         );

        // If we can't identify the attendee, skip.
        if (!attendeeId) continue;

         const lastMessageAt = firstString(
           chat.last_message_at,
           chat.lastMessageAt,
           chat.timestamp,
           chat.updated_at,
           chat.updatedAt,
           chat.created_at,
           chat.createdAt,
         );

         const lastMessageText = firstString(
           (isRecord(chat.last_message) ? (chat.last_message as AnyRecord).text : undefined),
           (isRecord(chat.lastMessage) ? (chat.lastMessage as AnyRecord).text : undefined),
           chat.last_message_text,
           chat.lastMessageText,
           chat.snippet,
         );

         const attendeeName = firstString(
           attendee?.display_name,
           attendee?.displayName,
           attendee?.name,
           attendee?.full_name,
           attendee?.fullName,
           attendee?.first_name && attendee?.last_name
             ? `${attendee.first_name} ${attendee.last_name}`
             : undefined,
           attendee?.firstName && attendee?.lastName
             ? `${attendee.firstName} ${attendee.lastName}`
             : undefined,
         );

         const attendeeHeadline = firstString(
           attendee?.headline,
           attendee?.title,
           attendee?.occupation,
           (isRecord(attendee?.specifics) ? (attendee?.specifics as AnyRecord).occupation : undefined),
           (isRecord(attendee?.specifics) ? (attendee?.specifics as AnyRecord).title : undefined),
         );

         const attendeeProfileUrl = guessProfileUrl(attendee, attendeeId);

        allConversations.push({
           id: firstString(chat.id) || attendeeId,
           attendee_id: attendeeId,
           attendee_name: attendeeName || undefined,
           attendee_headline: attendeeHeadline || undefined,
           attendee_profile_url: attendeeProfileUrl || undefined,
           last_message_at: lastMessageAt || new Date().toISOString(),
           last_message_text: lastMessageText || undefined,
           is_unread: Boolean(
             typeof chat.unread_count === "number" ? chat.unread_count > 0 : chat.unread
           ),
        });
      }
    }

    return allConversations;
  } catch (error) {
    console.error('[nurturing-analyzer] Error fetching conversations:', error);
    return [];
  }
}

async function analyzeConversation(
  conv: Conversation,
  jobs: Array<{ id: string; title: string; client?: string }>,
  accountId: string,
  userId: string,
  apiKey: string
): Promise<NurturingOpportunity | null> {
  
  const now = new Date();
  const lastMessageDate = new Date(conv.last_message_at);
  const daysSinceContact = Math.floor((now.getTime() - lastMessageDate.getTime()) / (1000 * 60 * 60 * 24));

  // Skip very recent conversations (less than 3 days)
  if (daysSinceContact < 3) {
    return null;
  }

  // Skip if already replied recently
  if (conv.is_unread === false && daysSinceContact < 5) {
    return null;
  }

  // Determine trigger type and priority based on silence duration
  let triggerType: NurturingOpportunity['trigger_type'] = 'silence';
  let priorityScore = 50;
  let suggestedAction: NurturingOpportunity['suggested_action'] = 'followup';

  // Get cadence based on context
  const cadence = CADENCE_BY_STAGE['default'];
  
  if (daysSinceContact >= cadence.minDays) {
    // Calculate priority based on days silent (higher priority for optimal window)
    if (daysSinceContact <= cadence.maxDays) {
      priorityScore = cadence.priority;
    } else if (daysSinceContact <= cadence.maxDays * 2) {
      priorityScore = cadence.priority - 20;
    } else {
      priorityScore = Math.max(20, cadence.priority - 40);
    }
  }

  // Analyze intent from last message if available
  let detectedIntent: string | null = null;
  if (conv.last_message_text) {
    const intentAnalysis = await analyzeMessageIntent(conv.last_message_text, apiKey);
    detectedIntent = intentAnalysis.intent;
    
    // Adjust priority based on intent
    if (intentAnalysis.intent === 'interested') {
      priorityScore += 20;
      suggestedAction = 'call_proposal';
    } else if (intentAnalysis.intent === 'needs_info') {
      priorityScore += 15;
      suggestedAction = 'personalized_message';
      triggerType = 'intent_detected';
    } else if (intentAnalysis.intent === 'timing_issue') {
      suggestedAction = 'followup';
    }
  }

  // Match with active jobs if available
  let matchedJob = null;
  if (jobs.length > 0) {
    // Simple keyword matching for now
    const headline = (conv.attendee_headline || '').toLowerCase();
    for (const job of jobs) {
      const titleWords = job.title.toLowerCase().split(' ');
      if (titleWords.some(word => headline.includes(word) && word.length > 3)) {
        matchedJob = job;
        suggestedAction = 'job_alert';
        break;
      }
    }
  }

  return {
    candidate_id: conv.attendee_id,
    candidate_name: conv.attendee_name || null,
    candidate_headline: conv.attendee_headline || null,
    candidate_profile_url: conv.attendee_profile_url || null,
    job_id: matchedJob?.id || null,
    job_title: matchedJob?.title || null,
    trigger_type: triggerType,
    priority_score: Math.min(100, priorityScore),
    analysis_context: {
      conversation_id: conv.id,
      last_message_preview: conv.last_message_text?.slice(0, 200),
      is_unread: conv.is_unread,
    },
    last_message_at: conv.last_message_at,
    days_since_contact: daysSinceContact,
    detected_intent: detectedIntent,
    suggested_action: suggestedAction,
    suggested_message: null,
    suggested_subject: null,
    linkedin_account_id: accountId,
    created_by: userId,
  };
}

async function analyzeMessageIntent(
  messageText: string,
  apiKey: string
): Promise<{ intent: string; confidence: number }> {
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: "Tu es un expert en analyse de messages LinkedIn. Réponds uniquement en JSON."
          },
          {
            role: "user",
            content: `Analyse ce message et détermine l'intention:
"${messageText}"

Réponds en JSON:
{
  "intent": "interested|not_interested|needs_info|wants_call|timing_issue|neutral",
  "confidence": 0-100
}`
          }
        ],
        max_tokens: 100,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      return { intent: 'neutral', confidence: 0 };
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || "";
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    const parsed = JSON.parse(content);
    return {
      intent: parsed.intent || 'neutral',
      confidence: parsed.confidence || 50,
    };
  } catch {
    return { intent: 'neutral', confidence: 0 };
  }
}

async function generateNurturingMessage(
  opportunity: Record<string, unknown>,
  apiKey: string
): Promise<{ message: string; subject: string }> {
  const triggerMessages: Record<string, string> = {
    silence: "Relance après silence - maintenir le contact",
    new_job_match: "Nouveau poste correspondant au profil",
    intent_detected: "Répondre à l'intérêt détecté",
    scheduled_followup: "Suivi planifié",
    stage_change: "Suite au changement d'étape",
  };

  const actionMessages: Record<string, string> = {
    personalized_message: "un message personnalisé de suivi",
    job_alert: "une alerte sur un nouveau poste",
    call_proposal: "une proposition d'appel",
    content_share: "un partage de contenu utile",
    followup: "un message de relance",
  };

  const prompt = `Tu es un recruteur tech expert. Rédige un message LinkedIn de nurturing.

CONTEXTE:
- Candidat: ${opportunity.candidate_name || 'Non spécifié'}
- Profil: ${opportunity.candidate_headline || 'Non spécifié'}
- Jours depuis dernier contact: ${opportunity.days_since_contact}
- Raison: ${triggerMessages[opportunity.trigger_type as string] || 'Suivi'}
- Objectif: ${actionMessages[opportunity.suggested_action as string] || 'Message de suivi'}
${opportunity.job_title ? `- Poste concerné: ${opportunity.job_title}` : ''}
${opportunity.detected_intent ? `- Intent détecté: ${opportunity.detected_intent}` : ''}

RÈGLES:
- Max 100 mots
- Ton professionnel mais chaleureux
- Personnalisé au profil
- Appel à l'action clair
- PAS de phrases génériques IA

Réponds en JSON:
{
  "subject": "Objet du message (max 60 car)",
  "message": "Corps du message"
}`;

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Tu es un recruteur tech. Réponds en JSON uniquement." },
          { role: "user", content: prompt }
        ],
        max_tokens: 300,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error("AI request failed");
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || "";
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    const parsed = JSON.parse(content);
    return {
      message: parsed.message || "Je voulais prendre de vos nouvelles. Avez-vous un moment pour échanger ?",
      subject: parsed.subject || "Suite à notre échange",
    };
  } catch {
    return {
      message: "Je voulais prendre de vos nouvelles. Avez-vous un moment pour échanger ?",
      subject: "Suite à notre échange",
    };
  }
}
