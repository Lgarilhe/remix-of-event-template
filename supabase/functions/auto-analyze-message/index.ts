import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.75.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UNIPILE_API_KEY = Deno.env.get("UNIPILE_API_KEY");
const UNIPILE_DSN = Deno.env.get("UNIPILE_DSN");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const NOTION_API_KEY = Deno.env.get("NOTION_API_KEY");
const CANDIDATS_DATABASE_ID = "2787e1816fb4812b8ebddfcb3ab95510";
const SHORTLIST_DATABASE_ID = "2787e1816fb4811986a7e6075bc63a23";

// ─── Intent → Notion property mapping ─────────────────────────────
// Candidats DB uses "Etat" (select): Pré-qualif à planifier, Répondu, En attente de réponse, Message à envoyer
// Shortlist DB uses "Etape" (select): Pressenti, Contacté, Pré-qualif, Pas intéressé, Pas pertinent, En attente, etc.
const INTENT_TO_CANDIDAT_ETAT: Record<string, string> = {
  'interested': 'Pré-qualif à planifier',
  'wants_call': 'Pré-qualif à planifier',
  'needs_info': 'Répondu',
  'timing_issue': 'Répondu',
};

const INTENT_TO_SHORTLIST_ETAPE: Record<string, string> = {
  'interested': 'Pré-qualif',
  'wants_call': 'Pré-qualif',
  'not_interested': 'Pas intéressé',
  'already_placed': 'Pas pertinent',
  'timing_issue': 'En attente',
};

// Minimum confidence to trigger auto-update
const MIN_CONFIDENCE = 60;

// ─── Notion helpers ───────────────────────────────────────────────
async function notionQuery(databaseId: string, filter: Record<string, unknown>) {
  const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ filter, page_size: 1 }),
  });
  if (!response.ok) return null;
  return response.json();
}

async function updateNotionPage(pageId: string, properties: Record<string, unknown>) {
  const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties }),
  });
  if (!response.ok) {
    console.error('[auto-analyze] Notion update error:', await response.text());
  }
  return response.ok;
}

async function findCandidateInNotion(name: string, linkedinUrl?: string): Promise<string | null> {
  // Try LinkedIn URL first
  if (linkedinUrl) {
    const result = await notionQuery(CANDIDATS_DATABASE_ID, {
      property: 'URL Linkedin',
      url: { equals: linkedinUrl },
    });
    if (result?.results?.[0]?.id) return result.results[0].id;
  }

  // Fallback to name
  if (name) {
    const result = await notionQuery(CANDIDATS_DATABASE_ID, {
      property: 'Nom',
      title: { equals: name },
    });
    if (result?.results?.[0]?.id) return result.results[0].id;
  }
  return null;
}

async function findShortlistsForCandidate(candidateId: string): Promise<Array<{ id: string; jobTitle?: string }>> {
  const result = await notionQuery(SHORTLIST_DATABASE_ID, {
    property: 'Candidats',
    relation: { contains: candidateId },
  });
  if (!result?.results) return [];
  
  // Fetch all shortlists, not just the first one
  const response = await fetch(`https://api.notion.com/v1/databases/${SHORTLIST_DATABASE_ID}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filter: { property: 'Candidats', relation: { contains: candidateId } },
      page_size: 10,
    }),
  });
  if (!response.ok) return [];
  const data = await response.json();
  
  return (data.results || []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    jobTitle: ((r as Record<string, unknown>).properties as Record<string, unknown>)?.['Nom'] 
      ? 'shortlist' : undefined,
  }));
}

// ─── Unipile helpers ──────────────────────────────────────────────
async function fetchChatMessages(chatId: string, accountId: string): Promise<Array<{ text: string; is_sender: boolean; timestamp?: string }>> {
  const baseUrl = `https://${UNIPILE_DSN}/api/v1`;
  const url = `${baseUrl}/chats/${chatId}/messages?limit=15`;
  
  const response = await fetch(url, {
    headers: { 'X-API-KEY': UNIPILE_API_KEY!, 'Accept': 'application/json' },
  });
  
  if (!response.ok) {
    console.error('[auto-analyze] Failed to fetch messages:', response.status);
    return [];
  }
  
  const data = await response.json();
  const items = data.items || data.data || [];
  
  return items.map((m: Record<string, unknown>) => ({
    text: (m.text || m.body || '') as string,
    is_sender: !!m.is_sender,
    timestamp: m.timestamp as string || m.date as string,
  })).reverse(); // Oldest first
}

async function fetchChatDetails(chatId: string): Promise<{ attendeeName?: string; attendeeHeadline?: string; attendeeProfileUrl?: string; attendeeProviderId?: string }> {
  const baseUrl = `https://${UNIPILE_DSN}/api/v1`;
  const url = `${baseUrl}/chats/${chatId}`;
  
  const response = await fetch(url, {
    headers: { 'X-API-KEY': UNIPILE_API_KEY!, 'Accept': 'application/json' },
  });
  
  if (!response.ok) return {};
  const data = await response.json();
  
  const attendees = data.attendees || [];
  const candidate = attendees.find((a: Record<string, unknown>) => !a.is_self);
  
  if (!candidate) return {};
  
  return {
    attendeeName: candidate.display_name || candidate.name || 'Inconnu',
    attendeeHeadline: candidate.headline,
    attendeeProfileUrl: candidate.profile_url,
    attendeeProviderId: candidate.provider_id,
  };
}

// ─── AI Analysis (lightweight) ────────────────────────────────────
async function analyzeIntent(messages: Array<{ text: string; is_sender: boolean }>, candidateName: string): Promise<{ intent: string; confidence: number; summary: string } | null> {
  if (!ANTHROPIC_API_KEY) {
    console.error('[auto-analyze] ANTHROPIC_API_KEY not set');
    return null;
  }

  const lastCandidateMsg = [...messages].reverse().find(m => !m.is_sender);
  if (!lastCandidateMsg) return null;

  const conversationHistory = messages.slice(-10)
    .map(m => `${m.is_sender ? 'RECRUTEUR' : candidateName}: ${m.text}`)
    .join('\n');

  const prompt = `Analyse le dernier message du candidat dans cette conversation de recrutement LinkedIn.

CONVERSATION:
${conversationHistory}

DERNIER MESSAGE DU CANDIDAT:
"${lastCandidateMsg.text}"

Réponds UNIQUEMENT en JSON strict:
{
  "intent": "interested|not_interested|needs_info|wants_call|timing_issue|already_placed|neutral",
  "confidence": 0-100,
  "summary": "Résumé en 1 phrase"
}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 256,
        temperature: 0.1,
        system: "Tu es un expert en recrutement. Réponds UNIQUEMENT en JSON valide.",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      console.error('[auto-analyze] Anthropic error:', response.status);
      return null;
    }

    const data = await response.json();
    let content = data.content?.[0]?.text || "";
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    const result = JSON.parse(content);
    return {
      intent: result.intent || 'neutral',
      confidence: Math.min(100, Math.max(0, result.confidence || 0)),
      summary: result.summary || '',
    };
  } catch (err) {
    console.error('[auto-analyze] Analysis error:', err);
    return null;
  }
}

// ─── Main handler ─────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { chat_id, account_id, sender_id } = await req.json();
    
    if (!chat_id || !account_id) {
      throw new Error('chat_id and account_id are required');
    }

    console.log(`[auto-analyze] Processing chat: ${chat_id}, sender: ${sender_id}`);

    // 1. Fetch chat details and messages in parallel
    const [chatDetails, messages] = await Promise.all([
      fetchChatDetails(chat_id),
      fetchChatMessages(chat_id, account_id),
    ]);

    if (messages.length === 0) {
      console.log('[auto-analyze] No messages found');
      return new Response(JSON.stringify({ success: true, skipped: 'no_messages' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const candidateName = chatDetails.attendeeName || 'Candidat';
    const profileUrl = chatDetails.attendeeProfileUrl;

    // 2. Analyze intent with Claude (lightweight call)
    const analysis = await analyzeIntent(messages, candidateName);
    
    if (!analysis) {
      console.log('[auto-analyze] Analysis failed or no candidate message');
      return new Response(JSON.stringify({ success: true, skipped: 'analysis_failed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[auto-analyze] Intent: ${analysis.intent} (${analysis.confidence}%) - ${analysis.summary}`);

    // 3. Check if we should update (confidence threshold + mappable intent)
    const candidatEtat = INTENT_TO_CANDIDAT_ETAT[analysis.intent];
    const shortlistEtape = INTENT_TO_SHORTLIST_ETAPE[analysis.intent];
    
    if (!candidatEtat && !shortlistEtape || analysis.confidence < MIN_CONFIDENCE) {
      console.log(`[auto-analyze] No update: intent=${analysis.intent}, confidence=${analysis.confidence}`);
      return new Response(JSON.stringify({ 
        success: true, 
        skipped: 'low_confidence_or_neutral',
        analysis,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Update app DB (job_candidate_status)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const candidateId = sender_id || chatDetails.attendeeProviderId;
    
    if (candidateId) {
      const { data: statusRecords } = await supabase
        .from('job_candidate_status')
        .select('id, job_id, status')
        .or(`candidate_id.eq.${candidateId}${profileUrl ? `,linkedin_profile_url.eq.${profileUrl}` : ''}`)
        .in('status', ['messaged', 'shortlisted', 'scored'])
        .limit(10);

      if (statusRecords && statusRecords.length > 0) {
        const appStatus = analysis.intent === 'interested' || analysis.intent === 'wants_call' 
          ? 'interested' 
          : analysis.intent === 'not_interested' || analysis.intent === 'already_placed'
            ? 'not_interested'
            : 'replied';

        for (const record of statusRecords) {
          await supabase
            .from('job_candidate_status')
            .update({ 
              status: appStatus,
              recommendation: analysis.summary,
              updated_at: new Date().toISOString(),
            })
            .eq('id', record.id);
        }
        console.log(`[auto-analyze] Updated ${statusRecords.length} job_candidate_status records to "${appStatus}"`);
      }
    }

    // 5. Update Notion (Candidat "Etat" + Shortlist "Etape")
    if (NOTION_API_KEY) {
      const notionCandidateId = await findCandidateInNotion(candidateName, profileUrl);
      
      if (notionCandidateId) {
        // Update candidate "Etat" (select type) if mapped
        if (candidatEtat) {
          await updateNotionPage(notionCandidateId, {
            'Etat': { select: { name: candidatEtat } },
          });
          console.log(`[auto-analyze] Updated Notion candidate Etat → "${candidatEtat}"`);
        }

        // Update all related shortlists "Etape" (select type) if mapped
        if (shortlistEtape) {
          const shortlists = await findShortlistsForCandidate(notionCandidateId);
          for (const sl of shortlists) {
            await updateNotionPage(sl.id, {
              'Etape': { select: { name: shortlistEtape } },
            });
          }
          if (shortlists.length > 0) {
            console.log(`[auto-analyze] Updated ${shortlists.length} Notion shortlists Etape → "${shortlistEtape}"`);
          }
        }
      } else {
        console.log(`[auto-analyze] Candidate not found in Notion: ${candidateName}`);
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      analysis,
      updatedCandidatEtat: candidatEtat || null,
      updatedShortlistEtape: shortlistEtape || null,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[auto-analyze] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
