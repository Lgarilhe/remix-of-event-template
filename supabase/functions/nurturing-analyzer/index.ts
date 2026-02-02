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
    const { action, account_id, user_id, conversations, jobs } = await req.json();

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

      const opportunities: NurturingOpportunity[] = [];

      // Analyze provided conversations
      for (const conv of conversations || []) {
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

      // Insert opportunities into database
      if (opportunities.length > 0) {
        const { error: insertError } = await supabase
          .from('nurturing_opportunities')
          .upsert(
            opportunities.map(o => ({
              ...o,
              status: 'pending',
            })),
            { onConflict: 'candidate_id,trigger_type,status', ignoreDuplicates: true }
          );

        if (insertError) {
          console.error('Insert error:', insertError);
        }
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          analyzed: conversations?.length || 0,
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
