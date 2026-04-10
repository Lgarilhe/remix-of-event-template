// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth } from "../_shared/require-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function sanitizeString(val: unknown, maxLen = 5000): string {
  if (typeof val !== 'string') return '';
  return val.slice(0, maxLen).replace(/<script[^>]*>.*?<\/script>/gi, '');
}

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
    const { data: allowed } = await svc.rpc('check_rate_limit', { p_user_id: userId, p_action: 'detect_fraud', p_max_requests: 30, p_window_seconds: 60 });
    if (allowed === false) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429, headers: corsHeaders });
    }

    const { profileData, candidateName, headline } = await req.json();
    
    if (!profileData) {
      return new Response(JSON.stringify({ anomalies: [], score: 100 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Build profile summary for analysis
    const experiences = profileData.experiences || profileData.positions || [];
    const education = profileData.education || [];
    
    const profileSummary = JSON.stringify({
      name: candidateName || profileData.name,
      headline: headline || profileData.headline,
      experiences: experiences.slice(0, 15).map((exp: any) => ({
        title: exp.title,
        company: exp.company || exp.companyName,
        startDate: exp.startDate || exp.start_date,
        endDate: exp.endDate || exp.end_date,
        duration: exp.duration,
        description: exp.description?.substring(0, 200),
      })),
      education: education.slice(0, 5).map((edu: any) => ({
        school: edu.school || edu.schoolName,
        degree: edu.degree,
        field: edu.field || edu.fieldOfStudy,
        startYear: edu.startYear || edu.start_year,
        endYear: edu.endYear || edu.end_year,
      })),
      skills: (profileData.skills || []).slice(0, 20),
      summary: profileData.summary?.substring(0, 500),
    }, null, 2);

    const systemPrompt = `Tu es un expert en vérification de profils professionnels. Analyse le profil LinkedIn fourni et détecte les anomalies et incohérences potentielles.

Catégories d'anomalies à chercher :
1. TIMELINE : dates qui se chevauchent, trous inexpliqués > 1 an, progressions de carrière anormalement rapides
2. INFLATION : titres disproportionnés par rapport à l'expérience (ex: "VP" après 2 ans), compétences suspectes
3. EDUCATION : diplômes incohérents avec le parcours, écoles non reconnues
4. COHERENCE : changements de domaine radicaux sans explication, descriptions vagues ou génériques

Réponds UNIQUEMENT avec un JSON structuré, pas de texte autour.`;

    let response: Response;
    try {
      response = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Analyse ce profil :\n${profileSummary}` },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "report_anomalies",
                description: "Report detected anomalies in a professional profile",
                parameters: {
                  type: "object",
                  properties: {
                    trust_score: {
                      type: "number",
                      description: "Score de confiance global de 0 à 100. 100 = aucun problème, 0 = fraude évidente"
                    },
                    anomalies: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          category: { type: "string", enum: ["TIMELINE", "INFLATION", "EDUCATION", "COHERENCE"] },
                          severity: { type: "string", enum: ["low", "medium", "high"] },
                          description: { type: "string", description: "Description courte de l'anomalie en français" },
                          detail: { type: "string", description: "Explication détaillée" }
                        },
                        required: ["category", "severity", "description"],
                        additionalProperties: false
                      }
                    }
                  },
                  required: ["trust_score", "anomalies"],
                  additionalProperties: false
                }
              }
            }
          ],
          tool_choice: { type: "function", function: { name: "report_anomalies" } },
        }),
      }, 30000);
    } catch (e) {
      console.error("AI gateway timeout:", e);
      throw e;
    }

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    
    if (toolCall?.function?.arguments) {
      try {
        const analysis = JSON.parse(toolCall.function.arguments);
        return new Response(JSON.stringify(analysis), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        console.error("detect-profile-fraud JSON parse error:", e, "Raw:", toolCall.function.arguments?.slice(0, 200));
      }
    }

    return new Response(JSON.stringify({ anomalies: [], trust_score: 100 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("fraud-detection error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
