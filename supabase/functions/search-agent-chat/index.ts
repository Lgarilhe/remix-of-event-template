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
- Ultra concis. Phrases courtes. Pas de blabla.
- Max 3-4 lignes par message (hors plan final)
- Utilise des listes à puces courtes, pas de paragraphes
- Émojis en début de ligne uniquement pour structurer

CALIBRATION (une question par message):
Quand tu reçois une fiche de poste:

1. RÉSUMÉ (message 1): 3 bullet points max résumant le poste, puis ta première question
2. TITRES (question 1): Propose 2-3 variantes, demande validation
3. LOCALISATION (question 2): Propose basé sur la fiche, demande confirmation
4. EXPÉRIENCE (question 3): Propose une fourchette, demande ajustement
5. ENTREPRISES (question 4): Cibles ou exclusions ?
6. BONUS (question 5): Écoles, certifs, open to work ?

Numérote: "➡️ 2/5 — Localisation"

Si la fiche répond déjà clairement à une question, saute-la.

PLAN FINAL — Après toutes les réponses:
[SEARCH_PLAN]
{
  "summary": "Description courte",
  "filters": {
    "keywords": "Boolean search string",
    "role": [{"keywords": "...", "priority": "MUST_HAVE", "scope": "CURRENT"}],
    "seniority": ["5", "6"],
    "calculated_experience_min": 3,
    "calculated_experience_max": 10,
    "location_keywords": ["Paris"],
    "location_within_area": null,
    "company_keywords": [],
    "skills_keywords": [],
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

VALIDATION: Quand le recruteur dit "go"/"ok"/"lance":
[AGENT_ACTION]
{"action": "start_search"}
[/AGENT_ACTION]

RÈGLES:
- Français, concis, pro
- Synonym rings FR+EN pour titres
- Exclusions NOT pertinentes
- Élargir expérience -1/+2 ans
- open_to_work = false par défaut
- Max 200 chars par champ de filtre LinkedIn
- Wildcards * pour variantes (cloud*, Agil*)`;

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
        max_tokens: 2048,
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
                let text = "";
                if (event.type === "content_block_delta" && event.delta?.text) {
                  text = event.delta.text;
                }
                if (text) {
                  fullResponse += text;
                  const chunk = { choices: [{ delta: { content: text }, index: 0 }] };
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
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
