import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ChatCategory = 'interested' | 'not_interested' | 'to_recontact' | 'no_response';

const RETRYABLE_STATUS = new Set([500, 502, 503, 504, 529]);

const positivePatterns = [
  /\b(interested|i\s*am\s*interested|sounds good|great|yes|oui|why not|available|disponible|let'?s talk|call me|go ahead|partant)\b/i,
  /\b(merci.+intéress|ça m['’]intéresse|je suis intéress|ça marche)\b/i,
];

const negativePatterns = [
  /\b(not interested|not\s+for\s+me|no thanks|stop|unsubscribe|remove me|pass)\b/i,
  /\b(pas intéress|non merci|désol[ée].*pas|je passe|ce n['’]est pas pour moi|pas dispo)\b/i,
];

const followupPatterns = [
  /\b(later|follow up|next week|next month|remind me|recontact)\b/i,
  /\b(plus tard|recontact|relance|semaine prochaine|mois prochain|pas maintenant)\b/i,
];

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCategory(value: unknown): ChatCategory | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'interested') return 'interested';
  if (normalized === 'not_interested') return 'not_interested';
  if (normalized === 'to_recontact') return 'to_recontact';
  if (normalized === 'no_response') return 'no_response';
  return null;
}

function classifyDeterministic(chat: any): ChatCategory {
  const lastMsg = normalizeText(chat?.last_message?.text || chat?.last_message?.text_content || '');
  const isSender = Boolean(chat?.last_message?.is_sender);
  const unread = Number(chat?.unread_count ?? chat?.unread ?? 0) || 0;

  if (lastMsg) {
    if (negativePatterns.some((rx) => rx.test(lastMsg))) return 'not_interested';
    if (positivePatterns.some((rx) => rx.test(lastMsg))) return 'interested';
    if (followupPatterns.some((rx) => rx.test(lastMsg))) return 'to_recontact';
  }

  if (!isSender) {
    return 'to_recontact';
  }

  if (isSender && unread === 0) {
    return 'no_response';
  }

  return 'to_recontact';
}

async function callAiWithRetry(chatSummaries: string, chatsCount: number, apiKey: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `Tu es un assistant de recrutement. Analyse ces conversations LinkedIn et attribue une catégorie à chacune.

Catégories autorisées (obligatoires) :
- "interested"
- "not_interested"
- "to_recontact"
- "no_response"

Règles strictes :
- Tu dois renvoyer exactement une catégorie pour chaque index
- Ne renvoie jamais "skip"
- Si sent_by_me: false, la catégorie "no_response" est interdite
- Si réponse clairement positive → interested
- Si refus clair → not_interested
- Si échange en cours / relance nécessaire → to_recontact
- Si dernier message envoyé par le recruteur et aucun retour visible → no_response

Réponds UNIQUEMENT avec un JSON array. Chaque élément : {"index": <number>, "category": "<category>"}`,
          },
          {
            role: 'user',
            content: `Voici ${chatsCount} conversations à catégoriser :\n\n${chatSummaries}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 4000,
      }),
    });

    if (response.ok) return response;

    if (!RETRYABLE_STATUS.has(response.status) || attempt === 2) {
      const errorText = await response.text();
      throw new Error(`AI API error: ${response.status} - ${errorText}`);
    }

    const delay = 2000 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw new Error('AI API unavailable after retries');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { chats } = await req.json();

    if (!chats || !Array.isArray(chats) || chats.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'No chats provided' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('Missing LOVABLE_API_KEY');

    const chatSummaries = chats.map((chat: any, i: number) => {
      const name = chat.name || chat.attendees?.[0]?.name || chat.attendees?.[0]?.display_name || 'Unknown';
      const lastMsg = normalizeText(chat.last_message?.text || chat.last_message?.text_content || '');
      const isSender = Boolean(chat.last_message?.is_sender);
      const unread = Number(chat.unread_count ?? chat.unread ?? 0) || 0;
      return `[${i}] "${name}" | last_msg: "${lastMsg.slice(0, 220)}" | sent_by_me: ${isSender} | unread: ${unread}`;
    }).join('\n');

    const aiCategoriesByIndex = new Map<number, ChatCategory>();

    try {
      const aiResponse = await callAiWithRetry(chatSummaries, chats.length, LOVABLE_API_KEY);
      const aiResult = await aiResponse.json();
      const content = aiResult?.choices?.[0]?.message?.content || '';
      const jsonMatch = content.match(/\[[\s\S]*\]/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Array<{ index: number; category: string }>;
        parsed.forEach((item) => {
          const category = normalizeCategory(item?.category);
          if (typeof item?.index === 'number' && category) {
            aiCategoriesByIndex.set(item.index, category);
          }
        });
      }
    } catch (aiError) {
      console.error('AI categorization failed, deterministic fallback only:', aiError);
    }

    const results: Array<{ chat_id: string; account_id: string; category: ChatCategory }> = [];

    chats.forEach((chat: any, index: number) => {
      if (!chat?.id || !chat?.account_id) return;

      const fallback = classifyDeterministic(chat);
      const aiCategory = aiCategoriesByIndex.get(index);
      const candidateSentLastMessage = chat?.last_message?.is_sender === false;

      const finalCategory: ChatCategory =
        aiCategory && !(aiCategory === 'no_response' && candidateSentLastMessage)
          ? aiCategory
          : fallback;

      results.push({
        chat_id: chat.id,
        account_id: chat.account_id,
        category: finalCategory,
      });
    });

    const distribution = results.reduce<Record<string, number>>((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + 1;
      return acc;
    }, {});

    console.log('Auto-categorize summary:', {
      input_chats: chats.length,
      ai_items: aiCategoriesByIndex.size,
      output_results: results.length,
      distribution,
    });

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in auto-categorize-chats:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});