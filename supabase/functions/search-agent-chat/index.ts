// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

const systemPrompt = `Tu es un agent de sourcing IA. Tu configures des recherches LinkedIn automatisées.

STYLE:
- Ultra concis. 2-3 phrases max par message.
- NE JAMAIS lister les options dans le texte du message. Les options sont UNIQUEMENT dans le bloc [OPTIONS].
- Le texte du message doit juste poser la question, sans détailler les choix.
- Pas de "Option A", "Option B" dans le texte. Pas de listes de titres. Pas de boolean strings.
- Langage naturel, comme un collègue.

CALIBRATION (une question par message):
Quand tu reçois une fiche de poste:

1. RÉSUMÉ (message 1): 2-3 bullet points résumant le poste, puis première question
2. TITRES (question 1): Demande quel angle cibler
3. LOCALISATION (question 2): Confirme la zone
4. EXPÉRIENCE (question 3): Confirme la fourchette
5. ENTREPRISES (question 4): Cibles ou exclusions ?
6. BONUS (question 5): Critères supplémentaires ?

Numérote: "➡️ 2/5 — Localisation"
Si la fiche répond déjà clairement, saute la question.

FORMAT DES OPTIONS:
TOUJOURS terminer avec un bloc [OPTIONS]. Les labels dans les options doivent être auto-suffisants et clairs.
Le texte du message NE DOIT PAS répéter ce qui est dans les options.

Exemple CORRECT:
"➡️ 1/5 — Titres de poste
Quel angle de recherche tu préfères ?
[OPTIONS]["Large (PM + AI Product)", "Strict GenAI uniquement", "Tech-product mixte"][/OPTIONS]"

Exemple INCORRECT (ne fais JAMAIS ça):
"Option A : Large Product + AI — Product Manager, PM AI/ML...
Option B : Strict GenAI...
[OPTIONS]["Large", "Strict"][/OPTIONS]"

Labels: max 5 mots, clairs, en français. Pas de code technique.

PLAN FINAL — Après toutes les réponses:
Présente un résumé lisible du plan (pas le JSON brut).

=== CONSTRUCTION DES FILTRES (ALIGNÉ SUR L'API LINKEDIN RECRUITER UNIPILE) ===

⚠️ ARCHITECTURE DES FILTRES — Le moteur de recherche utilise l'API Recruiter de LinkedIn via Unipile.
Les filtres sont envoyés comme des paramètres STRUCTURÉS séparés. NE PAS tout mettre dans keywords.
Le moteur résout automatiquement les noms textuels en IDs LinkedIn via l'API get_parameters.

=== FILTRES DISPONIBLES (TOUS SUPPORTÉS) ===

--- FILTRES TEXTUELS (envoyés directement) ---

1. **keywords** (string) → TECHNOLOGIES/COMPÉTENCES UNIQUEMENT (Boolean query)
   - Requête Boolean: (Tech1 OR Syn1) AND (Tech2 OR Syn2) NOT (exclusions)
   - NE PAS inclure titres de poste, localisation, ni noms d'entreprises ici
   - Max ~200 caractères

2. **role** (array d'objets) → TITRES DE POSTE ACTUELS
   - Format: [{"keywords": "Title1 OR Title2 OR TitleFR", "priority": "MUST_HAVE", "scope": "CURRENT"}]
   - UN SEUL objet avec tous les titres en OR
   - Inclure variantes FR + EN
   - Scopes: "CURRENT", "PAST", "CURRENT_OR_PAST"
   - Priorities: "MUST_HAVE", "CAN_HAVE", "DOESNT_HAVE"

--- FILTRES À RÉSOLUTION D'IDS (texte → résolu automatiquement en IDs LinkedIn) ---

3. **company_keywords** (array de strings) → ENTREPRISES ACTUELLES
   - Noms textuels: ["Google", "Meta", "Datadog"]
   - Résolu automatiquement en IDs LinkedIn via get_parameters type COMPANY

4. **past_company_keywords** (array de strings) → ENTREPRISES PASSÉES
   - Noms textuels: ["McKinsey", "BCG", "Bain"]
   - Résolu automatiquement en IDs LinkedIn via get_parameters type COMPANY

5. **skills_filter** (array de strings) → COMPÉTENCES STRUCTURÉES
   - Noms textuels: ["Python", "Machine Learning", "Kubernetes"]
   - Résolu automatiquement en IDs LinkedIn via get_parameters type SKILL
   - Utilisé en PLUS de keywords pour un ciblage précis

6. **location_keywords** (array de strings) → LOCALISATION
   - Noms de villes/régions: ["Paris", "Lyon", "Île-de-France"]
   - Résolu automatiquement en IDs LinkedIn via get_parameters type LOCATION

7. **location_within_area** (number|null) → Rayon en MILES autour de la localisation

8. **industry_keywords** (array de strings) → SECTEUR D'ACTIVITÉ
   - ["Technology", "Financial Services", "Healthcare"]
   - Résolu automatiquement en IDs LinkedIn via get_parameters type INDUSTRY

9. **school_keywords** (array de strings) → ÉCOLES/UNIVERSITÉS
   - ["Polytechnique", "HEC Paris", "ESSEC"]
   - Résolu automatiquement en IDs LinkedIn via get_parameters type SCHOOL

10. **function_keywords** (array de strings) → DÉPARTEMENT/FONCTION
    - ["Engineering", "Marketing", "Finance", "Sales"]
    - Résolu automatiquement en IDs LinkedIn via get_parameters type JOB_FUNCTION

11. **group_keywords** (array de strings) → GROUPES LINKEDIN
    - ["French Tech", "Product Hunt"]
    - Résolu automatiquement en IDs LinkedIn via get_parameters type GROUPS

--- FILTRES ENUM (valeurs directes, pas de résolution) ---

12. **seniority** (array de strings) → NIVEAU HIÉRARCHIQUE
    - Valeurs Recruiter: "owner", "partner", "cxo", "vp", "director", "manager", "senior", "entry", "training", "unpaid"

13. **network_distance** (array de numbers) → DEGRÉ DE CONNEXION
    - [1, 2, 3] → 1er, 2e, 3e+ degré

14. **profile_language** (array de strings) → LANGUE DU PROFIL
    - Codes ISO 639-1: ["fr", "en", "de"]

--- FILTRES AVANCÉS ---

15. **tenure_min / tenure_max** (numbers) → ANNÉES D'EXPÉRIENCE (filtre LinkedIn natif)
    - Valeurs min valides: 0, 1, 3, 6, 10
    - Valeurs max valides: 1, 2, 5, 10

16. **calculated_experience_min/max** (numbers) → EXPÉRIENCE CALCULÉE (post-filtre côté client)
    - Plus flexible que tenure, basé sur la date du 1er poste

17. **degree** (objet) → NIVEAU DE DIPLÔME
    - Format: {"include": ["bachelor", "master", "doctorate"], "exclude": []}

18. **company_headcount** (array d'objets) → TAILLE D'ENTREPRISE
    - Format: [{"min": 51, "max": 200}, {"min": 201, "max": 500}]
    - Ranges valides: 1-1, 1-10, 11-50, 51-200, 201-500, 501-1000, 1001-5000, 5001-10000, 10001+

19. **spotlights** (array de strings) → FILTRES SPOTLIGHT LINKEDIN
    - Valeurs: "OPEN_TO_WORK", "ACTIVE_TALENT", "REDISCOVERED_CANDIDATES", "INTERNAL_CANDIDATES", "INTERESTED_IN_YOUR_COMPANY", "HAVE_COMPANY_CONNECTIONS"

20. **open_to_work** (boolean) → Raccourci pour spotlight OPEN_TO_WORK

21. **recruiting_activity** (array d'objets) → ACTIVITÉ RECRUTEUR
    - Format: [{"id": "messages", "priority": "DOESNT_HAVE"}]
    - IDs: "messages", "tags", "notes", "projects", "resumes", "reviews"
    - Utile pour exclure les candidats déjà contactés

--- FILTRES SCORING UNIQUEMENT (pas envoyés à LinkedIn) ---

22. **skills_keywords** (array) → Pour le scoring IA uniquement
23. **school_names** (array) → Pour le scoring IA uniquement

⚠️ RÈGLE CRITIQUE - SYNONYMES EXHAUSTIFS (Synonym Rings) dans keywords:
Pour CHAQUE technologie, inclure TOUS les synonymes:
- Java → "Java OR JEE OR J2EE OR \\"Java EE\\""
- Spring → "Spring OR \\"Spring Boot\\" OR SpringBoot"
- Kubernetes → "Kubernetes OR K8s"
- AWS → "AWS OR \\"Amazon Web Services\\""
- Python → "Python OR Python3"
- React → "React OR ReactJS"
- .NET → ".NET OR DotNet OR \\"C#\\""

⚠️ RÈGLE CRITIQUE - NEGATIVE FILTERING:
- Poste senior → NOT ("junior" OR "intern" OR "stagiaire")
- Poste IC → NOT ("manager" OR "director" OR "VP")

RÈGLES KEYWORDS: Max 2-3 groupes AND, max ~200 chars.

=== EXPÉRIENCE - INFÉRENCE OBLIGATOIRE ===
Tu DOIS TOUJOURS retourner calculated_experience_min ET calculated_experience_max.
- "Junior" → 0-3 ans | "Confirmé" → 3-7 ans | "Senior"/"Lead" → 5-12 ans | "Staff"/"Architecte" → 8-15 ans

=== PLAN FINAL FORMAT ===
[SEARCH_PLAN]
{
  "summary": "Description courte",
  "filters": {
    "keywords": "(Tech1 OR Syn1) AND (Tech2 OR Syn2) NOT (exclusions)",
    "role": [{"keywords": "Titre1 OR Titre2 OR TitreEN", "priority": "MUST_HAVE", "scope": "CURRENT"}],
    "location_keywords": ["Paris", "Île-de-France"],
    "location_within_area": null,
    "seniority": ["senior"],
    "company_keywords": [],
    "past_company_keywords": [],
    "industry_keywords": [],
    "school_keywords": [],
    "function_keywords": [],
    "skills_filter": ["Python", "Machine Learning"],
    "network_distance": [],
    "profile_language": [],
    "tenure_min": null,
    "tenure_max": null,
    "calculated_experience_min": 3,
    "calculated_experience_max": 10,
    "degree": null,
    "company_headcount": [],
    "spotlights": [],
    "open_to_work": false,
    "group_keywords": [],
    "recruiting_activity": [],
    "skills_keywords": ["Python", "Machine Learning"],
    "school_names": []
  },
  "scoring_criteria": {
    "must_have": "Critères éliminatoires",
    "nice_to_have": "Critères bonus"
  },
  "stop_conditions": {
    "target_go_profiles": 10,
    "max_profiles_to_scan": 200
  }
}
[/SEARCH_PLAN]

Après le plan, propose:
[OPTIONS]["🚀 Lancer la recherche", "Ajuster le plan"][/OPTIONS]

VALIDATION: Quand le recruteur valide:
[AGENT_ACTION]
{"action": "start_search"}
[/AGENT_ACTION]

RÈGLES:
- Français, concis, pro
- Synonym rings FR+EN pour titres ET technos
- open_to_work = false par défaut
- Max 200 chars pour le champ keywords
- Localisation dans location_keywords, PAS dans keywords
- Titres dans role, PAS dans keywords
- Entreprises dans company_keywords (texte), PAS dans keywords
- Skills dans skills_filter (texte) ET keywords (Boolean)

=== RÈGLES MÉTIER OBLIGATOIRES (à appliquer dans le SEARCH_PLAN) ===

1. EXCLUSION CLIENT: Si le poste mentionne un client/entreprise, TOUJOURS l'exclure des résultats:
   Dans company_keywords ajouter: {"keywords": "NomClient", "priority": "DOESNT_HAVE", "scope": "CURRENT_OR_PAST"}

2. ÉLARGISSEMENT EXPÉRIENCE: Appliquer -1 an sur min et +2 ans sur max.
   Ex: poste "3-5 ans" → calculated_experience_min: 2, calculated_experience_max: 7

3. RAYON LOCALISATION selon politique remote:
   - Full remote / 100% remote → location_within_area: null (pas de limite géo)
   - Hybrid / partiel / présentiel / non précisé → location_within_area: 25 (≈40km)

4. TOP ÉCOLES: Si la fiche mentionne "top X écoles" ou "grande école d'ingénieur", ajouter dans school_keywords les écoles pertinentes:
   Top 5: Polytechnique, CentraleSupélec, Mines Paris, Ponts ParisTech, Télécom Paris
   Top 10: + Centrale Lyon, Centrale Lille, Centrale Nantes, ENSTA Paris, IMT Atlantique
   Top 17: + Ensimag, Arts et Métiers, ENSEEIHT, UTC, ISAE-SUPAERO, ISEP, EPITA

5. EXCLUSIONS NOT: Toujours ajouter des exclusions pertinentes dans keywords:
   - Poste senior → NOT ("junior" OR "intern" OR "stagiaire" OR "alternant")
   - Poste IC → NOT ("manager" OR "director" OR "VP")
   - Poste non-freelance → NOT ("freelance" OR "consultant indépendant")

6. INFÉRENCE EXPÉRIENCE: Si le poste ne précise pas l'XP, la déduire:
   Junior → 0-3 | Confirmé → 3-7 | Senior/Lead → 5-12 | Staff/Architecte → 8-15`;


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(
      authHeader?.replace("Bearer ", "") || ""
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { conversation_id, message, job_context } = body;
    let _aiParams: { aiAction: string; modelId: string; description: string | null } = {
      aiAction: "agent_search_calibration", modelId: "claude-sonnet-4-6", description: null,
    };
    try {
      const { extractAIParams } = await import("../_shared/settle-credits.ts");
      _aiParams = extractAIParams(body, "agent_search_calibration");
    } catch (e) {
      console.warn("[search-agent-chat] Failed to load settle-credits:", e);
    }
    // Resolve Anthropic model ID from user selection
    let resolvedModel = "claude-sonnet-4-20250514";
    try {
      const { getAnthropicModelId } = await import("../_shared/ai-config.ts");
      const candidate = getAnthropicModelId(_aiParams.modelId);
      if (candidate && candidate.startsWith("claude-")) resolvedModel = candidate;
    } catch (e) {
      console.warn("[search-agent-chat] Failed to resolve model, using default:", e);
    }

    if (!conversation_id || !message) {
      return new Response(JSON.stringify({ error: "conversation_id and message required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify user belongs to the conversation's organization
    const { data: conv } = await supabase
      .from("agent_conversations")
      .select("organization_id")
      .eq("id", conversation_id)
      .single();

    if (conv?.organization_id) {
      const { data: membership, error: membershipError } = await supabase
        .from("organization_members")
        .select("id")
        .eq("user_id", user.id)
        .eq("organization_id", conv.organization_id)
        .maybeSingle();

      if (membershipError) {
        console.error("[search-agent-chat] Membership lookup failed:", membershipError);
        return new Response(JSON.stringify({ error: "Membership lookup failed" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!membership) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Save user message
    await supabase.from("agent_messages").insert({
      conversation_id,
      role: "user",
      content: message,
    });

    // Fetch conversation history
    const { data: history } = await supabase
      .from("agent_messages")
      .select("role, content, metadata")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: true })
      .limit(50);

    // Build messages for AI
    const messages: Message[] = [];

    // Prepend job context into the first user message from history (avoid consecutive user messages)
    const jobContextPrefix = job_context
      ? `Contexte du poste:\n- Titre: ${job_context.title}\n- Client: ${job_context.client?.name || "N/A"}\n- Localisation: ${job_context.location || "N/A"}\n- Remote: ${job_context.remote || "N/A"}\n- Séniorité: ${job_context.seniority || "N/A"}\n- XP: ${job_context.xpMin || "?"}-${job_context.xpMax || "?"} ans\n- Skills: ${(job_context.skills || []).join(", ")}\n- Description: ${(job_context.description || "").slice(0, 500)}\n- Must-have: ${job_context.mustHave || "N/A"}\n- Should-have: ${job_context.shouldHave || "N/A"}\n- Nice-to-have: ${job_context.niceToHave || "N/A"}\n- Critères sourcing: ${job_context.sourcingCriteria || "N/A"}\n\n`
      : "";
    let jobContextInjected = !job_context; // true if no context to inject

    // Add conversation history, ensuring role alternation
    for (const msg of (history || [])) {
      if (msg.role === "user" || msg.role === "assistant") {
        let content = msg.content;

        // Inject job context into the first user message
        if (!jobContextInjected && msg.role === "user") {
          content = jobContextPrefix + content;
          jobContextInjected = true;
        }

        // Merge consecutive same-role messages instead of creating duplicates
        const last = messages[messages.length - 1];
        if (last && last.role === msg.role) {
          last.content += "\n\n" + content;
        } else {
          messages.push({ role: msg.role as "user" | "assistant", content });
        }
      }
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: resolvedModel,
        max_tokens: 32000,
        thinking: {
          type: "enabled",
          budget_tokens: 16000,
        },
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[search-agent-chat] AI error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Stream the response and also collect it to save
    const reader = response.body!.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let fullResponse = "";
    let _tokensIn = 0;
    let _tokensOut = 0;

    const transformedStream = new ReadableStream({
      async start(controller) {
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Extract metadata from response
            const metadata: Record<string, unknown> = {};

            // Save full assistant message
            if (fullResponse.trim()) {
              const planMatch = fullResponse.match(/\[SEARCH_PLAN\]\s*([\s\S]*?)\s*\[\/SEARCH_PLAN\]/);
              if (planMatch) {
                try { metadata.search_plan = JSON.parse(planMatch[1]); } catch {}
              }
              const actionMatch = fullResponse.match(/\[AGENT_ACTION\]\s*([\s\S]*?)\s*\[\/AGENT_ACTION\]/);
              if (actionMatch) {
                try { metadata.agent_action = JSON.parse(actionMatch[1]); } catch {}
              }

              await supabase.from("agent_messages").insert({
                conversation_id,
                role: "assistant",
                content: fullResponse,
                metadata: Object.keys(metadata).length > 0 ? metadata : {},
              });

              // Update conversation status if action detected
              if (metadata.search_plan) {
                await supabase.from("agent_conversations")
                  .update({ search_config: metadata.search_plan, status: "plan_proposed" })
                  .eq("id", conversation_id);
              }
            }

            // Settle AI credits (fire-and-forget)
            if (_tokensIn + _tokensOut > 0) {
              try {
                const { resolveOrgIdFromUser } = await import("../_shared/resolve-org-credentials.ts");
                const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
                const orgId = await resolveOrgIdFromUser(user.id, adminClient);
                if (orgId) {
                  const { settleCredits } = await import("../_shared/settle-credits.ts");
                  settleCredits(adminClient, {
                    organizationId: orgId, userId: user.id,
                    aiAction: _aiParams.aiAction, modelId: _aiParams.modelId,
                    tokensInput: _tokensIn, tokensOutput: _tokensOut,
                    description: _aiParams.description,
                  }).catch((e) => console.warn("[search-agent-chat] settle error:", e));
                }
              } catch (e) { console.warn("[search-agent-chat] settle skipped:", e); }
            }

            // Emit done event so the client knows the DB is up to date
            const donePayload: Record<string, unknown> = { done: true };
            if (metadata.search_plan) donePayload.plan_saved = true;
            if (metadata.agent_action) donePayload.agent_action = metadata.agent_action;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(donePayload)}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const jsonStr = line.slice(6).trim();
              if (!jsonStr || jsonStr === "[DONE]") continue;

              try {
                const event = JSON.parse(jsonStr);
                
                // Handle thinking deltas
                if (event.type === "content_block_delta" && event.delta?.type === "thinking_delta") {
                  const thinkingText = event.delta.thinking || "";
                  if (thinkingText) {
                    const chunk = { choices: [{ delta: { thinking: thinkingText }, index: 0 }] };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                  }
                }
                
                // Handle text deltas
                if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
                  const text = event.delta.text || "";
                  if (text) {
                    fullResponse += text;
                    const chunk = { choices: [{ delta: { content: text }, index: 0 }] };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                  }
                }

                // Capture token usage
                if (event.type === "message_start" && event.message?.usage) {
                  _tokensIn = event.message.usage.input_tokens || 0;
                }
                if (event.type === "message_delta" && event.usage) {
                  _tokensOut = event.usage.output_tokens || 0;
                }
              } catch {}
            }
          }
        }
      },
    });

    return new Response(transformedStream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("[search-agent-chat] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
