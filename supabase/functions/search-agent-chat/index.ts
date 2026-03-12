import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
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

CHAMPS DISPONIBLES ET LEUR USAGE:

1. **keywords** (string) → TECHNOLOGIES/COMPÉTENCES UNIQUEMENT
   - Requête Boolean: (Tech1 OR Syn1) AND (Tech2 OR Syn2) NOT (exclusions)
   - NE PAS inclure de titres de poste ni de localisation ici
   - Max ~200 caractères

2. **role** (array d'objets) → TITRES DE POSTE
   - Format: [{"keywords": "Title1 OR Title2 OR TitleFR", "priority": "MUST_HAVE", "scope": "CURRENT"}]
   - UN SEUL objet avec tous les titres en OR
   - Inclure variantes FR + EN
   - Scopes possibles: "CURRENT", "PAST", "CURRENT_OR_PAST"

3. **location_keywords** (array de strings) → LOCALISATION
   - Noms de villes/régions: ["Paris", "Lyon", "Île-de-France"]
   - Le moteur résoudra automatiquement les IDs LinkedIn
   - NE PAS mettre la localisation dans keywords

4. **location_within_area** (number|null) → Rayon en miles autour de la localisation

5. **seniority** (array de strings) → NIVEAU DE SÉNIORITÉ
   - Valeurs valides Recruiter: "owner", "partner", "cxo", "vp", "director", "manager", "senior", "entry", "training", "unpaid"

6. **company_keywords** (array de strings) → ENTREPRISES CIBLES/EXCLUSIONS
   - Noms d'entreprises: ["Google", "Meta", "Datadog"]

7. **open_to_work** (boolean) → Filtre spotlight "Open to Work"

8. **calculated_experience_min/max** (numbers) → Filtrage côté client post-recherche

9. **skills_keywords** (array) → Pour le scoring uniquement (pas un filtre API)
10. **school_names** (array) → Pour le scoring uniquement (pas un filtre API)

⚠️ RÈGLE CRITIQUE - SYNONYMES EXHAUSTIFS (Synonym Rings):
Pour CHAQUE technologie dans keywords, inclure TOUS les synonymes:

MAPPING TECHNOS (exemples obligatoires):
- Java → "Java OR JEE OR J2EE OR J2E OR \\"Java EE\\" OR \\"Jakarta EE\\""
- Spring → "Spring OR \\"Spring Boot\\" OR SpringBoot OR \\"Spring Batch\\""
- Kubernetes → "Kubernetes OR K8s OR K8"
- AWS → "AWS OR \\"Amazon Web Services\\""
- GCP → "GCP OR \\"Google Cloud\\" OR \\"Google Cloud Platform\\""
- Azure → "Azure OR \\"Microsoft Azure\\""
- Docker → "Docker OR Container"
- Python → "Python OR Python3"
- JavaScript → "JavaScript OR JS"
- TypeScript → "TypeScript OR TS"
- React → "React OR ReactJS"
- .NET → ".NET OR DotNet OR \\"C#\\" OR CSharp"
- SQL → "SQL OR MySQL OR MariaDB OR MSSQL"
- Terraform → "Terraform OR IaC"
- Kafka → "Kafka OR \\"Apache Kafka\\""
- Spark → "Spark OR PySpark"

⚠️ RÈGLE CRITIQUE - NEGATIVE FILTERING (EXCLUSIONS):
Ajouter des exclusions NOT pour éliminer le bruit:
- Poste senior → NOT ("junior" OR "intern" OR "stagiaire" OR "alternant")
- Poste IC → NOT ("manager" OR "director" OR "VP")

RÈGLES DE CONSTRUCTION KEYWORDS:
1. Identifier 2-3 catégories technologiques DISTINCTES
2. Combiner avec AND (parenthèses obligatoires)
3. MAX 2-3 groupes AND - au-delà c'est trop restrictif
4. Ajouter un groupe NOT
5. Max ~200 caractères

=== CONSTRUCTION DU "role" (titres de poste uniquement) ===
- UN SEUL élément avec tous les titres alternatifs en OR
- Inclure français ET anglais
- Exhaustif en synonymes
- Exemple: [{"keywords": "\\"Cloud Network Engineer\\" OR \\"Network Architect\\" OR \\"Ingénieur Réseau\\" OR \\"Network Engineer\\"", "priority": "MUST_HAVE", "scope": "CURRENT"}]

=== EXPÉRIENCE - INFÉRENCE OBLIGATOIRE ===
Tu DOIS TOUJOURS retourner calculated_experience_min ET calculated_experience_max.
Si le poste ne précise pas, DÉDUIS du contexte:
- "Junior" → 0-3 ans
- "Confirmé" → 3-7 ans
- "Senior" / "Lead" → 5-12 ans
- "Staff" / "Architecte" → 8-15 ans
- Standard sans indice → 2-8 ans

=== PLAN FINAL FORMAT ===
[SEARCH_PLAN]
{
  "summary": "Description courte",
  "filters": {
    "keywords": "Boolean TECHNOLOGIES/COMPÉTENCES uniquement. Ex: (Java OR JEE) AND (Spring OR SpringBoot) NOT (junior OR stagiaire)",
    "role": [{"keywords": "Titre1 OR Titre2 OR TitreEN", "priority": "MUST_HAVE", "scope": "CURRENT"}],
    "location_keywords": ["Paris", "Île-de-France"],
    "location_within_area": null,
    "seniority": ["senior"],
    "calculated_experience_min": 3,
    "calculated_experience_max": 10,
    "company_keywords": [],
    "skills_keywords": ["Python", "Machine Learning"],
    "open_to_work": false,
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
- Exclusions NOT pertinentes
- Élargir expérience -1/+2 ans
- open_to_work = false par défaut
- Max 200 chars pour le champ keywords
- Localisation dans location_keywords, PAS dans keywords
- Titres dans role, PAS dans keywords`;

serve(async (req) => {
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

    const { conversation_id, message, job_context } = await req.json();

    if (!conversation_id || !message) {
      return new Response(JSON.stringify({ error: "conversation_id and message required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

    // Add job context as first user message if provided
    if (job_context) {
      messages.push({
        role: "user",
        content: `Contexte du poste:\n- Titre: ${job_context.title}\n- Client: ${job_context.client?.name || "N/A"}\n- Localisation: ${job_context.location || "N/A"}\n- Remote: ${job_context.remote || "N/A"}\n- Séniorité: ${job_context.seniority || "N/A"}\n- XP: ${job_context.xpMin || "?"}-${job_context.xpMax || "?"} ans\n- Skills: ${(job_context.skills || []).join(", ")}\n- Description: ${(job_context.description || "").slice(0, 500)}\n- Must-have: ${job_context.mustHave || "N/A"}\n- Should-have: ${job_context.shouldHave || "N/A"}\n- Nice-to-have: ${job_context.niceToHave || "N/A"}\n- Critères sourcing: ${job_context.sourcingCriteria || "N/A"}`,
      });
    }

    // Add conversation history
    for (const msg of (history || [])) {
      if (msg.role === "user" || msg.role === "assistant") {
        messages.push({ role: msg.role as "user" | "assistant", content: msg.content });
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
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 16000,
        thinking: {
          type: "enabled",
          budget_tokens: 8000,
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

    const transformedStream = new ReadableStream({
      async start(controller) {
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Save full assistant message
            if (fullResponse.trim()) {
              // Extract metadata from response
              const metadata: Record<string, unknown> = {};
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
