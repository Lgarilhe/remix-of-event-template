// nl-filter-edit — édite les filtres de recherche EXISTANTS à partir d'une
// instruction en langage naturel (« ajoute anglais courant, retire Lyon »).
//
// Différence avec generate-search-filters : ici l'IA reçoit les filtres
// COURANTS et l'instruction, et renvoie un DIFF strict { set, remove, note }.
// C'est ce qui rend possible les retraits et les micro-ajustements — une
// régénération complète depuis le brief noie l'instruction (bug UX constaté).
//
// Conventions CLAUDE.md : requireAuth, check_rate_limit, fetchWithTimeout,
// getAnthropicModelId, settleCredits après l'appel IA.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth } from "../_shared/require-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface CurrentFilters {
  keywords?: string;
  role?: Array<{ keywords: string; priority: string; scope?: string }>;
  location?: string[];
  location_radius_miles?: number | null;
  experience_min?: number | null;
  experience_max?: number | null;
  tenure_at_role_min?: number | null;
  tenure_at_role_max?: number | null;
  skills?: string[];
  company_keywords?: Array<{ keywords: string; priority: string; scope?: string }>;
  industry?: string[];
  company_headcount?: string[];
  school?: string[];
  seniority?: string[];
  profile_language?: string[];
  open_to_work?: boolean | null;
  contacted_filter?: string | null;
  contacted_days?: number | null;
}

const SYSTEM_PROMPT = `Tu es un éditeur de filtres de recherche LinkedIn. On te donne les FILTRES ACTUELS d'une recherche de candidats et une INSTRUCTION utilisateur en langage naturel. Tu renvoies un DIFF à appliquer — jamais une régénération complète.

RÈGLES :
1. Ne touche QUE ce que l'instruction demande. Si elle dit « ajoute anglais courant », tu ajoutes la langue "en" — tu ne modifies ni les postes, ni les skills, ni rien d'autre.
2. Les retraits vont dans "remove", les ajouts/modifications dans "set".
3. Pour retirer, recopie EXACTEMENT la valeur telle qu'elle apparaît dans les filtres actuels.
4. Langues du profil : codes LinkedIn ("fr", "en", "de", "es", "it", "pt", "nl", "ar", "zh").
5. Séniorité : échelle LinkedIn "1" (stagiaire) à "10" (dirigeant) — senior ≈ ["5","6"], manager ≈ ["6","7"], directeur ≈ ["8","9"].
6. Expérience : years min/max en années (nombres). Ancienneté DANS LE POSTE ACTUEL : tenure_at_role_min/max (ex « fraîchement promu » ≈ max 1 ; « stable » ≈ min 3).
7. Titres de poste (role) : regroupe les synonymes en UN item avec OR (ex "Account Manager OR AM OR Key Account Manager"), priority "MUST_HAVE"|"CAN_HAVE"|"DOESNT_HAVE", scope "CURRENT"|"PAST"|"CURRENT_OR_PAST" (« poste actuel uniquement » → CURRENT).
8. Exclusions d'entreprises : company_keywords avec priority "DOESNT_HAVE". « Ex-employés de X » → scope "PAST_NOT_CURRENT".
9. Taille d'entreprise : codes tranches company_headcount — A=1, B=2-10, C=11-50, D=51-200, E=201-500, F=501-1000, G=1001-5000, H=5001-10000, I=10001+ (startup ≈ ["B","C","D"], grand groupe ≈ ["G","H","I"]).
10. Secteurs : industry_keywords = noms de secteurs LinkedIn en anglais (ex "Software Development", "Financial Services"). Écoles : school_keywords = noms d'établissements.
11. Rayon géographique : location_within_area en miles, valeurs autorisées 10/25/35/50/75/100 (≈16/40/56/80/120/160 km). Pour retirer le rayon : remove.radius_clear.
12. Candidats déjà contactés : contacted_filter "without_message" (exclure les contactés) ou "with_message" (seulement les contactés) + contacted_days (30/90/180/365, null = depuis toujours). Pour ne plus filtrer : remove.contacted_clear.
13. Si l'instruction est hors périmètre (ex : « trie par score ») ou incompréhensible, renvoie set/remove vides et explique dans "note".
14. "note" : une phrase courte en français résumant ce qui a été fait (ex : « Anglais courant ajouté, Lyon retiré »).

FORMAT DE RÉPONSE — UNIQUEMENT ce JSON, sans markdown :
{
  "set": {
    "keywords": string | null,
    "role": [{ "keywords": string, "priority": "MUST_HAVE"|"CAN_HAVE"|"DOESNT_HAVE", "scope": "CURRENT"|"PAST"|"CURRENT_OR_PAST" }] | null,
    "seniority": string[] | null,
    "years_of_experience_min": number | null,
    "years_of_experience_max": number | null,
    "tenure_at_role_min": number | null,
    "tenure_at_role_max": number | null,
    "skills_keywords": string[] | null,
    "location_keywords": string[] | null,
    "location_within_area": number | null,
    "company_keywords": [{ "keywords": string, "priority": "MUST_HAVE"|"CAN_HAVE"|"DOESNT_HAVE", "scope": "CURRENT"|"PAST"|"CURRENT_OR_PAST"|"PAST_NOT_CURRENT" }] | null,
    "industry_keywords": string[] | null,
    "company_headcount": string[] | null,
    "school_keywords": string[] | null,
    "profile_language": string[] | null,
    "open_to_work": boolean | null,
    "contacted_filter": "without_message" | "with_message" | null,
    "contacted_days": number | null
  },
  "remove": {
    "role_keywords": string[],
    "location_names": string[],
    "skills": string[],
    "company_keywords": string[],
    "industry_names": string[],
    "school_names": string[],
    "company_headcount": string[],
    "seniority": string[],
    "profile_language": string[],
    "keywords_clear": boolean,
    "tenure_at_role_clear": boolean,
    "radius_clear": boolean,
    "contacted_clear": boolean
  },
  "note": string
}
Les champs "set" à null (ou absents) = inchangés. "set" = AJOUTS (les listes s'ajoutent à l'existant, sauf keywords qui remplace).`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let auth;
    try {
      auth = await requireAuth(req, corsHeaders);
    } catch (authResponse) {
      return authResponse as Response;
    }

    const _body = await req.json();
    const { instruction, current_filters } = _body as { instruction?: string; current_filters?: CurrentFilters };
    const userId = auth.userId;
    if (!userId) return json(400, { error: "Utilisateur requis" });
    if (!instruction || typeof instruction !== "string" || !instruction.trim()) {
      return json(400, { error: "Instruction requise" });
    }

    const svc = createClient(Deno.env.get("SUPABASE_URL")!, (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!);
    const { data: allowed } = await svc.rpc("check_rate_limit", { p_user_id: userId, p_action: "nl_filter_edit", p_max_requests: 30, p_window_seconds: 60 });
    if (allowed === false) {
      return json(429, { error: "Trop de requêtes, réessayez dans un instant" });
    }

    let _aiParams: { aiAction: string; modelId: string; description: string | null } = {
      aiAction: "filter_generation", modelId: "claude-haiku-4-5-20251001", description: null,
    };
    try {
      const { extractAIParams } = await import("../_shared/settle-credits.ts");
      _aiParams = extractAIParams(_body, "filter_generation");
    } catch (e) {
      console.warn("[nl-filter-edit] settle-credits load failed:", e);
    }
    // Tâche courte et structurée → Haiku par défaut (rapide, suffisant pour un diff)
    let resolvedModel = "claude-haiku-4-5-20251001";
    try {
      const { getAnthropicModelId } = await import("../_shared/ai-config.ts");
      const candidate = getAnthropicModelId(_aiParams.modelId);
      if (candidate && candidate.startsWith("claude-")) resolvedModel = candidate;
    } catch (e) {
      console.warn("[nl-filter-edit] model resolve failed:", e);
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

    const userContent = `FILTRES ACTUELS :\n${JSON.stringify(current_filters ?? {}, null, 2)}\n\nINSTRUCTION : ${instruction.trim().slice(0, 500)}`;

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
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userContent }],
      }),
    }, 30000);

    if (!response.ok) {
      const errText = await response.text();
      console.error("[nl-filter-edit] AI error:", response.status, errText?.slice(0, 300));
      if (response.status === 429) return json(429, { error: "Trop de requêtes, réessayez dans quelques secondes" });
      if (response.status === 529 || response.status === 503) return json(503, { error: "Service IA temporairement surchargé, réessayez dans 30 secondes" });
      return json(500, { error: "Erreur du service IA" });
    }

    const aiResult = await response.json();
    const content = aiResult.content?.[0]?.text || "";
    let ops;
    try {
      const cleanJson = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      ops = JSON.parse(cleanJson);
    } catch (e) {
      console.error("[nl-filter-edit] parse failed:", content?.slice(0, 400));
      return json(200, { success: false, error: "Réponse IA illisible, réessayez en reformulant." });
    }

    // Settle credits (fire-and-forget, pattern refine-search-filters)
    try {
      const { resolveOrgIdFromUser } = await import("../_shared/resolve-org-credentials.ts");
      const orgId = await resolveOrgIdFromUser(svc, userId);
      if (orgId) {
        const { verifyOrgMembership } = await import("../_shared/require-auth.ts");
        if (await verifyOrgMembership(svc, userId, orgId)) {
          const { settleCredits } = await import("../_shared/settle-credits.ts");
          settleCredits(svc, {
            organizationId: orgId,
            userId,
            aiAction: _aiParams.aiAction,
            modelId: resolvedModel,
            tokensInput: aiResult.usage?.input_tokens || 0,
            tokensOutput: aiResult.usage?.output_tokens || 0,
            description: _aiParams.description || `Affinage filtres : ${instruction.trim().slice(0, 80)}`,
          }).catch((e: unknown) => console.error("[nl-filter-edit] settle error:", e));
        }
      }
    } catch (e) {
      console.warn("[nl-filter-edit] settle skipped:", e);
    }

    return json(200, { success: true, ops });
  } catch (error) {
    console.error("[nl-filter-edit] Error:", error);
    return json(500, { error: error instanceof Error ? error.message : "Erreur interne" });
  }
});
