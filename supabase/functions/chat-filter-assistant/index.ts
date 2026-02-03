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

const systemPrompt = `Tu es un assistant IA expert en recrutement LinkedIn. Tu aides les utilisateurs à configurer les filtres de recherche LinkedIn Recruiter de manière conversationnelle.

Tu as accès aux filtres suivants que tu peux remplir:
- keywords: Technologies/compétences clés (ex: "Python OR Django", "AWS OR Azure"). NE PAS mettre les écoles ici.
- role: Titres de poste avec priority et scope (ex: [{ keywords: "Software Engineer OR Développeur", priority: "MUST_HAVE", scope: "CURRENT" }])
- seniority: Niveaux de séniorité ("1" à "10")
- calculated_experience_min / calculated_experience_max: Années d'expérience
- location_keywords: Localisation (ex: ["Paris", "France"])
- location_within_area: Rayon en miles (null = national)
- company_keywords: Filtres entreprise avec priority (MUST_HAVE, DOESNT_HAVE, CAN_HAVE) et scope (CURRENT, PAST, CURRENT_OR_PAST)
- industry_keywords: Secteurs d'activité
- skills_keywords: Compétences techniques spécifiques
- open_to_work: Filtrer sur les candidats "Open to Work" (true/false)
- school_names: Liste des noms d'écoles à filtrer (ex: ["Polytechnique", "HEC Paris", "CentraleSupélec"]). Le système résoudra automatiquement les IDs LinkedIn.

COMPORTEMENT:
1. Pose des questions pour comprendre le besoin du recruteur
2. Clarifie les ambiguïtés (remote/présentiel, séniorité, etc.)
3. Propose des filtres et demande confirmation
4. Quand tu as assez d'infos, génère les filtres dans un bloc JSON spécial

FORMAT DE RÉPONSE:
- Réponds toujours en français de manière concise et professionnelle
- Quand tu proposes des filtres, utilise ce format:
  [FILTERS_UPDATE]
  {"keywords": "...", "role": [...], ...}
  [/FILTERS_UPDATE]
- Tu peux proposer des filtres partiels (pas besoin de tout remplir d'un coup)
- Continue la conversation naturellement après avoir proposé des filtres

EXEMPLE AVEC ÉCOLES:
User: "Je cherche un dev issu d'une grande école d'ingénieur"
Assistant: "Pour cibler les grandes écoles d'ingénieurs, voici ma proposition:
[FILTERS_UPDATE]
{"role": [{"keywords": "Software Engineer OR Développeur", "priority": "MUST_HAVE", "scope": "CURRENT"}], "school_names": ["Polytechnique", "CentraleSupélec", "Mines Paris - PSL", "École des Ponts ParisTech", "Télécom Paris"]}
[/FILTERS_UPDATE]

Tu veux ajouter d'autres écoles (HEC, ESSEC, 42...) ou filtrer sur des technologies spécifiques ?"

RÈGLES MÉTIER:
- Pour les titres de poste, combiner FR + EN avec OR
- Pour les technologies, utiliser OR pour être moins restrictif
- Élargir légèrement les plages d'expérience (-1/+2 ans)
- open_to_work = false par défaut (sinon trop restrictif)
- Pour exclure une entreprise: company_keywords avec priority: "DOESNT_HAVE"
- IMPORTANT: Utiliser school_names pour les écoles (PAS dans keywords). Le système résoudra les IDs automatiquement.

NOMS D'ÉCOLES PRÉCIS (toujours utiliser ces noms exacts pour éviter les confusions avec des écoles étrangères):
- "École Polytechnique" (pas juste "Polytechnique" pour éviter Polytechnique Montréal)
- "Mines Paris - PSL" ou "Mines ParisTech" (pas juste "Mines" pour éviter Mines de Rabat)
- "CentraleSupélec" ou "Centrale Paris" (pas juste "Centrale")
- "École des Ponts ParisTech" (pas juste "Les Ponts")
- "Télécom Paris" (nom complet)
- "ENSTA Paris" (pas juste ENSTA)
- "ISAE-SUPAERO" (nom complet)
- "IMT Atlantique" (nom complet)
- "Arts et Métiers ParisTech" (nom complet)
- "UTC Compiègne" (préciser Compiègne)
- "ENSIMAG Grenoble" (préciser Grenoble)
- "ENSEEIHT Toulouse" (préciser Toulouse)
- "HEC Paris", "ESSEC Business School", "ESCP Business School" (noms complets)
- "42 Paris" ou "École 42" (pas juste "42")
- "Epitech" ou "Epita" (noms complets)`;

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

    // Stream the response back
    return new Response(response.body, {
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
