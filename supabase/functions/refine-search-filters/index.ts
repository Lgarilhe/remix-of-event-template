// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth } from "../_shared/require-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

interface RefineRequest {
  currentFilters: Record<string, unknown>;
  internalFilters?: Record<string, unknown>;
  totalResults: number | null;
  resultCount: number;
  jobTitle: string;
  jobLocation?: string;
  direction: 'expand' | 'narrow' | 'auto';
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ===== AUTH CHECK =====
    let auth;
    try {
      auth = await requireAuth(req, corsHeaders);
    } catch (authResponse) {
      return authResponse as Response;
    }
    const userId = auth.userId;

    // Rate limit: 20 req/min
    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: allowed } = await svc.rpc('check_rate_limit', { p_user_id: userId, p_action: 'refine_search_filters', p_max_requests: 20, p_window_seconds: 60 });
    if (allowed === false) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const _body = await req.json();
    const { currentFilters, internalFilters, totalResults, resultCount, jobTitle, jobLocation, direction } =
      _body as RefineRequest;
    let _aiParams: { aiAction: string; modelId: string; description: string | null } = {
      aiAction: "refine_search", modelId: "claude-sonnet-4-6", description: null,
    };
    try {
      const { extractAIParams } = await import("../_shared/settle-credits.ts");
      _aiParams = extractAIParams(_body, "refine_search");
    } catch (e) {
      console.warn("[refine-search-filters] Failed to load settle-credits:", e);
    }
    // Resolve Anthropic model ID from user selection
    let resolvedModel = "claude-sonnet-4-6";
    try {
      const { getAnthropicModelId } = await import("../_shared/ai-config.ts");
      const candidate = getAnthropicModelId(_aiParams.modelId);
      if (candidate && candidate.startsWith("claude-")) resolvedModel = candidate;
    } catch (e) {
      console.warn("[refine-search-filters] Failed to resolve model, using default:", e);
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    const effectiveTotal = totalResults ?? resultCount;
    const autoDirection = effectiveTotal < 50 ? 'expand' : effectiveTotal > 500 ? 'narrow' : 'expand';
    const finalDirection = direction === 'auto' ? autoDirection : direction;

    const systemPrompt = `Tu es un expert en recrutement LinkedIn. On te donne les filtres actuels d'une recherche LinkedIn et le nombre de résultats obtenus. Tu dois ajuster les filtres pour ${finalDirection === 'expand' ? 'ÉLARGIR la recherche (plus de résultats)' : 'AFFINER la recherche (moins de résultats, plus ciblés)'}.

IMPORTANT - DEUX TYPES DE FILTRES D'EXPÉRIENCE:
1. "years_of_experience" (API LinkedIn): filtre côté LinkedIn, moins fiable
2. "calculated_experience_min" / "calculated_experience_max": filtre côté client basé sur l'année du diplôme, PLUS FIABLE et PRIORITAIRE
   - Ces valeurs sont en ANNÉES. Ex: min=3, max=8 signifie 3-8 ans d'expérience calculée depuis le diplôme
   - TOUJOURS ajuster calculated_experience_min et calculated_experience_max en PRIORITÉ plutôt que years_of_experience

FILTRES DISPONIBLES À AJUSTER:
- "keywords": chaîne booléenne (AND/OR/NOT) — levier principal
- "location_within_area": rayon en miles (25, 50, 75, 100)
- "role": tableau d'objets {keywords, priority, scope} pour les titres de poste
- "calculated_experience_min" / "calculated_experience_max": expérience calculée (années)
- "degree": tableau d'objets {id, name, priority} pour le niveau d'études. IDs: 1=Bac, 2=Licence, 3=Master, 4=MBA, 5=Doctorat, 6=Ingénieur, 7=Professionnel
  - Pour ÉLARGIR: supprimer le filtre degree ou ajouter des niveaux inférieurs
  - Pour AFFINER: ajouter un filtre degree MUST_HAVE sur Master/Ingénieur/Doctorat
- "skills_keywords": tableau de strings pour les compétences LinkedIn (ex: ["Python", "Machine Learning", "TensorFlow"])
  - Pour ÉLARGIR: réduire la liste ou supprimer les compétences trop spécifiques
  - Pour AFFINER: ajouter des compétences techniques précises liées au poste

RÈGLES D'ÉLARGISSEMENT (quand trop peu de résultats):
1. Simplifier les keywords: réduire le nombre de groupes AND, garder 1-2 max
2. Augmenter le rayon géographique (location_within_area): 25→50→75→100
3. Passer le role de MUST_HAVE à CAN_HAVE ou supprimer des titres trop spécifiques
4. Élargir calculated_experience_min/max: -2 ans sur min, +3 ans sur max
5. Supprimer ou alléger le filtre degree
6. Réduire la liste skills_keywords
7. NE PAS toucher au compte ni au mode API

RÈGLES D'AFFINAGE (quand trop de résultats):
1. Ajouter des groupes AND aux keywords
2. Réduire le rayon géographique
3. Resserrer calculated_experience_min/max
4. Passer des filtres de CAN_HAVE à MUST_HAVE
5. Ajouter des exclusions NOT dans les keywords
6. Ajouter un filtre degree (ex: Master minimum)
7. Ajouter des compétences techniques précises dans skills_keywords

PRIORITÉ DES AJUSTEMENTS (du plus impactant au moins):
1. Keywords (AND/OR structure)
2. Location radius
3. Role priority
4. Expérience calculée (calculated_experience_min / calculated_experience_max)
5. Niveau d'études (degree)
6. Compétences (skills_keywords)
7. Autres filtres

Retourne UNIQUEMENT un JSON avec:
- adjustments: tableau d'objets décrivant chaque changement. Chaque objet a:
  - field: string (nom du champ exact parmi ceux listés ci-dessus)
  - value: la nouvelle valeur pour ce champ
  - reason: string (explication courte du pourquoi en français)
- summary: string (résumé en 1 phrase de ce qui a changé, en français)
- expectedImpact: string ("beaucoup_plus" | "plus" | "similaire" | "moins" | "beaucoup_moins")

JSON uniquement, sans markdown.`;

    const userMessage = `Poste: ${jobTitle}
${jobLocation ? `Localisation du poste: ${jobLocation}` : ''}
Nombre de résultats actuels: ${effectiveTotal}
Direction souhaitée: ${finalDirection === 'expand' ? 'ÉLARGIR (plus de résultats)' : 'AFFINER (moins de résultats)'}

Filtres internes (expérience calculée):
${internalFilters ? JSON.stringify(internalFilters, null, 2) : 'Non fournis'}

Filtres API envoyés à LinkedIn:
${JSON.stringify(currentFilters, null, 2)}`;

    console.log(`[refine-search-filters] Direction: ${finalDirection}, Total: ${effectiveTotal}, Job: ${jobTitle}`);

    const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: resolvedModel,
        max_tokens: 1024,
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[refine-search-filters] AI error:", response.status, errText?.slice(0, 300));
      throw new Error(`AI error: ${response.status}`);
    }

    const aiResult = await response.json();
    const _tokensIn = aiResult.usage?.input_tokens || 0;
    const _tokensOut = aiResult.usage?.output_tokens || 0;
    const content = aiResult.content?.[0]?.text || "";

    let parsed;
    try {
      const cleanJson = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleanJson);
    } catch (e) {
      console.error("[refine-search-filters] Failed to parse:", content?.slice(0, 500));
      throw new Error("Failed to parse AI response");
    }

    console.log("[refine-search-filters] Adjustments:", JSON.stringify(parsed, null, 2));

    // Settle credits (fire-and-forget)
    if (_tokensIn + _tokensOut > 0) {
      try {
        const { resolveOrgIdFromUser } = await import("../_shared/resolve-org-credentials.ts");
        const orgId = userId ? await resolveOrgIdFromUser(userId, svc as any) : null;
        if (orgId && userId) {
          // Verify user still belongs to the resolved org before billing credits
          const { verifyOrgMembership } = await import("../_shared/require-auth.ts");
          const isMember = await verifyOrgMembership(svc as any, userId, orgId);
          if (!isMember) {
            console.warn("[refine-search-filters] settle skipped: user is not a member of org", orgId);
          } else {
            const { settleCredits } = await import("../_shared/settle-credits.ts");
            await settleCredits(svc as any, {
              organizationId: orgId, userId,
              aiAction: _aiParams.aiAction, modelId: _aiParams.modelId,
              tokensInput: _tokensIn, tokensOutput: _tokensOut,
              description: _aiParams.description,
            }).catch((e) => console.error("[refine-search-filters] settle error:", e));
          }
        }
      } catch (e) { console.warn("[refine-search-filters] settle skipped:", e); }
    }

    return new Response(
      JSON.stringify({ success: true, ...parsed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[refine-search-filters] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
