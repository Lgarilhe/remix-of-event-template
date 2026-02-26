import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // Build a compact representation for the AI
    const chatSummaries = chats.map((chat: any, i: number) => {
      const name = chat.name || chat.attendees?.[0]?.name || chat.attendees?.[0]?.display_name || 'Unknown';
      const lastMsg = chat.last_message?.text || chat.last_message?.text_content || '';
      const isSender = chat.last_message?.is_sender;
      const unread = chat.unread_count || chat.unread || 0;
      return `[${i}] "${name}" | last_msg: "${lastMsg.slice(0, 200)}" | sent_by_me: ${isSender} | unread: ${unread}`;
    }).join('\n');

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('Missing LOVABLE_API_KEY');

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `Tu es un assistant de recrutement. Analyse ces conversations LinkedIn et attribue une catégorie à chacune.

Catégories disponibles :
- "interested" : Le candidat a montré de l'intérêt (réponse positive, questions sur le poste, disponibilité mentionnée)
- "not_interested" : Le candidat a décliné ou refusé clairement
- "to_recontact" : La conversation est en cours mais nécessite un suivi (réponse vague, pas de conclusion)
- "no_response" : Le candidat n'a pas répondu (dernier message envoyé par le recruteur, pas de retour)
- "skip" : Impossible de déterminer (message trop court ou conversation de groupe non pertinente)

Règles :
- Si le dernier message a été envoyé par le recruteur (sent_by_me: true) ET qu'il y a 0 non-lus, c'est probablement "no_response" ou "to_recontact"
- Si le candidat a répondu positivement → "interested"
- Si le candidat a dit non → "not_interested"
- Sois précis, ne catégorise "interested" que si c'est clair

Réponds UNIQUEMENT avec un JSON array. Chaque élément : {"index": <number>, "category": "<category>"}
Pas de texte autour, juste le JSON array.`,
          },
          {
            role: 'user',
            content: `Voici ${chats.length} conversations à catégoriser :\n\n${chatSummaries}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI API error: ${response.status} - ${errorText}`);
    }

    const aiResult = await response.json();
    const content = aiResult.choices?.[0]?.message?.content || '';

    // Parse the JSON array from the response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('Could not parse AI response as JSON array');
    }

    const categories = JSON.parse(jsonMatch[0]) as Array<{ index: number; category: string }>;

    // Map back to chat IDs
    const results: Array<{ chat_id: string; account_id: string; category: string }> = [];
    for (const item of categories) {
      if (item.category === 'skip' || !chats[item.index]) continue;
      const chat = chats[item.index];
      results.push({
        chat_id: chat.id,
        account_id: chat.account_id,
        category: item.category,
      });
    }

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