import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ProfileData {
  name: string;
  headline?: string;
  currentRole?: string;
  currentCompany?: string;
  location?: string;
  skills?: string[];
  pastPositions?: string[];
}

interface JobData {
  title: string;
  client?: { name: string; sector: string } | null;
  skills?: string[];
  description?: string;
  location?: string;
  remote?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { profile, job, tone = "professional" } = await req.json() as {
      profile: ProfileData;
      job: JobData;
      tone?: "professional" | "casual" | "enthusiastic";
    };
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    if (!profile || !job) {
      throw new Error("Profile and job data are required");
    }

    const toneInstructions = {
      professional: "Ton professionnel et formel, mais chaleureux. Vouvoiement.",
      casual: "Ton décontracté et amical, tutoiement possible si le profil semble jeune/startup.",
      enthusiastic: "Ton enthousiaste et engageant, montre de l'excitation pour le profil."
    };

    const prompt = `Génère un message d'approche LinkedIn personnalisé pour recruter ce candidat.

PROFIL DU CANDIDAT:
- Nom: ${profile.name}
- Titre: ${profile.headline || 'Non spécifié'}
- Poste actuel: ${profile.currentRole || 'Non spécifié'} chez ${profile.currentCompany || 'Non spécifié'}
- Localisation: ${profile.location || 'Non spécifié'}
- Compétences: ${profile.skills?.join(', ') || 'Non spécifiées'}
- Expériences passées: ${profile.pastPositions?.slice(0, 3).join('; ') || 'Non spécifiées'}

POSTE À POURVOIR:
- Titre: ${job.title}
- Client: ${job.client?.name || 'Client confidentiel'} (${job.client?.sector || 'Tech'})
- Compétences requises: ${job.skills?.join(', ') || 'Non spécifiées'}
- Localisation: ${job.location || 'Non spécifié'}
- Télétravail: ${job.remote || 'Non spécifié'}
${job.description ? `- Contexte: ${job.description.slice(0, 200)}...` : ''}

INSTRUCTIONS:
- ${toneInstructions[tone]}
- Le message doit faire entre 100 et 200 mots maximum
- Personnalise en mentionnant un élément spécifique du profil (compétence, entreprise, parcours)
- Explique brièvement pourquoi le profil match avec l'opportunité
- Inclus un call-to-action clair (proposition d'échange, appel)
- Ne mentionne PAS de salaire
- Sois authentique, évite les phrases génériques

Réponds UNIQUEMENT en JSON valide:
{
  "subject": "Objet court pour InMail (max 60 caractères)",
  "message": "Le message d'approche complet",
  "personalization_points": ["Point personnalisé 1", "Point personnalisé 2"]
}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { 
            role: "system", 
            content: "Tu es un expert en recrutement tech et en copywriting. Tu rédiges des messages d'approche LinkedIn qui convertissent. Tu réponds TOUJOURS en JSON valide, sans markdown." 
          },
          { role: "user", content: prompt }
        ],
        max_tokens: 500,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Limite de requêtes atteinte, réessayez plus tard." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Crédits IA épuisés." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || "";
    
    // Clean up potential markdown code blocks
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    try {
      const result = JSON.parse(content);
      return new Response(
        JSON.stringify({ success: true, ...result }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (parseError) {
      console.error("JSON parse error:", parseError, "Content:", content);
      return new Response(
        JSON.stringify({ 
          success: true,
          subject: `Opportunité ${job.title}`,
          message: content,
          personalization_points: []
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("Error generating message:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
