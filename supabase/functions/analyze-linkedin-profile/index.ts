// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth } from "../_shared/require-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function sanitize(val: unknown, maxLen = 500): string {
  if (typeof val !== 'string') return '';
  return val.slice(0, maxLen).replace(/<[^>]*>/g, '').trim();
}

function sanitizeArray(val: unknown, maxItems = 30, maxLen = 100): string[] {
  if (!Array.isArray(val)) return [];
  return val.slice(0, maxItems).map(v => sanitize(v, maxLen)).filter(Boolean);
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

    // Rate limit: 30 req/min
    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: allowed } = await svc.rpc('check_rate_limit', { p_user_id: userId, p_action: 'analyze_linkedin_profile', p_max_requests: 30, p_window_seconds: 60 });
    if (allowed === false) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { profile } = await req.json();
    
    if (!profile || typeof profile !== 'object') {
      return new Response(JSON.stringify({ error: 'Profile data is required' }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Sanitize inputs
    const safeName = sanitize(profile.name, 100);
    const safeHeadline = sanitize(profile.headline, 200);
    const safeCurrentRole = sanitize(profile.currentRole, 200);
    const safeCurrentCompany = sanitize(profile.currentCompany, 200);
    const safeLocation = sanitize(profile.location, 100);
    const safeSkills = sanitizeArray(profile.skills);
    const safePastPositions = sanitizeArray(profile.pastPositions, 10, 200);
    const safeEducation = sanitizeArray(profile.education, 5, 200);

    const prompt = `Analyse ce profil LinkedIn pour un recruteur tech:

Nom: ${safeName}
Titre: ${safeHeadline || 'Non spécifié'}
Poste actuel: ${safeCurrentRole || 'Non spécifié'} chez ${safeCurrentCompany || 'Non spécifié'}
Localisation: ${safeLocation || 'Non spécifié'}
Compétences: ${safeSkills.join(', ') || 'Non spécifiées'}
Expériences: ${safePastPositions.join('; ') || 'Non spécifiées'}
Formation: ${safeEducation.join('; ') || 'Non spécifiée'}

Réponds UNIQUEMENT en JSON valide avec cette structure exacte:
{
  "summary": "Une phrase résumant le profil (max 15 mots)",
  "strengths": ["Point fort 1", "Point fort 2", "Point fort 3"],
  "concerns": ["Point à vérifier 1", "Point à vérifier 2"],
  "fit_score": 75,
  "recommendation": "Phrase courte: action recommandée pour le recruteur"
}

Règles:
- strengths: 2-4 points forts OBJECTIFS basés sur les données
- concerns: 1-3 points à vérifier ou potentielles faiblesses
- fit_score: score de 0-100 basé sur l'attractivité du profil pour un recruteur tech
- Sois factuel, pas de flatterie. Base-toi uniquement sur les données fournies.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let response: Response;
    try {
      response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: "Tu es un expert en recrutement tech. Tu analyses des profils LinkedIn et fournis des insights structurés. Tu réponds TOUJOURS en JSON valide, sans markdown, sans code blocks." },
            { role: "user", content: prompt }
          ],
          max_tokens: 400,
          temperature: 0.3,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requêtes atteinte, réessayez plus tard." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Crédits IA épuisés." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || "";
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    try {
      const analysis = JSON.parse(content);
      return new Response(JSON.stringify({ analysis }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } catch {
      console.error("JSON parse error, Content:", content?.slice(0, 200));
      return new Response(JSON.stringify({
        error: "Failed to parse AI response",
        analysis: { summary: content?.slice(0, 100) || "Analyse indisponible", strengths: ["Analyse non structurée disponible"], concerns: ["Veuillez réessayer"], fit_score: 50, recommendation: "Voir le profil complet" }
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch (error) {
    console.error("Error analyzing profile:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
