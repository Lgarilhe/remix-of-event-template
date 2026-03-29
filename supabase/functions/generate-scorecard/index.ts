// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth } from "../_shared/require-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
    const { data: allowed } = await svc.rpc('check_rate_limit', { p_user_id: userId, p_action: 'generate_scorecard', p_max_requests: 20, p_window_seconds: 60 });
    if (allowed === false) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429, headers: corsHeaders });
    }

    const body = await req.json();
    const { candidateProfile, jobContext, scoringDetails, interviewStage } = body;
    let _aiParams: { aiAction: string; modelId: string; description: string | null } = {
      aiAction: "generate_scorecard", modelId: "claude-sonnet-4-6", description: null,
    };
    try {
      const { extractAIParams } = await import("../_shared/settle-credits.ts");
      _aiParams = extractAIParams(body, "generate_scorecard");
    } catch (e) {
      console.warn("[generate-scorecard] Failed to load settle-credits:", e);
    }

    if (!candidateProfile || !jobContext) {
      return new Response(
        JSON.stringify({ error: "candidateProfile and jobContext are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI gateway not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stageContext = interviewStage
      ? `\n\nCONTEXTE D'ÉTAPE: Cette scorecard est pour un entretien de type "${interviewStage}". Adapte les critères en conséquence:
- "Phone Screen": critères rapides de qualification (motivation, disponibilité, prétentions, fit basique)
- "Technique": critères techniques approfondis, exercices pratiques, architecture, problem-solving
- "Culture Fit": valeurs, travail d'équipe, communication, alignement avec la culture d'entreprise
- "Final": critères de décision finale, leadership, vision long terme, négociation`
      : '';

    const systemPrompt = `Tu es un expert en recrutement tech/digital. Tu dois générer une grille d'évaluation (scorecard) sur mesure pour un entretien de qualification.

RÈGLES:
- Génère exactement 6 à 8 critères d'évaluation
- Chaque critère doit être SPÉCIFIQUE au poste et au profil, pas générique
- Utilise les compétences réelles du poste et du candidat pour formuler les critères
- Inclus un mix de : compétences techniques, soft skills, adéquation culturelle, motivation
- Pour chaque critère, fournis une description courte qui guide l'évaluateur sur quoi observer
- Ordonne les critères du plus critique au moins critique
- Pour chaque critère, génère 2-3 questions d'entretien spécifiques à poser
- Pour chaque critère, génère une rubrique de notation avec la définition de chaque niveau (1 à 5)
- Pour chaque critère, identifie 1-2 signaux d'alerte (red flags) à surveiller${stageContext}

FORMAT DE SORTIE (JSON strict via tool call)

weight: 1 = nice-to-have, 2 = important, 3 = critique/éliminatoire`;

    const userPrompt = `CONTEXTE DU POSTE:
- Titre: ${jobContext.title || 'Non spécifié'}
- Client: ${jobContext.client || 'Non spécifié'}
- Description: ${jobContext.description || 'Non disponible'}
- Critères/Requirements: ${jobContext.requirements || 'Non disponible'}
- Compétences recherchées: ${(jobContext.skills || []).join(', ') || 'Non spécifié'}

PROFIL DU CANDIDAT:
- Nom: ${candidateProfile.name || 'Non spécifié'}
- Headline: ${candidateProfile.headline || 'Non spécifié'}
- Résumé: ${candidateProfile.summary || 'Non disponible'}
- Compétences: ${(candidateProfile.skills || []).join(', ') || 'Non spécifié'}
- Expériences: ${(candidateProfile.experiences || []).map((e: any) => `${e.title} chez ${e.company}`).join(' | ') || 'Non disponible'}
- Formation: ${(candidateProfile.education || []).map((e: any) => `${e.school} - ${e.degree}`).join(' | ') || 'Non disponible'}
- Années d'expérience: ${candidateProfile.yearsOfExperience || 'Non spécifié'}

${scoringDetails ? `SCORING IA EXISTANT:
- Score: ${scoringDetails.match_score || 'N/A'}/100
- Forces: ${(scoringDetails.matching_skills || []).join(', ')}
- Lacunes potentielles: ${(scoringDetails.missing_skills || []).join(', ')}
- Recommandation: ${scoringDetails.recommendation || 'N/A'}
- Résumé: ${scoringDetails.summary || 'N/A'}` : ''}

${interviewStage ? `TYPE D'ENTRETIEN: ${interviewStage}` : ''}

Génère la scorecard d'évaluation sur mesure.`;

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
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "generate_scorecard",
                description: "Generate a custom evaluation scorecard with criteria",
                parameters: {
                  type: "object",
                  properties: {
                    criteria: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string", description: "Unique identifier for the criterion" },
                          label: { type: "string", description: "Short label for the criterion" },
                          description: { type: "string", description: "Detailed description of what to evaluate" },
                          category: { type: "string", enum: ["technical", "soft_skill", "culture_fit", "motivation"], description: "Category of the criterion" },
                          weight: { type: "number", description: "Weight 1 to 3" },
                          suggestedQuestions: {
                            type: "array",
                            items: { type: "string" },
                            description: "2-3 specific interview questions to ask for this criterion"
                          },
                          ratingRubric: {
                            type: "object",
                            properties: {
                              "1": { type: "string", description: "Description for rating 1 (very weak)" },
                              "2": { type: "string", description: "Description for rating 2 (weak)" },
                              "3": { type: "string", description: "Description for rating 3 (adequate)" },
                              "4": { type: "string", description: "Description for rating 4 (strong)" },
                              "5": { type: "string", description: "Description for rating 5 (exceptional)" },
                            },
                            description: "Rating rubric with descriptions for each level 1-5"
                          },
                          redFlags: {
                            type: "array",
                            items: { type: "string" },
                            description: "1-2 warning signs to watch for during the interview"
                          },
                        },
                        required: ["id", "label", "description", "category", "weight", "suggestedQuestions", "ratingRubric", "redFlags"],
                      },
                    },
                  },
                  required: ["criteria"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "generate_scorecard" } },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const _tokensIn = data.usage?.prompt_tokens ?? data.usage?.input_tokens ?? 0;
    const _tokensOut = data.usage?.completion_tokens ?? data.usage?.output_tokens ?? 0;
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall?.function?.arguments) {
      throw new Error("No tool call response from AI");
    }

    const parsed = (() => {
      try {
        return JSON.parse(toolCall.function.arguments);
      } catch (e) {
        console.error("generate-scorecard JSON parse error:", e, "Raw:", toolCall.function.arguments?.slice(0, 200));
        throw new Error("Failed to parse AI scorecard response");
      }
    })();

    // ── Fire-and-forget RAG ingestion (scorecard) ──
    const supabaseUrlRag = Deno.env.get('SUPABASE_URL');
    const serviceKeyRag = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (supabaseUrlRag && serviceKeyRag && candidateProfile?.name) {
      // Resolve org from user profile
      const { data: userProfile } = await svc.from('profiles').select('active_organization_id').eq('user_id', userId).maybeSingle();
      const orgId = userProfile?.active_organization_id;
      const candidateId = candidateProfile.linkedin_id || candidateProfile.provider_id || candidateProfile.name;
      if (orgId && candidateId) {
        const criteriaLabels = (parsed.criteria || []).map((c: any) => c.label).join(', ');
        fetch(`${supabaseUrlRag}/functions/v1/ingest-context`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${serviceKeyRag}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            organization_id: orgId,
            entity_type: 'candidate',
            entity_id: candidateId,
            chunks: [{
              chunk_type: 'evaluation',
              content: `Scorecard générée pour ${candidateProfile.name} — ${jobContext.title || 'poste'}. Critères: ${criteriaLabels}`,
              source_table: 'generate_scorecard',
              metadata: { job_title: jobContext.title, criteria_count: parsed.criteria?.length, date: new Date().toISOString() },
            }],
          }),
        }).catch(err => console.warn('[generate-scorecard] RAG ingest failed (non-blocking):', err));
      }
    }

    // Settle AI credits (fire-and-forget)
    if (_tokensIn + _tokensOut > 0) {
      try {
        const { resolveOrgIdFromUser } = await import("../_shared/resolve-org-credentials.ts");
        const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const orgId = await resolveOrgIdFromUser(userId, adminClient);
        if (orgId) {
          const { settleCredits } = await import("../_shared/settle-credits.ts");
          settleCredits(adminClient, {
            organizationId: orgId, userId,
            aiAction: _aiParams.aiAction, modelId: _aiParams.modelId,
            tokensInput: _tokensIn, tokensOutput: _tokensOut,
            description: _aiParams.description,
          }).catch((e) => console.warn("[generate-scorecard] settle error:", e));
        }
      } catch (e) { console.warn("[generate-scorecard] settle skipped:", e); }
    }

    return new Response(JSON.stringify({ success: true, criteria: parsed.criteria }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("generate-scorecard error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
