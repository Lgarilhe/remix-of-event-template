// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth } from "../_shared/require-auth.ts";
import { callClaudeCompat, ClaudeCompatError } from "../_shared/call-claude.ts";

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

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
    const svc = createClient(Deno.env.get('SUPABASE_URL')!, (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!);
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

    if (!Deno.env.get("ANTHROPIC_API_KEY")) {
      return new Response(
        JSON.stringify({ error: "AI not configured" }),
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

    // Sélection du modèle avec override Haiku → Sonnet 4.5.
    //
    // Pourquoi : Haiku 4.5 est rapide (~10-15s) MAIS galère sur le
    // schema tool_use de la scorecard, en particulier ratingRubric qui
    // a 5 clés numériques requises ("1"-"5"). Résultat observé :
    // tool_use vide ou criteria=[]. Sonnet 4.5 prend ~15-20s mais
    // produit fiablement le tool call complet.
    //
    // Si l'user a EXPLICITEMENT choisi Haiku/Sonnet 4.6/Opus dans le
    // ModelPicker, on respecte. Sinon (default Haiku via routing tier
    // 'fast'), on bascule sur Sonnet 4.5 silencieusement.
    const resolvedModel = _aiParams.modelId;
    const modelToUse = resolvedModel === 'claude-haiku-4-5'
      ? 'claude-sonnet-4-5'  // Override pour fiabilité tool_use
      : (resolvedModel || 'claude-sonnet-4-5');
    console.log('[generate-scorecard] Model resolution:', {
      resolvedFromExtract: resolvedModel,
      finalModelToUse: modelToUse,
      overridden: resolvedModel === 'claude-haiku-4-5',
    });

    let aiResult;
    try {
      aiResult = await callClaudeCompat({
        model: modelToUse,
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
                        // 🔧 ratingRubric en ARRAY (pas object avec keys "1"-"5")
                        // Beaucoup plus fiable pour les modèles Anthropic en
                        // tool_use. On reconvertit en object {1,2,3,4,5} après
                        // la réponse côté serveur.
                        ratingRubric: {
                          type: "array",
                          items: { type: "string" },
                          minItems: 5,
                          maxItems: 5,
                          description: "Exactement 5 descriptions ordonnées : note 1 (très faible), 2 (faible), 3 (adéquat), 4 (solide), 5 (exceptionnel)"
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
        max_tokens: 4000,
        // Timeout augmenté à 50s (était 30s, qui timeoutait avec Sonnet
        // sur des prompts contenant tout le contexte mission + candidat).
        // 50s reste sous la limite Supabase edge function (60s) avec marge.
        timeoutMs: 50000,
        // Pas de retry sur timeout : si l'IA est lente, retry coûte 50s
        // de plus → préfère une erreur immédiate avec retry user-driven.
        maxRetries: 1,
      });
    } catch (e) {
      if (e instanceof ClaudeCompatError && e.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Détection timeout pour message plus clair côté user
      const errMsg = e instanceof Error ? e.message : String(e);
      if (errMsg.includes('abort') || errMsg.includes('timeout') || errMsg.includes('signal')) {
        console.error('[generate-scorecard] Timeout:', errMsg);
        return new Response(JSON.stringify({
          error: "L'IA a mis trop de temps à répondre. Réessaie dans quelques secondes."
        }), {
          status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("[generate-scorecard] Claude error:", e);
      throw e;
    }

    const _tokensIn = aiResult.usage.input_tokens;
    const _tokensOut = aiResult.usage.output_tokens;

    // 🔍 Diagnostic : log la shape de la réponse AI pour debug si tool_use vide
    const inputKeys = aiResult.toolCall?.input ? Object.keys(aiResult.toolCall.input) : null;
    const criteriaLength = Array.isArray((aiResult.toolCall?.input as any)?.criteria)
      ? (aiResult.toolCall.input as any).criteria.length
      : null;
    console.log('[generate-scorecard] AI response shape:', {
      model: aiResult.model,
      stopReason: aiResult.stop_reason,
      tokensIn: _tokensIn,
      tokensOut: _tokensOut,
      hasToolCall: !!aiResult.toolCall,
      toolCallName: aiResult.toolCall?.name,
      inputKeys,
      criteriaLength,
      contentPreview: aiResult.content?.slice(0, 200),
    });

    if (!aiResult.toolCall?.input) {
      console.error('[generate-scorecard] No tool call. Full content:', aiResult.content);
      return new Response(JSON.stringify({
        error: "L'IA n'a pas suivi le format demandé. Réessaie ou change de modèle.",
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const parsed = aiResult.toolCall.input;

    // Validation : criteria doit être un array non-vide
    if (!Array.isArray((parsed as any).criteria) || (parsed as any).criteria.length === 0) {
      console.error('[generate-scorecard] Tool call returned but criteria empty/invalid:', parsed);
      return new Response(JSON.stringify({
        error: "L'IA a renvoyé une scorecard vide. Réessaie ou ajoute du contexte au profil/poste.",
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Convertit ratingRubric : array (depuis l'IA) → object {1,2,3,4,5}
    // (format attendu par le frontend ScorecardTab.activeEval.criteria[].ratingRubric)
    // Pourquoi : on demande à l'IA un array (plus fiable en tool_use)
    // mais le frontend attend un object pour pouvoir faire ratingRubric[String(rating)].
    const normalizedCriteria = ((parsed as any).criteria as any[]).map((c) => {
      let rubricObj: Record<string, string> | undefined = undefined;
      if (Array.isArray(c.ratingRubric) && c.ratingRubric.length === 5) {
        rubricObj = {
          "1": c.ratingRubric[0],
          "2": c.ratingRubric[1],
          "3": c.ratingRubric[2],
          "4": c.ratingRubric[3],
          "5": c.ratingRubric[4],
        };
      } else if (c.ratingRubric && typeof c.ratingRubric === 'object' && !Array.isArray(c.ratingRubric)) {
        // Backward compat : si l'IA renvoie déjà un object, on garde
        rubricObj = c.ratingRubric;
      }
      return { ...c, ratingRubric: rubricObj };
    });

    // ── Fire-and-forget RAG ingestion (scorecard) ──
    const supabaseUrlRag = Deno.env.get('SUPABASE_URL');
    const serviceKeyRag = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
    if (supabaseUrlRag && serviceKeyRag && candidateProfile?.name) {
      // Resolve org from user profile
      const { data: userProfile } = await svc.from('profiles').select('active_organization_id').eq('user_id', userId).maybeSingle();
      const orgId = userProfile?.active_organization_id;
      const candidateId = candidateProfile.linkedin_id || candidateProfile.provider_id || candidateProfile.name;
      if (orgId && candidateId) {
        const criteriaLabels = (parsed.criteria || []).map((c: any) => c.label).join(', ');
        await fetch(`${supabaseUrlRag}/functions/v1/ingest-context`, {
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
        const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!);
        const orgId = userId ? await resolveOrgIdFromUser(userId, adminClient) : null;
        if (orgId && userId) {
          const { settleCredits } = await import("../_shared/settle-credits.ts");
          await settleCredits(adminClient, {
            organizationId: orgId, userId: userId!,
            aiAction: _aiParams.aiAction, modelId: _aiParams.modelId,
            tokensInput: _tokensIn, tokensOutput: _tokensOut,
            description: _aiParams.description,
          }).catch((e) => console.error("[generate-scorecard] settle error:", e));
        }
      } catch (e) { console.warn("[generate-scorecard] settle skipped:", e); }
    }

    return new Response(JSON.stringify({ success: true, criteria: normalizedCriteria }), {
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
