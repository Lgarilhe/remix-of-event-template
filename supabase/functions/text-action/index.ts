// text-action — Edge function unifiée pour les 3 actions IA contextuelles
// du composer inbox :
//
//   - rewrite     : reformule un texte sélectionné (3 variantes : court / standard / élaboré)
//   - translate   : traduit un texte (FR ↔ EN auto-détecté)
//   - summarize   : résume une conversation (5-10 lignes max)
//
// Pourquoi 1 seule function : économise les cold starts + cohérence du
// settle-credits + permet de réutiliser le warmup.

import { callClaudeCompat } from "../_shared/call-claude.ts";
import { extractAIParams, settleCredits } from "../_shared/settle-credits.ts";
import { requireAuth, verifyOrgMembership } from "../_shared/require-auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Action = 'rewrite' | 'translate' | 'summarize';

interface ReqBody {
  action: Action;
  /** Texte source (pour rewrite/translate) ou conversation history (summarize) */
  text?: string;
  /** Pour translate : langue cible explicite (sinon auto-detect) */
  target_language?: 'fr' | 'en';
  /** Pour rewrite : nombre de variantes (default 3) */
  variants?: number;
  /** Pour rewrite : style/tonalité optionnelle */
  tone?: 'formal' | 'casual' | 'direct' | 'empathetic';
  organization_id?: string;
  warmup?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json() as ReqBody;

    // Warmup ping
    if (body?.warmup === true) {
      return new Response(
        JSON.stringify({ success: true, warmed: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Auth
    const auth = await requireAuth(req, corsHeaders);
    if (auth instanceof Response) return auth;
    const { userId } = auth;

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

    // Verify org membership si org_id fourni
    if (body.organization_id && userId) {
      const isMember = await verifyOrgMembership(adminClient, userId, body.organization_id);
      if (!isMember) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { action, text } = body;
    if (!action || !text || !text.trim()) {
      return new Response(
        JSON.stringify({ error: 'Missing action or text' }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build prompt selon l'action
    let systemPrompt = '';
    let userPrompt = '';

    if (action === 'rewrite') {
      const variants = Math.max(2, Math.min(5, body.variants || 3));
      const toneInstruction = body.tone ? toneToInstruction(body.tone) : '';
      systemPrompt = `Tu es un expert en rédaction de messages professionnels (LinkedIn, email).
Tu réponds UNIQUEMENT en JSON valide, sans markdown.

Tu reformules un message en proposant ${variants} variantes :
1. **Court** (~50% de la longueur originale) — version compacte, va à l'essentiel
2. **Standard** (~longueur originale) — version reformulée, plus naturelle
3. **Élaboré** (~150% de la longueur originale) — version étoffée avec plus de contexte

${toneInstruction}

Conserve la langue d'origine et l'intent du message.

Format : {"variants": [{"label": "Court", "text": "..."}, ...]}`;
      userPrompt = `Texte à reformuler :\n\n"${text.trim()}"\n\nRetourne le JSON.`;
    }
    else if (action === 'translate') {
      // Auto-detect simple : si > 50% de chars latin de base sans accents bizarres → EN, sinon FR
      const hasFrenchMarkers = /[éèêëàâäîïôöùûüçœæ]|(?:\b(?:le|la|les|un|une|des|de|du|et|est|que|qui|pour|avec|sur|dans|merci|bonjour)\b)/i.test(text);
      const targetLang = body.target_language || (hasFrenchMarkers ? 'en' : 'fr');
      const targetLangFull = targetLang === 'en' ? 'English' : 'French';

      systemPrompt = `Tu traduis des messages professionnels (LinkedIn, email) en conservant le ton, le style, et les nuances. Garde les emojis et la mise en forme.
Réponds UNIQUEMENT avec la traduction, sans préfixe, sans guillemets, sans explication.`;
      userPrompt = `Traduis ce message en ${targetLangFull} :\n\n${text.trim()}`;
    }
    else if (action === 'summarize') {
      systemPrompt = `Tu résumes des conversations de recrutement (LinkedIn, InMail) pour aider un recruteur à reprendre le fil rapidement.
Réponds UNIQUEMENT en JSON valide, sans markdown.

Format strict :
{
  "summary": "Résumé en 3-5 phrases (max 400 chars). Focus sur : intent du candidat, sujet discuté, prochaine action attendue.",
  "key_points": ["Point clé 1 (max 60 chars)", "Point clé 2", "Point clé 3"],
  "next_action": "Suggestion concrète de prochaine étape (max 80 chars)"
}`;
      userPrompt = `Résume cette conversation :\n\n${text.trim()}`;
    }
    else {
      return new Response(
        JSON.stringify({ error: 'Invalid action' }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call Claude
    const aiAction = action === 'summarize' ? 'summarize_conversation' : action === 'rewrite' ? 'rewrite_text' : 'translate_text';
    const _aiParams = extractAIParams(body, aiAction);

    const result = await callClaudeCompat({
      max_tokens: action === 'summarize' ? 1024 : 1500,
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      timeoutMs: 30000,
    });

    // Settle credits (best-effort)
    if (body.organization_id) {
      try {
        await settleCredits(adminClient, {
          organizationId: body.organization_id,
          userId,
          aiAction,
          modelId: result.model || 'claude-haiku-4-5',
          tokensInput: result.usage.input_tokens,
          tokensOutput: result.usage.output_tokens,
          description: `Action IA: ${action}`,
        });
      } catch (e) {
        console.warn(`[text-action] settle credits failed:`, e);
      }
    }

    // Parse response selon l'action
    let payload: Record<string, unknown> = { success: true };
    if (action === 'translate') {
      payload.translated = result.content.trim();
    } else {
      // rewrite + summarize : JSON expected
      try {
        const cleaned = result.content.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
        const parsed = JSON.parse(cleaned);
        payload = { success: true, ...parsed };
      } catch (e) {
        console.error(`[text-action] JSON parse failed for ${action}:`, e, result.content);
        return new Response(
          JSON.stringify({ error: 'AI response parsing failed', raw: result.content.slice(0, 500) }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify(payload),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error('[text-action] error:', e);
    return new Response(
      JSON.stringify({ error: e.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function toneToInstruction(tone: string): string {
  switch (tone) {
    case 'formal': return 'TON: Formel et professionnel (vouvoiement, structure claire).';
    case 'casual': return 'TON: Décontracté et friendly (tutoiement, style conversationnel).';
    case 'direct': return 'TON: Direct et efficace (phrases courtes, droit au but).';
    case 'empathetic': return 'TON: Empathique et chaleureux (intérêt humain).';
    default: return '';
  }
}
