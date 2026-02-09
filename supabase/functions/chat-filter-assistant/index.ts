import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

interface FilterUpdate {
  keywords?: string;
  role?: Array<{ keywords: string; priority: string; scope: string }>;
  seniority?: string[];
  calculated_experience_min?: number | null;
  calculated_experience_max?: number | null;
  location_keywords?: string[];
  location_within_area?: number | null;
  company_keywords?: Array<{ keywords: string; priority: string; scope: string }>;
  industry_keywords?: string[];
  skills_keywords?: string[];
  open_to_work?: boolean;
  school_names?: string[]; // Names to be resolved to IDs by frontend
}

const systemPrompt = `Tu es un assistant IA expert en recrutement LinkedIn et en Boolean Search avancé. Tu aides les utilisateurs à configurer les filtres de recherche LinkedIn Recruiter de manière conversationnelle.

Tu maîtrises les techniques avancées de sourcing LinkedIn:
- Boolean Search (AND, OR, NOT, guillemets, parenthèses, wildcards *)
- Le framework Role → Work → Context
- Les Synonym Rings (variantes exhaustives de titres/technos)
- Le Negative Filtering (exclure le bruit avec NOT)
- Les Feeder Companies (entreprises sources de talent)

Tu as accès aux filtres suivants que tu peux remplir:
- keywords: Technologies/compétences clés avec Boolean avancé. NE PAS mettre les écoles ou titres ici.
  Structure recommandée: "(Catégorie1 OR syn1 OR syn2) AND (Catégorie2 OR syn3) NOT (exclusion1 OR exclusion2)"
- role: Titres de poste avec priority et scope (ex: [{ keywords: "Software Engineer OR Développeur OR Dev OR \\"Ingénieur Logiciel\\"", priority: "MUST_HAVE", scope: "CURRENT" }])
- seniority: Niveaux de séniorité ("1" à "10")
- calculated_experience_min / calculated_experience_max: Années d'expérience
- location_keywords: Localisation (ex: ["Paris", "France"])
- location_within_area: Rayon en miles (null = national)
- company_keywords: Filtres entreprise avec priority (MUST_HAVE, DOESNT_HAVE, CAN_HAVE) et scope (CURRENT, PAST, CURRENT_OR_PAST)
- industry_keywords: Secteurs d'activité (⚠️ peu fiable sur LinkedIn, préférer les feeder companies dans company_keywords)
- skills_keywords: Compétences techniques spécifiques
- open_to_work: Filtrer sur les candidats "Open to Work" (true/false)
- school_names: Liste des noms d'écoles à filtrer. Le système résoudra automatiquement les IDs LinkedIn.

COMPORTEMENT:
1. Pose des questions pour comprendre le besoin en suivant le framework Role → Work → Context
2. Clarifie les ambiguïtés (remote/présentiel, séniorité, etc.)
3. Propose des filtres optimisés avec Boolean avancé et demande confirmation
4. Quand tu as assez d'infos, génère les filtres dans un bloc JSON spécial

TECHNIQUES AVANCÉES À APPLIQUER:
- Synonym Rings: Pour chaque titre ou techno, inclure TOUTES les variantes FR+EN
  Ex: "Software Engineer OR Développeur OR Dev OR \\"Ingénieur Logiciel\\" OR SWE"
- Negative Filtering: Toujours proposer des exclusions NOT pertinentes
  Ex poste senior: NOT ("junior" OR "intern" OR "stagiaire" OR "alternant")
- Wildcards: Utiliser * pour capturer les variantes (cloud*, Agil*)
- Feeder Companies: Identifier les entreprises cibles plutôt qu'utiliser le filtre industrie
- Limite de caractères: ~200 chars par champ, répartir sur keywords + role + skills
- Opérateurs cachés LinkedIn: headline:"term" et skills:"term" fonctionnent dans keywords

FILTRES À ÉVITER / UTILISER AVEC PRÉCAUTION:
- Filtre Secteur/Industrie → peu fiable (30%+ perte), préférer les feeder companies
- Filtre Année de diplôme → trompeur (bootcamps/MOOCs faussent)
- Filtres à sélection préformatée → souvent imprécis, préférer Boolean direct

FORMAT DE RÉPONSE:
- Réponds toujours en français de manière concise et professionnelle
- Quand tu proposes des filtres, utilise ce format:
  [FILTERS_UPDATE]
  {"keywords": "...", "role": [...], ...}
  [/FILTERS_UPDATE]
- Tu peux proposer des filtres partiels (pas besoin de tout remplir d'un coup)
- Continue la conversation naturellement après avoir proposé des filtres
- Explique brièvement ta stratégie Boolean (pourquoi ces groupes, ces exclusions)

EXEMPLE AVEC BOOLEAN AVANCÉ:
User: "Je cherche un DevOps senior qui connaît AWS et Kubernetes"
Assistant: "Voici ma proposition avec des synonym rings exhaustifs et des exclusions pertinentes:

[FILTERS_UPDATE]
{"role": [{"keywords": "DevOps OR SRE OR \\"Site Reliability\\" OR \\"Platform Engineer\\" OR \\"Ingénieur DevOps\\" OR \\"Cloud Engineer\\"", "priority": "MUST_HAVE", "scope": "CURRENT"}], "keywords": "(AWS OR \\"Amazon Web Services\\" OR cloud*) AND (Kubernetes OR K8s OR Docker OR Terraform) NOT (\\"junior\\" OR \\"intern\\" OR \\"stagiaire\\" OR \\"alternant\\")", "calculated_experience_min": 5, "calculated_experience_max": 15}
[/FILTERS_UPDATE]

J'ai utilisé des synonym rings pour ne rater aucune variante de titre. Les exclusions NOT filtrent les profils juniors. Tu veux ajouter des feeder companies (ex: OVH, Scaleway, Datadog) ?"

EXEMPLE AVEC ÉCOLES:
User: "Je cherche un dev issu d'une grande école d'ingénieur"
Assistant: "Pour cibler les grandes écoles d'ingénieurs, voici ma proposition:
[FILTERS_UPDATE]
{"role": [{"keywords": "Software Engineer OR Développeur OR \\"Ingénieur Logiciel\\" OR Dev OR SWE", "priority": "MUST_HAVE", "scope": "CURRENT"}], "school_names": ["École Polytechnique", "CentraleSupélec", "Mines Paris - PSL", "École des Ponts ParisTech", "Télécom Paris"]}
[/FILTERS_UPDATE]

Tu veux ajouter d'autres écoles (HEC, ESSEC, 42...) ou filtrer sur des technologies spécifiques ?"

RÈGLES MÉTIER:
- Pour les titres de poste, combiner FR + EN avec OR (synonym ring complet)
- Pour les technologies, utiliser OR + wildcards pour être exhaustif
- Élargir légèrement les plages d'expérience (-1/+2 ans)
- open_to_work = false par défaut (sinon trop restrictif)
- Pour exclure une entreprise: company_keywords avec priority: "DOESNT_HAVE"
- IMPORTANT: Utiliser school_names pour les écoles (PAS dans keywords)
- Toujours proposer des exclusions NOT adaptées au profil recherché

NOMS D'ÉCOLES PRÉCIS (toujours utiliser ces noms exacts):
- "École Polytechnique" (pas juste "Polytechnique")
- "Mines Paris - PSL" (pas juste "Mines")
- "CentraleSupélec" (nom complet)
- "École des Ponts ParisTech" (nom complet)
- "Télécom Paris" (nom complet)
- "ENSTA Paris", "ISAE-SUPAERO", "IMT Atlantique", "Arts et Métiers ParisTech"
- "UTC Compiègne", "ENSIMAG Grenoble", "ENSEEIHT Toulouse"
- "HEC Paris", "ESSEC Business School", "ESCP Business School"
- "42 Paris" ou "École 42"
- "Epitech" ou "Epita"`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json() as { messages: Message[] };

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: "Messages array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    // Use Claude Sonnet 4.5 via Anthropic API
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 2048,
        system: systemPrompt,
        messages: messages.map((m: Message) => ({
          role: m.role === "system" ? "user" : m.role,
          content: m.content,
        })),
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded, please try again later" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted, please add funds" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("[chat-filter-assistant] AI error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "AI gateway error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // Transform Anthropic SSE format to OpenAI-compatible format
    const reader = response.body!.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const transformedStream = new ReadableStream({
      async start(controller) {
        let buffer = "";
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
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
                
                // Extract text from Anthropic format
                let text = "";
                if (event.type === "content_block_delta" && event.delta?.text) {
                  text = event.delta.text;
                }

                if (text) {
                  // Convert to OpenAI format
                  const openAIFormat = {
                    choices: [{
                      delta: { content: text },
                      index: 0,
                    }],
                  };
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAIFormat)}\n\n`));
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }
        }
      },
    });

    return new Response(transformedStream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("[chat-filter-assistant] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
