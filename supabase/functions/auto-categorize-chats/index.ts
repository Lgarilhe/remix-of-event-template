// Deno.serve used directly
import { callClaudeCompat } from "../_shared/call-claude.ts";
import { settleClaudeUsage } from "../_shared/settle-usage.ts";
import { assertCredits, creditGateResponse } from "../_shared/credit-guard.ts";
import { resolveOrgIdFromUser } from "../_shared/resolve-org-credentials.ts";
import { isUnipileConfigured, isUnipileError, userSafeMessage } from "../_shared/unipile/index.ts";
import { distinctAccountIds, gateChatAccounts } from "./chat-accounts.ts";
import { fetchChatMessages } from "./chat-messages.ts";

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

async function callAi(prompt: string, settle?: { userId?: string | null }): Promise<string> {
  const result = await callClaudeCompat({
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
    timeoutMs: 30000,
    maxRetries: 2,
  });
  await settleClaudeUsage({ userId: settle?.userId, aiAction: "auto_categorize_chats", usage: result.usage, modelId: result.model });
  return result.content;
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

    // Comptes des conversations : format courant et reliés à l'organisation
    // active de la personne. La clé du service est commune à toutes les
    // organisations : sans ce contrôle, un identifiant de conversation et de
    // compte d'une autre organisation serait lu avec la clé partagée. Refus net
    // avant toute lecture et tout débit.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!,
    );
    const failure = (status: number, error: string, errorCode: string) =>
      new Response(JSON.stringify({ success: false, error, error_code: errorCode }), {
        status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    const accountIds = distinctAccountIds(chats);
    if (accountIds.length > 0) {
      const refusal = await gateChatAccounts(admin as any, () => resolveOrgIdFromUser(user.id, admin as any), accountIds);
      if (refusal) return failure(refusal.status, refusal.error, refusal.error_code);
      // Clé de l'application absente : panne de configuration, dite sans nommer le service.
      if (!isUnipileConfigured()) {
        console.error('[auto-categorize-chats] provider key missing (UNIPILE_V2_API_KEY)');
        return failure(500, userSafeMessage('config'), 'NOT_CONFIGURED');
      }
    }

    // Refus avant l'appel, et avant d'aller chercher les messages : sans
    // crédits, rien de ce qui suit n'a de raison de tourner. Un appel en
    // service-role est déjà rejeté plus haut (getUser échoue), donc aucun
    // traitement automatique ne passe ici : pas d'exemption. Aucun champ model
    // n'est passé à callAi, mapModel route sur le modèle rapide.
    const gate = await assertCredits({
      userId: user.id,
      aiAction: 'auto_categorize_chats',
      modelId: 'claude-haiku-4-5',
    });
    if (!gate.ok) return creditGateResponse(gate, corsHeaders);

    // Fetch last messages for each chat in parallel (batches of 10)
    const chatMessages: Array<Array<{ text: string; is_sender: boolean }>> = new Array(chats.length);
    const batchSize = 10;

    for (let i = 0; i < chats.length; i += batchSize) {
      const batch = chats.slice(i, i + batchSize);
      const promises = batch.map((chat: any, bIdx: number) =>
        (chat?.id && chat?.account_id
          ? fetchChatMessages(chat.account_id, chat.id, 6)
          : Promise.resolve([])
        ).then((msgs) => {
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
          const lastMsg = (chat.last_message?.text || '').trim();
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
      const content = await callAi(
        `Voici ${chats.length} conversations à catégoriser :\n\n${chatSummaries}`,
        { userId: user.id }
      );
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
    // Message du service jamais relayé tel quel : texte neutre pour une erreur du client LinkedIn, phrase générique sinon.
    const publicMessage = isUnipileError(error) ? error.message : 'Une erreur est survenue. Veuillez réessayer.';
    return new Response(JSON.stringify({ success: false, error: publicMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
