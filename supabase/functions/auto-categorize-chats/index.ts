// Deno.serve used directly

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ChatCategory = 'interested' | 'not_interested' | 'to_recontact' | 'no_response';

const RETRYABLE_STATUS = new Set([500, 502, 503, 504, 529]);

function normalizeCategory(value: unknown): ChatCategory | null {
  if (typeof value !== 'string') return null;
  const n = value.trim().toLowerCase();
  if (n === 'interested') return 'interested';
  if (n === 'not_interested') return 'not_interested';
  if (n === 'to_recontact') return 'to_recontact';
  if (n === 'no_response') return 'no_response';
  return null;
}

/**
 * Fetch the last N messages for a chat from Unipile.
 */
async function fetchChatMessages(
  chatId: string,
  dsn: string,
  apiKey: string,
  limit = 6
): Promise<Array<{ text: string; is_sender: boolean }>> {
  try {
    const url = `https://${dsn}/api/v1/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}`;
    const res = await fetchWithTimeout(url, {
      headers: { 'X-API-KEY': apiKey, Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const items = Array.isArray(data) ? data : data?.items ?? data?.data ?? [];
    return items
      .map((m: any) => ({
        text: (m.text || m.text_content || '').trim().slice(0, 300),
        is_sender: Boolean(m.is_sender),
      }))
      .filter((m: any) => m.text.length > 0)
      .reverse(); // chronological order
  } catch {
    return [];
  }
}

async function callAiWithRetry(prompt: string, apiKey: string): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response | undefined;
    try {
      response = await fetchWithTimeout('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            {
              role: 'system',
              content: `Tu es un expert en recrutement. Tu analyses des conversations LinkedIn entre un recruteur (R) et un candidat (C).

Tu dois classer chaque conversation dans UNE catégorie basée sur l'ENSEMBLE de la conversation, pas juste le dernier message :

- "interested" : Le candidat montre de l'intérêt au fil de la conversation. Il pose des questions, accepte un call, donne ses dispos, dit oui. MÊME si le dernier message est du recruteur (qui répond au candidat intéressé), la conversation reste "interested".
- "not_interested" : Le candidat a clairement fermé la porte. Il dit non, décline, n'est pas en recherche. La conversation est terminée.
- "to_recontact" : Le candidat a répondu mais repousse à plus tard ("pas maintenant", "peut-être dans quelques mois", "recontactez-moi en X"). Il faudra relancer plus tard.
- "no_response" : Le recruteur a envoyé un/des message(s) mais le candidat n'a JAMAIS répondu. Aucun message du candidat dans la conversation.

RÈGLES IMPORTANTES :
1. Regarde la DYNAMIQUE GLOBALE, pas juste le dernier message
2. Si le candidat a répondu positivement et que le recruteur a enchaîné → "interested" (le fait que le recruteur ait parlé en dernier ne change rien)
3. "no_response" = UNIQUEMENT quand il n'y a AUCUNE réponse du candidat
4. "to_recontact" = le candidat a dit explicitement "pas maintenant" ou "plus tard" — PAS un fourre-tout
5. Si le candidat pose des questions = "interested"
6. Si conversation cordiale avec échange actif = "interested"

Réponds UNIQUEMENT avec un JSON array : [{"index": 0, "category": "..."}, ...]
Pas de texte avant ou après.`,
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: 4000,
        }),
      }, 30000);
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }

    if (response!.ok) return response!;

    if (!RETRYABLE_STATUS.has(response!.status) || attempt === 2) {
      const errorText = await response!.text();
      throw new Error(`AI API error: ${response!.status} - ${errorText}`);
    }

    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error('AI API unavailable after retries');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth: validate JWT ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check");
    const supabaseAuth = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await (supabaseAuth as any).auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { chats } = await req.json();

    if (!chats || !Array.isArray(chats) || chats.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'No chats provided' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('Missing LOVABLE_API_KEY');

    // Resolve Unipile credentials from org_integrations with env fallback
    let UNIPILE_API_KEY: string;
    let UNIPILE_DSN: string;
    try {
      const { resolveUnipileCredentials, resolveOrgIdFromUser } = await import("../_shared/resolve-org-credentials.ts");
      const orgId = await resolveOrgIdFromUser(user.id);
      const creds = await resolveUnipileCredentials(orgId);
      if (!creds) throw new Error('No Unipile credentials found');
      UNIPILE_API_KEY = creds.apiKey;
      UNIPILE_DSN = creds.dsn.replace(/^https?:\/\//, '');
    } catch (e) {
      const envKey = Deno.env.get('UNIPILE_API_KEY');
      const envDsn = Deno.env.get('UNIPILE_DSN');
      if (!envKey || !envDsn) throw new Error('Missing UNIPILE credentials');
      UNIPILE_API_KEY = envKey;
      UNIPILE_DSN = envDsn;
    }

    // Fetch last messages for each chat in parallel (batches of 10)
    const chatMessages: Array<Array<{ text: string; is_sender: boolean }>> = new Array(chats.length);
    const batchSize = 10;

    for (let i = 0; i < chats.length; i += batchSize) {
      const batch = chats.slice(i, i + batchSize);
      const promises = batch.map((chat: any, bIdx: number) =>
        fetchChatMessages(chat.id, UNIPILE_DSN, UNIPILE_API_KEY, 6).then((msgs) => {
          chatMessages[i + bIdx] = msgs;
        })
      );
      await Promise.all(promises);
    }

    // Build conversation summaries with full context
    const chatSummaries = chats
      .map((chat: any, i: number) => {
        const name =
          chat.name ||
          chat.attendees?.[0]?.name ||
          chat.attendees?.[0]?.display_name ||
          'Unknown';
        const msgs = chatMessages[i] || [];

        if (msgs.length === 0) {
          // Fallback to last_message from chat object
          const lastMsg = (chat.last_message?.text || chat.last_message?.text_content || '').trim();
          const isSender = Boolean(chat.last_message?.is_sender);
          if (!lastMsg) return `[${i}] "${name}" | Pas de messages`;
          return `[${i}] "${name}" | ${isSender ? 'R' : 'C'}: "${lastMsg.slice(0, 250)}"`;
        }

        const hasCandiateResponse = msgs.some((m) => !m.is_sender);
        const convoLines = msgs
          .map((m) => `${m.is_sender ? 'R' : 'C'}: "${m.text}"`)
          .join('\n  ');

        return `[${i}] "${name}" | candidat_a_repondu: ${hasCandiateResponse}\n  ${convoLines}`;
      })
      .join('\n\n');

    // Call AI
    const aiCategoriesByIndex = new Map<number, ChatCategory>();

    try {
      const aiResponse = await callAiWithRetry(
        `Voici ${chats.length} conversations à catégoriser :\n\n${chatSummaries}`,
        LOVABLE_API_KEY
      );
      const aiResult = await aiResponse.json();
      const content = aiResult?.choices?.[0]?.message?.content || '';
      const jsonMatch = content.match(/\[[\s\S]*\]/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Array<{ index: number; category: string }>;
        for (const item of parsed) {
          const cat = normalizeCategory(item?.category);
          if (typeof item?.index === 'number' && cat) {
            aiCategoriesByIndex.set(item.index, cat);
          }
        }
      }
    } catch (aiError) {
      console.error('AI categorization failed, using deterministic fallback:', aiError);
    }

    // Build results with fallback
    const results: Array<{ chat_id: string; account_id: string; category: ChatCategory }> = [];

    chats.forEach((chat: any, index: number) => {
      if (!chat?.id || !chat?.account_id) return;

      const msgs = chatMessages[index] || [];
      const hasCandidateResponse = msgs.some((m) => !m.is_sender);
      const aiCategory = aiCategoriesByIndex.get(index);

      // Sanity check: if candidate never responded, force no_response
      if (!hasCandidateResponse && msgs.length > 0) {
        results.push({ chat_id: chat.id, account_id: chat.account_id, category: 'no_response' });
        return;
      }

      // Sanity check: no_response impossible if candidate replied
      if (aiCategory && aiCategory !== 'no_response') {
        results.push({ chat_id: chat.id, account_id: chat.account_id, category: aiCategory });
        return;
      }

      if (aiCategory === 'no_response' && hasCandidateResponse) {
        // AI said no_response but candidate responded → fallback to to_recontact
        results.push({ chat_id: chat.id, account_id: chat.account_id, category: 'to_recontact' });
        return;
      }

      if (aiCategory) {
        results.push({ chat_id: chat.id, account_id: chat.account_id, category: aiCategory });
        return;
      }

      // No AI result — deterministic fallback
      results.push({
        chat_id: chat.id,
        account_id: chat.account_id,
        category: hasCandidateResponse ? 'to_recontact' : 'no_response',
      });
    });

    const distribution = results.reduce<Record<string, number>>((acc, r) => {
      acc[r.category] = (acc[r.category] || 0) + 1;
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
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
