// generate-client-competitors
// ─────────────────────────────────────────────────────────────────────────────
// Génère une liste de concurrents directs pour un client donné via Claude Haiku.
// Utilisé dans le brief mission pour pré-remplir client_competitors. L'utilisateur
// curate ensuite (coche/décoche) avant persistance en DB.
//
// Auth : JWT user authentifié (resolve via _shared/require-auth).
// Crédits : settle via _shared/settle-credits comme tous les calls AI.
// ─────────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { callClaudeCompat } from "../_shared/call-claude.ts";
import { settleCredits } from "../_shared/settle-credits.ts";
import { requireAuth } from "../_shared/require-auth.ts";
import { getAnthropicModelId } from "../_shared/ai-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Competitor {
  name: string;
  reason: string;
  country?: string;
  domain?: string;
  relation_kind: 'direct' | 'adjacent' | 'inspirational';
}

const SYSTEM_PROMPT = `Tu es un expert de l'écosystème tech, produit et SaaS B2B/B2C, en France et à l'international. Tu connais les concurrents directs des entreprises tech reconnues, les acteurs adjacents (même secteur, offre légèrement différente) et les boîtes "inspirational" (parfois plus grosses ou pionnières).

Quand on te demande les concurrents d'une entreprise, tu réponds avec UN OBJET JSON :
{
  "competitors": [
    {
      "name": "Nom officiel exact",
      "reason": "1 phrase max — pourquoi c'est un concurrent",
      "country": "FR" | "US" | "UK" | etc.,
      "domain": "domain.com" si tu le sais,
      "relation_kind": "direct" | "adjacent" | "inspirational"
    }
  ]
}

Règles :
- 6 à 10 concurrents max, priorité aux DIRECTS (4-6) puis adjacents (2-3) puis inspirational (0-2).
- Privilégie les boîtes RÉELLEMENT existantes et reconnaissables sur LinkedIn.
- N'invente JAMAIS un nom. Si tu ne connais pas assez le secteur, retourne moins d'entrées plutôt que d'inventer.
- Pour les SaaS B2B FR, n'oublie pas les concurrents EU/US (souvent pertinents).
- Pour les marketplaces / consumer apps, mixe FR + EU + global selon le marché.
- Pas de markdown, pas de prose autour, JUSTE le JSON.`;

interface RequestBody {
  client_company_name: string;
  client_sector?: string;
  client_country?: string;
  client_description?: string;
  organization_id?: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = await requireAuth(req, corsHeaders);
    if (auth instanceof Response) return auth;

    const body = (await req.json()) as RequestBody;
    if (!body.client_company_name?.trim()) {
      return new Response(JSON.stringify({ error: 'client_company_name requis' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!;
    const admin = createClient(supabaseUrl, serviceKey);

    const userPrompt = [
      `Donne-moi les concurrents directs et adjacents de "${body.client_company_name}".`,
      body.client_sector ? `Secteur : ${body.client_sector}.` : '',
      body.client_country ? `Pays : ${body.client_country}.` : '',
      body.client_description ? `Contexte : ${body.client_description.slice(0, 400)}.` : '',
      'Réponds avec le JSON décrit dans le system prompt.',
    ].filter(Boolean).join('\n');

    const modelId = getAnthropicModelId('claude-haiku-4-5');

    const result = await callClaudeCompat({
      model: modelId,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
      antiAiStyle: 'none',
    });

    let parsed: { competitors?: Competitor[] } = {};
    try {
      parsed = JSON.parse(result.content);
    } catch (err) {
      console.error('[generate-client-competitors] JSON parse error:', err, result.content.slice(0, 300));
      return new Response(JSON.stringify({ error: 'Réponse IA non parsable' }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const competitors: Competitor[] = (parsed.competitors || [])
      .filter((c) => c && typeof c.name === 'string' && c.name.trim().length > 0)
      .slice(0, 12)
      .map((c) => ({
        name: String(c.name).trim().slice(0, 120),
        reason: String(c.reason || '').trim().slice(0, 250),
        country: c.country ? String(c.country).trim().slice(0, 4).toUpperCase() : undefined,
        domain: c.domain ? String(c.domain).trim().toLowerCase().slice(0, 80) : undefined,
        relation_kind: ['direct', 'adjacent', 'inspirational'].includes(c.relation_kind as string)
          ? c.relation_kind
          : 'direct',
      }));

    // Settle credits (best-effort, ne casse pas la réponse en cas d'erreur)
    if (body.organization_id && auth.userId) {
      try {
        await settleCredits(admin, {
          organizationId: body.organization_id,
          userId: auth.userId,
          aiAction: 'generate_client_competitors' as any,
          modelId,
          tokensInput: result.usage.input_tokens,
          tokensOutput: result.usage.output_tokens,
          description: `Concurrents pour "${body.client_company_name}"`,
        });
      } catch (err) {
        console.warn('[generate-client-competitors] settleCredits failed:', err);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      competitors,
      tokens_used: result.usage,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[generate-client-competitors] Error:', err);
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : 'Erreur interne',
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
